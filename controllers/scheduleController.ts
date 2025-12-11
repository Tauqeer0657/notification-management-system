import type { Request, Response } from "express";
import sql from "mssql";
import { getPool } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Helper: validate schedule_type
const isValidScheduleType = (type: string): boolean => {
  return ["once", "daily", "weekly", "monthly"].includes(type);
};

// Helper: simple HH:MM validation (frontend should still validate properly)
const isValidTime = (time: string): boolean => {
  if (!time || typeof time !== "string") return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  return !!match;
};

// CREATE SCHEDULE
export const createSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can create schedules");
    }

    const {
      template_id,
      department_id,
      sub_department_id,
      schedule_type,
      schedule_time,
      start_date,
      end_date,
      template_variables,
      recipient_user_ids,
    } = req.body;

    // Basic validation
    if (!template_id) {
      throw new ApiError(400, "template_id is required");
    }
    if (!department_id) {
      throw new ApiError(400, "department_id is required");
    }
    if (!schedule_type || !isValidScheduleType(schedule_type)) {
      throw new ApiError(
        400,
        "schedule_type must be one of: once, daily, weekly, monthly"
      );
    }
    if (!schedule_time || !isValidTime(schedule_time)) {
      throw new ApiError(400, "schedule_time must be in HH:MM 24h format");
    }
    if (!start_date) {
      throw new ApiError(400, "start_date is required");
    }
    if (
      !recipient_user_ids ||
      !Array.isArray(recipient_user_ids) ||
      recipient_user_ids.length === 0
    ) {
      throw new ApiError(
        400,
        "recipient_user_ids must be a non-empty array of user IDs"
      );
    }

    // Admin: can only create schedules for own department
    if (
      authUser.role === "admin" &&
      authUser.department_id !== department_id
    ) {
      throw new ApiError(
        403,
        "Admins can only create schedules for their own department"
      );
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // 1) Validate department & sub-department
      const deptRequest = new sql.Request(transaction);
      const deptResult = await deptRequest
        .input("dept_id", sql.VarChar(20), department_id)
        .query(`
          SELECT department_id, department_name, is_active
          FROM notif_departments
          WHERE department_id = @dept_id
        `);

      if (!deptResult.recordset.length) {
        throw new ApiError(404, "Department not found");
      }
      if (!deptResult.recordset[0].is_active) {
        throw new ApiError(400, "Cannot create schedule for inactive department");
      }

      let subDeptName: string | null = null;

      if (sub_department_id) {
        const subDeptRequest = new sql.Request(transaction);
        const subDeptResult = await subDeptRequest
          .input("sub_dept_id", sql.VarChar(20), sub_department_id)
          .input("dept_id_check", sql.VarChar(20), department_id)
          .query(`
            SELECT sub_department_id, sub_department_name, is_active, department_id
            FROM notif_sub_departments
            WHERE sub_department_id = @sub_dept_id
              AND department_id = @dept_id_check
          `);

        if (!subDeptResult.recordset.length) {
          throw new ApiError(
            404,
            "Sub-department not found or does not belong to the given department"
          );
        }
        if (!subDeptResult.recordset[0].is_active) {
          throw new ApiError(
            400,
            "Cannot create schedule for inactive sub-department"
          );
        }

        subDeptName = subDeptResult.recordset[0].sub_department_name;
      }

      // 2) Validate template
      const templateRequest = new sql.Request(transaction);
      const templateResult = await templateRequest
        .input("template_id", sql.VarChar(20), template_id)
        .query(`
          SELECT 
            t.template_id,
            t.template_name,
            t.subject,
            t.department_id,
            t.is_active
          FROM notif_notification_templates t
          WHERE t.template_id = @template_id
        `);

      if (!templateResult.recordset.length) {
        throw new ApiError(404, "Template not found");
      }

      const templateRow = templateResult.recordset[0];

      if (!templateRow.is_active) {
        throw new ApiError(400, "Cannot create schedule for inactive template");
      }

      // Optionally enforce that schedule department == template department
      if (templateRow.department_id !== department_id) {
        throw new ApiError(
          400,
          "Template department and schedule department must match"
        );
      }

      // 3) Validate recipients
      const recipientsSet = new Set<string>(
        recipient_user_ids.map((id: string) => id.trim())
      );

      const recipientsArray = Array.from(recipientsSet);

      const recipientsRequest = new sql.Request(transaction);
      const recipientsResult = await recipientsRequest.query(`
        SELECT 
          user_id,
          first_name,
          last_name,
          email,
          department_id,
          sub_department_id,
          is_active
        FROM notif_users
        WHERE user_id IN (${recipientsArray
          .map((id) => `'${id}'`)
          .join(",")})
      `);

      if (recipientsResult.recordset.length !== recipientsArray.length) {
        throw new ApiError(
          400,
          "One or more recipient users not found"
        );
      }

      for (const user of recipientsResult.recordset) {
        if (!user.is_active) {
          throw new ApiError(
            400,
            `Recipient ${user.user_id} is inactive`
          );
        }
        if (user.department_id !== department_id) {
          throw new ApiError(
            400,
            `Recipient ${user.user_id} belongs to a different department`
          );
        }
        if (sub_department_id && user.sub_department_id !== sub_department_id) {
          throw new ApiError(
            400,
            `Recipient ${user.user_id} belongs to a different sub-department`
          );
        }
      }

      // 4) Generate schedule ID SCH001...
      const codeRequest = new sql.Request(transaction);
      const codeResult = await codeRequest.query(`
        SELECT 'SCH' + RIGHT('000' + CAST(
          ISNULL(MAX(CAST(SUBSTRING(schedule_id, 4, LEN(schedule_id)) AS INT)), 0) + 1
          AS VARCHAR), 3) AS new_code
        FROM notif_notification_schedules WITH (TABLOCKX, HOLDLOCK);
      `);

      const newScheduleId = codeResult.recordset[0]?.new_code;

      // 5) Serialize template_variables
      let variablesJson: string | null = null;
      if (template_variables !== undefined && template_variables !== null) {
        variablesJson = JSON.stringify(template_variables);
      }

      // 6) Insert into notif_notification_schedules
      const scheduleRequest = new sql.Request(transaction);
      const scheduleInsert = await scheduleRequest
        .input("schedule_id", sql.VarChar(20), newScheduleId)
        .input("template_id", sql.VarChar(20), template_id)
        .input("department_id", sql.VarChar(20), department_id)
        .input("sub_department_id", sql.VarChar(20), sub_department_id || null)
        .input("schedule_type", sql.VarChar(20), schedule_type)
        .input("schedule_time", sql.VarChar(8), `${schedule_time}:00`)
        .input("start_date", sql.Date, start_date)
        .input("end_date", sql.Date, end_date || null)
        .input("template_variables", sql.NVarChar(2000), variablesJson)
        .input("created_by", sql.VarChar(20), authUser.user_id)
        .query(`
          INSERT INTO notif_notification_schedules (
            schedule_id,
            template_id,
            department_id,
            sub_department_id,
            schedule_type,
            schedule_time,
            start_date,
            end_date,
            template_variables,
            is_active,
            last_executed,
            next_execution,
            created_by,
            created_at,
            updated_at
          )
          OUTPUT 
            INSERTED.schedule_id,
            INSERTED.template_id,
            INSERTED.department_id,
            INSERTED.sub_department_id,
            INSERTED.schedule_type,
            INSERTED.schedule_time,
            INSERTED.start_date,
            INSERTED.end_date,
            INSERTED.template_variables,
            INSERTED.is_active,
            INSERTED.last_executed,
            INSERTED.next_execution,
            INSERTED.created_by,
            INSERTED.created_at,
            INSERTED.updated_at
          VALUES (
            @schedule_id,
            @template_id,
            @department_id,
            @sub_department_id,
            @schedule_type,
            @schedule_time,
            @start_date,
            @end_date,
            @template_variables,
            1,
            NULL,
            NULL,
            @created_by,
            GETDATE(),
            GETDATE()
          )
        `);

      const insertedSchedule = scheduleInsert.recordset[0];

      // 7) Insert recipients into notif_schedule_recipients
      for (const userId of recipientsArray) {
        const rReq = new sql.Request(transaction);
        await rReq
          .input("schedule_id", sql.VarChar(20), newScheduleId)
          .input("user_id", sql.VarChar(20), userId)
          .query(`
            INSERT INTO notif_schedule_recipients (
              schedule_id,
              user_id,
              created_at
            )
            VALUES (@schedule_id, @user_id, GETDATE())
          `);
      }

      await transaction.commit();

      res.status(201).json(
        new ApiResponse(
          201,
          {
            ...insertedSchedule,
            template_name: templateRow.template_name,
            template_subject: templateRow.subject,
            department_name: deptResult.recordset[0].department_name,
            sub_department_name: subDeptName,
            template_variables: variablesJson ? JSON.parse(variablesJson) : null,
            recipients_count: recipientsArray.length,
          },
          "Schedule created successfully"
        )
      );
    } catch (error: any) {
      await transaction.rollback();
      throw error;
    }
  }
);

