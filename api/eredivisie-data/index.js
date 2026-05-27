const https = require("https");

// ── Config ────────────────────────────────────────────────────────────────────
const API_KEY = process.env.APISPORTS_KEY;
const EREDIVISIE_LEAGUE_ID = 88;
const SEASON = 2024;

// ── API fetch ─────────────────────────────────────────────────────────────────
function apiFetch(endpoint, params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const options = {
      hostname: "v3.football.api-sports.io",
      path: `/${endpoint}?${query}`,
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.errors && Object.keys(json.errors).length > 0) {
            reject(new Error("API-Football error: " + JSON.stringify(json.errors)));
          } else {
            resolve(json.response);
          }
        } catch (e) {
          reject(new Error("JSON parse error: " + e.message + " | raw: " + data.slice(0, 300)));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Request timeout")); });
    req.end();
  });
}

// ── In-memory cache ───────────────────────────────────────────────────────────
let _memCache = null;
let _memCachedAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ── Data helpers ──────────────────────────────────────────────────────────────
function buildForm(fixtures, teamId) {
  return fixtures
    .filter(f => f.fixture.status.short === "FT" &&
      (f.teams.home.id === teamId || f.teams.away.id === teamId))
    .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp)
    .slice(0, 5).reverse()
    .map(f => {
      const isHome = f.teams.home.id === teamId;
      const gf = isHome ? f.goals.home : f.goals.away;
      const ga = isHome ? f.goals.away : f.goals.home;
      return gf > ga ? "W" : gf < ga ? "L" : "D";
    });
}

function buildGoalAverages(fixtures, teamId) {
  const finished = fixtures.filter(f =>
    f.fixture.status.short === "FT" &&
    (f.teams.home.id === teamId || f.teams.away.id === teamId));
  if (!finished.length) return { gf: 1.2, ga: 1.2 };
  let totalGf = 0, totalGa = 0;
  finished.forEach(f => {
    const isHome = f.teams.home.id === teamId;
    totalGf += isHome ? (f.goals.home || 0) : (f.goals.away || 0);
    totalGa += isHome ? (f.goals.away || 0) : (f.goals.home || 0);
  });
  return {
    gf: Math.round((totalGf / finished.length) * 10) / 10,
    ga: Math.round((totalGa / finished.length) * 10) / 10,
  };
}

function buildWinRates(fixtures, teamId) {
  const home = fixtures.filter(f => f.fixture.status.short === "FT" && f.teams.home.id === teamId);
  const away = fixtures.filter(f => f.fixture.status.short === "FT" && f.teams.away.id === teamId);
  const rate = (arr, isHome) => {
    if (!arr.length) return 0.4;
    const wins = arr.filter(f => isHome ? f.goals.home > f.goals.away : f.goals.away > f.goals.home).length;
    return Math.round((wins / arr.length) * 100) / 100;
  };
  return { homeWinRate: rate(home, true), awayWinRate: rate(away, false) };
}

function buildH2H(fixtures, aId, bId) {
  return fixtures
    .filter(f => f.fixture.status.short === "FT" &&
      ((f.teams.home.id === aId && f.teams.away.id === bId) ||
       (f.teams.home.id === bId && f.teams.away.id === aId)))
    .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp)
    .slice(0, 5)
    .map(f => ({
      date: f.fixture.date.slice(0, 10),
      home: f.teams.home.name, homeId: f.teams.home.id,
      away: f.teams.away.name, awayId: f.teams.away.id,
      hs: f.goals.home, as: f.goals.away,
    }));
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };

  // Always return JSON — never let Azure show a raw 500 page
  try {
    // Check API key first
    if (!API_KEY) {
      context.res = {
        status: 500, headers,
        body: JSON.stringify({
          error: "APISPORTS_KEY is not configured.",
          fix: "Go to Azure Portal → your Static Web App → Settings → Configuration → Add application setting: APISPORTS_KEY"
        })
      };
      return;
    }

    // Serve from memory cache if fresh
    if (_memCache && (Date.now() - _memCachedAt) < CACHE_TTL_MS) {
      context.log("Serving from memory cache");
      context.res = { status: 200, headers, body: JSON.stringify(_memCache) };
      return;
    }

    context.log("Fetching from api-sports.io, season", SEASON);

    const [fixtures, standingsResp] = await Promise.all([
      apiFetch("fixtures", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
      apiFetch("standings", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
    ]);

    context.log(`Fixtures: ${fixtures.length}, standings response items: ${standingsResp.length}`);

    const standingsRaw = standingsResp[0]?.league?.standings?.[0] ||
      standingsResp[0]?.league?.standings || [];
    const standings = Array.isArray(standingsRaw[0]) ? standingsRaw[0] : standingsRaw;

    let teamsById = {};
    if (standings.length > 0) {
      standings.forEach(entry => {
        const { id, name } = entry.team;
        const goals = buildGoalAverages(fixtures, id);
        const rates = buildWinRates(fixtures, id);
        teamsById[id] = { id, name, form: buildForm(fixtures, id),
          gf: goals.gf, ga: goals.ga,
          homeWinRate: rates.homeWinRate, awayWinRate: rates.awayWinRate, rank: entry.rank };
      });
    } else {
      const teamMap = {};
      fixtures.forEach(f => {
        [{ id: f.teams.home.id, name: f.teams.home.name },
         { id: f.teams.away.id, name: f.teams.away.name }]
          .forEach(({ id, name }) => { if (!teamMap[id]) teamMap[id] = name; });
      });
      Object.entries(teamMap).forEach(([id, name], idx) => {
        const numId = Number(id);
        const goals = buildGoalAverages(fixtures, numId);
        const rates = buildWinRates(fixtures, numId);
        teamsById[numId] = { id: numId, name, form: buildForm(fixtures, numId),
          gf: goals.gf, ga: goals.ga,
          homeWinRate: rates.homeWinRate, awayWinRate: rates.awayWinRate, rank: idx + 1 };
      });
    }

    const teamIds = Object.keys(teamsById).map(Number);
    const findId = s => teamIds.find(id => teamsById[id]?.name?.toLowerCase().includes(s));
    const ajaxId = findId("ajax"), psvId = findId("psv"), feyId = findId("feyenoord");

    const h2hData = {};
    [[ajaxId, psvId], [ajaxId, feyId], [psvId, feyId]]
      .filter(([a, b]) => a && b)
      .forEach(([a, b]) => {
        const matches = buildH2H(fixtures, a, b);
        if (matches.length) h2hData[`${a}|${b}`] = matches;
      });

    const now = Date.now() / 1000;
    const upcoming = fixtures
      .filter(f => f.fixture.status.short === "NS" && f.fixture.timestamp > now)
      .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp)
      .slice(0, 20)
      .map(f => ({
        fixtureId: f.fixture.id, date: f.fixture.date,
        homeId: f.teams.home.id, homeName: f.teams.home.name,
        awayId: f.teams.away.id, awayName: f.teams.away.name,
        round: f.league.round,
      }));

    const payload = {
      cachedAt: Date.now(), season: SEASON,
      teamCount: Object.keys(teamsById).length,
      teams: teamsById, h2h: h2hData, upcoming,
    };

    _memCache = payload;
    _memCachedAt = Date.now();

    context.res = { status: 200, headers, body: JSON.stringify(payload) };

  } catch (err) {
    // Always return JSON, never crash to a raw 500 page
    context.log.error("Function error:", err.message);
    context.res = {
      status: 500, headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
