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
const REPAIRS_SHEET = 'Repairs';
const REPAIRS_HEADERS = [
  'Date',        // leftmost
  'Station ID',
  'Repair Name',
  'Severity',
  'Priority',
  'Cost',
  'Category',
  'Type'         // rightmost
];

// ─── Ensure workbook exists with canonical sheets ─────────────────────────
async function ensureLookupsReady() {
  progress('ensure', 40, 'Ensuring data folders…');
  ensureDir(DATA_DIR); ensureDir(LOCATIONS_DIR); ensureDir(REPAIRS_DIR);
  if (!fs.existsSync(LOOKUPS_PATH)) {
    if (fs.existsSync(SEED_PATH)) {
      progress('ensure', 45, 'Copying seed workbook…');
      fs.copyFileSync(SEED_PATH, LOOKUPS_PATH);
      progress('ensure', 55, 'Seed workbook copied');
      // fall through to post-creation validation to add new sheets if seed lacks them
    }
  }
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();

  if (fs.existsSync(LOOKUPS_PATH)) {
    progress('ensure', 55, 'Opening lookups.xlsx…');
    await wb.xlsx.readFile(LOOKUPS_PATH);
    progress('ensure', 65, 'Validating sheets…');

    const need = (n) => !wb.worksheets.some(ws => ws.name === n);
    let changed = false;

    if (need('Companies'))          { wb.addWorksheet('Companies').addRow(['company','active']); changed = true; }
    if (need('Locations'))          { wb.addWorksheet('Locations').addRow(['location','company','link']); changed = true; }
    if (need('AssetTypes'))         { wb.addWorksheet('AssetTypes').addRow(['asset_type','location','company','color','link']); changed = true; }

    if (need('Custom Weights'))     { wb.addWorksheet('Custom Weights').addRow(['weight','active']); changed = true; }
    if (need('Workplan Constants')) { wb.addWorksheet('Workplan Constants').addRow(['Field','Value']); changed = true; }
    if (need('Algorithm Parameters')) {
      wb.addWorksheet('Algorithm Parameters').addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']); changed = true;
    }
    if (need('Workplan Details'))   { wb.addWorksheet('Workplan Details').addRow(['Parameter','Value']); changed = true; }

    // NEW sheets
    if (need('Status Colors')) {
      const ws = wb.addWorksheet('Status Colors');
      ws.addRow(['Status','Color']);
      ws.addRow(['Inactive',    '#8e8e8e']);
      ws.addRow(['Mothballed',  '#a87ecb']);
      ws.addRow(['Unknown',     '#999999']);
      changed = true;
    }
    if (need('Settings')) {
      const ws = wb.addWorksheet('Settings');
      ws.addRow(['Key','Value']);
      ws.addRow(['applyStatusColorsOnMap','FALSE']);
      ws.addRow(['applyRepairColorsOnMap','FALSE']);
      changed = true;
    }

    if (changed) {
      progress('ensure', 75, 'Writing workbook changes…');
      await wb.xlsx.writeFile(LOOKUPS_PATH);
    }
    progress('ensure', 80, 'Workbook ready');
    return true;
  } else {
    progress('ensure', 55, 'Creating workbook…');
    wb.addWorksheet('Companies').addRow(['company','active']);
    wb.addWorksheet('Locations').addRow(['location','company','link']);
    wb.addWorksheet('AssetTypes').addRow(['asset_type','location','company','color','link']);
    wb.addWorksheet('Custom Weights').addRow(['weight','active']);
    wb.addWorksheet('Workplan Constants').addRow(['Field','Value']);
    wb.addWorksheet('Algorithm Parameters').addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']);
    wb.addWorksheet('Workplan Details').addRow(['Parameter','Value']);

    // NEW: default Status Colors & Settings
    const wsS = wb.addWorksheet('Status Colors');
    wsS.addRow(['Status','Color']);
    wsS.addRow(['Inactive','#8e8e8e']);
    wsS.addRow(['Mothballed','#a87ecb']);
    wsS.addRow(['Unknown','#999999']);

    const wsCfg = wb.addWorksheet('Settings');
    wsCfg.addRow(['Key','Value']);
    wsCfg.addRow(['applyStatusColorsOnMap','FALSE']);
    wsCfg.addRow(['applyRepairColorsOnMap','FALSE']);

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

  // NEW: link caches
  const locationLinks = {};        // { company: { location: link } }
  const assetTypeLinks = {};       // { company: { location: { asset_type: link } } }

  const colorsGlobal = {};               // { assetType: color }
  const colorsByLoc  = {};               // { location: { assetType: color } }
  const colorsByCompanyLoc = {};         // { company: { location: { assetType: color } } }
  
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at   = normStr(row.getCell(1)?.text);
      const loc  = normStr(row.getCell(2)?.text);
      const co   = normStr(row.getCell(3)?.text);
      const col  = normStr(row.getCell(4)?.text);
      if (!at || !col) return;
      if (!loc && !co) {
        if (!colorsGlobal[at]) colorsGlobal[at] = col;
      } else if (loc && co) {
        ((colorsByCompanyLoc[co] ||= {})[loc] ||= {});
        if (!colorsByCompanyLoc[co][loc][at]) colorsByCompanyLoc[co][loc][at] = col;
      } else if (loc) {
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
      const link= normStr(row.getCell(3)?.text);
      if (!loc || !comp) return;
      (locsByCompany[comp] ||= new Set()).add(loc);
      if (link) {
        ((locationLinks[comp] ||= {}))[loc] = link;
      }
    });
  }
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at  = normStr(row.getCell(1)?.text);
      const loc = normStr(row.getCell(2)?.text);
      const co  = normStr(row.getCell(3)?.text);
      const link = normStr(row.getCell(5)?.text); // 5th column = link
      if (!at || !loc) return;
      (assetsByLocation[loc] ||= new Set()).add(at);
      if (at && loc && co && link) {
        (((assetTypeLinks[co] ||= {})[loc] ||= {}))[at] = link;
      }
    });
  }
  // NEW: Status Colors + Settings
  const wsSC = getSheet(wb, 'Status Colors');
  const statusColors = {};
  if (wsSC) {
    wsSC.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const k = normStr(row.getCell(1)?.text).toLowerCase(); // inactive/mothballed/unknown
      const col = normStr(row.getCell(2)?.text);
      if (k) statusColors[k] = col || '';
    });
  }

  const wsCfg = getSheet(wb, 'Settings');
  let applyStatusColorsOnMap = false;
  let applyRepairColorsOnMap = false;
  if (wsCfg) {
    wsCfg.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const key = normStr(row.getCell(1)?.text);
      const val = normStr(row.getCell(2)?.text);
      if (key.toLowerCase() === 'applystatuscolorsonmap') applyStatusColorsOnMap = toBool(val);
      if (key.toLowerCase() === 'applyrepaircolorsonmap') applyRepairColorsOnMap = toBool(val);
    });
  }

  Object.keys(locsByCompany).forEach(k => { locsByCompany[k] = Array.from(locsByCompany[k]).sort((a,b)=>a.localeCompare(b)); });
  Object.keys(assetsByLocation).forEach(k => { assetsByLocation[k] = Array.from(assetsByLocation[k]).sort((a,b)=>a.localeCompare(b)); });

  const payload = {
    mtimeMs, colorsGlobal, colorsByLoc, colorsByCompanyLoc,
    companies: uniqSorted(companies), locsByCompany, assetsByLocation,
    statusColors,
    applyStatusColorsOnMap,
    applyRepairColorsOnMap,
    // NEW:
    locationLinks,
    assetTypeLinks,
  };
  progress('done', 100, 'Excel ready');
  return payload;
}

