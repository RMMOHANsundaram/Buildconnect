/**
 * Outbound notification service.
 *
 * Sends booking lifecycle messages to a customer over Email and WhatsApp.
 *
 * Design rules (important):
 *  - Nothing here throws. A missing credential or a provider outage must never
 *    break a booking status change. Every channel returns a result object with
 *    status SENT / FAILED / SKIPPED so the caller can log it.
 *  - Credentials are read lazily, so the server boots fine without any of them.
 *    Unconfigured channels are reported as SKIPPED rather than crashing.
 *  - One HTTP call is made per channel; callers may pass a single `channel` to
 *    target just one.
 */

const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || "91"; // India

// ---------------------------------------------------------------- credentials

const hasEmailConfig = () => Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
const hasTwilioConfig = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
const hasMetaWhatsAppConfig = () => Boolean(
  process.env.WHATSAPP_TOKEN && (process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID)
);

const whatsappProvider = () => (process.env.WHATSAPP_PROVIDER || "twilio").toLowerCase();

const isWhatsAppConfigured = () =>
  whatsappProvider() === "meta" ? hasMetaWhatsAppConfig() : hasTwilioConfig() && Boolean(process.env.TWILIO_WHATSAPP_NUMBER);

const isSmsConfigured = () => hasTwilioConfig() && Boolean(process.env.TWILIO_PHONE_NUMBER);

/** Human-readable summary of what is wired up — surfaced by GET /api/notifications/status. */
const getChannelStatus = () => ({
  email: hasEmailConfig(),
  whatsapp: isWhatsAppConfigured(),
  sms: isSmsConfigured(),
  whatsappProvider: whatsappProvider(),
});

// -------------------------------------------------------------- lazy clients

