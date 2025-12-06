import { Router } from "express";
import { createCompany, getCompanies, updateCompany, deleteCompany } from "../controllers/companyController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// All company routes require authentication
// router.use(verifyToken);

// Router to add company - Only super-admin can create companies
router.post("/", createCompany);

// Router to get companies - All authenticated users can view (filtered by company in controller)
router.get("/", getCompanies);

// Router to update the company
router.patch("/:company_id", authorize("super-admin", "admin"), updateCompany);

// Router to delete the company
router.delete("/:company_id", authorize("super-admin"), deleteCompany);

export default router;
