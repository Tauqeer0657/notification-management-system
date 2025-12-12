import cron from "node-cron";
import { getPool } from "../db/connection.js";
import sql from "mssql";
import { sendEmail } from "../services/emailService.js";
import {
  shouldExecuteToday,
  calculateNextExecution,
  replaceTemplateVariables,
} from "../utils/scheduleHelper.js";

/**
 * ========================================
 * NOTIFICATION SCHEDULE WORKER
 * ========================================
 * 
 * Purpose: Background job that executes scheduled notifications
 * 
 * Flow:
 * 1. Runs every minute (cron: "* * * * *")
 * 2. Finds active schedules that need execution
 * 3. For each schedule:
 *    - Fetches recipients from notif_schedule_recipients
 *    - Creates notification records (notif_notifications)
 *    - Simulates email sending
 *    - Logs delivery status (notif_notification_delivery_log)
 *    - Updates last_executed and next_execution timestamps
 * 
 * Schedule Types:
 * - once    : Execute once on start_date at schedule_time
 * - daily   : Execute every day at schedule_time
 * - weekly  : Execute every 7 days at schedule_time
 * - monthly : Execute on same day of month at schedule_time
 */

let isWorkerRunning = false;

/**
 * Main cron job - Runs every minute
 * Cron expression: "* * * * *"
 * ┌────────────── minute (0-59)
 * │ ┌──────────── hour (0-23)
 * │ │ ┌────────── day of month (1-31)
 * │ │ │ ┌──────── month (1-12)
 * │ │ │ │ ┌────── day of week (0-7, 0 and 7 = Sunday)
 * │ │ │ │ │
 * * * * * *
 */
