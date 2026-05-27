const https = require("https");

// ── Config ────────────────────────────────────────────────────────────────────
// Set APISPORTS_KEY in Azure Static Web Apps → Configuration → Application settings
const API_KEY = process.env.APISPORTS_KEY;
const EREDIVISIE_LEAGUE_ID = 88;
const SEASON = 2024; // 2024-25 season

// ── API-Football fetch (api-sports.io direct, NOT RapidAPI) ───────────────────
// Docs: https://www.api-football.com/documentation-v3#section/Authentication
// Host: v3.football.api-sports.io
// Auth header: x-apisports-key
function apiFetch(endpoint, params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const options = {
      hostname: "v3.football.api-sports.io",
      path: `/${endpoint}?${query}`,       // NOTE: no /v3/ prefix — hostname already has v3
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,        // correct header for direct api-sports.io access
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          // API-Football returns errors as an object in json.errors
          if (json.errors && Object.keys(json.errors).length > 0) {
            reject(new Error("API error: " + JSON.stringify(json.errors)));
          } else {
            resolve(json.response);
          }
        } catch (e) {
          reject(new Error("JSON parse error: " + e.message + " | raw: " + data.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── In-memory cache (survives warm function instances, resets on cold start) ──
let _memCache = null;
let _memCachedAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — free tier: 100 req/day

// ── Data builders ─────────────────────────────────────────────────────────────
function buildForm(fixtures, teamId) {
  return fixtures
    .filter((f) =>
      f.fixture.status.short === "FT" &&
      (f.teams.home.id === teamId || f.teams.away.id === teamId)
    )
    .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp)
    .slice(0, 5)
    .reverse()
    .map((f) => {
      const isHome = f.teams.home.id === teamId;
      const gf = isHome ? f.goals.home : f.goals.away;
      const ga = isHome ? f.goals.away : f.goals.home;
      if (gf > ga) return "W";
      if (gf < ga) return "L";
      return "D";
    });
}

function buildGoalAverages(fixtures, teamId) {
  const finished = fixtures.filter((f) =>
    f.fixture.status.short === "FT" &&
    (f.teams.home.id === teamId || f.teams.away.id === teamId)
  );
  if (!finished.length) return { gf: 1.2, ga: 1.2 };
  let totalGf = 0, totalGa = 0;
  finished.forEach((f) => {
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
  const home = fixtures.filter((f) =>
    f.fixture.status.short === "FT" && f.teams.home.id === teamId
  );
  const away = fixtures.filter((f) =>
    f.fixture.status.short === "FT" && f.teams.away.id === teamId
  );
  const rate = (arr, isHome) => {
    if (!arr.length) return 0.4;
    const wins = arr.filter((f) =>
      isHome ? f.goals.home > f.goals.away : f.goals.away > f.goals.home
    ).length;
    return Math.round((wins / arr.length) * 100) / 100;
  };
  return { homeWinRate: rate(home, true), awayWinRate: rate(away, false) };
}

function buildH2H(fixtures, aId, bId) {
  return fixtures
    .filter((f) =>
      f.fixture.status.short === "FT" &&
      ((f.teams.home.id === aId && f.teams.away.id === bId) ||
       (f.teams.home.id === bId && f.teams.away.id === aId))
    )
    .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp)
    .slice(0, 5)
    .map((f) => ({
      date: f.fixture.date.slice(0, 10),
      home: f.teams.home.name,
      homeId: f.teams.home.id,
      away: f.teams.away.name,
      awayId: f.teams.away.id,
      hs: f.goals.home,
      as: f.goals.away,
    }));
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };

  // Serve from in-memory cache if still fresh
  if (_memCache && (Date.now() - _memCachedAt) < CACHE_TTL_MS) {
    context.log("Serving from memory cache");
    context.res = { status: 200, headers, body: JSON.stringify(_memCache) };
    return;
  }

  // Guard: API key must be configured
  if (!API_KEY) {
    context.res = {
      status: 500,
      headers,
      body: JSON.stringify({
        error: "APISPORTS_KEY environment variable is not set. Configure it in Azure Static Web Apps → Settings → Configuration.",
      }),
    };
    return;
  }

  try {
    context.log("Fetching fresh data from api-sports.io, season", SEASON);

    // Fetch fixtures and standings in parallel (2 API calls of the 100/day free limit)
    const [fixtures, standingsResp] = await Promise.all([
      apiFetch("fixtures", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
      apiFetch("standings", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
    ]);

    context.log(`Fixtures received: ${fixtures.length}`);

    // standings shape: response[0].league.standings[0] = array of entries
    const standingsRaw =
      standingsResp[0]?.league?.standings?.[0] ||
      standingsResp[0]?.league?.standings ||
      [];
    const standings = Array.isArray(standingsRaw[0]) ? standingsRaw[0] : standingsRaw;

    context.log(`Standings entries: ${standings.length}`);

    // Build team map from standings (preferred) or fall back to fixture participants
    let teamsById = {};

    if (standings.length > 0) {
      standings.forEach((entry) => {
        const { id, name } = entry.team;
        const goals = buildGoalAverages(fixtures, id);
        const rates = buildWinRates(fixtures, id);
        teamsById[id] = {
          id, name,
          form: buildForm(fixtures, id),
          gf: goals.gf,
          ga: goals.ga,
          homeWinRate: rates.homeWinRate,
          awayWinRate: rates.awayWinRate,
          rank: entry.rank,
        };
      });
    } else {
      // Fallback: derive teams directly from fixture data
      context.log("Standings empty — deriving teams from fixtures");
      const teamMap = {};
      fixtures.forEach((f) => {
        [
          { id: f.teams.home.id, name: f.teams.home.name },
          { id: f.teams.away.id, name: f.teams.away.name },
        ].forEach(({ id, name }) => {
          if (!teamMap[id]) teamMap[id] = name;
        });
      });
      Object.entries(teamMap).forEach(([id, name], idx) => {
        const numId = Number(id);
        const goals = buildGoalAverages(fixtures, numId);
        const rates = buildWinRates(fixtures, numId);
        teamsById[numId] = {
          id: numId, name,
          form: buildForm(fixtures, numId),
          gf: goals.gf,
          ga: goals.ga,
          homeWinRate: rates.homeWinRate,
          awayWinRate: rates.awayWinRate,
          rank: idx + 1,
        };
      });
    }

    // Build H2H for the classic rivalries (from fixture data — no extra API calls)
    const teamIds = Object.keys(teamsById).map(Number);
    const findId = (substr) =>
      teamIds.find((id) => teamsById[id]?.name?.toLowerCase().includes(substr));

    const ajaxId = findId("ajax");
    const psvId  = findId("psv");
    const feyId  = findId("feyenoord");

    const h2hData = {};
    [[ajaxId, psvId], [ajaxId, feyId], [psvId, feyId]]
      .filter(([a, b]) => a && b)
      .forEach(([a, b]) => {
        const matches = buildH2H(fixtures, a, b);
        if (matches.length) h2hData[`${a}|${b}`] = matches;
      });

    // Upcoming fixtures (next 20, not yet started)
    const now = Date.now() / 1000;
    const upcoming = fixtures
      .filter((f) => f.fixture.status.short === "NS" && f.fixture.timestamp > now)
      .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp)
      .slice(0, 20)
      .map((f) => ({
        fixtureId: f.fixture.id,
        date: f.fixture.date,
        homeId: f.teams.home.id,
        homeName: f.teams.home.name,
        awayId: f.teams.away.id,
        awayName: f.teams.away.name,
        round: f.league.round,
      }));

    const payload = {
      cachedAt: Date.now(),
      season: SEASON,
      teamCount: Object.keys(teamsById).length,
      teams: teamsById,
      h2h: h2hData,
      upcoming,
    };

    // Store in memory cache
    _memCache = payload;
    _memCachedAt = Date.now();

    context.res = { status: 200, headers, body: JSON.stringify(payload) };
  } catch (err) {
    context.log.error("Handler error:", err.message, err.stack);
    context.res = {
      status: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