// GET ALL SCHEDULES
export const getAllSchedules = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const department_id = (req.query.department_id as string) || "";
    const schedule_type = (req.query.schedule_type as string) || "";
    const is_active_param = req.query.is_active;

    const offset = (page - 1) * limit;

    if (page < 1 || limit < 1 || limit > 100) {
      throw new ApiError(400, "Invalid pagination parameters");
    }

    const pool = getPool();
    const request = pool.request();

    const whereConditions: string[] = [];

    // Super-admin can see all; others are restricted to own department
    if (authUser.role !== "super-admin") {
      whereConditions.push("s.department_id = @user_department_id");
      request.input(
        "user_department_id",
        sql.VarChar(20),
        authUser.department_id
      );
    }

    if (department_id && department_id.trim()) {
      whereConditions.push("s.department_id = @department_id");
      request.input("department_id", sql.VarChar(20), department_id.trim());
    }

    if (schedule_type && schedule_type.trim()) {
      whereConditions.push("s.schedule_type = @schedule_type");
      request.input("schedule_type", sql.VarChar(20), schedule_type.trim());
    }

    if (is_active_param !== undefined) {
      const activeBool =
        is_active_param === "true" || is_active_param === "1";
      whereConditions.push("s.is_active = @is_active");
      request.input("is_active", sql.Bit, activeBool ? 1 : 0);
    } else {
      // default: only active
      whereConditions.push("s.is_active = 1");
    }

    if (search && search.trim()) {
      whereConditions.push(`(
        s.schedule_id LIKE @search OR 
        t.template_name LIKE @search
      )`);
      request.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const dataQuery = `
      SELECT 
        s.schedule_id,
        s.template_id,
        t.template_name,
        s.department_id,
        d.department_name,
        s.sub_department_id,
        sd.sub_department_name,
        s.schedule_type,
        s.schedule_time,
        s.start_date,
        s.end_date,
        s.template_variables,
        s.is_active,
        s.last_executed,
        s.next_execution,
        s.created_by,
        s.created_at,
        s.updated_at,
        COUNT(DISTINCT sr.user_id) AS recipients_count
      FROM notif_notification_schedules s
      INNER JOIN notif_notification_templates t ON s.template_id = t.template_id
      INNER JOIN notif_departments d ON s.department_id = d.department_id
      LEFT JOIN notif_sub_departments sd ON s.sub_department_id = sd.sub_department_id
      LEFT JOIN notif_schedule_recipients sr ON s.schedule_id = sr.schedule_id
      ${whereClause}
      GROUP BY 
        s.schedule_id,
        s.template_id,
        t.template_name,
        s.department_id,
        d.department_name,
        s.sub_department_id,
        sd.sub_department_name,
        s.schedule_type,
        s.schedule_time,
        s.start_date,
        s.end_date,
        s.template_variables,
        s.is_active,
        s.last_executed,
        s.next_execution,
        s.created_by,
        s.created_at,
        s.updated_at
      ORDER BY s.created_at DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY;
    `;

    const countRequest = pool.request();
    if (authUser.role !== "super-admin") {
      countRequest.input(
        "user_department_id",
        sql.VarChar(20),
        authUser.department_id
      );
    }
    if (department_id && department_id.trim()) {
      countRequest.input("department_id", sql.VarChar(20), department_id.trim());
    }
    if (schedule_type && schedule_type.trim()) {
      countRequest.input(
        "schedule_type",
        sql.VarChar(20),
        schedule_type.trim()
      );
    }
    if (is_active_param !== undefined) {
      const activeBool =
        is_active_param === "true" || is_active_param === "1";
      countRequest.input("is_active", sql.Bit, activeBool ? 1 : 0);
    }
    if (search && search.trim()) {
      countRequest.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const countQuery = `
      SELECT COUNT(DISTINCT s.schedule_id) AS total
      FROM notif_notification_schedules s
      INNER JOIN notif_notification_templates t ON s.template_id = t.template_id
      INNER JOIN notif_departments d ON s.department_id = d.department_id
      LEFT JOIN notif_sub_departments sd ON s.sub_department_id = sd.sub_department_id
      ${whereClause};
    `;

    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    const [dataResult, countResult] = await Promise.all([
      request.query(dataQuery),
      countRequest.query(countQuery),
    ]);

    const schedules = (dataResult.recordset || []).map((row: any) => ({
      ...row,
      template_variables: row.template_variables
        ? JSON.parse(row.template_variables)
        : null,
    }));

    const totalRecords = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          schedules,
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
            schedule_type: schedule_type || null,
            is_active:
              is_active_param !== undefined ? is_active_param : "true",
          },
        },
        schedules.length > 0
          ? "Schedules fetched successfully"
          : "No schedules found"
      )
    );
  }
);

