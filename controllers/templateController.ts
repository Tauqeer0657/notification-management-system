import type { Request, Response } from "express";
import sql from "mssql";
import { getPool } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Validation helpers
const validateTemplateName = (name: string): boolean => {
  return !!(name && name.trim().length > 0 && name.length <= 100);
};

const validateSubject = (subject: string): boolean => {
  return !!(subject && subject.trim().length > 0 && subject.length <= 200);
};

const validateBody = (body: string): boolean => {
  return !!(body && body.trim().length > 0);
};

// Extract variables from template (finds {{variable_name}} patterns)
const extractTemplateVariables = (text: string): string[] => {
  const regex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  const variables = new Set<string>();
  let match;

  while ((match = regex.exec(text)) !== null) {
    variables.add(match[1]);
  }

  return Array.from(variables);
};

// CREATE NOTIFICATION TEMPLATE

export const createTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    // Only admin/super-admin can create templates
    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can create templates");
    }

    const { template_name, department_id, subject, body, channel_ids } =
      req.body;

    // Validation
    if (!template_name || !validateTemplateName(template_name)) {
      throw new ApiError(
        400,
        "Valid template name is required (max 100 chars)"
      );
    }

    if (!department_id) {
      throw new ApiError(400, "Department ID is required");
    }

    if (!subject || !validateSubject(subject)) {
      throw new ApiError(400, "Valid subject is required (max 200 chars)");
    }

    if (!body || !validateBody(body)) {
      throw new ApiError(400, "Template body is required");
    }

    if (
      !channel_ids ||
      !Array.isArray(channel_ids) ||
      channel_ids.length === 0
    ) {
      throw new ApiError(400, "At least one channel must be selected");
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Check if department exists and is active
      const deptCheckRequest = new sql.Request(transaction);
      const deptCheck = await deptCheckRequest.input(
        "dept_id",
        sql.VarChar(20),
        department_id
      ).query(`
          SELECT department_id, department_name, is_active
          FROM notif_departments
          WHERE department_id = @dept_id
        `);

      if (!deptCheck.recordset || deptCheck.recordset.length === 0) {
        throw new ApiError(404, "Department not found");
      }

      if (!deptCheck.recordset[0].is_active) {
        throw new ApiError(
          400,
          "Cannot create template for inactive department"
        );
      }

      // Super-admin can create for any department
      // Admin can only create for their own department
      if (
        authUser.role === "admin" &&
        authUser.department_id !== department_id
      ) {
        throw new ApiError(
          403,
          "Admins can only create templates for their own department"
        );
      }

      // Verify all channels exist and are active
      const channelCheckRequest = new sql.Request(transaction);
      const channelIds = channel_ids.map((id: any) => parseInt(id));

      const channelCheck = await channelCheckRequest.query(`
          SELECT channel_id, channel_name, is_active
          FROM notif_notification_channels
          WHERE channel_id IN (${channelIds.join(",")})
        `);

      if (channelCheck.recordset.length !== channelIds.length) {
        throw new ApiError(400, "One or more channels not found");
      }

      const inactiveChannels = channelCheck.recordset.filter(
        (c: any) => !c.is_active
      );
      if (inactiveChannels.length > 0) {
        throw new ApiError(
          400,
          `Cannot use inactive channels: ${inactiveChannels
            .map((c: any) => c.channel_name)
            .join(", ")}`
        );
      }

      // Generate template ID (TMPL001, TMPL002, etc.)
      const codeRequest = new sql.Request(transaction);
      const codeResult = await codeRequest.query(`
        SELECT 'TMPL' + RIGHT('000' + CAST(
          ISNULL(MAX(CAST(SUBSTRING(template_id, 5, LEN(template_id)) AS INT)), 0) + 1
          AS VARCHAR), 3) AS new_code
        FROM notif_notification_templates WITH (TABLOCKX, HOLDLOCK);
      `);

      const templateCode = codeResult.recordset[0]?.new_code;

      // Extract template variables from subject and body
      const subjectVars = extractTemplateVariables(subject);
      const bodyVars = extractTemplateVariables(body);
      const allVariables = Array.from(new Set([...subjectVars, ...bodyVars]));
      const variablesJson =
        allVariables.length > 0 ? JSON.stringify(allVariables) : null;

      // Insert template
      const insertRequest = new sql.Request(transaction);
      const result = await insertRequest
        .input("template_id", sql.VarChar(20), templateCode)
        .input("template_name", sql.NVarChar(100), template_name.trim())
        .input("department_id", sql.VarChar(20), department_id)
        .input("subject", sql.NVarChar(200), subject.trim())
        .input("body", sql.NVarChar(sql.MAX), body.trim())
        .input("template_variables", sql.NVarChar(1000), variablesJson)
        .input("created_by", sql.VarChar(20), authUser.user_id).query(`
          INSERT INTO notif_notification_templates (
            template_id, template_name, department_id, subject, body,
            template_variables, is_active, created_by, created_at, updated_at
          )
          OUTPUT 
            INSERTED.template_id,
            INSERTED.template_name,
            INSERTED.department_id,
            INSERTED.subject,
            INSERTED.body,
            INSERTED.template_variables,
            INSERTED.is_active,
            INSERTED.created_at
          VALUES (
            @template_id, @template_name, @department_id, @subject, @body,
            @template_variables, 1, @created_by, GETDATE(), GETDATE()
          )
        `);

      const insertedTemplate = result.recordset[0];

      // Insert template-channel mappings
      const assignedChannels = [];
      for (const channelId of channelIds) {
        const channelRequest = new sql.Request(transaction);
        const channelResult = await channelRequest
          .input("template_id", sql.VarChar(20), templateCode)
          .input("channel_id", sql.Int, channelId).query(`
            INSERT INTO notif_template_channels (template_id, channel_id, created_at)
            VALUES (@template_id, @channel_id, GETDATE());

            SELECT c.channel_id, c.channel_name
            FROM notif_notification_channels c
            WHERE c.channel_id = @channel_id;
          `);

        assignedChannels.push(channelResult.recordset[0]);
      }

      await transaction.commit();

      res.status(201).json(
        new ApiResponse(
          201,
          {
            ...insertedTemplate,
            department_name: deptCheck.recordset[0].department_name,
            channels: assignedChannels,
            extracted_variables: allVariables,
          },
          "Template created successfully"
        )
      );
    } catch (error: any) {
      await transaction.rollback();
      throw error;
    }
  }
);

