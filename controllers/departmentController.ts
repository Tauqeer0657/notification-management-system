// import { Request, Response } from "express";
// import { getSqlRequest } from "../db/connection.js";
// import { asyncHandler } from "../utils/asyncHandler.js";
// import { ApiError } from "../utils/ApiError.js";
// import { ApiResponse } from "../utils/ApiResponse.js";

// // create department with multiple sub-departments
// export const addDepartment = asyncHandler(
//   async (req: Request, res: Response) => {
//     try {
//       const {
//         department_name,
//         description,
//         created_by,
//         sub_departments, // expect array of objects
//       } = req.body;

//       if (!department_name) {
//         return res.status(400).json({ message: "Department name is required" });
//       }

//       // Create request for department
//       const requestDept = await getSqlRequest();

//       const deptResult = await requestDept
//         .input("department_name", department_name)
//         .input("description", description)
//         .input("created_by", created_by || null).query(`
//         INSERT INTO notif_departments 
//         (department_name, description, is_active, created_at, created_by)
//         OUTPUT INSERTED.department_id
//         VALUES (@department_name, @description, 1, GETDATE(), @created_by)
//       `);

//       const departmentId = deptResult.recordset[0].department_id;

//       let insertedSubDepartments: any[] = [];

//       if (Array.isArray(sub_departments) && sub_departments.length > 0) {
//         for (const sub of sub_departments) {
//           if (!sub.sub_department_name) continue;

//           const requestSub = await getSqlRequest();
//           const subResult = await requestSub
//             .input("department_id", departmentId)
//             .input("sub_department_name", sub.sub_department_name)
//             .input("description", sub.sub_description || null)
//             .input("created_by", created_by || null).query(`
//             INSERT INTO notif_sub_departments
//             (department_id, sub_department_name, description, is_active, created_at, created_by)
//             OUTPUT INSERTED.sub_department_id
//             VALUES (@department_id, @sub_department_name, @description, 1, GETDATE(), @created_by)
//           `);

//           insertedSubDepartments.push(subResult.recordset[0]);
//         }
//       }

//       return res.status(201).json({
//         message: "Department created successfully",
//         department_id: departmentId,
//         sub_departments: insertedSubDepartments,
//       });
//     } catch (error) {
//       console.error("Error creating department:", error);
//       return res.status(500).json({ message: "Server error" });
//     }
//   }
// );

// //get all departments along with sub departments
// export const getDepartments = asyncHandler(
//   async (req: Request, res: Response) => {
//     try {
//       const request = await getSqlRequest();

//       const result = await request.query(`
//         SELECT 
//           d.department_id,
//           d.department_name,
//           d.description AS department_description,
//           d.is_active AS department_active,
//           d.created_at AS department_created_at,

//           sd.sub_department_id,
//           sd.sub_department_name,
//           sd.description AS sub_department_description,
//           sd.is_active AS sub_department_active,
//           sd.created_at AS sub_department_created_at

//         FROM notif_departments d
//         LEFT JOIN notif_sub_departments sd 
//           ON d.department_id = sd.department_id
//         ORDER BY d.created_at DESC, sd.created_at DESC
//       `);

//       const departments: any[] = [];

//       result.recordset.forEach((row: any) => {
//         let department = departments.find(
//           (d) => d.department_id === row.department_id
//         );

//         if (!department) {
//           department = {
//             department_id: row.department_id,
//             department_name: row.department_name,
//             description: row.department_description,
//             is_active: row.department_active,
//             created_at: row.department_created_at,
//             sub_departments: [],
//           };
//           departments.push(department);
//         }

//         if (row.sub_department_id) {
//           department.sub_departments.push({
//             sub_department_id: row.sub_department_id,
//             sub_department_name: row.sub_department_name,
//             description: row.sub_department_description,
//             is_active: row.sub_department_active,
//             created_at: row.sub_department_created_at,
//           });
//         }
//       });

//       res.status(200).json({
//         message: "Departments fetched successfully",
//         data: departments,
//       });
//     } catch (error) {
//       console.error("Error fetching departments:", error);
//       res.status(500).json({ message: "Server error" });
//     }
//   }
// );