// ─── Writes ───────────────────────────────────────────────────────────────
function randHexColor() { return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0'); }

async function setAssetTypeColor(assetType, color) {
  await ensureLookupsReady();
  // Global colors are deliberately disabled in the strict model.
  // Kept for backward calls: no-op with explicit response.
  return { success: false, disabled: true, message: 'Global colors are disabled; use setAssetTypeColorForCompanyLocation' };
}

// NEW: write location link
async function setLocationLink(company, location, link) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Locations') || wb.addWorksheet('Locations');
  if (ws.rowCount === 0) ws.addRow(['location','company','link']);
  const tgtLoc = lc(location), tgtComp = lc(company);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const loc = lc(row.getCell(1)?.text);
    const comp= lc(row.getCell(2)?.text);
    if (loc === tgtLoc && comp === tgtComp) {
      row.getCell(3).value = normStr(link || '');
      found = true;
    }
  });
  if (!found) ws.addRow([normStr(location), normStr(company), normStr(link || '')]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

// NEW: write asset type link
async function setAssetTypeLink(assetType, company, location, link) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes') || wb.addWorksheet('AssetTypes');
  if (ws.rowCount === 0) ws.addRow(['asset_type','location','company','color','link']);
  const tgtAt = lc(assetType), tgtLoc = lc(location), tgtComp = lc(company);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    const co  = lc(row.getCell(3)?.text);
    if (at === tgtAt && loc === tgtLoc && co === tgtComp) {
      // keep color if present
      if (!normStr(row.getCell(4)?.text)) row.getCell(4).value = randHexColor();
      row.getCell(5).value = normStr(link || '');
      found = true;
    }
  });
  if (!found) {
    ws.addRow([normStr(assetType), normStr(location), normStr(company), randHexColor(), normStr(link || '')]);
  }
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

async function setStatusColor(statusKey, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Status Colors') || wb.addWorksheet('Status Colors');
  if (ws.rowCount === 0) ws.addRow(['Status','Color']);
  
  const tgt = lc(statusKey);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      row.getCell(2).value = color;
      found = true;
    }
  });
  if (!found) ws.addRow([statusKey, color]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

// NEW: delete a status row by key (case-insensitive on "Status" column)
async function deleteStatusRow(statusKey) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Status Colors') || wb.addWorksheet('Status Colors');
  if (ws.rowCount === 0) ws.addRow(['Status','Color']);
  const tgt = lc(statusKey);
  let removed = false;
  // Find the row index (1-based); header is row 1
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      ws.spliceRows(i, 1);
      removed = true;
    }
  });
  if (removed) {
    await wb.xlsx.writeFile(LOOKUPS_PATH);
  }
  return { success:true, removed };
}

async function setSettingBoolean(key, flag) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Settings') || wb.addWorksheet('Settings');
  if (ws.rowCount === 0) ws.addRow(['Key','Value']);
  const tgt = lc(key);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      row.getCell(2).value = flag ? 'TRUE' : 'FALSE';
      found = true;
    }
  });
  if (!found) ws.addRow([key, flag ? 'TRUE' : 'FALSE']);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

// ─── Repairs I/O (NEW single-sheet model) ─────────────────────────────────
/**
 * Ensure the repairs workbook exists at data/repairs/<company>/<location>.xlsx
 * and return { wb, ws, filePath } with exactly one sheet named "Repairs".
 */
async function _ensureRepairsWorkbook(company, location) {
  const _ExcelJS = getExcel();
  ensureDir(REPAIRS_DIR);
  const companyDir = path.join(REPAIRS_DIR, normStr(company || '').trim() || 'NHS');
  ensureDir(companyDir);
  const filePath = path.join(companyDir, `${normStr(location)}.xlsx`);

  const wb = new _ExcelJS.Workbook();
  if (fs.existsSync(filePath)) {
    await wb.xlsx.readFile(filePath);
  }

  // Guarantee a single sheet named "Repairs"
  let ws = getSheet(wb, REPAIRS_SHEET);
  if (!ws) {
    if (wb.worksheets.length === 1) {
      // Reuse the lone sheet, rename to "Repairs"
      ws = wb.worksheets[0];
      ws.name = REPAIRS_SHEET;
    } else if (wb.worksheets.length === 0) {
      ws = wb.addWorksheet(REPAIRS_SHEET);
    } else {
      // Multiple legacy/temporary sheets present; add our canonical one.
      ws = wb.addWorksheet(REPAIRS_SHEET);
    }
  }

  // Ensure header row exists (one-row header model)
  if (!ws.rowCount || ws.getRow(1).cellCount === 0) {
    ws.addRow(REPAIRS_HEADERS);
  } else {
    // Normalize to canonical header order if different
    const r1 = ws.getRow(1);
    const existing = (r1.values || []).slice(1).map(v => String(v ?? '').trim());
    const same = REPAIRS_HEADERS.every((h, i) => (existing[i] || '').toLowerCase() === h.toLowerCase());
    if (!same) r1.values = [, ...REPAIRS_HEADERS];
  }
  return { wb, ws, filePath };
}

