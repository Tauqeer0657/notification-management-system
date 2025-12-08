import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import sql from "mssql";
import { getPool } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateEmail, validatePassword } from "../utils/validators.js";

// CREATE USER

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  // Only admin and super-admin can create users
  if (authUser.role !== "admin" && authUser.role !== "super-admin") {
    throw new ApiError(403, "Only admins can create users");
  }

  const {
    first_name,
    last_name,
    email,
    password,
    phone_number,
    role,
    department_id,
    sub_department_id,
  } = req.body;

  // Basic validation
  if (!first_name || !last_name || !email || !password || !role || !department_id) {
    throw new ApiError(400, "Missing required fields: first_name, last_name, email, password, role, department_id");
  }

  if (!validateEmail(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  if (!validatePassword(password)) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  // Validate role
  const validRoles = ["super-admin", "admin", "user"];
  if (!validRoles.includes(role)) {
    throw new ApiError(400, "Invalid role. Must be: super-admin, admin, or user");
  }

  // Only super-admin can create super-admin/admin users
  if ((role === "super-admin" || role === "admin") && authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can create admin users");
  }

  const pool = getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();
    const request = new sql.Request(transaction);

    // Check if email already exists
    const emailCheck = await request
      .input("email", sql.NVarChar(255), email)
      .query("SELECT user_id FROM notif_users WHERE email = @email");

    if (emailCheck.recordset.length > 0) {
      throw new ApiError(409, "Email already exists");
    }

    // Verify department exists
    const deptCheck = await new sql.Request(transaction)
      .input("dept_id", sql.VarChar(20), department_id)
      .query("SELECT department_id FROM notif_departments WHERE department_id = @dept_id AND is_active = 1");

    if (deptCheck.recordset.length === 0) {
      throw new ApiError(404, "Department not found or inactive");
    }

    // Verify sub-department if provided
    if (sub_department_id) {
      const subDeptCheck = await new sql.Request(transaction)
        .input("sub_dept_id", sql.VarChar(20), sub_department_id)
        .input("dept_id", sql.VarChar(20), department_id)
        .query(`
          SELECT sub_department_id 
          FROM notif_sub_departments 
          WHERE sub_department_id = @sub_dept_id 
            AND department_id = @dept_id 
            AND is_active = 1
        `);

      if (subDeptCheck.recordset.length === 0) {
        throw new ApiError(404, "Sub-department not found or doesn't belong to specified department");
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate user ID
    const insertQuery = `
      DECLARE @newUserId VARCHAR(20);

      SELECT @newUserId = 'U' + RIGHT('000' + CAST(
        ISNULL(MAX(CAST(SUBSTRING(user_id, 2, LEN(user_id)) AS INT)), 0) + 1
        AS VARCHAR), 3)
      FROM notif_users WITH (TABLOCKX, HOLDLOCK);

      INSERT INTO notif_users (
        user_id, first_name, last_name, email, password_hash, 
        department_id, sub_department_id, role, phone_number,
        is_active, created_at, updated_at
      )
      VALUES (
        @newUserId, @first_name, @last_name, @email, @password_hash,
        @department_id, @sub_department_id, @role, @phone_number,
        1, GETDATE(), GETDATE()
      );

      SELECT @newUserId AS user_id;
    `;

    const insertRequest = new sql.Request(transaction);
    const result = await insertRequest
      .input("first_name", sql.NVarChar(50), first_name)
      .input("last_name", sql.NVarChar(50), last_name)
      .input("email", sql.NVarChar(255), email)
      .input("password_hash", sql.NVarChar(255), hashedPassword)
      .input("department_id", sql.VarChar(20), department_id)
      .input("sub_department_id", sql.VarChar(20), sub_department_id || null)
      .input("role", sql.VarChar(20), role)
      .input("phone_number", sql.VarChar(20), phone_number || null)
      .query(insertQuery);

    const newUserId = result.recordset[0]?.user_id;

    await transaction.commit();

    res.status(201).json(
      new ApiResponse(201, { user_id: newUserId }, "User created successfully")
    );
  } catch (error: any) {
    await transaction.rollback();
    throw error;
  }
});

// GET ALL USERS

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = (req.query.search as string) || "";
  const role = req.query.role as string;
  const department_id = req.query.department_id as string;
  const includeInactive = req.query.includeInactive === "true";

  const offset = (page - 1) * limit;

  if (page < 1 || limit < 1 || limit > 100) {
    throw new ApiError(400, "Invalid pagination parameters");
  }

  const pool = getPool();
  const request = pool.request();

  let whereConditions: string[] = [];

  // Only super-admin sees all users; admin/user see only their department
  if (authUser.role !== "super-admin") {
    whereConditions.push("u.department_id = @auth_department_id");
    request.input("auth_department_id", sql.VarChar(20), authUser.department_id);
  }

  if (!includeInactive) {
    whereConditions.push("u.is_active = 1");
  }

  if (search && search.trim()) {
    whereConditions.push(`(
      u.user_id LIKE @search OR 
      u.first_name LIKE @search OR 
      u.last_name LIKE @search OR
      u.email LIKE @search OR
      u.phone_number LIKE @search
    )`);
    request.input("search", sql.NVarChar, `%${search.trim()}%`);
  }

  if (role) {
    whereConditions.push("u.role = @role");
    request.input("role", sql.VarChar(20), role);
  }

  if (department_id) {
    whereConditions.push("u.department_id = @department_id");
    request.input("department_id", sql.VarChar(20), department_id);
  }

  const whereClause = whereConditions.length > 0 
    ? `WHERE ${whereConditions.join(" AND ")}` 
    : "";

  const dataQuery = `
    SELECT 
      u.user_id, u.first_name, u.last_name, u.email, u.phone_number,
      u.role, u.department_id, u.sub_department_id, u.is_active,
      u.last_login, u.created_at, u.updated_at,
      d.department_name,
      sd.sub_department_name
    FROM notif_users u
    INNER JOIN notif_departments d ON u.department_id = d.department_id
    LEFT JOIN notif_sub_departments sd ON u.sub_department_id = sd.sub_department_id
    ${whereClause}
    ORDER BY u.created_at DESC
    OFFSET @offset ROWS
    FETCH NEXT @limit ROWS ONLY;
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM notif_users u
    ${whereClause};
  `;

  request.input("offset", sql.Int, offset);
  request.input("limit", sql.Int, limit);

  const [dataResult, countResult] = await Promise.all([
    request.query(dataQuery),
    pool.request()
      .input("auth_department_id", authUser.role !== "super-admin" ? sql.VarChar(20) : null, 
             authUser.role !== "super-admin" ? authUser.department_id : null)
      .input("search", search ? sql.NVarChar : null, search ? `%${search.trim()}%` : null)
      .input("role", role ? sql.VarChar(20) : null, role || null)
      .input("department_id", department_id ? sql.VarChar(20) : null, department_id || null)
      .query(countQuery),
  ]);

  const users = dataResult.recordset || [];
  const totalRecords = countResult.recordset[0]?.total || 0;
  const totalPages = Math.ceil(totalRecords / limit);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        users,
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords,
          limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        filters: { search: search || null, role: role || null, department_id: department_id || null, includeInactive },
      },
      users.length > 0 ? "Users fetched successfully" : "No users found"
    )
  );
});