// export const updateDepartmentName = asyncHandler(
//   async (req: Request, res: Response) => {
//     const { id } = req.params;
//     const { department_name } = req.body;
//     try {
//       const { id } = req.params;
//       const { department_name } = req.body;

//       if (!department_name) {
//         return new ApiError(400,"Department name is required" )
//       }

//       const request = await getSqlRequest();

//       const updateResult = await request
//         .input("department_id", id)
//         .input("department_name", department_name).query(`
//           UPDATE notif_departments
//           SET department_name = @department_name,
//               updated_at = GETDATE()
//           WHERE department_id = @department_id;
//         `);

//       if (updateResult.rowsAffected[0] === 0) {
//         return res.status(404).json({ message: "Department not found" });
//       }

//       res.status(200).json({ message: "Department name updated successfully" });
//     } catch (error) {
//       console.error("Error updating department name:", error);
//       res.status(500).json({ message: "Server error" });
//     }
//   }
// );

// export const getDepartmentsStats = asyncHandler(
//   async (req: Request, res: Response) => {
//     try {
//       const request = await getSqlRequest();

//       // Total departments
//       const deptCount = await request.query(`
//       SELECT COUNT(*) AS total_departments 
//       FROM notif_departments 
//       WHERE is_active = 1
//     `);
//       const totalDepartments = deptCount.recordset[0].total_departments;

//       // Total sub-departments
//       const subDeptCount = await request.query(`
//       SELECT COUNT(*) AS total_sub_departments 
//       FROM notif_sub_departments 
//       WHERE is_active = 1
//     `);
//       const totalSubDepartments =
//         subDeptCount.recordset[0].total_sub_departments;

//       // Total active users
//       const userCount = await request.query(`
//       SELECT COUNT(*) AS total_users
//       FROM tb_asset_users
//       WHERE is_active = 'true'
//     `);
//       const totalUsers = userCount.recordset[0].total_users;

//       // Departments with their sub-departments
//       const hierarchy = await request.query(`
//       SELECT 
//         d.department_id, d.department_name,
//         sd.sub_department_id, sd.sub_department_name
//       FROM notif_departments d
//       LEFT JOIN notif_sub_departments sd
//       ON d.department_id = sd.department_id
//       WHERE d.is_active = 1
//       ORDER BY d.department_name
//     `);

//       const structured: any = {};
//       hierarchy.recordset.forEach((row : any) => {
//         if (!structured[row.department_id]) {
//           structured[row.department_id] = {
//             department_id: row.department_id,
//             department_name: row.department_name,
//             sub_departments: [],
//           };
//         }

//         if (row.sub_department_id) {
//           structured[row.department_id].sub_departments.push({
//             sub_department_id: row.sub_department_id,
//             sub_department_name: row.sub_department_name,
//           });
//         }
//       });

//       const departmentsData = Object.values(structured);
//       res.status(200).json(
//         new ApiResponse(
//           200,
//           {
//             total_departments: totalDepartments,
//             total_sub_departments: totalSubDepartments,
//             total_users: totalUsers,
//             departments: departmentsData,
//           },
//           "Department status fetched succesfully "
//         )
//       );
//     } catch (error) {
//       console.error("Error fetching department stats:", error);
//       res.status(500).json(new ApiResponse(500, {}, "Server Error "));
//     }
//   }
// );

import type { Request, Response } from "express";
import sql from "mssql";
import { getPool } from "../db/connection.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Validation helper
const validateDepartmentName = (name: string): boolean => {
  return !!(name && name.trim().length > 0 && name.length <= 100);
};

// CREATE DEPARTMENT (with sub-departments)

