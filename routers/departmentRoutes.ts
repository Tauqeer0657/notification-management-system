import { Router } from "express";
import {
  addDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartmentName,
  deleteDepartment,
  getDepartmentsStats,
} from "../controllers/departmentController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

router.use(verifyToken);

// Create department (Admin/Super-admin only)
router.post("/", authorize("admin", "super-admin"), addDepartment);

// Get all departments with pagination
router.get("/", getDepartments);

// Get department stats
router.get("/stats", getDepartmentsStats);

// Get single department by ID
router.get("/:id", getDepartmentById);

// Update department
router.patch("/:id", authorize("admin", "super-admin"), updateDepartmentName);

// Delete department (soft delete)
router.delete("/:id", authorize("admin", "super-admin"), deleteDepartment);

export default router;
