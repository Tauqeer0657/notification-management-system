import { Router } from "express";
import {
  createChannel,
  getAllChannels,
  getChannelById,
  updateChannel,
  deleteChannel
} from "../controllers/channelController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// All routes require authentication
router.use(verifyToken);

// Create channel
router.post("/", authorize("admin", "super-admin"), createChannel);

// Get all channels
router.get("/", getAllChannels);

// Get single channel
router.get("/:id", getChannelById);

// Update channel
router.patch("/:id", authorize("admin", "super-admin"), updateChannel);

// Delete channel
router.delete("/:id", authorize("super-admin"), deleteChannel);

export default router;
