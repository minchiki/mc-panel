import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDb, run } from "../db/index.js";
import { confirmEmailMail, resetPasswordMail } from "../lib/mailer.js";
import {
  canSendReset,
  checkReset,
  consumeReset,
  createEmailVerification,
  createReset,
  failResetAttempt,
  MAX_TOTP_ATTEMPTS,
  pendingEmail,
  RESET_TTL_MS,
  resetLink,
  takeEmailVerification,
  VERIFY_TTL_MS,
} from "./passwordReset.js";
import { createUser, emailTaken, findByVerifiedEmail, getUser, setVerifiedEmail } from "./users.js";

let uid = 0;
beforeAll(async () => {
  openDb(mkdtempSync(join(tmpdir(), "mcp-reset-")));
  uid = (await createUser({ username: "steve", email: "steve@example.com", password: "long-password-1", role: "user" })).id;
});

describe("password reset links", () => {
  it("work once and only before they expire", () => {
    const now = Date.now();
    const token = createReset(uid, "1.2.3.4", now);
    expect(checkReset(token, now)).toBe(uid);
    expect(checkReset(token, now + RESET_TTL_MS + 1)).toBeNull();
    expect(consumeReset(token, now)).toBe(uid);
    expect(consumeReset(token, now)).toBeNull();
    expect(checkReset(token, now)).toBeNull();
  });

  it("a new link cancels the older one", () => {
    const now = Date.now();
    const first = createReset(uid, "1.2.3.4", now);
    const second = createReset(uid, "1.2.3.4", now + 1);
    expect(checkReset(first, now + 2)).toBeNull();
    expect(checkReset(second, now + 2)).toBe(uid);
  });

  it("burns after too many wrong 2FA codes", () => {
    const token = createReset(uid, "1.2.3.4");
    for (let i = 1; i < MAX_TOTP_ATTEMPTS; i++) expect(failResetAttempt(token)).toBe(MAX_TOTP_ATTEMPTS - i);
    expect(failResetAttempt(token)).toBe(0);
    expect(checkReset(token)).toBeNull();
    expect(consumeReset(token)).toBeNull();
  });

  it("limits how often one account gets mail", () => {
    run("DELETE FROM password_resets");
    const now = 10_000_000_000;
    expect(canSendReset(uid, now)).toBe(true);
    createReset(uid, "ip", now);
    expect(canSendReset(uid, now + 30_000)).toBe(false);
    for (let i = 1; i < 5; i++) createReset(uid, "ip", now + i * 120_000);
    expect(canSendReset(uid, now + 10 * 120_000)).toBe(false);
    expect(canSendReset(uid, now + 3600_000 + 5 * 120_000)).toBe(true);
  });

  it("rejects garbage tokens and keeps the token out of the query string", () => {
    expect(checkReset("../../etc")).toBeNull();
    expect(checkReset("")).toBeNull();
    expect(resetLink("https://panel.example/", "abc")).toBe("https://panel.example/reset-password#token=abc");
  });
});

describe("email confirmation", () => {
  it("binds the address only after the link is opened, once", () => {
    setVerifiedEmail(uid, null);
    const token = createEmailVerification(uid, "new@example.com");
    expect(pendingEmail(uid)).toBe("new@example.com");
    expect(findByVerifiedEmail("new@example.com")).toBeUndefined();
    expect(takeEmailVerification(token)).toEqual({ userId: uid, email: "new@example.com" });
    expect(takeEmailVerification(token)).toBeNull();
    setVerifiedEmail(uid, "new@example.com");
    expect(findByVerifiedEmail("new@example.com")?.id).toBe(uid);
    expect(getUser(uid).email_verified).toBe(1);
  });

  it("expires and is replaced by a newer request", () => {
    const now = Date.now();
    const a = createEmailVerification(uid, "a@example.com", now);
    const b = createEmailVerification(uid, "b@example.com", now);
    expect(takeEmailVerification(a, now)).toBeNull();
    expect(takeEmailVerification(b, now + VERIFY_TTL_MS + 1)).toBeNull();
  });

  it("an unconfirmed address can't receive resets and is reported as taken correctly", async () => {
    const other = await createUser({ username: "alex", email: "alex@example.com", password: "long-password-2", role: "user" });
    expect(getUser(other.id).email_verified).toBe(0);
    expect(findByVerifiedEmail("alex@example.com")).toBeUndefined();
    expect(emailTaken("alex@example.com", uid)).toBe(true);
    expect(emailTaken("alex@example.com", other.id)).toBe(false);
    const byAdmin = await createUser({ username: "admin2", email: "boss@example.com", password: "long-password-3", role: "admin", emailVerified: true });
    expect(findByVerifiedEmail("boss@example.com")?.id).toBe(byAdmin.id);
  });
});

describe("mail templates", () => {
  const brand = { panelName: "MC <Panel>", panelUrl: "https://panel.example" };
  it("escape user-controlled text and carry a plain-text twin", () => {
    const m = resetPasswordMail(brand, { username: "<img src=x onerror=alert(1)>", link: "https://panel.example/reset-password#token=abc", minutes: 30, ip: "1.2.3.4" });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;img src=x");
    expect(m.html).toContain("MC &lt;Panel&gt;");
    expect(m.text).toContain("https://panel.example/reset-password#token=abc");
    expect(m.subject).toBe("Сброс пароля в MC <Panel>");
  });

  it("confirmation mail links to the confirm page", () => {
    const m = confirmEmailMail(brand, { username: "steve", link: "https://panel.example/confirm-email#token=t", hours: 24 });
    expect(m.html).toContain("https://panel.example/confirm-email#token=t");
    expect(m.html).toContain("https://panel.example/apple-touch-icon.png");
  });
});