export const addDepartment = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    // Only admin/super-admin can create departments
    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can create departments");
    }

    const { department_name, description, sub_departments } = req.body;

    // Validation
    if (!department_name || !validateDepartmentName(department_name)) {
      throw new ApiError(400, "Valid department name is required (max 100 chars)");
    }

    if (description && description.length > 500) {
      throw new ApiError(400, "Description too long (max 500 chars)");
    }

    // Validate sub-departments if provided
    if (sub_departments) {
      if (!Array.isArray(sub_departments)) {
        throw new ApiError(400, "sub_departments must be an array");
      }

      for (const sub of sub_departments) {
        if (!sub.sub_department_name || !validateDepartmentName(sub.sub_department_name)) {
          throw new ApiError(400, "Each sub-department must have a valid name");
        }
      }
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();
      const request = new sql.Request(transaction);

      // Generate department code (DEPT001, DEPT002, etc.)
      const codeResult = await request.query(`
        SELECT 'DEPT' + RIGHT('000' + CAST(
          ISNULL(MAX(CAST(SUBSTRING(department_id, 5, LEN(department_id)) AS INT)), 0) + 1
          AS VARCHAR), 3) AS new_code
        FROM notif_departments WITH (TABLOCKX, HOLDLOCK);
      `);

      const departmentCode = codeResult.recordset[0]?.new_code;

      // Insert department
      const deptRequest = new sql.Request(transaction);
      const deptResult = await deptRequest
        .input("dept_id", sql.VarChar(20), departmentCode)
        .input("dept_name", sql.NVarChar(100), department_name.trim())
        .input("description", sql.NVarChar(500), description?.trim() || null)
        .input("created_by", sql.VarChar(20), authUser.user_id)
        .query(`
          INSERT INTO notif_departments (
            department_id, department_name, description, is_active, 
            created_at, updated_at, created_by
          )
          OUTPUT INSERTED.department_id, INSERTED.department_name
          VALUES (
            @dept_id, @dept_name, @description, 1, 
            GETDATE(), GETDATE(), @created_by
          )
        `);

      const departmentId = deptResult.recordset[0]?.department_id;
      const insertedSubDepartments: any[] = [];

      // Insert sub-departments if provided
      if (Array.isArray(sub_departments) && sub_departments.length > 0) {
        for (const sub of sub_departments) {
          if (!sub.sub_department_name) continue;

          const subRequest = new sql.Request(transaction);

          // Generate sub-department code
          const subCodeResult = await subRequest.query(`
            SELECT 'SDEPT' + RIGHT('000' + CAST(
              ISNULL(MAX(CAST(SUBSTRING(sub_department_id, 6, LEN(sub_department_id)) AS INT)), 0) + 1
              AS VARCHAR), 3) AS new_sub_code
            FROM notif_sub_departments WITH (TABLOCKX, HOLDLOCK);
          `);

          const subDeptCode = subCodeResult.recordset[0]?.new_sub_code;

          const subInsertRequest = new sql.Request(transaction);
          const subResult = await subInsertRequest
            .input("sub_dept_id", sql.VarChar(20), subDeptCode)
            .input("dept_id", sql.VarChar(20), departmentId)
            .input("sub_dept_name", sql.NVarChar(100), sub.sub_department_name.trim())
            .input("sub_description", sql.NVarChar(500), sub.description?.trim() || null)
            .input("created_by", sql.VarChar(20), authUser.user_id)
            .query(`
              INSERT INTO notif_sub_departments (
                sub_department_id, department_id, sub_department_name, 
                description, is_active, created_at, updated_at, created_by
              )
              OUTPUT INSERTED.sub_department_id, INSERTED.sub_department_name
              VALUES (
                @sub_dept_id, @dept_id, @sub_dept_name, 
                @sub_description, 1, GETDATE(), GETDATE(), @created_by
              )
            `);

          insertedSubDepartments.push(subResult.recordset[0]);
        }
      }

      await transaction.commit();

      res.status(201).json(
        new ApiResponse(
          201,
          {
            department_id: departmentId,
            department_name: department_name,
            sub_departments: insertedSubDepartments,
          },
          "Department created successfully"
        )
      );
    } catch (error: any) {
      await transaction.rollback();
      throw error;
    }
  }
);

// GET ALL DEPARTMENTS (with sub-departments)

