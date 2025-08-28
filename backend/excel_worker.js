// backend/excel_worker.js
// All ExcelJS I/O happens here, off the main thread.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
let ExcelJS; // lazy
function progress(stage, pct, msg) {
  try { parentPort.postMessage({ type: 'progress', stage, pct, msg }); } catch (_) {}
}
function getExcel() {
  if (ExcelJS) return ExcelJS;
  progress('exceljs', 10, 'Starting Excel worker…');
  ExcelJS = require('exceljs');
  progress('exceljs', 35, 'ExcelJS loaded');
  return ExcelJS;
}

// ─── Paths ────────────────────────────────────────────────────────────────
const DATA_DIR      = process.env.NHS_DATA_DIR || path.join(__dirname, '..', 'data');
const LOOKUPS_PATH  = path.join(DATA_DIR, 'lookups.xlsx');
const LOCATIONS_DIR = path.join(DATA_DIR, 'locations');
const REPAIRS_DIR   = path.join(DATA_DIR, 'repairs');
const SEED_PATH     = path.join(__dirname, 'templates', 'lookups.template.xlsx');

// ─── Helpers ──────────────────────────────────────────────────────────────
const ensureDir = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
const normStr = (v) => String(v ?? '').trim();
const lc = (v) => normStr(v).toLowerCase();
const toBool = (v) => ['true','1','yes','y','t'].includes(lc(v));
const uniqSorted = (arr) => Array.from(new Set(arr.map(normStr).filter(Boolean)))
  .sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
const getSheet = (wb, name) => wb.getWorksheet(name) || wb.worksheets.find(ws => lc(ws.name) === lc(name));

// ─── Ensure workbook exists with canonical sheets ─────────────────────────
async function ensureLookupsReady() {
  progress('ensure', 40, 'Ensuring data folders…');
  ensureDir(DATA_DIR); ensureDir(LOCATIONS_DIR); ensureDir(REPAIRS_DIR);
  // If missing, prefer copying the seed file (instant, no ExcelJS load).
  if (!fs.existsSync(LOOKUPS_PATH)) {
    if (fs.existsSync(SEED_PATH)) {
      progress('ensure', 45, 'Copying seed workbook…');
      fs.copyFileSync(SEED_PATH, LOOKUPS_PATH);
      progress('ensure', 55, 'Seed workbook copied');
      return true;
    }
  }
  // If the file exists (or no seed available), ensure required sheets.
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  if (fs.existsSync(LOOKUPS_PATH)) {
    progress('ensure', 55, 'Opening lookups.xlsx…');
    await wb.xlsx.readFile(LOOKUPS_PATH);
    progress('ensure', 65, 'Validating sheets…');
    const need = (n) => !wb.worksheets.some(ws => ws.name === n);
    let changed = false;
    if (need('Companies'))         { wb.addWorksheet('Companies').addRow(['company','active']); changed = true; }
    if (need('Locations'))         { wb.addWorksheet('Locations').addRow(['location','company']); changed = true; }
    if (need('AssetTypes'))        { wb.addWorksheet('AssetTypes').addRow(['asset_type','location','color']); changed = true; }
    if (need('Custom Weights'))    { wb.addWorksheet('Custom Weights').addRow(['weight','active']); changed = true; }
    if (need('Workplan Constants')){ wb.addWorksheet('Workplan Constants').addRow(['Field','Value']); changed = true; }
    if (need('Algorithm Parameters')) { wb.addWorksheet('Algorithm Parameters')
                                         .addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']); changed = true; }
    if (need('Workplan Details'))  { wb.addWorksheet('Workplan Details').addRow(['Parameter','Value']); changed = true; }
    if (changed) {
      progress('ensure', 75, 'Writing workbook changes…');
      await wb.xlsx.writeFile(LOOKUPS_PATH);
    }
    progress('ensure', 80, 'Workbook ready');
    return true;
  } else {
    progress('ensure', 55, 'Creating workbook…');
    wb.addWorksheet('Companies').addRow(['company','active']);
    wb.addWorksheet('Locations').addRow(['location','company']);
    wb.addWorksheet('AssetTypes').addRow(['asset_type','location','color']);
    wb.addWorksheet('Custom Weights').addRow(['weight','active']);
    wb.addWorksheet('Workplan Constants').addRow(['Field','Value']);
    wb.addWorksheet('Algorithm Parameters').addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']);
    wb.addWorksheet('Workplan Details').addRow(['Parameter','Value']);
    progress('ensure', 70, 'Saving new workbook…');
    await wb.xlsx.writeFile(LOOKUPS_PATH);
    progress('ensure', 80, 'Workbook ready');
    return true;
  }
}

// ─── Read snapshot for caches ─────────────────────────────────────────────
async function readLookupsSnapshot() {
  await ensureLookupsReady();
  progress('snapshot', 82, 'Reading lookups snapshot…');
  const stat = fs.statSync(LOOKUPS_PATH);
  const mtimeMs = stat ? stat.mtimeMs : 0;

  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  progress('snapshot', 88, 'Parsing sheets…');
  const wsA = getSheet(wb, 'AssetTypes');
  const wsC = getSheet(wb, 'Companies');
  const wsL = getSheet(wb, 'Locations');

  const colorsGlobal = {};            // { assetType: color }
  const colorsByLoc  = {};            // { location: { assetType: color } }
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at  = normStr(row.getCell(1)?.text);
      const loc = normStr(row.getCell(2)?.text);
      const col = normStr(row.getCell(3)?.text);
      if (!at || !col) return;
      if (!loc) {
        if (!colorsGlobal[at]) colorsGlobal[at] = col;
      } else {
        (colorsByLoc[loc] ||= {});
        if (!colorsByLoc[loc][at]) colorsByLoc[loc][at] = col;
      }
    });
  }

  const companies = [];
  if (wsC) {
    wsC.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const name = normStr(row.getCell(1)?.text);
      const active = toBool(row.getCell(2)?.text);
      if (name && active) companies.push(name);
    });
  }

  const locsByCompany = {};  // { company: [locations] }
  const assetsByLocation = {}; // { location: [assetTypes] }
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
  Object.keys(locsByCompany).forEach(k => { locsByCompany[k] = Array.from(locsByCompany[k]).sort((a,b)=>a.localeCompare(b)); });
  Object.keys(assetsByLocation).forEach(k => { assetsByLocation[k] = Array.from(assetsByLocation[k]).sort((a,b)=>a.localeCompare(b)); });

  const payload = { mtimeMs, colorsGlobal, colorsByLoc, companies: uniqSorted(companies), locsByCompany, assetsByLocation };
  progress('done', 100, 'Excel ready');
  return payload;
}