// GET SINGLE USER

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { user_id } = req.params;

  if (!user_id) {
    throw new ApiError(400, "User ID is required");
  }

  const pool = getPool();
  const request = pool.request();

  const query = `
    SELECT 
      u.user_id, u.first_name, u.last_name, u.email, u.phone_number,
      u.role, u.department_id, u.sub_department_id, u.is_active,
      u.last_login, u.created_at, u.updated_at,
      d.department_name,
      sd.sub_department_name
    FROM notif_users u
    INNER JOIN notif_departments d ON u.department_id = d.department_id
    LEFT JOIN notif_sub_departments sd ON u.sub_department_id = sd.sub_department_id
    WHERE u.user_id = @user_id
  `;

  const result = await request
    .input("user_id", sql.VarChar(20), user_id)
    .query(query);

  if (!result.recordset || result.recordset.length === 0) {
    throw new ApiError(404, "User not found");
  }

  const user = result.recordset[0];

  // Authorization: non-super-admin can only view users in their department
  if (authUser.role !== "super-admin" && user.department_id !== authUser.department_id) {
    throw new ApiError(403, "Not authorized to view this user");
  }

  res.status(200).json(
    new ApiResponse(200, user, "User fetched successfully")
  );
});

// UPDATE USER

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  if (authUser.role !== "admin" && authUser.role !== "super-admin") {
    throw new ApiError(403, "Only admins can update users");
  }

  const { user_id } = req.params;
  const { first_name, last_name, phone_number, role, department_id, sub_department_id, is_active } = req.body;

  if (!user_id) {
    throw new ApiError(400, "User ID is required");
  }

  const pool = getPool();
  const checkRequest = pool.request();

  const userCheck = await checkRequest
    .input("user_id", sql.VarChar(20), user_id)
    .query("SELECT user_id, department_id, role FROM notif_users WHERE user_id = @user_id");

  if (userCheck.recordset.length === 0) {
    throw new ApiError(404, "User not found");
  }

  const targetUser = userCheck.recordset[0];

  // Authorization: admin can only update users in their department
  if (authUser.role !== "super-admin" && targetUser.department_id !== authUser.department_id) {
    throw new ApiError(403, "Not authorized to update user from another department");
  }

  // Only super-admin can change roles or update super-admin/admin users
  if (role && authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can change user roles");
  }

  if ((targetUser.role === "super-admin" || targetUser.role === "admin") && authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can update admin users");
  }

  const updateRequest = pool.request();
  const updates: string[] = [];

  if (first_name !== undefined) {
    updates.push("first_name = @first_name");
    updateRequest.input("first_name", sql.NVarChar(50), first_name);
  }
  if (last_name !== undefined) {
    updates.push("last_name = @last_name");
    updateRequest.input("last_name", sql.NVarChar(50), last_name);
  }
  if (phone_number !== undefined) {
    updates.push("phone_number = @phone_number");
    updateRequest.input("phone_number", sql.VarChar(20), phone_number || null);
  }
  if (role !== undefined) {
    const validRoles = ["super-admin", "admin", "user"];
    if (!validRoles.includes(role)) {
      throw new ApiError(400, "Invalid role");
    }
    updates.push("role = @role");
    updateRequest.input("role", sql.VarChar(20), role);
  }
  if (department_id !== undefined) {
    updates.push("department_id = @department_id");
    updateRequest.input("department_id", sql.VarChar(20), department_id);
  }
  if (sub_department_id !== undefined) {
    updates.push("sub_department_id = @sub_department_id");
    updateRequest.input("sub_department_id", sql.VarChar(20), sub_department_id || null);
  }
  if (is_active !== undefined) {
    updates.push("is_active = @is_active");
    updateRequest.input("is_active", sql.Bit, is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    throw new ApiError(400, "No fields provided to update");
  }

  updates.push("updated_at = GETDATE()");

  const query = `
    UPDATE notif_users
    SET ${updates.join(", ")}
    WHERE user_id = @user_id;

    SELECT 
      u.user_id, u.first_name, u.last_name, u.email, u.phone_number,
      u.role, u.department_id, u.sub_department_id, u.is_active,
      u.created_at, u.updated_at,
      d.department_name,
      sd.sub_department_name
    FROM notif_users u
    INNER JOIN notif_departments d ON u.department_id = d.department_id
    LEFT JOIN notif_sub_departments sd ON u.sub_department_id = sd.sub_department_id
    WHERE u.user_id = @user_id;
  `;

  const result = await updateRequest
    .input("user_id", sql.VarChar(20), user_id)
    .query(query);

  if (!result.recordset || result.recordset.length === 0) {
    throw new ApiError(500, "Failed to update user");
  }

  res.status(200).json(
    new ApiResponse(200, result.recordset[0], "User updated successfully")
  );
});

