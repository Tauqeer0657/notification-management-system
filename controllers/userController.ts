import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import sql from "mssql";
import { getSqlRequest } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Simple validation helper
const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const validatePassword = (password: string): boolean => {
  return password.length >= 8;
};

// Api to create a user
export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user; 
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { company_id: incomingCompanyId, full_name, email, password, phone, role_id } = req.body;

  // Basic validation
  if (!incomingCompanyId || !full_name || !email || !password || !phone || !role_id) {
    throw new ApiError(400, "Missing required fields");
  }

  if (!validateEmail(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  if (!validatePassword(password)) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  // Authorization
  let targetCompanyId = authUser.company_id;
  if (authUser.role === "super-admin" && incomingCompanyId) {
    targetCompanyId = incomingCompanyId;
  }
  if (authUser.role !== "super-admin" && incomingCompanyId !== authUser.company_id) {
    throw new ApiError(403, "Not authorized to create user for another company");
  }

  const request = getSqlRequest();

  const emailCheck = await request
    .input("email", sql.NVarChar(150), email)
    .query("SELECT user_id FROM tb_asset_users WHERE email = @email");

  if (emailCheck.recordset.length > 0) {
    throw new ApiError(409, "Email already exists");
  }

  // Hash password with stronger rounds
  const salt = await bcrypt.genSalt(12); 
  const hashedPassword = await bcrypt.hash(password, salt);

  const insertQuery = `
    BEGIN TRANSACTION;

    DECLARE @newUserId NVARCHAR(20);

    SELECT @newUserId = 'U' + RIGHT('000' + CAST(
      ISNULL(MAX(CAST(SUBSTRING(user_id, 2, LEN(user_id)) AS INT)), 0) + 1
      AS VARCHAR), 3)
    FROM tb_asset_users WITH (TABLOCKX, HOLDLOCK);

    INSERT INTO tb_asset_users (
      user_id, company_id, full_name, email, password_hash, phone, role_id, 
      is_active, created_at, updated_at, created_by, updated_by
    )
    VALUES (
      @newUserId, @company_id, @full_name, @email, @password_hash, @phone, 
      @role_id, @is_active, GETDATE(), GETDATE(), @created_by, @updated_by
    );

    COMMIT;

    SELECT @newUserId AS user_id;
  `;

  const result = await request
    .input("company_id", sql.NVarChar(20), targetCompanyId)
    .input("full_name", sql.NVarChar(150), full_name)
    .input("email", sql.NVarChar(150), email)
    .input("password_hash", sql.NVarChar(255), hashedPassword)
    .input("phone", sql.NVarChar(50), phone)
    .input("role_id", sql.NVarChar(20), role_id)
    .input("is_active", sql.NVarChar(10), "true")
    .input("created_by", sql.NVarChar(20), authUser.user_id)
    .input("updated_by", sql.NVarChar(20), authUser.user_id)
    .query(insertQuery);

  const newUserId = result.recordset[0]?.user_id;

  res.status(201).json(
    new ApiResponse(201, { user_id: newUserId }, "User created successfully")
  );
});

// Api to get all users
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const request = getSqlRequest();

  // ✅ FIX: SQL injection vulnerability fixed
  let query = `
    SELECT 
      u.user_id, u.company_id, c.company_name, u.full_name, 
      u.email, u.phone, u.role_id, r.role, u.department, 
      u.designation, u.is_active, u.last_login_at, u.created_at, u.updated_at 
    FROM tb_asset_users u
    INNER JOIN tb_asset_companies c ON u.company_id = c.company_id
    INNER JOIN tb_asset_roles r ON u.role_id = r.role_id
  `;

  // ✅ FIX: Use parameterized query instead of string concatenation
  if (authUser.role !== "super-admin") {
    query += ` WHERE u.company_id = @company_id`;
    request.input("company_id", sql.NVarChar(20), authUser.company_id);
  }

  query += ` ORDER BY u.created_at DESC`;

  const result = await request.query(query);

  if (!result.recordset || result.recordset.length === 0) {
    throw new ApiError(404, "No users found");
  }

  res.status(200).json(
    new ApiResponse(200, result.recordset, "Users fetched successfully")
  );
});

