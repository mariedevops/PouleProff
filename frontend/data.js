// PouleProff — data layer
// Fetches from Azure Function (which caches in blob storage for 24h).
// Falls back to hardcoded data if the API is unreachable.
//
// After deploying, set your function URL in index.html:
//   <script>window.POULEPROFF_API_URL = "https://<your-app>.azurewebsites.net/api/eredivisie-data";</script>

const POULEPROFF_API_URL =
  window.POULEPROFF_API_URL ||
  "/api/eredivisie-data";

// ── In-memory session cache ───────────────────────────────────────────────────
let _cache = null;

async function loadEredivisieData() {
  if (_cache) return _cache;
  try {
    const res = await fetch(POULEPROFF_API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _cache = await res.json();
    console.log(`[PouleProff] Live data loaded. Cached at: ${new Date(_cache.cachedAt).toLocaleString("nl-NL")}`);
    return _cache;
  } catch (err) {
    console.warn("[PouleProff] API unavailable, using fallback data.", err.message);
    _cache = FALLBACK_DATA;
    return _cache;
  }
}

function getTeams(data)          { return data.teams; }
function getH2HById(data, a, b)  { return data.h2h[`${a}|${b}`] || data.h2h[`${b}|${a}`] || null; }
function getUpcoming(data)       { return data.upcoming || []; }

// ── Fallback hardcoded data ───────────────────────────────────────────────────
const FALLBACK_DATA = {
  cachedAt: new Date("2026-05-01").getTime(),
  isFallback: true,
  season: 2024,
  teams: {
    194:  { id: 194,  name: "Ajax",              form: ["W","W","D","W","W"], gf: 2.5, ga: 0.9,  homeWinRate: 0.78, awayWinRate: 0.55 },
    197:  { id: 197,  name: "PSV",               form: ["W","W","W","D","W"], gf: 2.8, ga: 0.8,  homeWinRate: 0.83, awayWinRate: 0.62 },
    198:  { id: 198,  name: "Feyenoord",         form: ["W","L","W","W","D"], gf: 2.2, ga: 1.1,  homeWinRate: 0.72, awayWinRate: 0.47 },
    200:  { id: 200,  name: "AZ Alkmaar",        form: ["W","D","W","L","W"], gf: 2.0, ga: 1.2,  homeWinRate: 0.65, awayWinRate: 0.42 },
    202:  { id: 202,  name: "FC Twente",         form: ["D","W","D","W","L"], gf: 1.7, ga: 1.3,  homeWinRate: 0.58, awayWinRate: 0.35 },
    203:  { id: 203,  name: "FC Utrecht",        form: ["W","L","D","W","W"], gf: 1.6, ga: 1.2,  homeWinRate: 0.61, awayWinRate: 0.31 },
    204:  { id: 204,  name: "Sparta Rotterdam",  form: ["L","D","W","D","L"], gf: 1.3, ga: 1.5,  homeWinRate: 0.45, awayWinRate: 0.22 },
    206:  { id: 206,  name: "NEC Nijmegen",      form: ["L","W","L","D","W"], gf: 1.4, ga: 1.4,  homeWinRate: 0.50, awayWinRate: 0.27 },
    1374: { id: 1374, name: "Go Ahead Eagles",   form: ["W","D","L","W","D"], gf: 1.5, ga: 1.4,  homeWinRate: 0.55, awayWinRate: 0.25 },
    207:  { id: 207,  name: "sc Heerenveen",     form: ["D","L","D","W","L"], gf: 1.2, ga: 1.6,  homeWinRate: 0.42, awayWinRate: 0.20 },
    208:  { id: 208,  name: "PEC Zwolle",        form: ["L","L","D","L","W"], gf: 1.1, ga: 1.7,  homeWinRate: 0.38, awayWinRate: 0.18 },
    209:  { id: 209,  name: "Fortuna Sittard",   form: ["L","D","L","D","L"], gf: 1.0, ga: 1.8,  homeWinRate: 0.35, awayWinRate: 0.16 },
    211:  { id: 211,  name: "NAC Breda",         form: ["D","L","W","L","D"], gf: 1.2, ga: 1.6,  homeWinRate: 0.40, awayWinRate: 0.18 },
    210:  { id: 210,  name: "Willem II",         form: ["L","D","L","W","L"], gf: 1.1, ga: 1.7,  homeWinRate: 0.36, awayWinRate: 0.17 },
    1398: { id: 1398, name: "Almere City",       form: ["L","L","D","L","L"], gf: 0.9, ga: 2.0,  homeWinRate: 0.28, awayWinRate: 0.12 },
    212:  { id: 212,  name: "Heracles Almelo",   form: ["D","L","W","L","L"], gf: 1.2, ga: 1.7,  homeWinRate: 0.40, awayWinRate: 0.18 },
    213:  { id: 213,  name: "FC Groningen",      form: ["W","L","D","W","L"], gf: 1.3, ga: 1.5,  homeWinRate: 0.48, awayWinRate: 0.24 },
    214:  { id: 214,  name: "RKC Waalwijk",      form: ["L","D","L","L","D"], gf: 1.0, ga: 1.8,  homeWinRate: 0.33, awayWinRate: 0.15 },
  },
  h2h: {
    "194|197": [
      { date: "2025-09-21", home: "Ajax",      homeId: 194, away: "PSV",       awayId: 197, hs: 2, as: 2 },
      { date: "2025-02-16", home: "PSV",       homeId: 197, away: "Ajax",      awayId: 194, hs: 3, as: 0 },
      { date: "2024-10-20", home: "Ajax",      homeId: 194, away: "PSV",       awayId: 197, hs: 1, as: 2 },
    ],
    "194|198": [
      { date: "2025-10-26", home: "Feyenoord", homeId: 198, away: "Ajax",      awayId: 194, hs: 2, as: 1 },
      { date: "2025-04-07", home: "Ajax",      homeId: 194, away: "Feyenoord", awayId: 198, hs: 1, as: 1 },
    ],
    "197|198": [
      { date: "2025-11-02", home: "Feyenoord", homeId: 198, away: "PSV",       awayId: 197, hs: 1, as: 3 },
      { date: "2025-03-09", home: "PSV",       homeId: 197, away: "Feyenoord", awayId: 198, hs: 2, as: 1 },
    ],
  },
  upcoming: [],
};
