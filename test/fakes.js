// Stand-ins for Cloudflare KV, the LINE API and the internet, used by the
// tests and by `npm run try`. Same shapes as the real things.
import { readFileSync } from "node:fs";

export class FakeKV {
  constructor(data = {}) { this.data = new Map(Object.entries(data)); }
  async get(key, type) {
    const v = this.data.get(key);
    if (v == null) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key, value) { this.data.set(key, String(value)); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix = "" } = {}) {
    return { keys: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
  toJSON() { return Object.fromEntries(this.data); }
}

export function fakeLine(names = {}) {
  const sent = [];
  return {
    sent,
    async reply(replyToken, messages) { sent.push({ kind: "reply", replyToken, messages }); },
    async push(to, messages) { sent.push({ kind: "push", to, messages }); },
    async displayName(src) { return names[src.userId] ?? null; },
  };
}

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// Answers the air/weather URLs with saved sample data, so tests are offline and repeatable.
export function fakeFetch({ rainy = false } = {}) {
  return async (url) => {
    const u = String(url);
    let body;
    if (u.includes("air4thai")) body = fixture("air4thai.json");
    else if (u.includes("air-quality-api")) body = fixture("meteo-air.json");
    else if (u.includes("api.open-meteo.com")) body = fixture(rainy ? "meteo-rainy.json" : "meteo-dry.json");
    else throw new Error("unexpected fetch " + u);
    return new Response(body, { headers: { "content-type": "application/json" } });
  };
}
