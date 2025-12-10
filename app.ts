import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import xssClean from "xss-clean";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import setupRouter from "./routers/setupRoutes.js";
import userRouter from "./routers/userRoutes.js";
import departmentRouter from "./routers/departmentRoutes.js";
import channelRouter from "./routers/channelRoutes.js";
import templateRouter from "./routers/templateRoutes.js";
import { ApiError } from "./utils/ApiError.js";

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true
  })
);

app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());
app.use(helmet());
app.use(xssClean());

// Routes 
app.use("/api/v1/setup", setupRouter);
app.use("/api/v1/user", userRouter);
app.use("/api/v1/department", departmentRouter);
app.use("/api/v1/channel", channelRouter);
app.use("/api/v1/template", templateRouter);

// Global error handler middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      statusCode: err.statusCode,
      message: err.message,
    });
  }

  // Handle SQL Server errors 
  if (err.name === "RequestError" || err.code === "EREQUEST") {
    return res.status(400).json({
      statusCode: 400,
      message: err.message, 
    });
  }

  // Default
  res.status(500).json({
    statusCode: 500,
    message: err.message || "Internal Server Error",
  });
});

export { app };
