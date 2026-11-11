import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceKm, nearestStation, pm25Level, rainWindow } from "../src/air.js";
import { computeSplit, parseSplit } from "../src/bill.js";
import { crc16, isValidThaiId, maskTarget, parseTarget, promptPayPayload } from "../src/promptpay.js";
import { qrMatrix, qrPng } from "../src/qrpng.js";

// ---------- PromptPay ----------
test("crc16 matches the CRC-16/CCITT-FALSE check value", () => {
  assert.equal(crc16("123456789"), "29B1");
});

test("parses phone numbers, national IDs and e-wallets", () => {
  assert.deepEqual(parseTarget("081-234-5678"), { type: "phone", id: "0812345678" });
  assert.deepEqual(parseTarget("0961234567"), { type: "phone", id: "0961234567" });
  assert.equal(parseTarget("021234567"), null); // landline: not PromptPay
  assert.equal(isValidThaiId("1101700230708"), true);
  assert.equal(isValidThaiId("1101700230705"), false);
  assert.deepEqual(parseTarget("1-1017-00230-70-8"), { type: "nationalId", id: "1101700230708" });
  assert.equal(parseTarget("1101700230705"), null);
  assert.equal(parseTarget("123456789012345").type, "ewallet");
  assert.equal(parseTarget("500"), null);
  assert.equal(maskTarget(parseTarget("0812345678")), "081-xxx-5678");
});

test("builds a PromptPay payload with amount and checksum", () => {
  const p = promptPayPayload("0812345678", 462.5);
  assert.equal(p,
    "000201" + "010212" + "29370016A000000677010111" + "01130066812345678" +
    "5802TH" + "5303764" + "5406462.50" + "6304" + crc16(p.slice(0, -4)));
  assert.match(promptPayPayload("0812345678"), /^000201010211/); // no amount = reusable QR
  assert.match(promptPayPayload("1101700230708", 10), /02131101700230708/);
});

test("QR PNG is a valid PNG of the right size", async () => {
  const png = await qrPng(promptPayPayload("0812345678", 100));
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const n = qrMatrix(promptPayPayload("0812345678", 100)).length;
  const width = new DataView(png.buffer).getUint32(16);
  assert.equal(width, (n + 8) * 10);
});

// ---------- bill splitting ----------
test("understands split commands in Thai and English", () => {
  assert.deepEqual(parseSplit("หาร 1850 4"), { total: 1850, people: 4, vat: false, sc: false });
  assert.deepEqual(parseSplit("หาร 1,850 4คน"), { total: 1850, people: 4, vat: false, sc: false });
  assert.deepEqual(parseSplit("หาร1850 4 คน vat sc"), { total: 1850, people: 4, vat: true, sc: true });
  assert.deepEqual(parseSplit("split ฿2,400.50 3 people +10%"), { total: 2400.5, people: 3, vat: false, sc: true });
  assert.deepEqual(parseSplit("แชร์ 900 3 ภาษี"), { total: 900, people: 3, vat: true, sc: false });
  assert.equal(parseSplit("หาร 1850").error, "people");
  assert.equal(parseSplit("หาร 1850 1").error, "people");
  assert.equal(parseSplit("หาร 1850 2.5").error, "people");
  assert.equal(parseSplit("หาร pizza").error, "format");
  assert.equal(parseSplit("หาร 0 4").error, "total");
});

test("splits money in satang, rounding shares up", () => {
  assert.equal(computeSplit({ total: 1850, people: 4 }).share, 462.5);
  const r = computeSplit({ total: 1000, people: 3, sc: true, vat: true });
  assert.equal(r.serviceCharge, 100);
  assert.equal(r.vat, 77);                // 7% of 1,100
  assert.equal(r.grandTotal, 1177);
  assert.equal(r.share, 392.34);          // 392.333... rounded up
  assert.ok(r.share * 3 >= r.grandTotal); // payer is never short
  assert.equal(computeSplit({ total: 0.1 + 0.2, people: 3 }).share, 0.1);
});

// ---------- air ----------
test("PM2.5 bands follow the Thai standard", () => {
  assert.equal(pm25Level(10).en, "Very good");
  assert.equal(pm25Level(15).en, "Very good");
  assert.equal(pm25Level(15.1).en, "Good");
  assert.equal(pm25Level(37.5).en, "Moderate");
  assert.equal(pm25Level(52).en, "Unhealthy for some");
  assert.equal(pm25Level(120).en, "Unhealthy");
});

test("finds the nearest station and rain windows", () => {
  assert.ok(Math.abs(distanceKm(13.7563, 100.5018, 18.7883, 98.9853) - 584) < 10); // Bangkok -> Chiang Mai
  const stations = [{ name: "A", lat: 13.73, lon: 100.54 }, { name: "B", lat: 13.67, lon: 100.6 }];
  assert.equal(nearestStation(stations, 13.665, 100.61).name, "B");
  const hours = [5, 20, 70, 80, 40, 90].map((c, i) => ({ time: `1${i}:00`, rainChance: c }));
  assert.deepEqual(rainWindow(hours), { from: "12:00", to: "13:00", chance: 80, inHours: 2 });
  assert.equal(rainWindow(hours, 50, 2), null);
});