// GET SINGLE SCHEDULE
export const getScheduleById = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const { id } = req.params;
    if (!id) throw new ApiError(400, "Schedule ID is required");

    const pool = getPool();
    const request = pool.request();

    const query = `
      SELECT 
        s.schedule_id,
        s.template_id,
        t.template_name,
        t.subject AS template_subject,
        s.department_id,
        d.department_name,
        s.sub_department_id,
        sd.sub_department_name,
        s.schedule_type,
        s.schedule_time,
        s.start_date,
        s.end_date,
        s.template_variables,
        s.is_active,
        s.last_executed,
        s.next_execution,
        s.created_by,
        s.created_at,
        s.updated_at
      FROM notif_notification_schedules s
      INNER JOIN notif_notification_templates t ON s.template_id = t.template_id
      INNER JOIN notif_departments d ON s.department_id = d.department_id
      LEFT JOIN notif_sub_departments sd ON s.sub_department_id = sd.sub_department_id
      WHERE s.schedule_id = @schedule_id;

      SELECT 
        sr.user_id,
        u.first_name,
        u.last_name,
        u.email,
        u.department_id,
        u.sub_department_id
      FROM notif_schedule_recipients sr
      INNER JOIN notif_users u ON sr.user_id = u.user_id
      WHERE sr.schedule_id = @schedule_id
      ORDER BY u.first_name, u.last_name;
    `;

    const result = await request
      .input("schedule_id", sql.VarChar(20), id)
      .query(query);

    if (!result.recordsets[0] || result.recordsets[0].length === 0) {
      throw new ApiError(404, "Schedule not found");
    }

    const schedule = result.recordsets[0][0];
    const recipients = result.recordsets[1] || [];

    // Department-based access check
    if (
      authUser.role !== "super-admin" &&
      schedule.department_id !== authUser.department_id
    ) {
      throw new ApiError(
        403,
        "You can only view schedules from your department"
      );
    }

    schedule.template_variables = schedule.template_variables
      ? JSON.parse(schedule.template_variables)
      : null;

    res.status(200).json(
      new ApiResponse(
        200,
        {
          schedule,
          recipients,
        },
        "Schedule fetched successfully"
      )
    );
  }
);

