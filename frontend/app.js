// PouleProff — prediction engine + UI
// Works with data loaded via loadEredivisieData() from data.js

// ── Form helpers ──────────────────────────────────────────────────────────────
function formScore(form) {
  const points = form.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return points / 15;
}
function formLabel(form) {
  const pts = form.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return `${pts} pts uit laatste 5`;
}

// ── Prediction engine ─────────────────────────────────────────────────────────
function predict(h, a, h2hMatches) {
  const hForm = formScore(h.form);
  const aForm = formScore(a.form);

  const homeAttack  = h.gf / 3;
  const awayAttack  = a.gf / 3;
  const homeDefense = 1 - Math.min(h.ga / 3, 1);
  const awayDefense = 1 - Math.min(a.ga / 3, 1);

  const homeStrength = hForm * 0.40 + homeAttack * 0.30 + homeDefense * 0.20 + 0.10;
  const awayStrength = aForm * 0.40 + awayAttack * 0.30 + awayDefense * 0.20;

  let xgHome = (h.gf * 0.55) + ((1 - awayDefense) * 1.8 * 0.45);
  let xgAway = (a.gf * 0.55) + ((1 - homeDefense) * 1.8 * 0.45);
  xgHome *= 1.10;
  xgAway *= 0.92;

  // H2H nudge
  let h2hNudge = { home: 0, away: 0, summary: null };
  if (h2hMatches && h2hMatches.length) {
    let hWins = 0, aWins = 0;
    h2hMatches.forEach(m => {
      const homeWon = m.hs > m.as;
      const awayWon = m.as > m.hs;
      const hIsHome = m.homeId === h.id;
      if (homeWon) { if (hIsHome) hWins++; else aWins++; }
      else if (awayWon) { if (hIsHome) aWins++; else hWins++; }
    });
    if (hWins - aWins >= 2) {
      xgHome += 0.2;
      h2hNudge.summary = `${h.name} won ${hWins} van laatste ${h2hMatches.length} onderlinge duels`;
    } else if (aWins - hWins >= 2) {
      xgAway += 0.2;
      h2hNudge.summary = `${a.name} won ${aWins} van laatste ${h2hMatches.length} onderlinge duels`;
    } else {
      h2hNudge.summary = `Onderlinge duels zijn dicht (${hWins}-${aWins})`;
    }
  }

  const predHome = Math.max(0, Math.round(xgHome));
  const predAway = Math.max(0, Math.round(xgAway));

  const diff     = (homeStrength + 0.10) - awayStrength;
  const homeWinP = 1 / (1 + Math.exp(-diff * 3.5));
  const awayWinP = 1 / (1 + Math.exp( diff * 3.5));
  const drawRaw  = 0.30 - Math.abs(diff) * 0.4;
  const drawP    = Math.max(0.08, drawRaw);
  const total    = homeWinP + awayWinP + drawP;
  const probs    = { home: homeWinP / total, draw: drawP / total, away: awayWinP / total };
  const top      = Math.max(probs.home, probs.draw, probs.away);
  const confidence = Math.min(1, (top - 0.33) / 0.40);

  const reasons = [];
  if (hForm > aForm + 0.15)      reasons.push(`${h.name} is in betere vorm (${formLabel(h.form)} vs. ${formLabel(a.form)}).`);
  else if (aForm > hForm + 0.15) reasons.push(`${a.name} is in betere vorm (${formLabel(a.form)} vs. ${formLabel(h.form)}).`);
  else                            reasons.push(`Beide teams hebben vergelijkbare recente vorm.`);
  if (h.gf > a.gf + 0.4) reasons.push(`${h.name} scoort gemiddeld meer (${h.gf.toFixed(1)} per wedstrijd).`);
  if (a.gf > h.gf + 0.4) reasons.push(`${a.name} scoort gemiddeld meer (${a.gf.toFixed(1)} per wedstrijd).`);
  if (a.ga > h.ga + 0.3) reasons.push(`${a.name} laat meer doelpunten toe (${a.ga.toFixed(1)}/wedstrijd) — kansen voor ${h.name}.`);
  if (h.ga > a.ga + 0.3) reasons.push(`${h.name} laat meer doelpunten toe (${h.ga.toFixed(1)}/wedstrijd) — kansen voor ${a.name}.`);
  reasons.push(`Thuisvoordeel: +10% kracht-bonus voor ${h.name}.`);
  if (h2hNudge.summary) reasons.push(h2hNudge.summary + ".");

  return { predHome, predAway, xgHome, xgAway, probs, confidence, reasons, h2h: h2hMatches };
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function renderPills(form) {
  return form.map(r => `<span class="pill ${r}">${r}</span>`).join("");
}
function pct(n) { return `${Math.round(n * 100)}%`; }

// ── State ─────────────────────────────────────────────────────────────────────
let _data   = null;   // loaded from API / fallback
let _teams  = null;   // flat array sorted by name
let _teamMap = null;  // id → team object

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Show loading state
  document.getElementById("predict-btn").disabled = true;
  document.getElementById("predict-btn").textContent = "Data laden…";

  _data = await loadEredivisieData();
  _teamMap = getTeams(_data);
  _teams = Object.values(_teamMap).sort((a, b) => a.name.localeCompare(b.name, "nl"));

  // Populate selects
  const homeSel = document.getElementById("home-team");
  const awaySel = document.getElementById("away-team");
  _teams.forEach(t => {
    const o1 = document.createElement("option"); o1.value = t.id; o1.textContent = t.name; homeSel.appendChild(o1);
    const o2 = document.createElement("option"); o2.value = t.id; o2.textContent = t.name; awaySel.appendChild(o2);
  });

  // Default to Ajax vs PSV (or first two teams)
  const ajaxId = _teams.find(t => t.name.toLowerCase().includes("ajax"))?.id || _teams[0]?.id;
  const psvId  = _teams.find(t => t.name.toLowerCase().includes("psv"))?.id  || _teams[1]?.id;
  homeSel.value = ajaxId;
  awaySel.value = psvId;

  document.getElementById("predict-btn").disabled = false;
  document.getElementById("predict-btn").textContent = "Voorspel";
  document.getElementById("predict-btn").addEventListener("click", runPrediction);
  document.getElementById("copy-btn").addEventListener("click", copyForScorito);

  // Show data freshness banner if using fallback
  if (_data.isFallback) {
    const banner = document.createElement("div");
    banner.style.cssText = "background:#fef3c7;color:#92400e;padding:8px 16px;text-align:center;font-size:0.85rem;";
    banner.textContent = "⚠️ Live data tijdelijk niet beschikbaar — fallback statistieken worden gebruikt.";
    document.querySelector(".site-header").after(banner);
  } else {
    const updated = document.createElement("div");
    updated.style.cssText = "background:#ecfdf5;color:#065f46;padding:6px 16px;text-align:center;font-size:0.8rem;";
    updated.textContent = `✓ Data bijgewerkt: ${new Date(_data.cachedAt).toLocaleString("nl-NL")}`;
    document.querySelector(".site-header").after(updated);
  }

  // Populate upcoming fixtures if present
  const upcoming = getUpcoming(_data);
  if (upcoming.length) renderUpcoming(upcoming);

  runPrediction();
}

