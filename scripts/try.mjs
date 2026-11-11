// Try the bot on your computer, no LINE or Cloudflare account needed.
//   double-click "Try Khun Chuay.cmd"   or   npm run try
// Uses the real bot code + real air/weather data. LINE is simulated:
// buttons are pressed with one key, QR codes are saved as PNGs you can scan.
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { RICH_MENU_BUTTONS } from "../src/richmenu.js";
import { FakeKV } from "../test/fakes.js";

const ROOT = new URL("../", import.meta.url);
const DB_FILE = new URL(".try-data.json", ROOT);
const OUT_DIR = new URL("try-output/", ROOT);
mkdirSync(OUT_DIR, { recursive: true });

const PLACES = {
  siam: [13.7462, 100.5347], silom: [13.7279, 100.534], bangna: [13.6683, 100.605],
  ladprao: [13.816, 100.561], chiangmai: [18.7883, 98.9853], phuket: [7.8804, 98.3923],
};
const kv = new FakeKV(existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, "utf8")) : {});
const save = () => writeFileSync(DB_FILE, JSON.stringify(kv.toJSON(), null, 1));

let me = "Aom";
let inGroup = false;
let buttons = [];   // buttons under the latest message, pressed with a, b, c...
let cardButtons = []; // buttons on the latest bill card
const openImages = process.platform === "win32" && process.stdin.isTTY;
const outbox = [];

const line = {
  async reply(_t, messages) { outbox.push(...messages); },
  async push(to, messages) { outbox.push(...messages.map((m) => ({ ...m, pushed: true }))); },
  async displayName(src) { return src.userId.slice(1); },
};
const ORIGIN = "https://khun-chuay.local";
const app = createApp({ kv, line, secret: "try-mode-secret" });
const source = () => (inGroup ? { type: "group", groupId: "Cfriends", userId: "U" + me } : { type: "user", userId: "U" + me });

const C = { dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", off: "\x1b[0m" };
const LETTERS = "abcdefghijklm";

function flexTexts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "text" && node.text) out.push(node.text);
  for (const v of Object.values(node)) if (typeof v === "object") flexTexts(v, out);
  return out;
}

async function show(msg) {
  const tag = msg.pushed ? `${C.yellow}🔔 notification:${C.off} ` : "";
  if (msg.type === "text") {
    console.log(`\n${C.green}🤖${C.off} ${tag}${msg.text.replace(/\n/g, "\n   ")}`);
  } else if (msg.type === "flex") {
    console.log(`\n${C.green}🤖${C.off} ${tag}${C.bold}[card]${C.off} ` + flexTexts({ ...msg.contents, footer: undefined }).join("\n   "));
    const hero = msg.contents.hero?.url;
    if (hero) {
      const res = await app.handleRequest(new Request(hero));
      const file = new URL(`qr-${Date.now()}.png`, OUT_DIR);
      writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
      const path = fileURLToPath(file);
      console.log(`   🖼  QR code: ${path}`);
      if (openImages) { exec(`start "" "${path}"`); console.log("   (opened it for you; scan it with your bank app, but don't pay!)"); }
    }
    cardButtons = (msg.contents.footer?.contents || []).map((b) => b.action).filter((a) => a?.type === "postback");
    if (cardButtons.length) console.log(`   ${C.cyan}[1] ${cardButtons[0].label}   [2] ${cardButtons[1].label}${C.off}  ${C.dim}← card buttons, type 1 or 2 (as whoever you are now)${C.off}`);
  }
  if (msg.quickReply) {
    buttons = msg.quickReply.items.map((i) => i.action);
    console.log("   " + buttons.map((a, i) => `${C.cyan}[${LETTERS[i]}] ${a.label}${C.off}`).join("  "));
  }
}

async function send(event) {
  buttons = [];
  await app.handleEvents([{ replyToken: "try", source: source(), ...event }], ORIGIN);
  if (!outbox.length) console.log(`${C.dim}   (the bot stays quiet: in groups it only answers commands)${C.off}`);
  while (outbox.length) await show(outbox.shift());
  save();
}