// UPDATE SCHEDULE (including recipients)
export const updateSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can update schedules");
    }

    const { id } = req.params;
    if (!id) throw new ApiError(400, "Schedule ID is required");

    const {
      schedule_type,
      schedule_time,
      start_date,
      end_date,
      template_variables,
      is_active,
      recipient_user_ids,
    } = req.body;

    if (
      schedule_type === undefined &&
      schedule_time === undefined &&
      start_date === undefined &&
      end_date === undefined &&
      template_variables === undefined &&
      is_active === undefined &&
      recipient_user_ids === undefined
    ) {
      throw new ApiError(400, "No fields provided for update");
    }

    if (schedule_type !== undefined && !isValidScheduleType(schedule_type)) {
      throw new ApiError(
        400,
        "schedule_type must be one of: once, daily, weekly, monthly"
      );
    }

    if (schedule_time !== undefined && !isValidTime(schedule_time)) {
      throw new ApiError(400, "schedule_time must be in HH:MM 24h format");
    }

    if (
      recipient_user_ids !== undefined &&
      (!Array.isArray(recipient_user_ids) || recipient_user_ids.length === 0)
    ) {
      throw new ApiError(
        400,
        "recipient_user_ids must be a non-empty array when provided"
      );
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // 1) Load existing schedule to check department and existing values
      const checkRequest = new sql.Request(transaction);
      const scheduleResult = await checkRequest
        .input("schedule_id_check", sql.VarChar(20), id)
        .query(`
          SELECT 
            schedule_id,
            department_id,
            schedule_type,
            schedule_time,
            start_date,
            end_date,
            template_variables,
            is_active
          FROM notif_notification_schedules
          WHERE schedule_id = @schedule_id_check
        `);

      if (!scheduleResult.recordset.length) {
        throw new ApiError(404, "Schedule not found");
      }

      const existing = scheduleResult.recordset[0];

      // Admin restriction
      if (
        authUser.role === "admin" &&
        existing.department_id !== authUser.department_id
      ) {
        throw new ApiError(
          403,
          "Admins can only update schedules from their department"
        );
      }

      const request = new sql.Request(transaction);
      const updates: string[] = [];

      if (schedule_type !== undefined) {
        updates.push("schedule_type = @schedule_type");
        request.input("schedule_type", sql.VarChar(20), schedule_type);
      }

      if (schedule_time !== undefined) {
        updates.push("schedule_time = @schedule_time");
        request.input("schedule_time", sql.Time, schedule_time + ":00");
      }

      if (start_date !== undefined) {
        updates.push("start_date = @start_date");
        request.input("start_date", sql.Date, start_date);
      }

      if (end_date !== undefined) {
        updates.push("end_date = @end_date");
        request.input("end_date", sql.Date, end_date || null);
      }

      let variablesJson: string | null | undefined = undefined;
      if (template_variables !== undefined) {
        variablesJson =
          template_variables !== null
            ? JSON.stringify(template_variables)
            : null;
        updates.push("template_variables = @template_variables");
        request.input(
          "template_variables",
          sql.NVarChar(2000),
          variablesJson
        );
      }

      if (is_active !== undefined) {
        updates.push("is_active = @is_active");
        request.input("is_active", sql.Bit, is_active ? 1 : 0);
      }

      updates.push("updated_at = GETDATE()");

      if (updates.length > 0) {
        const updateQuery = `
          UPDATE notif_notification_schedules
          SET ${updates.join(", ")}
          WHERE schedule_id = @schedule_id;
        `;

        await request
          .input("schedule_id", sql.VarChar(20), id)
          .query(updateQuery);
      }

      // 2) If recipient_user_ids provided, replace recipients
      if (recipient_user_ids !== undefined) {
        const recipientsSet = new Set<string>(
          recipient_user_ids.map((uid: string) => uid.trim())
        );
        const recipientsArray = Array.from(recipientsSet);

        // Validate recipients
        const recReq = new sql.Request(transaction);
        const recResult = await recReq.query(`
          SELECT 
            user_id,
            is_active,
            department_id
          FROM notif_users
          WHERE user_id IN (${recipientsArray
            .map((uid) => `'${uid}'`)
            .join(",")})
        `);

        if (recResult.recordset.length !== recipientsArray.length) {
          throw new ApiError(
            400,
            "One or more recipient users not found"
          );
        }

        for (const user of recResult.recordset) {
          if (!user.is_active) {
            throw new ApiError(
              400,
              `Recipient ${user.user_id} is inactive`
            );
          }
          if (user.department_id !== existing.department_id) {
            throw new ApiError(
              400,
              `Recipient ${user.user_id} belongs to a different department`
            );
          }
        }

        // Delete old recipients
        const delReq = new sql.Request(transaction);
        await delReq
          .input("schedule_id_del", sql.VarChar(20), id)
          .query(`
            DELETE FROM notif_schedule_recipients
            WHERE schedule_id = @schedule_id_del
          `);

        // Insert new recipients
        for (const userId of recipientsArray) {
          const insReq = new sql.Request(transaction);
          await insReq
            .input("schedule_id_ins", sql.VarChar(20), id)
            .input("user_id_ins", sql.VarChar(20), userId)
            .query(`
              INSERT INTO notif_schedule_recipients (
                schedule_id,
                user_id,
                created_at
              )
              VALUES (@schedule_id_ins, @user_id_ins, GETDATE())
            `);
        }
      }

      await transaction.commit();

      // Fetch updated schedule for response (without reusing transaction)
      const pool2 = getPool();
      const fetchReq = pool2.request();
      const finalResult = await fetchReq
        .input("schedule_id", sql.VarChar(20), id)
        .query(`
          SELECT 
            s.schedule_id,
            s.template_id,
            t.template_name,
            s.department_id,
            d.department_name,
            s.sub_department_id,
            sd.sub_department_name,
            s.schedule_type,
            s.schedule_time,
            s.start_date,
            s.end_date,
            s.template_variables,
            s.is_active,
            s.last_executed,
            s.next_execution,
            s.created_by,
            s.created_at,
            s.updated_at,
            COUNT(DISTINCT sr.user_id) AS recipients_count
          FROM notif_notification_schedules s
          INNER JOIN notif_notification_templates t ON s.template_id = t.template_id
          INNER JOIN notif_departments d ON s.department_id = d.department_id
          LEFT JOIN notif_sub_departments sd ON s.sub_department_id = sd.sub_department_id
          LEFT JOIN notif_schedule_recipients sr ON s.schedule_id = sr.schedule_id
          WHERE s.schedule_id = @schedule_id
          GROUP BY 
            s.schedule_id,
            s.template_id,
            t.template_name,
            s.department_id,
            d.department_name,
            s.sub_department_id,
            sd.sub_department_name,
            s.schedule_type,
            s.schedule_time,
            s.start_date,
            s.end_date,
            s.template_variables,
            s.is_active,
            s.last_executed,
            s.next_execution,
            s.created_by,
            s.created_at,
            s.updated_at
        `);

      if (!finalResult.recordset.length) {
        throw new ApiError(404, "Schedule not found after update");
      }

      const updatedRow = finalResult.recordset[0];
      updatedRow.template_variables = updatedRow.template_variables
        ? JSON.parse(updatedRow.template_variables)
        : null;

      res.status(200).json(
        new ApiResponse(200, updatedRow, "Schedule updated successfully")
      );
    } catch (error: any) {
      await transaction.rollback();
      throw error;
    }
  }
);

