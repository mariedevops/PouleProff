// PouleProff — F1 data Azure Function
// Fetches from Jolpica-F1 (free, no key, drop-in Ergast successor)
// Caches in-memory for 24h. No env vars required.
//
// Base URL: https://api.jolpi.ca/ergast/f1/
// Rate limit: 4 req/s, 500 req/hr — safe with 24h caching (3 calls per refresh)

const https = require("https");

const JOLPICA_BASE = "api.jolpi.ca";
const SEASON = "current"; // always fetch the live season
const TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── HTTP helper ───────────────────────────────────────────────────────────────
function jolpicaFetch(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: JOLPICA_BASE,
      path: `/ergast/f1/${path}`,
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "PouleProff/2.0 (https://github.com/your-repo)",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("JSON parse error: " + e.message + " raw=" + data.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

// ── In-memory cache ───────────────────────────────────────────────────────────
let _cache = null;
let _cachedAt = 0;

// ── Team colors (stable, doesn't change mid-season) ───────────────────────────
const TEAM_COLORS = {
  "red_bull":       "#3671C6",
  "ferrari":        "#E8002D",
  "mclaren":        "#FF8000",
  "mercedes":       "#27F4D2",
  "aston_martin":   "#358C75",
  "alpine":         "#FF87BC",
  "williams":       "#64C4FF",
  "rb":             "#6692FF",
  "kick_sauber":    "#52E252",
  "haas":           "#B6BABD",
};

function teamColor(constructorId) {
  return TEAM_COLORS[constructorId] || "#888888";
}

// ── Circuit metadata (stable reference data) ──────────────────────────────────
// circuitId from Jolpica → { type, notes, flag }
const CIRCUIT_META = {
  bahrain:          { type: "technical",  flag: "🇧🇭", notes: "Lange rechte stukken. Red Bull traditioneel sterk." },
  jeddah:           { type: "street",     flag: "🇸🇦", notes: "Snel stadscircuit. Ferrari en McLaren goed op high-speed layouts." },
  albert_park:      { type: "mixed",      flag: "🇦🇺", notes: "Parkbaan Melbourne. Sainz en Russell winnen hier graag." },
  suzuka:           { type: "classic",    flag: "🇯🇵", notes: "Technisch rijderscircuit. Red Bull & Honda thuis op Suzuka." },
  shanghai:         { type: "mixed",      flag: "🇨🇳", notes: "Sprint weekend. Lange rug voor DRS-treinen." },
  miami:            { type: "street",     flag: "🇺🇸", notes: "McLaren-territorium. Norris en Piastri winnen hier graag." },
  monaco:           { type: "street",     flag: "🇲🇨", notes: "Kwalificatie wint de race. Leclerc en Verstappen dol op Monaco." },
  villeneuve:       { type: "mixed",      flag: "🇨🇦", notes: "Muur der kampioenen. Safety car bijna gegarandeerd." },
  catalunya:        { type: "technical",  flag: "🇪🇸", notes: "Vlak circuit, goed voor upgrades testen." },
  red_bull_ring:    { type: "fast",       flag: "🇦🇹", notes: "Sprint weekend. Kort circuit, snel en krachtig. Red Bull home race." },
  silverstone:      { type: "fast",       flag: "🇬🇧", notes: "McLaren thuisrace. Norris en Russell hoog favoriet." },
  hungaroring:      { type: "technical",  flag: "🇭🇺", notes: "Kronkelend circuit, moeilijk inhalen. Ferrari goed hier." },
  spa:              { type: "classic",    flag: "🇧🇪", notes: "Eau Rouge. Verstappen wint Spa al jaren." },
  zandvoort:        { type: "technical",  flag: "🇳🇱", notes: "Oranje-zee! Verstappen overweldigend favoriet." },
  monza:            { type: "fast",       flag: "🇮🇹", notes: "Tempel van de snelheid. Ferrari-thuisrace." },
  baku:             { type: "street",     flag: "🇦🇿", notes: "Chaotisch stadscircuit. Safety car bijna gegarandeerd." },
  marina_bay:       { type: "street",     flag: "🇸🇬", notes: "Nachtrace. Technisch en zwaar. Sainz sterk in Singapore." },
  americas:         { type: "mixed",      flag: "🇺🇸", notes: "Sprint weekend. COTA. Red Bull/McLaren top." },
  rodriguez:        { type: "fast",       flag: "🇲🇽", notes: "Hoge ligging, minder downforce nodig. Verstappen altijd sterk." },
  interlagos:       { type: "mixed",      flag: "🇧🇷", notes: "Sprint weekend. Regen veelvoorkomend. Russell schitterde in 2024." },
  las_vegas:        { type: "street",     flag: "🇺🇸", notes: "Nachtrace Strip. Koud asfalt tricky voor banden." },
  losail:           { type: "fast",       flag: "🇶🇦", notes: "Sprint weekend. Banden slijten snel." },
  yas_marina:       { type: "mixed",      flag: "🇦🇪", notes: "Seizoensfinale. Red Bull en McLaren traditioneel sterk." },
};

function circuitMeta(circuitId) {
  return CIRCUIT_META[circuitId] || { type: "mixed", flag: "🏁", notes: "" };
}

// ── Derive recent form from results (last 5 race finishes per driver) ─────────
function buildDriverForms(allResults) {
  // allResults: array of race result objects from Jolpica
  // Each race → race.Results[i] = { Driver.driverId, position, Constructor.constructorId }
  const driverRaces = {}; // driverId → [ { position, raceName }, ... ] newest first
  allResults.forEach(race => {
    (race.Results || []).forEach(r => {
      const id = r.Driver.driverId;
      if (!driverRaces[id]) driverRaces[id] = [];
      driverRaces[id].push(parseInt(r.position, 10));
    });
  });
  // allResults is oldest→newest from Jolpica, so last 5 = slice(-5)
  const form = {};
  Object.entries(driverRaces).forEach(([id, positions]) => {
    form[id] = positions.slice(-5); // last 5 finishes
  });
  return form;
}

// ── Build payload ─────────────────────────────────────────────────────────────
function buildPayload(standingsData, resultsData, racesData) {
  const standingsList =
    standingsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];

  const allResults = resultsData?.MRData?.RaceTable?.Races || [];
  const driverForms = buildDriverForms(allResults);

  const raceCalendar = racesData?.MRData?.RaceTable?.Races || [];
  const currentSeason = racesData?.MRData?.RaceTable?.season || new Date().getFullYear();

  // Build drivers array
  const drivers = standingsList.map(entry => {
    const dId = entry.Driver.driverId;
    const constructorId = entry.Constructors?.[0]?.constructorId || "unknown";
    const formPositions = driverForms[dId] || [10, 10, 10, 10, 10];

    return {
      id: dId,
      name: `${entry.Driver.givenName} ${entry.Driver.familyName}`,
      code: entry.Driver.code || dId.slice(0, 3).toUpperCase(),
      team: entry.Constructors?.[0]?.name || "Unknown",
      constructorId,
      teamColor: teamColor(constructorId),
      points: parseFloat(entry.points) || 0,
      wins: parseInt(entry.wins, 10) || 0,
      position: parseInt(entry.position, 10),
      form: formPositions, // array of finish positions, newest last
    };
  });

  // Build race calendar
  const races = raceCalendar.map(race => {
    const cId = race.Circuit?.circuitId || "";
    const meta = circuitMeta(cId);
    return {
      id: `${race.season}_${race.round}`,
      round: parseInt(race.round, 10),
      name: race.raceName,
      circuit: cId,
      circuitName: race.Circuit?.circuitName || "",
      country: race.Circuit?.Location?.country || "",
      flag: meta.flag,
      date: race.date,
      time: race.time || null,
      circuitType: meta.type,
      notes: meta.notes,
    };
  });

  return {
    cachedAt: Date.now(),
    season: parseInt(currentSeason, 10),
    driverCount: drivers.length,
    raceCount: races.length,
    drivers,
    races,
  };
}

// ── Azure Function handler ────────────────────────────────────────────────────
module.exports = async function (context, req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };

  const respond = (status, body) => {
    context.res = { status, headers, body: JSON.stringify(body) };
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    return respond(204, {});
  }

  try {
    // Serve from cache if fresh
    if (_cache && (Date.now() - _cachedAt) < TTL) {
      context.log("[f1-data] cache hit, age=" + Math.round((Date.now() - _cachedAt) / 60000) + "min");
      return respond(200, _cache);
    }

    context.log("[f1-data] fetching from Jolpica API, season=" + SEASON);

    // Fetch standings, last 30 results (for form), and calendar in parallel
    // limit=30 gives us results from the last 1-2 races with one page
    const [standingsData, resultsData, racesData] = await Promise.all([
      jolpicaFetch(`${SEASON}/driverstandings.json`),
      jolpicaFetch(`${SEASON}/results.json?limit=200`), // full season results for form
      jolpicaFetch(`${SEASON}/races.json`),
    ]);

    context.log(
      "[f1-data] standings=" + (standingsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.length || 0) +
      " races=" + (resultsData?.MRData?.RaceTable?.Races?.length || 0) +
      " calendar=" + (racesData?.MRData?.RaceTable?.Races?.length || 0)
    );

    const payload = buildPayload(standingsData, resultsData, racesData);

    _cache = payload;
    _cachedAt = Date.now();

    return respond(200, payload);

  } catch (err) {
    context.log.error("[f1-data] ERROR: " + err.message);

    // Return stale cache if available rather than hard-failing
    if (_cache) {
      context.log("[f1-data] returning stale cache after error");
      return respond(200, { ..._cache, stale: true });
    }

    return respond(500, { error: err.message });
  }
};
