import nodemailer from "nodemailer";
import { getSettings, type PanelSettings } from "./settings.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type SmtpSettings = Pick<PanelSettings, "smtpHost" | "smtpPort" | "smtpUser" | "smtpPass" | "smtpFrom" | "panelName">;

/** "From": the configured one, or the panel name with the mailbox login. */
export function fromAddress(s: SmtpSettings): string {
  if (s.smtpFrom) return s.smtpFrom;
  return s.smtpUser ? `"${s.panelName.replace(/["\\]/g, "")}" <${s.smtpUser}>` : "";
}

const isLocal = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "::1";

/** Sends one email through the SMTP server from the admin settings. Throws with a readable reason. */
export async function sendMail(mail: Mail, s: SmtpSettings = getSettings()): Promise<void> {
  const from = fromAddress(s);
  if (!s.smtpHost || !from) throw new Error("Почта не настроена: укажите SMTP-сервер и логин ящика");
  const transport = nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    // 587 must upgrade to TLS; a relay on the same machine may speak plain SMTP.
    requireTLS: s.smtpPort !== 465 && s.smtpPort !== 25 && !isLocal(s.smtpHost),
    auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (err) {
    throw new Error(explainSmtpError(err));
  } finally {
    transport.close();
  }
}

/** Turns nodemailer errors into something an admin can act on. */
export function explainSmtpError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  if (e.code === "EAUTH" || e.responseCode === 535) return "SMTP отклонил логин или пароль. Для Яндекса, Mail.ru и Gmail нужен «пароль приложения», а не обычный пароль от почты.";
  if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION" || e.code === "ESOCKET") return `Не удалось подключиться к SMTP-серверу (${e.code}). Проверьте адрес и порт: обычно 465 или 587.`;
  if (e.code === "EENVELOPE" || e.responseCode === 553 || e.responseCode === 550) return `Сервер не принял письмо: ${e.message ?? ""}. Адрес отправителя должен совпадать с ящиком, под которым вы входите.`;
  return `Ошибка отправки почты: ${e.message ?? String(err)}`;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface MailBrand {
  panelName: string;
  /** Public panel address; the logo is loaded from it and it is linked in the footer. */
  panelUrl: string;
}

