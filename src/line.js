// Talking to LINE: check that a webhook really came from LINE, and send messages.

const API = "https://api.line.me/v2/bot";

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

// LINE signs every webhook with our channel secret. Anything else is rejected,
// so nobody can pretend to be LINE and make the bot do things.
export async function verifySignature(secret, body, signature) {
  if (!signature) return false;
  const expected = b64(await hmac(secret, body));
  if (expected.length !== signature.length) return false;
  let diff = 0; // constant-time compare
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export async function signHex(secret, data, len = 16) {
  return [...new Uint8Array(await hmac(secret, data))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

export function lineClient(token, fetchFn = fetch) {
  async function call(method, path, body) {
    const res = await fetchFn(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`LINE ${path} -> ${res.status} ${await res.text()}`);
    return res.headers.get("content-type")?.includes("json") ? res.json() : null;
  }
  return {
    reply: (replyToken, messages) => call("POST", "/message/reply", { replyToken, messages }),
    push: (to, messages) => call("POST", "/message/push", { to, messages }),
    async displayName(source) {
      const { userId, groupId, roomId } = source;
      if (!userId) return null;
      const path = groupId ? `/group/${groupId}/member/${userId}`
        : roomId ? `/room/${roomId}/member/${userId}` : `/profile/${userId}`;
      try { return (await call("GET", path)).displayName; } catch { return null; }
    },
  };
}