// GET ALL NOTIFICATION TEMPLATES

export const getAllTemplates = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const department_id = (req.query.department_id as string) || "";
    const includeInactive = req.query.includeInactive === "true";

    const offset = (page - 1) * limit;

    if (page < 1 || limit < 1 || limit > 100) {
      throw new ApiError(400, "Invalid pagination parameters");
    }

    const pool = getPool();
    const request = pool.request();

    let whereConditions: string[] = [];

    // Super-admin sees all templates
    // Admin sees only their department's templates
    // Regular user sees only their department's templates
    if (authUser.role !== "super-admin") {
      whereConditions.push("t.department_id = @user_department_id");
      request.input(
        "user_department_id",
        sql.VarChar(20),
        authUser.department_id
      );
    }

    if (!includeInactive) {
      whereConditions.push("t.is_active = 1");
    }

    if (department_id && department_id.trim()) {
      whereConditions.push("t.department_id = @department_id");
      request.input("department_id", sql.VarChar(20), department_id.trim());
    }

    if (search && search.trim()) {
      whereConditions.push(`(
          t.template_id LIKE @search OR 
          t.template_name LIKE @search OR 
          t.subject LIKE @search
        )`);
      request.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Get templates with pagination
    const dataQuery = `
        SELECT 
          t.template_id,
          t.template_name,
          t.department_id,
          d.department_name,
          t.subject,
          t.body,
          t.template_variables,
          t.is_active,
          t.created_by,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
          t.created_at,
          t.updated_at
        FROM notif_notification_templates t
        INNER JOIN notif_departments d ON t.department_id = d.department_id
        LEFT JOIN notif_users u ON t.created_by = u.user_id
        ${whereClause}
        ORDER BY t.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY;
      `;

    // Get all template IDs for channel lookup
    const templateIdsQuery = `
        SELECT t.template_id
        FROM notif_notification_templates t
        INNER JOIN notif_departments d ON t.department_id = d.department_id
        ${whereClause}
        ORDER BY t.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY;
      `;

    // Count query
    const countQuery = `
        SELECT COUNT(*) AS total
        FROM notif_notification_templates t
        INNER JOIN notif_departments d ON t.department_id = d.department_id
        ${whereClause};
      `;

    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    const countRequest = pool.request();

    // Add same WHERE conditions to count query
    if (authUser.role !== "super-admin") {
      countRequest.input(
        "user_department_id",
        sql.VarChar(20),
        authUser.department_id
      );
    }
    if (department_id && department_id.trim()) {
      countRequest.input(
        "department_id",
        sql.VarChar(20),
        department_id.trim()
      );
    }
    if (search && search.trim()) {
      countRequest.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const [dataResult, templateIdsResult, countResult] = await Promise.all([
      request.query(dataQuery),
      request.query(templateIdsQuery),
      countRequest.query(countQuery),
    ]);

    const templates = dataResult.recordset || [];
    const templateIds = templateIdsResult.recordset.map(
      (t: any) => t.template_id
    );
    const totalRecords = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    // Get channels for these templates
    let channelsData: any[] = [];
    if (templateIds.length > 0) {
      const channelsRequest = pool.request();
      const channelsResult = await channelsRequest.query(`
          SELECT 
            tc.template_id,
            c.channel_id,
            c.channel_name
          FROM notif_template_channels tc
          INNER JOIN notif_notification_channels c ON tc.channel_id = c.channel_id
          WHERE tc.template_id IN (${templateIds
            .map((id: string) => `'${id}'`)
            .join(",")})
          ORDER BY c.channel_name;
        `);
      channelsData = channelsResult.recordset || [];
    }

    // Merge channels into templates with variable count
    const templatesWithChannels = templates.map((template: any) => {
      const parsedVariables = template.template_variables
        ? JSON.parse(template.template_variables)
        : [];

      return {
        ...template,
        template_variables: parsedVariables,
        variables_count: parsedVariables.length,
        channels: channelsData.filter(
          (ch: any) => ch.template_id === template.template_id
        ),
      };
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          templates: templatesWithChannels,
          pagination: {
            currentPage: page,
            totalPages,
            totalRecords,
            limit,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
          filters: {
            search: search || null,
            department_id: department_id || null,
            includeInactive,
          },
        },
        templates.length > 0
          ? "Templates fetched successfully"
          : "No templates found"
      )
    );
  }
);