// ── Run prediction ────────────────────────────────────────────────────────────
function runPrediction() {
  const homeId = Number(document.getElementById("home-team").value);
  const awayId = Number(document.getElementById("away-team").value);
  if (homeId === awayId) { alert("Kies twee verschillende teams."); return; }

  const h = _teamMap[homeId];
  const a = _teamMap[awayId];
  const h2hMatches = getH2HById(_data, homeId, awayId);
  const r = predict(h, a, h2hMatches);

  document.getElementById("r-home-name").textContent = h.name;
  document.getElementById("r-away-name").textContent = a.name;
  document.getElementById("r-home-form").textContent = formLabel(h.form);
  document.getElementById("r-away-form").textContent = formLabel(a.form);
  document.getElementById("r-score").textContent = `${r.predHome} – ${r.predAway}`;

  document.getElementById("r-prob-home").textContent = pct(r.probs.home);
  document.getElementById("r-prob-draw").textContent = pct(r.probs.draw);
  document.getElementById("r-prob-away").textContent = pct(r.probs.away);
  document.getElementById("r-prob-home-fill").style.width = pct(r.probs.home);
  document.getElementById("r-prob-draw-fill").style.width = pct(r.probs.draw);
  document.getElementById("r-prob-away-fill").style.width = pct(r.probs.away);

  document.getElementById("r-reasons").innerHTML = r.reasons.map(t => `<li>${t}</li>`).join("");

  document.getElementById("r-home-name-2").textContent = h.name;
  document.getElementById("r-away-name-2").textContent = a.name;
  document.getElementById("r-home-pills").innerHTML = renderPills(h.form);
  document.getElementById("r-away-pills").innerHTML = renderPills(a.form);

  const h2hEl = document.getElementById("r-h2h");
  if (r.h2h && r.h2h.length) {
    h2hEl.innerHTML = r.h2h.map(m =>
      `<div class="h2h-row"><span>${m.home} – ${m.away}</span><span class="h2h-result">${m.hs}–${m.as}</span></div>`
    ).join("");
  } else {
    h2hEl.innerHTML = `<div class="h2h-row" style="color:var(--muted)">Geen recente onderlinge duels in dataset.</div>`;
  }

  document.getElementById("r-home-name-3").textContent = h.name;
  document.getElementById("r-away-name-3").textContent = a.name;
  document.getElementById("r-home-goals").textContent = `${h.gf.toFixed(1)} voor / ${h.ga.toFixed(1)} tegen`;
  document.getElementById("r-away-goals").textContent = `${a.gf.toFixed(1)} voor / ${a.ga.toFixed(1)} tegen`;
  const totalXg = r.xgHome + r.xgAway;
  document.getElementById("r-ou").textContent =
    totalXg > 2.5 ? `Over (${totalXg.toFixed(2)} verwacht)` : `Under (${totalXg.toFixed(2)} verwacht)`;

  document.getElementById("r-conf-fill").style.width = `${Math.round(r.confidence * 100)}%`;
  document.getElementById("r-conf-text").textContent =
    r.confidence > 0.66 ? "Hoog — duidelijke favoriet" :
    r.confidence > 0.33 ? "Gemiddeld — leunt één kant op" :
                          "Laag — toss-up, kies voorzichtig";

  document.getElementById("result").classList.remove("hidden");
}

