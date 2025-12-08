import { Router } from "express";
import {
  addDepartment,
  getDepartments,
  updateDepartmentName,
  getDepartmentsStats,
} from "../controllers/departmentController.js";

const router = Router();
router.post("/", addDepartment);
router.get("/get", getDepartments);
router.get("/stats", getDepartmentsStats);
router.patch("/:id", updateDepartmentName);

export default router;
