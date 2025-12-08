import type { Request, Response } from "express";
import sql from "mssql";
import bcrypt from "bcryptjs";
import { getPool } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateEmail, validatePassword } from "../utils/validators.js";

export const setupInitialData = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      department_name,
      admin_email,
      admin_password,
      admin_first_name,
      admin_last_name,
      admin_phone,
    } = req.body;

    // Validation
    if (!department_name || !admin_email || !admin_password || !admin_first_name || !admin_last_name) {
      throw new ApiError(
        400,
        "Missing required fields: department_name, admin_email, admin_password, admin_first_name, admin_last_name"
      );
    }

    if (!validateEmail(admin_email)) {
      throw new ApiError(400, "Invalid email format");
    }

    if (!validatePassword(admin_password)) {
      throw new ApiError(400, "Password must be at least 8 characters");
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();
      const request = new sql.Request(transaction);

      // Check if system is already initialized
      const setupCheck = await request.query(`
        SELECT COUNT(*) as count FROM notif_departments
      `);

      if (setupCheck.recordset[0].count > 0) {
        throw new ApiError(403, "System already initialized. Setup endpoint disabled.");
      }

      // Step 1: Create default department with DEPT001 ID
      const deptResult = await request
        .input("dept_id", sql.VarChar(20), "DEPT001")
        .input("dept_name", sql.NVarChar(100), department_name)
        .query(`
          INSERT INTO notif_departments (
            department_id, department_name, description, is_active, 
            created_at, updated_at, created_by
          )
          OUTPUT INSERTED.department_id, INSERTED.department_name
          VALUES (
            @dept_id, @dept_name, 'Primary Department', 1, 
            GETDATE(), GETDATE(), NULL
          )
        `);

      const departmentId = deptResult.recordset[0]?.department_id;

      // Step 2: Hash Password
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(admin_password, salt);

      // Step 3: Create Super Admin User with U001 ID
      const userRequest = new sql.Request(transaction); 
      const userResult = await userRequest
        .input("user_id", sql.VarChar(20), "U001")
        .input("first_name", sql.NVarChar(50), admin_first_name)
        .input("last_name", sql.NVarChar(50), admin_last_name)
        .input("email", sql.NVarChar(255), admin_email)
        .input("password_hash", sql.NVarChar(255), hashedPassword)
        .input("phone", sql.VarChar(20), admin_phone || null)
        .input("user_dept_id", sql.VarChar(20), departmentId) 
        .query(`
          INSERT INTO notif_users (
            user_id, first_name, last_name, email, password_hash,
            department_id, sub_department_id, role, phone_number,
            is_active, created_at, updated_at
          )
          OUTPUT INSERTED.user_id, INSERTED.email, INSERTED.role
          VALUES (
            @user_id, @first_name, @last_name, @email, @password_hash,
            @user_dept_id, NULL, 'super-admin', @phone,
            1, GETDATE(), GETDATE()
          )
        `);

      const userId = userResult.recordset[0]?.user_id;
      const userEmail = userResult.recordset[0]?.email;

      await transaction.commit();

      res.status(201).json(
        new ApiResponse(
          201,
          {
            department_id: departmentId,
            department_name: department_name,
            user_id: userId,
            email: userEmail,
            role: "super-admin",
          },
          "System initialized successfully. Setup endpoint is now disabled."
        )
      );
    } catch (error: any) {
      await transaction.rollback();
      throw error;
    }
  }
);
