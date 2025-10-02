// backend/algorithms.js
'use strict';

const fs = require('fs');
const path = require('path');
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

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION I - CONSTRAINT-BASED FILTERING (NEW)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filter repairs based on fixed parameter constraints
 * @param {{repairs: Array, fixed_parameters: Array, station_data: Object}} payload
 * @returns {{success: boolean, kept: Array, filtered_out: Array, total_repairs: number}}
 */
async function runConstraintFiltering({ repairs = [], fixed_parameters = [], station_data = {} } = {}) {
  console.log('[runConstraintFiltering] repairs=', repairs.length, 'fixed_parameters=', fixed_parameters.length);
  console.log('[runConstraintFiltering] station_data keys=', Object.keys(station_data).length);

  if (!repairs.length) {
    return {
      success: false,
      message: 'No repairs provided for filtering',
      kept: [],
      filtered_out: [],
      total_repairs: 0
    };
  }

  if (!fixed_parameters.length) {
    // No constraints means all repairs pass
    return {
      success: true,
      kept: repairs,
      filtered_out: [],
      total_repairs: repairs.length
    };
  }

  const kept = [];
  const filtered_out = [];

  for (const repair of repairs) {
    let passes = true;
    let filter_reason = '';

    for (const param of fixed_parameters) {
      const result = checkConstraint(repair, param, station_data);
      if (!result.passes) {
        passes = false;
        filter_reason = result.reason;
        break;
      }
    }

    if (passes) {
      kept.push(repair);
    } else {
      filtered_out.push({ ...repair, filter_reason });
    }
  }

  return {
    success: true,
    kept,
    filtered_out,
    total_repairs: repairs.length
  };
}

function checkConstraint(repair, param, station_data) {
  const type = param.type;

  if (type === 'geographical') {
    return checkGeographicalConstraint(repair, param, station_data);
  } else if (type === 'temporal') {
    return checkTemporalConstraint(repair, param, station_data);
  } else if (type === 'monetary') {
    return checkMonetaryConstraint(repair, param, station_data);
  } else if (type === 'designation') {
    return checkDesignationConstraint(repair, param, station_data);
  }

  return { passes: true };
}

function checkGeographicalConstraint(repair, param, station_data) {
  // Check if repair's field value is in the allowed values list
  const paramName = _canon(param.name);
  const allowedValues = (param.values || []).map(v => _canon(v));

  // Determine data source
  const dataSource = param.data_source || 'repair';
  const station = station_data[repair.station_id] || {};
  
  // Look for matching field in the appropriate data source
  const value = dataSource === 'station' 
    ? findField(station, paramName)
    : findField(repair, paramName);
  
  if (!value) {
    return {
      passes: false,
      reason: `Missing geographical parameter: ${param.name} in ${dataSource} data`
    };
  }

  const canonValue = _canon(value);
  if (!allowedValues.includes(canonValue)) {
    return {
      passes: false,
      reason: `${param.name} value "${value}" not in allowed list: ${param.values.join(', ')}`
    };
  }

  return { passes: true };
}

function checkTemporalConstraint(repair, param, station_data) {
  // Check if repair meets temporal constraint
  // scope: per_day, per_week, per_month, per_year
  // value: numeric value
  // unit: hours, days, weeks, months, years
  
  const paramName = _canon(param.name);
  const dataSource = param.data_source || 'repair';
  const station = station_data[repair.station_id] || {};
  
  const value = dataSource === 'station' 
    ? findField(station, paramName)
    : findField(repair, paramName);
  
  if (!value) {
    return {
      passes: false,
      reason: `Missing temporal parameter: ${param.name} in ${dataSource} data`
    };
  }

  const repairNum = _tryFloat(value);
  const constraintValue = _tryFloat(param.value);

  if (repairNum === null || constraintValue === null) {
    return {
      passes: false,
      reason: `Invalid numeric value for temporal constraint: ${param.name}`
    };
  }

  // Convert both to same unit for comparison
  const normalizedRepair = normalizeTemporalValue(repairNum, param.unit);
  const normalizedConstraint = normalizeTemporalValue(constraintValue, param.unit);

  // Check based on scope
  if (normalizedRepair > normalizedConstraint) {
    return {
      passes: false,
      reason: `${param.name} exceeds ${param.scope} limit: ${value} > ${param.value} ${param.unit}`
    };
  }

  return { passes: true };
}

