const nodemailer = require("nodemailer");

function resolveBoolean(value) {
  return String(value || "").toLowerCase() === "true";
}

function createMailerTransport() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: resolveBoolean(process.env.SMTP_SECURE) || port === 465,
    auth: { user, pass }
  });
}

async function sendPasswordRecoveryEmail({ to, name, token }) {
  const transport = createMailerTransport();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@comxpress.local").trim();
  const appBaseUrl = String(process.env.APP_BASE_URL || "http://127.0.0.1:5500/index.html").trim();
  const resetUrl = `${appBaseUrl}#reset?email=${encodeURIComponent(to)}&token=${encodeURIComponent(token)}`;

  const subject = "ComXpress Password Recovery";
  const text = [
    `Hi ${name || "there"},`,
    "",
    "We received a request to reset your ComXpress password.",
    `Recovery Token: ${token}`,
    "This token will expire in 30 minutes.",
    "",
    `Reset link: ${resetUrl}`,
    "",
    "If you did not request this, you can safely ignore this email."
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a;">
      <h2 style="margin:0 0 12px;">ComXpress Password Recovery</h2>
      <p style="margin:0 0 10px;">Hi ${name || "there"},</p>
      <p style="margin:0 0 10px;">We received a request to reset your password.</p>
      <p style="margin:0 0 10px;"><strong>Recovery Token:</strong> ${token}</p>
      <p style="margin:0 0 10px;">This token expires in <strong>30 minutes</strong>.</p>
      <p style="margin:0 0 14px;"><a href="${resetUrl}">Open reset page</a></p>
      <p style="margin:0;color:#475569;">If you did not request this, ignore this email.</p>
    </div>
  `;

  if (!transport) {
    console.warn("[mailer] SMTP not configured. Password recovery token generated but email not sent.");
    console.info(`[mailer] Recovery token for ${to}: ${token}`);
    return { delivered: false, reason: "smtp_not_configured" };
  }

  await transport.sendMail({ from, to, subject, text, html });
  return { delivered: true };
}

module.exports = {
  sendPasswordRecoveryEmail
};