/**
 * Append a repair row for a location workbook:
 * - Workbook path: data/repairs/<company>/<location>.xlsx
 * - Single sheet: "Repairs"
 * - If Station ID already exists, insert immediately after the last row for that ID.
 * - Else, append to the end.
 *
 * @param {string} company
 * @param {string} location  Province/region code (e.g., "BC")
 * @param {object} repair    Plain object of column->value (must include Station ID/StationID/ID)
 */
async function appendRepair(company, location, repair = {}) {
  await ensureLookupsReady();
  const { wb, ws, filePath } = await _ensureRepairsWorkbook(company, location);

  // Normalize and require Station ID
  const stationId =
    normStr(repair['Station ID']) ||
    normStr(repair['StationID'])  ||
    normStr(repair['station_id']) ||
    normStr(repair['ID']);
  if (!stationId) {
    return { success: false, message: 'Station ID is required in the repair payload.' };
  }

  // Canonicalize header to: Date … Type
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
  const cur = [];
  for (let c = 1; c <= maxCol; c++) cur.push(takeText(headerRow.getCell(c)));

  // Union payload keys (case-insensitive) then enforce canonical order
  const haveCI = new Set(cur.map(h => h.toLowerCase()));
  for (const k of Object.keys(repair || {})) {
    const key = String(k || '').trim();
    if (!key) continue;
    if (!haveCI.has(key.toLowerCase())) { cur.push(key); haveCI.add(key.toLowerCase()); }
  }
  // Make sure Date, Station ID, and Type exist
  if (!haveCI.has('date')) cur.unshift('Date');
  if (!haveCI.has('station id')) cur.splice(1, 0, 'Station ID'); // directly after Date
  if (!haveCI.has('type')) cur.push('Type');                      // rightmost

  // Reorder to canonical template: Date first, Type last, everything else in between
  const others = cur.filter(h => {
    const l = (h || '').toLowerCase();
    return l !== 'date' && l !== 'station id' && l !== 'type';
  });
  const headers = ['Date', 'Station ID', ...others, 'Type'];
  ws.getRow(1).values = [, ...headers];

  // Locate Station ID column index (1-based)
  const sidCol = headers.findIndex(h => (h || '').toLowerCase() === 'station id') + 1;

  // Find the last row for this Station ID (grouped insertion)
  const lastRowIdx = ws.actualRowCount || ws.rowCount || 1;
  let lastForStation = 0;
  for (let r = 2; r <= lastRowIdx; r++) {
    const row = ws.getRow(r);
    const cur = takeText(row.getCell(sidCol));
    if (cur && cur.toLowerCase() === stationId.toLowerCase()) {
      lastForStation = r;
    }
  }

  // Build row values aligned to headers
  const today = new Date().toISOString().slice(0,10);
  const getCI = (key) => {
    const want = String(key || '').toLowerCase();
    for (const [k, v] of Object.entries(repair || {})) {
      if (String(k).toLowerCase() === want) return v;
    }
    return undefined;
  };
  const newValues = headers.map(h => {
    const l = (h || '').toLowerCase();
    if (l === 'date')        return getCI('Date') || today;
    if (l === 'station id')  return stationId;
    if (l === 'type')        return getCI('Type') || 'Repair';
    const v = repair[h] !== undefined ? repair[h] : getCI(h);
    return v !== undefined ? v : '';
  });

  // Insert at proper position
  let insertedAt;
  if (lastForStation >= 2) {
    ws.spliceRows(lastForStation + 1, 0, newValues);
    insertedAt = lastForStation + 1;
  } else {
    const newRow = ws.addRow(newValues);
    insertedAt = newRow.number;
  }

  await wb.xlsx.writeFile(filePath);
  return { success: true, file: filePath, sheet: ws.name, insertedAt };
}

async function setAssetTypeColorForLocation(assetType, location, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  // Redirect per-location → (company,location) using Locations sheet mapping.
  const wsA = getSheet(wb, 'AssetTypes');
  const wsL = getSheet(wb, 'Locations');
  if (!wsA || !wsL) throw new Error('Missing required sheets');
  let companyForLoc = '';
  wsL.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const loc = lc(row.getCell(1)?.text);
    const comp= normStr(row.getCell(2)?.text);
    if (loc === lc(location)) companyForLoc = comp;
  });
  if (!companyForLoc) throw new Error(`No company found for location "${location}" in Locations sheet`);
  // Forward to the strict triple writer
  return await setAssetTypeColorForCompanyLocation(assetType, companyForLoc, location, color);
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
  if (!exists) ws.addRow([normStr(location), normStr(company)]); // link column (3) optional on insert
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
  const wsL = getSheet(wb, 'Locations');
  let companyForLoc = '';
  if (wsL) {
    wsL.eachRow({ includeEmpty:false }, (row, idx) => {
      if (idx === 1) return;
      const loc = lc(row.getCell(1)?.text);
      const comp= normStr(row.getCell(2)?.text);
      if (loc === lc(location)) companyForLoc = comp;
    });
  }
  const tgtAt = lc(assetType), tgtLoc = lc(location || '');
  let match = null, blank = null;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    const co  = normStr(row.getCell(3)?.text);
    if (at === tgtAt && loc === tgtLoc && co === companyForLoc) match = row;
    if (at === tgtAt && !normStr(row.getCell(2)?.text) && !normStr(row.getCell(3)?.text)) blank = row;
  });
  if (match) return { success:true, added:false };
  if (blank) {
    blank.getCell(2).value = normStr(location || '');
    blank.getCell(3).value = companyForLoc;
    if (!normStr(blank.getCell(4)?.text)) blank.getCell(4).value = randHexColor();
    await wb.xlsx.writeFile(LOOKUPS_PATH);
    return { success:true, added:true };
  }
  ws.addRow([normStr(assetType), normStr(location || ''), companyForLoc, randHexColor()]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true, added:true };
}

