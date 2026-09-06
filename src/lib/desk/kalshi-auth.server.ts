/**
 * Kalshi API request signing (server only). Kalshi authenticates every REST
 * call and websocket handshake with three headers: the API key id, a
 * millisecond timestamp, and an RSA-PSS/SHA-256 signature over
 * `${timestamp}${METHOD}${path}` (path without the query string).
 *
 * Fail closed: without KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY nothing is
 * signed and callers decide whether an unauthenticated attempt makes sense.
 * The private key may be pasted as a PEM (real newlines or literal "\n")
 * or as base64 of the PEM.
 */
import { constants, createPrivateKey, sign, type KeyObject } from "node:crypto";

type Loaded = { id: string; key: KeyObject } | null;
let cached: Loaded | undefined;

function loadKey(): Loaded {
  if (cached !== undefined) return cached;
  const id = (process.env.KALSHI_API_KEY_ID ?? "").trim();
  let pem = (process.env.KALSHI_PRIVATE_KEY ?? "").trim();
  if (!id || !pem) {
    cached = null;
    return cached;
  }
  if (!pem.includes("-----BEGIN")) {
    try {
      const decoded = Buffer.from(pem, "base64").toString("utf8").trim();
      if (decoded.includes("-----BEGIN")) pem = decoded;
    } catch {
      /* keep as-is */
    }
  }
  pem = pem.replace(/\\n/g, "\n");
  try {
    cached = { id, key: createPrivateKey(pem) };
  } catch (err) {
    console.error(`[kalshi] private key unreadable: ${err instanceof Error ? err.message : String(err)}`);
    cached = null;
  }
  return cached;
}

export function kalshiConfigured(): boolean {
  return loadKey() !== null;
}

export function kalshiKeyId(): string {
  return loadKey()?.id ?? "";
}

/** Signed headers for one request, or null when no key is configured. */
export function kalshiHeaders(method: string, path: string, nowMs = Date.now()): Record<string, string> | null {
  const k = loadKey();
  if (!k) return null;
  const ts = String(nowMs);
  const payload = Buffer.from(`${ts}${method.toUpperCase()}${path}`);
  const sig = sign("sha256", payload, {
    key: k.key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
  return {
    "KALSHI-ACCESS-KEY": k.id,
    "KALSHI-ACCESS-SIGNATURE": sig,
    "KALSHI-ACCESS-TIMESTAMP": ts,
  };
}
