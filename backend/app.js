// backend/app.js
const path = require('path');
const lookupsRepo = require('./lookups_repo');
const excel = require('./excel_worker_client');

// deterministic fallback color
function hashColor(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

// ─── Public API ────────────────────────────────────────────────────────────
async function getStationData(opts = {}) {
  const skipColors = !!opts.skipColors;
  // Always aggregate from location workbooks
  const agg = await excel.readStationsAggregate().catch(() => ({ success:false, rows: [] }));
  const rows = agg?.rows || [];
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
  return ['NHS'];
}

async function getLocationsForCompany(_company) {
  try {
    const fromXlsx = await lookupsRepo.getLocationsForCompany(_company);
    if (fromXlsx && fromXlsx.length) return fromXlsx;
  } catch (e) {
    console.error('[lookups] getLocationsForCompany failed:', e);
  }
  return []; // lookups workbook is source of truth; no state fallback
}

async function getAssetTypesForLocation(_company, loc) {
  try {
    const fromXlsx = await lookupsRepo.getAssetTypesForLocation(loc);
    if (fromXlsx && fromXlsx.length) return fromXlsx;
  } catch (e) {
    console.error('[lookups] getAssetTypesForLocation failed:', e);
  }
  return []; // lookups workbook is source of truth; no state fallback
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
    // Global import now routes data into <Province>.xlsx (or Location) files,
    // preserving two-row headers from the source sheet (first sheet).
    const sheets = await excel.listSheets(b64);
    if (!sheets?.success || !sheets.sheets?.length) {
      return { success:false, message:'No sheets to import.' };
    }
    const sheetName = sheets.sheets[0];
    const parsed = await excel.parseRowsFromSheet(b64, sheetName);
    if (!parsed?.success) return { success:false, message: parsed?.message || 'Parse failed.' };
    const rows = parsed.rows || [];
    const sections = parsed.sections || parsed.headers.map(()=>'');
    const headers  = parsed.headers  || Object.keys(rows[0] || {});

    // Group rows by Province (acts as "Location")
    const groups = new Map();
    for (const r of rows) {
      const province = String(r['Province'] ?? r['province'] ?? r['General Information – Province'] ?? '').trim();
      const key = province || 'Unknown';
      (groups.get(key) || groups.set(key, []).get(key)).push(r);
    }
    let total = 0;
    for (const [loc, rowsForLoc] of groups.entries()) {
      await excel.writeLocationRows(loc, sheetName, sections, headers, rowsForLoc);
      total += rowsForLoc.length;
    }
    return { success:true, added: total, merged: 0, total };
  } catch (e) {
    console.error('[importMultipleStations] exceljs load/parse failed:', e);
    return { success: false, message: String(e) };
  }
}

// Normalize one row into our station shape (same rules as importMultipleStations)
function normalizeRow(r) {
  const id = String(r['Station ID'] ?? r['station_id'] ?? '').trim();
  if (!id) return null;
  const out = {
    station_id: id,
    asset_type: r['Category'] ?? r['asset_type'] ?? '',
    name:       r['Site Name'] ?? r['name'] ?? '',
    province:   r['Province']  ?? r['province'] ?? '',
    lat:        r['Latitude']  ?? r['lat'] ?? '',
    lon:        r['Longitude'] ?? r['lon'] ?? '',
    status:     r['Status']    ?? r['status'] ?? '',
  };
  Object.keys(r).forEach(k => { if (k.includes(' – ')) out[k] = r[k]; });
  return out;
}

/**
 * Add a user-selected subset of rows to:
 *  1) data/locations/<location>.xlsx (sheetName, headers preserved)
 *  2) in-memory + app_state.json stations (pins appear)
 */
async function addStationsFromSelection(payload) {
  const { location, sheetName, sections, headers, rows } = payload || {};
  if (!Array.isArray(rows) || !rows.length) {
    return { success:false, message:'No rows selected.' };
  }
  // 1) Persist to the location workbook
  try {
    const secs = Array.isArray(sections) && sections.length === headers.length
      ? sections
      : (headers || []).map(()=>'');
    await excel.writeLocationRows(location, sheetName || 'Data', secs, headers || Object.keys(rows[0] || {}), rows);
  } catch (e) {
    console.error('[importSelection] writeLocationRows failed:', e);
    return { success:false, message:'Failed writing to location workbook.' };
  }

  // No state writes. The map view will re-read from files.
  const total = rows.length;
  return { success:true, added: total, merged: 0, total };
}

/**
 * List sheet names from a base64 .xlsx payload.
 * Renderer calls this to populate the Step 3 sheet selector.
 */
async function listExcelSheets(b64) {
  try { return await excel.listSheets(b64); }
  catch (e) { console.error('[listExcelSheets] failed:', e); return { success:false, message:String(e) }; }
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
  addStationsFromSelection,
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
  invalidateStationCache: () => { /* no-op; we read fresh from files */ },
};