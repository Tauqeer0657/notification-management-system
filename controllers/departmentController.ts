import { Request, Response } from "express";
import { getSqlRequest } from "../db/connection.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// create department with multiple sub-departments
export const addDepartment = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const {
        department_name,
        description,
        created_by,
        sub_departments, // expect array of objects
      } = req.body;

      if (!department_name) {
        return res.status(400).json({ message: "Department name is required" });
      }

      // Create request for department
      const requestDept = await getSqlRequest();

      const deptResult = await requestDept
        .input("department_name", department_name)
        .input("description", description)
        .input("created_by", created_by || null).query(`
        INSERT INTO notif_departments 
        (department_name, description, is_active, created_at, created_by)
        OUTPUT INSERTED.department_id
        VALUES (@department_name, @description, 1, GETDATE(), @created_by)
      `);

      const departmentId = deptResult.recordset[0].department_id;

      let insertedSubDepartments: any[] = [];

      if (Array.isArray(sub_departments) && sub_departments.length > 0) {
        for (const sub of sub_departments) {
          if (!sub.sub_department_name) continue;

          const requestSub = await getSqlRequest();
          const subResult = await requestSub
            .input("department_id", departmentId)
            .input("sub_department_name", sub.sub_department_name)
            .input("description", sub.sub_description || null)
            .input("created_by", created_by || null).query(`
            INSERT INTO notif_sub_departments
            (department_id, sub_department_name, description, is_active, created_at, created_by)
            OUTPUT INSERTED.sub_department_id
            VALUES (@department_id, @sub_department_name, @description, 1, GETDATE(), @created_by)
          `);

          insertedSubDepartments.push(subResult.recordset[0]);
        }
      }

      return res.status(201).json({
        message: "Department created successfully",
        department_id: departmentId,
        sub_departments: insertedSubDepartments,
      });
    } catch (error) {
      console.error("Error creating department:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

//get all departments along with sub departments
export const getDepartments = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const request = await getSqlRequest();

      const result = await request.query(`
        SELECT 
          d.department_id,
          d.department_name,
          d.description AS department_description,
          d.is_active AS department_active,
          d.created_at AS department_created_at,

          sd.sub_department_id,
          sd.sub_department_name,
          sd.description AS sub_department_description,
          sd.is_active AS sub_department_active,
          sd.created_at AS sub_department_created_at

        FROM notif_departments d
        LEFT JOIN notif_sub_departments sd 
          ON d.department_id = sd.department_id
        ORDER BY d.created_at DESC, sd.created_at DESC
      `);

      const departments: any[] = [];

      result.recordset.forEach((row: any) => {
        let department = departments.find(
          (d) => d.department_id === row.department_id
        );

        if (!department) {
          department = {
            department_id: row.department_id,
            department_name: row.department_name,
            description: row.department_description,
            is_active: row.department_active,
            created_at: row.department_created_at,
            sub_departments: [],
          };
          departments.push(department);
        }

        if (row.sub_department_id) {
          department.sub_departments.push({
            sub_department_id: row.sub_department_id,
            sub_department_name: row.sub_department_name,
            description: row.sub_department_description,
            is_active: row.sub_department_active,
            created_at: row.sub_department_created_at,
          });
        }
      });

      res.status(200).json({
        message: "Departments fetched successfully",
        data: departments,
      });
    } catch (error) {
      console.error("Error fetching departments:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export const updateDepartmentName = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { department_name } = req.body;
    try {
      const { id } = req.params;
      const { department_name } = req.body;

      if (!department_name) {
        return new ApiError(400,"Department name is required" )
      }

      const request = await getSqlRequest();

      const updateResult = await request
        .input("department_id", id)
        .input("department_name", department_name).query(`
          UPDATE notif_departments
          SET department_name = @department_name,
              updated_at = GETDATE()
          WHERE department_id = @department_id;
        `);

      if (updateResult.rowsAffected[0] === 0) {
        return res.status(404).json({ message: "Department not found" });
      }

      res.status(200).json({ message: "Department name updated successfully" });
    } catch (error) {
      console.error("Error updating department name:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export const getDepartmentsStats = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const request = await getSqlRequest();

      // Total departments
      const deptCount = await request.query(`
      SELECT COUNT(*) AS total_departments 
      FROM notif_departments 
      WHERE is_active = 1
    `);
      const totalDepartments = deptCount.recordset[0].total_departments;

      // Total sub-departments
      const subDeptCount = await request.query(`
      SELECT COUNT(*) AS total_sub_departments 
      FROM notif_sub_departments 
      WHERE is_active = 1
    `);
      const totalSubDepartments =
        subDeptCount.recordset[0].total_sub_departments;

      // Total active users
      const userCount = await request.query(`
      SELECT COUNT(*) AS total_users
      FROM tb_asset_users
      WHERE is_active = 'true'
    `);
      const totalUsers = userCount.recordset[0].total_users;

      // Departments with their sub-departments
      const hierarchy = await request.query(`
      SELECT 
        d.department_id, d.department_name,
        sd.sub_department_id, sd.sub_department_name
      FROM notif_departments d
      LEFT JOIN notif_sub_departments sd
      ON d.department_id = sd.department_id
      WHERE d.is_active = 1
      ORDER BY d.department_name
    `);

      const structured: any = {};
      hierarchy.recordset.forEach((row) => {
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
          "Department status fetched succesfully "
        )
      );
    } catch (error) {
      console.error("Error fetching department stats:", error);
      // return res.status(500).json({ message: "Server error" });

      res.status(500).json(new ApiResponse(500, {}, "Server Error "));
    }
  }
);
