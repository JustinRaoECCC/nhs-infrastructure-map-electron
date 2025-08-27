const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils/fs_utils');

let ExcelJS = null;

// ─── Paths ─────────────────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, '..', 'data');
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

// ─── Lightweight in-memory caches ──────────────────────────────────────────
// We cache everything needed for fast boot and rendering.
let _cache = {
  mtimeMs: -1,
  colorsGlobal: new Map(),         // Map<assetType, color>
  colorsByLoc: new Map(),          // Map<location, Map<assetType, color>>
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
      companies: _cache.companies,
      locsByCompany: _cache.locsByCompany,
      assetsByLocation: _cache.assetsByLocation,
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(json));
  } catch(_) {}
}

async function _primeAllCaches() {
  ensureDir(DATA_DIR);
  const stat = fs.existsSync(LOOKUPS_PATH) ? fs.statSync(LOOKUPS_PATH) : null;
  const mtimeMs = stat ? stat.mtimeMs : 0;
  if (_cache.mtimeMs === mtimeMs) return;          // memory fresh
  if (_loadJsonCache(mtimeMs)) return;             // disk cache fresh
  if (!ExcelJS) ExcelJS = require('exceljs');

  // (Re)build from workbook once
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(LOOKUPS_PATH)) {
    await wb.xlsx.readFile(LOOKUPS_PATH);
  } else {
    // ensure the file exists with canonical sheets
    await ensureLookupsReady();
    await wb.xlsx.readFile(LOOKUPS_PATH);
  }
  const wsA = getSheet(wb, 'AssetTypes');
  const wsC = getSheet(wb, 'Companies');
  const wsL = getSheet(wb, 'Locations');

  const global = new Map();
  const byLoc  = new Map();
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at  = normStr(row.getCell(1)?.text);
      const loc = normStr(row.getCell(2)?.text);
      const col = normStr(row.getCell(3)?.text);
      if (!at || !col) return;
      if (!loc) {
        if (!global.has(at)) global.set(at, col);
      } else {
        const m = byLoc.get(loc) || new Map();
        if (!m.has(at)) m.set(at, col);
        byLoc.set(loc, m);
      }
    });
  }
  // Companies
  const companies = [];
  if (wsC) {
    wsC.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const name = normStr(row.getCell(1)?.text);
      const active = toBool(row.getCell(2)?.text);
      if (name && active) companies.push(name);
    });
  }
  // Locations + assets relations
  const locsByCompany = {};
  const assetsByLocation = {};
  if (wsL) {
    wsL.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const loc = normStr(row.getCell(1)?.text);
      const comp= normStr(row.getCell(2)?.text);
      if (!loc || !comp) return;
      (locsByCompany[comp] ||= new Set()).add(loc);
    });
  }
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at  = normStr(row.getCell(1)?.text);
      const loc = normStr(row.getCell(2)?.text);
      if (!at || !loc) return;
      (assetsByLocation[loc] ||= new Set()).add(at);
    });
  }
  Object.keys(locsByCompany).forEach(k => {
    locsByCompany[k] = Array.from(locsByCompany[k]).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  });
  Object.keys(assetsByLocation).forEach(k => {
    assetsByLocation[k] = Array.from(assetsByLocation[k]).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  });

  _cache = {
    mtimeMs,
    colorsGlobal: global,
    colorsByLoc: byLoc,
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
  };
}

// ─── Ensure folders & workbook ─────────────────────────────────────────────
async function ensureLookupsReady() {
  if (!ExcelJS) ExcelJS = require('exceljs');
  ensureDir(DATA_DIR);
  ensureDir(LOCATIONS_DIR);
  ensureDir(REPAIRS_DIR);

  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(LOOKUPS_PATH)) {
    await wb.xlsx.readFile(LOOKUPS_PATH);
    // patch missing sheets/headers if needed
    const need = (name) => !wb.worksheets.some(ws => ws.name === name);
    let changed = false;
    if (need('Companies')) {
      const ws = wb.addWorksheet('Companies');
      ws.addRow(['company','active']);
      changed = true;
    }
    if (need('Locations')) {
      const ws = wb.addWorksheet('Locations');
      ws.addRow(['location','company']);
      changed = true;
    }
    if (need('AssetTypes')) {
      const ws = wb.addWorksheet('AssetTypes');
      ws.addRow(['asset_type','location','color']);
      changed = true;
    }
    if (need('Custom Weights')) {
      const ws = wb.addWorksheet('Custom Weights');
      ws.addRow(['weight','active']);
      changed = true;
    }
    if (need('Workplan Constants')) {
      const ws = wb.addWorksheet('Workplan Constants');
      ws.addRow(['Field','Value']);
      changed = true;
    }
    if (need('Algorithm Parameters')) {
      const ws = wb.addWorksheet('Algorithm Parameters');
      ws.addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']);
      changed = true;
    }
    if (need('Workplan Details')) {
      const ws = wb.addWorksheet('Workplan Details');
      ws.addRow(['Parameter','Value']);
      changed = true;
    }
    if (changed) await wb.xlsx.writeFile(LOOKUPS_PATH);
    return wb;
  }
  // Fresh file with all canonical sheets
  const companies = wb.addWorksheet('Companies');        companies.addRow(['company','active']);
  const locations = wb.addWorksheet('Locations');        locations.addRow(['location','company']);
  const assetTypes= wb.addWorksheet('AssetTypes');       assetTypes.addRow(['asset_type','location','color']);
  const custW     = wb.addWorksheet('Custom Weights');   custW.addRow(['weight','active']);
  const wpConst   = wb.addWorksheet('Workplan Constants'); wpConst.addRow(['Field','Value']);
  const algo      = wb.addWorksheet('Algorithm Parameters'); algo.addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']);
  const wpDet     = wb.addWorksheet('Workplan Details'); wpDet.addRow(['Parameter','Value']);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return wb;
}

