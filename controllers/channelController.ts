import type { Request, Response } from "express";
import sql from "mssql";
import { getPool } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Validation helper
const validateChannelName = (name: string): boolean => {
  return !!(name && name.trim().length > 0 && name.length <= 20);
};

// CREATE NOTIFICATION CHANNEL

export const createChannel = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    // Only admin/super-admin can create channels
    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can create notification channels");
    }

    const { channel_name, is_active } = req.body;

    // Validation
    if (!channel_name || !validateChannelName(channel_name)) {
      throw new ApiError(400, "Valid channel name is required (max 20 chars)");
    }

    const pool = getPool();
    const request = pool.request();

    // Check if channel already exists
    const checkExists = await request
      .input("channel_name_check", sql.VarChar(20), channel_name.trim().toLowerCase())
      .query(`
        SELECT channel_id, channel_name 
        FROM notif_notification_channels 
        WHERE LOWER(channel_name) = @channel_name_check
      `);

    if (checkExists.recordset.length > 0) {
      throw new ApiError(409, "Channel with this name already exists");
    }

    // Insert channel
    const insertRequest = pool.request();
    const result = await insertRequest
      .input("channel_name", sql.VarChar(20), channel_name.trim().toLowerCase())
      .input("is_active", sql.Bit, is_active !== undefined ? (is_active ? 1 : 0) : 1)
      .query(`
        INSERT INTO notif_notification_channels (channel_name, is_active, created_at)
        OUTPUT INSERTED.channel_id, INSERTED.channel_name, INSERTED.is_active, INSERTED.created_at
        VALUES (@channel_name, @is_active, GETDATE())
      `);

    res.status(201).json(
      new ApiResponse(201, result.recordset[0], "Channel created successfully")
    );
  }
);

// GET ALL NOTIFICATION CHANNELS

export const getAllChannels = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const includeInactive = req.query.includeInactive === "true";

    const offset = (page - 1) * limit;

    if (page < 1 || limit < 1 || limit > 100) {
      throw new ApiError(400, "Invalid pagination parameters");
    }

    const pool = getPool();
    const request = pool.request();

    let whereConditions: string[] = [];

    if (!includeInactive) {
      whereConditions.push("is_active = 1");
    }

    if (search && search.trim()) {
      whereConditions.push("channel_name LIKE @search");
      request.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(" AND ")}` 
      : "";

    // Get channels with pagination
    const dataQuery = `
      SELECT 
        channel_id,
        channel_name,
        is_active,
        created_at
      FROM notif_notification_channels
      ${whereClause}
      ORDER BY created_at DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY;
    `;

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM notif_notification_channels
      ${whereClause};
    `;

    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    const countRequest = pool.request();

    // Add search parameter to count query if exists
    if (search && search.trim()) {
      countRequest.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const [dataResult, countResult] = await Promise.all([
      request.query(dataQuery),
      countRequest.query(countQuery),
    ]);

    const channels = dataResult.recordset || [];
    const totalRecords = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          channels,
          pagination: {
            currentPage: page,
            totalPages,
            totalRecords,
            limit,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
          filters: { search: search || null, includeInactive },
        },
        channels.length > 0 ? "Channels fetched successfully" : "No channels found"
      )
    );
  }
);

// GET SINGLE NOTIFICATION CHANNEL

export const getChannelById = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const { id } = req.params;

    if (!id) {
      throw new ApiError(400, "Channel ID is required");
    }

    const pool = getPool();
    const request = pool.request();

    const query = `
      SELECT 
        channel_id,
        channel_name,
        is_active,
        created_at
      FROM notif_notification_channels
      WHERE channel_id = @channel_id;
    `;

    const result = await request
      .input("channel_id", sql.Int, parseInt(id))
      .query(query);

    if (!result.recordset || result.recordset.length === 0) {
      throw new ApiError(404, "Channel not found");
    }

    res.status(200).json(
      new ApiResponse(200, result.recordset[0], "Channel fetched successfully")
    );
  }
);

// UPDATE NOTIFICATION CHANNEL

