const https = require("https");

const API_KEY = process.env.APISPORTS_KEY;
const EREDIVISIE_LEAGUE_ID = 88;
const SEASON = 2024;

function apiFetch(endpoint, params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const options = {
      hostname: "v3.football.api-sports.io",
      path: `/${endpoint}?${query}`,
      method: "GET",
      headers: { "x-apisports-key": API_KEY },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.errors && Object.keys(json.errors).length > 0) {
            reject(new Error("API error: " + JSON.stringify(json.errors)));
          } else {
            resolve(json.response);
          }
        } catch (e) {
          reject(new Error("Parse error: " + e.message + " raw=" + data.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout after 15s")); });
    req.end();
  });
}

let _cache = null;
let _cachedAt = 0;
const TTL = 6 * 60 * 60 * 1000;

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
  const done = fixtures.filter(f => f.fixture.status.short === "FT" &&
    (f.teams.home.id === teamId || f.teams.away.id === teamId));
  if (!done.length) return { gf: 1.2, ga: 1.2 };
  let gf = 0, ga = 0;
  done.forEach(f => {
    const h = f.teams.home.id === teamId;
    gf += h ? (f.goals.home || 0) : (f.goals.away || 0);
    ga += h ? (f.goals.away || 0) : (f.goals.home || 0);
  });
  return { gf: Math.round(gf / done.length * 10) / 10, ga: Math.round(ga / done.length * 10) / 10 };
}

function buildWinRates(fixtures, teamId) {
  const home = fixtures.filter(f => f.fixture.status.short === "FT" && f.teams.home.id === teamId);
  const away = fixtures.filter(f => f.fixture.status.short === "FT" && f.teams.away.id === teamId);
  const rate = (arr, isHome) => {
    if (!arr.length) return 0.4;
    const wins = arr.filter(f => isHome ? f.goals.home > f.goals.away : f.goals.away > f.goals.home).length;
    return Math.round(wins / arr.length * 100) / 100;
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

// v3-style handler — return value pattern (works on Functions runtime v3 AND v4)
module.exports = async function (context, req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };

  const respond = (status, body) => {
    context.res = { status, headers, body: JSON.stringify(body) };
  };

  try {
    if (!API_KEY) {
      return respond(500, { error: "APISPORTS_KEY not set in Azure environment variables." });
    }

    if (_cache && (Date.now() - _cachedAt) < TTL) {
      context.log("cache hit");
      return respond(200, _cache);
    }

    context.log("fetching api-sports.io season=" + SEASON);

    const [fixtures, standingsResp] = await Promise.all([
      apiFetch("fixtures", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
      apiFetch("standings", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
    ]);

    context.log("fixtures=" + fixtures.length + " standingsResp=" + standingsResp.length);

    const standingsRaw = standingsResp[0]?.league?.standings?.[0] ||
      standingsResp[0]?.league?.standings || [];
    const standings = Array.isArray(standingsRaw[0]) ? standingsRaw[0] : standingsRaw;

    context.log("standings=" + standings.length);

    let teamsById = {};

    if (standings.length > 0) {
      standings.forEach(e => {
        const { id, name } = e.team;
        const g = buildGoalAverages(fixtures, id);
        const r = buildWinRates(fixtures, id);
        teamsById[id] = { id, name, form: buildForm(fixtures, id),
          gf: g.gf, ga: g.ga, homeWinRate: r.homeWinRate, awayWinRate: r.awayWinRate, rank: e.rank };
      });
    } else {
      const teamMap = {};
      fixtures.forEach(f => {
        [{ id: f.teams.home.id, name: f.teams.home.name },
         { id: f.teams.away.id, name: f.teams.away.name }]
          .forEach(({ id, name }) => { if (!teamMap[id]) teamMap[id] = name; });
      });
      Object.entries(teamMap).forEach(([id, name], idx) => {
        const nid = Number(id);
        const g = buildGoalAverages(fixtures, nid);
        const r = buildWinRates(fixtures, nid);
        teamsById[nid] = { id: nid, name, form: buildForm(fixtures, nid),
          gf: g.gf, ga: g.ga, homeWinRate: r.homeWinRate, awayWinRate: r.awayWinRate, rank: idx + 1 };
      });
    }

    const ids = Object.keys(teamsById).map(Number);
    const findId = s => ids.find(id => teamsById[id]?.name?.toLowerCase().includes(s));
    const ajaxId = findId("ajax"), psvId = findId("psv"), feyId = findId("feyenoord");

    const h2h = {};
    [[ajaxId, psvId], [ajaxId, feyId], [psvId, feyId]]
      .filter(([a, b]) => a && b)
      .forEach(([a, b]) => {
        const m = buildH2H(fixtures, a, b);
        if (m.length) h2h[`${a}|${b}`] = m;
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
      teams: teamsById, h2h, upcoming,
    };

    _cache = payload;
    _cachedAt = Date.now();

    return respond(200, payload);

  } catch (err) {
    context.log.error("ERROR: " + err.message);
    return respond(500, { error: err.message });
  }
};
