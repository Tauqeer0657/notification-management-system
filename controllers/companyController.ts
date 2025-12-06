import type { Request, Response } from "express";
import sql from "mssql";
import { getSqlRequest } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Simple validation helper
const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// Api to create company (ONLY SUPER-ADMIN)
export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  // Authorization: Only super-admin can create companies
  if (authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can create companies");
  }

  const {
    company_name,
    address_line,
    city,
    state,
    country,
    pin_code,
    contact_person_name,
    contact_email,
    contact_phone,
  } = req.body;

  // Basic validation
  if (!company_name) {
    throw new ApiError(400, "company_name is required");
  }

  // Validate email if provided
  if (contact_email && !validateEmail(contact_email)) {
    throw new ApiError(400, "Invalid email format");
  }

  const request = getSqlRequest();

  // FIX: Use transaction for atomic ID generation
  const insertQuery = `
    BEGIN TRANSACTION;

    DECLARE @newCompanyId NVARCHAR(20);

    SELECT @newCompanyId = 'C' + RIGHT('000' + CAST(
      ISNULL(MAX(CAST(SUBSTRING(company_id, 2, LEN(company_id)) AS INT)), 0) + 1
      AS VARCHAR), 3)
    FROM tb_asset_companies WITH (TABLOCKX, HOLDLOCK);

    INSERT INTO tb_asset_companies (
      company_id, company_name, address_line, city, state, country, 
      pin_code, contact_person_name, contact_email, contact_phone,
      created_at, updated_at, created_by, updated_by
    ) VALUES (
      @newCompanyId, @company_name, @address_line, @city, @state, @country,
      @pin_code, @contact_person_name, @contact_email, @contact_phone,
      GETDATE(), GETDATE(), @created_by, @updated_by
    );

    COMMIT;

    SELECT @newCompanyId AS company_id;
  `;

  const result = await request
    .input("company_name", sql.NVarChar(150), company_name)
    .input("address_line", sql.NVarChar(255), address_line ?? null)
    .input("city", sql.NVarChar(100), city ?? null)
    .input("state", sql.NVarChar(100), state ?? null)
    .input("country", sql.NVarChar(100), country ?? null)
    .input("pin_code", sql.NVarChar(10), pin_code ?? null)
    .input("contact_person_name", sql.NVarChar(150), contact_person_name ?? null)
    .input("contact_email", sql.NVarChar(150), contact_email ?? null)
    .input("contact_phone", sql.NVarChar(50), contact_phone ?? null)
    .input("created_by", sql.NVarChar(20), authUser.user_id)
    .input("updated_by", sql.NVarChar(20), authUser.user_id)
    .query(insertQuery);

  const newCompanyId = result.recordset[0]?.company_id;

  res.status(201).json(
    new ApiResponse(201, { company_id: newCompanyId }, "Company created successfully")
  );
});

