const { BlobServiceClient } = require("@azure/storage-blob");

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const STORAGE_CONNECTION = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER = "pouleproff-cache";
const BLOB_NAME = "eredivisie.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EREDIVISIE_LEAGUE_ID = 88; // API-Football league ID for Eredivisie
const SEASON = 2024;

// ── Blob helpers ──────────────────────────────────────────────────────────────

async function readCache(containerClient) {
  try {
    const blob = containerClient.getBlobClient(BLOB_NAME);
    const exists = await blob.exists();
    if (!exists) return null;

    const buffer = await blob.downloadToBuffer();
    const parsed = JSON.parse(buffer.toString());

    const age = Date.now() - parsed.cachedAt;
    if (age > CACHE_TTL_MS) {
      console.log(`Cache stale (${Math.round(age / 3600000)}h old) — refreshing`);
      return null;
    }
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
    console.log("Cache written to blob storage");
  } catch (e) {
    console.error("Cache write error:", e.message);
  }
}

// ── API-Football fetcher ──────────────────────────────────────────────────────

async function apiFetch(endpoint, params) {
  const url = new URL(`https://api-football-v1.p.rapidapi.com/v3/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      "X-RapidAPI-Key": RAPIDAPI_KEY,
      "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
    },
  });
  if (!res.ok) throw new Error(`API-Football ${endpoint} → HTTP ${res.status}`);
  const json = await res.json();
  return json.response;
}

// ── Data builders ─────────────────────────────────────────────────────────────

function buildForm(fixtures, teamId) {
  // Last 5 finished matches involving this team, most recent last
  const finished = fixtures
    .filter(
      (f) =>
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
  const finished = fixtures.filter(
    (f) =>
      f.fixture.status.short === "FT" &&
      (f.teams.home.id === teamId || f.teams.away.id === teamId)
  );
  if (!finished.length) return { gf: 1.2, ga: 1.2 };

  let totalGf = 0,
    totalGa = 0;
  finished.forEach((f) => {
    const isHome = f.teams.home.id === teamId;
    totalGf += isHome ? f.goals.home ?? 0 : f.goals.away ?? 0;
    totalGa += isHome ? f.goals.away ?? 0 : f.goals.home ?? 0;
  });
  return {
    gf: Math.round((totalGf / finished.length) * 10) / 10,
    ga: Math.round((totalGa / finished.length) * 10) / 10,
  };
}

function buildWinRates(fixtures, teamId) {
  const home = fixtures.filter(
    (f) => f.fixture.status.short === "FT" && f.teams.home.id === teamId
  );
  const away = fixtures.filter(
    (f) => f.fixture.status.short === "FT" && f.teams.away.id === teamId
  );

  const rate = (arr, isHome) => {
    if (!arr.length) return 0.4;
    const wins = arr.filter((f) =>
      isHome ? f.goals.home > f.goals.away : f.goals.away > f.goals.home
    ).length;
    return Math.round((wins / arr.length) * 100) / 100;
  };

  return {
    homeWinRate: rate(home, true),
    awayWinRate: rate(away, false),
  };
}

function buildH2H(h2hFixtures) {
  return h2hFixtures
    .filter((f) => f.fixture.status.short === "FT")
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
  // CORS for your static site
  context.res = {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  };

  // ── Serve from blob cache if fresh ──
  let containerClient = null;
  if (STORAGE_CONNECTION) {
    const blobService = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION);
    containerClient = blobService.getContainerClient(CONTAINER);
    const cached = await readCache(containerClient);
    if (cached) {
      context.res.status = 200;
      context.res.body = JSON.stringify(cached);
      return;
    }
  }

  // ── Fetch fresh data (3 API calls) ──
  try {
    console.log("Fetching fresh data from API-Football...");

    // Call 1: all fixtures this season (finished + upcoming)
    const fixtures = await apiFetch("fixtures", {
      league: EREDIVISIE_LEAGUE_ID,
      season: SEASON,
    });

    // Call 2: standings (for team IDs + official names)
    const standingsResp = await apiFetch("standings", {
      league: EREDIVISIE_LEAGUE_ID,
      season: SEASON,
    });
    const standings = standingsResp[0]?.league?.standings[0] ?? [];

    // Build team map keyed by team ID
    const teamsById = {};
    standings.forEach((entry) => {
      const { id, name } = entry.team;
      const goals = buildGoalAverages(fixtures, id);
      const rates = buildWinRates(fixtures, id);
      teamsById[id] = {
        id,
        name,
        form: buildForm(fixtures, id),
        gf: goals.gf,
        ga: goals.ga,
        homeWinRate: rates.homeWinRate,
        awayWinRate: rates.awayWinRate,
        rank: entry.rank,
      };
    });

    // Call 3: H2H for top rivalry pairs (Ajax-PSV, Ajax-Feyenoord, PSV-Feyenoord)
    // We get the IDs from the standings we already have
    const findId = (name) =>
      standings.find((s) => s.team.name.toLowerCase().includes(name))?.team.id;
    const ajaxId = findId("ajax");
    const psvId = findId("psv");
    const feyId = findId("feyenoord");

    const h2hData = {};
    const rivalries = [
      [ajaxId, psvId],
      [ajaxId, feyId],
      [psvId, feyId],
    ].filter(([a, b]) => a && b);

    // These 3 H2H calls are included in the 3 total budget above (we swap
    // standings for 1 call + fixtures covers form, so total stays at 3).
    // If you want H2H beyond the current-season fixtures, uncomment below.
    // For now we derive H2H from the fixtures array (0 extra calls).
    rivalries.forEach(([aId, bId]) => {
      const h2h = buildH2H(
        fixtures.filter(
          (f) =>
            (f.teams.home.id === aId && f.teams.away.id === bId) ||
            (f.teams.home.id === bId && f.teams.away.id === aId)
        )
      );
      if (h2h.length) h2hData[`${aId}|${bId}`] = h2h;
    });

    // Upcoming fixtures (next 5 matchdays)
    const now = Date.now() / 1000;
    const upcoming = fixtures
      .filter(
        (f) =>
          f.fixture.status.short === "NS" && f.fixture.timestamp > now
      )
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
      teams: teamsById,
      h2h: h2hData,
      upcoming,
    };

    // Write to blob cache
    if (containerClient) await writeCache(containerClient, payload);

    context.res.status = 200;
    context.res.body = JSON.stringify(payload);
  } catch (err) {
    console.error("API-Football error:", err);
    context.res.status = 500;
    context.res.body = JSON.stringify({ error: err.message });
  }
};
