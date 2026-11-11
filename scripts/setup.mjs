// One-command deploy:  npm run setup
// 1. log in to Cloudflare (opens your browser)   2. create the free KV storage
// 3. deploy the bot                                4. store your LINE keys as secrets
// 5. print the webhook URL to paste into LINE
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { installRichMenu } from "./richmenu.mjs";

const TOML = new URL("../wrangler.toml", import.meta.url);

function run(args, { input, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["wrangler", ...args], {
      shell: true,
      stdio: [input != null ? "pipe" : "inherit", capture ? "pipe" : "inherit", "inherit"],
    });
    let out = "";
    if (capture) p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler ${args[0]} failed (${code})`))));
  });
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const step = (n, s) => console.log(`\n━━━ Step ${n}/5: ${s} ━━━`);

try {
  step(1, "Cloudflare login");
  try { await run(["whoami"], { capture: true }).then((o) => { if (/not authenticated/i.test(o)) throw 0; }); }
  catch { await run(["login"]); }

  step(2, "Free KV storage");
  let toml = readFileSync(TOML, "utf8");
  if (toml.includes("REPLACE_WITH_KV_ID")) {
    const out = await run(["kv", "namespace", "create", "khun-chuay-db"], { capture: true });
    const id = out.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/)?.[1];
    if (!id) throw new Error("Couldn't read the new KV id above. Copy it into wrangler.toml (id = \"...\") and run npm run setup again.");
    writeFileSync(TOML, toml.replace("REPLACE_WITH_KV_ID", id));
    console.log(`✅ KV storage created (${id})`);
  } else console.log("✅ KV storage already set up");

  step(3, "Deploy the bot");
  const deployOut = await run(["deploy"], { capture: true });
  const url = deployOut.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];

  step(4, "LINE keys (from developers.line.biz ➜ your channel)");
  console.log("They're stored encrypted in Cloudflare, never in the code or on GitHub.");
  const secret = (await rl.question("Paste the Channel secret (Basic settings tab): ")).trim();
  const token = (await rl.question("Paste the Channel access token (Messaging API tab ➜ Issue): ")).trim();
  if (!secret || !token) throw new Error("Both keys are needed. Run npm run setup again when you have them.");
  await run(["secret", "put", "LINE_CHANNEL_SECRET"], { input: secret });
  await run(["secret", "put", "LINE_CHANNEL_ACCESS_TOKEN"], { input: token });
  try {
    await installRichMenu(token);
    console.log("✅ Button menu installed in LINE");
  } catch (e) {
    console.log(`⚠️  Couldn't install the button menu (${e.message}). Run "npm run richmenu" later to retry.`);
  }

  step(5, "Connect LINE to the bot");
  const hook = url ? `${url}/webhook` : "https://khun-chuay.<your-subdomain>.workers.dev/webhook";
  console.log(`
In LINE Developers ➜ your channel ➜ Messaging API tab:
  • Webhook URL:  ${hook}
  • Press "Verify" (should say Success), turn ON "Use webhook"
In LINE Official Account Manager ➜ Settings ➜ Response settings:
  • turn OFF "Auto-response" and "Greeting message" (the bot does those)
  • turn ON "Allow bot to join group chats" (Messaging API settings)

🎉 Done! Add the bot as a friend with the QR code on the Messaging API tab and say "สวัสดี".`);
} catch (e) {
  console.error(`\n⚠️  ${e.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
