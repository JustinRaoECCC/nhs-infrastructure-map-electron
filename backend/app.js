// backend/app.js
const path = require('path');
const lookupsRepo = require('./lookups_repo');
const excel = require('./excel_worker_client');

// Normalize location consistently and strip ".xlsx"
function normLoc(s) {
  return String(s ?? '')
    .trim()
    .replace(/\.xlsx$/i, '')
    .toLowerCase();
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

  // Build normalized color maps (case-insensitive) — only company→location→assetType
  let byCoLocN = new Map();
  let companyByLocN = new Map();

  if (!skipColors) {
    try {
      const maps = await lookupsRepo.getColorMaps();
      
      // Add debug to see what we're getting
      console.log('[DEBUG] Raw maps from lookups:', {
        global: maps?.global,
        byLocation: maps?.byLocation,
        byCompanyLocation: maps?.byCompanyLocation
      });

      // Handle byCompanyLocation map
      if (maps?.byCompanyLocation) {
        const coLocSrc = maps.byCompanyLocation instanceof Map 
          ? maps.byCompanyLocation 
          : new Map(Object.entries(maps.byCompanyLocation || {}));
        
        for (const [company, locMapLike] of coLocSrc.entries()) {
          const companyNorm = norm(company);
          const locMap = locMapLike instanceof Map 
            ? locMapLike 
            : new Map(Object.entries(locMapLike || {}));
          
          const nLocMap = new Map();
          for (const [loc, innerLike] of locMap.entries()) {
            const locNorm = normLoc(loc);
            const inner = innerLike instanceof Map 
              ? innerLike 
              : new Map(Object.entries(innerLike || {}));
            
            const nInner = new Map();
            for (const [at, col] of inner.entries()) {
              nInner.set(norm(at), col);
            }
            nLocMap.set(locNorm, nInner);
          }
          byCoLocN.set(companyNorm, nLocMap);
        }
      }

      // Build location → company map from the lookup tree
      const tree = await lookupsRepo.getLookupTree();
      const lbc = tree?.locationsByCompany || {};
      
      for (const [company, locs] of Object.entries(lbc)) {
        const coN = norm(company);
        for (const loc of locs || []) {
          const L = normLoc(loc);  // Use normLoc consistently
          if (!companyByLocN.has(L)) {
            companyByLocN.set(L, coN);
          }
        }
      }
    } catch (e) {
      console.error('[DEBUG] Error building color maps:', e);
    }
  }

  // Continue with the rest of the function...
  for (let i = 0; i < rows.length; i++) {
    const st = rows[i];
    const L = normLoc(st.location_file || st.location || st.province);
    const atRaw = st.asset_type || 'Unknown';
    const atKey = norm(atRaw);

    let color = null;
    if (!skipColors) {
      const co = L ? companyByLocN.get(L) : null;
      
      // Debug only for first station
      if (i === 0) {
        console.log('[DEBUG] companyByLocN keys:', Array.from(companyByLocN.keys()));
        console.log('[DEBUG] byCoLocN keys:', Array.from(byCoLocN.keys()));
      }
      console.log(`[DEBUG] Station ${st.station_id}: L="${L}", co="${co}", atKey="${atKey}"`);
      
      if (co && byCoLocN.has(co)) {
        const locMap = byCoLocN.get(co);
        const m = locMap && locMap.get(L);
        if (m && m.has(atKey)) {
          color = m.get(atKey);
          console.log(`[DEBUG] Found color for ${st.station_id}: ${color}`);
        }
      }
    }
    out[i] = { ...st, color };
  }

  return out;
}

// Make invalidate meaningful: re-prime lookup caches
async function invalidateStationCache() {
  try { await lookupsRepo.primeAllCaches(); } catch (_) {}
  return { success: true };
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
 * Add a user-selected subset of rows to the chosen location workbook.
 * - Auto-creates the <location> under <company> if missing.
 * - Ensures a Province/Location column exists; fills blanks with the chosen location.
 * - Forces Category to the selected asset type.
 */
async function addStationsFromSelection(payload) {
  const { location, company, sheetName, sections, headers, rows, assetType } = payload || {};
  if (!Array.isArray(rows) || !rows.length) {
    return { success:false, message:'No rows selected.' };
  }
  // 0) Make sure the location exists (creates workbook too)
  try {
    if (location && company && lookupsRepo?.upsertLocation) {
      await lookupsRepo.upsertLocation(location, company);
    }
  } catch (e) {
    console.warn('[importSelection] upsertLocation failed (continuing):', e?.message || e);
  }

  // 1) Prepare headers/rows: ensure Category + Province/Location headers and values
  try {
    const at = String(assetType || '').trim();
    // Build working headers/sections
    let hdrs = Array.isArray(headers) && headers.length ? headers.slice() : Object.keys(rows[0] || {});
    let secs = Array.isArray(sections) && sections.length === hdrs.length ? sections.slice() : hdrs.map(()=>'');

    // Ensure "Category" exists
    const hLower = hdrs.map(h => String(h || '').trim().toLowerCase());
    if (!hLower.includes('category')) {
      hdrs.push('Category');
      secs.push('');
      hLower.push('category');
    }

    // Ensure a Province/Location field exists; prefer "Province"
    const hasProvince = hLower.includes('province');
    const hasLocation = hLower.includes('location');
    const locFieldName = hasProvince ? 'Province' : (hasLocation ? 'Location' : 'Province');
    if (!hasProvince && !hasLocation) {
      hdrs.push(locFieldName);
      secs.push('');
    }

    // Stamp Category and default Province/Location value when blank
    const rowsStamped = rows.map(r => {
      const out = { ...r, Category: at };
      const cur = (r['Province'] ?? r['province'] ?? r['Location'] ?? r['location'] ?? '').toString().trim();
      if (!cur && location) out[locFieldName] = location;
      return out;
    });

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
  invalidateStationCache,
};