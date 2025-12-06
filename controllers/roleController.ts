import type { Request, Response } from "express";
import sql from "mssql";
import { getSqlRequest } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Api to create role (ONLY SUPER-ADMIN)
export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  // Authorization: Only super-admin can create roles
  if (authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can create roles");
  }

  const { company_id, role } = req.body;

  // Basic validation
  if (!company_id || !role) {
    throw new ApiError(400, "Missing required fields: company_id, role");
  }

  if (typeof role !== "string" || role.trim().length === 0) {
    throw new ApiError(400, "Role must be a non-empty string");
  }

  const request = getSqlRequest();

  // Check if company exists
  const companyCheck = await request
    .input("company_id_check", sql.NVarChar(20), company_id)
    .query("SELECT company_id FROM tb_asset_companies WHERE company_id = @company_id_check");

  if (companyCheck.recordset.length === 0) {
    throw new ApiError(404, "Company not found");
  }

  // FIX: Use transaction for atomic ID generation
  const insertQuery = `
    BEGIN TRANSACTION;

    DECLARE @newRoleId NVARCHAR(20);

    SELECT @newRoleId = 'R' + RIGHT('000' + CAST(
      ISNULL(MAX(CAST(SUBSTRING(role_id, 2, LEN(role_id)) AS INT)), 0) + 1
      AS VARCHAR), 3)
    FROM tb_asset_roles WITH (TABLOCKX, HOLDLOCK);

    INSERT INTO tb_asset_roles (role_id, company_id, role)
    VALUES (@newRoleId, @company_id, @role);

    COMMIT;

    SELECT @newRoleId AS role_id;
  `;

  const result = await getSqlRequest()
    .input("company_id", sql.NVarChar(20), company_id)
    .input("role", sql.NVarChar(100), role.trim())
    .query(insertQuery);

  const newRoleId = result.recordset[0]?.role_id;

  res.status(201).json(
    new ApiResponse(201, { role_id: newRoleId }, "Role created successfully")
  );
});

// Api to get roles (Company-scoped unless super-admin)
export const getRoles = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const request = getSqlRequest();

  let query = `
    SELECT 
      r.role_id, 
      r.company_id, 
      c.company_name,
      r.role
    FROM tb_asset_roles r
    INNER JOIN tb_asset_companies c ON r.company_id = c.company_id
  `;

  // FIX: SQL injection vulnerability fixed - use parameterized query
  if (authUser.role !== "super-admin") {
    query += ` WHERE r.company_id = @company_id`;
    request.input("company_id", sql.NVarChar(20), authUser.company_id);
  }

  query += ` ORDER BY r.role_id`;

  const result = await request.query(query);

  if (!result.recordset || result.recordset.length === 0) {
    throw new ApiError(404, "No roles found");
  }

  res.status(200).json(
    new ApiResponse(200, result.recordset, "Roles fetched successfully")
  );
});

// Api to update role
export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { role_id } = req.params;
  const { role, company_id } = req.body;

  // Authorization: Only super-admin can update roles
  if (authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can update roles");
  }

  if (!role_id) {
    throw new ApiError(400, "role_id is required");
  }

  // Ensure at least one field to update
  if (!role && !company_id) {
    throw new ApiError(400, "No fields provided for update");
  }

  const request = getSqlRequest();

  // Check if role exists
  const roleCheck = await request
    .input("role_id_check", sql.NVarChar(20), role_id)
    .query("SELECT role_id FROM tb_asset_roles WHERE role_id = @role_id_check");

  if (roleCheck.recordset.length === 0) {
    throw new ApiError(404, "Role not found");
  }

  // If company_id is being updated, verify it exists
  if (company_id) {
    const companyCheck = await getSqlRequest()
      .input("company_id_check", sql.NVarChar(20), company_id)
      .query("SELECT company_id FROM tb_asset_companies WHERE company_id = @company_id_check");

    if (companyCheck.recordset.length === 0) {
      throw new ApiError(404, "Company not found");
    }
  }

  // Build dynamic update query
  const updateRequest = getSqlRequest();
  const updates: string[] = [];

  if (role !== undefined) {
    updates.push("role = @role");
    updateRequest.input("role", sql.NVarChar(100), role.trim());
  }

  if (company_id !== undefined) {
    updates.push("company_id = @company_id");
    updateRequest.input("company_id", sql.NVarChar(20), company_id);
  }

  const updateQuery = `
    UPDATE tb_asset_roles
    SET ${updates.join(", ")}
    WHERE role_id = @role_id;

    SELECT 
      r.role_id, 
      r.company_id, 
      c.company_name,
      r.role
    FROM tb_asset_roles r
    INNER JOIN tb_asset_companies c ON r.company_id = c.company_id
    WHERE r.role_id = @role_id;
  `;

  const result = await updateRequest
    .input("role_id", sql.NVarChar(20), role_id)
    .query(updateQuery);

  res.status(200).json(
    new ApiResponse(200, result.recordset[0], "Role updated successfully")
  );
});

// Api to delete role 
export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { role_id } = req.params;

  // Authorization: Only super-admin can delete roles
  if (authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can delete roles");
  }

  if (!role_id) {
    throw new ApiError(400, "role_id is required");
  }

  const request = getSqlRequest();

  // Check if role exists
  const roleCheck = await request
    .input("role_id_check", sql.NVarChar(20), role_id)
    .query("SELECT role_id FROM tb_asset_roles WHERE role_id = @role_id_check");

  if (roleCheck.recordset.length === 0) {
    throw new ApiError(404, "Role not found");
  }

  // Check if role is being used by any users
  const usageCheck = await getSqlRequest()
    .input("role_id_usage", sql.NVarChar(20), role_id)
    .query("SELECT COUNT(*) as count FROM tb_asset_users WHERE role_id = @role_id_usage");

  if (usageCheck.recordset[0].count > 0) {
    throw new ApiError(
      409,
      `Cannot delete role. It is assigned to ${usageCheck.recordset[0].count} user(s)`
    );
  }

  // Hard delete (no is_active field in schema)
  const deleteQuery = `DELETE FROM tb_asset_roles WHERE role_id = @role_id`;

  const result = await getSqlRequest()
    .input("role_id", sql.NVarChar(20), role_id)
    .query(deleteQuery);

  if (result.rowsAffected[0] === 0) {
    throw new ApiError(500, "Failed to delete role");
  }

  res.status(200).json(
    new ApiResponse(200, { role_id }, "Role deleted successfully")
  );
});
