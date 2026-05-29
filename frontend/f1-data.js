// PouleProff — F1 data layer
// Fetches live data from /api/f1-data (Azure Function → Jolpica F1 API)
// Falls back to minimal hardcoded data if the API is unreachable.

// ── Session cache ─────────────────────────────────────────────────────────────
let _f1Cache = null;

async function loadF1Data() {
  if (_f1Cache) return _f1Cache;
  try {
    const res = await fetch("/api/f1-data");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _f1Cache = await res.json();
    console.log(`[PouleProff F1] Live data loaded. Season ${_f1Cache.season}, ${_f1Cache.driverCount} drivers, ${_f1Cache.raceCount} races.`);
    return _f1Cache;
  } catch (err) {
    console.warn("[PouleProff F1] API unavailable, using fallback.", err.message);
    _f1Cache = { ..._F1_FALLBACK, isFallback: true };
    return _f1Cache;
  }
}

// ── Team colors (used if API returns unknown constructorId) ───────────────────
const TEAM_COLORS = {
  red_bull:     "#3671C6",
  ferrari:      "#E8002D",
  mclaren:      "#FF8000",
  mercedes:     "#27F4D2",
  aston_martin: "#358C75",
  alpine:       "#FF87BC",
  williams:     "#64C4FF",
  rb:           "#6692FF",
  kick_sauber:  "#52E252",
  haas:         "#B6BABD",
};

// ── F1 Prediction engine ──────────────────────────────────────────────────────
function predictF1(raceId, f1Data) {
  const race = f1Data.races.find(r => r.id === raceId);
  if (!race) return null;

  const maxPts = Math.max(...f1Data.drivers.map(d => d.points), 1);

  const scored = f1Data.drivers.map(d => {
    // Form score: average finish position over last 5 races (lower = better → invert)
    const positions = (d.form || []).filter(p => !isNaN(p));
    const avgPos = positions.length
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : 10;
    const formScore = 1 / avgPos; // invert so P1 = 1, P10 = 0.1

    // Championship score
    const pointsScore = d.points / maxPts;

    // Circuit affinity: check if team/driver has a known strength at this circuit
    // We encode this per-circuit in the race metadata as circuitType
    // Drivers leading the championship tend to be strong everywhere; adjust by type
    const typeBonus = circuitTypeBonus(d.constructorId, race.circuitType);

    const totalScore = formScore * 0.50 + pointsScore * 0.35 + typeBonus * 0.15;
    return { ...d, totalScore, avgPos, formScore, pointsScore, typeBonus };
  });

  const ranked = [...scored].sort((a, b) => b.totalScore - a.totalScore);

  // Win probabilities via softmax
  const expScores = ranked.map(d => Math.exp(d.totalScore * 6));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const withProbs = ranked.map((d, i) => ({ ...d, winProb: expScores[i] / sumExp }));

  const top3 = withProbs.slice(0, 3);
  const top5 = withProbs.slice(0, 5);

  const gap = withProbs[0].winProb - withProbs[1].winProb;
  const confidence = Math.min(1, gap / 0.20);

  const winner = withProbs[0];
  const p2 = withProbs[1];

  const reasons = [];
  if (winner.pointsScore > 0.75)
    reasons.push(`${winner.name} leidt het kampioenschap — mentale en technische voorsprong.`);
  const formPos = winner.form?.length
    ? Math.round(winner.form.reduce((a, b) => a + b, 0) / winner.form.length * 10) / 10
    : "–";
  reasons.push(`${winner.name} gemiddelde startpositie afgelopen races: P${formPos}.`);
  if (p2.formScore > winner.formScore * 0.9)
    reasons.push(`${p2.name} presteert ook uitstekend — race kan beide kanten op.`);
  if (race.notes)
    reasons.push(`Circuit: ${race.notes}`);

  return { race, top3, top5, withProbs, confidence, reasons };
}

// ── Circuit type bonus per constructor ────────────────────────────────────────
// Rough heuristic: some chassis types suit certain track layouts better.
function circuitTypeBonus(constructorId, type) {
  const bonuses = {
    red_bull:     { technical: 0.10, classic: 0.12, fast: 0.08, street: 0.06, mixed: 0.09 },
    ferrari:      { technical: 0.08, classic: 0.09, fast: 0.10, street: 0.12, mixed: 0.09 },
    mclaren:      { technical: 0.07, classic: 0.08, fast: 0.12, street: 0.10, mixed: 0.10 },
    mercedes:     { technical: 0.09, classic: 0.10, fast: 0.09, street: 0.07, mixed: 0.09 },
    aston_martin: { technical: 0.06, classic: 0.07, fast: 0.06, street: 0.08, mixed: 0.07 },
    williams:     { technical: 0.05, classic: 0.05, fast: 0.07, street: 0.06, mixed: 0.06 },
    alpine:       { technical: 0.05, classic: 0.06, fast: 0.05, street: 0.06, mixed: 0.05 },
    rb:           { technical: 0.04, classic: 0.05, fast: 0.05, street: 0.05, mixed: 0.05 },
    kick_sauber:  { technical: 0.03, classic: 0.04, fast: 0.04, street: 0.04, mixed: 0.04 },
    haas:         { technical: 0.03, classic: 0.03, fast: 0.04, street: 0.03, mixed: 0.03 },
  };
  return bonuses[constructorId]?.[type] ?? 0.05;
}

// ── Populate F1 race selector ─────────────────────────────────────────────────
function populateF1Selector(f1Data) {
  const sel = document.getElementById("f1-race");
  sel.innerHTML = "";
  const today = new Date();
  f1Data.races.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.id;
    const raceDate = new Date(r.date);
    const isPast = raceDate < today;
    opt.textContent = `${r.flag || "🏁"} ${r.name}${isPast ? " (afgelopen)" : ""}`;
    sel.appendChild(opt);
  });
  // Default to next upcoming race
  const upcoming = f1Data.races.find(r => new Date(r.date) >= today);
  if (upcoming) sel.value = upcoming.id;
  else if (f1Data.races.length) sel.value = f1Data.races[f1Data.races.length - 1].id;
}

// ── Minimal fallback (only used if API AND function are both down) ─────────────
const _F1_FALLBACK = {
  season: 2025,
  driverCount: 5,
  raceCount: 1,
  drivers: [
    { id: "max_verstappen", name: "Max Verstappen",  team: "Red Bull Racing", constructorId: "red_bull",  teamColor: "#3671C6", points: 200, wins: 5, position: 1, form: [1,1,2,1,3] },
    { id: "leclerc",        name: "Charles Leclerc", team: "Ferrari",         constructorId: "ferrari",   teamColor: "#E8002D", points: 180, wins: 3, position: 2, form: [2,3,1,4,2] },
    { id: "norris",         name: "Lando Norris",    team: "McLaren",         constructorId: "mclaren",   teamColor: "#FF8000", points: 160, wins: 2, position: 3, form: [3,2,4,2,1] },
    { id: "russell",        name: "George Russell",  team: "Mercedes",        constructorId: "mercedes",  teamColor: "#27F4D2", points: 120, wins: 1, position: 4, form: [5,5,5,5,5] },
    { id: "sainz",          name: "Carlos Sainz",    team: "Williams",        constructorId: "williams",  teamColor: "#64C4FF", points: 100, wins: 1, position: 5, form: [4,4,3,3,4] },
  ],
  races: [
    { id: "2025_1", round: 1, name: "Bahrein GP", circuit: "bahrain", flag: "🇧🇭",
      date: "2025-03-02", circuitType: "technical", notes: "Geen live data beschikbaar — fallback." },
  ],
};
