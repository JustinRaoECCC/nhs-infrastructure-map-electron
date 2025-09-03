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
  const colorsByCompanyLoc = {};           // { company: { location: { assetType: color } } }
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at   = normStr(row.getCell(1)?.text);
      const loc2 = normStr(row.getCell(2)?.text);   // can be "", "<LOC>", or "<COMPANY>@@<LOC>"
      const col  = normStr(row.getCell(3)?.text);
      if (!at || !col) return;
      if (!loc2) {
        if (!colorsGlobal[at]) colorsGlobal[at] = col;
      } else {
        // company-scoped?
        const split = loc2.split('@@');
        if (split.length === 2) {
          const company = normStr(split[0]);
          const loc = normStr(split[1]);
          if (company && loc) {
            ((colorsByCompanyLoc[company] ||= {})[loc] ||= {});
            if (!colorsByCompanyLoc[company][loc][at]) colorsByCompanyLoc[company][loc][at] = col;
            return;
          }
        }
        // fall back to plain per-location
        (colorsByLoc[loc2] ||= {});
        if (!colorsByLoc[loc2][at]) colorsByLoc[loc2][at] = col;
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

  const payload = {
    mtimeMs, colorsGlobal, colorsByLoc, colorsByCompanyLoc,
    companies: uniqSorted(companies), locsByCompany, assetsByLocation
  };
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

  // Union existing header pairs with incoming header pairs (preserve existing order)
  const pairKey = (s, h) => `${s}|||${h}`;
  const have = new Set(curFlds.map((h, i) => pairKey(curSecs[i], h)));
  sections.forEach((s, i) => {
    const k = pairKey(s, headers[i]);
    if (!have.has(k)) {
      curSecs.push(s); curFlds.push(headers[i]); have.add(k);
    }
  });
  // Rewrite header rows to final union
  ws.getRow(1).values = [ , ...curSecs ];
  ws.getRow(2).values = [ , ...curFlds ];

  // Append rows mapping object keys -> [composite or plain] header positions
  const compositeKeys = curFlds.map((h, i) => (curSecs[i] ? `${curSecs[i]} – ${h}` : h));
  for (const obj of rows) {
    const arr = compositeKeys.map((k, i) => {
      const plain = curFlds[i];
      return (obj?.[k] ?? obj?.[plain] ?? '');
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
  try { console.log('[excel_worker] LOCATIONS_DIR =', LOCATIONS_DIR); } catch (_) {}
  for (const fn of files) {
    totalFiles++;
    const full = fn; // already absolute
    const locationFile = path.basename(full, path.extname(full)); // e.g., "BC"
    const wb = new _ExcelJS.Workbook();
    try { await wb.xlsx.readFile(full); }
    catch (e) {
      try { console.warn('[excel_worker] skip unreadable file:', full, String(e && e.message || e)); } catch (_) {}
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
          asset_type: pickOne(r, ['Category','Asset Type','Type','Structure Type']),
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
  try {
    console.log(`[excel_worker] loaded files=${totalFiles}, sheets=${totalSheets}, rows=${totalRows}, validCoords=${totalValid}`);
  } catch (_) {}
  return { success:true, rows: out };
}

// NEW: set color scoped to company+location (stored as "<COMPANY>@@<LOCATION>")
async function setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) throw new Error('Missing AssetTypes sheet');
  const tgtAt = lc(assetType);
  const tgtKey = `${normStr(company)}@@${normStr(location)}`.toLowerCase();
  let updated = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(normStr(row.getCell(2)?.text));
    if (at === tgtAt && loc === tgtKey) { row.getCell(3).value = color; updated = true; }
  });
  if (!updated) ws.addRow([normStr(assetType), `${normStr(company)}@@${normStr(location)}`, color]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
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