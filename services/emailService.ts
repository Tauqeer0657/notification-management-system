/**
 * ========================================
 * EMAIL SERVICE (Nodemailer)
 * ========================================
 * 
 * Real email sending using Nodemailer
 * Supports Gmail, Outlook, custom SMTP servers
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

interface EmailData {
  to: string;
  subject: string;
  body: string;
  recipientName: string;
}

interface EmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

// ========================================
// CONFIGURE TRANSPORTER (SMTP)
// ========================================
let transporter: Transporter | null = null;

/**
 * Initialize email transporter
 * Call this once when server starts
 */
export const initializeEmailService = () => {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Optional: For debugging
      logger: process.env.NODE_ENV === "development",
      debug: process.env.NODE_ENV === "development",
    });

    console.log("✅ [EMAIL SERVICE] Nodemailer transporter initialized");
  } catch (error: any) {
    console.error("❌ [EMAIL SERVICE] Failed to initialize transporter:", error.message);
    throw error;
  }
};

/**
 * Send email using Nodemailer
 */
export async function sendEmail(data: EmailData): Promise<EmailResult> {
  if (!transporter) {
    console.error("❌ [EMAIL] Transporter not initialized");
    return {
      success: false,
      error: "Email service not initialized",
    };
  }

  try {
    console.log(`\n   📧 [EMAIL] Sending email...`);
    console.log(`      To: ${data.to}`);
    console.log(`      Name: ${data.recipientName}`);
    console.log(`      Subject: ${data.subject}`);

    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME || "Notification System"}" <${process.env.FROM_EMAIL}>`,
      to: data.to,
      subject: data.subject,
      text: data.body, // Plain text version
      html: data.body, // HTML version (you can format this better)
    });

    console.log(`   ✅ [EMAIL] Email sent successfully`);
    console.log(`      Message ID: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error: any) {
    console.error(`\n   ❌ [EMAIL] Failed to send email`);
    console.error(`      To: ${data.to}`);
    console.error(`      Error: ${error.message}`);

    return {
      success: false,
      error: error.message,
    };
  }
}
