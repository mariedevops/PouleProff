// PouleProff — prediction engine + UI (v2: multi-league)

// ── Form helpers ──────────────────────────────────────────────────────────────
function formScore(form) {
  const points = form.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return points / 15;
}
function formLabel(form) {
  const pts = form.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return `${pts} pts uit laatste 5`;
}

// ── Eredivisie prediction engine ──────────────────────────────────────────────
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
let _data    = null;
let _teams   = null;
let _teamMap = null;
let _f1Data  = null;
let _activeLeague = "eredivisie";

// ── Cookie banner ─────────────────────────────────────────────────────────────
function initCookieBanner() {
  const CONSENT_KEY = "pp_cookie_consent";
  const existing = localStorage.getItem(CONSENT_KEY);
  if (existing) return; // already answered

  const banner = document.getElementById("cookie-banner");
  banner.hidden = false;

  document.getElementById("cookie-accept").addEventListener("click", () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    banner.hidden = true;
    // Fire Plausible custom event if desired
    if (window.plausible) window.plausible("Cookie Accepted");
  });

  document.getElementById("cookie-reject").addEventListener("click", () => {
    localStorage.setItem(CONSENT_KEY, "rejected");
    banner.hidden = true;
    // Optionally disable Plausible tracking by setting window._plausible_blocked = true
    // Plausible is cookieless so this is mostly cosmetic, but respects intent.
    window._plausible_blocked = true;
  });
}

// ── League switcher ───────────────────────────────────────────────────────────
function initLeagueTabs() {
  document.querySelectorAll(".league-tab:not(.disabled)").forEach(tab => {
    tab.addEventListener("click", () => {
      const league = tab.dataset.league;
      if (league === _activeLeague) return;
      _activeLeague = league;

      // Update tab states
      document.querySelectorAll(".league-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.league === league);
        t.setAttribute("aria-selected", t.dataset.league === league ? "true" : "false");
      });

      // Show/hide panels
      document.getElementById("predictor").classList.toggle("hidden", league !== "eredivisie");
      document.getElementById("f1-predictor").classList.toggle("hidden", league !== "f1");

      // Update brand tag
      const tagMap = { eredivisie: "Eredivisie · Scorito helper", f1: "Formule 1 · Race voorspeller" };
      document.getElementById("brand-tag").textContent = tagMap[league] || "Scorito helper";

      // Track with Plausible
      if (window.plausible) window.plausible("League Switch", { props: { league } });
    });
  });
}

// ── Eredivisie init ───────────────────────────────────────────────────────────
async function initEredivisie() {
  document.getElementById("predict-btn").disabled = true;
  document.getElementById("predict-btn").textContent = "Data laden…";

  _data = await loadEredivisieData();
  _teamMap = getTeams(_data);
  _teams = Object.values(_teamMap).sort((a, b) => a.name.localeCompare(b.name, "nl"));

  const homeSel = document.getElementById("home-team");
  const awaySel = document.getElementById("away-team");
  _teams.forEach(t => {
    const o1 = document.createElement("option"); o1.value = t.id; o1.textContent = t.name; homeSel.appendChild(o1);
    const o2 = document.createElement("option"); o2.value = t.id; o2.textContent = t.name; awaySel.appendChild(o2);
  });

  const ajaxId = _teams.find(t => t.name.toLowerCase().includes("ajax"))?.id || _teams[0]?.id;
  const psvId  = _teams.find(t => t.name.toLowerCase().includes("psv"))?.id  || _teams[1]?.id;
  homeSel.value = ajaxId;
  awaySel.value = psvId;

  document.getElementById("predict-btn").disabled = false;
  document.getElementById("predict-btn").textContent = "Voorspel";
  document.getElementById("predict-btn").addEventListener("click", runPrediction);
  document.getElementById("copy-btn").addEventListener("click", copyForScorito);

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

  const upcoming = getUpcoming(_data);
  if (upcoming.length) renderUpcoming(upcoming);
  runPrediction();
}

// ── F1 init ───────────────────────────────────────────────────────────────────
async function initF1() {
  const btn = document.getElementById("f1-predict-btn");
  btn.disabled = true;
  btn.textContent = "Data laden…";

  _f1Data = await loadF1Data();
  populateF1Selector(_f1Data);

  btn.disabled = false;
  btn.textContent = "Voorspel";

  if (_f1Data.isFallback) {
    const warn = document.getElementById("f1-predictor").querySelector(".f1-selector");
    const note = document.createElement("p");
    note.style.cssText = "font-size:13px;color:#92400e;background:#fef3c7;padding:6px 10px;border-radius:6px;margin-top:8px;";
    note.textContent = "⚠️ Live F1-data tijdelijk niet beschikbaar — fallback wordt gebruikt.";
    warn.after(note);
  }

  document.getElementById("f1-predict-btn").addEventListener("click", runF1Prediction);
  document.getElementById("f1-copy-btn").addEventListener("click", copyF1ForScorito);
}

