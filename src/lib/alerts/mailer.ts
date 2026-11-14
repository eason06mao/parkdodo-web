// 系統通知信：用公司信箱的 SMTP 寄出（Gandi：mail.gandi.net:465）。
// 密碼放 Secret Manager（SMTP_PASS），其餘有預設值；沒設 SMTP_PASS 時只記錄在日誌、不寄信。
import nodemailer from "nodemailer";

export interface Mail { subject: string; text: string }
export type SendMail = (m: Mail) => Promise<boolean>;

export function mailConfig(env: Record<string, string | undefined> = process.env) {
  const user = env.SMTP_USER || "service@parkdodo.tw";
  return {
    host: env.SMTP_HOST || "mail.gandi.net",
    port: Number(env.SMTP_PORT || 465),
    user,
    pass: env.SMTP_PASS || "",
    from: env.ALERT_EMAIL_FROM || `ParkDodo 系統通知 <${user}>`,
    to: (env.ALERT_EMAIL_TO || "service@parkdodo.tw").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

export const sendAlertMail: SendMail = async (m) => {
  const cfg = mailConfig();
  if (!cfg.pass) { console.warn("[alert] 未設定 SMTP_PASS，不寄信：", m.subject); return false; }
  const t = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } });
  await t.sendMail({ from: cfg.from, to: cfg.to, subject: m.subject, text: m.text });
  return true;
};