export const updateChannel = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    // Only admin/super-admin can update channels
    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can update channels");
    }

    const { id } = req.params;
    const { channel_name, is_active } = req.body;

    if (!id) {
      throw new ApiError(400, "Channel ID is required");
    }

    // Validate at least one field to update
    if (channel_name === undefined && is_active === undefined) {
      throw new ApiError(400, "No fields provided for update");
    }

    // Validate channel name if provided
    if (channel_name && !validateChannelName(channel_name)) {
      throw new ApiError(400, "Invalid channel name (max 20 chars)");
    }

    const pool = getPool();
    const request = pool.request();
    const updates: string[] = [];

    if (channel_name !== undefined) {
      // Check if new name already exists
      const checkRequest = pool.request();
      const exists = await checkRequest
        .input("channel_name_check", sql.VarChar(20), channel_name.trim().toLowerCase())
        .input("channel_id_check", sql.Int, parseInt(id))
        .query(`
          SELECT channel_id 
          FROM notif_notification_channels 
          WHERE LOWER(channel_name) = @channel_name_check 
            AND channel_id != @channel_id_check
        `);

      if (exists.recordset.length > 0) {
        throw new ApiError(409, "Channel name already exists");
      }

      updates.push("channel_name = @channel_name");
      request.input("channel_name", sql.VarChar(20), channel_name.trim().toLowerCase());
    }

    if (is_active !== undefined) {
      updates.push("is_active = @is_active");
      request.input("is_active", sql.Bit, is_active ? 1 : 0);
    }

    const query = `
      UPDATE notif_notification_channels
      SET ${updates.join(", ")}
      WHERE channel_id = @channel_id;

      SELECT 
        channel_id, 
        channel_name, 
        is_active, 
        created_at
      FROM notif_notification_channels
      WHERE channel_id = @channel_id;
    `;

    const result = await request
      .input("channel_id", sql.Int, parseInt(id))
      .query(query);

    if (!result.recordset || result.recordset.length === 0) {
      throw new ApiError(404, "Channel not found");
    }

    res.status(200).json(
      new ApiResponse(200, result.recordset[0], "Channel updated successfully")
    );
  }
);

// DELETE NOTIFICATION CHANNEL

export const deleteChannel = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    // Only super-admin can delete channels
    if (authUser.role !== "super-admin") {
      throw new ApiError(403, "Only super-admin can delete channels");
    }

    const { id } = req.params;

    if (!id) {
      throw new ApiError(400, "Channel ID is required");
    }

    const pool = getPool();
    const request = pool.request();

    // Check if channel exists
    const channelCheck = await request
      .input("channel_id_check", sql.Int, parseInt(id))
      .query(`
        SELECT channel_id, channel_name 
        FROM notif_notification_channels 
        WHERE channel_id = @channel_id_check
      `);

    if (!channelCheck.recordset || channelCheck.recordset.length === 0) {
      throw new ApiError(404, "Channel not found");
    }

    const channelData = channelCheck.recordset[0];

    // Check if channel is being used in templates
    const templateUsageCheck = await pool.request()
      .input("channel_id_template", sql.Int, parseInt(id))
      .query(`
        SELECT COUNT(*) as usage_count 
        FROM notif_template_channels 
        WHERE channel_id = @channel_id_template
      `);

    if (templateUsageCheck.recordset[0].usage_count > 0) {
      throw new ApiError(
        409,
        `Cannot delete channel. It is used in ${templateUsageCheck.recordset[0].usage_count} template(s)`
      );
    }

    // Check if channel is being used in user preferences
    const preferenceUsageCheck = await pool.request()
      .input("channel_id_pref", sql.Int, parseInt(id))
      .query(`
        SELECT COUNT(*) as usage_count 
        FROM notif_user_notification_preferences 
        WHERE channel_id = @channel_id_pref
      `);

    if (preferenceUsageCheck.recordset[0].usage_count > 0) {
      throw new ApiError(
        409,
        `Cannot delete channel. It is used in ${preferenceUsageCheck.recordset[0].usage_count} user preference(s)`
      );
    }

    // Check if channel is being used in delivery logs
    const deliveryLogCheck = await pool.request()
      .input("channel_id_log", sql.Int, parseInt(id))
      .query(`
        SELECT COUNT(*) as usage_count 
        FROM notif_notification_delivery_log 
        WHERE channel_id = @channel_id_log
      `);

    if (deliveryLogCheck.recordset[0].usage_count > 0) {
      throw new ApiError(
        409,
        `Cannot delete channel. It has ${deliveryLogCheck.recordset[0].usage_count} delivery log(s). Consider deactivating instead.`
      );
    }

    // Hard delete (since no dependencies)
    const deleteQuery = `
      DELETE FROM notif_notification_channels
      WHERE channel_id = @channel_id;
    `;

    const result = await pool.request()
      .input("channel_id", sql.Int, parseInt(id))
      .query(deleteQuery);

    if (result.rowsAffected[0] === 0) {
      throw new ApiError(500, "Failed to delete channel");
    }

    res.status(200).json(
      new ApiResponse(
        200,
        {
          channel_id: channelData.channel_id,
          channel_name: channelData.channel_name,
        },
        "Channel deleted successfully"
      )
    );
  }
);