import { Router } from "express";
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  updateMyProfile,
  deleteUser,
  loginUser,      
  getProfile,     
  logoutUser,
} from "../controllers/userController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// PUBLIC ROUTES (No authentication required)
router.post("/login", loginUser);

// PROTECTED ROUTES (Authentication required)
router.use(verifyToken);

// Auth-related
router.get("/profile", getProfile);
router.post("/logout", logoutUser);

// User CRUD
router.post("/", authorize("admin", "super-admin"), createUser);
router.get("/", getUsers);
router.get("/:user_id", getUserById);
router.patch("/profile", updateMyProfile);
router.patch("/:user_id", authorize("admin", "super-admin"), updateUser);
router.delete("/:user_id", authorize("admin", "super-admin"), deleteUser);

export default router;
