import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE =
  process.env.SMTP_SECURE === "true" ||
  process.env.SMTP_SECURE === "1" ||
  SMTP_PORT === 465;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.SMTP_FROM || `Bahola <${process.env.SMTP_USER}>`;

/**
 * Send a one-time login code via email.
 */
export async function sendLoginCode(to: string, code: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[Email] SMTP not configured — code logged to console only.");
    console.log(`[Email] Login code for ${to}: ${code}`);
    return;
  }

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `${code} — your Bahola login code`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 22px; color: #1e293b;">Bahola</h1>
        </div>
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Your one-time login code is:
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px 32px;">
            ${code}
          </span>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 8px;">
          This code expires in <strong>15 minutes</strong>. If you didn't request this, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">
          Bahola — AI-powered assessment grading
        </p>
      </div>
    `,
    text: `Your Bahola login code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  });
}

/**
 * Send a password reset code via email.
 */
export async function sendPasswordResetCode(to: string, code: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[Email] SMTP not configured — code logged to console only.");
    console.log(`[Email] Password reset code for ${to}: ${code}`);
    return;
  }

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `${code} — reset your Bahola password`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 22px; color: #1e293b;">Bahola</h1>
        </div>
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Your password reset code is:
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px 32px;">
            ${code}
          </span>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 8px;">
          This code expires in <strong>15 minutes</strong>. If you didn't request this, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">
          Bahola — AI-powered assessment grading
        </p>
      </div>
    `,
    text: `Your Bahola password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  });
}
