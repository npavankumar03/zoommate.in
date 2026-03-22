import crypto from "crypto";

const ENC_PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  const seed =
    process.env.SETTINGS_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    "local-dev-fallback-key";
  return crypto.createHash("sha256").update(seed).digest();
}

export function encryptSettingValue(plainText: string): string {
  if (!plainText) return plainText;
  if (plainText.startsWith(ENC_PREFIX)) return plainText;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString("base64")}.${encrypted.toString("base64")}.${authTag.toString("base64")}`;
}

export function decryptSettingValue(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;

  try {
    const payload = value.slice(ENC_PREFIX.length);
    const [ivB64, encryptedB64, authTagB64] = payload.split(".");
    if (!ivB64 || !encryptedB64 || !authTagB64) return null;

    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, "base64");
    const encrypted = Buffer.from(encryptedB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