// ─── Writes ───────────────────────────────────────────────────────────────
function randHexColor() { return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0'); }

async function setAssetTypeColor(assetType, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) throw new Error('Missing AssetTypes sheet');
  const tgtAt = lc(assetType);
  let updated = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = normStr(row.getCell(2)?.text);
    if (at === tgtAt && !loc) { row.getCell(3).value = color; updated = true; }
  });
  if (!updated) ws.addRow([normStr(assetType), '', color]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

async function setAssetTypeColorForLocation(assetType, location, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) throw new Error('Missing AssetTypes sheet');
  const tgtAt = lc(assetType), tgtLo = lc(location);
  let updated = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    if (at === tgtAt && loc === tgtLo) { row.getCell(3).value = color; updated = true; }
  });
  if (!updated) ws.addRow([normStr(assetType), normStr(location), color]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

async function upsertCompany(name, active = true) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Companies');
  const tgt = lc(name);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) { row.getCell(2).value = active ? 'TRUE' : ''; found = true; }
  });
  if (!found) ws.addRow([normStr(name), active ? 'TRUE' : '']);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

async function upsertLocation(location, company) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Locations');
  const tgtLoc = lc(location), tgtComp = lc(company);
  let exists = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    if (lc(row.getCell(1)?.text) === tgtLoc && lc(row.getCell(2)?.text) === tgtComp) exists = true;
  });
  if (!exists) ws.addRow([normStr(location), normStr(company)]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  // create the location workbook if missing
  ensureDir(LOCATIONS_DIR);
  const locPath = path.join(LOCATIONS_DIR, `${normStr(location)}.xlsx`);
  if (!fs.existsSync(locPath)) {
    const nb = new ExcelJS.Workbook();
    await nb.xlsx.writeFile(locPath);
  }
  return { success: true };
}

async function upsertAssetType(assetType, location) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes');
  const tgtAt = lc(assetType), tgtLoc = lc(location || '');
  let match = null, blank = null;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    if (at === tgtAt && loc === tgtLoc) match = row;
    if (at === tgtAt && !normStr(row.getCell(2)?.text)) blank = row;
  });
  if (match) return { success:true, added:false };
  if (blank) {
    blank.getCell(2).value = normStr(location || '');
    if (!normStr(blank.getCell(3)?.text)) blank.getCell(3).value = randHexColor();
    await wb.xlsx.writeFile(LOOKUPS_PATH);
    return { success:true, added:true };
  }
  ws.addRow([normStr(assetType), normStr(location || ''), randHexColor()]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true, added:true };
}

// ─── Base64 helpers ───────────────────────────────────────────────────────
async function listSheets(b64) {
  const buf = Buffer.from(b64, 'base64');
  const wb  = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets = (wb.worksheets || []).map(ws => ws?.name || '').filter(Boolean);
  return { success: true, sheets };
}

function sheetToObjects(ws) {
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || ws.columnCount || headerRow.cellCount || 0;
  const lastRow = ws.actualRowCount || ws.rowCount || 1;
  const headers = [];
  for (let c = 1; c <= maxCol; c++) {
    headers.push(String(headerRow.getCell(c)?.text ?? '').trim());
  }
  const out = [];
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj = {}; let has = false;
    for (let c = 1; c <= maxCol; c++) {
      const key = headers[c - 1]; if (!key) continue;
      const val = row.getCell(c)?.text ?? '';
      if (val !== '') has = true;
      obj[key] = val;
    }
    if (has) out.push(obj);
  }
  return out;
}

async function parseRows(b64) {
  const buf = Buffer.from(b64, 'base64');
  const wb  = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return { success:false, message:'No sheets found.', rows: [] };
  const rows = sheetToObjects(ws);
  return { success:true, rows };
}

// ─── RPC shim ─────────────────────────────────────────────────────────────
const handlers = {
  ping: async () => 'pong',
  ensureLookupsReady,
  readLookupsSnapshot,
  setAssetTypeColor,
  setAssetTypeColorForLocation,
  upsertCompany,
  upsertLocation,
  upsertAssetType,
  listSheets,
  parseRows,
};

parentPort.on('message', async (msg) => {
  const { id, cmd, args = [] } = msg || {};
  try {
    const fn = handlers[cmd];
    if (!fn) throw new Error('Unknown command: ' + cmd);
    const result = await fn(...args);
    parentPort.postMessage({ id, ok: true, result });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
});