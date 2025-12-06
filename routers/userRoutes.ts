import { Router } from "express";
import {
  createUser,
  getUsers,
  updateUser,
  updateMyProfile,
  deleteUser,
  loginUser,
  getProfile,
  logoutUser
} from "../controllers/userController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// Public routes (no authentication required)
// Router to login an user - Public route
router.post("/login", loginUser);

// All other user routes require authentication
// router.use(verifyToken);

// Router to create an user - Only admin and super-admin can create users
router.post("/", createUser);

// Router to get users - All authenticated users can view (filtered by company in controller)
router.get("/", getUsers);

// Router to update user info by own
router.patch("/:user_id", updateMyProfile);

// Router to update user info by admin & super admin
router.patch("/admin/:user_id", authorize("admin", "super-admin"), updateUser);

// Router to delete user
router.delete("/:user_id", authorize("admin", "super-admin"), deleteUser);

// Router to get the profile of an user - All authenticated users can view their own profile
router.get("/getMe", getProfile);

// Router for logout
router.post("/logout", logoutUser);

export default router;
