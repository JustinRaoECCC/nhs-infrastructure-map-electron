const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils/fs_utils');

const excel = require('./excel_worker_client');

// ─── Paths ─────────────────────────────────────────────────────────────────
const DATA_DIR      = process.env.NHS_DATA_DIR || path.join(__dirname, '..', 'data');
const LOOKUPS_PATH  = path.join(DATA_DIR, 'lookups.xlsx');
const LOCATIONS_DIR = path.join(DATA_DIR, 'locations');
const REPAIRS_DIR   = path.join(DATA_DIR, 'repairs');
const CACHE_PATH    = path.join(DATA_DIR, '.lookups_cache.json');

// ─── Helpers ───────────────────────────────────────────────────────────────
function normStr(v) { return String(v ?? '').trim(); }
function lc(v) { return normStr(v).toLowerCase(); }
function toBool(v) {
  const t = lc(v);
  return t === 'true' || t === '1' || t === 'yes' || t === 'y' || t === 't';
}
function uniqSorted(arr) {
  return Array.from(new Set(arr.map(normStr).filter(Boolean)))
    .sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
function randHexColor() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

// ─── FS-only, synchronous folder bootstrap (no ExcelJS) ───────────────────
function ensureDataFoldersSync() {
  try {
    ensureDir(DATA_DIR); ensureDir(LOCATIONS_DIR); ensureDir(REPAIRS_DIR);
  } catch (e) { /* swallow — better to not crash on first run */ }
}

// ─── Lightweight in-memory caches ──────────────────────────────────────────
// We cache everything needed for fast boot and rendering.
let _cache = {
  mtimeMs: -1,
  colorsGlobal: new Map(),         // Map<assetType, color>
  colorsByLoc: new Map(),          // Map<location, Map<assetType, color>>
  colorsByCompanyLoc: new Map(),   // Map<company, Map<location, Map<assetType, color>>>
  companies: [],
  locsByCompany: {},               // { [company]: string[] }
  assetsByLocation: {},            // { [location]: string[] }
  // NEW: status/repair settings
  statusColors: new Map(),         // Map<statusKey, color> (keys lowercased: inactive, mothballed, unknown)
  applyStatusColorsOnMap: false,
  repairColors: new Map(),         // reserved for future
  applyRepairColorsOnMap: false,
  // NEW: links
  locationLinks: new Map(),        // Map<company, Map<location, link>>
  assetTypeLinks: new Map(),       // Map<company, Map<location, Map<assetType, link>>>
};

function _invalidateAllCaches() { _cache.mtimeMs = -1; try { fs.unlinkSync(CACHE_PATH); } catch(_) {} }

function _loadJsonCache(mtimeMs) {
  try {
    if (!fs.existsSync(CACHE_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (raw.mtimeMs !== mtimeMs) return false;
    // hydrate Maps
    _cache = {
      mtimeMs,
      colorsGlobal: new Map(Object.entries(raw.colorsGlobal || {})),
      colorsByLoc: new Map(Object.entries(raw.colorsByLoc || {}).map(
        ([loc, obj]) => [loc, new Map(Object.entries(obj))]
      )),
      colorsByCompanyLoc: new Map(
        Object.entries(raw.colorsByCompanyLoc || {}).map(
          ([company, locObj]) => [
            company,
            new Map(Object.entries(locObj).map(
              ([loc, obj]) => [loc, new Map(Object.entries(obj))]
            ))
          ]
        )
      ),
      companies: raw.companies || [],
      locsByCompany: raw.locsByCompany || {},
      assetsByLocation: raw.assetsByLocation || {},
      assetsByLocation: raw.assetsByLocation || {},
      // NEW
      statusColors: new Map(Object.entries(raw.statusColors || {})),
      applyStatusColorsOnMap: !!raw.applyStatusColorsOnMap,
      repairColors: new Map(Object.entries(raw.repairColors || {})),
      applyRepairColorsOnMap: !!raw.applyRepairColorsOnMap,
      // NEW: links
      locationLinks: new Map(
        Object.entries(raw.locationLinks || {}).map(
          ([co, locObj]) => [co, new Map(Object.entries(locObj))]
        )
      ),
      assetTypeLinks: new Map(
        Object.entries(raw.assetTypeLinks || {}).map(
          ([co, locObj]) => [
            co,
            new Map(Object.entries(locObj).map(
              ([loc, atObj]) => [loc, new Map(Object.entries(atObj))]
            ))
          ]
        )
      ),
    };
    return true;
  } catch(_) { return false; }
}

function _saveJsonCache() {
  try {
    const json = {
      mtimeMs: _cache.mtimeMs,
      colorsGlobal: Object.fromEntries(_cache.colorsGlobal),
      colorsByLoc: Object.fromEntries(
        Array.from(_cache.colorsByLoc.entries()).map(
          ([loc, m]) => [loc, Object.fromEntries(m)]
       )
      ),
      colorsByCompanyLoc: Object.fromEntries(
        Array.from(_cache.colorsByCompanyLoc.entries()).map(
          ([company, locMap]) => [
            company,
            Object.fromEntries(
              Array.from(locMap.entries()).map(
                ([loc, m]) => [loc, Object.fromEntries(m)]
              )
            )
          ]
        )
      ),
      companies: _cache.companies,
      locsByCompany: _cache.locsByCompany,
      assetsByLocation: _cache.assetsByLocation,
      // NEW
      statusColors: Object.fromEntries(_cache.statusColors),
      applyStatusColorsOnMap: _cache.applyStatusColorsOnMap,
      repairColors: Object.fromEntries(_cache.repairColors),
      applyRepairColorsOnMap: _cache.applyRepairColorsOnMap,
      // NEW: links
      locationLinks: Object.fromEntries(
        Array.from(_cache.locationLinks.entries()).map(
          ([co, m]) => [co, Object.fromEntries(m)]
        )
      ),
      assetTypeLinks: Object.fromEntries(
        Array.from(_cache.assetTypeLinks.entries()).map(
          ([co, locMap]) => [
            co,
            Object.fromEntries(
              Array.from(locMap.entries()).map(
                ([loc, atMap]) => [loc, Object.fromEntries(atMap)]
              )
            )
          ]
        )
      ),
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(json));
  } catch(_) {}
}

async function _primeAllCaches() {
  ensureDir(DATA_DIR);
  // Ask the worker for a snapshot (non-blocking for main thread)
  const snap = await excel.readLookupsSnapshot();
  const mtimeMs = snap?.mtimeMs || 0;
  if (_cache.mtimeMs === mtimeMs) return;

  const global = new Map(Object.entries(snap.colorsGlobal || {}));
  const byLoc  = new Map(
    Object.entries(snap.colorsByLoc || {}).map(([loc, obj]) => [loc, new Map(Object.entries(obj))])
  );
  const byCoLoc = new Map(
    Object.entries(snap.colorsByCompanyLoc || {}).map(([co, locObj]) => {
      return [co, new Map(Object.entries(locObj).map(([loc, obj]) => [loc, new Map(Object.entries(obj))]))];
    })
  );

  // Companies
  const companies = snap.companies || [];

  // Locations + assets relations
  const locsByCompany = snap.locsByCompany || {};
  const assetsByLocation = snap.assetsByLocation || {};

  // NEW: status/repair settings from snapshot
  const statusColors = new Map(Object.entries(snap.statusColors || {}));
  const applyStatusColorsOnMap = !!snap.applyStatusColorsOnMap;
  const applyRepairColorsOnMap = !!snap.applyRepairColorsOnMap;

  // NEW: hydrate link maps from snapshot
  const locLinks = new Map(
    Object.entries(snap.locationLinks || {}).map(
      ([co, obj]) => [co, new Map(Object.entries(obj))]
    )
  );
  const atLinks = new Map(
    Object.entries(snap.assetTypeLinks || {}).map(
      ([co, locObj]) => [
        co,
        new Map(Object.entries(locObj).map(
          ([loc, atObj]) => [loc, new Map(Object.entries(atObj))]
        ))
      ]
    )
  );

  _cache = {
    mtimeMs,
    colorsGlobal: global,
    colorsByLoc: byLoc,
    colorsByCompanyLoc: byCoLoc,
    companies: uniqSorted(companies),
    locsByCompany,
    assetsByLocation,
    // NEW
    statusColors,
    applyStatusColorsOnMap,
    repairColors: new Map(), // future
    applyRepairColorsOnMap,
    // NEW: links
    locationLinks: locLinks,
    assetTypeLinks: atLinks,
  };
  _saveJsonCache()
}

// Public: fast one-pass accessors for the app to use when rendering
async function getColorMaps() {
  await _primeAllCaches();
  return {
    global: _cache.colorsGlobal,
    byLocation: _cache.colorsByLoc,
    byCompanyLocation: _cache.colorsByCompanyLoc,
  };
}

// ─── Ensure folders & workbook ─────────────────────────────────────────────
async function ensureLookupsReady() { return excel.ensureLookupsReady(); }


// ─── Public read APIs ──────────────────────────────────────────────────────
async function getActiveCompanies() {
  await _primeAllCaches();
  return _cache.companies;
}

async function getLocationsForCompany(company) {
  await _primeAllCaches();
  const arr = _cache.locsByCompany[normStr(company)] || [];
  return Array.from(arr);
}

async function getAssetTypesForLocation(location) {
  await _primeAllCaches();
  const arr = _cache.assetsByLocation[normStr(location)] || [];
  return Array.from(arr);
}

// ─── Colors ────────────────────────────────────────────────────────────────
async function getAssetTypeColor(assetType) {
  await _primeAllCaches();
  const col = _cache.colorsGlobal.get(normStr(assetType));
  return col || null;
}

async function getAssetTypeColorForLocation(assetType, location) {
  await _primeAllCaches();
  const map = _cache.colorsByLoc.get(normStr(location));
  if (!map) return null;
  const col = map.get(normStr(assetType));
  return col || null;
}

async function getAssetTypeColorForCompanyLocation(assetType, company, location) {
  await _primeAllCaches();
  const co = normStr(company);
  const loc = normStr(location);
  const at = normStr(assetType);
  const coMap = _cache.colorsByCompanyLoc.get(co);
  if (!coMap) return null;
  const locMap = coMap.get(loc);
  if (!locMap) return null;
  return locMap.get(at) || null;
}

async function setAssetTypeColor(assetType, color) {
  const res = await excel.setAssetTypeColor(assetType, color);
  _invalidateAllCaches();
  return res;
}

async function setAssetTypeColorForLocation(assetType, location, color) {
  const res = await excel.setAssetTypeColorForLocation(assetType, location, color);
  _invalidateAllCaches();
  return res;
}

async function setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
  const res = await excel.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
  _invalidateAllCaches();
  return res;
}

// ─── Writes / Upserts ─────────────────────────────────────────────────────
async function upsertCompany(name, active = true) {
  const res = await excel.upsertCompany(name, active);
  _invalidateAllCaches();
  return res;
}

async function upsertLocation(location, company) {
  const res = await excel.upsertLocation(location, company);
  _invalidateAllCaches();
  return res;
}

async function upsertAssetType(assetType, location) {
  const res = await excel.upsertAssetType(assetType, location);
  _invalidateAllCaches();
  return res;
}

// ─── Links / Photos Base Resolver ─────────────────────────────────────────
async function getPhotosBase({ company, location, assetType } = {}) {
  await _primeAllCaches();
  const co  = normStr(company);
  const loc = normStr(location);
  const at  = normStr(assetType);

  // 1) AssetTypes.link (company+location+assetType)
  if (co && loc && at) {
    const locMap = _cache.assetTypeLinks.get(co);
    const atMap = locMap && locMap.get(loc);
    const link = atMap && atMap.get(at);
    if (link) return link;
  }

  // 2) Locations.link (company+location)
  if (co && loc) {
    const locMap = _cache.locationLinks.get(co);
    const link = locMap && locMap.get(loc);
    if (link) return link;
  }

  // 3) nothing
  return null;
}

// ─── Link Writers ─────────────────────────────────────────────────────────
async function setLocationLink(company, location, link) {
  const res = await excel.setLocationLink(company, location, link || '');
  _invalidateAllCaches();
  return res;
}

async function setAssetTypeLink(assetType, company, location, link) {
  const res = await excel.setAssetTypeLink(assetType, company, location, link || '');
  _invalidateAllCaches();
  return res;
}

// ─── NEW: Status/Repair settings APIs ──────────────────────────────────────
async function getStatusAndRepairSettings() {
  await _primeAllCaches();
  return {
    statusColors: Object.fromEntries(_cache.statusColors),
    applyStatusColorsOnMap: _cache.applyStatusColorsOnMap,
    repairColors: Object.fromEntries(_cache.repairColors),
    applyRepairColorsOnMap: _cache.applyRepairColorsOnMap
  };
}

async function setStatusColor(statusKey, color) {
  const res = await excel.setStatusColor(statusKey, color);
  _invalidateAllCaches();
  return res;
}

async function setApplyStatusColors(flag) {
  const res = await excel.setSettingBoolean('applyStatusColorsOnMap', !!flag);
  _invalidateAllCaches();
  return res;
}

async function setApplyRepairColors(flag) {
  const res = await excel.setSettingBoolean('applyRepairColorsOnMap', !!flag);
  _invalidateAllCaches();
  return res;
}

async function deleteStatus(statusKey) {
  const res = await excel.deleteStatusRow(statusKey);
  _invalidateAllCaches();
  return res;
}

module.exports = {
  // ensure/init
  ensureLookupsReady,
  primeAllCaches: _primeAllCaches,
  ensureDataFoldersSync,
  getColorMaps,
  async getLookupTree() {
    await _primeAllCaches();
    return {
      companies: _cache.companies,
      locationsByCompany: _cache.locsByCompany,
      assetsByLocation: _cache.assetsByLocation,
    };
  },
  // reads
  getActiveCompanies,
  getLocationsForCompany,
  getAssetTypesForLocation,
  getAssetTypeColor,
  getAssetTypeColorForLocation,
  getAssetTypeColorForCompanyLocation,
  // NEW: links
  getPhotosBase,
  setLocationLink,
  setAssetTypeLink,
  // writes
  upsertCompany,
  upsertLocation,
  upsertAssetType,
  setAssetTypeColor,
  setAssetTypeColorForLocation,
  setAssetTypeColorForCompanyLocation,
  // NEW: status/repair settings
  getStatusAndRepairSettings,
  setStatusColor,
  setApplyStatusColors,
  setApplyRepairColors,
  deleteStatus,
  // paths
  LOOKUPS_PATH,
  DATA_DIR, LOCATIONS_DIR, REPAIRS_DIR,
};