// ── Copy for Scorito ──────────────────────────────────────────────────────────
function copyForScorito() {
  const homeId = Number(document.getElementById("home-team").value);
  const awayId = Number(document.getElementById("away-team").value);
  const h = _teamMap[homeId];
  const a = _teamMap[awayId];
  const h2h = getH2HById(_data, homeId, awayId);
  const r = predict(h, a, h2h);
  const text = `${h.name} ${r.predHome}-${r.predAway} ${a.name}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-btn");
    const orig = btn.textContent;
    btn.textContent = "Gekopieerd ✓";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ── Upcoming fixtures panel ───────────────────────────────────────────────────
function renderUpcoming(upcoming) {
  const section = document.createElement("section");
  section.className = "card info";
  section.innerHTML = `
    <h2>Aankomende wedstrijden</h2>
    <div class="upcoming-list">
      ${upcoming.slice(0, 10).map(f => `
        <div class="upcoming-row" data-home="${f.homeId}" data-away="${f.awayId}">
          <span class="upcoming-date">${new Date(f.date).toLocaleDateString("nl-NL", { weekday:"short", day:"numeric", month:"short" })}</span>
          <span class="upcoming-match">${f.homeName} – ${f.awayName}</span>
          <button class="ghost small" onclick="selectFixture(${f.homeId}, ${f.awayId})">Voorspel</button>
        </div>
      `).join("")}
    </div>`;
  document.getElementById("predictor").after(section);
}

function selectFixture(homeId, awayId) {
  document.getElementById("home-team").value = homeId;
  document.getElementById("away-team").value = awayId;
  runPrediction();
  document.getElementById("predictor").scrollIntoView({ behavior: "smooth" });
}

document.addEventListener("DOMContentLoaded", init);
