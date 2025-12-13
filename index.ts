import { connectToDatabase } from "./db/connection.js";
import { app } from "./app.js";
import { startScheduleWorker, stopScheduleWorker } from "./workers/scheduleWorker.js";
import { initializeEmailService } from "./services/emailService.js";

/**
 * ========================================
 * SERVER STARTUP SEQUENCE
 * ========================================
 * 1. Connect to SQL Server database
 * 2. Initialize email service (Nodemailer)
 * 3. Test SMTP connection
 * 4. Start schedule worker (cron jobs)
 * 5. Start Express server
 */

const startServer = async () => {
  try {
    console.log("🚀 Starting Notification System Server...\n");

    // ========================================
    // 1. DATABASE CONNECTION
    // ========================================
    console.log("📊 [1/4] Connecting to database...");
    await connectToDatabase();
    console.log("✅ Database connected successfully\n");

    // ========================================
    // 2. EMAIL SERVICE INITIALIZATION
    // ========================================
    console.log("📧 [2/4] Initializing email service...");
    initializeEmailService();

    // ========================================
    // 4. START SCHEDULE WORKER
    // ========================================
    console.log("⏰ [4/4] Starting schedule worker...");
    startScheduleWorker();
    console.log("");

    // ========================================
    // 5. START EXPRESS SERVER
    // ========================================
    const PORT = Number(process.env.PORT) || 1433;
    app.listen(PORT, () => {
      console.log("========================================");
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log("========================================\n");
    });

  } catch (error: any) {
    console.error("❌ Failed to start server:", error.message);
    console.error("🔍 Stack trace:", error.stack);
    process.exit(1);
  }
};

// ========================================
// GRACEFUL SHUTDOWN HANDLERS
// ========================================

/**
 * Handle CTRL+C (SIGINT)
 */
process.on("SIGINT", () => {
  console.log("\n\n🛑 Received SIGINT (CTRL+C)");
  console.log("🔄 Initiating graceful shutdown...");
  
  stopScheduleWorker();
  
  console.log("✅ Server shutdown complete");
  process.exit(0);
});

/**
 * Handle termination signal (SIGTERM)
 * Used by Docker, PM2, systemd, etc.
 */
process.on("SIGTERM", () => {
  console.log("\n\n🛑 Received SIGTERM");
  console.log("🔄 Initiating graceful shutdown...");
  
  stopScheduleWorker();
  
  console.log("✅ Server shutdown complete");
  process.exit(0);
});

/**
 * Handle uncaught exceptions
 */
process.on("uncaughtException", (error: Error) => {
  console.error("\n❌ UNCAUGHT EXCEPTION:");
  console.error(error.message);
  console.error(error.stack);
  
  stopScheduleWorker();
  
  process.exit(1);
});

/**
 * Handle unhandled promise rejections
 */
process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  console.error("\n❌ UNHANDLED REJECTION:");
  console.error("Reason:", reason);
  console.error("Promise:", promise);
  
  stopScheduleWorker();
  
  process.exit(1);
});

// ========================================
// START THE SERVER
// ========================================
startServer();
