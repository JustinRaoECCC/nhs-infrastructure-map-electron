// backend/algorithms.js
// - optimize_workplan (per-row re-normalization over matched parameters)
// - run_geographical_algorithm (uses data/algorithm_data/longterm_inspection_plan.json)
'use strict';

const fs = require('fs');
const path = require('path');
const lookupsRepo = require('./lookups_repo');

// ───────── helpers (Python parity) ─────────
const _norm = (x) => (x == null ? '' : String(x).trim());
const _canon = (s) => String(s ?? '')
  .trim()
  .replace(/[\u2013\u2014]/g, '-')  // en/em dash -> hyphen
  .toLowerCase();
const _tryFloat = (s) => {
  const v = Number(String(s ?? '').replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};

function _buildParamIndex(parameters = []) {
  // { pname: { max_weight, options:{label->weight}, condition } }
  const out = Object.create(null);
  for (const row of parameters || []) {
    const pname = _norm(row?.parameter);
    if (!pname) continue;
    const grp = (out[pname] ||= {
      max_weight: null,
      options: Object.create(null),
      condition: row?.condition,
    });
    if (row?.max_weight != null && row?.max_weight !== '') {
      const mw = _tryFloat(row.max_weight);
      if (mw != null) grp.max_weight = mw;
    }
    const optLabel = _norm(row?.option);
    if (optLabel !== '') {
      const w = row?.weight;
      const wnum = _tryFloat(w == null ? 0 : w);
      grp.options[optLabel] = wnum == null ? 0 : wnum;
    }
  }
  // default max_weight to largest option (or 1)
  for (const [pname, grp] of Object.entries(out)) {
    if (grp.max_weight == null) {
      const vals = Object.values(grp.options);
      grp.max_weight = Math.max(1, ...vals.map(v => (Number.isFinite(v) ? v : 0)));
    }
  }
  return out;
}

function _normalizeOverallWeights(rawMap, paramIndex) {
  // rawMap: {pname: 0..100}. Return fractions that sum to 1. If all 0, fall back to equal.
  const cleaned = Object.create(null);
  for (const pname of Object.keys(paramIndex)) {
    const v = (rawMap && Object.prototype.hasOwnProperty.call(rawMap, pname)) ? rawMap[pname] : 0;
    const f = _tryFloat(v);
    cleaned[pname] = Math.max(0, f == null ? 0 : f);
  }
  const total = Object.values(cleaned).reduce((s, v) => s + v, 0);
  if (total > 0) {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(cleaned)) out[k] = v / total;
    return out;
  }
 const n = Math.max(1, Object.keys(paramIndex).length);
  const eq = 1 / n;
  const out = Object.create(null);
  for (const k of Object.keys(paramIndex)) out[k] = eq;
  return out;
}

function _matchOptionWeight(paramCfg, value) {
  // Returns { matched:boolean, weight:number }
  const options = paramCfg?.options || {};
  const v = _canon(value);

  // Case/whitespace/dash-insensitive label match
  for (const [label, w] of Object.entries(options)) {
    if (_canon(label) === v) {
      const wn = _tryFloat(w);
      return { matched: true, weight: wn == null ? 0 : wn };
    }
  }
  // Numeric label match still supported (e.g., "1", 1)
  const vnum = _tryFloat(v);
  if (vnum != null) {
    for (const [label, w] of Object.entries(options)) {
      const onum = _tryFloat(label);
      if (onum != null && onum === vnum) {
        const wn = _tryFloat(w);
        return { matched: true, weight: wn == null ? 0 : wn };
      }
    }
  }
  return { matched: false, weight: 0 };
}

async function _loadParams() {
  if (typeof lookupsRepo.getAlgorithmParameters === 'function') {
    return await lookupsRepo.getAlgorithmParameters();
  }
  if (typeof lookupsRepo.loadAlgorithmParameters === 'function') {
    return await lookupsRepo.loadAlgorithmParameters();
  }
  return [];
}

// ───────── Optimization I ─────────
/**
 * @param {{workplan_rows?: Array<Object>, param_overall?: Object}} payload
 * @returns {{success: boolean, optimized_count: number, ranking: Array<Object>, notes: string}}
 */
