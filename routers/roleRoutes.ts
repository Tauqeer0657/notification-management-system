import { Router } from "express";
import { createRole, getRoles, updateRole, deleteRole } from "../controllers/roleController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// All role routes require authentication
router.use(verifyToken);

// Router to create role - Only super-admin can create roles
router.post("/", authorize("super-admin"), createRole);

// Router to get roles - All authenticated users can view roles
router.get("/", getRoles);

// Router to update role
router.patch("/:role_id", authorize("super-admin"), updateRole);

// Router to delete role
router.delete("/:role_id", authorize("super-admin"), deleteRole);

export default router;
