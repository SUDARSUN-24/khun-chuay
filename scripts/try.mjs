// Try the bot in your terminal, no LINE or Cloudflare account needed.
//   npm run try
// Uses the real bot code + real air/weather data. LINE is simulated:
// replies print here, QR codes are saved as PNG files you can scan.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createApp } from "../src/app.js";
import { FakeKV } from "../test/fakes.js";

const ROOT = new URL("../", import.meta.url);
const DB_FILE = new URL(".try-data.json", ROOT);
const OUT_DIR = new URL("try-output/", ROOT);
mkdirSync(OUT_DIR, { recursive: true });

const PLACES = {
  siam: [13.7462, 100.5347], silom: [13.7279, 100.5340], bangna: [13.6683, 100.6050],
  ladprao: [13.8160, 100.5610], chiangmai: [18.7883, 98.9853], phuket: [7.8804, 98.3923],
};

const kv = new FakeKV(existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, "utf8")) : {});
const save = () => writeFileSync(DB_FILE, JSON.stringify(kv.toJSON(), null, 1));

let me = "Aom";
let inGroup = false;
let lastBill = null;
let qrCount = 0;
const outbox = [];

const line = {
  async reply(_token, messages) { outbox.push(...messages); },
  async push(to, messages) { outbox.push(...messages.map((m) => ({ ...m, pushed: to }))); },
  async displayName(src) { return src.userId.slice(1); },
};
const ORIGIN = "https://khun-chuay.local";
const app = createApp({ kv, line, secret: "try-mode-secret" });

const source = () => (inGroup ? { type: "group", groupId: "Cfriends", userId: "U" + me } : { type: "user", userId: "U" + me });

function flexTexts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "text" && node.text) out.push(node.text);
  for (const v of Object.values(node)) if (typeof v === "object") flexTexts(v, out);
  return out;
}

async function show(msg) {
  const tag = msg.pushed ? "🔔 (push) " : "";
  if (msg.type === "text") {
    console.log(`\n🤖 ${tag}${msg.text.replace(/\n/g, "\n   ")}`);
    if (msg.quickReply) console.log("   [buttons: " + msg.quickReply.items.map((i) => i.action.label).join(" | ") + "]");
    return;
  }
  if (msg.type === "flex") {
    console.log(`\n🤖 ${tag}[card] ` + flexTexts({ ...msg.contents, footer: undefined }).join("\n   "));
    const hero = msg.contents.hero?.url;
    if (hero) {
      const res = await app.handleRequest(new Request(hero));
      const file = new URL(`qr-${++qrCount}.png`, OUT_DIR);
      writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
      console.log(`   🖼  QR saved: ${decodeURIComponent(file.pathname).replace(/^\/([A-Z]:)/, "$1")}  (open it and scan with your bank app!)`);
    }
    const buttons = msg.contents.footer?.contents?.filter((b) => b.action?.type === "postback");
    if (buttons?.length) {
      lastBill = buttons[0].action.data.split("|")[1];
      console.log("   [buttons: ✅ I've paid → type /paid   |   👀 Who has paid → type /who]");
    }
  }
}

async function send(event) {
  await app.handleEvents([{ replyToken: "try", source: source(), ...event }], ORIGIN);
  while (outbox.length) await show(outbox.shift());
  save();
}

const HELP = `
Type messages like you would in LINE, e.g.
  ตั้งพร้อมเพย์ 0812345678     หาร 1850 4 vat sc     qr 500     ใครยังไม่จ่าย
  ฝุ่น   ฝน   อากาศ   แจ้งเตือน 7   เตือนฝน   (English works too: air, rain, split 1850 4)
Simulator commands:
  /loc siam|silom|bangna|ladprao|chiangmai|phuket   or   /loc 13.75 100.53   share a location
  /group        switch between private chat and a group chat
  /me Mai       become another person (to tap "I've paid" as a friend)
  /paid  /who   tap the buttons on the last bill
  /morning 7    pretend it's 7:00 and run the alert schedule
  /quit`;

console.log(`🙏 Khun Chuay simulator: you are "${me}" in a private chat.${HELP}`);
const rl = createInterface({ input: process.stdin, terminal: false });
const prompt = () => process.stdout.write(`\n[${me}${inGroup ? " @ group" : ""}] > `);
const echo = !process.stdin.isTTY; // when input is piped in, show it so the transcript reads naturally

prompt();
for await (const raw of rl) {
  const input = raw.trim();
  if (echo) console.log(input);
  if (!input) { prompt(); continue; }
  const [cmd, ...args] = input.split(/\s+/);
  try {
    if (cmd === "/quit" || cmd === "/exit") break;
    else if (cmd === "/help") console.log(HELP);
    else if (cmd === "/group") { inGroup = !inGroup; console.log(inGroup ? "👥 now in a group chat" : "👤 now in a private chat"); }
    else if (cmd === "/me") { me = args[0] || "Aom"; console.log(`🙋 you are now ${me}`); }
    else if (cmd === "/loc") {
      const [lat, lon] = PLACES[args[0]?.toLowerCase()] || args.map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { console.log("usage: /loc siam   or   /loc 13.75 100.53"); continue; }
      console.log(`📍 sharing location ${lat}, ${lon} ...`);
      await send({ type: "message", message: { type: "location", latitude: lat, longitude: lon } });
    } else if (cmd === "/paid" || cmd === "/who") {
      if (!lastBill) { console.log("no bill yet: try  หาร 1850 4"); continue; }
      await send({ type: "postback", postback: { data: `${cmd === "/paid" ? "paid" : "status"}|${lastBill}` } });
    } else if (cmd === "/morning") {
      const h = Number(args[0] ?? 7);
      const date = new Date(Date.UTC(2026, 0, 1, (h + 17) % 24)); // that hour in Bangkok
      const sent = await app.runSchedule(date);
      while (outbox.length) await show(outbox.shift());
      console.log(`(schedule at ${String(h).padStart(2, "0")}:00 sent ${sent.daily} daily + ${sent.rain} rain alerts)`);
      save();
    } else {
      await send({ type: "message", message: { type: "text", text: input } });
    }
  } catch (e) {
    console.log("⚠️ ", e.message);
  }
  prompt();
}
rl.close();
console.log("\n👋 bye");