async function optimizeWorkplan({ workplan_rows = [], param_overall = {}, parameters: paramsFromUI } = {}) {
  // Prefer params passed from the UI (same source as the Parameters tab). Fallback to repo load.
  const parameters = Array.isArray(paramsFromUI) ? paramsFromUI : await _loadParams();
  console.log('[optimizeWorkplan] workplan_rows=', workplan_rows.length, 'parameters=', (parameters || []).length);
  const pindex = _buildParamIndex(parameters || []);
  if (!Object.keys(pindex).length) {
    return {
      success: false,
      optimized_count: 0,
      ranking: [],
      notes: 'No algorithm parameters loaded. Ensure Parameters are saved and passed in.'
    };
  }
 const overallFrac = _normalizeOverallWeights(param_overall || {}, pindex);
  const paramNames = Object.keys(pindex);

  const results = [];
  for (let i = 0; i < workplan_rows.length; i++) {
    const row = workplan_rows[i] || {};
    const stationNo = row['Station Number'] ?? row['Station ID'] ?? '';
    const operation = row['Operation'] ?? row['Repair Name'] ?? '';
    const siteName  = row['Site Name'] ?? '';

    // which params matched?
    const perParam = Object.create(null);
    let presentSum = 0;
    for (const pname of paramNames) {
      const cfg = pindex[pname];
      const { matched, weight } = _matchOptionWeight(cfg, row[pname]);
      const maxw = Number(cfg?.max_weight || 1);
      const frac = Number(overallFrac[pname] || 0);
      perParam[pname] = {
        matched,
        option_weight: weight,
        max_weight: maxw,
        overall_fraction: frac,
        row_value: row[pname],
      };
      if (matched && maxw > 0 && frac > 0) presentSum += frac;
    }
    const renorm = presentSum > 0 ? (1 / presentSum) : 0;

    let score = 0;
    const breakdown = Object.create(null);
    for (const [pname, info] of Object.entries(perParam)) {
      const { matched, option_weight, max_weight, overall_fraction } = info;
      const effFrac = (matched && presentSum > 0) ? (overall_fraction * renorm) : 0;
      const contrib = (matched && max_weight > 0) ? ((option_weight / max_weight) * effFrac) : 0;
      score += contrib;
      breakdown[pname] = {
        row_value: info.row_value,
        option_weight,
        max_weight,
        overall_fraction,
        matched,
        effective_fraction: effFrac,
      };
    }

    results.push({
      row_index: i,
      station_number: stationNo,
      site_name: siteName,
      operation,
      score: Math.round(score * 10000) / 100, // percent, 2dp
      details: breakdown,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = String(a.station_number || '');
    const bn = String(b.station_number || '');
    if (an !== bn) return an.localeCompare(bn);
    const ao = String(a.operation || '');
    const bo = String(b.operation || '');
    return ao.localeCompare(bo);
  });
  results.forEach((r, idx) => (r.rank = idx + 1));

  return {
    success: true,
    optimized_count: results.length,
    ranking: results,
    notes:
      'Scores use per-row re-normalization over present parameters so blanks are neutral. ' +
      'Option weights are divided by each parameter max; overall weights are normalized to sum to 1.',
  };
}

// ───────── Optimization II (plan-based) ─────────
const PLAN_PATH = path.resolve(__dirname, '..', 'data', 'algorithm_data', 'longterm_inspection_plan.json');

function _loadPlan() {
  if (!fs.existsSync(PLAN_PATH)) {
    throw new Error(`Plan file not found: ${PLAN_PATH}`);
  }
  return JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
}

function _normalizeItem(x) {
  const sid =
    x.station_id ?? x.stationId ?? x.station_number ?? x['Station Number'] ?? x.station ?? x.id ?? '';
  const op = x.operation ?? x.Operation ?? x.task ?? '';
  let raw = x.score ?? x['Summed Value'] ?? x.value ?? x.percent ?? x.Score ?? 0;
  let score = _tryFloat(String(raw).toString().replace('%', ''));
  if (score == null) score = 0;
  const out = { station_id: _norm(sid), operation: _norm(op), score: score };
  if (x.days != null || x.Days != null) {
    const d = _tryFloat(x.days ?? x.Days);
    if (d != null) out.days = Math.max(1, Math.ceil(d));
  }
  return out;
}

function _distributeAcrossDays(items, days) {
  days = Math.max(1, parseInt(days || 1, 10));
  const n = items.length;
  if (!n) return [];
  const base = Math.floor(n / days);
  const rem = n % days;
  const out = [];
  let idx = 0;
  for (let d = 1; d <= days; d++) {
    const take = base + (d <= rem ? 1 : 0);
    for (let i = 0; i < take && idx < n; i++) {
      const row = { ...items[idx++], day: d };
      out.push(row);
    }
  }
  while (idx < n) out.push({ ...items[idx++], day: days });
  return out;
}

function _scheduleByItemDuration(items) {
  let current = 1;
  const out = [];
  let used = 0;
  for (const it of items) {
    const d = Math.max(1, parseInt(it.days || 1, 10));
    out.push({ ...it, day: current });
    current += d;
    used += d;
  }
  return [out, Math.max(used, 1)];
}

/**
 * @param {{items?: Array<Object>}} payload
 * @returns {{success:boolean, plan_name:string, trips:Array, unplanned:Array, totals:Object}}
 */
async function runGeographicalAlgorithm(payload = {}) {
  let plan;
  try {
    plan = _loadPlan();
  } catch (e) {
    return { success: false, message: String(e && e.message ? e.message : e) };
  }
  const itemsIn = Array.isArray(payload.items) ? payload.items : [];
  if (!itemsIn.length) {
    return { success: false, message: 'No Optimization I results provided. Run Optimization I first, then click Optimization II.' };
  }
  const items = itemsIn.map(_normalizeItem).filter(it => it.station_id);

  const stationToTrip = Object.create(null);
  const tripsMeta = Object.create(null);
  for (const t of plan.trips || []) {
    const tname = _norm(t.trip_name);
   if (!tname) continue;
    const days = Math.max(1, parseInt(t.days || 1, 10));
    tripsMeta[tname] = { days };
    for (const s of t.stations || []) {
      const sid = _norm(s.id);
      if (!sid) continue;
      const mode = _norm(s.transportation || 'drive').toLowerCase() || 'drive';
      stationToTrip[sid] = [tname, mode, days];
    }
  }

  const grouped = Object.create(null);
  const unplanned = [];
  for (const it of items) {
    const map = stationToTrip[it.station_id];
    if (map) {
     const [tname, mode] = map;
      grouped[tname] ||= [];
      grouped[tname].push({ ...it, mode });
    } else {
      unplanned.push({ ...it });
    }
  }

  const tripsOut = [];
  for (const [tname, rows] of Object.entries(grouped)) {
    const planDays = Math.max(1, parseInt(tripsMeta[tname]?.days || 1, 10));
    let scheduled, daysEffective;
    if (rows.some(r => r.days != null)) {
      [scheduled, daysEffective] = _scheduleByItemDuration(rows);
    } else {
      daysEffective = planDays;
      scheduled = _distributeAcrossDays(rows, planDays);
    }
    const driveCt = rows.filter(r => r.mode === 'drive').length;
    const heliCt  = rows.filter(r => r.mode === 'helicopter').length;
    tripsOut.push({
      trip_name: tname,
      days: daysEffective,
      count: rows.length,
      drive_count: driveCt,
      helicopter_count: heliCt,
      schedule: scheduled, // each: {day, station_id, operation, score, mode}
    });
  }

  // Sort trips by first appearance in the Opt I list
  const firstIndex = Object.create(null);
  let pos = 0;
  for (const it of items) {
    const map = stationToTrip[it.station_id];
    if (map) {
      const tname = map[0];
      if (!(tname in firstIndex)) firstIndex[tname] = pos;
    }
    pos++;
  }
  tripsOut.sort((a, b) => (firstIndex[a.trip_name] ?? 1e9) - (firstIndex[b.trip_name] ?? 1e9));

  return {
    success: true,
    plan_name: plan.plan_name || 'Long-Term Inspection Plan',
    trips: tripsOut,
    unplanned,
    totals: {
      items_in: items.length,
      planned: tripsOut.reduce((s, t) => s + t.count, 0),
      unplanned: unplanned.length,
      trip_count: tripsOut.length,
    },
  };
}

module.exports = { optimizeWorkplan, runGeographicalAlgorithm };