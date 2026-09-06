/**
 * Kalshi API request signing (server only). Kalshi authenticates every REST
 * call and websocket handshake with three headers: the API key id, a
 * millisecond timestamp, and an RSA-PSS/SHA-256 signature over
 * `${timestamp}${METHOD}${path}` (path without the query string).
 *
 * Fail closed: with no usable key nothing is signed and callers decide
 * whether an unauthenticated attempt makes sense. The key id and private
 * key are looked up under the documented names first and then the common
 * variants people use, including a file path or a Render secret file
 * (/etc/secrets/*). The private key may be a PEM with real newlines or
 * literal "\n", or base64 of the PEM. Only variable NAMES are ever logged.
 */
import { constants, createPrivateKey, sign, type KeyObject } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ID_NAMES = ["KALSHI_API_KEY_ID", "KALSHI_KEY_ID", "KALSHI_ACCESS_KEY", "KALSHI_API_KEY", "KALSHI_KEY"];
const PEM_NAMES = [
  "KALSHI_PRIVATE_KEY",
  "KALSHI_PRIVATE_KEY_PEM",
  "KALSHI_PEM",
  "KALSHI_RSA_PRIVATE_KEY",
  "KALSHI_SECRET_KEY",
  "KALSHI_API_SECRET",
];
const PATH_NAMES = ["KALSHI_PRIVATE_KEY_PATH", "KALSHI_PRIVATE_KEY_FILE", "KALSHI_KEY_PATH", "KALSHI_KEY_FILE"];
const SECRET_DIRS = ["/etc/secrets"];

type Loaded = { id: string; key: KeyObject; id_from: string; key_from: string } | null;
let cached: Loaded | undefined;
let lastNote = "";

function looksLikePem(s: string): boolean {
  return s.includes("-----BEGIN");
}

function normalizePem(raw: string): string {
  let pem = raw.trim();
  if (!looksLikePem(pem)) {
    try {
      const decoded = Buffer.from(pem, "base64").toString("utf8").trim();
      if (looksLikePem(decoded)) pem = decoded;
    } catch {
      /* keep as-is */
    }
  }
  return pem.replace(/\\n/g, "\n");
}

function readPemFile(path: string): string | null {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    const text = readFileSync(path, "utf8");
    return looksLikePem(text) ? text : null;
  } catch {
    return null;
  }
}

function findPem(): { pem: string; from: string } | null {
  for (const name of PEM_NAMES) {
    const v = process.env[name]?.trim();
    if (!v) continue;
    // A file path pasted into the PEM slot still works.
    if (!looksLikePem(v) && v.length < 300 && v.startsWith("/")) {
      const t = readPemFile(v);
      if (t) return { pem: t, from: `${name} (path)` };
    }
    return { pem: v, from: name };
  }
  for (const name of PATH_NAMES) {
    const p = process.env[name]?.trim();
    if (!p) continue;
    const t = readPemFile(p);
    if (t) return { pem: t, from: `${name} → ${p}` };
  }
  for (const dir of SECRET_DIRS) {
    try {
      for (const f of readdirSync(dir)) {
        if (!KALSHI_FILE.test(f)) continue;
        const t = readPemFile(join(dir, f));
        if (t) return { pem: t, from: `${dir}/${f}` };
      }
    } catch {
      /* no secret dir */
    }
  }
  return null;
}

/** Secret files must say KALSHI in the name: the box also holds other
 *  services' keys (a CoinGlass key was picked up as the Kalshi id once). */
const KALSHI_FILE = /kalshi/i;
const ID_FILE_NAMES = /(key_?id|api_?key|access_?key|_id\b|id$)/i;
const ID_SHAPE = /^[A-Za-z0-9._:-]{8,128}$/;

function readIdFile(path: string): string | null {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    const text = readFileSync(path, "utf8").trim();
    if (!text || looksLikePem(text) || text.includes("\n")) return null;
    return ID_SHAPE.test(text) ? text : null;
  } catch {
    return null;
  }
}

function findId(): { id: string; from: string } | null {
  for (const name of ID_NAMES) {
    const v = process.env[name]?.trim();
    if (v && !looksLikePem(v)) return { id: v, from: name };
  }
  // A secret file holding just the id (Render "Secret Files" mount here).
  for (const dir of SECRET_DIRS) {
    try {
      for (const f of readdirSync(dir)) {
        if (!KALSHI_FILE.test(f) || !ID_FILE_NAMES.test(f)) continue;
        const id = readIdFile(join(dir, f));
        if (id) return { id, from: `${dir}/${f}` };
      }
    } catch {
      /* no secret dir */
    }
  }
  return null;
}

function secretFileNames(): string[] {
  const out: string[] = [];
  for (const dir of SECRET_DIRS) {
    try {
      for (const f of readdirSync(dir)) out.push(`${dir}/${f}`);
    } catch {
      /* no secret dir */
    }
  }
  return out;
}

function kalshiEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => k.toUpperCase().includes("KALSHI"))
    .sort();
}

function note(s: string): void {
  if (s === lastNote) return;
  lastNote = s;
  console.log(`[kalshi] ${s}`);
}

function loadKey(): Loaded {
  if (cached !== undefined) return cached;
  const id = findId();
  const pem = findPem();
  if (!id || !pem) {
    const names = kalshiEnvNames();
    note(
      `no usable API key — key id ${id ? `from ${id.from}` : "missing"}, private key ${pem ? `from ${pem.from}` : "missing"}; env names containing KALSHI: [${names.join(", ") || "none"}]; secret files: [${secretFileNames().join(", ") || "none"}]`,
    );
    cached = null;
    return cached;
  }
  try {
    cached = { id: id.id, key: createPrivateKey(normalizePem(pem.pem)), id_from: id.from, key_from: pem.from };
    note(`API key loaded — key id from ${id.from}, private key from ${pem.from}`);
  } catch (err) {
    note(`private key unreadable (from ${pem.from}): ${err instanceof Error ? err.message : String(err)}`);
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

/** Where the key came from (variable names only) and what else is in the env with KALSHI in the name. */
export function kalshiKeyInfo(): {
  configured: boolean;
  id_from: string | null;
  key_from: string | null;
  env_names: string[];
  secret_files: string[];
} {
  const k = loadKey();
  return {
    configured: k !== null,
    id_from: k?.id_from ?? null,
    key_from: k?.key_from ?? null,
    env_names: kalshiEnvNames(),
    secret_files: secretFileNames(),
  };
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