function checkMonetaryConstraint(repair, param, station_data) {
  // Check if repair's field meets monetary conditional
  // field_name: the field to check
  // conditional: <, <=, >, >=, =, !=
  // value: numeric value to compare against
  
  // Determine which field name to use for matching
  const matchUsing = param.match_using || 'parameter_name';
  const lookupName = matchUsing === 'field_name' ? param.field_name : param.name;
  const fieldName = _canon(lookupName);
  
  const dataSource = param.data_source || 'repair';
  const station = station_data[repair.station_id] || {};
  
  const value = dataSource === 'station' 
    ? findField(station, fieldName)
    : findField(repair, fieldName);
  
  if (!value) {
    return {
      passes: false,
      reason: `Missing monetary field: ${lookupName} in ${dataSource} data`
    };
  }

  const repairNum = _tryFloat(value);
  const constraintValue = _tryFloat(param.value);

  if (repairNum === null || constraintValue === null) {
    return {
      passes: false,
      reason: `Invalid numeric value for monetary constraint: ${lookupName}`
    };
  }

  const conditional = param.conditional;
  let passes = false;

  switch (conditional) {
    case '<':
      passes = repairNum < constraintValue;
      break;
    case '<=':
      passes = repairNum <= constraintValue;
      break;
    case '>':
      passes = repairNum > constraintValue;
      break;
    case '>=':
      passes = repairNum >= constraintValue;
      break;
    case '=':
      passes = repairNum === constraintValue;
      break;
    case '!=':
      passes = repairNum !== constraintValue;
      break;
    default:
      passes = true;
  }

  if (!passes) {
    return {
      passes: false,
      reason: `${lookupName} (${value}) does not meet condition: ${conditional} ${param.value} ${param.unit || ''}`
    };
  }

  return { passes: true };
}

function checkDesignationConstraint(repair, param, station_data) {
  // condition: "None" or "Only"
  // field_name: the field to check
  
  // Determine which field name to use for matching
  const matchUsing = param.match_using || 'parameter_name';
  const lookupName = matchUsing === 'field_name' ? param.field_name : param.name;
  const fieldName = _canon(lookupName);
  
  const dataSource = param.data_source || 'repair';
  const station = station_data[repair.station_id] || {};
  
  const value = dataSource === 'station' 
    ? findField(station, fieldName)
    : findField(repair, fieldName);
  
  const hasValue = value !== null && value !== '';


  if (param.condition === 'None') {
    // Filter out if field is present
    if (hasValue) {
      return {
        passes: false,
        reason: `${lookupName} should not be present (condition: None)`
      };
    }
  } else if (param.condition === 'Only') {
    // Keep only if field is present
    if (!hasValue) {
      return {
        passes: false,
        reason: `${lookupName} must be present (condition: Only)`
      };
    }
  }

  return { passes: true };
}

function findField(dataObj, fieldName) {
  // Case-insensitive field lookup
  const canon = _canon(fieldName);
  for (const [key, value] of Object.entries(dataObj)) {
    if (_canon(key) === canon) {
      return value;
    }
  }
  return null;
}

function normalizeTemporalValue(value, unit) {
  // Normalize all temporal values to hours for comparison
  switch (unit) {
    case 'hours':
      return value;
    case 'days':
      return value * 24;
    case 'weeks':
      return value * 24 * 7;
    case 'months':
      return value * 24 * 30; // approximation
    case 'years':
      return value * 24 * 365; // approximation
    default:
      return value;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION II - SCORING & RANKING (OLD OPTIMIZATION I)
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

async function _loadParams() {
  if (typeof lookupsRepo.getAlgorithmParameters === 'function') {
    return await lookupsRepo.getAlgorithmParameters();
  }
  if (typeof lookupsRepo.loadAlgorithmParameters === 'function') {
    return await lookupsRepo.loadAlgorithmParameters();
  }
  return [];
}

/**
 * Score and rank repairs using soft parameters (old Algorithm I)
 * @param {{workplan_rows?: Array<Object>, param_overall?: Object, parameters?: Array}} payload
 * @returns {{success: boolean, optimized_count: number, ranking: Array<Object>, notes: string}}
 */
async function optimizeWorkplan({ workplan_rows = [], param_overall = {}, parameters: paramsFromUI } = {}) {
  const parameters = Array.isArray(paramsFromUI) ? paramsFromUI : await _loadParams();
  console.log('[optimizeWorkplan] workplan_rows=', workplan_rows.length, 'parameters=', (parameters || []).length);
  
  const pindex = _buildParamIndex(parameters || []);
  if (!Object.keys(pindex).length) {
    return {
      success: false,
      optimized_count: 0,
      ranking: [],
      notes: 'No algorithm parameters loaded. Ensure Soft Parameters are saved and passed in.'
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
      score: Math.round(score * 10000) / 100,
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

module.exports = { 
  runConstraintFiltering,
  optimizeWorkplan
};