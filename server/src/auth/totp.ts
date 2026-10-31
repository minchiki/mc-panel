import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

const ISSUER = "MC Panel";

function totpFor(username: string, secretBase32: string): TOTP {
  return new TOTP({ issuer: ISSUER, label: username, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
}

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export async function totpSetupData(username: string, secretBase32: string): Promise<{ uri: string; qrDataUrl: string }> {
  const uri = totpFor(username, secretBase32).toString();
  return { uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

export function verifyTotp(username: string, secretBase32: string, code: string): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return totpFor(username, secretBase32).validate({ token: clean, window: 1 }) !== null;
}
