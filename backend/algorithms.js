// backend/algorithms.js
'use strict';

const lookupsRepo = require('./lookups_repo');

// ───────── helpers ─────────
const _norm = (x) => (x == null ? '' : String(x).trim());
const _canon = (s) => String(s ?? '')
  .trim()
  .replace(/[\u2013\u2014]/g, '-')
  .toLowerCase();
const _tryFloat = (s) => {
  const v = Number(String(s ?? '').replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};

// ───────── temporal unit helpers (hours as canonical base) ─────────
const _normalizeUnit = (u) => {
  const s = _canon(u);
  if (!s) return null;
  // hours
  if (/^(h|hr|hrs|hour|hours)$/.test(s)) return 'hours';
  // days
  if (/^(d|day|days)$/.test(s)) return 'days';
  // weeks
  if (/^(w|wk|wks|week|weeks)$/.test(s)) return 'weeks';
  // months (assume 30-day months)
  if (/^(mo|mon|mons|month|months)$/.test(s)) return 'months';
  // years (assume 365-day years)
  if (/^(y|yr|yrs|year|years)$/.test(s)) return 'years';
  return null;
};

const _detectUnitFromFieldName = (name) => {
  const s = _canon(name);
  if (!s) return null;
  if (/(^|\W)(h|hr|hrs|hour|hours)(\W|$)/.test(s)) return 'hours';
  if (/(^|\W)(d|day|days)(\W|$)/.test(s)) return 'days';
  if (/(^|\W)(w|wk|wks|week|weeks)(\W|$)/.test(s)) return 'weeks';
  if (/(^|\W)(mo|mon|mons|month|months)(\W|$)/.test(s)) return 'months';
  if (/(^|\W)(y|yr|yrs|year|years)(\W|$)/.test(s)) return 'years';
  return null;
};

const _toHours = (num, unitLike) => {
  const u = _normalizeUnit(unitLike) || 'hours';
  switch (u) {
    case 'hours':  return num;
    case 'days':   return num * 24;
    case 'weeks':  return num * 24 * 7;
    case 'months': return num * 24 * 30;   // approx
    case 'years':  return num * 24 * 365;  // approx
    default:       return num;             // if unknown, pass through
  }
};

// ===== monetary SPLIT helpers =====
// Parse split strings like "50%F-50%P", "100%P(OTH)", "84%H-192%W(D"
// Returns a map of canonicalized source -> multiplier (e.g., {"f":0.5,"p":0.5})
function _parseSplitSpec(spec) {
  if (!spec) return null;
  const parts = String(spec).split(/\s*-\s*/);
  const out = Object.create(null);
  let found = false;
  for (const seg of parts) {
    const m = String(seg).match(/(-?\d+(?:\.\d+)?)%\s*([A-Za-z0-9()[\]\/\-\s]+)$/);
    if (!m) continue;
    const pct = Number(m[1]);
    if (!Number.isFinite(pct)) continue;
    const src = _canon(m[2] || '');
    if (!src) continue;
    out[src] = (pct / 100);
    found = true;
  }
  return found ? out : null;
}

// Determine which category column (O&M / Capital / Decommission) has a value and parse it.
function _getRepairSplitMap(repair, station_data) {
  // prefer repair fields; use findFieldAnywhere so case/variant-insensitive
  const om = findFieldAnywhere(repair, station_data[repair.station_id] || {}, 'O&M');
  const cap = findFieldAnywhere(repair, station_data[repair.station_id] || {}, 'Capital');
  const dec = findFieldAnywhere(repair, station_data[repair.station_id] || {}, 'Decommission');
  const spec = om || cap || dec || null;
  return _parseSplitSpec(spec);
}

// Apply split multiplier when configured on a monetary fixed parameter.
function _applyMonetarySplitIfAny(amount, param, repair, station_data) {
  if (!param || !param.split_condition || !param.split_condition.enabled) return amount;
  const srcRaw = param.split_condition.source;
  if (!srcRaw) return amount;
  const splitMap = _getRepairSplitMap(repair, station_data) || null;
  if (!splitMap) return amount;
  const mul = splitMap[_canon(srcRaw)];
  return amount * (Number.isFinite(mul) ? mul : 0); // if missing source => 0 contribution
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION 1 - REPAIR SCORING (Soft Parameters)
// ═══════════════════════════════════════════════════════════════════════════

function _buildParamIndex(parameters = []) {
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
  for (const [pname, grp] of Object.entries(out)) {
    if (grp.max_weight == null) {
      const vals = Object.values(grp.options);
      grp.max_weight = Math.max(1, ...vals.map(v => (Number.isFinite(v) ? v : 0)));
    }
  }
  return out;
}

function _normalizeOverallWeights(rawMap, paramIndex) {
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
  const options = paramCfg?.options || {};
  const v = _canon(value);

  for (const [label, w] of Object.entries(options)) {
    if (_canon(label) === v) {
      const wn = _tryFloat(w);
      return { matched: true, weight: wn == null ? 0 : wn };
    }
  }
  
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

// Search both repair and station data for a field
function findFieldAnywhere(repair, station, fieldName) {
  const canon = _canon(fieldName);
  
  // Search repair first
  for (const [key, value] of Object.entries(repair)) {
    if (_canon(key) === canon) {
      return value;
    }
  }
  
  // Then search station
  for (const [key, value] of Object.entries(station)) {
    if (_canon(key) === canon) {
      return value;
    }
  }
  
  return null;
}

// Prefer the Cost value coming directly from the Repairs sheet (repair object only)
function _extractRepairCost(repair) {
  if (!repair || typeof repair !== 'object') return 0;
  for (const [k, v] of Object.entries(repair)) {
    if (_canon(k) === 'cost') {
      const num = _tryFloat(v);
      return num == null ? 0 : num;
    }
  }
  return 0;
}

async function _loadParams() {
  if (typeof lookupsRepo.getAlgorithmParameters === 'function') {
    return await lookupsRepo.getAlgorithmParameters();
  }
  return [];
}

/**
 * OPTIMIZATION 1: Score and rank repairs using soft parameters
 * Now searches across all fields regardless of data_source
 */
async function optimizeWorkplan({ repairs = [], station_data = {}, param_overall = {}, parameters: paramsFromUI } = {}) {
  const parameters = Array.isArray(paramsFromUI) ? paramsFromUI : await _loadParams();
  console.log('[optimizeWorkplan] repairs=', repairs.length, 'parameters=', (parameters || []).length);
  
  const pindex = _buildParamIndex(parameters || []);
  if (!Object.keys(pindex).length) {
    return {
      success: false,
      optimized_count: 0,
      ranking: [],
      notes: 'No soft parameters loaded. Ensure parameters are saved and passed in.'
    };
  }
  
  const overallFrac = _normalizeOverallWeights(param_overall || {}, pindex);
  const paramNames = Object.keys(pindex);

  const results = [];
  for (let i = 0; i < repairs.length; i++) {
    const repair = repairs[i] || {};
    const stationId = repair.station_id ?? '';
    const repairName = repair.name ?? '';
    const location = repair.location ?? '';
    const assetType = repair.assetType ?? '';
    const station = station_data[stationId] || {};
    const cost = _extractRepairCost(repair);
    const splitMap = _getRepairSplitMap(repair, station_data) || {};
    const splitAmounts = Object.create(null);
    for (const [src, mul] of Object.entries(splitMap)) {
      const amt = Number.isFinite(mul) ? cost * mul : 0;
      if (amt > 0) splitAmounts[src] = amt;
    }

    const perParam = Object.create(null);
    let presentSum = 0;
    
    for (const pname of paramNames) {
      const cfg = pindex[pname];
      
      // Search both repair and station data
      const value = findFieldAnywhere(repair, station, pname);
      
      const { matched, weight } = _matchOptionWeight(cfg, value);
      const maxw = Number(cfg?.max_weight || 1);
      const frac = Number(overallFrac[pname] || 0);
      
      perParam[pname] = {
        matched,
        option_weight: weight,
        max_weight: maxw,
        overall_fraction: frac,
        value: value,
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
        value: info.value,
        option_weight,
        max_weight,
        overall_fraction,
        matched,
        effective_fraction: effFrac,
      };
    }

    results.push({
      row_index: i,
      station_id: stationId,
      repair_name: repairName,
      location,
      asset_type: assetType,
      cost,
      split_amounts: splitAmounts,
      score: Math.round(score * 10000) / 100,
      details: breakdown,
      original_repair: repair
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = String(a.station_id || '');
    const bn = String(b.station_id || '');
    if (an !== bn) return an.localeCompare(bn);
    const ao = String(a.repair_name || '');
    const bo = String(b.repair_name || '');
    return ao.localeCompare(bo);
  });
  
  results.forEach((r, idx) => (r.rank = idx + 1));

  return {
    success: true,
    optimized_count: results.length,
    ranking: results,
    notes: 'Repairs scored using soft parameters searching all fields.'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION 2 - TRIP GROUPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Group repairs into trips by Trip Location and Access Type.
 * NOTE: This is **just grouping** and applies **no prioritization** or ordering
 * based on Optimization 1 scores. It can accept either:
 *   - scored_repairs: [{ original_repair, score, ... }]
 *   - repairs:        [rawRepairObjects]
 * If scored_repairs is empty, it will group raw repairs directly.
 */
async function groupRepairsIntoTrips({ scored_repairs = [], repairs = [], station_data = {}, priority_mode = 'tripmean' } = {}) {
  console.log('[groupRepairsIntoTrips] scored_repairs=', scored_repairs.length);

  // Accept raw repairs if scored ones were not provided
  const inputRepairs = (Array.isArray(scored_repairs) && scored_repairs.length)
    ? scored_repairs
    : (Array.isArray(repairs) ? repairs.map(r => ({ original_repair: r })) : []);

  if (!inputRepairs.length) {
    return { success: false, message: 'No repairs provided', trips: [] };
  }

  // Group by trip_location + access_type
  const tripGroups = new Map();

  for (const scoredRepair of inputRepairs) {
    const repair = scoredRepair.original_repair;
    const stationId = repair.station_id;
    const station = station_data[stationId] || {};

    // Get trip fields from station data
    const tripLocation = findFieldAnywhere(repair, station, 'Trip Location') || 'Unknown';
    const accessType = findFieldAnywhere(repair, station, 'Access Type') || 'Unknown';
    const cityOfTravel = findFieldAnywhere(repair, station, 'City of Travel') || '';
    const timeToSite = findFieldAnywhere(repair, station, 'Time to Site (hr)') || '';
    const siteName = findFieldAnywhere(repair, station, 'Station Name') || '';

    const tripKey = `${tripLocation}|||${accessType}`;
    
    if (!tripGroups.has(tripKey)) {
      tripGroups.set(tripKey, {
        trip_location: tripLocation,
        access_type: accessType,
        repairs: [],
        stations: new Map()
      });
    }

    const trip = tripGroups.get(tripKey);
    trip.repairs.push(scoredRepair);

    // Track unique stations
    if (!trip.stations.has(stationId)) {
      // Keep the full original station row so downstream constraints (Opt-3)
      // can see fields like "Access Type", regions, budgets, etc.
      trip.stations.set(stationId, {
        ...station,                 // full station metadata
        station_id: stationId,      // ensure canonical key present
        site_name: siteName,
        city_of_travel: cityOfTravel,
        time_to_site: timeToSite,
        repairs: []
      });
    }

    const stationInfo = trip.stations.get(stationId);
    stationInfo.repairs.push(repair);
  }

  // Convert to array and calculate totals
  const trips = [];
  
  for (const [tripKey, tripData] of tripGroups.entries()) {
    let totalDays = 0;
    let totalCost = 0;
    const tripSplitTotals = Object.create(null);
    const stationsArray = [];
    const repairScores = []; // collect Opt-1 scores for priority metrics

    for (const [stationId, stationInfo] of tripData.stations.entries()) {
      let stationDays = 0;
      let stationCost = 0;
      
      // Sum days for all repairs at this station
      for (const repair of stationInfo.repairs) {
        const days = _tryFloat(repair.days || repair.Days) || 0;
        stationDays += days;
        stationCost += _extractRepairCost(repair);
        // If this repair came from Opt-1, we can read its score via tripData.repairs later;
        // we still collect in a separate pass below for correctness.

        // Split totals (per repair)
        const splitMap = _getRepairSplitMap(repair, station_data) || {};
        const baseCost = _extractRepairCost(repair);
        if (baseCost > 0) {
          for (const [src, mul] of Object.entries(splitMap)) {
            if (!Number.isFinite(mul)) continue;
            const add = baseCost * mul;
            if (add <= 0) continue;
            tripSplitTotals[src] = (tripSplitTotals[src] || 0) + add;
          }
        }

      }

      stationInfo.total_days = stationDays;
      stationInfo.total_cost = stationCost;
      stationInfo.repair_count = stationInfo.repairs.length;
      totalDays += stationDays;
      totalCost += stationCost;
      
      stationsArray.push(stationInfo);
    }

    // Annotate each scored repair in this trip with trip context for downstream (Opt-3 warnings)
    for (const sr of (tripData.repairs || [])) {
      try {
        sr._trip_location = tripData.trip_location;
        sr._access_type = tripData.access_type;
      } catch (e) { /* ignore */ }
    }

    // ── Score-only priority metrics from Optimization 1 ──
    // Use the scored repairs attached to this trip grouping.
    const scores = (tripData.repairs || []).map(r => Number(r.score) || 0).sort((a,b)=>b-a);
    const mean   = scores.length ? (scores.reduce((a,b)=>a+b,0) / scores.length) : 0;
    const max    = scores.length ? scores[0] : 0;
    const median = scores.length
      ? (scores.length % 2
          ? scores[(scores.length-1)/2]
          : (scores[scores.length/2 - 1] + scores[scores.length/2]) / 2)
      : 0;

    // choose priority score based on requested mode (default = tripmean)
    const mode = String(priority_mode || 'tripmean').toLowerCase();
    const priority_score = (mode === 'tripmax') ? max : mean;

    trips.push({
      trip_location: tripData.trip_location,
      access_type: tripData.access_type,
      total_days: totalDays,
      total_cost: totalCost,
      total_split_costs: tripSplitTotals,
      repairs: tripData.repairs,
      stations: stationsArray,
      priority_score,
      priority_mode: mode,
      priority_metrics: { mean, max, median, scores }
    });
  }

  // Sort trips by score-only priority (desc). Tie-break: max score, then lexicographic by scores, then total_days.
  trips.sort((a, b) => {
    const ps = (b.priority_score ?? 0) - (a.priority_score ?? 0);
    if (ps) return ps;
    const mx = (b.priority_metrics?.max ?? 0) - (a.priority_metrics?.max ?? 0);
    if (mx) return mx;
    const as = a.priority_metrics?.scores || [];
    const bs = b.priority_metrics?.scores || [];
    const n = Math.max(as.length, bs.length);
    for (let i=0;i<n;i++){
      const diff = (bs[i] ?? -Infinity) - (as[i] ?? -Infinity);
      if (diff) return diff;
    }
    return (b.total_days ?? 0) - (a.total_days ?? 0);
  });

  return {
    success: true,
    notes: `Grouping only. Prioritized by ${String(priority_mode || 'tripmean')}.`,
    trips,
    total_trips: trips.length
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION 3 - YEARLY ASSIGNMENT WITH CONSTRAINTS
// ═══════════════════════════════════════════════════════════════════════════

function checkIfCondition(repair, param, station_data) {
  if (!param.if_condition) return true;
  
  const ifCond = param.if_condition;
  const station = station_data[repair.station_id] || {};
  
  // Search both repair and station for the field
  const value = findFieldAnywhere(repair, station, ifCond.field);
  
  if (!value) return false;
  
  const valueStr = _canon(String(value));
  const targetStr = _canon(String(ifCond.value));
  
  switch (ifCond.operator) {
    case '=':
      return valueStr === targetStr;
    case '!=':
      return valueStr !== targetStr;
    case 'contains':
      return valueStr.includes(targetStr);
    default:
      return true;
  }
}

function checkGeographicalConstraint(repair, param, station_data, year) {
  if (!checkIfCondition(repair, param, station_data)) {
    return true;
  }  
  
  const paramName = _canon(param.name);
  // Prefer year-specific allowed values if provided; fall back to base list.
  const yearVals =
    (param.years && year && param.years[year] && param.years[year].values) || null;
  const allowedValues = (yearVals || param.values || []).map(v => _canon(v));
  const station = station_data[repair.station_id] || {};
  
  const value = findFieldAnywhere(repair, station, paramName);
  
  if (!value) return false;
  
  const valueParts = String(value).split(/[\/,;]/)
    .map(part => _canon(part.trim()))
    .filter(part => part);
  
  return valueParts.every(part => allowedValues.includes(part));
}

function checkTemporalConstraint(repair, param, station_data, year) {
  if (!checkIfCondition(repair, param, station_data)) {
    return true;
  }  
  
  const paramName = _canon(param.name);
  const station = station_data[repair.station_id] || {};
  
  const value = findFieldAnywhere(repair, station, paramName);
  
  if (!value) return false;
  
  const repairNum = _tryFloat(value);
  if (repairNum === null) return false;
  
  const yearConstraint = param.years && param.years[year];
  if (!yearConstraint) return true;
  
  const constraintValue = _tryFloat(yearConstraint.value);
  if (constraintValue === null) return true;
  
  // ── Unit-aware comparison: convert both sides to hours ──
  // Prefer unit from field name; fall back to the param's configured unit.
  const repairUnit =
    _detectUnitFromFieldName(param.name) ||
    _normalizeUnit(param.unit) ||
    'hours';
  const constraintUnit = _normalizeUnit(param.unit) || repairUnit;

  const repairHours = _toHours(repairNum, repairUnit);
  const constraintHours = _toHours(constraintValue, constraintUnit);

  return _compare(param.conditional || '<=', repairHours, constraintHours);
}

function _compare(op, a, b) {
  switch (op) {
    case '<':  return a <  b;
    case '<=': return a <= b;
    case '>':  return a >  b;
    case '>=': return a >= b;
    case '=':  return a === b;
    case '!=': return a !== b;
    default:   return a <= b;
  }
}

function checkMonetaryConstraint(repair, param, station_data, year) {
  if (!checkIfCondition(repair, param, station_data)) {
    return true;
  }  
  
  const fieldName = _canon(param.field_name);
  const station = station_data[repair.station_id] || {};
  
  const value = findFieldAnywhere(repair, station, fieldName);
  
  if (!value) return false;
  
  const repairCost = _tryFloat(value);
  if (repairCost === null) return false;
  // Apply SPLIT multiplier if configured (monetary only)
  const adjustedCost = _applyMonetarySplitIfAny(repairCost, param, repair, station_data);
  
  const yearConstraint = param.years && param.years[year];
  if (!yearConstraint) return true;
  
  const budget = _tryFloat(yearConstraint.value);
  if (budget === null) return true;
  
  return _compare(param.conditional || '<=', adjustedCost, budget);
}

/**
 * OPTIMIZATION 3: Assign trips to years based on fixed parameters
 */
async function assignTripsToYears({ trips = [], fixed_parameters = [], top_percent = 20 } = {}) {
  console.log('[assignTripsToYears] trips=', trips.length, 'fixed_parameters=', fixed_parameters.length);

  // Drop legacy/unsupported types (e.g., "designation") to be safe.
  fixed_parameters = (fixed_parameters || []).filter(p =>
    p && (p.type === 'geographical' || p.type === 'temporal' || p.type === 'monetary')
  );

  if (!trips.length) {
    return {
      success: false,
      message: 'No trips provided for assignment',
      assignments: {}
    };
  }

  // IMPORTANT: Respect incoming trip order from Optimization 2
  // Do NOT re-sort 'trips' here. They are already ordered by priority mode (tripmean/tripmax).

  // ── Build Top-X% repair set for Year-1 warning reporting ─────────────────
  const getRepairKey = (sr) => {
    // Prefer stable row_index from Opt-1; fallback to a composite key.
    const oi = (sr && Number.isInteger(sr.row_index)) ? `idx:${sr.row_index}` : null;
    if (oi) return oi;
    const r = sr?.original_repair || {};
    return `sid:${r.station_id ?? ''}::name:${r.name ?? r.repair_name ?? ''}`;
  };

  const allScoredRepairs = [];
  for (const t of trips) {
    for (const sr of (t.repairs || [])) {
      allScoredRepairs.push(sr);
    }
  }
  const sortedByScore = allScoredRepairs.slice().sort((a,b) => {
    const sa = Number(a?.score) || 0;
    const sb = Number(b?.score) || 0;
    return sb - sa;
  });
  const topCount = Math.min(
    sortedByScore.length,
    Math.max(0, Math.ceil((Number(top_percent) || 0) / 100 * sortedByScore.length))
  );
  const topRepairs = sortedByScore.slice(0, topCount);
  const topRepairKeys = new Set(topRepairs.map(getRepairKey));

  // Get all years from fixed parameters
  const allYears = new Set();
  for (const param of fixed_parameters) {
    if (param.years) {
      Object.keys(param.years).forEach(year => allYears.add(year));
    }
  }
  
  const years = Array.from(allYears).sort();
  
  if (!years.length) {
    // No yearly constraints, assign all to current year
    const currentYear = new Date().getFullYear();
    return {
      success: true,
      assignments: {
        [currentYear]: trips
      }
    };
  }

  // Build station data map
  const stationDataMap = {};
  trips.forEach(trip => {
    trip.stations.forEach(station => {
      if (!stationDataMap[station.station_id]) {
        // Each trip's station now carries the full station row (from Opt-2).
        // Keep it as-is so findFieldAnywhere can access all columns.
        stationDataMap[station.station_id] = station;
      }
    });
  });

  // Track yearly budgets/constraints
  const yearlyBudgets = {};
  const yearlyTemporal = {};
  
  for (const year of years) {
    yearlyBudgets[year] = {};
    yearlyTemporal[year] = {};
    
    for (const param of fixed_parameters) {
      if (param.type === 'monetary' && param.years && param.years[year]) {
        const key = _canon(param.field_name);
        yearlyBudgets[year][key] = {
          total: _tryFloat(param.years[year].value) || 0,
          used: 0,
          cumulative: !!param.cumulative
        };
      } else if (param.type === 'temporal' && param.years && param.years[year]) {
        const key = _canon(param.name);
        const rawTotal = _tryFloat(param.years[year].value) || 0;
        const totalHours = _toHours(rawTotal, _normalizeUnit(param.unit) || _detectUnitFromFieldName(param.name) || 'hours');
        yearlyTemporal[year][key] = {
          total: totalHours,     // store in hours
          used: 0,               // track in hours
          cumulative: !!param.cumulative
        };
      }
    }
  }

  const assignments = {};
  years.forEach(year => assignments[year] = []);
  const unassigned = [];

  // Track which top-X% repairs ended up in Year-1
  const firstYear = years[0];
  const placedInYear1 = new Set();

  // Try to assign each trip starting from first year
  for (const trip of trips) {
    let assigned = false;
    
    for (const year of years) {
      let canAssign = true;
      
      // Check all constraints for this trip's repairs
      for (const repair of trip.repairs) {
        const originalRepair = repair.original_repair;
        
        for (const param of fixed_parameters) {
          if (param.type === 'geographical') {
            if (!checkGeographicalConstraint(originalRepair, param, stationDataMap, year)) {
              canAssign = false;
              break;
            }
          } else if (param.type === 'temporal' && !param.cumulative) {
            if (!checkTemporalConstraint(originalRepair, param, stationDataMap, year)) {
              canAssign = false;
              break;
            }
          } else if (param.type === 'monetary' && !param.cumulative) {
            if (!checkMonetaryConstraint(originalRepair, param, stationDataMap, year)) {
              canAssign = false;
              break;
            }
          }
        }
        
        if (!canAssign) break;
      }
      
      // Check cumulative budget/temporal availability
      if (canAssign) {
        // Calculate trip totals for cumulative constraints
        const tripTotals = {};
        
        for (const repair of trip.repairs) {
          const originalRepair = repair.original_repair;
          const stationId = originalRepair.station_id;
          const station = stationDataMap[stationId] || {};
          
          for (const param of fixed_parameters) {
            if (!param.cumulative) continue;
            if (!checkIfCondition(originalRepair, param, stationDataMap)) continue;
            
            if (param.type === 'monetary') {
              const fieldName = _canon(param.field_name);
              const value = findFieldAnywhere(originalRepair, station, fieldName);
              let amount = _tryFloat(value) || 0;
              // Apply SPLIT multiplier if configured
              amount = _applyMonetarySplitIfAny(amount, param, originalRepair, stationDataMap);
              tripTotals[fieldName] = (tripTotals[fieldName] || 0) + amount;
            } else if (param.type === 'temporal') {
              const fieldName = _canon(param.name);
              const value = findFieldAnywhere(originalRepair, station, fieldName);
              const amount = _tryFloat(value) || 0;
              // Convert each repair's temporal value to hours before summing
              const repairUnit =
                _detectUnitFromFieldName(param.name) ||
                _normalizeUnit(param.unit) ||
                'hours';
              const hours = _toHours(amount, repairUnit);
              tripTotals[fieldName] = (tripTotals[fieldName] || 0) + hours;
            }
          }
        }
        
        // Check if cumulative budgets have room
        for (const [fieldName, budget] of Object.entries(yearlyBudgets[year])) {
          if (!budget.cumulative) continue;
          const tripAmount = tripTotals[fieldName] || 0;
          if (budget.used + tripAmount > budget.total) {
            canAssign = false;
            break;
          }
        }
        
        // Check if cumulative temporal limits have room
        for (const [fieldName, temporal] of Object.entries(yearlyTemporal[year])) {
          if (!temporal.cumulative) continue;
          const tripAmount = tripTotals[fieldName] || 0;
          if (temporal.used + tripAmount > temporal.total) {
            canAssign = false;
            break;
          }
        }
        
        if (canAssign) {
          // Update cumulative trackers
          for (const [fieldName, budget] of Object.entries(yearlyBudgets[year])) {
            if (budget.cumulative) {
              budget.used += (tripTotals[fieldName] || 0);
            }
          }
          for (const [fieldName, temporal] of Object.entries(yearlyTemporal[year])) {
            if (temporal.cumulative) {
              temporal.used += (tripTotals[fieldName] || 0);
            }
          }
          
          assignments[year].push(trip);
          // If placed in first year, mark all its repairs as placed for warning coverage.
          if (year === firstYear) {
            for (const sr of (trip.repairs || [])) {
              placedInYear1.add(getRepairKey(sr));
            }
          }
          assigned = true;
          break;
        }
      }
    }
    
    if (!assigned) {
      unassigned.push(trip);
    }
  }

  // Add unassigned trips to a later year or create a new year
  if (unassigned.length > 0) {
    const lastYear = parseInt(years[years.length - 1]);
    const nextYear = lastYear + 1;
    assignments[nextYear] = unassigned;
  }

  // Build lookup of repair -> trip context using the SAME key function
  const tripLookup = new Map();
  for (const t of trips) {
    for (const sr of (t.repairs || [])) {
      const k = getRepairKey(sr);
      tripLookup.set(k, { trip_location: t.trip_location, access_type: t.access_type });
    }
  }

  const highPriorityMissing = [];
  for (const sr of topRepairs) {
    const key = getRepairKey(sr);
    if (!placedInYear1.has(key)) {
      const r = sr?.original_repair || {};
      const ctx = tripLookup.get(key) || {};
      highPriorityMissing.push({
        station_id: r.station_id ?? '',
        repair_name: r.name ?? r.repair_name ?? '',
        score: Number(sr.score) || 0,
        trip_location: (sr._trip_location ?? ctx.trip_location ?? ''),
        access_type: (sr._access_type ?? ctx.access_type ?? '')
      });
    }
  }

  // ── Yearly summaries: total $ cost, days, and split totals ───────────────
  const year_summaries = {};
  for (const [year, tripsInYear] of Object.entries(assignments)) {
    let yCost = 0;
    let yDays = 0;
    const ySplits = Object.create(null);
    for (const t of tripsInYear || []) {
      const tc = Number(t.total_cost || 0);
      const td = Number(t.total_days || 0);
      yCost += tc;
      yDays += td;
      const splits = t.total_split_costs || {};
      for (const [k, v] of Object.entries(splits)) {
        const n = Number(v || 0);
        if (n > 0) ySplits[k] = (ySplits[k] || 0) + n;
      }
    }
    year_summaries[year] = {
      total_cost: yCost,
      total_days: yDays,
      total_split_costs: ySplits
    };
  }

  return {
    success: true,
    assignments,
    total_years: Object.keys(assignments).length,
    year_summaries,
    warnings: {
      top_percent: Number(top_percent) || 0,
      total_top_repairs: topCount,
      missing_in_year1: highPriorityMissing
    }
  };
}

module.exports = { 
  optimizeWorkplan,
  groupRepairsIntoTrips,
  assignTripsToYears
};