// Api to get all companies (with pagination and search)
export const getCompanies = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  // Extract pagination and search parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = (req.query.search as string) || "";

  const offset = (page - 1) * limit;

  // Validate pagination
  if (page < 1 || limit < 1 || limit > 100) {
    throw new ApiError(400, "Invalid pagination parameters");
  }

  const request = getSqlRequest();

  // Build WHERE clause conditions
  const whereConditions: string[] = [];

  // ✅ FIX: SQL injection vulnerability fixed - use parameterized query
  if (authUser.role !== "super-admin") {
    whereConditions.push("company_id = @company_id");
    request.input("company_id", sql.NVarChar(20), authUser.company_id);
  }

  if (search && search.trim()) {
    whereConditions.push(`(
      company_id LIKE @search OR 
      company_name LIKE @search OR 
      address_line LIKE @search OR
      city LIKE @search OR
      state LIKE @search OR
      country LIKE @search OR
      contact_person_name LIKE @search OR
      contact_email LIKE @search OR
      contact_phone LIKE @search
    )`);
    request.input("search", sql.NVarChar, `%${search.trim()}%`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  // Main query with pagination
  const dataQuery = `
    SELECT 
      company_id, company_name, address_line, city, state, country,
      pin_code, contact_person_name, contact_email, contact_phone,
      created_at, updated_at, created_by, updated_by
    FROM tb_asset_companies
    ${whereClause}
    ORDER BY created_at DESC
    OFFSET @offset ROWS
    FETCH NEXT @limit ROWS ONLY;
  `;

  // Count query for total records
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM tb_asset_companies
    ${whereClause};
  `;

  // Add pagination parameters
  request.input("offset", sql.Int, offset);
  request.input("limit", sql.Int, limit);

  // Execute both queries
  const [dataResult, countResult] = await Promise.all([
    request.query(dataQuery),
    getSqlRequest()
      .input("company_id", authUser.role !== "super-admin" ? sql.NVarChar(20) : null, authUser.role !== "super-admin" ? authUser.company_id : null)
      .input("search", sql.NVarChar, search ? `%${search.trim()}%` : null)
      .query(countQuery),
  ]);

  const companies = dataResult.recordset || [];
  const totalRecords = countResult.recordset[0]?.total || 0;
  const totalPages = Math.ceil(totalRecords / limit);

  const response = {
    companies,
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
    },
  };

  res.status(200).json(
    new ApiResponse(
      200,
      response,
      companies.length > 0 ? "Companies fetched successfully" : "No companies found"
    )
  );
});

// Api to update company
export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { company_id } = req.params;

  // Authorization
  if (authUser.role !== "super-admin" && company_id !== authUser.company_id) {
    throw new ApiError(403, "Not authorized to update this company");
  }

  const {
    company_name,
    address_line,
    city,
    state,
    country,
    pin_code,
    contact_person_name,
    contact_email,
    contact_phone,
  } = req.body;

  if (!company_id) {
    throw new ApiError(400, "company_id is required");
  }

  // Validate email if provided
  if (contact_email && !validateEmail(contact_email)) {
    throw new ApiError(400, "Invalid email format");
  }

  const request = getSqlRequest();
  const updates: string[] = [];

  // ✅ FIX: Properly typed SQL parameters
  if (company_name !== undefined) {
    updates.push("company_name = @company_name");
    request.input("company_name", sql.NVarChar(150), company_name);
  }
  if (address_line !== undefined) {
    updates.push("address_line = @address_line");
    request.input("address_line", sql.NVarChar(255), address_line);
  }
  if (city !== undefined) {
    updates.push("city = @city");
    request.input("city", sql.NVarChar(100), city);
  }
  if (state !== undefined) {
    updates.push("state = @state");
    request.input("state", sql.NVarChar(100), state);
  }
  if (country !== undefined) {
    updates.push("country = @country");
    request.input("country", sql.NVarChar(100), country);
  }
  if (pin_code !== undefined) {
    updates.push("pin_code = @pin_code");
    request.input("pin_code", sql.NVarChar(10), pin_code);
  }
  if (contact_person_name !== undefined) {
    updates.push("contact_person_name = @contact_person_name");
    request.input("contact_person_name", sql.NVarChar(150), contact_person_name);
  }
  if (contact_email !== undefined) {
    updates.push("contact_email = @contact_email");
    request.input("contact_email", sql.NVarChar(150), contact_email);
  }
  if (contact_phone !== undefined) {
    updates.push("contact_phone = @contact_phone");
    request.input("contact_phone", sql.NVarChar(50), contact_phone);
  }

  if (updates.length === 0) {
    throw new ApiError(400, "No fields provided for update");
  }

  updates.push("updated_at = GETDATE()");
  updates.push("updated_by = @updated_by");
  request.input("updated_by", sql.NVarChar(20), authUser.user_id);

  const query = `
    UPDATE tb_asset_companies
    SET ${updates.join(", ")}
    WHERE company_id = @company_id
  `;

  const result = await request
    .input("company_id", sql.NVarChar(20), company_id)
    .query(query);

  if (result.rowsAffected[0] === 0) {
    throw new ApiError(404, "Company not found");
  }

  res.status(200).json(
    new ApiResponse(200, { company_id }, "Company updated successfully")
  );
});

// DELETE: Hard delete company (no soft delete in your schema)
export const deleteCompany = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) throw new ApiError(401, "Unauthorized");

  const { company_id } = req.params;

  if (authUser.role !== "super-admin") {
    throw new ApiError(403, "Only super-admin can delete companies");
  }

  const request = getSqlRequest();
  
  // Since there's no is_active field, this is a HARD DELETE
  const query = `
    DELETE FROM tb_asset_companies
    WHERE company_id = @company_id
  `;

  const result = await request
    .input("company_id", sql.NVarChar(20), company_id)
    .query(query);

  if (result.rowsAffected[0] === 0) {
    throw new ApiError(404, "Company not found");
  }

  res.status(200).json(
    new ApiResponse(200, { company_id }, "Company deleted successfully")
  );
});
