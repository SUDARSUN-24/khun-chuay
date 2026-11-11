// Everything the bot says, in Thai and English. It answers in the language you type in.
import { baht } from "./bill.js";
import { heatNote, peakPm25, pm25Level, rainWindow, stationAgeHours } from "./air.js";

// Thai letters -> Thai. Latin letters -> English. Only numbers/emoji -> Thai (it's a Thai-first bot).
export const detectLang = (text) => (/[฀-๿]/.test(text) || !/[a-z]/i.test(text) ? "th" : "en");
export const t = (lang, th, en) => (lang === "th" ? th : en);

export const text = (str, quickReply) => (quickReply ? { type: "text", text: str, quickReply } : { type: "text", text: str });

const qrItem = (label, msg) => ({ type: "action", action: { type: "message", label, text: msg } });

export const quickMenu = (lang) => ({
  items: [
    { type: "action", action: { type: "location", label: t(lang, "📍 ส่งตำแหน่ง", "📍 Send location") } },
    qrItem(t(lang, "😷 ฝุ่น", "😷 Air"), t(lang, "ฝุ่น", "air")),
    qrItem(t(lang, "☔ ฝน", "☔ Rain"), t(lang, "ฝน", "rain")),
    qrItem(t(lang, "⏰ แจ้งเตือน 7 โมง", "⏰ Alert 7am"), t(lang, "แจ้งเตือน 7", "alert 7")),
    qrItem(t(lang, "💸 หารบิล", "💸 Split bill"), t(lang, "หารบิล", "split bill")),
  ],
});

export const startButtons = (lang) => ({
  items: [
    qrItem(t(lang, "💸 หารบิล", "💸 Split bill"), t(lang, "หารบิล", "split bill")),
    qrItem(t(lang, "💰 QR รับเงิน", "💰 Get paid QR"), t(lang, "รับเงิน", "qr")),
    qrItem(t(lang, "😷 ค่าฝุ่น", "😷 Air"), t(lang, "ฝุ่น", "air")),
    qrItem(t(lang, "☔ ฝน", "☔ Rain"), t(lang, "ฝน", "rain")),
    qrItem(t(lang, "⚙️ ตั้งค่า", "⚙️ Settings"), t(lang, "ตั้งค่า", "settings")),
  ],
});

// ---------- guided conversations (tap buttons instead of typing commands) ----------
// Postback buttons: the chat shows `displayText` as if you typed it, the bot gets `data`.
const tap = (label, data, displayText = label) => ({ type: "action", action: { type: "postback", label, data, displayText } });
const cancelBtn = (lang) => tap(t(lang, "✖️ ยกเลิก", "✖️ Cancel"), "f|cancel", t(lang, "ยกเลิก", "Cancel"));

export const askPromptPay = (lang, retry) => text(t(lang,
  (retry ? "🤔 เบอร์นี้ใช้ไม่ได้ ลองใหม่นะ\n" : "💳 ขอพร้อมเพย์ของคุณก่อน (ตั้งครั้งเดียว ใช้ได้ตลอด)\n") +
    "พิมพ์เบอร์มือถือ หรือเลขบัตรประชาชน ที่ผูกพร้อมเพย์ไว้ เช่น 0812345678",
  (retry ? "🤔 That doesn't look right, try again\n" : "💳 First, your PromptPay (set once, used every time)\n") +
    "Type the phone number or national ID linked to your PromptPay, e.g. 0812345678"),
  { items: [cancelBtn(lang)] });

export const ppSaved = (lang, masked) => text(t(lang, `✅ บันทึกพร้อมเพย์ ${masked} แล้ว`, `✅ PromptPay ${masked} saved`));

export const askTotal = (lang, retry) => text(t(lang,
  (retry ? "🤔 ใส่เป็นตัวเลขนะ " : "💸 ") + "ยอดรวมทั้งบิลเท่าไหร่? พิมพ์ตัวเลขได้เลย เช่น 1850",
  (retry ? "🤔 Just the number please. " : "💸 ") + "What's the bill total? Just type the number, e.g. 1850"),
  { items: [cancelBtn(lang)] });