// GET SINGLE NOTIFICATION TEMPLATE

export const getTemplateById = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const { id } = req.params;

    if (!id) {
      throw new ApiError(400, "Template ID is required");
    }

    const pool = getPool();
    const request = pool.request();

    // Get template
    const templateQuery = `
        SELECT 
          t.template_id,
          t.template_name,
          t.department_id,
          d.department_name,
          t.subject,
          t.body,
          t.template_variables,
          t.is_active,
          t.created_by,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
          u.email AS created_by_email,
          t.created_at,
          t.updated_at
        FROM notif_notification_templates t
        INNER JOIN notif_departments d ON t.department_id = d.department_id
        LEFT JOIN notif_users u ON t.created_by = u.user_id
        WHERE t.template_id = @template_id;
      `;

    // Get channels for this template
    const channelsQuery = `
        SELECT 
          c.channel_id,
          c.channel_name,
          c.is_active
        FROM notif_template_channels tc
        INNER JOIN notif_notification_channels c ON tc.channel_id = c.channel_id
        WHERE tc.template_id = @template_id
        ORDER BY c.channel_name;
      `;

    request.input("template_id", sql.VarChar(20), id);

    const [templateResult, channelsResult] = await Promise.all([
      request.query(templateQuery),
      request.query(channelsQuery),
    ]);

    if (!templateResult.recordset || templateResult.recordset.length === 0) {
      throw new ApiError(404, "Template not found");
    }

    const template = templateResult.recordset[0];
    const channels = channelsResult.recordset || [];

    // Permission check: Non-super-admin can only view their department's templates
    if (
      authUser.role !== "super-admin" &&
      template.department_id !== authUser.department_id
    ) {
      throw new ApiError(
        403,
        "You can only view templates from your department"
      );
    }

    res.status(200).json(
      new ApiResponse(
        200,
        {
          ...template,
          template_variables: template.template_variables
            ? JSON.parse(template.template_variables)
            : [],
          channels,
        },
        "Template fetched successfully"
      )
    );
  }
);

