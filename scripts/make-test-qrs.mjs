// Writes sample PromptPay QR PNGs to test/out/ for test/decode_qr.py,
// which scans them with OpenCV (an independent QR reader).
import { mkdirSync, writeFileSync } from "node:fs";
import { promptPayPayload } from "../src/promptpay.js";
import { qrPng } from "../src/qrpng.js";

const cases = [
  ["phone-462.50", "0812345678", 462.5],
  ["phone-no-amount", "0961234567", undefined],
  ["id-1177", "1101700230708", 1177],
  ["ewallet-0.01", "123456789012345", 0.01],
  ["phone-999999.99", "0891112222", 999999.99],
];
mkdirSync(new URL("../test/out/", import.meta.url), { recursive: true });
const manifest = [];
for (const [name, target, amount] of cases) {
  const payload = promptPayPayload(target, amount);
  writeFileSync(new URL(`../test/out/${name}.png`, import.meta.url), await qrPng(payload));
  manifest.push({ name, target, amount: amount ?? null, payload });
}
writeFileSync(new URL("../test/out/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2));
console.log(`wrote ${cases.length} QR images to test/out/`);
