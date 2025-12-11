import { Router } from "express";
import {
  createSchedule,
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  updateScheduleStatus,
} from "../controllers/scheduleController.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = Router();

router.use(verifyToken);

// Route to add schedule
router.post("/", authorize("admin", "super-admin"), createSchedule);

// Route to get all schedules
router.get("/", getAllSchedules);

// Route to get schedule by id
router.get("/:id", getScheduleById);

// Route to update schedule
router.patch("/:id", authorize("admin", "super-admin"), updateSchedule);

// Route to update schedule status
router.patch(
  "/:id/status",
  authorize("admin", "super-admin"),
  updateScheduleStatus
);

export default router;