interface Block {
  /** Hidden first line most clients show in the inbox list. */
  preheader: string;
  title: string;
  /** Paragraphs, already HTML-escaped by the caller. */
  paragraphs: string[];
  button?: { text: string; url: string };
  /** Small green chips under the button, e.g. "действует 30 минут". */
  chips?: string[];
  /** Key/value rows in a light box (account, time, IP). */
  details?: [string, string][];
  /** Grey note at the bottom of the card, already escaped. */
  note?: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
const B = (s: string) => `<b style="color:#0f172a">${escapeHtml(s)}</b>`;

/** One look for every email: light card, dark-green header with the logo, big green button, plain-text twin. */
export function renderMail(brand: MailBrand, b: Block): string {
  const site = brand.panelUrl.replace(/\/+$/, "");
  const name = escapeHtml(brand.panelName);
  const logo = site ? `<img src="${escapeHtml(site)}/apple-touch-icon.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px">` : "";
  const paragraphs = b.paragraphs.map((p) => `<p style="margin:0 0 14px;font:15px/1.6 ${FONT};color:#334155">${p}</p>`).join("");
  const button = b.button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 12px"><tr><td style="border-radius:12px;background:#16a34a">
<a href="${escapeHtml(b.button.url)}" style="display:inline-block;padding:15px 30px;font:700 16px ${FONT};color:#ffffff;text-decoration:none;border-radius:12px">${escapeHtml(b.button.text)}</a>
</td></tr></table>`
    : "";
  const chips = b.chips?.length
    ? `<p style="margin:0 0 18px">${b.chips.map((c) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 11px;border-radius:999px;background:#ecfdf3;color:#15803d;font:600 12px ${FONT}">${escapeHtml(c)}</span>`).join("")}</p>`
    : "";
  const fallback = b.button
    ? `<p style="margin:4px 0 6px;font:12px/1.5 ${FONT};color:#64748b">Кнопка не нажимается? Скопируйте ссылку в браузер:</p>
<p style="margin:0 0 18px;padding:10px 12px;border-radius:10px;background:#f1f5f9;font:12px/1.5 Consolas,Menlo,monospace;color:#0f172a;word-break:break-all">${escapeHtml(b.button.url)}</p>`
    : "";
  const details = b.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0">
${b.details.map(([k, v]) => `<tr><td style="padding:9px 14px;font:13px ${FONT};color:#64748b;width:38%">${escapeHtml(k)}</td><td style="padding:9px 14px;font:600 13px ${FONT};color:#0f172a">${escapeHtml(v)}</td></tr>`).join("")}
</table>`
    : "";
  const note = b.note ? `<p style="margin:8px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font:13px/1.55 ${FONT};color:#64748b">${b.note}</p>` : "";
  const siteLink = site ? ` · <a href="${escapeHtml(site)}" style="color:#16a34a;text-decoration:none">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a>` : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(b.title)}</title></head>
<body style="margin:0;padding:0;background:#eef3ef">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(b.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ef"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
<tr><td style="border-radius:20px 20px 0 0;background:#052e16;background-image:linear-gradient(135deg,#052e16 0%,#14532d 60%,#166534 100%);padding:22px 28px">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>${logo ? `<td style="padding-right:12px">${logo}</td>` : ""}
<td style="font:800 18px ${FONT};color:#ffffff;letter-spacing:-.2px">${name}<div style="font:500 12px ${FONT};color:#86efac;letter-spacing:0">Minecraft-серверы</div></td></tr></table>
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:30px 28px 26px;box-shadow:0 10px 30px rgba(5,46,22,.08)">
<h1 style="margin:0 0 16px;font:800 23px/1.25 ${FONT};color:#0f172a;letter-spacing:-.3px">${escapeHtml(b.title)}</h1>
${paragraphs}${button}${chips}${fallback}${details}${note}
</td></tr>
<tr><td align="center" style="padding:18px 8px 0;font:12px/1.6 ${FONT};color:#94a3b8">
Письмо отправила панель ${name}${siteLink}<br>
Помощь: <a href="https://t.me/faqmcpanel_bot" style="color:#16a34a;text-decoration:none">@faqmcpanel_bot</a> · новости: <a href="https://t.me/huicoding" style="color:#16a34a;text-decoration:none">t.me/huicoding</a>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: process.env.TZ || "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const textFooter = (brand: MailBrand) => `\n\n—\n${brand.panelName}${brand.panelUrl ? ` · ${brand.panelUrl}` : ""}\nПомощь: https://t.me/faqmcpanel_bot`;
const notYou = (what: string) => `<b style="color:#b91c1c">Это были не вы?</b> ${what}`;

export function resetPasswordMail(brand: MailBrand, o: { username: string; link: string; minutes: number; ip: string; now?: Date }): Omit<Mail, "to"> {
  const t = when(o.now ?? new Date());
  return {
    subject: `Сброс пароля в ${brand.panelName}`,
    text: `Здравствуйте, ${o.username}!\n\nВы попросили сбросить пароль. Новый пароль можно задать по ссылке (действует ${o.minutes} минут, сработает один раз):\n${o.link}\n\nЕсли это были не вы, просто удалите письмо: пароль не изменится.\nЗапрос: ${t}, адрес ${o.ip}.${textFooter(brand)}`,
    html: renderMail(brand, {
      preheader: `Ссылка для нового пароля действует ${o.minutes} минут`,
      title: "Сброс пароля 🔑",
      paragraphs: [`Здравствуйте, ${B(o.username)}!`, "Вы попросили сбросить пароль от панели. Нажмите кнопку и придумайте новый."],
      button: { text: "Задать новый пароль", url: o.link },
      chips: [`⏱ действует ${o.minutes} минут`, "🔒 сработает один раз"],
      details: [
        ["Аккаунт", o.username],
        ["Когда", t],
        ["IP-адрес", o.ip],
      ],
      note: "Если вы ничего не запрашивали, просто удалите письмо: пароль не изменится, а ссылка сама перестанет работать.",
    }),
  };
}

export function passwordChangedMail(brand: MailBrand, o: { username: string; ip: string; now?: Date }): Omit<Mail, "to"> {
  const t = when(o.now ?? new Date());
  return {
    subject: `Пароль в ${brand.panelName} изменён`,
    text: `Пароль от аккаунта «${o.username}» изменён (${t}, адрес ${o.ip}). Все входы на других устройствах завершены.\n\nЕсли это были не вы, сразу сбросьте пароль ещё раз и напишите администратору панели.${textFooter(brand)}`,
    html: renderMail(brand, {
      preheader: "Все входы на других устройствах завершены",
      title: "Пароль изменён ✅",
      paragraphs: [`Пароль от аккаунта ${B(o.username)} только что изменён. Все входы на других устройствах завершены.`],
      details: [
        ["Когда", t],
        ["IP-адрес", o.ip],
      ],
      button: brand.panelUrl ? { text: "Открыть панель", url: brand.panelUrl } : undefined,
      note: notYou("Сразу сбросьте пароль ещё раз через «Забыли пароль?» на странице входа и напишите администратору панели."),
    }),
  };
}

export function confirmEmailMail(brand: MailBrand, o: { username: string; link: string; hours: number }): Omit<Mail, "to"> {
  return {
    subject: `Подтвердите почту в ${brand.panelName}`,
    text: `Здравствуйте, ${o.username}!\n\nПодтвердите, что это ваша почта: тогда, если забудете пароль, сможете восстановить его сюда.\n${o.link}\n\nСсылка действует ${o.hours} часа. Если вы не добавляли эту почту, просто удалите письмо.${textFooter(brand)}`,
    html: renderMail(brand, {
      preheader: "Одна кнопка, и пароль можно будет восстановить по почте",
      title: "Подтвердите почту ✉️",
      paragraphs: [`Здравствуйте, ${B(o.username)}!`, "Вы добавили эту почту в панель. Подтвердите её: тогда, если забудете пароль, восстановите его сюда за минуту."],
      button: { text: "Подтвердить почту", url: o.link },
      chips: [`⏱ действует ${o.hours} часа`],
      note: "Если вы не добавляли эту почту, просто удалите письмо: без подтверждения она к аккаунту не привяжется.",
    }),
  };
}

export function emailChangedMail(brand: MailBrand, o: { username: string; newEmail: string | null }): Omit<Mail, "to"> {
  const masked = o.newEmail ? o.newEmail.replace(/^(.)[^@]*(@.*)$/, "$1***$2") : null;
  return {
    subject: `Почта аккаунта в ${brand.panelName} изменена`,
    text: `Почта аккаунта «${o.username}» ${masked ? `изменена на ${masked}` : "удалена"}. Письма о сбросе пароля сюда больше не придут.\n\nЕсли это были не вы, напишите администратору панели.${textFooter(brand)}`,
    html: renderMail(brand, {
      preheader: "Письма о сбросе пароля сюда больше не придут",
      title: "Почта аккаунта изменена",
      paragraphs: [`Почта аккаунта ${B(o.username)} ${masked ? `изменена на ${B(masked)}` : "удалена"}. Письма о сбросе пароля сюда больше не придут.`],
      note: notYou("Напишите администратору панели: он вернёт доступ."),
    }),
  };
}

export function testMail(brand: MailBrand): Omit<Mail, "to"> {
  return {
    subject: `Проверка почты ${brand.panelName}`,
    text: `Это тестовое письмо. Раз вы его читаете, почта настроена правильно и сброс пароля по почте работает.${textFooter(brand)}`,
    html: renderMail(brand, {
      preheader: "Почта настроена правильно",
      title: "Почта работает 🎉",
      paragraphs: ["Это тестовое письмо из настроек панели. Раз вы его читаете, отправка почты настроена правильно и пользователи смогут восстанавливать пароль."],
      button: brand.panelUrl ? { text: "Открыть панель", url: brand.panelUrl } : undefined,
    }),
  };
}