// UPDATE SCHEDULE STATUS (activate/deactivate only)
export const updateScheduleStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can update schedule status");
    }

    const { id } = req.params;
    const { is_active } = req.body;

    if (!id) throw new ApiError(400, "Schedule ID is required");
    if (is_active === undefined) {
      throw new ApiError(400, "is_active is required");
    }

    const pool = getPool();
    const request = pool.request();

    // Check existing schedule and department
    const check = await request
      .input("schedule_id_check", sql.VarChar(20), id)
      .query(`
        SELECT schedule_id, department_id, is_active
        FROM notif_notification_schedules
        WHERE schedule_id = @schedule_id_check
      `);

    if (!check.recordset.length) {
      throw new ApiError(404, "Schedule not found");
    }

    const schedule = check.recordset[0];

    if (
      authUser.role === "admin" &&
      schedule.department_id !== authUser.department_id
    ) {
      throw new ApiError(
        403,
        "Admins can only update schedules from their department"
      );
    }

    const updateResult = await pool
      .request()
      .input("schedule_id", sql.VarChar(20), id)
      .input("is_active", sql.Bit, is_active ? 1 : 0)
      .query(`
        UPDATE notif_notification_schedules
        SET is_active = @is_active, updated_at = GETDATE()
        WHERE schedule_id = @schedule_id;
      `);

    if (updateResult.rowsAffected[0] === 0) {
      throw new ApiError(500, "Failed to update schedule status");
    }

    res.status(200).json(
      new ApiResponse(
        200,
        {
          schedule_id: id,
          is_active: !!is_active,
        },
        "Schedule status updated successfully"
      )
    );
  }
);
