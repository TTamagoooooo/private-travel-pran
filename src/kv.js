// Thin helpers around the Cloudflare KV binding. No external service, no API
// keys — just a namespace bound to this Worker (see README).

export async function getJSON(env, key, fallback) {
  if (!env.HOTEL_KV) throw new Error("HOTEL_KV(KV namespace binding)が設定されていません");
  const raw = await env.HOTEL_KV.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function putJSON(env, key, value) {
  if (!env.HOTEL_KV) throw new Error("HOTEL_KV(KV namespace binding)が設定されていません");
  await env.HOTEL_KV.put(key, JSON.stringify(value));
}

export async function deleteKey(env, key) {
  if (!env.HOTEL_KV) throw new Error("HOTEL_KV(KV namespace binding)が設定されていません");
  await env.HOTEL_KV.delete(key);
}