export const getDepartments = asyncHandler(
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
      whereConditions.push("d.is_active = 1");
    }

    if (search && search.trim()) {
      whereConditions.push(`(
        d.department_id LIKE @search OR 
        d.department_name LIKE @search OR 
        d.description LIKE @search
      )`);
      request.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(" AND ")}` 
      : "";

    // Get departments with pagination
    const dataQuery = `
      SELECT 
        d.department_id,
        d.department_name,
        d.description,
        d.is_active,
        d.created_at,
        d.updated_at
      FROM notif_departments d
      ${whereClause}
      ORDER BY d.created_at DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY;
    `;

    // Get sub-departments for these departments
    const subQuery = `
      SELECT 
        sd.sub_department_id,
        sd.department_id,
        sd.sub_department_name,
        sd.description,
        sd.is_active,
        sd.created_at
      FROM notif_sub_departments sd
      INNER JOIN notif_departments d ON sd.department_id = d.department_id
      ${whereClause}
      ORDER BY sd.created_at;
    `;

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM notif_departments d
      ${whereClause};
    `;

    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    const subRequest = pool.request();
    const countRequest = pool.request();

    // Add search parameter only if it exists
    if (search && search.trim()) {
      subRequest.input("search", sql.NVarChar, `%${search.trim()}%`);
      countRequest.input("search", sql.NVarChar, `%${search.trim()}%`);
    }

    const [dataResult, subResult, countResult] = await Promise.all([
      request.query(dataQuery),
      subRequest.query(subQuery),
      countRequest.query(countQuery),
    ]);

    const departments = dataResult.recordset || [];
    const subDepartments = subResult.recordset || [];
    const totalRecords = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    // Merge sub-departments into departments
    const departmentsWithSubs = departments.map((dept: any) => ({
      ...dept,
      sub_departments: subDepartments.filter(
        (sub: any) => sub.department_id === dept.department_id
      ),
    }));

    res.status(200).json(
      new ApiResponse(
        200,
        {
          departments: departmentsWithSubs,
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
        departments.length > 0 ? "Departments fetched successfully" : "No departments found"
      )
    );
  }
);

// GET SINGLE DEPARTMENT (with sub-departments)

export const getDepartmentById = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const { id } = req.params;

    if (!id) {
      throw new ApiError(400, "Department ID is required");
    }

    const pool = getPool();
    const request = pool.request();

    const query = `
      SELECT 
        d.department_id,
        d.department_name,
        d.description,
        d.is_active,
        d.created_at,
        d.updated_at,
        d.created_by
      FROM notif_departments d
      WHERE d.department_id = @department_id;

      SELECT 
        sd.sub_department_id,
        sd.sub_department_name,
        sd.description,
        sd.is_active,
        sd.created_at,
        sd.updated_at
      FROM notif_sub_departments sd
      WHERE sd.department_id = @department_id
      ORDER BY sd.created_at;
    `;

    const result = await request
      .input("department_id", sql.VarChar(20), id)
      .query(query);

    if (!result.recordsets[0] || result.recordsets[0].length === 0) {
      throw new ApiError(404, "Department not found");
    }

    const department = result.recordsets[0][0];
    const sub_departments = result.recordsets[1] || [];

    res.status(200).json(
      new ApiResponse(
        200,
        { ...department, sub_departments },
        "Department fetched successfully"
      )
    );
  }
);

// UPDATE DEPARTMENT

export const updateDepartmentName = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can update departments");
    }

    const { id } = req.params;
    const { department_name, description, is_active } = req.body;

    if (!id) {
      throw new ApiError(400, "Department ID is required");
    }

    // Validate at least one field to update
    if (department_name === undefined && description === undefined && is_active === undefined) {
      throw new ApiError(400, "No fields provided for update");
    }

    // Validate inputs
    if (department_name && !validateDepartmentName(department_name)) {
      throw new ApiError(400, "Invalid department name");
    }

    const pool = getPool();
    const request = pool.request();
    const updates: string[] = [];

    if (department_name !== undefined) {
      updates.push("department_name = @department_name");
      request.input("department_name", sql.NVarChar(100), department_name.trim());
    }

    if (description !== undefined) {
      updates.push("description = @description");
      request.input("description", sql.NVarChar(500), description?.trim() || null);
    }

    if (is_active !== undefined) {
      updates.push("is_active = @is_active");
      request.input("is_active", sql.Bit, is_active ? 1 : 0);
    }

    updates.push("updated_at = GETDATE()");

    const query = `
      UPDATE notif_departments
      SET ${updates.join(", ")}
      WHERE department_id = @department_id;

      SELECT 
        department_id, department_name, 
        description, is_active, created_at, updated_at
      FROM notif_departments
      WHERE department_id = @department_id;
    `;

    const result = await request
      .input("department_id", sql.VarChar(20), id)
      .query(query);

    if (!result.recordset || result.recordset.length === 0) {
      throw new ApiError(404, "Department not found");
    }

    res.status(200).json(
      new ApiResponse(200, result.recordset[0], "Department updated successfully")
    );
  }
);

