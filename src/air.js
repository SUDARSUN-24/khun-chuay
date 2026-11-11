// Air quality + rain for wherever the user is.
//  - Real PM2.5 readings: Thailand's Pollution Control Department (Air4Thai), 170+ stations.
//  - Forecasts (PM2.5 later today, rain, heat): Open-Meteo. Free, no key.

const AIR4THAI = "https://air4thai.pcd.go.th/services/getNewAQI_JSON.php";
const METEO = "https://api.open-meteo.com/v1/forecast";
const METEO_AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";

// Thailand's PM2.5 bands (Pollution Control Department, 2023 standard), µg/m³.
export const PM25_LEVELS = [
  { max: 15, emoji: "🔵", th: "ดีมาก", en: "Very good",
    tipTh: "อากาศดีมาก ออกไปข้างนอกได้สบาย", tipEn: "Great air, enjoy being outside." },
  { max: 25, emoji: "🟢", th: "ดี", en: "Good",
    tipTh: "อากาศดี ทำกิจกรรมกลางแจ้งได้ตามปกติ", tipEn: "Good air, outdoor activities are fine." },
  { max: 37.5, emoji: "🟡", th: "ปานกลาง", en: "Moderate",
    tipTh: "คนที่แพ้ง่าย/มีโรคประจำตัว ลดเวลาอยู่กลางแจ้ง", tipEn: "Sensitive people should limit long outdoor activity." },
  { max: 75, emoji: "🟠", th: "เริ่มมีผลต่อสุขภาพ", en: "Unhealthy for some",
    tipTh: "ใส่หน้ากาก N95 เวลาออกข้างนอก ลดออกกำลังกายกลางแจ้ง", tipEn: "Wear an N95 mask outside and cut down outdoor exercise." },
  { max: Infinity, emoji: "🔴", th: "มีผลต่อสุขภาพ", en: "Unhealthy",
    tipTh: "อยู่ในอาคาร ปิดหน้าต่าง เปิดเครื่องฟอกอากาศ ใส่ N95 ถ้าต้องออกไป", tipEn: "Stay indoors, close windows, run an air purifier; N95 if you must go out." },
];

export const pm25Level = (v) => PM25_LEVELS.find((l) => v <= l.max);

export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

async function getJson(fetchFn, url, ms = 10000) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(ms), headers: { "User-Agent": "khun-chuay-line-bot" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Station list is ~135 KB and updates hourly: keep a copy for 15 minutes.
export async function getStations(fetchFn, kv) {
  const cached = kv && (await kv.get("cache:stations", "json"));
  if (cached) return cached;
  const data = await getJson(fetchFn, AIR4THAI);
  const stations = data.stations
    .map((s) => ({
      name: s.nameTH?.trim(), nameEn: s.nameEN?.trim(), area: s.areaTH, areaEn: s.areaEN,
      lat: Number(s.lat), lon: Number(s.long),
      pm25: Number(s.AQILast?.PM25?.value),
      time: `${s.AQILast?.date} ${s.AQILast?.time}`,
    }))
    .filter((s) => Number.isFinite(s.lat) && s.pm25 >= 0);
  if (kv) await kv.put("cache:stations", JSON.stringify(stations), { expirationTtl: 900 });
  return stations;
}

// Station times are Bangkok local time: "2026-11-12 07:00".
export function stationAgeHours(station, now = new Date()) {
  const t = new Date(station.time.replace(" ", "T") + ":00+07:00");
  return Number.isNaN(t.getTime()) ? Infinity : (now - t) / 3600000;
}

export function nearestStation(stations, lat, lon) {
  let best = null;
  for (const s of stations) {
    const d = distanceKm(lat, lon, s.lat, s.lon);
    if (!best || d < best.km) best = { ...s, km: d };
  }
  return best;
}

export async function getForecast(fetchFn, lat, lon) {
  const q = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=Asia%2FBangkok`;
  const [wx, air] = await Promise.all([
    getJson(fetchFn, `${METEO}?${q}&current=temperature_2m,apparent_temperature,precipitation` +
      `&hourly=precipitation_probability,precipitation,apparent_temperature&forecast_hours=14`),
    getJson(fetchFn, `${METEO_AIR}?${q}&current=pm2_5&hourly=pm2_5&forecast_hours=14`).catch(() => null),
  ]);
  const hours = wx.hourly.time.map((t, i) => ({
    time: t.slice(11, 16),
    rainChance: wx.hourly.precipitation_probability[i] ?? 0,
    rainMm: wx.hourly.precipitation[i] ?? 0,
    feelsLike: wx.hourly.apparent_temperature[i],
    pm25: air?.hourly?.pm2_5?.[i] ?? null,
  }));
  return {
    temp: wx.current.temperature_2m,
    feelsLike: wx.current.apparent_temperature,
    raining: wx.current.precipitation > 0.1,
    modelPm25: air?.current?.pm2_5 ?? null,
    hours,
  };
}

// First window in the next `within` hours where rain is likely.
export function rainWindow(hours, threshold = 50, within = 12) {
  const next = hours.slice(0, within);
  const start = next.findIndex((h) => h.rainChance >= threshold);
  if (start === -1) return null;
  let end = start;
  while (end + 1 < next.length && next[end + 1].rainChance >= threshold) end++;
  const peak = Math.max(...next.slice(start, end + 1).map((h) => h.rainChance));
  return { from: next[start].time, to: next[end].time, chance: peak, inHours: start };
}

export function peakPm25(hours, within = 14) {
  const vals = hours.slice(0, within).filter((h) => h.pm25 != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => (b.pm25 > a.pm25 ? b : a));
}

export function heatNote(feelsLike, lang) {
  if (feelsLike >= 41) return lang === "th"
    ? "🥵 ร้อนอันตราย ดื่มน้ำบ่อยๆ หลบแดดช่วงบ่าย" : "🥵 Dangerous heat: drink water often, avoid afternoon sun.";
  if (feelsLike >= 36) return lang === "th"
    ? "☀️ ร้อนมาก พกน้ำติดตัวด้วย" : "☀️ Very hot: carry water.";
  return null;
}