function getSheet(wb, name) {
  return wb.getWorksheet(name) || wb.worksheets.find(ws => lc(ws.name) === lc(name));
}

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

async function setAssetTypeColor(assetType, color) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) return { success:false, message:'Missing AssetTypes sheet' };
  const tgtAt = lc(assetType);
  let updated = false;
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = normStr(row.getCell(2)?.text);
    if (at === tgtAt && !loc) {
      row.getCell(3).value = color;
      updated = true;
    }
  });
  if (!updated) {
    ws.addRow([normStr(assetType), '', color]);
  }
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  _invalidateAllCaches();
  return { success:true };
}

async function setAssetTypeColorForLocation(assetType, location, color) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) return { success:false, message:'Missing AssetTypes sheet' };
  const tgtAt = lc(assetType);
  const tgtLo = lc(location);
  let updated = false;
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    if (at === tgtAt && loc === tgtLo) {
      row.getCell(3).value = color;
      updated = true;
    }
  });
  if (!updated) {
    ws.addRow([normStr(assetType), normStr(location), color]);
  }
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  _invalidateAllCaches();
  return { success:true };
}

// ─── Writes / Upserts ─────────────────────────────────────────────────────
async function upsertCompany(name, active = true) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'Companies');
  const tgt = lc(name);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      row.getCell(2).value = active ? 'TRUE' : '';
      found = true;
    }
  });
  if (!found) ws.addRow([normStr(name), active ? 'TRUE' : '']);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

async function upsertLocation(location, company) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'Locations');
  const tgtLoc = lc(location);
  const tgtComp= lc(company);
  let exists = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    if (lc(row.getCell(1)?.text) === tgtLoc && lc(row.getCell(2)?.text) === tgtComp) {
      exists = true;
    }
  });
  if (!exists) ws.addRow([normStr(location), normStr(company)]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  // also create the locations workbook if missing
  const locPath = path.join(LOCATIONS_DIR, `${normStr(location)}.xlsx`);
  if (!fs.existsSync(locPath)) {
    const nb = new ExcelJS.Workbook();
    await nb.xlsx.writeFile(locPath);
  }
  return { success:true };
}

async function upsertAssetType(assetType, location) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'AssetTypes');
  const tgtAt  = lc(assetType);
  const tgtLoc = lc(location || '');

  // 1) If exact pair exists, no-op
  let match = null;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    if (at === tgtAt && loc === tgtLoc) match = row;
  });
  if (match) return { success:true, added:false };

  // 2) If there's a blank-parent row for this asset type, fill in the location
  let blank = null;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = normStr(row.getCell(2)?.text);
    if (at === tgtAt && !loc) blank = row;
  });
  if (blank) {
    blank.getCell(2).value = normStr(location || '');
    if (!normStr(blank.getCell(3)?.text)) blank.getCell(3).value = randHexColor();
    await wb.xlsx.writeFile(LOOKUPS_PATH);
    return { success:true, added:true };
  }

  // 3) Otherwise append a brand-new row with a random colour
  ws.addRow([normStr(assetType), normStr(location || ''), randHexColor()]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  _invalidateAllCaches();
  return { success:true, added:true };
}

module.exports = {
  // ensure/init
  ensureLookupsReady,
  primeAllCaches: _primeAllCaches,
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
  // writes
  upsertCompany,
  upsertLocation,
  upsertAssetType,
  setAssetTypeColor,
  setAssetTypeColorForLocation,
  // paths
  LOOKUPS_PATH,
  DATA_DIR, LOCATIONS_DIR, REPAIRS_DIR,
};