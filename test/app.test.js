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
    return line.sent.slice(before).flatMap((s) => s.messages);
  }
  async function tap(userId, data, groupId) {
    const before = line.sent.length;
    await send([{ type: "postback", replyToken: `r${++n}`, source: src(userId, groupId), postback: { data } }]);
    return line.sent.slice(before).flatMap((s) => s.messages);
  }
  async function shareLocation(userId, lat, lon, groupId) {
    const before = line.sent.length;
    await send([{ type: "message", replyToken: `r${++n}`, source: src(userId, groupId),
      message: { type: "location", id: String(n), latitude: lat, longitude: lon, address: "Bangkok" } }]);
    return line.sent.slice(before).flatMap((s) => s.messages);
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

// ---------- guided conversations (menu buttons) ----------
const buttons = (msg) => msg.quickReply?.items.map((i) => i.action) ?? [];
const button = (msg, label) => buttons(msg).find((a) => a.label.includes(label));

test("menu: a brand-new user splits a bill only by tapping buttons", async () => {
  const { say, tap } = setup();
  // Rich-menu button sends "💸 หารบิล"; no PromptPay yet, so it asks for that first.
  let [r] = await say("Umai", "💸 หารบิล");
  assert.match(r.text, /ขอพร้อมเพย์ของคุณก่อน/);
  [r] = await say("Umai", "แมว");                           // nonsense -> asks again
  assert.match(r.text, /ใช้ไม่ได้/);
  let replies = await say("Umai", "096 123 4567");
  assert.match(replies[0].text, /096-xxx-4567/);            // saved...
  assert.match(replies[1].text, /ยอดรวมทั้งบิลเท่าไหร่/);     // ...and straight on to the bill
  [r] = await say("Umai", "1,850 บาท");
  assert.match(r.text, /หาร ฿1,850 กี่คน/);
  assert.equal(buttons(r).length, 10);                      // 2..10 people + cancel
  [r] = await tap("Umai", button(r, "4 คน").data);
  assert.match(r.text, /เซอร์วิสหรือ VAT/);
  [r] = await tap("Umai", button(r, "เซอร์วิส+VAT").data);
  assert.equal(r.type, "flex");
  assert.match(r.altText, /คนละ ฿544\.37/);
  assert.ok(button(r, "ใครยังไม่จ่าย"));                     // next-step buttons under the card
  // "who hasn't paid" from the private chat finds the bill
  [r] = await say("Umai", "👀 ใครยังไม่จ่าย");
  assert.match(r.text, /เหลืออีก 3 คน/);
});

test("menu: typed answers work too, in English", async () => {
  const { say } = setup();
  await say("Uton", "promptpay 0891112222");
  let [r] = await say("Uton", "split bill");
  assert.match(r.text, /bill total/);
  [r] = await say("Uton", "900");
  [r] = await say("Uton", "3 people");
  assert.match(r.text, /service charge or VAT/);
  [r] = await say("Uton", "none");
  assert.match(r.altText, /฿300 each/);
});

test("menu: group chatter mid-flow is ignored, other people's taps too, cancel works", async () => {
  const { say, tap } = setup();
  const G = "Cdinner";
  await say("Uaom", "ตั้งพร้อมเพย์ 0812345678");
  let [r] = await say("Uaom", "หารบิล", G);
  assert.match(r.text, /ยอดรวม/);
  assert.equal((await say("Uaom", "555 อร่อยมาก", G)).length, 0);   // not an answer: stay quiet in groups
  [r] = await say("Uaom", "2400", G);
  const four = button(r, "4 คน").data;
  assert.equal((await tap("Umai", four, G)).length, 0);              // Mai can't answer Aom's question
  [r] = await tap("Uaom", four, G);
  assert.match(r.text, /VAT/);
  [r] = await say("Uaom", "ยกเลิก", G);
  assert.match(r.text, /ยกเลิกแล้ว/);
  [r] = await tap("Uaom", "f|extras|none", G);                       // old button after cancel: nothing happens
  assert.equal(r, undefined);
  // A new command in the middle of a flow just starts that command.
  await say("Uaom", "หารบิล");
  [r] = await say("Uaom", "ฝุ่น");
  assert.match(r.text, /ส่งตำแหน่ง/);
  [r] = await say("Uaom", "1850");                                   // flow was dropped, so this is unknown now
  assert.match(r.text, /ไม่เข้าใจ/);
});

test("menu: QR to receive money, and settings shows current state", async () => {
  const { say, shareLocation } = setup();
  let [r] = await say("Ubeam", "💰 รับเงิน");
  assert.match(r.text, /ขอพร้อมเพย์/);
  let replies = await say("Ubeam", "0812345678");
  assert.match(replies[1].text, /จะรับเงินเท่าไหร่/);
  [r] = await say("Ubeam", "350");
  assert.equal(r.type, "flex");
  assert.match(r.altText, /฿350/);

  [r] = await say("Ubeam", "⚙️ ตั้งค่า");
  assert.match(r.text, /พร้อมเพย์: 081-xxx-5678/);
  assert.match(r.text, /ตำแหน่ง: ยังไม่ตั้ง/);
  await shareLocation("Ubeam", 13.73, 100.54);
  await say("Ubeam", button(r, "7 โมง").text);
  await say("Ubeam", "เตือนฝน");
  [r] = await say("Ubeam", "ตั้งค่า");
  assert.match(r.text, /ตำแหน่ง: ตั้งแล้ว\n⏰ สรุปทุกเช้า: 07:00\n☔ เตือนฝน: เปิด/);
  assert.ok(button(r, "ปิดเตือนฝน"));
});

test("rich menu: grid covers the image and every button does something useful", async () => {
  const { richMenuDefinition } = await import("../src/richmenu.js");
  const { installRichMenu } = await import("../scripts/richmenu.mjs");
  const def = richMenuDefinition();
  const area = def.areas.reduce((n, a) => n + a.bounds.width * a.bounds.height, 0);
  assert.equal(area, 2500 * 1686);              // no gaps, no overlaps
  assert.ok(def.chatBarText.length <= 14);

  const { say } = setup();
  await say("Uaom", "ตั้งพร้อมเพย์ 0812345678");
  const expect = [/ยอดรวมทั้งบิล/, /ยังไม่มีบิล/, /จะรับเงินเท่าไหร่/, /ส่งตำแหน่ง/, /ส่งตำแหน่ง/, /⚙️ ตั้งค่า/];
  for (const [i, a] of def.areas.entries()) {
    const [r] = await say("Uaom", a.action.text);
    assert.match(r.text, expect[i], a.action.text);
    await say("Uaom", "ยกเลิก");
  }

  // Install script talks to the LINE API in the right order (with a fake LINE).
  const calls = [];
  const fakeApi = async (url, init) => {
    calls.push(`${init.method} ${url.replace(/https:\/\/api(-data)?\.line\.me\/v2\/bot/, "")}`);
    if (url.endsWith("/richmenu/list")) return new Response(JSON.stringify({ richmenus: [{ richMenuId: "old1", name: "khun-chuay-main" }] }));
    if (url.endsWith("/richmenu") && init.method === "POST") return new Response(JSON.stringify({ richMenuId: "new1" }));
    return new Response("{}");
  };
  assert.equal(await installRichMenu("token", fakeApi), "new1");
  assert.deepEqual(calls, ["GET /richmenu/list", "DELETE /richmenu/old1", "POST /richmenu",
    "POST /richmenu/new1/content", "POST /user/all/richmenu/new1"]);
});