// UPDATE NOTIFICATION TEMPLATE

export const updateTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    // Only admin/super-admin can update templates
    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can update templates");
    }

    const { id } = req.params;
    const { template_name, subject, body, is_active, channel_ids } = req.body;

    if (!id) {
      throw new ApiError(400, "Template ID is required");
    }

    // Validate at least one field to update
    if (
      template_name === undefined &&
      subject === undefined &&
      body === undefined &&
      is_active === undefined &&
      channel_ids === undefined
    ) {
      throw new ApiError(400, "No fields provided for update");
    }

    // Validate inputs if provided
    if (template_name !== undefined && !validateTemplateName(template_name)) {
      throw new ApiError(400, "Invalid template name (max 100 chars)");
    }

    if (subject !== undefined && !validateSubject(subject)) {
      throw new ApiError(400, "Invalid subject (max 200 chars)");
    }

    if (body !== undefined && !validateBody(body)) {
      throw new ApiError(400, "Template body cannot be empty");
    }

    if (
      channel_ids !== undefined &&
      (!Array.isArray(channel_ids) || channel_ids.length === 0)
    ) {
      throw new ApiError(400, "At least one channel must be selected");
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Check if template exists
      const checkRequest = new sql.Request(transaction);
      const templateCheck = await checkRequest.input(
        "template_id_check",
        sql.VarChar(20),
        id
      ).query(`
            SELECT 
              template_id, 
              template_name, 
              department_id,
              subject,
              body
            FROM notif_notification_templates
            WHERE template_id = @template_id_check
          `);

      if (!templateCheck.recordset || templateCheck.recordset.length === 0) {
        throw new ApiError(404, "Template not found");
      }

      const existingTemplate = templateCheck.recordset[0];

      // Permission check: Admin can only update their department's templates
      if (
        authUser.role === "admin" &&
        existingTemplate.department_id !== authUser.department_id
      ) {
        throw new ApiError(
          403,
          "Admins can only update templates from their department"
        );
      }

      const request = new sql.Request(transaction);
      const updates: string[] = [];

      // Use existing values if not provided in update
      const finalSubject =
        subject !== undefined ? subject.trim() : existingTemplate.subject;
      const finalBody =
        body !== undefined ? body.trim() : existingTemplate.body;

      // Recalculate template variables
      const subjectVars = extractTemplateVariables(finalSubject);
      const bodyVars = extractTemplateVariables(finalBody);
      const allVariables = Array.from(new Set([...subjectVars, ...bodyVars]));
      const variablesJson =
        allVariables.length > 0 ? JSON.stringify(allVariables) : null;

      if (template_name !== undefined) {
        updates.push("template_name = @template_name");
        request.input("template_name", sql.NVarChar(100), template_name.trim());
      }

      if (subject !== undefined) {
        updates.push("subject = @subject");
        request.input("subject", sql.NVarChar(200), subject.trim());
      }

      if (body !== undefined) {
        updates.push("body = @body");
        request.input("body", sql.NVarChar(sql.MAX), body.trim());
      }

      if (is_active !== undefined) {
        updates.push("is_active = @is_active");
        request.input("is_active", sql.Bit, is_active ? 1 : 0);
      }

      // Always update template_variables if subject or body changed
      if (subject !== undefined || body !== undefined) {
        updates.push("template_variables = @template_variables");
        request.input("template_variables", sql.NVarChar(1000), variablesJson);
      }

      updates.push("updated_at = GETDATE()");

      // Update channels if provided
      if (channel_ids !== undefined) {
        const channelIds = channel_ids.map((id: any) => parseInt(id));

        // Verify all channels exist and are active
        const channelCheckRequest = new sql.Request(transaction);
        const channelCheck = await channelCheckRequest.query(`
              SELECT channel_id, channel_name, is_active
              FROM notif_notification_channels
              WHERE channel_id IN (${channelIds.join(",")})
            `);

        if (channelCheck.recordset.length !== channelIds.length) {
          throw new ApiError(400, "One or more channels not found");
        }

        const inactiveChannels = channelCheck.recordset.filter(
          (c: any) => !c.is_active
        );
        if (inactiveChannels.length > 0) {
          throw new ApiError(
            400,
            `Cannot use inactive channels: ${inactiveChannels
              .map((c: any) => c.channel_name)
              .join(", ")}`
          );
        }

        // Delete existing channel mappings
        const deleteChannelsRequest = new sql.Request(transaction);
        await deleteChannelsRequest.input(
          "template_id_del",
          sql.VarChar(20),
          id
        ).query(`
              DELETE FROM notif_template_channels
              WHERE template_id = @template_id_del
            `);

        // Insert new channel mappings
        for (const channelId of channelIds) {
          const channelInsertRequest = new sql.Request(transaction);
          await channelInsertRequest
            .input("template_id_ins", sql.VarChar(20), id)
            .input("channel_id_ins", sql.Int, channelId).query(`
                INSERT INTO notif_template_channels (template_id, channel_id, created_at)
                VALUES (@template_id_ins, @channel_id_ins, GETDATE())
              `);
        }
      }

      // Update template
      const updateQuery = `
          UPDATE notif_notification_templates
          SET ${updates.join(", ")}
          WHERE template_id = @template_id;
        `;

      await request
        .input("template_id", sql.VarChar(20), id)
        .query(updateQuery);

      await transaction.commit();

      // Fetch updated template with channels
      const fetchRequest = pool.request();
      const updatedTemplateQuery = `
          SELECT 
            t.template_id,
            t.template_name,
            t.department_id,
            d.department_name,
            t.subject,
            t.body,
            t.template_variables,
            t.is_active,
            t.created_by,
            t.created_at,
            t.updated_at
          FROM notif_notification_templates t
          INNER JOIN notif_departments d ON t.department_id = d.department_id
          WHERE t.template_id = @template_id;
  
          SELECT 
            c.channel_id,
            c.channel_name
          FROM notif_template_channels tc
          INNER JOIN notif_notification_channels c ON tc.channel_id = c.channel_id
          WHERE tc.template_id = @template_id
          ORDER BY c.channel_name;
        `;

      const result = await fetchRequest
        .input("template_id", sql.VarChar(20), id)
        .query(updatedTemplateQuery);

      const updatedTemplate = result.recordsets[0][0];
      const updatedChannels = result.recordsets[1] || [];

      res.status(200).json(
        new ApiResponse(
          200,
          {
            ...updatedTemplate,
            template_variables: updatedTemplate.template_variables
              ? JSON.parse(updatedTemplate.template_variables)
              : [],
            channels: updatedChannels,
          },
          "Template updated successfully"
        )
      );
    } catch (error: any) {
      await transaction.rollback();
      throw error;
    }
  }
);