// ─── Base64 helpers ───────────────────────────────────────────────────────
async function listSheets(b64) {
  const _ExcelJS = getExcel();
  const buf = Buffer.from(b64, 'base64');
  const wb  = new _ExcelJS.Workbook();
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
  const _ExcelJS = getExcel();
  const buf = Buffer.from(b64, 'base64');
  const wb  = new _ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return { success:false, message:'No sheets found.', rows: [] };
  const rows = sheetToObjectsOneRow(ws);
  return { success:true, rows };
}

// Helpers for headers
function takeText(cell) { return String(cell?.text ?? '').trim(); }
function sheetToObjectsOneRow(ws) {
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || ws.columnCount || headerRow.cellCount || 0;
  const lastRow = ws.actualRowCount || ws.rowCount || 1;
  const headers = [];
  for (let c = 1; c <= maxCol; c++) headers.push(takeText(headerRow.getCell(c)));
  const out = [];
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj = {}; let has = false;
    for (let c = 1; c <= maxCol; c++) {
      const key = headers[c - 1]; if (!key) continue;
      const val = takeText(row.getCell(c));
      if (val !== '') has = true;
      obj[key] = val;
    }
    if (has) out.push(obj);
  }
  return out;
}

function sheetTwoRowMeta(ws) {
  const row1 = ws.getRow(1);
  const row2 = ws.getRow(2);
  const maxCol = Math.max(
    ws.actualColumnCount || 0,
    row1.actualCellCount || row1.cellCount || 0,
    row2.actualCellCount || row2.cellCount || 0
  );
  const sections = [], fields = [], keys = [];
  for (let c = 1; c <= maxCol; c++) {
    const sec = takeText(row1.getCell(c));
    const fld = takeText(row2.getCell(c));
    if (!sec && !fld) continue; // ignore empty column
    sections.push(sec);
    fields.push(fld);
    // we store both composite and plain so callers can find by field name alone
    keys.push(sec ? `${sec} – ${fld}` : fld);
  }
  return { sections, fields, keys, maxCol };
}

function sheetToObjectsTwoRow(ws) {
  const { sections, fields, keys, maxCol } = sheetTwoRowMeta(ws);
  const lastRow = ws.actualRowCount || ws.rowCount || 2;
  const out = [];
  for (let r = 3; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj = {}; let has = false;
    for (let c = 1, k = 0; c <= maxCol; c++) {
      const sec = takeText(ws.getRow(1).getCell(c));
      const fld = takeText(ws.getRow(2).getCell(c));
      if (!sec && !fld) continue;
      const v = takeText(row.getCell(c));
      if (v !== '') has = true;
      const composite = sec ? `${sec} – ${fld}` : fld;
      // Store under BOTH composite and plain field for easy lookups:
      if (fld) obj[fld] = v;
      obj[composite] = v;
    }
    if (has) out.push(obj);
  }
  return { rows: out, sections, fields };
}

// Parse a specific worksheet by name, preferring two-row headers.
async function parseRowsFromSheet(b64, sheetName) {
  const _ExcelJS = getExcel();
  const buf = Buffer.from(b64, 'base64');
  const wb  = new _ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find(w => w?.name === sheetName)
          || wb.worksheets.find(w => lc(w?.name) === lc(sheetName));
  if (!ws) return { success:false, message:`Sheet not found: ${sheetName}`, rows: [] };
  // Decide if sheet has two header rows
  const row2HasAny = (ws.getRow(2)?.actualCellCount || 0) > 0;
  if (row2HasAny) {
    const { rows, sections, fields } = sheetToObjectsTwoRow(ws);
    return { success:true, rows, sections, headers: fields };
  } else {
    const rows = sheetToObjectsOneRow(ws);
    const headerRow = ws.getRow(1);
    const fields = [];
    const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
    for (let c = 1; c <= maxCol; c++) fields.push(takeText(headerRow.getCell(c)));
    const sections = fields.map(() => '');
    return { success:true, rows, sections, headers: fields };
  }
}

