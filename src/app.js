// The bot's brain: read each LINE event, decide what to do, reply.
// Everything it needs (storage, LINE, internet) is passed in, so tests and
// the `npm run try` simulator can swap in fakes.
import { getForecast, getStations, nearestStation, rainWindow } from "./air.js";
import { computeSplit, isSplitCommand, parseSplit } from "./bill.js";
import { signHex, verifySignature } from "./line.js";
import * as M from "./messages.js";
import { maskTarget, parseTarget, promptPayPayload } from "./promptpay.js";
import { qrPng } from "./qrpng.js";

const { t, text } = M;
const DAY = 86400;

const b64url = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
const chatIdOf = (src) => src.groupId || src.roomId || src.userId;
const pad2 = (n) => String(n).padStart(2, "0");
const bangkokHour = (date) => (date.getUTCHours() + 7) % 24;

// Command patterns (Thai + English). Tested in test/app.test.js.
const RE = {
  help: /^(help|menu|start|hi|hello|วิธีใช้|เมนู|ช่วยด้วย|คุณช่วย|สวัสดี|\?)$/i,
  setPP: /^(?:ตั้ง\s*(?:ค่า\s*)?พร้อมเพย์|set\s*promptpay|promptpay|พร้อมเพย์|pp)\s+(.+)$/i,
  myPP: /^(พร้อมเพย์(ของ)?ฉัน|พร้อมเพย์ของฉัน|my\s*promptpay)$/i,
  delPP: /^(ลบ\s*พร้อมเพย์|delete\s*promptpay|remove\s*promptpay)$/i,
  qr: /^(?:qr|คิวอาร์|พร้อมเพย์|promptpay|รับเงิน)\s*฿?([\d,]+(?:\.\d{1,2})?)\s*(?:บาท|baht)?$/i,
  status: /^(ใครยังไม่จ่าย|ใครจ่ายแล้ว|ใครจ่ายแล้วบ้าง|เช็คบิล|เช็กบิล|who\s*paid|who\s*hasn'?t\s*paid|unpaid|bill\s*status)\??$/i,
  air: /^(ฝุ่น|ค่าฝุ่น|ฝุ่นวันนี้|pm\s*2\.?5|pm|air|aqi|air\s*quality)\??$/i,
  rain: /^(ฝน|ฝนตกไหม|ฝนจะตกไหม|rain|will\s*it\s*rain)\??$/i,
  all: /^(อากาศ|อากาศวันนี้|weather|report|today|วันนี้|รายงาน)\??$/i,
  alertOff: /^(ปิดแจ้งเตือน|ยกเลิกแจ้งเตือน|หยุดแจ้งเตือน|alerts?\s*off|stop\s*alerts?|unsubscribe)$/i,
  alert: /^(?:แจ้งเตือน|เตือน|alert|daily)\s*(?:ทุกเช้า|ตอน|at)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(โมง|น\.?|นาฬิกา|am|pm)?$/i,
  rainAlert: /^(เตือนฝน|rain\s*alerts?)\s*(on|off|เปิด|ปิด)?$/i,
  location: /^(ตำแหน่ง|location|ส่งตำแหน่ง)$/i,
  // Starting a guided conversation (from menu buttons or typed)
  splitStart: /^(หารบิล|แบ่งบิล|แชร์บิล|หาร|split\s*(the\s*)?bill|split)$/i,
  qrStart: /^(รับเงิน|qr\s*รับเงิน|qr|คิวอาร์|get\s*paid|receive\s*money)$/i,
  ppStart: /^(ตั้ง\s*(?:ค่า\s*)?พร้อมเพย์|set\s*promptpay|promptpay|พร้อมเพย์)$/i,
  settings: /^(ตั้งค่า|settings?)$/i,
  cancel: /^(ยกเลิก|cancel)$/i,
};

const isCommand = (msg) => isSplitCommand(msg) || Object.entries(RE).some(([k, re]) => k !== "cancel" && re.test(msg));

// Rich-menu buttons send text like "💸 หารบิล": ignore leading emoji/symbols when matching.
const normalize = (raw) => {
  const s = raw.trim().replace(/\s+/g, " ");
  const stripped = s.replace(/^[^\p{L}\p{N}?฿]+/u, "").trim();
  return stripped || s;
};

const readAmount = (s) => {
  const m = String(s).replace(/,/g, "").match(/^฿?\s*(\d+(?:\.\d{1,2})?)\s*(บาท|baht|฿)?$/i);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n <= 1_000_000 ? n : null;
};

const EXTRAS = {
  none: { vat: false, sc: false }, vat: { vat: true, sc: false },
  sc: { vat: false, sc: true }, both: { vat: true, sc: true },
};
const typedExtras = (s) =>
  /^(ไม่มี|ไม่|no|none|0)$/i.test(s) ? "none"
    : /^(ทั้งคู่|ทั้งสอง|both|all|เซอร์วิส\s*\+?\s*vat)$/i.test(s) ? "both"
      : /^(vat|แวต|แวท|ภาษี)$/i.test(s) ? "vat"
        : /^(sc|service|เซอร์วิส|ค่าบริการ)$/i.test(s) ? "sc" : null;

export function createApp({ kv, line, fetchFn = fetch, secret, now = () => new Date() }) {
  const getJson = (k) => kv.get(k, "json");
  const putJson = (k, v, ttl) => kv.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined);
  const getChat = async (id) => (await getJson(`chat:${id}`)) || {};
  const saveChat = (id, c) => putJson(`chat:${id}`, c);

  async function qrUrl(origin, payload) {
    return `${origin}/qr/${b64url(payload)}.png?s=${await signHex(secret, payload)}`;
  }

  async function weatherFor(chat, part) {
    const [stations, forecast] = await Promise.all([
      getStations(fetchFn, kv).catch(() => null),
      getForecast(fetchFn, chat.lat, chat.lon).catch(() => null),
    ]);
    const station = stations ? nearestStation(stations, chat.lat, chat.lon) : null;
    return { station, forecast, report: M.airReport(chat.lang || "th", { station, forecast, part, now: now() }) };
  }

  // ---------- bills ----------
  async function createBill(ev, lang, origin, msg) {
    const p = parseSplit(msg);
    if (p.error) return text(M.splitErrors[p.error](lang));
    return makeBill(ev, lang, origin, p);
  }

  async function makeBill(ev, lang, origin, p) {
    const target = await getJson(`pp:${ev.source.userId}`);
    if (!target) return M.needPromptPay(lang);
    const payerName = (await line.displayName(ev.source)) || t(lang, "คนจ่าย", "the payer");
    const bill = {
      ...computeSplit(p),
      id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      chatId: chatIdOf(ev.source), lang, payerId: ev.source.userId, payerName,
      masked: maskTarget(target),
      paid: [{ id: ev.source.userId, name: payerName }], // the payer's own share is already "paid"
      created: now().toISOString(),
    };
    await putJson(`bill:${bill.id}`, bill, 30 * DAY);
    await kv.put(`lastbill:${bill.chatId}`, bill.id, { expirationTtl: 30 * DAY });
    // So "who hasn't paid" also works from the private chat (where the menu lives).
    await kv.put(`lastbill:user:${bill.payerId}`, bill.id, { expirationTtl: 30 * DAY });
    const card = M.billFlex(lang, bill, await qrUrl(origin, promptPayPayload(target, bill.share)));
    return { ...card, quickReply: M.afterBill(lang) };
  }

  // ---------- guided conversations ----------
  // One small record per person per chat: which question we're waiting on.
  const flowKey = (src) => `flow:${chatIdOf(src)}:${src.userId}`;
  const setFlow = (src, flow) => putJson(flowKey(src), flow, 600); // forgotten after 10 minutes
  const endFlow = (src) => kv.delete(flowKey(src));

  async function startSplit(src, lang) {
    if (!(await getJson(`pp:${src.userId}`))) {
      await setFlow(src, { step: "pp", then: "split", lang });
      return M.askPromptPay(lang);
    }
    await setFlow(src, { step: "total", lang });
    return M.askTotal(lang);
  }

  async function startQr(src, lang) {
    if (!(await getJson(`pp:${src.userId}`))) {
      await setFlow(src, { step: "pp", then: "qr", lang });
      return M.askPromptPay(lang);
    }
    await setFlow(src, { step: "qrAmount", lang });
    return M.askQrAmount(lang);
  }

  // An answer to the question we asked. In groups, ignore chatter that isn't an answer.
  async function continueFlow(ev, flow, input, origin) {
    const src = ev.source;
    const lang = flow.lang;
    const quietRetry = (msg) => (src.type === "user" ? msg : null);

    if (flow.step === "pp") {
      const target = parseTarget(input);
      if (!target) return quietRetry(M.askPromptPay(lang, true));
      await putJson(`pp:${src.userId}`, target);
      const saved = M.ppSaved(lang, maskTarget(target));
      if (flow.then === "split") { await setFlow(src, { step: "total", lang }); return [saved, M.askTotal(lang)]; }
      if (flow.then === "qr") { await setFlow(src, { step: "qrAmount", lang }); return [saved, M.askQrAmount(lang)]; }
      await endFlow(src);
      return saved;
    }
    if (flow.step === "total") {
      const total = readAmount(input);
      if (!total) return quietRetry(M.askTotal(lang, true));
      await setFlow(src, { step: "people", lang, total });
      return M.askPeople(lang, total);
    }
    if (flow.step === "people") {
      const people = Number(String(input).replace(/\s*(คน|people|ppl)$/i, ""));
      if (!Number.isInteger(people) || people < 2 || people > 50) return quietRetry(M.askPeople(lang, flow.total, true));
      await setFlow(src, { step: "extras", lang, total: flow.total, people });
      return M.askExtras(lang);
    }
    if (flow.step === "extras") {
      const choice = EXTRAS[input] ? input : typedExtras(input);
      if (!choice) return quietRetry(M.askExtras(lang));
      await endFlow(src);
      return makeBill(ev, lang, origin, { total: flow.total, people: flow.people, ...EXTRAS[choice] });
    }
    if (flow.step === "qrAmount") {
      const amount = readAmount(input);
      if (!amount) return quietRetry(M.askQrAmount(lang, true));
      await endFlow(src);
      return quickQr(src, lang, origin, amount);
    }
    await endFlow(src);
    return null;
  }

  async function quickQr(src, lang, origin, amount) {
    const target = await getJson(`pp:${src.userId}`);
    if (!target) return M.needPromptPay(lang);
    const name = (await line.displayName(src)) || "";
    return M.qrFlex(lang, amount, name, maskTarget(target), await qrUrl(origin, promptPayPayload(target, amount)));
  }

  async function markPaid(ev, billId) {
    const bill = await getJson(`bill:${billId}`);
    if (!bill) return text("⌛ บิลนี้หมดอายุแล้ว · This bill has expired.");
    const L = bill.lang;
    const uid = ev.source.userId;
    if (bill.paid.some((p) => p.id === uid)) {
      return text(uid === bill.payerId
        ? t(L, "คุณเป็นคนออกเงินบิลนี้อยู่แล้ว 🙂", "You're the one who paid this bill 🙂")
        : t(L, "บันทึกไว้แล้วว่าคุณจ่ายแล้ว ✅", "Already marked you as paid ✅"));
    }
    if (bill.paid.length >= bill.people) return text(t(L, "🎉 บิลนี้จ่ายครบแล้ว", "🎉 This bill is already fully paid."));
    const name = (await line.displayName(ev.source)) || t(L, "เพื่อน", "A friend");
    bill.paid.push({ id: uid, name });
    await putJson(`bill:${billId}`, bill, 30 * DAY);
    const done = bill.paid.length >= bill.people;
    return text(t(L, `✅ ${name} จ่ายแล้ว (${bill.paid.length}/${bill.people})`, `✅ ${name} paid (${bill.paid.length}/${bill.people})`) +
      (done ? t(L, "\n🎉 จ่ายครบทุกคนแล้ว! ขอบคุณค่ะ", "\n🎉 Everyone has paid! Thanks all") : ""));
  }

  async function billStatus(billId, lang) {
    const bill = billId && (await getJson(`bill:${billId}`));
    if (!bill) return text(t(lang, "ยังไม่มีบิลในแชทนี้ ลองพิมพ์: หาร 1850 4", "No bill in this chat yet. Try: split 1850 4"));
    return M.billStatus(bill.lang, bill);
  }

  // ---------- text commands ----------
  async function onText(ev, origin) {
    const msg = normalize(ev.message.text);
    const lang = M.detectLang(msg);
    const src = ev.source;
    const chatId = chatIdOf(src);
    const isGroup = src.type !== "user";

    // Mid-conversation? Treat the message as the answer, unless it's a new command.
    const flow = await getJson(flowKey(src));
    if (RE.cancel.test(msg)) {
      if (flow) { await endFlow(src); return M.cancelled(flow.lang); }
      return isGroup ? null : M.cancelled(lang);
    }
    if (flow && !isCommand(msg)) return continueFlow(ev, flow, msg, origin);
    if (flow) await endFlow(src);

    if (RE.help.test(msg)) return M.help(lang);
    if (RE.splitStart.test(msg)) return startSplit(src, lang);
    if (RE.qrStart.test(msg)) return startQr(src, lang);
    if (RE.ppStart.test(msg)) {
      await setFlow(src, { step: "pp", lang });
      return M.askPromptPay(lang);
    }
    if (RE.settings.test(msg)) {
      const target = await getJson(`pp:${src.userId}`);
      return M.settings(lang, { masked: target && maskTarget(target), chat: await getChat(chatId) });
    }
    // Just a phone number / ID typed in the private chat: that's obviously their PromptPay.
    if (!isGroup && /^[\d\s-]{9,20}$/.test(msg) && parseTarget(msg)) {
      const target = parseTarget(msg);
      await putJson(`pp:${src.userId}`, target);
      return text(t(lang, `✅ บันทึกพร้อมเพย์ ${maskTarget(target)} แล้ว\nกด 💸 หารบิล ได้เลย`, `✅ PromptPay ${maskTarget(target)} saved\nTap 💸 Split bill to start`), M.startButtons(lang));
    }
    if (isSplitCommand(msg)) return createBill(ev, lang, origin, msg);
    if (RE.status.test(msg)) {
      const id = (await kv.get(`lastbill:${chatId}`)) || (isGroup ? null : await kv.get(`lastbill:user:${src.userId}`));
      return billStatus(id, lang);
    }

    let m;
    if ((m = msg.match(RE.setPP)) && parseTarget(m[1])) {
      const target = parseTarget(m[1]);
      await putJson(`pp:${src.userId}`, target);
      return text(t(lang,
        `✅ บันทึกพร้อมเพย์ ${maskTarget(target)} แล้ว\nใช้ได้ทุกกลุ่ม ลองพิมพ์: หาร 1850 4` + (isGroup ? "\n(ครั้งหน้าตั้งในแชทส่วนตัวกับบอทได้นะ)" : ""),
        `✅ PromptPay ${maskTarget(target)} saved\nWorks in every group. Try: split 1850 4` + (isGroup ? "\n(Tip: you can also set this in a private chat with me)" : "")));
    }
    if (RE.myPP.test(msg)) {
      const target = await getJson(`pp:${src.userId}`);
      return target ? text(t(lang, `พร้อมเพย์ของคุณ: ${maskTarget(target)}`, `Your PromptPay: ${maskTarget(target)}`)) : M.needPromptPay(lang);
    }
    if (RE.delPP.test(msg)) {
      await kv.delete(`pp:${src.userId}`);
      return text(t(lang, "🗑 ลบพร้อมเพย์ของคุณแล้ว", "🗑 Your PromptPay has been deleted."));
    }
    if ((m = msg.match(RE.qr))) {
      const amount = readAmount(m[1]);
      if (!amount) return text(M.splitErrors.total(lang));
      return quickQr(src, lang, origin, amount);
    }

    // ----- air / rain -----
    const chat = await getChat(chatId);
    const wantsWeather = RE.air.test(msg) || RE.rain.test(msg) || RE.all.test(msg);
    const wantsAlert = RE.alert.test(msg) || RE.rainAlert.test(msg) || RE.alertOff.test(msg);
    if (wantsWeather || wantsAlert || RE.location.test(msg)) {
      if (chat.lang !== lang) { chat.lang = lang; await saveChat(chatId, chat); }
      if (RE.alertOff.test(msg)) {
        if (chat.alertHour != null) await kv.delete(`sub:${pad2(chat.alertHour)}:${chatId}`);
        await kv.delete(`rain:${chatId}`);
        delete chat.alertHour; chat.rainAlert = false;
        await saveChat(chatId, chat);
        return text(t(lang, "🔕 ปิดการแจ้งเตือนทั้งหมดแล้ว", "🔕 All alerts are off."));
      }
      if (chat.lat == null || RE.location.test(msg)) return M.askLocation(lang);
      if (wantsWeather) {
        const part = RE.air.test(msg) ? "air" : RE.rain.test(msg) ? "rain" : "all";
        return text((await weatherFor(chat, part)).report, M.quickMenu(lang));
      }
      if ((m = msg.match(RE.alert))) {
        let hour = Number(m[1]);
        if (/pm/i.test(m[3] || "") && hour < 12) hour += 12;
        if (hour > 23) return text(t(lang, "เวลาไม่ถูกต้อง ลอง: แจ้งเตือน 7", "Invalid time. Try: alert 7"));
        if (chat.alertHour != null) await kv.delete(`sub:${pad2(chat.alertHour)}:${chatId}`);
        await kv.put(`sub:${pad2(hour)}:${chatId}`, "1");
        chat.alertHour = hour;
        await saveChat(chatId, chat);
        return text(t(lang,
          `⏰ ตั้งแล้ว! จะส่งสรุปฝุ่น+ฝนให้ทุกวันเวลา ${pad2(hour)}:00 น.\nพิมพ์ "เตือนฝน" ให้เตือนก่อนฝนตกด้วย · "ปิดแจ้งเตือน" เพื่อหยุด`,
          `⏰ Done! You'll get an air + rain summary every day at ${pad2(hour)}:00.\nType "rain alert" to also be warned before rain · "alert off" to stop`));
      }
      if ((m = msg.match(RE.rainAlert))) {
        const off = /off|ปิด/i.test(m[2] || "");
        if (off) await kv.delete(`rain:${chatId}`); else await kv.put(`rain:${chatId}`, "1");
        chat.rainAlert = !off;
        await saveChat(chatId, chat);
        return text(off
          ? t(lang, "🔕 ปิดเตือนฝนแล้ว", "🔕 Rain alerts off.")
          : t(lang, "☔ เปิดเตือนฝนแล้ว! จะบอกเมื่อมีโอกาสฝนตก 60%+ ภายใน 2 ชม. (ไม่เกินทุก 6 ชม.)",
            "☔ Rain alerts on! I'll warn you when there's a 60%+ chance of rain within 2 hours (at most every 6 hours)."));
      }
    }

    // Unknown message: help in private chat, stay quiet in groups (no spam).
    return isGroup ? null : text(t(lang, "ไม่เข้าใจคำสั่งนี้ 🙏 พิมพ์ \"วิธีใช้\" เพื่อดูทั้งหมด", "Sorry, I didn't get that 🙏 Type \"help\" to see what I can do."), M.startButtons(lang));
  }

  async function onEvent(ev, origin) {
    switch (ev.type) {
      case "follow": return M.help("th");
      case "join": return M.welcomeGroup("th");
      case "postback": {
        const [action, id, value] = ev.postback.data.split("|");
        if (action === "paid") return markPaid(ev, id);
        if (action === "status") return billStatus(id, "th");
        if (action === "f") { // a button inside a guided conversation, e.g. "f|people|4"
          const flow = await getJson(flowKey(ev.source));
          const isUser = ev.source.type === "user";
          if (id === "cancel") {
            if (!flow) return null;
            await endFlow(ev.source);
            return M.cancelled(flow.lang);
          }
          // In a group everyone sees the buttons; only the person who started can answer.
          if (!flow || flow.step !== id) return isUser ? M.flowExpired(flow?.lang || "th") : null;
          return continueFlow(ev, flow, value, origin);
        }
        return null;
      }
      case "message":
        if (ev.message.type === "text") return onText(ev, origin);
        if (ev.message.type === "location") {
          const chatId = chatIdOf(ev.source);
          const chat = await getChat(chatId);
          chat.lat = ev.message.latitude;
          chat.lon = ev.message.longitude;
          chat.lang = chat.lang || "th";
          await saveChat(chatId, chat);
          const { report } = await weatherFor(chat, "all");
          const L = chat.lang;
          return text(`${report}\n\n${t(L, "📌 จำตำแหน่งนี้ไว้แล้ว · กด ⏰ ด้านล่าง รับสรุปทุกเช้า",
            "📌 Location saved · tap ⏰ below for a daily morning summary")}`, M.quickMenu(L));
        }
        return null;
      default:
        return null;
    }
  }

  async function handleEvents(events, origin) {
    for (const ev of events) {
      try {
        const reply = await onEvent(ev, origin);
        const messages = [reply].flat().filter(Boolean);
        if (messages.length && ev.replyToken) await line.reply(ev.replyToken, messages);
      } catch (err) {
        console.error("event failed", ev.type, err);
        if (ev.replyToken) {
          await line.reply(ev.replyToken, [text("😵 ขอโทษ มีบางอย่างผิดพลาด ลองใหม่อีกครั้งนะ · Sorry, something went wrong. Please try again.")]).catch(() => {});
        }
      }
    }
  }

  // ---------- scheduled alerts (runs every hour) ----------
  async function runSchedule(date = now()) {
    const hour = pad2(bangkokHour(date));
    let budget = 45; // Cloudflare free plan allows 50 outgoing requests per run
    const sent = { daily: 0, rain: 0 };
    const forecastCache = new Map();

    const forecastFor = async (chat) => {
      const key = `${chat.lat.toFixed(2)},${chat.lon.toFixed(2)}`; // ~1 km grid: neighbours share one fetch
      if (!forecastCache.has(key)) { budget -= 2; forecastCache.set(key, getForecast(fetchFn, chat.lat, chat.lon).catch(() => null)); }
      return forecastCache.get(key);
    };

    const daily = await kv.list({ prefix: `sub:${hour}:` });
    for (const { name } of daily.keys) {
      if (budget < 4) break;
      const chatId = name.split(":")[2];
      const chat = await getChat(chatId);
      if (chat.lat == null) continue;
      const stations = await getStations(fetchFn, kv).catch(() => null);
      const forecast = await forecastFor(chat);
      const station = stations ? nearestStation(stations, chat.lat, chat.lon) : null;
      const L = chat.lang || "th";
      const head = t(L, "🌅 สรุปอากาศวันนี้", "🌅 Today's air & weather");
      await line.push(chatId, [text(`${head}\n\n${M.airReport(L, { station, forecast, part: "all", now: date })}`)]).catch((e) => console.error(e));
      budget -= 1; sent.daily++;
    }

    const rainSubs = await kv.list({ prefix: "rain:" });
    for (const { name } of rainSubs.keys) {
      if (budget < 3) break;
      const chatId = name.slice(5);
      const chat = await getChat(chatId);
      if (chat.lat == null) continue;
      if (chat.lastRainAlert && date - new Date(chat.lastRainAlert) < 6 * 3600 * 1000) continue;
      const forecast = await forecastFor(chat);
      const w = forecast && rainWindow(forecast.hours, 60, 3);
      if (!w) continue;
      const L = chat.lang || "th";
      await line.push(chatId, [text(t(L,
        `☔ ฝนกำลังจะมา! โอกาส ${w.chance}% ช่วง ${w.from} น. แถวตำแหน่งของคุณ พกร่มด้วยนะ`,
        `☔ Rain is coming! ${w.chance}% chance around ${w.from} near you. Take an umbrella.`))]).catch((e) => console.error(e));
      chat.lastRainAlert = date.toISOString();
      await saveChat(chatId, chat);
      budget -= 1; sent.rain++;
    }
    return sent;
  }

  // ---------- HTTP ----------
  async function handleRequest(request, waitUntil = (p) => p) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Khun Chuay LINE bot is running ✅", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const qr = url.pathname.match(/^\/qr\/([\w-]+)\.png$/);
    if (request.method === "GET" && qr) {
      let payload;
      try { payload = unb64url(qr[1]); } catch { return new Response("bad request", { status: 400 }); }
      if (url.searchParams.get("s") !== (await signHex(secret, payload))) return new Response("forbidden", { status: 403 });
      return new Response(await qrPng(payload), {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=604800, immutable" },
      });
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.text();
      if (!(await verifySignature(secret, body, request.headers.get("x-line-signature")))) {
        return new Response("invalid signature", { status: 401 });
      }
      const { events = [] } = JSON.parse(body);
      // Answer LINE straight away; the work carries on in the background.
      await waitUntil(handleEvents(events, url.origin));
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  return { handleRequest, handleEvents, runSchedule, RE };
}
