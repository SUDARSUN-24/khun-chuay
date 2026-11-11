// PromptPay QR payload (Thai QR Payment / EMVCo "Merchant Presented Mode").
// Pure string building: no bank API, no fees. Any Thai banking app can scan it.
//
// A payload is a list of fields, each written as  ID (2 digits) + LENGTH (2 digits) + VALUE.
// The last field (63) is a CRC16 checksum so banking apps can detect a damaged code.

const PROMPTPAY_AID = "A000000677010111";

const field = (id, value) => id + String(value.length).padStart(2, "0") + value;

// CRC-16/CCITT-FALSE: polynomial 0x1021, start value 0xFFFF.
export function crc16(str) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(str)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Thai national ID: the 13th digit is a checksum of the first 12.
export function isValidThaiId(d) {
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}

// Accepts "081-234-5678", "0812345678", a national ID or a 15-digit e-wallet ID.
export function parseTarget(input) {
  const d = String(input).replace(/\D/g, "");
  if (/^0[689]\d{8}$/.test(d)) return { type: "phone", id: d };
  if (d.length === 13 && isValidThaiId(d)) return { type: "nationalId", id: d };
  if (d.length === 15) return { type: "ewallet", id: d };
  return null;
}

// Hide most digits when showing a target in a chat: 081-xxx-5678.
export function maskTarget(t) {
  if (t.type === "phone") return `${t.id.slice(0, 3)}-xxx-${t.id.slice(6)}`;
  return `${"x".repeat(t.id.length - 4)}${t.id.slice(-4)}`;
}

export function promptPayPayload(target, amount) {
  const t = typeof target === "string" ? parseTarget(target) : target;
  if (!t) throw new Error("invalid PromptPay ID");

  let account;
  if (t.type === "phone") account = field("01", "0066" + t.id.slice(1)); // 0812345678 -> 0066812345678
  else if (t.type === "nationalId") account = field("02", t.id);
  else account = field("03", t.id);

  let s =
    field("00", "01") +                      // payload format version
    field("01", amount ? "12" : "11") +      // 12 = one-time QR with amount, 11 = reusable
    field("29", field("00", PROMPTPAY_AID) + account) +
    field("58", "TH") +                      // country
    field("53", "764");                      // currency: Thai baht
  if (amount) s += field("54", Number(amount).toFixed(2));
  s += "6304";                               // CRC field header; checksum covers it too
  return s + crc16(s);
}
