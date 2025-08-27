// backend/app.js
const path = require('path');
let ExcelJS = null;
const { readJSON, writeJSON } = require('./utils/fs_utils');
const lookupsRepo = require('./lookups_repo');

const STATE_PATH = path.join(__dirname, '..', 'data', 'app_state.json');
let _state = null;

// shape: { stations: [], colors: { global: {...}, byLocation: { [loc]: { [assetType]: "#hex" } } }, companies: [] }
function loadState() {
  if (_state) return _state;
  const s = readJSON(STATE_PATH, null) ||
            { stations: [], colors: { global: {}, byLocation: {} }, companies: ['NHS'] };
  _state = s;
  return s;
}
function saveState(s) { _state = s; writeJSON(STATE_PATH, s); }

// deterministic fallback color
function hashColor(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

/**
 * Convert the first worksheet to an array of objects using row 1 as headers.
 * Keeps exact header text (e.g., "Section – Field"), trims whitespace, and
 * stores displayed text for each cell (cell.text).
 */
function sheetToObjects(worksheet) {
  const headerRow = worksheet.getRow(1);
  const maxCol   = worksheet.actualColumnCount || worksheet.columnCount || headerRow.cellCount || 0;
  const lastRow  = worksheet.actualRowCount   || worksheet.rowCount    || 1;

  // headers: [ "Station ID", "Category", ... , "Section – Field", ... ]
  const headers = [];
  for (let c = 1; c <= maxCol; c++) {
    const key = String(headerRow.getCell(c)?.text ?? '').trim();
    headers.push(key);
  }

  const out = [];
  for (let r = 2; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const obj = {};
    let hasValue = false;

    for (let c = 1; c <= maxCol; c++) {
      const key = headers[c - 1];
      if (!key) continue;
      const val = row.getCell(c)?.text ?? '';
      if (val !== '') hasValue = true;
      obj[key] = val;
    }

    if (hasValue) out.push(obj);
  }
  return out;
}

// ─── Public API ────────────────────────────────────────────────────────────
// When opts.skipColors === true, we avoid touching lookups/excel and
// synthesize colors deterministically for a *much faster* first paint.
async function getStationData(opts = {}) {
  const skipColors = !!opts.skipColors;
  const s = loadState();
  const rows = s.stations || [];
  const out = new Array(rows.length);

  // Resolve colors in ONE pass from cache (warm if needed)
  let globalMap = null, byLoc = null;
  if (!skipColors) {
    try {
      const maps = await lookupsRepo.getColorMaps();
      globalMap = maps.global;
      byLoc     = maps.byLocation;
    } catch(_) {}
  }

  for (let i = 0; i < rows.length; i++) {
    const st = rows[i];
    const loc = st.province || st.location || '';
    const at  = st.asset_type || 'Unknown';
    let color = null;
    if (skipColors) {
      color = hashColor(`${loc}:${at}`);
    } else if (globalMap && byLoc) {
      const m = byLoc.get(loc);
      color = (m && m.get(at)) || globalMap.get(at) || null;
    } else {
      // Fallback (should rarely happen)
      try {
        color = await lookupsRepo.getAssetTypeColorForLocation(at, loc)
              || await lookupsRepo.getAssetTypeColor(at);
      } catch(_) {}
    }
    out[i] = { ...st, color: color || hashColor(`${loc}:${at}`) };
  }
  return out;
}

async function getActiveCompanies() {
  // Excel lookups are the source of truth; fall back to legacy only if empty.
  try {
    const fromXlsx = await lookupsRepo.getActiveCompanies();
    if (fromXlsx && fromXlsx.length) return fromXlsx;
  } catch (e) {
    console.error('[lookups] getActiveCompanies failed:', e);
  }
  const s = loadState();
  return (s.companies && s.companies.length) ? s.companies : ['NHS'];
}

async function getLocationsForCompany(_company) {
  try {
    const fromXlsx = await lookupsRepo.getLocationsForCompany(_company);
    if (fromXlsx && fromXlsx.length) return fromXlsx;
  } catch (e) {
    console.error('[lookups] getLocationsForCompany failed:', e);
  }
  // Legacy fallback: infer from station data (unscoped by company)
  const s = loadState();
  const locs = new Set();
  (s.stations || []).forEach(st => { if (st.province) locs.add(st.province); });
  return Array.from(locs).sort((a,b) => a.localeCompare(b));
}

async function getAssetTypesForLocation(_company, loc) {
  try {
    const fromXlsx = await lookupsRepo.getAssetTypesForLocation(loc);
    if (fromXlsx && fromXlsx.length) return fromXlsx;
  } catch (e) {
    console.error('[lookups] getAssetTypesForLocation failed:', e);
  }
  // Legacy fallback: infer from station data
  const s = loadState();
  const ats = new Set();
  (s.stations || []).forEach(st => {
    if ((st.province || st.location) === loc && st.asset_type) ats.add(st.asset_type);
  });
  return Array.from(ats).sort((a,b) => a.localeCompare(b));
}

// Colors (global)
async function getAssetTypeColor(assetType) {
  try {
    return await lookupsRepo.getAssetTypeColor(assetType);
  } catch(_) { return null; }
}
async function setAssetTypeColor(assetType, color) {
  return await lookupsRepo.setAssetTypeColor(assetType, color);
}

// Colors (per location)
async function getAssetTypeColorForLocation(assetType, loc) {
  return await lookupsRepo.getAssetTypeColorForLocation(assetType, loc);
}
async function setAssetTypeColorForLocation(assetType, loc, color) {
  return await lookupsRepo.setAssetTypeColorForLocation(assetType, loc, color);
}

/**
 * Import: base64 .xlsx → merge empty fields, add new if missing.
 * Uses exceljs. Reads FIRST worksheet, row 1 = headers.
 * Recognizes: Station ID, Category, Site Name, Province, Latitude, Longitude, Status
 * plus any "Section – Field" columns (kept verbatim).
 */
async function importMultipleStations(b64) {
  try {
    if (!ExcelJS) ExcelJS = require('exceljs');
    const buf = Buffer.from(b64, 'base64');
    const wb  = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const ws = wb.worksheets[0];
    if (!ws) return { success: false, message: 'No sheets found.' };

    const rows = sheetToObjects(ws);
    const s = loadState();
    const byId = new Map((s.stations || []).map(st => [String(st.station_id), st]));

    let added = 0, merged = 0;

    for (const r of rows) {
      const id = String(r['Station ID'] ?? r['station_id'] ?? '').trim();
      if (!id) continue;

      const norm = {
        station_id: id,
        asset_type: r['Category'] ?? r['asset_type'] ?? '',
        name:       r['Site Name'] ?? r['name'] ?? '',
        province:   r['Province']  ?? r['province'] ?? '',
        lat:        r['Latitude']  ?? r['lat'] ?? '',
        lon:        r['Longitude'] ?? r['lon'] ?? '',
        status:     r['Status']    ?? r['status'] ?? '',
      };

      // include any "Section – Field" columns verbatim
      Object.keys(r).forEach(k => { if (k.includes(' – ')) norm[k] = r[k]; });

      const existing = byId.get(id);
      if (!existing) {
        s.stations.push(norm);
        byId.set(id, norm);
        added++;
      } else {
        let changed = 0;
        for (const [k, v] of Object.entries(norm)) {
          const cur = existing[k];
          const empty = cur === undefined || cur === null || String(cur) === '';
          if (empty && String(v) !== '') { existing[k] = v; changed++; }
        }
        if (changed) merged++;
      }
    }

    saveState(s);
    return { success: true, added, merged, total: rows.length };
  } catch (e) {
    console.error('[importMultipleStations] exceljs load/parse failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * List sheet names from a base64 .xlsx payload.
 * Renderer calls this to populate the Step 3 sheet selector.
 */
async function listExcelSheets(b64) {
  try {
    if (!ExcelJS) ExcelJS = require('exceljs');
    const buf = Buffer.from(b64, 'base64');
    const wb  = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheets = (wb.worksheets || []).map(ws => ws?.name || '').filter(Boolean);
    return { success: true, sheets };
  } catch (e) {
    console.error('[listExcelSheets] failed:', e);
    return { success: false, message: String(e) };
  }
}


module.exports = {
  getStationData,
  getActiveCompanies,
  getLocationsForCompany,
  getAssetTypesForLocation,
  getAssetTypeColor,
  setAssetTypeColor,
  getAssetTypeColorForLocation,
  setAssetTypeColorForLocation,
  importMultipleStations,
  listExcelSheets,
  upsertCompany: lookupsRepo.upsertCompany,
  upsertLocation: lookupsRepo.upsertLocation,
  upsertAssetType: lookupsRepo.upsertAssetType,
  getLookupTree: lookupsRepo.getLookupTree,
  // colors (lookups-backed)
  setAssetTypeColorForLocation,
  getAssetTypeColorForLocation,
  setAssetTypeColor,
  getAssetTypeColor,
  // misc
  invalidateStationCache: () => { _state = null; },
};