// ── Run Eredivisie prediction ─────────────────────────────────────────────────
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
  if (window.plausible) window.plausible("Eredivisie Prediction");
}

// ── Run F1 prediction ─────────────────────────────────────────────────────────
function runF1Prediction() {
  const raceId = document.getElementById("f1-race").value;
  const r = predictF1(raceId, _f1Data);
  if (!_f1Data) return;
  if (!r) return;

  // Podium
  const podiumDrivers = [r.top3[1], r.top3[0], r.top3[2]]; // P2, P1, P3 visual order
  ["p2","p1","p3"].forEach((pos, i) => {
    const d = podiumDrivers[i];
    document.getElementById(`f1-${pos}-name`).textContent = d.name;
    document.getElementById(`f1-${pos}-team`).textContent = d.team;
    document.getElementById(`f1-${pos}-block`).style.borderColor = d.teamColor;
  });

  // Win probability bars (top 5)
  document.getElementById("f1-win-probs").innerHTML = r.top5.map(d =>
    `<div class="stat-row">
      <span style="color:${d.teamColor};font-weight:600">${d.name}</span>
      <div class="prob-bar" style="flex:1;margin:0 8px"><div class="prob-fill home" style="width:${pct(d.winProb)};background:${d.teamColor}"></div></div>
      <span>${pct(d.winProb)}</span>
    </div>`
  ).join("");

  // Circuit notes
  document.getElementById("f1-circuit-notes").innerHTML =
    `<p style="font-size:14px;color:var(--muted);margin:0">${r.race.notes}</p>
     <p style="font-size:13px;margin:8px 0 0"><strong>Type:</strong> ${r.race.circuitType}</p>`;

  // Driver strength scores
  document.getElementById("f1-driver-strength").innerHTML = r.top5.map(d =>
    `<div class="stat-row">
      <span>${d.name}</span>
      <span style="color:${d.teamColor};font-weight:600">${(d.totalScore * 100).toFixed(0)}</span>
    </div>`
  ).join("");

  // Confidence
  document.getElementById("f1-conf-fill").style.width = `${Math.round(r.confidence * 100)}%`;
  document.getElementById("f1-conf-text").textContent =
    r.confidence > 0.5 ? `Hoog — ${r.top3[0].name} is duidelijke favoriet` :
    r.confidence > 0.2 ? "Gemiddeld — spannende race verwacht" :
                         "Laag — open race, verrassingen mogelijk";

  // Reasons
  document.getElementById("f1-reasons").innerHTML = r.reasons.map(t => `<li>${t}</li>`).join("");

  document.getElementById("f1-result").classList.remove("hidden");
  if (window.plausible) window.plausible("F1 Prediction", { props: { race: r.race.name } });
}

// ── Copy helpers ──────────────────────────────────────────────────────────────
function copyForScorito() {
  const homeId = Number(document.getElementById("home-team").value);
  const awayId = Number(document.getElementById("away-team").value);
  const h = _teamMap[homeId];
  const a = _teamMap[awayId];
  const h2h = getH2HById(_data, homeId, awayId);
  const r = predict(h, a, h2h);
  const text = `${h.name} ${r.predHome}-${r.predAway} ${a.name}`;
  navigator.clipboard.writeText(text).then(() => flashBtn("copy-btn", "Gekopieerd ✓", "Kopieer voor Scorito"));
}

function copyF1ForScorito() {
  const raceId = document.getElementById("f1-race").value;
  const r = predictF1(raceId, _f1Data);
  if (!_f1Data) return;
  if (!r) return;
  const text = `F1 ${r.race.name}: 1. ${r.top3[0].name} 2. ${r.top3[1].name} 3. ${r.top3[2].name}`;
  navigator.clipboard.writeText(text).then(() => flashBtn("f1-copy-btn", "Gekopieerd ✓", "Kopieer voor Scorito poule"));
}

function flashBtn(id, tempText, origText) {
  const btn = document.getElementById(id);
  btn.textContent = tempText;
  setTimeout(() => { btn.textContent = origText; }, 1500);
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

// ── Main init ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  initCookieBanner();
  initLeagueTabs();
  await initEredivisie();
  initF1();
});
