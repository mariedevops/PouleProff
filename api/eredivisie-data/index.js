const { BlobServiceClient } = require("@azure/storage-blob");
const https = require("https");

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const STORAGE_CONNECTION = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER = "pouleproff-cache";
const BLOB_NAME = "eredivisie.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EREDIVISIE_LEAGUE_ID = 88;
const SEASON = 2024; // 2024-25 season

// ── Use native https instead of fetch (works on all Node versions) ─────────────
function apiFetch(endpoint, params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const options = {
      hostname: "api-football-v1.p.rapidapi.com",
      path: `/v3/${endpoint}?${query}`,
      method: "GET",
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
      },
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
          reject(new Error("JSON parse error: " + e.message));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Blob helpers ──────────────────────────────────────────────────────────────
async function readCache(containerClient) {
  try {
    const blob = containerClient.getBlobClient(BLOB_NAME);
    const exists = await blob.exists();
    if (!exists) return null;
    const buffer = await blob.downloadToBuffer();
    const parsed = JSON.parse(buffer.toString());
    const age = Date.now() - parsed.cachedAt;
    if (age > CACHE_TTL_MS) return null;
    console.log(`Cache hit (${Math.round(age / 60000)}min old)`);
    return parsed;
  } catch (e) {
    console.error("Cache read error:", e.message);
    return null;
  }
}

async function writeCache(containerClient, data) {
  try {
    await containerClient.createIfNotExists({ access: "private" });
    const blob = containerClient.getBlockBlobClient(BLOB_NAME);
    const content = JSON.stringify(data);
    await blob.upload(content, Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
    console.log("Cache written");
  } catch (e) {
    console.error("Cache write error:", e.message);
  }
}

// ── Data builders ─────────────────────────────────────────────────────────────
function buildForm(fixtures, teamId) {
  const finished = fixtures
    .filter((f) =>
      f.fixture.status.short === "FT" &&
      (f.teams.home.id === teamId || f.teams.away.id === teamId)
    )
    .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp)
    .slice(0, 5)
    .reverse();

  return finished.map((f) => {
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

  // Serve from blob cache if fresh
  let containerClient = null;
  if (STORAGE_CONNECTION) {
    try {
      const blobService = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION);
      containerClient = blobService.getContainerClient(CONTAINER);
      const cached = await readCache(containerClient);
      if (cached) {
        context.res = { status: 200, headers, body: JSON.stringify(cached) };
        return;
      }
    } catch (e) {
      console.error("Blob init error:", e.message);
    }
  }

  // Fetch fresh data
  try {
    console.log("Fetching from API-Football, season", SEASON);

    const [fixtures, standingsResp] = await Promise.all([
      apiFetch("fixtures", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
      apiFetch("standings", { league: EREDIVISIE_LEAGUE_ID, season: SEASON }),
    ]);

    console.log(`Got ${fixtures.length} fixtures`);

    // standings can be nested differently — handle both shapes
    const standingsRaw = standingsResp[0]?.league?.standings || standingsResp[0]?.standings || [];
    const standings = Array.isArray(standingsRaw[0]) ? standingsRaw[0] : standingsRaw;

    console.log(`Got ${standings.length} teams in standings`);

    // If standings empty, build teams from fixtures instead
    let teamsById = {};
    if (standings.length > 0) {
      standings.forEach((entry) => {
        const { id, name } = entry.team;
        const goals = buildGoalAverages(fixtures, id);
        const rates = buildWinRates(fixtures, id);
        teamsById[id] = {
          id, name,
          form: buildForm(fixtures, id),
          gf: goals.gf, ga: goals.ga,
          homeWinRate: rates.homeWinRate,
          awayWinRate: rates.awayWinRate,
          rank: entry.rank,
        };
      });
    } else {
      // Fallback: extract unique teams from fixtures
      console.log("Standings empty — building teams from fixtures");
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
          gf: goals.gf, ga: goals.ga,
          homeWinRate: rates.homeWinRate,
          awayWinRate: rates.awayWinRate,
          rank: idx + 1,
        };
      });
    }

    // H2H from fixtures (no extra API calls)
    const teamIds = Object.keys(teamsById).map(Number);
    const findId = (n) => teamIds.find((id) => teamsById[id]?.name?.toLowerCase().includes(n));
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

    // Upcoming fixtures
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

    if (containerClient) await writeCache(containerClient, payload);

    context.res = { status: 200, headers, body: JSON.stringify(payload) };
  } catch (err) {
    console.error("Error:", err.message, err.stack);
    context.res = {
      status: 500,
      headers,
      body: JSON.stringify({ error: err.message, stack: err.stack }),
    };
  }
};