async function press(action) {
  if (action.type === "postback") {
    console.log(`${C.dim}   👆 you tapped "${action.displayText || action.label}"${C.off}`);
    return send({ type: "postback", postback: { data: action.data } });
  }
  if (action.type === "message") {
    console.log(`${C.dim}   👆 you tapped → "${action.text}"${C.off}`);
    return send({ type: "message", message: { type: "text", text: action.text } });
  }
  if (action.type === "location") return shareLocation("siam");
}

async function shareLocation(place) {
  const [lat, lon] = PLACES[place] || place.split(/[ ,]+/).map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return console.log("try: /loc siam   (or bangna, silom, ladprao, chiangmai, phuket)");
  console.log(`${C.dim}   📍 you shared your location (${PLACES[place] ? place : `${lat}, ${lon}`})${C.off}`);
  return send({ type: "message", message: { type: "location", latitude: lat, longitude: lon } });
}

function showMenu() {
  if (inGroup) {
    console.log(`${C.dim}   (LINE only shows the menu in private chats. In groups, type หารบิล or ใครยังไม่จ่าย)${C.off}`);
    return;
  }
  console.log(`\n${C.bold}📱 MENU${C.off}  ${RICH_MENU_BUTTONS.map((b, i) => `${C.cyan}[${i + 1}] ${b}${C.off}`).join("  ")}`);
  console.log(`${C.dim}   press 1-6 to tap a menu button · or type anything like in LINE${C.off}`);
}

console.log(`${C.bold}🙏 Khun Chuay, simulated LINE chat${C.off}
You're "${me}" chatting privately with the bot. Press a menu number to start.
${C.dim}Extra: /group (switch to a group chat) · /me Mai (become a friend) · /loc bangna · /morning 7 · /quit${C.off}`);
showMenu();

const rl = createInterface({ input: process.stdin, terminal: false });
const echo = !process.stdin.isTTY;
const prompt = () => process.stdout.write(`\n${C.bold}[${me}${inGroup ? " in group chat" : ""}]${C.off} > `);
prompt();

for await (const raw of rl) {
  const input = raw.trim();
  if (echo) console.log(input);
  const [cmd, ...args] = input.split(/\s+/);
  try {
    if (!input) showMenu();
    else if (cmd === "/quit" || cmd === "/exit") break;
    else if (/^[a-m]$/i.test(input) && buttons[LETTERS.indexOf(input.toLowerCase())]) await press(buttons[LETTERS.indexOf(input.toLowerCase())]);
    else if (/^[12]$/.test(input) && cardButtons.length && (inGroup || buttons.length === 0) && !(await inFlow())) await press(cardButtons[Number(input) - 1]);
    else if (/^[1-6]$/.test(input) && !inGroup && !(await inFlow())) await press({ type: "message", text: RICH_MENU_BUTTONS[Number(input) - 1] });
    else if (cmd === "/menu") showMenu();
    else if (cmd === "/group") { inGroup = !inGroup; buttons = []; console.log(inGroup ? "👥 you're now in a group chat with friends" : "👤 back to your private chat with the bot"); showMenu(); }
    else if (cmd === "/me") { me = args[0] || "Aom"; console.log(`🙋 you are now ${me}`); }
    else if (cmd === "/loc") await shareLocation((args.join(" ") || "siam").toLowerCase());
    else if (cmd === "/morning") {
      const h = Number(args[0] ?? 7);
      const sent = await app.runSchedule(new Date(Date.UTC(2026, 0, 1, (h + 17) % 24)));
      while (outbox.length) await show(outbox.shift());
      console.log(`${C.dim}(pretended it's ${String(h).padStart(2, "0")}:00: sent ${sent.daily} morning + ${sent.rain} rain alerts)${C.off}`);
      save();
    } else await send({ type: "message", message: { type: "text", text: input } });
  } catch (e) {
    console.log("⚠️ ", e.message);
  }
  prompt();
}
rl.close();
console.log("\n👋 bye");

// Is the bot waiting for an answer from me? Then digits are answers, not buttons.
async function inFlow() {
  const s = source();
  return Boolean(await kv.get(`flow:${s.groupId || s.userId}:${s.userId}`));
}