export const askPeople = (lang, total, retry) => text(t(lang,
  (retry ? "🤔 เลือกจำนวนคน (2–50) " : "") + `หาร ${baht(total)} กี่คน? (นับตัวเองด้วย)`,
  (retry ? "🤔 Pick 2–50 people. " : "") + `Split ${baht(total)} between how many people? (including you)`),
  { items: [...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => tap(t(lang, `${n} คน`, `${n} people`), `f|people|${n}`)), cancelBtn(lang)] });

export const askExtras = (lang) => text(t(lang,
  "มีค่าเซอร์วิสหรือ VAT เพิ่มไหม? (ถ้าในบิลรวมไว้แล้ว กด \"ไม่มี\")",
  "Any service charge or VAT on top? (If it's already in the total, tap \"None\")"),
  { items: [
    tap(t(lang, "ไม่มี", "None"), "f|extras|none"),
    tap("VAT 7%", "f|extras|vat"),
    tap(t(lang, "เซอร์วิส 10%", "Service 10%"), "f|extras|sc"),
    tap(t(lang, "เซอร์วิส+VAT", "Service + VAT"), "f|extras|both"),
    cancelBtn(lang),
  ] });

export const askQrAmount = (lang, retry) => text(t(lang,
  (retry ? "🤔 ใส่เป็นตัวเลขนะ " : "💰 ") + "จะรับเงินเท่าไหร่? พิมพ์ตัวเลข เช่น 500",
  (retry ? "🤔 Just the number please. " : "💰 ") + "How much do you want to receive? Type a number, e.g. 500"),
  { items: [cancelBtn(lang)] });

export const cancelled = (lang) => text(t(lang, "👌 ยกเลิกแล้ว", "👌 Cancelled"));
export const flowExpired = (lang) => text(t(lang, "⌛ หมดเวลาแล้ว เริ่มใหม่ได้เลย: พิมพ์ \"หารบิล\"", "⌛ That timed out. Start again: type \"split bill\""));

export const afterBill = (lang) => ({
  items: [
    { type: "action", action: { type: "message", label: t(lang, "👀 ใครยังไม่จ่าย", "👀 Who hasn't paid"), text: t(lang, "ใครยังไม่จ่าย", "who paid") } },
    { type: "action", action: { type: "message", label: t(lang, "💸 หารบิลใหม่", "💸 New bill"), text: t(lang, "หารบิล", "split bill") } },
  ],
});

export function settings(lang, { masked, chat }) {
  const msg = (label, txt) => ({ type: "action", action: { type: "message", label, text: txt } });
  const status = [
    `💳 ${t(lang, "พร้อมเพย์", "PromptPay")}: ${masked || t(lang, "ยังไม่ตั้ง", "not set")}`,
    `📍 ${t(lang, "ตำแหน่ง", "Location")}: ${chat.lat != null ? t(lang, "ตั้งแล้ว", "set") : t(lang, "ยังไม่ตั้ง", "not set")}`,
    `⏰ ${t(lang, "สรุปทุกเช้า", "Daily summary")}: ${chat.alertHour != null ? `${String(chat.alertHour).padStart(2, "0")}:00` : t(lang, "ปิด", "off")}`,
    `☔ ${t(lang, "เตือนฝน", "Rain alerts")}: ${chat.rainAlert ? t(lang, "เปิด", "on") : t(lang, "ปิด", "off")}`,
  ].join("\n");
  return text(`⚙️ ${t(lang, "ตั้งค่า", "Settings")}\n\n${status}\n\n${t(lang, "กดปุ่มด้านล่างเพื่อเปลี่ยน 👇", "Tap a button below to change 👇")}`, {
    items: [
      msg(t(lang, "💳 พร้อมเพย์", "💳 PromptPay"), t(lang, "ตั้งพร้อมเพย์", "set promptpay")),
      { type: "action", action: { type: "location", label: t(lang, "📍 ตำแหน่ง", "📍 Location") } },
      msg(t(lang, "⏰ ทุกเช้า 6 โมง", "⏰ Daily 6am"), t(lang, "แจ้งเตือน 6", "alert 6")),
      msg(t(lang, "⏰ ทุกเช้า 7 โมง", "⏰ Daily 7am"), t(lang, "แจ้งเตือน 7", "alert 7")),
      msg(t(lang, "⏰ ทุกเช้า 8 โมง", "⏰ Daily 8am"), t(lang, "แจ้งเตือน 8", "alert 8")),
      msg(chat.rainAlert ? t(lang, "☔ ปิดเตือนฝน", "☔ Rain alerts off") : t(lang, "☔ เปิดเตือนฝน", "☔ Rain alerts on"),
        chat.rainAlert ? t(lang, "เตือนฝน ปิด", "rain alert off") : t(lang, "เตือนฝน", "rain alert")),
      msg(t(lang, "🔕 ปิดแจ้งเตือน", "🔕 Alerts off"), t(lang, "ปิดแจ้งเตือน", "alert off")),
      msg(t(lang, "❓ วิธีใช้", "❓ Help"), t(lang, "วิธีใช้", "help")),
    ],
  });
}

