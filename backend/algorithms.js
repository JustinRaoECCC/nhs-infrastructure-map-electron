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
 * Group scored repairs into trips by Trip Location and Access Type
 */
async function groupRepairsIntoTrips({ scored_repairs = [], station_data = {} } = {}) {
  console.log('[groupRepairsIntoTrips] scored_repairs=', scored_repairs.length);

  if (!scored_repairs.length) {
    return {
      success: false,
      message: 'No scored repairs provided',
      trips: []
    };
  }

  // Group by trip_location + access_type
  const tripGroups = new Map();

  for (const scoredRepair of scored_repairs) {
    const repair = scoredRepair.original_repair;
    const stationId = repair.station_id;
    const station = station_data[stationId] || {};

    // Get trip fields from station data
    const tripLocation = findFieldAnywhere(repair, station, 'Trip Location') || 'Unknown';
    const accessType = findFieldAnywhere(repair, station, 'Access Type') || 'Unknown';
    const cityOfTravel = findFieldAnywhere(repair, station, 'City of Travel') || '';
    const timeToSite = findFieldAnywhere(repair, station, 'Time to Site (hr)') || '';
    const siteName = findFieldAnywhere(repair, station, 'Site Name') || 
                     findFieldAnywhere(repair, station, 'name') || '';

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
      trip.stations.set(stationId, {
        station_id: stationId,
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
    const stationsArray = [];

    for (const [stationId, stationInfo] of tripData.stations.entries()) {
      let stationDays = 0;
      
      // Sum days for all repairs at this station
      for (const repair of stationInfo.repairs) {
        const days = _tryFloat(repair.days || repair.Days) || 0;
        stationDays += days;
      }

      stationInfo.total_days = stationDays;
      stationInfo.repair_count = stationInfo.repairs.length;
      totalDays += stationDays;
      
      stationsArray.push(stationInfo);
    }

    trips.push({
      trip_location: tripData.trip_location,
      access_type: tripData.access_type,
      total_days: totalDays,
      repairs: tripData.repairs,
      stations: stationsArray
    });
  }

  // Sort trips by total days (descending)
  trips.sort((a, b) => b.total_days - a.total_days);

  return {
    success: true,
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

function checkGeographicalConstraint(repair, param, station_data) {
  if (!checkIfCondition(repair, param, station_data)) {
    return true;
  }  
  
  const paramName = _canon(param.name);
  const allowedValues = (param.values || []).map(v => _canon(v));
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
  
  return _compare(param.conditional || '<=', repairNum, constraintValue);
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
  
  const yearConstraint = param.years && param.years[year];
  if (!yearConstraint) return true;
  
  const budget = _tryFloat(yearConstraint.value);
  if (budget === null) return true;
  
  return _compare(param.conditional || '<=', repairCost, budget);
}

/**
 * OPTIMIZATION 3: Assign trips to years based on fixed parameters
 */
async function assignTripsToYears({ trips = [], fixed_parameters = [] } = {}) {
  console.log('[assignTripsToYears] trips=', trips.length, 'fixed_parameters=', fixed_parameters.length);

  if (!trips.length) {
    return {
      success: false,
      message: 'No trips provided for assignment',
      assignments: {}
    };
  }

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
        yearlyTemporal[year][key] = {
          total: _tryFloat(param.years[year].value) || 0,
          used: 0,
          cumulative: !!param.cumulative
        };
      }
    }
  }

  const assignments = {};
  years.forEach(year => assignments[year] = []);
  const unassigned = [];

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
            if (!checkGeographicalConstraint(originalRepair, param, stationDataMap)) {
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
              const amount = _tryFloat(value) || 0;
              tripTotals[fieldName] = (tripTotals[fieldName] || 0) + amount;
            } else if (param.type === 'temporal') {
              const fieldName = _canon(param.name);
              const value = findFieldAnywhere(originalRepair, station, fieldName);
              const amount = _tryFloat(value) || 0;
              tripTotals[fieldName] = (tripTotals[fieldName] || 0) + amount;
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

  return {
    success: true,
    assignments,
    total_years: Object.keys(assignments).length
  };
}

module.exports = { 
  optimizeWorkplan,
  groupRepairsIntoTrips,
  assignTripsToYears
};