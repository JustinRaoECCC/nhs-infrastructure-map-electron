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

  _cache = {
    mtimeMs,
    colorsGlobal: global,
    colorsByLoc: byLoc,
    colorsByCompanyLoc: byCoLoc,
    companies: uniqSorted(companies),
    locsByCompany,
    assetsByLocation,
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
  // writes
  upsertCompany,
  upsertLocation,
  upsertAssetType,
  setAssetTypeColor,
  setAssetTypeColorForLocation,
  setAssetTypeColorForCompanyLocation,
  // paths
  LOOKUPS_PATH,
  DATA_DIR, LOCATIONS_DIR, REPAIRS_DIR,
};