export const startScheduleWorker = () => {
  console.log("🚀 [SCHEDULE WORKER] Starting notification schedule worker...");

  cron.schedule("* * * * *", async () => {
    // Prevent overlapping executions
    if (isWorkerRunning) {
      console.log("⏭️  [SCHEDULE WORKER] Previous execution still running, skipping...");
      return;
    }

    isWorkerRunning = true;
    const startTime = new Date();
    console.log(`\n⏰ [SCHEDULE WORKER] Execution started at ${startTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);

    try {
      await processSchedules();
    } catch (error: any) {
      console.error("❌ [SCHEDULE WORKER] Fatal error:", error.message);
    } finally {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      console.log(`✅ [SCHEDULE WORKER] Execution completed in ${duration}ms\n`);
      isWorkerRunning = false;
    }
  });

  console.log("✅ [SCHEDULE WORKER] Worker initialized and running (every minute)");
};

/**
 * Main processing function - finds and executes schedules
 */
async function processSchedules() {
  const pool = getPool();

  try {
    // ========================================
    // 1. FIND SCHEDULES THAT NEED EXECUTION
    // ========================================
    const currentDate = new Date();
    const currentTime = currentDate.toTimeString().substring(0, 5); // "HH:MM"

    console.log(`🔍 [SCHEDULE WORKER] Searching for schedules to execute...`);
    console.log(`   Current Time: ${currentTime}`);

    const schedulesResult = await pool.request().query(`
      SELECT 
        s.schedule_id,
        s.template_id,
        s.department_id,
        s.sub_department_id,
        s.schedule_type,
        s.schedule_time,
        s.start_date,
        s.end_date,
        s.template_variables,
        s.last_executed,
        s.next_execution,
        t.template_name,
        t.subject,
        t.body,
        d.department_name,
        sd.sub_department_name
      FROM notif_notification_schedules s
      INNER JOIN notif_notification_templates t ON s.template_id = t.template_id
      INNER JOIN notif_departments d ON s.department_id = d.department_id
      LEFT JOIN notif_sub_departments sd ON s.sub_department_id = sd.sub_department_id
      WHERE s.is_active = 1
        AND t.is_active = 1
        AND s.start_date <= CAST(GETDATE() AS DATE)
        AND (s.end_date IS NULL OR s.end_date >= CAST(GETDATE() AS DATE))
        AND CONVERT(VARCHAR(5), s.schedule_time, 108) <= '${currentTime}'
        AND (
          s.last_executed IS NULL 
          OR s.last_executed < CAST(GETDATE() AS DATE)
        )
      ORDER BY s.schedule_time ASC
    `);

    const schedules = schedulesResult.recordset;

    if (schedules.length === 0) {
      console.log("   ℹ️  No schedules to execute at this time");
      return;
    }

    console.log(`   ✅ Found ${schedules.length} schedule(s) to execute\n`);

    // ========================================
    // 2. EXECUTE EACH SCHEDULE
    // ========================================
    for (const schedule of schedules) {
      await executeSchedule(schedule);
    }

  } catch (error: any) {
    console.error("❌ [SCHEDULE WORKER] Error in processSchedules:", error.message);
    throw error;
  }
}

/**
 * Execute a single schedule
 */
async function executeSchedule(schedule: any) {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);

  console.log(`\n📨 [EXECUTE] Processing schedule: ${schedule.schedule_id}`);
  console.log(`   Template: ${schedule.template_name}`);
  console.log(`   Type: ${schedule.schedule_type}`);
  console.log(`   Time: ${schedule.schedule_time}`);

  try {
    await transaction.begin();

    // ========================================
    // 1. CHECK IF SHOULD EXECUTE TODAY
    // ========================================
    const shouldExecute = shouldExecuteToday(
      schedule.schedule_type,
      schedule.start_date,
      schedule.last_executed
    );

    if (!shouldExecute) {
      console.log(`   ⏭️  Skipping: Already executed today or not due yet`);
      await transaction.commit();
      return;
    }

    // ========================================
    // 2. FETCH RECIPIENTS
    // ========================================
    const recipientsRequest = new sql.Request(transaction);
    const recipientsResult = await recipientsRequest
      .input("schedule_id", sql.VarChar(20), schedule.schedule_id)
      .query(`
        SELECT 
          u.user_id,
          u.first_name,
          u.last_name,
          u.email,
          u.phone_number,
          u.is_active
        FROM notif_schedule_recipients sr
        INNER JOIN notif_users u ON sr.user_id = u.user_id
        WHERE sr.schedule_id = @schedule_id
          AND u.is_active = 1
      `);

    const recipients = recipientsResult.recordset;

    if (recipients.length === 0) {
      console.log(`   ⚠️  Warning: No active recipients found, skipping schedule`);
      await transaction.commit();
      return;
    }

    console.log(`   👥 Found ${recipients.length} active recipient(s)`);

    // ========================================
    // 3. PARSE TEMPLATE VARIABLES
    // ========================================
    let templateVars: any = {};
    if (schedule.template_variables) {
      try {
        templateVars = JSON.parse(schedule.template_variables);
      } catch (error) {
        console.warn(`   ⚠️  Failed to parse template_variables, using empty object`);
      }
    }

    // ========================================
    // 4. PROCESS EACH RECIPIENT
    // ========================================
    let successCount = 0;
    let failureCount = 0;

    for (const recipient of recipients) {
      try {
        // Generate notification ID (NOTIF001, NOTIF002...)
        const notifIdRequest = new sql.Request(transaction);
        const notifIdResult = await notifIdRequest.query(`
          SELECT 'NOTIF' + RIGHT('000' + CAST(
            ISNULL(MAX(CAST(SUBSTRING(notification_id, 6, LEN(notification_id)) AS INT)), 0) + 1
            AS VARCHAR), 3) AS new_code
          FROM notif_notifications WITH (TABLOCKX, HOLDLOCK);
        `);

        const newNotificationId = notifIdResult.recordset[0]?.new_code;

        // Replace placeholders with recipient data
        const personalizedSubject = replaceTemplateVariables(
          schedule.subject,
          {
            ...templateVars,
            first_name: recipient.first_name,
            last_name: recipient.last_name,
            email: recipient.email,
          }
        );

        const personalizedBody = replaceTemplateVariables(
          schedule.body,
          {
            ...templateVars,
            first_name: recipient.first_name,
            last_name: recipient.last_name,
            email: recipient.email,
          }
        );

        // ========================================
        // 5. CREATE NOTIFICATION RECORD
        // ========================================
        const notifRequest = new sql.Request(transaction);
        await notifRequest
          .input("notification_id", sql.VarChar(20), newNotificationId)
          .input("user_id", sql.VarChar(20), recipient.user_id)
          .input("template_id", sql.VarChar(20), schedule.template_id)
          .input("schedule_id", sql.VarChar(20), schedule.schedule_id)
          .input("department_id", sql.VarChar(20), schedule.department_id)
          .input("subject", sql.NVarChar(500), personalizedSubject)
          .input("body", sql.NVarChar(sql.MAX), personalizedBody)
          .query(`
            INSERT INTO notif_notifications (
              notification_id,
              user_id,
              template_id,
              schedule_id,
              department_id,
              subject,
              body,
              status,
              is_read,
              created_at,
              updated_at
            )
            VALUES (
              @notification_id,
              @user_id,
              @template_id,
              @schedule_id,
              @department_id,
              @subject,
              @body,
              'pending',
              0,
              GETDATE(),
              GETDATE()
            )
          `);

        // ========================================
        // 6. SIMULATE EMAIL SENDING
        // ========================================
        const emailResult = await sendEmail({
          to: recipient.email,
          subject: personalizedSubject,
          body: personalizedBody,
          recipientName: `${recipient.first_name} ${recipient.last_name}`,
        });

        // ========================================
        // 7. LOG DELIVERY STATUS
        // ========================================
        const logRequest = new sql.Request(transaction);
        await logRequest
          .input("notification_id", sql.VarChar(20), newNotificationId)
          .input("channel", sql.VarChar(20), "email")
          .input("status", sql.VarChar(20), emailResult.success ? "sent" : "failed")
          .input("delivered_at", sql.DateTime, emailResult.success ? new Date() : null)
          .input("error_message", sql.NVarChar(500), emailResult.error || null)
          .query(`
            INSERT INTO notif_notification_delivery_log (
              notification_id,
              channel,
              status,
              delivered_at,
              error_message,
              created_at
            )
            VALUES (
              @notification_id,
              @channel,
              @status,
              @delivered_at,
              @error_message,
              GETDATE()
            )
          `);

        // Update notification status
        const statusRequest = new sql.Request(transaction);
        await statusRequest
          .input("notification_id", sql.VarChar(20), newNotificationId)
          .input("status", sql.VarChar(20), emailResult.success ? "sent" : "failed")
          .query(`
            UPDATE notif_notifications
            SET status = @status, updated_at = GETDATE()
            WHERE notification_id = @notification_id
          `);

        if (emailResult.success) {
          successCount++;
        } else {
          failureCount++;
        }

      } catch (recipientError: any) {
        console.error(`   ❌ Error processing recipient ${recipient.email}:`, recipientError.message);
        failureCount++;
      }
    }

    // ========================================
    // 8. UPDATE SCHEDULE TIMESTAMPS
    // ========================================
    const nextExecution = calculateNextExecution(
      schedule.schedule_type,
      schedule.start_date,
      schedule.schedule_time
    );

    const updateScheduleRequest = new sql.Request(transaction);
    await updateScheduleRequest
      .input("schedule_id", sql.VarChar(20), schedule.schedule_id)
      .input("last_executed", sql.DateTime, new Date())
      .input("next_execution", sql.DateTime, nextExecution)
      .query(`
        UPDATE notif_notification_schedules
        SET 
          last_executed = @last_executed,
          next_execution = @next_execution,
          updated_at = GETDATE()
        WHERE schedule_id = @schedule_id
      `);

    await transaction.commit();

    console.log(`   ✅ Schedule executed successfully`);
    console.log(`      Success: ${successCount} | Failed: ${failureCount}`);
    console.log(`      Next execution: ${nextExecution ? nextExecution.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "N/A (one-time schedule)"}`);

  } catch (error: any) {
    await transaction.rollback();
    console.error(`   ❌ Error executing schedule ${schedule.schedule_id}:`, error.message);
  }
}

/**
 * Stop the worker (for graceful shutdown)
 */
export const stopScheduleWorker = () => {
  console.log("🛑 [SCHEDULE WORKER] Stopping worker...");
  cron.getTasks().forEach(task => task.stop());
  console.log("✅ [SCHEDULE WORKER] Worker stopped");
};