export const askLocation = (lang) => text(
  t(lang, "📍 ส่งตำแหน่งของคุณมาก่อนนะ แล้วจะบอกค่าฝุ่นกับฝนแถวนั้นให้\n(กดปุ่มด้านล่าง หรือ + ➜ ตำแหน่ง)",
    "📍 Send me your location first, then I'll tell you the air and rain right where you are.\n(Tap the button below, or + ➜ Location)"),
  { items: [{ type: "action", action: { type: "location", label: t(lang, "📍 ส่งตำแหน่ง", "📍 Send location") } }] });

export function help(lang) {
  return text(t(lang,
`🙏 สวัสดี! กดปุ่มเมนูด้านล่างได้เลย ไม่ต้องจำคำสั่ง 👇

หรือพิมพ์ลัดสำหรับคนรีบ:

💸 หารบิล + QR พร้อมเพย์
• ตั้งพร้อมเพย์ 0812345678
   (ตั้งครั้งเดียว ใช้ได้ทุกกลุ่ม)
• หาร 1850 4 ➜ แบ่ง 4 คน ได้ QR สแกนจ่าย
• หาร 1850 4 vat sc ➜ +เซอร์วิส 10% +VAT 7%
• qr 500 ➜ QR รับเงิน 500 บาท
• ใครยังไม่จ่าย ➜ เช็คว่าใครจ่ายแล้ว

😷 ฝุ่น PM2.5 + ☔ ฝน
• 📍 ส่งตำแหน่งมาก่อน 1 ครั้ง
• ฝุ่น ➜ PM2.5 จากสถานีใกล้คุณ
• ฝน ➜ ฝนจะตกไหมใน 12 ชม.
• อากาศ ➜ สรุปทั้งหมด
• แจ้งเตือน 7 ➜ ส่งสรุปให้ทุกเช้า 7 โมง
• เตือนฝน ➜ เตือนก่อนฝนตก
• ปิดแจ้งเตือน ➜ หยุดส่ง`,
`🙏 Hi! Just tap the menu buttons below, no commands to remember 👇

Or use shortcuts if you're in a hurry:

💸 Split bills with PromptPay QR
• promptpay 0812345678
   (set once, works in every group)
• split 1850 4 ➜ 4 people, QR to scan & pay
• split 1850 4 vat sc ➜ +10% service +7% VAT
• qr 500 ➜ PromptPay QR for ฿500
• who paid ➜ see who has paid

😷 PM2.5 air + ☔ rain
• 📍 send your location once
• air ➜ PM2.5 from the nearest station
• rain ➜ will it rain in the next 12 h?
• weather ➜ everything at once
• alert 7 ➜ daily summary at 7am
• rain alert ➜ warn me before rain
• alert off ➜ stop alerts`), startButtons(lang));
}

export const welcomeGroup = (lang) => text(t(lang,
  "🙏 สวัสดีทุกคน! กินข้าวเสร็จกด \"💸 หารบิล\" ด้านล่างได้เลย\nเดี๋ยวคุณช่วยถามยอด กี่คน แล้วทำ QR พร้อมเพย์ให้ทุกคนสแกนจ่าย 👌",
  "🙏 Hi everyone! After a meal, tap \"💸 Split bill\" below.\nI'll ask the total and how many people, then make a PromptPay QR for everyone to scan 👌"),
  startButtons(lang));

export const splitErrors = {
  format: (l) => t(l, "พิมพ์แบบนี้นะ: หาร 1850 4\n(ยอดรวม แล้วตามด้วยจำนวนคน, เพิ่ม vat หรือ sc ได้)", "Try: split 1850 4\n(total, then number of people; add vat or sc if needed)"),
  people: (l) => t(l, "หารกี่คนดี? เช่น หาร 1850 4 (2–50 คน)", "How many people? e.g. split 1850 4 (2–50 people)"),
  total: (l) => t(l, "ยอดเงินไม่ถูกต้อง (ต้องมากกว่า 0 และไม่เกิน 1,000,000)", "That amount doesn't look right (must be above 0, max 1,000,000)."),
};

