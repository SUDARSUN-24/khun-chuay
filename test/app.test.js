// End-to-end: real HTTP requests into the app, signed like LINE signs them,
// with fake LINE / storage / internet. Covers the full journeys users take.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { FakeKV, fakeFetch, fakeLine } from "./fakes.js";

const SECRET = "test-channel-secret";
const ORIGIN = "https://khun-chuay.example.workers.dev";
const NAMES = { Uaom: "Aom", Umai: "Mai", Uton: "Ton", Ubeam: "Beam" };

function setup(opts = {}) {
  const kv = new FakeKV();
  const line = fakeLine(NAMES);
  const app = createApp({ kv, line, secret: SECRET, fetchFn: fakeFetch(opts), now: () => new Date("2026-11-12T00:00:00Z") });
  let n = 0;
  async function send(events) {
    const body = JSON.stringify({ destination: "Ubot", events });
    const sig = createHmac("sha256", SECRET).update(body).digest("base64");
    const res = await app.handleRequest(new Request(`${ORIGIN}/webhook`, {
      method: "POST", body, headers: { "x-line-signature": sig },
    }));
    assert.equal(res.status, 200);
  }
  const src = (userId, groupId) => (groupId ? { type: "group", groupId, userId } : { type: "user", userId });
  async function say(userId, textMsg, groupId) {
    const before = line.sent.length;
    await send([{ type: "message", replyToken: `r${++n}`, source: src(userId, groupId), message: { type: "text", id: String(n), text: textMsg } }]);
    return line.sent.slice(before).map((s) => s.messages[0]);
  }
  async function tap(userId, data, groupId) {
    const before = line.sent.length;
    await send([{ type: "postback", replyToken: `r${++n}`, source: src(userId, groupId), postback: { data } }]);
    return line.sent.slice(before).map((s) => s.messages[0]);
  }
  async function shareLocation(userId, lat, lon, groupId) {
    const before = line.sent.length;
    await send([{ type: "message", replyToken: `r${++n}`, source: src(userId, groupId),
      message: { type: "location", id: String(n), latitude: lat, longitude: lon, address: "Bangkok" } }]);
    return line.sent.slice(before).map((s) => s.messages[0]);
  }
  return { app, kv, line, say, tap, shareLocation };
}

test("rejects webhooks that are not signed by LINE", async () => {
  const { app, line } = setup();
  const res = await app.handleRequest(new Request(`${ORIGIN}/webhook`, {
    method: "POST", body: JSON.stringify({ events: [] }), headers: { "x-line-signature": "forged" },
  }));
  assert.equal(res.status, 401);
  assert.equal(line.sent.length, 0);
});

test("LINE's 'Verify' button (empty events) gets 200", async () => {
  const { app } = setup();
  const body = JSON.stringify({ destination: "U", events: [] });
  const sig = createHmac("sha256", SECRET).update(body).digest("base64");
  const res = await app.handleRequest(new Request(`${ORIGIN}/webhook`, { method: "POST", body, headers: { "x-line-signature": sig } }));
  assert.equal(res.status, 200);
});

test("group bill split: set PromptPay, split with VAT+SC, friends pay, status", async () => {
  const { app, say, tap } = setup();
  const G = "Cgroup1";

  let [r] = await say("Uaom", "หาร 1850 4", G);
  assert.match(r.text, /ตั้งพร้อมเพย์/); // must set PromptPay first

  [r] = await say("Uaom", "ตั้งพร้อมเพย์ 081-234-5678", G);
  assert.match(r.text, /081-xxx-5678/);

  [r] = await say("Uaom", "หาร 1,000 3 คน vat sc", G);
  assert.equal(r.type, "flex");
  assert.match(r.altText, /฿392\.34/);
  const qrUrl = r.contents.hero.url;
  assert.ok(qrUrl.startsWith(`${ORIGIN}/qr/`));
  const billId = r.contents.footer.contents[0].action.data.split("|")[1];

  // The QR image link LINE will fetch really serves a PNG...
  const img = await app.handleRequest(new Request(qrUrl));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  // ...and a tampered link is refused.
  const bad = await app.handleRequest(new Request(qrUrl.replace(/s=\w+/, "s=0000000000000000")));
  assert.equal(bad.status, 403);

  [r] = await tap("Uaom", `paid|${billId}`, G);
  assert.match(r.text, /คนออกเงิน/); // payer can't pay themselves

  [r] = await tap("Umai", `paid|${billId}`, G);
  assert.match(r.text, /Mai จ่ายแล้ว \(2\/3\)/);
  [r] = await tap("Umai", `paid|${billId}`, G);
  assert.match(r.text, /บันทึกไว้แล้ว/); // no double counting

  [r] = await say("Uaom", "ใครยังไม่จ่าย", G);
  assert.match(r.text, /✅ Aom\n✅ Mai/);
  assert.match(r.text, /เหลืออีก 1 คน/);

  [r] = await tap("Uton", `paid|${billId}`, G);
  assert.match(r.text, /3\/3/);
  assert.match(r.text, /จ่ายครบทุกคนแล้ว/);

  [r] = await tap("Ubeam", `paid|${billId}`, G);
  assert.match(r.text, /จ่ายครบแล้ว/);
});

