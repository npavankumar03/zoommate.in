import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { storage } from "./storage";
import { decryptSettingValue } from "./settingsCrypto";

/**
 * Build an SMTP transporter from admin-configured settings.
 * Returns null if SMTP is not configured.
 */
async function getTransporter(): Promise<Transporter | null> {
  const host = await storage.getSetting("smtp_host");
  const port = await storage.getSetting("smtp_port");
  const user = await storage.getSetting("smtp_user");
  const passRaw = await storage.getSetting("smtp_pass");

  if (!host || !user || !passRaw) return null;

  const pass = decryptSettingValue(passRaw) || passRaw;

  return nodemailer.createTransport({
    host,
    port: parseInt(port || "587", 10),
    secure: parseInt(port || "587", 10) === 465,
    auth: { user, pass },
  });
}

/**
 * Send a verification email with a 6-digit code.
 */
export async function sendVerificationEmail(
  toEmail: string,
  code: string,
): Promise<void> {
  const transporter = await getTransporter();
  if (!transporter) {
    throw new Error(
      "SMTP is not configured. Please ask an administrator to set up email settings.",
    );
  }

  const fromEmail =
    (await storage.getSetting("smtp_from_email")) || "noreply@zoommate.in";
  const fromName =
    (await storage.getSetting("smtp_from_name")) || "Zoom Mate";

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toEmail,
    subject: "Verify your Zoom Mate account",
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <tr>
      <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Zoom Mate</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Email Verification</p>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 24px;">
        <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
          Welcome! Please use the verification code below to complete your registration:
        </p>
        <div style="text-align:center;margin:24px 0;">
          <div style="display:inline-block;background:#f4f4f5;border:2px dashed #6366f1;border-radius:12px;padding:16px 32px;">
            <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;font-family:monospace;">${code}</span>
          </div>
        </div>
        <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
          This code expires in <strong>10 minutes</strong>. If you didn't create an account, you can ignore this email.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 24px 24px;text-align:center;border-top:1px solid #f4f4f5;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">
          &copy; ${new Date().getFullYear()} Zoom Mate. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  });
}

/**
 * Test SMTP connectivity by sending a test email.
 */
export async function testSmtpConnection(
  testEmail: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = await getTransporter();
    if (!transporter) {
      return { success: false, error: "SMTP is not configured." };
    }

    await transporter.verify();

    const fromEmail =
      (await storage.getSetting("smtp_from_email")) || "noreply@zoommate.in";
    const fromName =
      (await storage.getSetting("smtp_from_name")) || "Zoom Mate";

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: testEmail,
      subject: "Zoom Mate — SMTP Test",
      html: `<p>If you received this email, your SMTP configuration is working correctly!</p>
<p style="color:#6b7280;font-size:13px;">Sent at ${new Date().toISOString()}</p>`,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Unknown error" };
  }
}