// Write rows preserving TWO-ROW headers (sections + fields)
async function writeLocationRows(location, sheetName, sections, headers, rows) {
  if (!location) throw new Error('Location is required');
  if (!Array.isArray(headers) || !headers.length) throw new Error('Headers are required');
  if (!Array.isArray(sections) || sections.length !== headers.length)
    throw new Error('Sections must align with headers');
  const _ExcelJS = getExcel();
  await ensureLookupsReady(); // guarantees DATA_DIR etc.

  const locPath = path.join(LOCATIONS_DIR, `${normStr(location)}.xlsx`);
  const wb = new _ExcelJS.Workbook();
  if (fs.existsSync(locPath)) {
    await wb.xlsx.readFile(locPath);
  }
  let ws = getSheet(wb, sheetName) || wb.getWorksheet(sheetName);
  if (!ws) {
    ws = wb.addWorksheet(sheetName || 'Data');
    ws.addRow(sections);
    ws.addRow(headers);
  }

  // Build the existing two-row header, if present
  let curSecs = [], curFlds = [];
  if (ws.rowCount >= 2) {
    const r1 = ws.getRow(1), r2 = ws.getRow(2);
    const maxCol = Math.max(r1.actualCellCount || r1.cellCount || 0,
                            r2.actualCellCount || r2.cellCount || 0,
                            headers.length);
    for (let c = 1; c <= maxCol; c++) {
      curSecs.push(takeText(r1.getCell(c)));
      curFlds.push(takeText(r2.getCell(c)));
    }
  }
  if (!curFlds.some(Boolean)) { curSecs = sections.slice(); curFlds = headers.slice(); }

  // Normalize incoming pairs first:
  //  - Coerce {Asset Type|Type|Category} → "General Information" / "Category"
  //  - Do NOT treat "Structure Type" as Category
  const normPairs = sections.map((s, i) => {
    const sec = String(s || '').trim();
    const fld = String(headers[i] || '').trim();
    const fl = fld.toLowerCase();
    if (fl === 'asset type' || fl === 'type' || fl === 'category') {
      return { sec: 'General Information', fld: 'Category' };
    }
    // Leave "Structure Type" untouched wherever it came from
    return { sec, fld };
  });

  // Union existing header pairs with normalized incoming pairs (preserve existing order)
  const pairKey = (s, h) => `${s}|||${h}`;
  const have = new Set(curFlds.map((h, i) => pairKey(curSecs[i], h)));
  normPairs.forEach(({sec, fld}) => {
    const k = pairKey(sec, fld);
    if (!have.has(k)) {
      curSecs.push(sec); curFlds.push(fld); have.add(k);
    }
  });

  // ── Reorder "General Information" anchors only (do not move Structure Type) ─
  // Goal: ensure "Category" appears under "General Information" between
  // "Station ID" and "Station Name"/"Site Name" in all newly written sheets.
  (function enforceGIOrder() {
    const GI = 'General Information';
    const lc = (s) => String(s || '').trim().toLowerCase();
    const isId   = (f) => ['station id','stationid','id'].includes(lc(f));
    // Category anchor must be *exactly* Category (or normalized to it), not Structure Type
    const isCat  = (f) => ['category'].includes(lc(f));
    const isName = (f) => ['site name','station name','name'].includes(lc(f));

    // Coerce GI section on key fields and build pair list
    const pairs = curFlds.map((fld, i) => {
      let sec = curSecs[i];
      if (isId(fld) || isCat(fld) || isName(fld)) sec = GI;
      return { sec, fld, i };
    });

    // Desired GI ordering: [ID, Category, Name], preserving original labels
    const idIdx   = pairs.findIndex(p => isId(p.fld));
    const catIdx  = pairs.findIndex(p => isCat(p.fld));
    const nameIdx = pairs.findIndex(p => isName(p.fld));

    // If none of the GI anchors exist, nothing to do
    if (idIdx === -1 && catIdx === -1 && nameIdx === -1) return;

    const giOthers = [];
    const nonGI    = [];
    pairs.forEach((p, idx) => {
      if (idx === idIdx || idx === catIdx || idx === nameIdx) return;
      if (lc(p.sec) === lc(GI)) giOthers.push(p);
      else nonGI.push(p);
    });

    const ordered = [];
    if (idIdx   !== -1) ordered.push({ sec: GI, fld: pairs[idIdx].fld });
    if (catIdx  !== -1) ordered.push({ sec: GI, fld: pairs[catIdx].fld });
    if (nameIdx !== -1) ordered.push({ sec: GI, fld: pairs[nameIdx].fld });
    // keep any other GI fields in original relative order
    ordered.push(...giOthers);
    // then all non-GI fields in original relative order
    ordered.push(...nonGI);

    curSecs = ordered.map(p => p.sec);
    curFlds = ordered.map(p => p.fld);
  })();

  // Rewrite header rows to final union
  ws.getRow(1).values = [ , ...curSecs ];
  ws.getRow(2).values = [ , ...curFlds ];

  // Append rows mapping object keys -> [composite or plain] header positions
  // Also feed Category from Asset Type/Type if the source used those names
  const compositeKeys = curFlds.map((h, i) => (curSecs[i] ? `${curSecs[i]} – ${h}` : h));
  for (const obj of rows) {
    // Lightweight normalization per row (do not pull from "Structure Type")
    const rowObj = { ...obj };
    const catPlain = rowObj['Category'] ?? rowObj['category'];
    const catGI    = rowObj['General Information – Category'];
    const at1      = rowObj['Asset Type'] ?? rowObj['asset type'];
    const atGI     = rowObj['General Information – Asset Type'];
    const type1    = rowObj['Type'] ?? rowObj['type'];
    const typeGI   = rowObj['General Information – Type'];
    if (!catPlain && !catGI) {
      const v = atGI ?? at1 ?? typeGI ?? type1;
      if (v !== undefined) {
        rowObj['Category'] = v;
        rowObj['General Information – Category'] = v;
      }
    }
    const arr = compositeKeys.map((k, i) => {
      const plain = curFlds[i];
      return (rowObj?.[k] ?? rowObj?.[plain] ?? '');
    });
    ws.addRow(arr);
  }

  await wb.xlsx.writeFile(locPath);
  return { success:true, file: locPath, sheet: ws.name, added: rows.length };
}

// Utility: pull a field from an object regardless of section prefix
function pick(obj, fieldName) {
  if (!obj) return '';
  // Exact key first
  if (obj[fieldName] !== undefined) return obj[fieldName];
  // Accept both en dash and hyphen composite headers, case-insensitive.
  const want = String(fieldName || '').trim().toLowerCase();
  if (!want) return '';
  const sepVariants = [' – ', ' - ', '—', ' — ', '–', '-'];
  for (const k of Object.keys(obj)) {
    const kl = String(k).toLowerCase().trim();
    if (kl === want) return obj[k];
    for (const sep of sepVariants) {
      if (kl.endsWith(sep + want)) return obj[k];
    }
  }
  return '';
}

