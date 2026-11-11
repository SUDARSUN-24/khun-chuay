// Bill splitting: understand "หาร 1,850 4 คน vat sc" and do the money maths.
// All maths is done in satang (1/100 baht) as whole numbers, so 0.1 + 0.2
// rounding bugs can't happen.

const SPLIT_WORDS = /^(หาร|แชร์|แบ่ง|split|share)(?=\s|\d|$)/i;
const VAT_WORDS = /^(vat|แวต|แวท|ภาษี|\+?7%)$/i;
const SC_WORDS = /^(sc|service|svc|เซอร์วิส|เซอวิส|ค่าบริการ|\+?10%)$/i;
const PEOPLE_WORDS = /^(คน|people|ppl|persons?|pax)$/i;

const toNumber = (s) => Number(String(s).replace(/[,฿]|บาท/g, ""));
const isNumber = (s) => /^฿?\d[\d,]*(\.\d+)?(บาท)?$/.test(s);

export function isSplitCommand(text) {
  return SPLIT_WORDS.test(text.trim());
}

// Returns {total, people, vat, sc} or {error: "..."}
export function parseSplit(text) {
  const rest = text.trim().replace(SPLIT_WORDS, "").trim();
  // "4คน" -> "4 คน", "1850บาท" stays a number
  const tokens = rest.replace(/(\d)(คน)/g, "$1 $2").split(/\s+/).filter(Boolean);
  const nums = [];
  let vat = false, sc = false;
  for (const t of tokens) {
    if (VAT_WORDS.test(t)) vat = true;
    else if (SC_WORDS.test(t)) sc = true;
    else if (PEOPLE_WORDS.test(t)) continue;
    else if (isNumber(t)) nums.push(toNumber(t));
    else return { error: "format" };
  }
  if (nums.length === 0) return { error: "format" };
  if (nums.length === 1) return { error: "people" };
  if (nums.length > 2) return { error: "format" };
  const [total, people] = nums;
  if (!(total > 0) || total > 1_000_000) return { error: "total" };
  if (!Number.isInteger(people) || people < 2 || people > 50) return { error: "people" };
  return { total, people, vat, sc };
}

// Thai restaurants: service charge 10% first, then VAT 7% on top of that.
export function computeSplit({ total, people, vat, sc }) {
  const base = Math.round(total * 100);
  const scAmt = sc ? Math.round(base * 0.1) : 0;
  const vatAmt = vat ? Math.round((base + scAmt) * 0.07) : 0;
  const grand = base + scAmt + vatAmt;
  // Round each share UP to the satang, so the payer never ends up short.
  const share = Math.ceil(grand / people);
  return {
    base: base / 100,
    serviceCharge: scAmt / 100,
    vat: vatAmt / 100,
    grandTotal: grand / 100,
    share: share / 100,
    people,
  };
}

export const baht = (n) =>
  "฿" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