// UPDATE MY PROFILE

export const updateMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser?.user_id) throw new ApiError(401, "Unauthorized");

  const { first_name, last_name, phone_number, password } = req.body;

  if (!first_name && !last_name && !phone_number && !password) {
    throw new ApiError(400, "No fields to update");
  }

  // Validate password if provided
  if (password && !validatePassword(password)) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const pool = getPool();
  const request = pool.request();
  const updates: string[] = [];

  if (first_name) {
    updates.push("first_name = @first_name");
    request.input("first_name", sql.NVarChar(50), first_name);
  }
  if (last_name) {
    updates.push("last_name = @last_name");
    request.input("last_name", sql.NVarChar(50), last_name);
  }
  if (phone_number) {
    updates.push("phone_number = @phone_number");
    request.input("phone_number", sql.VarChar(20), phone_number);
  }
  if (password) {
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    updates.push("password_hash = @password_hash");
    request.input("password_hash", sql.NVarChar(255), hashedPassword);
  }

  updates.push("updated_at = GETDATE()");

  const query = `
    UPDATE notif_users
    SET ${updates.join(", ")}
    WHERE user_id = @user_id;

    SELECT 
      u.user_id, u.first_name, u.last_name, u.email, u.phone_number,
      u.role, u.department_id, u.sub_department_id, u.is_active,
      u.created_at, u.updated_at,
      d.department_name,
      sd.sub_department_name
    FROM notif_users u
    INNER JOIN notif_departments d ON u.department_id = d.department_id
    LEFT JOIN notif_sub_departments sd ON u.sub_department_id = sd.sub_department_id
    WHERE u.user_id = @user_id;
  `;

  const result = await request
    .input("user_id", sql.VarChar(20), authUser.user_id)
    .query(query);

  const updated = result.recordset?.[0];

  if (!updated) throw new ApiError(500, "Profile update failed");

  res.status(200).json(
    new ApiResponse(200, updated, "Profile updated successfully")
  );
});