// DELETE NOTIFICATION TEMPLATE

export const deleteTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    // Only super-admin can delete templates
    if (authUser.role !== "super-admin") {
      throw new ApiError(403, "Only super-admin can delete templates");
    }

    const { id } = req.params;

    if (!id) {
      throw new ApiError(400, "Template ID is required");
    }

    const pool = getPool();
    const request = pool.request();

    // Check if template exists
    const templateCheck = await request.input(
      "template_id_check",
      sql.VarChar(20),
      id
    ).query(`
          SELECT 
            t.template_id, 
            t.template_name,
            d.department_name
          FROM notif_notification_templates t
          INNER JOIN notif_departments d ON t.department_id = d.department_id
          WHERE t.template_id = @template_id_check
        `);

    if (!templateCheck.recordset || templateCheck.recordset.length === 0) {
      throw new ApiError(404, "Template not found");
    }

    const templateData = templateCheck.recordset[0];

    // Check if template is being used in schedules
    const scheduleUsageCheck = await pool
      .request()
      .input("template_id_schedule", sql.VarChar(20), id).query(`
          SELECT COUNT(*) as usage_count 
          FROM notif_notification_schedules 
          WHERE template_id = @template_id_schedule AND is_active = 1
        `);

    if (scheduleUsageCheck.recordset[0].usage_count > 0) {
      throw new ApiError(
        409,
        `Cannot delete template. It is used in ${scheduleUsageCheck.recordset[0].usage_count} active schedule(s)`
      );
    }

    // Check if template is being used in notifications
    const notificationUsageCheck = await pool
      .request()
      .input("template_id_notif", sql.VarChar(20), id).query(`
          SELECT COUNT(*) as usage_count 
          FROM notif_notifications 
          WHERE template_id = @template_id_notif
        `);

    if (notificationUsageCheck.recordset[0].usage_count > 0) {
      throw new ApiError(
        409,
        `Cannot delete template. It has ${notificationUsageCheck.recordset[0].usage_count} notification(s). Consider deactivating instead.`
      );
    }

    // Soft delete (set is_active = 0)
    const deleteQuery = `
        UPDATE notif_notification_templates
        SET is_active = 0, updated_at = GETDATE()
        WHERE template_id = @template_id;
      `;

    const result = await pool
      .request()
      .input("template_id", sql.VarChar(20), id)
      .query(deleteQuery);

    if (result.rowsAffected[0] === 0) {
      throw new ApiError(500, "Failed to delete template");
    }

    res.status(200).json(
      new ApiResponse(
        200,
        {
          template_id: templateData.template_id,
          template_name: templateData.template_name,
          department_name: templateData.department_name,
        },
        "Template deleted successfully"
      )
    );
  }
);

