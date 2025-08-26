const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils/fs_utils');

let ExcelJS = null;

// ─── Paths ─────────────────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, '..', 'data');
const LOOKUPS_PATH  = path.join(DATA_DIR, 'lookups.xlsx');
const LOCATIONS_DIR = path.join(DATA_DIR, 'locations');
const REPAIRS_DIR   = path.join(DATA_DIR, 'repairs');

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
    if (need('Companies')) {
      const ws = wb.addWorksheet('Companies');
      ws.addRow(['company','active']);
    }
    if (need('Locations')) {
      const ws = wb.addWorksheet('Locations');
      ws.addRow(['location','company']);
    }
    if (need('AssetTypes')) {
      const ws = wb.addWorksheet('AssetTypes');
      ws.addRow(['asset_type','location','color']);
    }
    if (need('Custom Weights')) {
      const ws = wb.addWorksheet('Custom Weights');
      ws.addRow(['weight','active']);
    }
    if (need('Workplan Constants')) {
      const ws = wb.addWorksheet('Workplan Constants');
      ws.addRow(['Field','Value']);
    }
    if (need('Algorithm Parameters')) {
      const ws = wb.addWorksheet('Algorithm Parameters');
      ws.addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']);
    }
    if (need('Workplan Details')) {
      const ws = wb.addWorksheet('Workplan Details');
      ws.addRow(['Parameter','Value']);
    }
    await wb.xlsx.writeFile(LOOKUPS_PATH);
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
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'Companies');
  if (!ws) return [];
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return; // header
    const name = normStr(row.getCell(1)?.text);
    const active = toBool(row.getCell(2)?.text);
    if (name && active) out.push(name);
  });
  return uniqSorted(out);
}

async function getLocationsForCompany(company) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'Locations');
  if (!ws) return [];
  const tgt = lc(company);
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const loc = normStr(row.getCell(1)?.text);
    const comp= lc(row.getCell(2)?.text);
    if (loc && comp === tgt) out.push(loc);
  });
  return uniqSorted(out);
}

async function getAssetTypesForLocation(location) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) return [];
  const tgt = lc(location);
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const at  = normStr(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    if (at && loc === tgt) out.push(at);
  });
  return uniqSorted(out);
}

// ─── Colors ────────────────────────────────────────────────────────────────
async function getAssetTypeColor(assetType) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) return null;
  const tgt = lc(assetType);
  let fallback = null;
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const at = lc(row.getCell(1)?.text);
    const loc= normStr(row.getCell(2)?.text);
    const col= normStr(row.getCell(3)?.text);
    if (at === tgt) {
      if (!loc && col) fallback = fallback || col; // global color candidate
    }
  });
  return fallback;
}

async function getAssetTypeColorForLocation(assetType, location) {
  const wb = await ensureLookupsReady();
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) return null;
  const tgtAt = lc(assetType);
  const tgtLoc= lc(location);
  let color = null;
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    const col = normStr(row.getCell(3)?.text);
    if (at === tgtAt && loc === tgtLoc && col) color = col;
  });
  return color;
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
  return { success:true, added:true };
}

module.exports = {
  // ensure/init
  ensureLookupsReady,
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