// DELETE USER (Soft Delete)

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  if (authUser.role !== "admin" && authUser.role !== "super-admin") {
    throw new ApiError(403, "Only admins can delete users");
  }

  const { user_id } = req.params;

  if (!user_id) {
    throw new ApiError(400, "User ID is required");
  }

  // Prevent self-deletion
  if (user_id === authUser.user_id) {
    throw new ApiError(400, "Cannot delete your own account");
  }

  const pool = getPool();
  const request = pool.request();

  const userCheck = await request
    .input("user_id", sql.VarChar(20), user_id)
    .query("SELECT user_id, department_id, role FROM notif_users WHERE user_id = @user_id");

  if (userCheck.recordset.length === 0) {
    throw new ApiError(404, "User not found");
  }

  const targetUser = userCheck.recordset[0];

  // Admin can only delete users in their department
  if (authUser.role !== "super-admin" && targetUser.department_id !== authUser.department_id) {
    throw new ApiError(403, "Not authorized to delete user from another department");
  }

  // Only super-admin can delete admin/super-admin users
  if ((targetUser.role === "super-admin" || targetUser.role === "admin") && authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can delete admin users");
  }

  const query = `
    UPDATE notif_users
    SET is_active = 0, updated_at = GETDATE()
    WHERE user_id = @user_id
  `;

  const result = await pool.request()
    .input("user_id", sql.VarChar(20), user_id)
    .query(query);

  if (result.rowsAffected[0] === 0) {
    throw new ApiError(500, "Failed to delete user");
  }

  res.status(200).json(
    new ApiResponse(200, { user_id }, "User deleted successfully")
  );
});

// LOGIN

export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  if (!validateEmail(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  const pool = getPool();
  const request = pool.request();

  const result = await request
    .input("email", sql.NVarChar(255), email)
    .query(`
      SELECT 
        u.user_id, u.first_name, u.last_name, u.email, u.password_hash,
        u.role, u.department_id, u.sub_department_id, u.phone_number,
        u.is_active,
        d.department_name,
        sd.sub_department_name
      FROM notif_users u
      INNER JOIN notif_departments d ON u.department_id = d.department_id
      LEFT JOIN notif_sub_departments sd ON u.sub_department_id = sd.sub_department_id
      WHERE u.email = @email
    `);

  if (!result.recordset || result.recordset.length === 0) {
    throw new ApiError(401, "Invalid email or password");
  }

  const user = result.recordset[0];

  // Check if user is active
  if (!user.is_active) {
    throw new ApiError(403, "Account is deactivated. Contact administrator.");
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid email or password");
  }

  // Update last login
  await pool.request()
    .input("user_id", sql.VarChar(20), user.user_id)
    .query("UPDATE notif_users SET last_login = GETDATE() WHERE user_id = @user_id");

  // Generate JWT token
  const token = jwt.sign(
    {
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      department_id: user.department_id,
      sub_department_id: user.sub_department_id,
      is_active: user.is_active,
    },
    process.env.SECRET_KEY as string,
    { expiresIn: "7d" }
  );

  const isProd = process.env.NODE_ENV === "production";

  // Set cookie
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  // Don't send password hash to client
  const { password_hash, ...userWithoutPassword } = user;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        user: userWithoutPassword,
      },
      "Login successful"
    )
  );
});

// GET PROFILE (Current User)

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) {
    throw new ApiError(401, "Unauthorized");
  }

  const pool = getPool();
  const request = pool.request();

  const result = await request
    .input("user_id", sql.VarChar(20), authUser.user_id)
    .query(`
      SELECT 
        u.user_id, u.first_name, u.last_name, u.email, u.phone_number,
        u.role, u.is_active, u.last_login, u.created_at, u.updated_at,
        u.department_id, u.sub_department_id,
        d.department_name,
        sd.sub_department_name
      FROM notif_users u
      INNER JOIN notif_departments d ON u.department_id = d.department_id
      LEFT JOIN notif_sub_departments sd ON u.sub_department_id = sd.sub_department_id
      WHERE u.user_id = @user_id
    `);

  if (!result.recordset || result.recordset.length === 0) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(
    new ApiResponse(200, result.recordset[0], "Profile fetched successfully")
  );
});

// LOGOUT

export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  const isProd = process.env.NODE_ENV === "production";

  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });

  res.status(200).json(
    new ApiResponse(200, null, "Logout successful")
  );
});
