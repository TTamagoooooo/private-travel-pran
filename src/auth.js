// Signed session tokens, no external dependencies (uses the runtime's Web Crypto).

async function hmac(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createSession(secret, days = 30) {
  const expires = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = String(expires);
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token, secret) {
  if (!token || !secret) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await hmac(secret, payload);
  if (sig !== expected) return false;
  return Number(payload) > Date.now();
}
