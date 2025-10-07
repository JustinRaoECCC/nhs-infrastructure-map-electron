// backend/app.js
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');
const path = require('path');

const config = require('./config'); // <— changed
const lookupsRepo = require('./lookups_repo');
const excel = require('./excel_worker_client');

const IMAGE_EXTS = config.IMAGE_EXTS;


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
    } catch (e) {
      console.error('[DEBUG] Error building color maps:', e);
    }
  }

  // NEW: load status override settings once (used to optionally override color)
  let applyStatus = false;
  let statusColors = new Map();
  try {
    const sr = await lookupsRepo.getStatusAndRepairSettings();
    applyStatus = !!sr.applyStatusColorsOnMap;
    statusColors = new Map(Object.entries(sr.statusColors || {})); // keys expected lower-cased
  } catch (e) {
    console.warn('[colors] failed to read status settings:', e?.message || e);
  }

  // Continue with the rest of the function...
  for (let i = 0; i < rows.length; i++) {
    const st = rows[i];
    const co = norm(st.company); // Use station's company directly!
    const L = normLoc(st.location_file || st.location || st.province);
    const atRaw = st.asset_type || 'Unknown';
    const atKey = norm(atRaw);

    let color = null;
    if (!skipColors) {
      if (co && L && byCoLocN.has(co)) {
        const locMap = byCoLocN.get(co);
        const m = locMap && locMap.get(L);
        if (m && m.has(atKey)) {
          color = m.get(atKey);
        }
      }
    }
    out[i] = { ...st, color };

    // NEW: Status overrides (only for non-Active). If enabled, override computed color.
    // Supported keys: 'inactive', 'mothballed', 'unknown'. Keys matched case-insensitively.
    if (!skipColors && applyStatus) {
      const s = norm(st.status || '');
      if (s && s !== 'active') {
        const override = statusColors.get(s);
        if (override) color = override;
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

async function getAssetTypesForLocation(company, loc) {
  try {
    const fromXlsx = await lookupsRepo.getAssetTypesForCompanyLocation(company, loc);
    if (fromXlsx && fromXlsx.length) return fromXlsx;
  } catch (e) {
    console.error('[lookups] getAssetTypesForCompanyLocation failed:', e);
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


// Normalize one row into our station shape
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
  const { company, location, sheetName, sections, headers, rows, assetType } = payload || {};
  if (!Array.isArray(rows) || !rows.length) {
    return { success:false, message:'No rows selected.' };
  }
  if (!company) return { success:false, message:'Company is required.' };
  
  // 0) Make sure the location exists (creates workbook too)
  try {
    if (company) await lookupsRepo.upsertCompany(company, true);
    if (location && company && lookupsRepo?.upsertLocation) {
      await lookupsRepo.upsertLocation(location, company);
    }
    await lookupsRepo.upsertAssetType(assetType, company, location);
  } catch (e) {
    console.warn('[importSelection] upsertLocation failed (continuing):', e?.message || e);
  }

  // 1) First, import the data AS-IS without any schema changes
  try {
    const at = String(assetType || '').trim();
    
    // Build working headers/sections
    let hdrs = Array.isArray(headers) && headers.length ? headers.slice() : Object.keys(rows[0] || {});
    let secs = Array.isArray(sections) && sections.length === hdrs.length ? sections.slice() : hdrs.map(()=>'');

    // Ensure "Category" exists
    const hLower = hdrs.map(h => String(h || '').trim().toLowerCase());
    if (!hLower.includes('category')) {
      hdrs.push('Category');
      secs.push('General Information'); // Put Category under General Information
      hLower.push('category');
    }

    // Ensure a Province/Location field exists
    const hasProvince = hLower.includes('province');
    const hasLocation = hLower.includes('location');
    const locFieldName = hasProvince ? 'Province' : (hasLocation ? 'Location' : 'Province');
    if (!hasProvince && !hasLocation) {
      hdrs.push(locFieldName);
      secs.push('General Information'); // Put Province under General Information
    }

    // Stamp Category and default Province/Location value when blank
    const rowsStamped = rows.map(r => {
      const out = { ...r, Category: at };
      const cur = (r['Province'] ?? r['province'] ?? r['Location'] ?? r['location'] ?? '').toString().trim();
      if (!cur && location) out[locFieldName] = location;
      return out;
    });

    // Write to Excel using the proper sheet naming convention
    const targetSheetName = `${at} ${location}`; // e.g., "Cableway AB"
    await excel.writeLocationRows(company, location, targetSheetName, secs, hdrs, rowsStamped);
    
    console.log(`[importSelection] Successfully imported ${rowsStamped.length} rows to ${targetSheetName}`);
    
  } catch (e) {
    console.error('[importSelection] writeLocationRows failed:', e);
    return { success:false, message:'Failed writing to location workbook.' };
  }

  // 2) AFTER successful import, check if we need to sync schema
  try {
    const schemaSync = require('./schema_sync');
    
    // Check if there are existing stations of this asset type
    const existingSchema = await schemaSync.getExistingSchemaForAssetType(assetType);
    
    if (existingSchema && existingSchema.sections && existingSchema.sections.length > 0) {
      console.log(`[importSelection] Found existing schema for ${assetType} in other locations, syncing...`);
      
      // Get all station IDs we just imported (to exclude them from getting their data overwritten)
      const importedStationIds = rows.map(r => 
        r['Station ID'] || r['station_id'] || r['StationID'] || r['ID'] || ''
      ).filter(Boolean);
      
      // Apply the existing schema to the newly imported stations
      const syncResult = await schemaSync.syncNewlyImportedStations(
        assetType, 
        company, location, 
        existingSchema,
        importedStationIds
      );
      
      if (syncResult.success) {
        console.log(`[importSelection] Schema sync completed: ${syncResult.message}`);
      } else {
        console.warn(`[importSelection] Schema sync failed: ${syncResult.message}`);
      }
    } else {
      console.log(`[importSelection] No existing schema found for ${assetType}, using imported structure as-is`);
    }
    
  } catch (schemaError) {
    // Don't fail the whole import if schema sync fails
    console.error('[importSelection] Schema sync error (import succeeded):', schemaError);
  }

  const total = rows.length;
  return { success:true, added: total, merged: 0, total };
}

/**
 * Manually add a single asset instance without Excel import.
 * payload: {
 *   company, location, assetType,
 *   general: { stationId, siteName, lat, lon, status },
 *   extras: [ { section, field, value }, ... ]
 * }
 */
async function manualAddInstance(payload = {}) {
  try {
    const company   = String(payload.company || '').trim();
    const location  = String(payload.location || '').trim();
    const assetType = String(payload.assetType || '').trim();
    const gi        = payload.general || {};
    const extras    = Array.isArray(payload.extras) ? payload.extras : [];

    if (!location || !assetType) {
      return { success:false, message:'Location and Asset Type are required.' };
    }
    const sid = String(gi.stationId || '').trim();
    const name= String(gi.siteName  || '').trim();
    const lat = String(gi.lat       || '').trim();
    const lon = String(gi.lon       || '').trim();
    const status = String(gi.status || 'UNKNOWN').trim();
    if (!sid || !name || !lat || !lon) {
      return { success:false, message:'Station ID, Site Name, Latitude, and Longitude are required.' };
    }
    if (isNaN(Number(lat)) || isNaN(Number(lon))) {
      return { success:false, message:'Latitude and Longitude must be numeric.' };
    }

    // Ensure lookup rows exist
    try {
      if (company) await lookupsRepo.upsertCompany(company, true);
      if (location && company) await lookupsRepo.upsertLocation(location, company);
      await lookupsRepo.upsertAssetType(assetType, company, location);
    } catch (e) {
      // non-fatal
      console.warn('[manualAddInstance] upserts (lookups) failed:', e?.message || e);
    }

    // Build minimal two-row header set (GI anchors + extras)
    const giFields = ['Station ID','Category','Site Name','Province','Latitude','Longitude','Status'];
    const headers = giFields.slice();
    const sections = giFields.map(() => 'General Information');
    for (const x of extras) {
      const sec = String(x.section || '').trim();
      const fld = String(x.field || '').trim();
      if (!sec || !fld) continue; // enforce required sec/field
      headers.push(fld);
      sections.push(sec);
    }

    // Compose single row
    const row = {
      'Station ID': sid,
      'Category': assetType,                 // Category comes from selected asset type
      'Site Name': name,
      'Province': location,                  // Province comes from chosen location
      'Latitude': lat,
      'Longitude': lon,
      'Status': status
    };
    for (const x of extras) {
      const sec = String(x.section || '').trim();
      const fld = String(x.field || '').trim();
      const val = (x.value ?? '');
      if (!sec || !fld) continue;
      row[`${sec} – ${fld}`] = val;
      row[fld] = val;
    }

    const sheetName = `${assetType} ${location}`;
    await excel.writeLocationRows(company, location, sheetName, sections, headers, [row]);
    return { success:true, added:1, sheet: sheetName };
  } catch (e) {
    console.error('[manualAddInstance] failed:', e);
    return { success:false, message:String(e) };
  }
}

/**
 * List sheet names from a base64 .xlsx payload.
 * Renderer calls this to populate the Step 3 sheet selector.
 */
async function listExcelSheets(b64) {
  try { return await excel.listSheets(b64); }
  catch (e) { console.error('[listExcelSheets] failed:', e); return { success:false, message:String(e) }; }
}

// Build "SITE_NAME_STATIONID" folder name from row
function folderNameFor(siteName, stationId) {
  const site = String(siteName ?? '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  const id = String(stationId ?? '').toUpperCase();
  return `${site}_${id}`;
}

/**
 * Safely join paths, preserving UNC path format
 */
function safePathJoin(basePath, ...segments) {
  // Check if it's a UNC path
  if (basePath.startsWith('\\\\')) {
    // For UNC paths, manually concatenate to preserve the \\\\ prefix
    let result = basePath;
    
    for (const segment of segments) {
      if (segment) {
        // Ensure there's exactly one backslash separator
        if (!result.endsWith('\\')) {
          result += '\\';
        }
        // Clean the segment of leading/trailing backslashes
        const cleanSegment = segment.replace(/^\\+|\\+$/g, '');
        result += cleanSegment;
      }
    }
    
    return result;
  } else {
    // Regular path.join for non-UNC paths
    return path.join(basePath, ...segments);
  }
}

/**
 * Resolve PHOTOS_BASE (dynamic) and pick exactly ONE station directory:
 * 1) Prefer the canonical exact folder: PHOTOS_BASE / SITE_STATIONID
 * 2) Else, first top-level directory whose name CONTAINS STATIONID (case-insensitive)
 */
async function resolvePhotosBaseAndStationDir(siteName, stationId) {
  try {
    // Derive {assetType, location} from station rows
    let assetType = '';
    let location  = '';
    let company   = '';
    
    try {
      const all = await getStationData({ skipColors: true });
      const st = all.find(
        s => String(s.station_id).trim().toLowerCase() === String(stationId).trim().toLowerCase()
      );
      if (st) {
        assetType = String(st.asset_type || '').trim();
        const rawLocation = st.location_file || st.location || st.province;
        location = normLoc(rawLocation);
      }
    } catch (e) {
      console.error('[resolvePhotosBaseAndStationDir] Error getting station data:', e);
    }

    // Derive company from lookup tree
    try {
      if (location && !company) {
        const tree = await lookupsRepo.getLookupTree();
        for (const [co, locs] of Object.entries(tree?.locationsByCompany || {})) {
          if ((locs || []).some(x => normLoc(x) === location)) {
            company = co; 
            break;
          }
        }
      }
    } catch (e) {
      console.error('[resolvePhotosBaseAndStationDir] Error deriving company:', e);
    }

    console.log(`[DEBUG] resolvePhotosBaseAndStationDir: stationId=${stationId}, company=${company}, location=${location}, assetType=${assetType}`);

    const PHOTOS_BASE = await config.getPhotosBase({ company, location, assetType });
    console.log(`[DEBUG] getPhotosBase returned: ${PHOTOS_BASE}`);
    
    if (!PHOTOS_BASE) {
      console.warn(`[resolvePhotosBaseAndStationDir] No PHOTOS_BASE found for company=${company}, location=${location}, assetType=${assetType}`);
      return { PHOTOS_BASE: null, stationDir: null, canonicalDir: null };
    }

    const targetFolder = folderNameFor(siteName, stationId);
    
    // IMPORTANT: Keep UNC paths as-is with backslashes
    // Node.js on Windows handles UNC paths correctly when they maintain the \\\\ format
    let exactDir;
    if (PHOTOS_BASE.startsWith('\\\\')) {
      // For UNC paths, manually concatenate to preserve the format
      exactDir = PHOTOS_BASE.endsWith('\\') 
        ? PHOTOS_BASE + targetFolder
        : PHOTOS_BASE + '\\' + targetFolder;
    } else {
      // For regular paths, use path.join
      exactDir = path.join(PHOTOS_BASE, targetFolder);
    }

    console.log(`[DEBUG] Exact directory to check: ${exactDir}`);

    // 1) Exact canonical dir
    try {
      const st = await fsp.stat(exactDir);
      if (st.isDirectory()) {
        console.log(`[DEBUG] Found exact directory: ${exactDir}`);
        return { PHOTOS_BASE, stationDir: exactDir, canonicalDir: exactDir };
      }
    } catch (e) {
      console.log(`[DEBUG] Exact directory not found: ${exactDir}`);
      console.log(`[DEBUG] Error: ${e.message}`);
    }

    // 2) First dir whose name CONTAINS stationId (case-insensitive)
    const idUpper = String(stationId ?? '').toUpperCase();
    try {
      console.log(`[DEBUG] Attempting readdir on: ${PHOTOS_BASE}`);
      const entries = await fsp.readdir(PHOTOS_BASE, { withFileTypes: true });
      console.log(`[DEBUG] Found ${entries.length} entries in ${PHOTOS_BASE}`);
      
      for (const d of entries) {
        if (!d.isDirectory()) continue;
        if (d.name.toUpperCase().includes(idUpper)) {
          let full;
          if (PHOTOS_BASE.startsWith('\\\\')) {
            // For UNC paths, manually concatenate
            full = PHOTOS_BASE.endsWith('\\') 
              ? PHOTOS_BASE + d.name
              : PHOTOS_BASE + '\\' + d.name;
          } else {
            full = path.join(PHOTOS_BASE, d.name);
          }
          
          console.log(`[DEBUG] Found matching directory: ${full}`);
          return { PHOTOS_BASE, stationDir: full, canonicalDir: exactDir };
        }
      }
    } catch (e) {
      console.error(`[DEBUG] Error reading PHOTOS_BASE directory: ${e.message}`);
    }

    // Nothing found
    console.log(`[DEBUG] No station directory found for ${stationId}`);
    return { PHOTOS_BASE, stationDir: null, canonicalDir: exactDir };
  } catch (e) {
    console.error('[resolvePhotosBaseAndStationDir] failed:', e);
    return { PHOTOS_BASE: null, stationDir: null, canonicalDir: null };
  }
}

async function getRecentPhotos(siteName, stationId, limit = 5) {
  try {
    // Resolve base + ONE station dir using shared helper
    const { stationDir, canonicalDir: exactDir } =
      await resolvePhotosBaseAndStationDir(siteName, stationId);
    if (!stationDir) return [];

    const files = [];
    const seenDirs = new Set();

    async function collect(dir) {
      if (seenDirs.has(dir)) return;
      seenDirs.add(dir);
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const ent of entries) {
        const full = safePathJoin(dir, ent.name);
        if (ent.isDirectory()) {
          await collect(full);
        } else {
          const ext = path.extname(ent.name).toLowerCase();
          if (IMAGE_EXTS.includes(ext)) {
            try {
              const st = await fsp.stat(full);
              files.push({ path: full, name: ent.name, mtimeMs: st.mtimeMs });
            } catch {}
          }
        }
      }
    }

    // Only collect from the single selected station directory
    await collect(stationDir);

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files.slice(0, limit).map(f => ({
      url: pathToFileURL(f.path).href,
      name: f.name,
      mtimeMs: f.mtimeMs,
      path: f.path,
    }));
  } catch (e) {
    console.error('[getRecentPhotos] failed:', e);
    return [];
  }
}

/**
 * Update station data - saves changes back to the appropriate Excel file
 */
async function updateStationData(updatedStation, schema) {
  try {
    if (!updatedStation || !updatedStation.station_id) {
      return { success: false, message: 'Station ID is required' };
    }

    // Find the current station to determine which file it belongs to
    const allStations = await getStationData({ skipColors: true });
    const currentStation = allStations.find(s => 
      String(s.station_id) === String(updatedStation.station_id)
    );
    
    if (!currentStation) {
      return { success: false, message: 'Station not found' };
    }

    // Get company from station
    const company = String(currentStation.company || '').trim();
    if (!company) {
      console.warn('[updateStationData] Station missing company, attempting to derive...');
      // Could add lookup logic here if needed
      return { success: false, message: 'Could not determine company for station' };
    }

    // Determine the location file (Excel file to update)
    const locationFile = currentStation.location_file || 
                        updatedStation.province || 
                        currentStation.province || 
                        'Unknown';

    // Prepare the row data for Excel
    const rowData = prepareStationRowForExcel(updatedStation);
    
    // Update the station in the appropriate Excel file
    const result = await excel.updateStationInLocationFile(
      company, 
      locationFile, 
      updatedStation.station_id, 
      rowData,
      schema  // Pass schema to maintain column order
    );

    if (result.success) {
      // Invalidate caches to force refresh
      await invalidateStationCache();
      return { success: true, message: 'Station updated successfully' };
    } else {
      return { success: false, message: result.message || 'Update failed' };
    }

  } catch (error) {
    console.error('[updateStationData] failed:', error);
    return { success: false, message: String(error) };
  }
}

/**
 * Prepare station data for Excel format
 */
function prepareStationRowForExcel(station) {
  const rowData = {};

  // Map standard fields
  if (station.station_id !== undefined) rowData['Station ID'] = station.station_id;
  if (station.asset_type !== undefined) rowData['Category'] = station.asset_type;
  if (station.name !== undefined) rowData['Site Name'] = station.name;
  if (station.province !== undefined) rowData['Province'] = station.province;
  if (station.lat !== undefined) rowData['Latitude'] = station.lat;
  if (station.lon !== undefined) rowData['Longitude'] = station.lon;
  if (station.status !== undefined) rowData['Status'] = station.status;

  // Add all "Section – Field" data
  Object.keys(station).forEach(key => {
    if (key.includes(' – ')) {
      rowData[key] = station[key];
    }
  });

  return rowData;
}

/**
 * Append a repair entry using the new storage model:
 *   data/companies/<company>/<location>.xlsx with sheet "{AssetType} {Location} Repairs"
 * If the Station ID already exists in the sheet, the new row is inserted
 * right after the last existing row for that station.
 *
 * @param {Object} payload { company: string, location: string, assetType: string, repair: Object }
 */
async function appendRepair(payload = {}) {
  const company = String(payload.company || '').trim();
  const assetType = String(payload.assetType || '').trim();
  const location = String(payload.location || '').trim();
  const repair   = { ...(payload.repair || {}) };
  if (!company) {
    return { success:false, message:'company is required' };
  }
  if (!location) {
    return { success:false, message:'location is required' };
  }
  if (!assetType) {
    return { success:false, message:'assetType is required' };
  }
  // Defaults (worker also enforces these, but this helps callers immediately)
  if (repair.Date === undefined && repair.date === undefined) {
    repair.Date = new Date().toISOString().slice(0,10);
  }
  if (repair.Type === undefined && repair.type === undefined) {
    repair.Type = 'Repair';
  }
  return await excel.appendRepair(company, location, assetType, repair);
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
  listExcelSheets,
  addStationsFromSelection,
  manualAddInstance,
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
  // photos
  getRecentPhotos,
  resolvePhotosBaseAndStationDir,
  updateStationData,
  // repairs
  appendRepair,
  // algorithm/workplan & weights
  getAlgorithmParameters: () => excel.getAlgorithmParameters(),
  saveAlgorithmParameters: (rows) => excel.saveAlgorithmParameters(rows),
  getWorkplanConstants: () => excel.getWorkplanConstants(),
  saveWorkplanConstants: (rows) => excel.saveWorkplanConstants(rows),
  getCustomWeights: () => excel.getCustomWeights(),
  addCustomWeight: (w, a) => excel.addCustomWeight(w, !!a),

  // Fixed parameters (for Optimization I constraint filtering)
  getFixedParameters: () => excel.getFixedParameters(),
  saveFixedParameters: (params) => excel.saveFixedParameters(params),
};