let mailTransporter;
const getMailer = () => {
  if (!hasEmailConfig()) return null;
  if (!mailTransporter) {
    const nodemailer = require("nodemailer");
    mailTransporter = nodemailer.createTransport({
      ...(process.env.EMAIL_HOST
        ? {
            host: process.env.EMAIL_HOST,
            port: Number(process.env.EMAIL_PORT || 587),
            secure: String(process.env.EMAIL_SECURE || "false") === "true",
          }
        : { service: process.env.EMAIL_SERVICE || "gmail" }),
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return mailTransporter;
};

let twilioClient;
const getTwilio = () => {
  if (!hasTwilioConfig()) return null;
  if (!twilioClient) {
    const twilio = require("twilio");
    if (process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET) {
      twilioClient = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, { accountSid: process.env.TWILIO_ACCOUNT_SID });
    } else {
      twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
  }
  return twilioClient;
};

// ------------------------------------------------------------------- helpers

/**
 * Normalise a stored phone number into E.164 (`+919876543210`).
 * Accepts "9876543210", "91 98765 43210", "+91-98765-43210", "+1 415 555 0100".
 */
const toE164 = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (value.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return "";
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Turn plain text (with \n) into a minimal, brand-consistent HTML body. */
const toHtml = (subject, body) => `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
    <div style="background:#f97316;padding:18px 24px">
      <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff">${escapeHtml(process.env.COMPANY_NAME || "BuildConnect")}</p>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:17px">${escapeHtml(subject)}</h1>
      <div style="font-size:14px;line-height:1.65;color:#3f3f46;white-space:pre-line">${escapeHtml(body)}</div>
    </div>
    <div style="padding:14px 24px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:11px;color:#71717a">
      Automated message from ${escapeHtml(process.env.COMPANY_NAME || "BuildConnect")}. Please do not reply to this email.
    </div>
  </div>
</body></html>`;

// ------------------------------------------------------------------ channels

const sendEmail = async ({ to, subject, body, html, attachments }) => {
  const mailer = getMailer();
  if (!mailer) return { channel: "email", status: "SKIPPED", detail: "EMAIL_USER / EMAIL_PASS not configured" };
  if (!to) return { channel: "email", status: "SKIPPED", detail: "recipient has no email address" };
  try {
    const info = await mailer.sendMail({
      from: `"${process.env.COMPANY_NAME || "BuildConnect"}" <${process.env.EMAIL_USER}>`,
      replyTo: process.env.COMPANY_EMAIL || undefined,
      to,
      subject,
      text: body,
      html: html || toHtml(subject, body),
      attachments: attachments || [],
    });
    return { channel: "email", status: "SENT", detail: info.messageId || "sent" };
  } catch (error) {
    // Gmail app passwords and shared hosts are the usual culprits here.
    console.error("[notify] email failed:", error.message);
    return { channel: "email", status: "FAILED", detail: error.message };
  }
};

const sendWhatsAppViaTwilio = async ({ to, body }) => {
  try {
    const client = getTwilio();
    const message = await client.messages.create({
      body,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${to}`,
    });
    return { channel: "whatsapp", status: "SENT", detail: message.sid };
  } catch (error) {
    console.error("[notify] whatsapp (twilio) failed:", error.message);
    return { channel: "whatsapp", status: "FAILED", detail: error.message };
  }
};

const sendWhatsAppViaMeta = async ({ to, body }) => {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace("+", ""),
        type: "text",
        text: { preview_url: false, body },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || `HTTP ${response.status}`;
      console.error("[notify] whatsapp (meta) failed:", detail);
      return { channel: "whatsapp", status: "FAILED", detail };
    }
    return { channel: "whatsapp", status: "SENT", detail: data?.messages?.[0]?.id || "sent" };
  } catch (error) {
    console.error("[notify] whatsapp (meta) failed:", error.message);
    return { channel: "whatsapp", status: "FAILED", detail: error.message };
  }
};

const sendWhatsApp = async ({ to, body }) => {
  if (!isWhatsAppConfigured()) {
    return {
      channel: "whatsapp",
      status: "SKIPPED",
      detail: whatsappProvider() === "meta"
        ? "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured"
        : "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_NUMBER not configured",
    };
  }
  if (!to) return { channel: "whatsapp", status: "SKIPPED", detail: "recipient has no usable phone number" };
  return whatsappProvider() === "meta" ? sendWhatsAppViaMeta({ to, body }) : sendWhatsAppViaTwilio({ to, body });
};

const sendSms = async ({ to, body }) => {
  if (!isSmsConfigured()) return { channel: "sms", status: "SKIPPED", detail: "Twilio SMS not configured" };
  if (!to) return { channel: "sms", status: "SKIPPED", detail: "recipient has no usable phone number" };
  try {
    const client = getTwilio();
    const message = await client.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to });
    return { channel: "sms", status: "SENT", detail: message.sid };
  } catch (error) {
    console.error("[notify] sms failed:", error.message);
    return { channel: "sms", status: "FAILED", detail: error.message };
  }
};

// -------------------------------------------------------------------- public

/**
 * Send one message over the requested channels.
 *
 * @param {object} user       Mongoose user (or lean doc) with email/phone/communicationPreferences.
 * @param {object} payload    { subject, body, html?, attachments?, channels? }
 *                            `channels` defaults to email + whatsapp.
 * @returns {Promise<Array>}  Per-channel result objects; never rejects.
 */
const sendNotification = async (user, payload = {}) => {
  const { subject, body, html, attachments } = payload;
  const channels = payload.channels || ["email", "whatsapp"];
  if (!user) return [{ channel: "all", status: "SKIPPED", detail: "No recipient" }];

  const prefs = user.communicationPreferences || { email: true, sms: true, whatsapp: true };
  const email = user.email;
  const phone = toE164(user.phone);

  const jobs = [];
  if (channels.includes("email") && prefs.email !== false) {
    jobs.push(sendEmail({ to: email, subject, body, html, attachments }));
  } else if (channels.includes("email")) {
    jobs.push(Promise.resolve({ channel: "email", status: "SKIPPED", detail: "Customer opted out of email" }));
  }

  if (channels.includes("whatsapp") && prefs.whatsapp !== false) {
    jobs.push(sendWhatsApp({ to: phone, body }));
  } else if (channels.includes("whatsapp")) {
    jobs.push(Promise.resolve({ channel: "whatsapp", status: "SKIPPED", detail: "Customer opted out of WhatsApp" }));
  }

  if (channels.includes("sms") && prefs.sms !== false) {
    jobs.push(sendSms({ to: phone, body }));
  }

  const settled = await Promise.allSettled(jobs);
  return settled.map((entry, index) =>
    entry.status === "fulfilled"
      ? entry.value
      : { channel: "unknown", status: "FAILED", detail: entry.reason?.message || "send failed", index }
  );
};

/** Compact "₹4,500" style formatting used in message bodies. */
const money = (value) => `Rs.${Number(value || 0).toLocaleString("en-IN")}`;

module.exports = {
  sendNotification,
  getChannelStatus,
  isEmailConfigured: hasEmailConfig,
  isWhatsAppConfigured,
  toE164,
  money,
};
