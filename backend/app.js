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
// ─── Public API ────────────────────────────────────────────────────────────
// backend/app.js
async function getStationData(opts = {}) {
  const skipColors = !!opts.skipColors;
  const agg = await excel.readStationsAggregate().catch(() => ({ success:false, rows: [] }));
  const rows = agg?.rows || [];
  const out = new Array(rows.length);

  const norm = s => String(s ?? '').trim().toLowerCase();

  // Build normalized color maps (case/space insensitive)
  let gMapN = null;           // Map<assetType_norm, color>
  let byLocN = null;          // Map<location_norm OR "company@@location"_norm, Map<assetType_norm, color>>
  // Also invert Locations→Company to know which company a given location belongs to.
  let companyForLoc = null;   // Map<location_norm, company_norm>

  if (!skipColors) {
    try {
      const maps = await lookupsRepo.getColorMaps();
      // tolerate plain objects coming over IPC
      const gSrc = maps?.global instanceof Map ? maps.global : new Map(Object.entries(maps?.global || {}));
      const lSrc = maps?.byLocation instanceof Map ? maps.byLocation : new Map(Object.entries(maps?.byLocation || {}));

      gMapN = new Map();
      for (const [at, col] of gSrc.entries()) gMapN.set(norm(at), col);

      byLocN = new Map();
      for (const [locKeyRaw, inner] of lSrc.entries()) {
        const innerMap = inner instanceof Map ? inner : new Map(Object.entries(inner || {}));
        const nInner = new Map();
        for (const [at, col] of innerMap.entries()) nInner.set(norm(at), col);
        byLocN.set(norm(locKeyRaw), nInner); // supports "BC" or "NHS@@BC"
      }

      // Invert locationsByCompany so we can try "company@@location" first
      const tree = await lookupsRepo.getLookupTree();
      const inv = new Map();
      Object.entries(tree?.locationsByCompany || {}).forEach(([company, locs]) => {
        const coN = norm(company);
        (locs || []).forEach(l => inv.set(norm(l), coN));
      });
      companyForLoc = inv;
    } catch (_) {}
  }

  for (let i = 0; i < rows.length; i++) {
    const st = rows[i];
    const locCandidates = [st.province, st.location, st.location_file].map(norm).filter(Boolean);
    const atRaw = st.asset_type || 'Unknown';
    const atKey = norm(atRaw);
    let color = null;

    if (skipColors || !gMapN || !byLocN) {
      color = hashColor(`${locCandidates[0] || ''}:${atRaw}`);
    } else {
      // 1) Company+Location override (if AssetTypes used "COMPANY@@LOCATION" as the location key)
      for (const L of locCandidates) {
        if (color) break;
        const co = companyForLoc?.get(L);
        if (!co) continue;
        const compKey = `${co}@@${L}`;
        const m = byLocN.get(compKey);
        if (m && m.has(atKey)) { color = m.get(atKey); break; }
      }
      // 2) Location-only override
      if (!color) {
        for (const L of locCandidates) {
          const m = byLocN.get(L);
          if (m && m.has(atKey)) { color = m.get(atKey); break; }
        }
      }
      // 3) Global color
      if (!color) color = gMapN.get(atKey) || null;
      // 4) Deterministic fallback
      if (!color) color = hashColor(`${locCandidates[0] || ''}:${atRaw}`);
    }

   out[i] = { ...st, color };
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
  const { location, sheetName, sections, headers, rows, assetType } = payload || {};
  if (!Array.isArray(rows) || !rows.length) {
    return { success:false, message:'No rows selected.' };
  }
  // 1) Prepare headers/rows: force Category = typed assetType
  try {
    const at = String(assetType || '').trim();
    // Build working headers/sections
    let hdrs = Array.isArray(headers) && headers.length ? headers.slice() : Object.keys(rows[0] || {});
    let secs = Array.isArray(sections) && sections.length === hdrs.length ? sections.slice() : hdrs.map(()=>'');
    // Ensure there is a "Category" field
    const idxCategory = hdrs.findIndex(h => String(h || '').trim().toLowerCase() === 'category');
    if (idxCategory === -1) {
      hdrs.push('Category');
      secs.push(''); // no section required; reader matches by field suffix anyway
    }
    // Stamp Category for every row (overrides any incoming Structure Type etc.)
    const rowsStamped = rows.map(r => ({ ...r, Category: at }));
    await excel.writeLocationRows(location, sheetName || 'Data', secs, hdrs, rowsStamped);
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