export const needPromptPay = (lang) => text(t(lang,
  "ยังไม่ได้ตั้งพร้อมเพย์เลย 🙂 พิมพ์:\nตั้งพร้อมเพย์ 0812345678\n(เบอร์มือถือหรือเลขบัตรประชาชนที่ผูกพร้อมเพย์ไว้)",
  "You haven't set your PromptPay yet 🙂 Type:\npromptpay 0812345678\n(the phone number or national ID linked to your PromptPay)"));

export function billFlex(lang, bill, qrUrl) {
  const row = (label, value, bold) => ({
    type: "box", layout: "horizontal", contents: [
      { type: "text", text: label, size: "sm", color: "#6b7280", flex: 3 },
      { type: "text", text: value, size: "sm", align: "end", flex: 2, weight: bold ? "bold" : "regular", color: "#111827" },
    ],
  });
  const lines = [row(t(lang, "ยอดอาหาร", "Bill"), baht(bill.base))];
  if (bill.serviceCharge) lines.push(row(t(lang, "เซอร์วิส 10%", "Service 10%"), baht(bill.serviceCharge)));
  if (bill.vat) lines.push(row("VAT 7%", baht(bill.vat)));
  lines.push(row(t(lang, "รวม", "Total"), baht(bill.grandTotal), true));

  return {
    type: "flex",
    altText: t(lang, `💸 หารบิล: คนละ ${baht(bill.share)} จ่ายให้ ${bill.payerName}`, `💸 Bill split: ${baht(bill.share)} each, pay ${bill.payerName}`),
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#0F766E", paddingAll: "16px", contents: [
          { type: "text", text: t(lang, "💸 หารบิล", "💸 Bill split"), color: "#ffffff", size: "sm" },
          { type: "text", text: t(lang, `คนละ ${baht(bill.share)}`, `${baht(bill.share)} each`), color: "#ffffff", size: "xxl", weight: "bold" },
          { type: "text", text: t(lang, `${bill.people} คน · จ่ายให้ ${bill.payerName}`, `${bill.people} people · pay ${bill.payerName}`), color: "#ccfbf1", size: "sm", wrap: true },
        ],
      },
      hero: { type: "image", url: qrUrl, size: "full", aspectRatio: "1:1", aspectMode: "fit" },
      body: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "text", text: t(lang, "สแกนด้วยแอปธนาคารไหนก็ได้ ยอดใส่ให้แล้ว", "Scan with any Thai banking app, amount is filled in"), size: "xs", color: "#6b7280", wrap: true },
          { type: "separator", margin: "md" },
          ...lines,
          { type: "text", text: `PromptPay ${bill.masked}`, size: "xs", color: "#9ca3af", margin: "md" },
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "button", style: "primary", color: "#0F766E",
            action: { type: "postback", label: t(lang, "✅ ฉันจ่ายแล้ว", "✅ I've paid"), data: `paid|${bill.id}`, displayText: t(lang, "จ่ายแล้ว ✅", "Paid ✅") } },
          { type: "button", style: "secondary",
            action: { type: "postback", label: t(lang, "👀 ใครจ่ายแล้วบ้าง", "👀 Who has paid?"), data: `status|${bill.id}` } },
        ],
      },
    },
  };
}

export function qrFlex(lang, amount, payerName, masked, qrUrl) {
  return {
    type: "flex",
    altText: t(lang, `QR พร้อมเพย์ ${baht(amount)}`, `PromptPay QR ${baht(amount)}`),
    contents: {
      type: "bubble",
      hero: { type: "image", url: qrUrl, size: "full", aspectRatio: "1:1", aspectMode: "fit" },
      body: {
        type: "box", layout: "vertical", contents: [
          { type: "text", text: baht(amount), size: "xxl", weight: "bold", align: "center" },
          { type: "text", text: t(lang, `จ่ายให้ ${payerName} · PromptPay ${masked}`, `Pay ${payerName} · PromptPay ${masked}`), size: "sm", color: "#6b7280", align: "center", wrap: true },
        ],
      },
    },
  };
}

