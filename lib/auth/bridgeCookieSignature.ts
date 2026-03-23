const AUTH_BRIDGE_COOKIE_VERSION = "v1";

export type BridgeCookiePayload = {
  accessToken: string;
  issuedAt: number;
};

function normalizeSecret(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

export function resolveBridgeCookieSecret(): string {
  const explicit = normalizeSecret(process.env.AUTH_BRIDGE_COOKIE_SECRET);
  if (explicit) return explicit;

  const fallback = normalizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (fallback) return fallback;

  if (process.env.NODE_ENV !== "production") {
    return "dev-only-auth-bridge-cookie-secret";
  }
  return "";
}

function toBase64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toBase64UrlFromText(text: string): string {
  return toBase64UrlFromBytes(new TextEncoder().encode(text));
}

function fromBase64UrlToArrayBuffer(value: string): ArrayBuffer | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    const binary = atob(normalized + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } catch {
    return null;
  }
}

function fromBase64UrlToText(value: string): string | null {
  const buffer = fromBase64UrlToArrayBuffer(value);
  if (!buffer) return null;
  try {
    return new TextDecoder().decode(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function normalizePayload(value: unknown): BridgeCookiePayload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const accessToken = row.accessToken;
  const issuedAt = row.issuedAt;

  const normalizedAccessToken =
    typeof accessToken === "string" ? accessToken.trim() : "";
  const normalizedIssuedAt = typeof issuedAt === "number" && Number.isFinite(issuedAt) ? issuedAt : null;

  if (!normalizedAccessToken) return null;
  if (normalizedIssuedAt === null) return null;
  return {
    accessToken: normalizedAccessToken,
    issuedAt: normalizedIssuedAt,
  };
}

export async function signBridgeCookiePayload(args: {
  payload: BridgeCookiePayload;
  secret: string;
}): Promise<string> {
  const key = await importSigningKey(args.secret);
  const encodedPayload = toBase64UrlFromText(JSON.stringify(args.payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload)
  );
  const encodedSignature = toBase64UrlFromBytes(new Uint8Array(signature));
  return `${AUTH_BRIDGE_COOKIE_VERSION}.${encodedPayload}.${encodedSignature}`;
}

export async function verifyBridgeCookieValue(args: {
  cookieValue: string;
  secret: string;
}): Promise<BridgeCookiePayload | null> {
  const parts = args.cookieValue.split(".");
  if (parts.length !== 3) return null;

  const [version, encodedPayload, encodedSignature] = parts;
  if (version !== AUTH_BRIDGE_COOKIE_VERSION) return null;

  const signatureBuffer = fromBase64UrlToArrayBuffer(encodedSignature);
  if (!signatureBuffer) return null;

  const key = await importSigningKey(args.secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBuffer,
    new TextEncoder().encode(encodedPayload)
  );
  if (!ok) return null;

  const payloadText = fromBase64UrlToText(encodedPayload);
  if (!payloadText) return null;

  try {
    const parsed = JSON.parse(payloadText) as unknown;
    return normalizePayload(parsed);
  } catch {
    return null;
  }
}