// Utility: first non-empty match from a list of candidate field names
function pickOne(obj, candidates) {
  for (const name of candidates) {
    const v = pick(obj, name);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

// Recursively list .xlsx files under a root, skipping Excel lock files (~$...)
function listExcelFiles(root) {
  const out = [];
  try {
    if (!fs.existsSync(root)) return out;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(root, ent.name);
      if (ent.isDirectory()) {
        out.push(...listExcelFiles(p));
      } else if (
        ent.isFile() &&
        /\.xlsx$/i.test(ent.name) &&
        !ent.name.startsWith('~$')
      ) {
        out.push(p);
      }
    }
  } catch (_) {}
  return out;
}

// Utility: first non-empty match from a list of candidate field names
function pickOne(obj, candidates) {
  for (const name of candidates) {
    const v = pick(obj, name);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

// Aggregate stations from all location files for map pins
async function readStationsAggregate() {
  await ensureLookupsReady();
  ensureDir(LOCATIONS_DIR);
  const files = listExcelFiles(LOCATIONS_DIR);
  const _ExcelJS = getExcel();
  const out = [];
  let totalFiles = 0, totalSheets = 0, totalRows = 0, totalValid = 0;
  // Helpful diagnostics on startup
  for (const fn of files) {
    totalFiles++;
    const full = fn; // already absolute
    // Normalize now so downstream exact matching is trivial
    const locationFile = String(path.basename(full, path.extname(full))).trim(); // "BC"
    const wb = new _ExcelJS.Workbook();
    try { await wb.xlsx.readFile(full); }
    catch (e) {
      continue;
    }
    for (const ws of wb.worksheets) {
      if (!ws || ws.rowCount < 2) continue;
      const twoRow = (ws.getRow(2)?.actualCellCount || 0) > 0;
      let rows = [];
      if (twoRow) {
        rows = sheetToObjectsTwoRow(ws).rows;
      } else {
        rows = sheetToObjectsOneRow(ws);
      }
      totalSheets++;
      for (const r of rows) {
        totalRows++;
        const st = {
          station_id: pickOne(r, ['Station ID','StationID','ID']),
          asset_type: pickOne(r, ['Category','Asset Type','Type']), // do NOT conflate "Structure Type"
          name:       pickOne(r, ['Site Name','Name','Station Name']),
          province:   pickOne(r, ['Province','Location','State','Region','General Information - Province','General Information – Province']),
          lat:        pickOne(r, ['Latitude','Lat','Y']),
          lon:        pickOne(r, ['Longitude','Long','Lng','X']),
          status:     pickOne(r, ['Status']),
        };
        const latOk = String(st.lat).trim() !== '' && !isNaN(Number(st.lat));
        const lonOk = String(st.lon).trim() !== '' && !isNaN(Number(st.lon));
        if (latOk && lonOk) totalValid++;
        // attach all original fields too, plus the file-derived location tag
        out.push({ ...r, ...st, location_file: locationFile });
      }
    }
  }

  return { success:true, rows: out };
}

// Set color scoped to company+location (stored as "<COMPANY>@@<LOCATION>")
async function setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
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
    const loc = lc(normStr(row.getCell(2)?.text));
    const co  = lc(normStr(row.getCell(3)?.text));
    if (at === tgtAt && loc === lc(location) && co === lc(company)) { row.getCell(4).value = color; updated = true; }
  });
  if (!updated) ws.addRow([normStr(assetType), normStr(location), normStr(company), color]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

async function updateStationInLocationFile(locationName, stationId, updatedRowData) {
  try {
    await ensureLookupsReady();
    ensureDir(LOCATIONS_DIR);
    
    const locPath = path.join(LOCATIONS_DIR, `${normStr(locationName)}.xlsx`);
    
    if (!fs.existsSync(locPath)) {
      return { success: false, message: `Location file not found: ${locationName}.xlsx` };
    }

    const _ExcelJS = getExcel();
    const wb = new _ExcelJS.Workbook();
    await wb.xlsx.readFile(locPath);

    let updated = false;

    // Search through all worksheets in the location file
    for (const ws of wb.worksheets) {
      if (!ws || ws.rowCount < 2) continue;

      // Determine if this is a two-row header sheet
      const twoRowHeader = (ws.getRow(2)?.actualCellCount || 0) > 0;
      let stationIdColumnIndex = -1;
      let headerRowNum = twoRowHeader ? 2 : 1;

      // Find the Station ID column
      const headerRow = ws.getRow(headerRowNum);
      const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;

      for (let c = 1; c <= maxCol; c++) {
        const cellText = takeText(headerRow.getCell(c)).toLowerCase();
        if (cellText === 'station id' || cellText === 'stationid' || cellText === 'id') {
          stationIdColumnIndex = c;
          break;
        }
      }

      if (stationIdColumnIndex === -1) continue; // No Station ID column in this sheet

      // Find the row with matching Station ID
      const lastRow = ws.actualRowCount || ws.rowCount || headerRowNum;
      for (let r = headerRowNum + 1; r <= lastRow; r++) {
        const row = ws.getRow(r);
        const currentStationId = takeText(row.getCell(stationIdColumnIndex));
        
        if (String(currentStationId).trim() === String(stationId).trim()) {
          // Found the station row - update it
          await updateStationRow(ws, row, r, updatedRowData, twoRowHeader);
          updated = true;
          break;
        }
      }

      if (updated) break; // Found and updated, no need to check other sheets
    }

    if (!updated) {
      return { success: false, message: `Station ${stationId} not found in ${locationName}.xlsx` };
    }

    // Save the workbook
    await wb.xlsx.writeFile(locPath);
    return { success: true, message: `Station ${stationId} updated successfully` };

  } catch (error) {
    console.error('[updateStationInLocationFile] failed:', error);
    return { success: false, message: String(error) };
  }
}

async function updateStationRow(worksheet, row, rowNumber, updatedData, twoRowHeader) {
  // Get current header structure
  const headerRowNum = twoRowHeader ? 2 : 1;
  const sectionRowNum = twoRowHeader ? 1 : null;
  
  const headerRow = worksheet.getRow(headerRowNum);
  const sectionRow = sectionRowNum ? worksheet.getRow(sectionRowNum) : null;
  
  const maxCol = worksheet.actualColumnCount || headerRow.cellCount || 0;
  
  // Build maps of existing headers
  const existingHeaders = [];
  const existingSections = [];
  
  for (let c = 1; c <= maxCol; c++) {
    const headerText = takeText(headerRow.getCell(c));
    const sectionText = sectionRow ? takeText(sectionRow.getCell(c)) : '';
    existingHeaders.push(headerText);
    existingSections.push(sectionText);
  }

  // Create a map of composite keys to column indices for existing columns
  const columnMap = new Map();
  existingHeaders.forEach((header, index) => {
    if (!header) return;
    const section = existingSections[index] || '';
    const compositeKey = section ? `${section} – ${header}` : header;
    columnMap.set(compositeKey.toLowerCase(), index + 1); // Excel columns are 1-indexed
    columnMap.set(header.toLowerCase(), index + 1); // Also map plain header
  });

  // Track new columns that need to be added
  const newColumns = [];
  
  // Update existing cells and identify new columns
  Object.entries(updatedData).forEach(([key, value]) => {
    const keyLower = key.toLowerCase();
    let columnIndex = columnMap.get(keyLower);
    
    // If not found by exact match, try variations
    if (!columnIndex) {

      // Try mapping standard field names
      const fieldMappings = {
            'station id': ['stationid', 'id'],
            'category': ['asset type', 'type'],
            'asset_type': ['category', 'asset type', 'type'], // normalize to Category
            'site name': ['name', 'station name'],
            'station name': ['site name', 'name'],
            'province': ['location', 'state', 'region'],
            'latitude': ['lat', 'y'],
            'longitude': ['long', 'lng', 'lon', 'x'],
            'status': []
          };
      
      for (const [standardField, alternatives] of Object.entries(fieldMappings)) {
        if (keyLower === standardField) {
          columnIndex = columnMap.get(standardField);
          if (!columnIndex) {
            for (const alt of alternatives) {
              columnIndex = columnMap.get(alt);
              if (columnIndex) break;
            }
          }
          break;
        }
      }
    }

    if (columnIndex) {
      // Update existing column
      row.getCell(columnIndex).value = value || '';
    } else {
      // This is a new column
      newColumns.push({ key, value: value || '' });
    }
  });

  // Add new columns if any
  if (newColumns.length > 0) {
    const startCol = maxCol + 1;
    
    newColumns.forEach((newCol, index) => {
      const colIndex = startCol + index;
      
      // Parse section and field from composite key
      let section = '';
      let field = newCol.key;

      // Normalize GI section for common fields (but NOT "Structure Type")
      const lcKey = String(field).trim().toLowerCase();
      if (['category','asset_type','station id','stationid','id','site name','station name','name'].includes(lcKey)) {
        section = 'General Information';
        if (lcKey === 'asset_type') field = 'Category';
      }
      
      if (newCol.key.includes(' – ')) {
        [section, field] = newCol.key.split(' – ', 2);
      }
      
      // Add headers
      if (twoRowHeader) {
        worksheet.getRow(1).getCell(colIndex).value = section;
        worksheet.getRow(2).getCell(colIndex).value = field;
      } else {
        worksheet.getRow(1).getCell(colIndex).value = field;
      }
      
      // Add the value to the current row
      row.getCell(colIndex).value = newCol.value;
    });
  }
}

// Read all sheets from a location workbook
async function readLocationWorkbook(locationName) {
  try {
    const _ExcelJS = getExcel();
    const locPath = path.join(LOCATIONS_DIR, `${normStr(locationName)}.xlsx`);
    
    if (!fs.existsSync(locPath)) {
      return { success: false, message: `Location file not found: ${locationName}.xlsx` };
    }
    
    const wb = new _ExcelJS.Workbook();
    await wb.xlsx.readFile(locPath);
    
    const sheets = wb.worksheets.map(ws => ws.name).filter(Boolean);
    
    return { success: true, sheets, workbook: wb };
  } catch (error) {
    console.error('[readLocationWorkbook] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Read data from a specific sheet in a location workbook
async function readSheetData(locationName, sheetName) {
  try {
    const _ExcelJS = getExcel();
    const locPath = path.join(LOCATIONS_DIR, `${normStr(locationName)}.xlsx`);
    
    if (!fs.existsSync(locPath)) {
      return { success: false, message: `Location file not found: ${locationName}.xlsx` };
    }
    
    const wb = new _ExcelJS.Workbook();
    await wb.xlsx.readFile(locPath);
    
    const ws = getSheet(wb, sheetName);
    if (!ws) {
      return { success: false, message: `Sheet not found: ${sheetName}` };
    }
    
    // Check if it's a two-row header sheet
    const twoRowHeader = (ws.getRow(2)?.actualCellCount || 0) > 0;
    
    let rows, sections, fields;
    if (twoRowHeader) {
      const result = sheetToObjectsTwoRow(ws);
      rows = result.rows;
      sections = result.sections;
      fields = result.fields;
    } else {
      rows = sheetToObjectsOneRow(ws);
      sections = [];
      fields = [];
    }
    
    return { success: true, rows, sections, fields };
  } catch (error) {
    console.error('[readSheetData] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Update all stations of a specific asset type with new schema
async function updateAssetTypeSchema(assetType, schema, excludeStationId) {
  try {
    await ensureLookupsReady();
    ensureDir(LOCATIONS_DIR);
    
    const files = listExcelFiles(LOCATIONS_DIR);
    const _ExcelJS = getExcel();
    
    let totalUpdated = 0;
    const results = [];
    
    for (const filePath of files) {
      const locationName = path.basename(filePath, '.xlsx');
      const wb = new _ExcelJS.Workbook();
      
      try {
        await wb.xlsx.readFile(filePath);
      } catch (e) {
        console.error(`[updateAssetTypeSchema] Failed to read ${filePath}:`, e);
        continue;
      }
      
      let workbookModified = false;
      
      for (const ws of wb.worksheets) {
        if (!ws || ws.rowCount < 2) continue;
        
        // Check if this sheet contains the asset type we're looking for
        // Sheet names are like "Cableway BC" - we need to match the asset type part
        const sheetName = ws.name;
        const sheetParts = sheetName.split(' ');
        if (sheetParts.length < 2) continue;
        
        // Extract asset type from sheet name (everything except last word which is location)
        const sheetAssetType = sheetParts.slice(0, -1).join(' ');
        
        // Also check the actual data for Category field
        const twoRowHeader = (ws.getRow(2)?.actualCellCount || 0) > 0;
        const headerRowNum = twoRowHeader ? 2 : 1;
        const dataStartRow = headerRowNum + 1;
        
        // Find Category/Asset Type column
        let categoryColIndex = -1;
        const headerRow = ws.getRow(headerRowNum);
        const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
        
        for (let c = 1; c <= maxCol; c++) {
          const cellText = takeText(headerRow.getCell(c)).toLowerCase();
          if (cellText === 'category' || cellText === 'asset type' || cellText === 'type') {
            categoryColIndex = c;
            break;
          }
        }
        
        // Process rows if this sheet might contain our asset type
        const lastRow = ws.actualRowCount || ws.rowCount || headerRowNum;
        
        for (let r = dataStartRow; r <= lastRow; r++) {
          const row = ws.getRow(r);
          
          // Check if this row is for our asset type
          let rowAssetType = '';
          if (categoryColIndex > 0) {
            rowAssetType = takeText(row.getCell(categoryColIndex));
          }
          
          // Also check by sheet name
          const matchesByCategory = rowAssetType.toLowerCase() === assetType.toLowerCase();
          const matchesBySheetName = sheetAssetType.toLowerCase() === assetType.toLowerCase();
          
          if (!matchesByCategory && !matchesBySheetName) continue;
          
          // Get Station ID to check if we should skip this one
          let stationId = '';
          for (let c = 1; c <= maxCol; c++) {
            const cellText = takeText(headerRow.getCell(c)).toLowerCase();
            if (cellText === 'station id' || cellText === 'stationid' || cellText === 'id') {
              stationId = takeText(row.getCell(c));
              break;
            }
          }
          
          // Skip the station that triggered this update
          if (String(stationId) === String(excludeStationId)) continue;
          
          // Apply schema update to this row
          await applySchemaToRow(ws, row, r, schema, twoRowHeader);
          workbookModified = true;
          totalUpdated++;
        }
      }
      
      if (workbookModified) {
        await wb.xlsx.writeFile(filePath);
        results.push({ location: locationName, updated: true });
      }
    }
    
    return { 
      success: true, 
      totalUpdated, 
      results,
      message: `Updated ${totalUpdated} stations across ${results.length} locations` 
    };
    
  } catch (error) {
    console.error('[updateAssetTypeSchema] Fatal error:', error);
    return { success: false, message: String(error) };
  }
}

// Helper to apply schema changes to a row in Excel
async function applySchemaToRow(worksheet, row, rowNumber, schema, twoRowHeader) {
  const headerRowNum = twoRowHeader ? 2 : 1;
  const sectionRowNum = twoRowHeader ? 1 : null;
  
  const headerRow = worksheet.getRow(headerRowNum);
  const sectionRow = sectionRowNum ? worksheet.getRow(sectionRowNum) : null;
  
  const maxCol = worksheet.actualColumnCount || headerRow.cellCount || 0;
  
  // Build current column structure
  const existingColumns = new Map(); // Map of "section – field" or "field" to column index
  const giColumns = new Set(); // Track General Information columns to preserve them
  
  for (let c = 1; c <= maxCol; c++) {
    const header = takeText(headerRow.getCell(c));
    const section = sectionRow ? takeText(sectionRow.getCell(c)) : '';
    
    if (!header) continue;
    
    const key = section ? `${section} – ${header}` : header;
    existingColumns.set(key, c);
    
    // Track General Information columns
    if (section.toLowerCase() === 'general information') {
      giColumns.add(c);
    }
  }
  
  // Preserve General Information and other standard fields
  const preservedData = new Map();
  for (let c = 1; c <= maxCol; c++) {
    if (giColumns.has(c)) {
      // Preserve General Information fields
      preservedData.set(c, row.getCell(c).value);
    } else {
      // Check if it's a standard field we should preserve
      const header = takeText(headerRow.getCell(c)).toLowerCase();
      if (['station id', 'stationid', 'id', 'category', 'asset type', 'type',
           'site name', 'station name', 'name', 'province', 'location',
           'latitude', 'lat', 'longitude', 'lon', 'long', 'status'].includes(header)) {
        preservedData.set(c, row.getCell(c).value);
      }
    }
  }
  
  // Clear non-preserved cells in the row
  for (let c = 1; c <= maxCol; c++) {
    if (!preservedData.has(c)) {
      row.getCell(c).value = '';
    }
  }
  
  // Apply new schema
  let nextCol = maxCol + 1;
  
  for (let i = 0; i < schema.sections.length; i++) {
    const section = schema.sections[i];
    const field = schema.fields[i];
    const compositeKey = section ? `${section} – ${field}` : field;
    
    // Skip General Information fields
    if (section.toLowerCase() === 'general information') continue;
    
    let targetCol = existingColumns.get(compositeKey);
    
    if (!targetCol) {
      // Need to add a new column
      targetCol = nextCol++;
      
      // Add headers for the new column
      if (twoRowHeader) {
        worksheet.getRow(1).getCell(targetCol).value = section;
        worksheet.getRow(2).getCell(targetCol).value = field;
      } else {
        worksheet.getRow(1).getCell(targetCol).value = field;
      }
    }
    
    // Preserve existing value if any (look for it in original data)
    // This handles the case where a field moved to a different section
    let value = '';
    for (const [key, colIdx] of existingColumns.entries()) {
      if (key.endsWith(` – ${field}`) || key === field) {
        const existingValue = row.getCell(colIdx).value;
        if (existingValue) {
          value = existingValue;
          break;
        }
      }
    }
    
    row.getCell(targetCol).value = value;
  }
}

// ─── RPC shim ─────────────────────────────────────────────────────────────
const handlers = {
  ping: async () => 'pong',
  ensureLookupsReady,
  readLookupsSnapshot,
  setAssetTypeColor,
  setAssetTypeColorForLocation,
  setAssetTypeColorForCompanyLocation,
  upsertCompany,
  upsertLocation,
  upsertAssetType,
  listSheets,
  parseRows,
  parseRowsFromSheet,
  writeLocationRows,
  readStationsAggregate,
  updateStationInLocationFile,
  readLocationWorkbook,
  readSheetData,
  updateAssetTypeSchema,
  setStatusColor,
  deleteStatusRow,
  setSettingBoolean,
  setLocationLink,
  setAssetTypeLink,
  appendRepair,
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