test("English commands and quick PromptPay QR", async () => {
  const { say } = setup();
  let [r] = await say("Umai", "promptpay 0961234567");
  assert.match(r.text, /096-xxx-4567 saved/);
  [r] = await say("Umai", "qr 500");
  assert.equal(r.type, "flex");
  assert.match(r.altText, /฿500/);
  [r] = await say("Umai", "split 1850");
  assert.match(r.text, /How many people/);
  [r] = await say("Umai", "split 1850 4");
  assert.match(r.altText, /฿462\.50 each/);
  [r] = await say("Umai", "my promptpay");
  assert.match(r.text, /096-xxx-4567/);
  [r] = await say("Umai", "delete promptpay");
  [r] = await say("Umai", "qr 100");
  assert.match(r.text, /haven't set your PromptPay/);
});

test("air + rain: asks for location, then reports from the nearest station", async () => {
  const { say, shareLocation } = setup({ rainy: true });
  let [r] = await say("Umai", "ฝุ่น");
  assert.match(r.text, /ส่งตำแหน่ง/);
  assert.equal(r.quickReply.items[0].action.type, "location");

  [r] = await shareLocation("Umai", 13.665, 100.61); // near Bang Na
  assert.match(r.text, /สถานีบางนา/);
  assert.match(r.text, /31 µg\/m³/);
  assert.match(r.text, /🟡/);
  assert.match(r.text, /☔ โอกาสฝนตก 80% ช่วง 09:00–10:00/);
  assert.match(r.text, /รู้สึกเหมือน 37°C/);

  [r] = await say("Umai", "air");
  assert.match(r.text, /Bang Na station/);
  assert.doesNotMatch(r.text, /Rain/);
  [r] = await say("Umai", "rain");
  assert.match(r.text, /80% chance of rain around 09:00–10:00/);
});

test("falls back to the air model when the station feed is down or stale", async () => {
  // Station server unreachable (e.g. its broken certificate chain).
  const kv = new FakeKV();
  const line = fakeLine(NAMES);
  const ok = fakeFetch();
  const fetchFn = async (url) => (String(url).includes("air4thai") ? Promise.reject(new Error("TLS")) : ok(url));
  const app = createApp({ kv, line, secret: SECRET, fetchFn, now: () => new Date("2026-11-12T00:00:00Z") });
  await app.handleEvents([{ type: "message", replyToken: "x", source: { type: "user", userId: "Umai" },
    message: { type: "location", latitude: 13.665, longitude: 100.61 } }], ORIGIN);
  let r = line.sent.at(-1).messages[0];
  assert.match(r.text, /48 µg\/m³/);
  assert.match(r.text, /ค่าประมาณจากแบบจำลอง/);

  // Station readings 5 hours old: don't present them as "now".
  const { say, shareLocation } = setup();
  const stale = createApp({ kv: new FakeKV(), line, secret: SECRET, fetchFn: fakeFetch(), now: () => new Date("2026-11-12T05:00:00Z") });
  await stale.handleEvents([{ type: "message", replyToken: "y", source: { type: "user", userId: "Umai" },
    message: { type: "location", latitude: 13.665, longitude: 100.61 } }], ORIGIN);
  r = line.sent.at(-1).messages[0];
  assert.doesNotMatch(r.text, /สถานีบางนา/);
  assert.match(r.text, /แบบจำลอง/);
});

test("daily + rain alerts are pushed on schedule, once", async () => {
  const { app, kv, line, say, shareLocation } = setup({ rainy: true });
  await shareLocation("Umai", 13.73, 100.54);
  let [r] = await say("Umai", "แจ้งเตือน 7 โมง");
  assert.match(r.text, /07:00/);
  [r] = await say("Umai", "เตือนฝน");
  assert.match(r.text, /เปิดเตือนฝน/);
  assert.ok(await kv.get("sub:07:Umai"));

  const before = line.sent.length;
  const sent = await app.runSchedule(new Date("2026-11-12T00:00:00Z")); // 07:00 in Bangkok
  assert.deepEqual(sent, { daily: 1, rain: 1 });
  const pushes = line.sent.slice(before);
  assert.match(pushes[0].messages[0].text, /สรุปอากาศวันนี้[\s\S]*สถานีสวนลุมพินี/);
  assert.match(pushes[1].messages[0].text, /ฝนกำลังจะมา/);

  // An hour later: not 7am any more, and rain was already announced (6h cool-down).
  assert.deepEqual(await app.runSchedule(new Date("2026-11-12T01:00:00Z")), { daily: 0, rain: 0 });

  [r] = await say("Umai", "ปิดแจ้งเตือน");
  assert.equal(await kv.get("sub:07:Umai"), null);
  assert.equal(await kv.get("rain:Umai"), null);
});

test("stays quiet in groups for normal chatter, helps in private", async () => {
  const { say } = setup();
  assert.equal((await say("Umai", "555 กินไรดี", "Cgroup1")).length, 0);
  const [r] = await say("Umai", "what's up");
  assert.match(r.text, /help/);
});