// DELETE DEPARTMENT (Soft Delete)

export const deleteDepartment = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    if (authUser.role !== "admin" && authUser.role !== "super-admin") {
      throw new ApiError(403, "Only admins can delete departments");
    }

    const { id } = req.params;

    if (!id) {
      throw new ApiError(400, "Department ID is required");
    }

    const pool = getPool();
    const request = pool.request();

    // Check if department has active users
    const usageCheck = await request
      .input("department_id_check", sql.VarChar(20), id)
      .query(`
        SELECT COUNT(*) as user_count 
        FROM notif_users 
        WHERE department_id = @department_id_check AND is_active = 1
      `);

    if (usageCheck.recordset[0].user_count > 0) {
      throw new ApiError(
        409,
        `Cannot delete department. It has ${usageCheck.recordset[0].user_count} active user(s)`
      );
    }

    // Soft delete
    const query = `
      UPDATE notif_departments
      SET is_active = 0, updated_at = GETDATE()
      WHERE department_id = @department_id;
    `;

    const result = await pool.request()
      .input("department_id", sql.VarChar(20), id)
      .query(query);

    if (result.rowsAffected[0] === 0) {
      throw new ApiError(404, "Department not found");
    }

    res.status(200).json(
      new ApiResponse(200, { department_id: id }, "Department deleted successfully")
    );
  }
);

// GET DEPARTMENT STATS

export const getDepartmentsStats = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = req.user;
    if (!authUser) throw new ApiError(401, "Unauthorized");

    const pool = getPool();
    const request = pool.request();

    // Get all stats in one query for performance
    const query = `
      -- Total departments
      SELECT COUNT(*) AS total_departments 
      FROM notif_departments 
      WHERE is_active = 1;

      -- Total sub-departments
      SELECT COUNT(*) AS total_sub_departments 
      FROM notif_sub_departments 
      WHERE is_active = 1;

      -- Total active users
      SELECT COUNT(*) AS total_users
      FROM notif_users
      WHERE is_active = 1;

      -- Departments with sub-departments
      SELECT 
        d.department_id, d.department_name,
        sd.sub_department_id, sd.sub_department_name
      FROM notif_departments d
      LEFT JOIN notif_sub_departments sd
        ON d.department_id = sd.department_id
      WHERE d.is_active = 1
      ORDER BY d.department_name;
    `;

    const result = await request.query(query);

    const totalDepartments = result.recordsets[0][0]?.total_departments || 0;
    const totalSubDepartments = result.recordsets[1][0]?.total_sub_departments || 0;
    const totalUsers = result.recordsets[2][0]?.total_users || 0;

    // Structure departments with sub-departments
    const structured: any = {};
    result.recordsets[3].forEach((row: any) => {
      if (!structured[row.department_id]) {
        structured[row.department_id] = {
          department_id: row.department_id,
          department_name: row.department_name,
          sub_departments: [],
        };
      }

      if (row.sub_department_id) {
        structured[row.department_id].sub_departments.push({
          sub_department_id: row.sub_department_id,
          sub_department_name: row.sub_department_name,
        });
      }
    });

    const departmentsData = Object.values(structured);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          total_departments: totalDepartments,
          total_sub_departments: totalSubDepartments,
          total_users: totalUsers,
          departments: departmentsData,
        },
        "Department stats fetched successfully"
      )
    );
  }
);