export function billStatus(lang, bill) {
  const paid = bill.paid.map((p) => `✅ ${p.name}`).join("\n");
  const left = bill.people - bill.paid.length;
  const head = t(lang, `💸 บิล ${baht(bill.grandTotal)} · คนละ ${baht(bill.share)}`, `💸 Bill ${baht(bill.grandTotal)} · ${baht(bill.share)} each`);
  const tail = left <= 0
    ? t(lang, "🎉 จ่ายครบทุกคนแล้ว!", "🎉 Everyone has paid!")
    : t(lang, `⏳ ยังเหลืออีก ${left} คน (รวม ${baht(left * bill.share)})`, `⏳ ${left} still to pay (${baht(left * bill.share)} total)`);
  return text(`${head}\n\n${paid}\n\n${tail}`);
}

// ---------- air + rain report ----------
export function airReport(lang, { station, forecast, part = "all", now = new Date() }) {
  const out = [];
  if (part === "air" || part === "all") {
    // Prefer a real measurement: a station within 30 km, reading less than 3 hours old.
    // Otherwise fall back to the CAMS air-quality model (via Open-Meteo).
    let value = null;
    let source;
    if (station && station.km <= 30 && stationAgeHours(station, now) <= 3) {
      value = station.pm25;
      source = t(lang, `📍 สถานี${station.name} (${station.km.toFixed(1)} กม.) · ${station.time.slice(11)} น.`,
        `📍 ${station.nameEn} station (${station.km.toFixed(1)} km) · ${station.time.slice(11)}`);
    } else if (forecast?.modelPm25 != null) {
      value = forecast.modelPm25;
      source = t(lang, "📍 ค่าประมาณจากแบบจำลองอากาศ (ไม่ใช่สถานีวัด)", "📍 Air-model estimate (not a station reading)");
    }
    if (value == null) {
      out.push(t(lang, "😷 ตอนนี้ดึงค่าฝุ่นไม่ได้ ลองใหม่อีกครั้งนะ", "😷 Couldn't get air data right now, try again soon."));
    } else {
      const lv = pm25Level(value);
      out.push(t(lang, "😷 ฝุ่น PM2.5 ใกล้คุณ", "😷 PM2.5 near you"));
      out.push(`${lv.emoji} ${Math.round(value)} µg/m³ · ${t(lang, lv.th, lv.en)}`);
      out.push(source);
      out.push(`💡 ${t(lang, lv.tipTh, lv.tipEn)}`);
      const peak = forecast && peakPm25(forecast.hours);
      if (peak && peak.pm25 > value * 1.2 && pm25Level(peak.pm25) !== lv) {
        out.push(t(lang, `📈 คาดว่าจะแย่ลงถึง ~${Math.round(peak.pm25)} ช่วง ${peak.time} น.`,
          `📈 Expected to rise to ~${Math.round(peak.pm25)} around ${peak.time}`));
      }
    }
  }
  if (forecast && (part === "rain" || part === "all")) {
    if (out.length) out.push("");
    out.push(t(lang, "🌦 ฝนและอากาศ", "🌦 Rain & weather"));
    const w = rainWindow(forecast.hours);
    if (forecast.raining) out.push(t(lang, "🌧 ตอนนี้ฝนกำลังตกแถวนั้น", "🌧 It's raining there right now."));
    if (w) {
      const when = w.from === w.to ? w.from : `${w.from}–${w.to}`;
      out.push(t(lang, `☔ โอกาสฝนตก ${w.chance}% ช่วง ${when} น. พกร่มด้วย`, `☔ ${w.chance}% chance of rain around ${when}, take an umbrella`));
    } else if (!forecast.raining) {
      out.push(t(lang, "☀️ ไม่น่ามีฝนใน 12 ชม.ข้างหน้า", "☀️ No rain expected in the next 12 hours"));
    }
    out.push(t(lang, `🌡 ${Math.round(forecast.temp)}°C รู้สึกเหมือน ${Math.round(forecast.feelsLike)}°C`,
      `🌡 ${Math.round(forecast.temp)}°C, feels like ${Math.round(forecast.feelsLike)}°C`));
    const heat = heatNote(forecast.feelsLike, lang);
    if (heat) out.push(heat);
  }
  return out.join("\n");
}