// Api to update a user
export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { user_id } = req.params;
  const { full_name, phone, role_id, department, designation, is_active } = req.body;

  if (!user_id) {
    throw new ApiError(400, "User ID is required");
  }

  const checkRequest = getSqlRequest();
  const userCheck = await checkRequest
    .input("user_id", sql.NVarChar(20), user_id)
    .query("SELECT company_id FROM tb_asset_users WHERE user_id = @user_id");

  if (userCheck.recordset.length === 0) {
    throw new ApiError(404, "User not found");
  }

  const targetCompanyId = userCheck.recordset[0].company_id;

  if (authUser.role !== "super-admin" && targetCompanyId !== authUser.company_id) {
    throw new ApiError(403, "Not authorized to update user from another company");
  }

  const updateRequest = getSqlRequest();
  const updates: string[] = [];

  // ✅ FIX: Properly typed SQL parameters
  if (full_name !== undefined) {
    updates.push("full_name = @full_name");
    updateRequest.input("full_name", sql.NVarChar(150), full_name);
  }
  if (phone !== undefined) {
    updates.push("phone = @phone");
    updateRequest.input("phone", sql.NVarChar(50), phone);
  }
  if (role_id !== undefined) {
    updates.push("role_id = @role_id");
    updateRequest.input("role_id", sql.NVarChar(20), role_id);
  }
  if (department !== undefined) {
    updates.push("department = @department");
    updateRequest.input("department", sql.NVarChar(100), department);
  }
  if (designation !== undefined) {
    updates.push("designation = @designation");
    updateRequest.input("designation", sql.NVarChar(100), designation);
  }
  if (is_active !== undefined) {
    updates.push("is_active = @is_active");
    updateRequest.input("is_active", sql.NVarChar(10), is_active);
  }

  if (updates.length === 0) {
    throw new ApiError(400, "No fields provided to update");
  }

  updates.push("updated_at = GETDATE()");
  updates.push("updated_by = @updated_by");
  updateRequest.input("updated_by", sql.NVarChar(20), authUser.user_id);

  const query = `
    UPDATE tb_asset_users
    SET ${updates.join(", ")}
    WHERE user_id = @user_id
  `;

  const result = await updateRequest
    .input("user_id", sql.NVarChar(20), user_id)
    .query(query);

  if (result.rowsAffected[0] === 0) {
    throw new ApiError(500, "Failed to update user");
  }

  res.status(200).json(
    new ApiResponse(200, { user_id }, "User updated successfully")
  );
});

// Api to update my profile
export const updateMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser?.user_id) throw new ApiError(401, "Unauthorized");

  const { full_name, phone, password, department, designation } = req.body;
  
  if (!full_name && !phone && !password && !department && !designation) {
    throw new ApiError(400, "No fields to update");
  }

  // Validate password if provided
  if (password && !validatePassword(password)) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const request = getSqlRequest();
  const updates: string[] = [];

  if (full_name) {
    updates.push("full_name = @full_name");
    request.input("full_name", sql.NVarChar(150), full_name);
  }
  if (phone) {
    updates.push("phone = @phone");
    request.input("phone", sql.NVarChar(50), phone);
  }
  if (department) {
    updates.push("department = @department");
    request.input("department", sql.NVarChar(100), department);
  }
  if (designation) {
    updates.push("designation = @designation");
    request.input("designation", sql.NVarChar(100), designation);
  }
  if (password) {
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    updates.push("password_hash = @password_hash");
    request.input("password_hash", sql.NVarChar(255), hashedPassword);
  }

  updates.push("updated_at = GETDATE()");

  const query = `
    UPDATE tb_asset_users
    SET ${updates.join(", ")}
    WHERE user_id = @user_id;

    SELECT user_id, company_id, full_name, email, phone, role_id, 
           department, designation, is_active, created_at, updated_at
    FROM tb_asset_users
    WHERE user_id = @user_id;
  `;

  const result = await request
    .input("user_id", sql.NVarChar(20), authUser.user_id)
    .query(query);

  const updated = result.recordset?.[0];

  if (!updated) throw new ApiError(500, "Profile update failed");

  res.status(200).json(
    new ApiResponse(200, updated, "Profile updated successfully")
  );
});

