import { Router } from "express";
import { setupInitialData } from "../controllers/setupController.js";

const router = Router();

// ONE-TIME setup endpoint (disabled after first use)
router.post("/initialize", setupInitialData);

export default router;
