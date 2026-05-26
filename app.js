// Convert W/D/L list into a 0-1 form score (points / 15)
function formScore(form) {
  const points = form.reduce((sum, r) => sum + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return points / 15;
}

function formLabel(form) {
  const pts = form.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return `${pts} pts uit laatste 5`;
}

// Core prediction: returns predicted goals + outcome probabilities + reasoning.
function predict(homeKey, awayKey) {
  const h = TEAMS[homeKey];
  const a = TEAMS[awayKey];

  const hForm = formScore(h.form);
  const aForm = formScore(a.form);

  // Strength composite: 40% form, 30% attack (gf), 20% inverse defense, 10% home bonus
  const homeAttack = h.gf / 3;     // normalize against ~3.0 goals/match
  const awayAttack = a.gf / 3;
  const homeDefense = 1 - Math.min(h.ga / 3, 1);
  const awayDefense = 1 - Math.min(a.ga / 3, 1);

  const homeStrength = hForm * 0.40 + homeAttack * 0.30 + homeDefense * 0.20 + 0.10;
  const awayStrength = aForm * 0.40 + awayAttack * 0.30 + awayDefense * 0.20;

  // Expected goals: blend own attack with opponent's defensive weakness, plus home/away rate calibration
  let xgHome = (h.gf * 0.55) + ((1 - awayDefense) * 1.8 * 0.45);
  let xgAway = (a.gf * 0.55) + ((1 - homeDefense) * 1.8 * 0.45);

  // Home advantage: pull home xg up, away xg down
  xgHome *= 1.10;
  xgAway *= 0.92;

  // H2H adjustment: if recent meetings skew clearly one way, nudge xg ±0.2
  const h2h = getH2H(homeKey, awayKey);
  let h2hNudge = { home: 0, away: 0, summary: null };
  if (h2h) {
    let hWins = 0, aWins = 0;
    h2h.forEach(m => {
      const homeTeamWon = m.hs > m.as;
      const awayTeamWon = m.as > m.hs;
      const homeKeyIsHomeInMatch = m.home === homeKey;
      if (homeTeamWon) {
        if (homeKeyIsHomeInMatch) hWins++; else aWins++;
      } else if (awayTeamWon) {
        if (homeKeyIsHomeInMatch) aWins++; else hWins++;
      }
    });
    if (hWins - aWins >= 2) {
      xgHome += 0.2;
      h2hNudge.home = 0.2;
      h2hNudge.summary = `${h.name} won ${hWins} van laatste ${h2h.length} onderlinge duels`;
    } else if (aWins - hWins >= 2) {
      xgAway += 0.2;
      h2hNudge.away = 0.2;
      h2hNudge.summary = `${a.name} won ${aWins} van laatste ${h2h.length} onderlinge duels`;
    } else {
      h2hNudge.summary = `Onderlinge duels zijn dicht (${hWins}-${aWins})`;
    }
  }

  const predHome = Math.max(0, Math.round(xgHome));
  const predAway = Math.max(0, Math.round(xgAway));

  // Outcome probabilities from strength differential
  const diff = (homeStrength + 0.10) - awayStrength;
  // logistic-ish mapping
  const homeWinP = 1 / (1 + Math.exp(-diff * 3.5));
  const awayWinP = 1 / (1 + Math.exp(diff * 3.5));
  // Draw probability inversely scales with how lopsided it is
  const drawRaw = 0.30 - Math.abs(diff) * 0.4;
  const drawP = Math.max(0.08, drawRaw);

  const total = homeWinP + awayWinP + drawP;
  const probs = {
    home: homeWinP / total,
    draw: drawP / total,
    away: awayWinP / total,
  };

  // Confidence = how lopsided the top probability is vs. uniform 1/3
  const top = Math.max(probs.home, probs.draw, probs.away);
  const confidence = Math.min(1, (top - 0.33) / 0.40);

  // Reasoning
  const reasons = [];
  if (hForm > aForm + 0.15) {
    reasons.push(`${h.name} is in betere vorm (${formLabel(h.form)} vs. ${formLabel(a.form)}).`);
  } else if (aForm > hForm + 0.15) {
    reasons.push(`${a.name} is in betere vorm (${formLabel(a.form)} vs. ${formLabel(h.form)}).`);
  } else {
    reasons.push(`Beide teams hebben vergelijkbare recente vorm.`);
  }
  if (h.gf > a.gf + 0.4) reasons.push(`${h.name} scoort gemiddeld meer (${h.gf.toFixed(1)} per wedstrijd).`);
  if (a.gf > h.gf + 0.4) reasons.push(`${a.name} scoort gemiddeld meer (${a.gf.toFixed(1)} per wedstrijd).`);
  if (a.ga > h.ga + 0.3) reasons.push(`${a.name} laat meer doelpunten toe (${a.ga.toFixed(1)} per wedstrijd) — kansen voor ${h.name}.`);
  if (h.ga > a.ga + 0.3) reasons.push(`${h.name} laat meer doelpunten toe (${h.ga.toFixed(1)} per wedstrijd) — kansen voor ${a.name}.`);
  reasons.push(`Thuisvoordeel: +10% kracht-bonus voor ${h.name}.`);
  if (h2hNudge.summary) reasons.push(h2hNudge.summary + ".");

  return {
    predHome, predAway,
    xgHome, xgAway,
    probs,
    confidence,
    reasons,
    h2h,
  };
}

// --- UI rendering ---

function init() {
  const homeSel = document.getElementById("home-team");
  const awaySel = document.getElementById("away-team");
  const keys = Object.keys(TEAMS);
  keys.forEach(k => {
    const o1 = document.createElement("option");
    o1.value = k; o1.textContent = TEAMS[k].name;
    homeSel.appendChild(o1);
    const o2 = document.createElement("option");
    o2.value = k; o2.textContent = TEAMS[k].name;
    awaySel.appendChild(o2);
  });
  homeSel.value = "ajax";
  awaySel.value = "psv";

  document.getElementById("predict-btn").addEventListener("click", runPrediction);
  document.getElementById("copy-btn").addEventListener("click", copyForScorito);

  runPrediction();
}

function renderPills(form) {
  return form.map(r => `<span class="pill ${r}">${r}</span>`).join("");
}

function runPrediction() {
  const homeKey = document.getElementById("home-team").value;
  const awayKey = document.getElementById("away-team").value;

  if (homeKey === awayKey) {
    alert("Kies twee verschillende teams.");
    return;
  }

  const h = TEAMS[homeKey];
  const a = TEAMS[awayKey];
  const r = predict(homeKey, awayKey);

  // Headline
  document.getElementById("r-home-name").textContent = h.name;
  document.getElementById("r-away-name").textContent = a.name;
  document.getElementById("r-home-form").textContent = formLabel(h.form);
  document.getElementById("r-away-form").textContent = formLabel(a.form);
  document.getElementById("r-score").textContent = `${r.predHome} – ${r.predAway}`;

  // Probabilities
  const pct = (n) => `${Math.round(n * 100)}%`;
  document.getElementById("r-prob-home").textContent = pct(r.probs.home);
  document.getElementById("r-prob-draw").textContent = pct(r.probs.draw);
  document.getElementById("r-prob-away").textContent = pct(r.probs.away);
  document.getElementById("r-prob-home-fill").style.width = pct(r.probs.home);
  document.getElementById("r-prob-draw-fill").style.width = pct(r.probs.draw);
  document.getElementById("r-prob-away-fill").style.width = pct(r.probs.away);

  // Reasons
  const ul = document.getElementById("r-reasons");
  ul.innerHTML = r.reasons.map(t => `<li>${t}</li>`).join("");

  // Form pills
  document.getElementById("r-home-name-2").textContent = h.name;
  document.getElementById("r-away-name-2").textContent = a.name;
  document.getElementById("r-home-pills").innerHTML = renderPills(h.form);
  document.getElementById("r-away-pills").innerHTML = renderPills(a.form);

  // H2H
  const h2hEl = document.getElementById("r-h2h");
  if (r.h2h && r.h2h.length) {
    h2hEl.innerHTML = r.h2h.map(m => {
      const ht = TEAMS[m.home].name;
      const at = TEAMS[m.away].name;
      return `<div class="h2h-row"><span>${ht} – ${at}</span><span class="h2h-result">${m.hs}–${m.as}</span></div>`;
    }).join("");
  } else {
    h2hEl.innerHTML = `<div class="h2h-row" style="color:var(--muted)">Geen recente onderlinge duels in dataset.</div>`;
  }

  // Goals avg
  document.getElementById("r-home-name-3").textContent = h.name;
  document.getElementById("r-away-name-3").textContent = a.name;
  document.getElementById("r-home-goals").textContent = `${h.gf.toFixed(1)} voor / ${h.ga.toFixed(1)} tegen`;
  document.getElementById("r-away-goals").textContent = `${a.gf.toFixed(1)} voor / ${a.ga.toFixed(1)} tegen`;
  const totalXg = r.xgHome + r.xgAway;
  document.getElementById("r-ou").textContent =
    totalXg > 2.5 ? `Over (${totalXg.toFixed(2)} verwacht)` : `Under (${totalXg.toFixed(2)} verwacht)`;

  // Confidence
  document.getElementById("r-conf-fill").style.width = `${Math.round(r.confidence * 100)}%`;
  const confLabel =
    r.confidence > 0.66 ? "Hoog — duidelijke favoriet" :
    r.confidence > 0.33 ? "Gemiddeld — leunt één kant op" :
                          "Laag — toss-up, kies voorzichtig";
  document.getElementById("r-conf-text").textContent = confLabel;

  document.getElementById("result").classList.remove("hidden");
}

function copyForScorito() {
  const homeKey = document.getElementById("home-team").value;
  const awayKey = document.getElementById("away-team").value;
  const r = predict(homeKey, awayKey);
  const text = `${TEAMS[homeKey].name} ${r.predHome}-${r.predAway} ${TEAMS[awayKey].name}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-btn");
    const original = btn.textContent;
    btn.textContent = "Gekopieerd ✓";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

document.addEventListener("DOMContentLoaded", init);
