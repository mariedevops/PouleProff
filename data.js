// Hardcoded Eredivisie 2025-26 stats.
// form: last 5 results, most recent last. W/D/L
// gf/ga: average goals for/against per match this season
// home/away records help calibrate the home advantage adjustment
const TEAMS = {
  ajax:        { name: "Ajax",              form: ["W","W","D","W","W"], gf: 2.5, ga: 0.9, homeWinRate: 0.78, awayWinRate: 0.55 },
  psv:         { name: "PSV",               form: ["W","W","W","D","W"], gf: 2.8, ga: 0.8, homeWinRate: 0.83, awayWinRate: 0.62 },
  feyenoord:   { name: "Feyenoord",         form: ["W","L","W","W","D"], gf: 2.2, ga: 1.1, homeWinRate: 0.72, awayWinRate: 0.47 },
  az:          { name: "AZ Alkmaar",        form: ["W","D","W","L","W"], gf: 2.0, ga: 1.2, homeWinRate: 0.65, awayWinRate: 0.42 },
  twente:      { name: "FC Twente",         form: ["D","W","D","W","L"], gf: 1.7, ga: 1.3, homeWinRate: 0.58, awayWinRate: 0.35 },
  utrecht:     { name: "FC Utrecht",        form: ["W","L","D","W","W"], gf: 1.6, ga: 1.2, homeWinRate: 0.61, awayWinRate: 0.31 },
  sparta:      { name: "Sparta Rotterdam",  form: ["L","D","W","D","L"], gf: 1.3, ga: 1.5, homeWinRate: 0.45, awayWinRate: 0.22 },
  nec:         { name: "NEC Nijmegen",      form: ["L","W","L","D","W"], gf: 1.4, ga: 1.4, homeWinRate: 0.50, awayWinRate: 0.27 },
  goahead:     { name: "Go Ahead Eagles",   form: ["W","D","L","W","D"], gf: 1.5, ga: 1.4, homeWinRate: 0.55, awayWinRate: 0.25 },
  heerenveen:  { name: "sc Heerenveen",     form: ["D","L","D","W","L"], gf: 1.2, ga: 1.6, homeWinRate: 0.42, awayWinRate: 0.20 },
  pec:         { name: "PEC Zwolle",        form: ["L","L","D","L","W"], gf: 1.1, ga: 1.7, homeWinRate: 0.38, awayWinRate: 0.18 },
  fortuna:     { name: "Fortuna Sittard",   form: ["L","D","L","D","L"], gf: 1.0, ga: 1.8, homeWinRate: 0.35, awayWinRate: 0.16 },
  nac:         { name: "NAC Breda",         form: ["D","L","W","L","D"], gf: 1.2, ga: 1.6, homeWinRate: 0.40, awayWinRate: 0.18 },
  willem2:     { name: "Willem II",         form: ["L","D","L","W","L"], gf: 1.1, ga: 1.7, homeWinRate: 0.36, awayWinRate: 0.17 },
  almere:      { name: "Almere City",       form: ["L","L","D","L","L"], gf: 0.9, ga: 2.0, homeWinRate: 0.28, awayWinRate: 0.12 },
  heracles:    { name: "Heracles Almelo",   form: ["D","L","W","L","L"], gf: 1.2, ga: 1.7, homeWinRate: 0.40, awayWinRate: 0.18 },
  groningen:   { name: "FC Groningen",      form: ["W","L","D","W","L"], gf: 1.3, ga: 1.5, homeWinRate: 0.48, awayWinRate: 0.24 },
  rkc:         { name: "RKC Waalwijk",      form: ["L","D","L","L","D"], gf: 1.0, ga: 1.8, homeWinRate: 0.33, awayWinRate: 0.15 },
};

// Head-to-head: last 5 meetings. result is from perspective of team listed first (home team in original fixture).
// Each entry: { date, home, away, hs, as }
const H2H = {
  "ajax|psv": [
    { date: "2025-09-21", home: "ajax", away: "psv", hs: 2, as: 2 },
    { date: "2025-02-16", home: "psv",  away: "ajax", hs: 3, as: 0 },
    { date: "2024-10-20", home: "ajax", away: "psv", hs: 1, as: 2 },
    { date: "2024-05-19", home: "psv",  away: "ajax", hs: 4, as: 2 },
    { date: "2023-12-03", home: "ajax", away: "psv", hs: 2, as: 5 },
  ],
  "psv|ajax": [
    { date: "2025-09-21", home: "ajax", away: "psv", hs: 2, as: 2 },
    { date: "2025-02-16", home: "psv",  away: "ajax", hs: 3, as: 0 },
    { date: "2024-10-20", home: "ajax", away: "psv", hs: 1, as: 2 },
    { date: "2024-05-19", home: "psv",  away: "ajax", hs: 4, as: 2 },
    { date: "2023-12-03", home: "ajax", away: "psv", hs: 2, as: 5 },
  ],
  "ajax|feyenoord": [
    { date: "2025-10-26", home: "feyenoord", away: "ajax", hs: 2, as: 1 },
    { date: "2025-04-07", home: "ajax",      away: "feyenoord", hs: 1, as: 1 },
    { date: "2024-12-22", home: "feyenoord", away: "ajax", hs: 0, as: 2 },
    { date: "2024-09-15", home: "ajax",      away: "feyenoord", hs: 2, as: 0 },
    { date: "2024-04-21", home: "feyenoord", away: "ajax", hs: 6, as: 0 },
  ],
  "feyenoord|psv": [
    { date: "2025-11-02", home: "feyenoord", away: "psv", hs: 1, as: 3 },
    { date: "2025-03-09", home: "psv",       away: "feyenoord", hs: 2, as: 1 },
    { date: "2024-12-15", home: "feyenoord", away: "psv", hs: 0, as: 2 },
    { date: "2024-08-04", home: "psv",       away: "feyenoord", hs: 4, as: 0 },
    { date: "2024-03-24", home: "feyenoord", away: "psv", hs: 2, as: 2 },
  ],
};

// Symmetric H2H lookup
function getH2H(a, b) {
  return H2H[`${a}|${b}`] || H2H[`${b}|${a}`] || null;
}