// Api to delete user (soft delete)
export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { user_id } = req.params;

  if (!user_id) {
    throw new ApiError(400, "User ID is required");
  }

  const request = getSqlRequest();

  const userCheck = await request
    .input("user_id", sql.NVarChar(20), user_id)
    .query("SELECT company_id FROM tb_asset_users WHERE user_id = @user_id");

  if (userCheck.recordset.length === 0) {
    throw new ApiError(404, "User not found");
  }

  const targetCompanyId = userCheck.recordset[0].company_id;

  if (authUser.role !== "super-admin" && targetCompanyId !== authUser.company_id) {
    throw new ApiError(403, "Not authorized to delete user from another company");
  }

  const query = `
    UPDATE tb_asset_users
    SET is_active = @is_active, updated_at = GETDATE(), updated_by = @updated_by
    WHERE user_id = @user_id
  `;

  const result = await request
    .input("user_id", sql.NVarChar(20), user_id)
    .input("is_active", sql.NVarChar(10), "false")
    .input("updated_by", sql.NVarChar(20), authUser.user_id)
    .query(query);

  if (result.rowsAffected[0] === 0) {
    throw new ApiError(500, "Failed to delete user");
  }

  res.status(200).json(
    new ApiResponse(200, { user_id }, "User deleted successfully")
  );
});

// Api to login
export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  if (!validateEmail(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  const request = getSqlRequest();
  const result = await request
    .input("email", sql.NVarChar(150), email)
    .query(`
      SELECT 
        u.user_id, u.full_name, u.email, u.password_hash,
        u.role_id, r.role, u.company_id, c.company_name, u.is_active
      FROM tb_asset_users u
      JOIN tb_asset_companies c ON u.company_id = c.company_id
      JOIN tb_asset_roles r ON u.role_id = r.role_id
      WHERE u.email = @email;
    `);

  if (!result.recordset || result.recordset.length === 0) {
    throw new ApiError(401, "Invalid credentials");
  }

  const user = result.recordset[0];

  // ✅ Check if user is active
  if (user.is_active !== "true") {
    throw new ApiError(403, "Account is deactivated");
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new ApiError(401, "Invalid credentials");
  }

  // ✅ Update last login
  await request
    .input("user_id", sql.NVarChar(20), user.user_id)
    .query("UPDATE tb_asset_users SET last_login_at = GETDATE() WHERE user_id = @user_id");

  const token = jwt.sign(
    {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role_id: user.role_id,
      role: user.role,
      company_id: user.company_id,
      company_name: user.company_name,
    },
    process.env.SECRET_KEY as string,
    { expiresIn: "7d" }
  );

  const isProd = process.env.NODE_ENV === "production";

  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // ✅ Don't send password hash to client
  const { password_hash, ...userWithoutPassword } = user;

  res.status(200).json(
    new ApiResponse(200, { token, user: userWithoutPassword }, "Login successful")
  );
});

// Api to get profile
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    throw new ApiError(401, "Unauthorized");
  }
  res.status(200).json(
    new ApiResponse(200, user, "User profile fetched successfully")
  );
});

// Api to logout
export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  const isProd = process.env.NODE_ENV === "production";

  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });

  res.status(200).json(
    new ApiResponse(200, {}, "Logout successful")
  );
});
