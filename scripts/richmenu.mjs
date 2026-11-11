// Installs the button menu on your LINE bot.
//   npm run richmenu     (asks for the channel access token)
// `npm run setup` also runs this for you.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { richMenuDefinition } from "../src/richmenu.js";

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

export async function installRichMenu(token, fetchFn = fetch) {
  const call = async (method, url, body, type = "application/json") => {
    const res = await fetchFn(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": type } : {}) },
      body: body && type === "application/json" ? JSON.stringify(body) : body,
    });
    if (!res.ok) throw new Error(`${method} ${url.replace(/.*\/v2\/bot/, "")} -> ${res.status} ${await res.text()}`);
    const t = await res.text();
    return t ? JSON.parse(t) : {};
  };

  const def = richMenuDefinition();
  // Remove older copies of our menu so re-running doesn't pile them up.
  const { richmenus = [] } = await call("GET", `${API}/richmenu/list`);
  for (const m of richmenus.filter((m) => m.name === def.name)) {
    await call("DELETE", `${API}/richmenu/${m.richMenuId}`);
  }
  const { richMenuId } = await call("POST", `${API}/richmenu`, def);
  const image = readFileSync(new URL("../assets/richmenu.png", import.meta.url));
  await call("POST", `${DATA_API}/richmenu/${richMenuId}/content`, image, "image/png");
  await call("POST", `${API}/user/all/richmenu/${richMenuId}`); // default for everyone
  return richMenuId;
}

// Run directly: npm run richmenu
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const token = (await rl.question("Paste the Channel access token: ")).trim();
  rl.close();
  try {
    const id = await installRichMenu(token);
    console.log(`✅ Menu installed (${id}). Close and reopen the chat with your bot in LINE to see it.`);
  } catch (e) {
    console.error("⚠️ ", e.message);
    process.exitCode = 1;
  }
}