// GET TEMPLATE STATISTICS

export const getTemplateStats = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const pool = getPool();
    const request = pool.request();

    let departmentFilter = "";
    if (authUser.role !== "super-admin") {
      departmentFilter = "WHERE t.department_id = @user_department_id";
      request.input(
        "user_department_id",
        sql.VarChar(20),
        authUser.department_id
      );
    }

    const query = `
        -- Total templates
        SELECT COUNT(*) AS total_templates 
        FROM notif_notification_templates t
        ${departmentFilter}
        ${departmentFilter ? "AND" : "WHERE"} t.is_active = 1;
  
        -- Total inactive templates
        SELECT COUNT(*) AS inactive_templates 
        FROM notif_notification_templates t
        ${departmentFilter}
        ${departmentFilter ? "AND" : "WHERE"} t.is_active = 0;
  
        -- Templates by department
        SELECT 
          d.department_id,
          d.department_name,
          COUNT(t.template_id) AS template_count
        FROM notif_departments d
        LEFT JOIN notif_notification_templates t ON d.department_id = t.department_id AND t.is_active = 1
        ${
          authUser.role !== "super-admin"
            ? "WHERE d.department_id = @user_department_id"
            : ""
        }
        GROUP BY d.department_id, d.department_name
        ORDER BY template_count DESC;
  
        -- Most used channels
        SELECT 
          c.channel_id,
          c.channel_name,
          COUNT(tc.template_id) AS template_count
        FROM notif_notification_channels c
        LEFT JOIN notif_template_channels tc ON c.channel_id = tc.channel_id
        LEFT JOIN notif_notification_templates t ON tc.template_id = t.template_id
        ${departmentFilter.replace("t.department_id", "t.department_id")}
        GROUP BY c.channel_id, c.channel_name
        ORDER BY template_count DESC;
      `;

    const result = await request.query(query);

    const totalTemplates = result.recordsets[0][0]?.total_templates || 0;
    const inactiveTemplates = result.recordsets[1][0]?.inactive_templates || 0;
    const templatesByDepartment = result.recordsets[2] || [];
    const channelUsage = result.recordsets[3] || [];

    res.status(200).json(
      new ApiResponse(
        200,
        {
          total_active_templates: totalTemplates,
          total_inactive_templates: inactiveTemplates,
          templates_by_department: templatesByDepartment,
          channel_usage: channelUsage,
        },
        "Template statistics fetched successfully"
      )
    );
  }
);
