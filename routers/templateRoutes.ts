import { Router } from "express";
import {
  createTemplate,
  getAllTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  getTemplateStats,
} from "../controllers/templateController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// All routes require authentication
router.use(verifyToken);

// Get template stats 
router.get("/stats", getTemplateStats);

// Create template
router.post("/", authorize("admin", "super-admin"), createTemplate);

// Get all templates
router.get("/", getAllTemplates);

// Get single template
router.get("/:id", getTemplateById);

// Update template
router.patch("/:id", authorize("admin", "super-admin"), updateTemplate);

// Delete template (soft delete)
router.delete("/:id", authorize("super-admin"), deleteTemplate);

export default router;
