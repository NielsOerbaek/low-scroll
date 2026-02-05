import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-CBC encryption matching the Python scraper's cookies.py.
 * Uses the same key derivation: SHA-256 of the hex key bytes.
 */
export class Fernet {
  private key: Buffer;

  constructor(hexKey: string) {
    const keyBytes = Buffer.from(hexKey, "hex");
    this.key = createHash("sha256").update(keyBytes).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    // Store as: base64(iv + encrypted)
    return Buffer.concat([iv, encrypted]).toString("base64");
  }

  decrypt(token: string): string {
    const data = Buffer.from(token, "base64");
    const iv = data.subarray(0, 16);
    const encrypted = data.subarray(16);
    const decipher = createDecipheriv("aes-256-cbc", this.key, iv);
    return decipher.update(encrypted) + decipher.final("utf8");
  }
}
