// backend/repairs.js
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const ExcelJS = require('exceljs');

const lookupsRepo = require('./lookups_repo');
const backendApp = require('./app'); // to fetch stations (getStationData)
const { ensureDir } = require('./utils/fs_utils');

// ----- Table spec (NEW single-sheet model) -----
// One workbook per company/location: data/repairs/<Company>/<Location>.xlsx
// One sheet per workbook, named "Repairs". First column is Station ID for grouping.
const HEADERS = ['Station ID', 'Repair Name', 'Severity', 'Priority', 'Cost', 'Category'];
const COL_WIDTHS = [18, 40, 16, 16, 14, 14];

// ----- Helpers -----
function sanitizeFolder(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeItem(raw) {
  const item = raw || {};
  // Cost: numeric if possible; else keep as string
  let cost = item.cost;
  if (typeof cost !== 'number') {
    const num = Number(String(cost ?? '').replace(/[, ]/g, ''));
    cost = Number.isFinite(num) ? num : String(cost ?? '').trim();
  }
  const category =
    /^capital$/i.test(item.category) ? 'Capital'
    : /^o&?m$/i.test(item.category) ? 'O&M'
    : 'Capital';

  return {
    name: String(item.name ?? '').trim(),
    severity: String(item.severity ?? '').trim(),
    priority: String(item.priority ?? '').trim(),
    cost,
    category,
  };
}

// Build a small index: normalized location -> company
function norm(s){ return String(s||'').trim().toLowerCase(); }
async function companyForLocation(locRaw) {
  try {
    const tree = await lookupsRepo.getLookupTree(); // { locationsByCompany: { company: [loc1,loc2...] } }
    const map = tree?.locationsByCompany || {};
    const want = norm(locRaw);
    for (const [company, locs] of Object.entries(map)) {
      for (const L of (locs || [])) {
        if (norm(L) === want) return company;
      }
    }
  } catch (e) {}
  return 'NHS'; // sensible default
}

async function resolveRepairsFileForStation(stationId) {
  // Pull station row to discover asset type & location (Province acts as Location)
  const all = await backendApp.getStationData({ skipColors: true });
  const st = (all || []).find(s => String(s.station_id) === String(stationId));
  if (!st) throw new Error(`Station not found for ID ${stationId}`);

  const location  = String(st.location_file || st.province || 'Unknown').trim() || 'Unknown';
  const company   = await companyForLocation(location);

  // NEW pathing: data/repairs/<Company>/<Location>.xlsx (single "Repairs" sheet)
  const baseDir = path.join(__dirname, '..', 'data', 'repairs', sanitizeFolder(company));
  const file = path.join(baseDir, `${sanitizeFolder(location)}.xlsx`);
  const sheetName = 'Repairs';

  await ensureDir(baseDir);
  return { file, sheetName, company, location };
}

async function loadWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  try {
    // If exists, read; otherwise return empty workbook
    await fsp.access(file);
    await wb.xlsx.readFile(file);
  } catch (_) { /* new workbook */ }
  return wb;
}

function ensureSheet(wb, sheetName = 'Repairs') {
  // Keep a single canonical sheet named "Repairs"
  let ws = wb.getWorksheet('Repairs') || (sheetName && wb.getWorksheet(sheetName));
  if (!ws) {
    ws = wb.addWorksheet('Repairs');
  }
  // Drop any extra sheets to enforce the single-sheet model
  for (const s of [...wb.worksheets]) {
    if (s.name !== 'Repairs') wb.removeWorksheet(s.id);
  }
  // Ensure header exists and matches our spec
  const r1 = ws.getRow(1);
  const vals = (r1.values || []).slice(1).map(v => String(v ?? '').trim());
  const same = HEADERS.every((h, i) => (vals[i] || '').toLowerCase() === h.toLowerCase());
  if (!same) {
    r1.values = [ , ...HEADERS ];
    r1.font = { bold: true };
  } else {
    r1.font = { bold: true };
  }
  // Apply widths (idempotent)
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return ws;
}

function rowIsEmpty(row) {
  const vals = (row.values || []).slice(1);
  return vals.every(v => v === null || v === undefined || String(v).trim() === '');
}

// ----- Public API -----
async function listRepairs(siteName, stationId) {
  try {
    const { file, sheetName } = await resolveRepairsFileForStation(stationId);
    const wb = await loadWorkbook(file);
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return []; // nothing yet

    // Map header names to column indices
    const hrow = ws.getRow(1);
    const hmax = ws.actualColumnCount || hrow.cellCount || HEADERS.length;
    const hmap = new Map(); // lowercased header -> 1-based column index
    for (let c = 1; c <= hmax; c++) {
      const key = String(hrow.getCell(c)?.value ?? '').trim().toLowerCase();
      if (key) hmap.set(key, c);
    }
    const colSID   = hmap.get('station id') || 1;
    const colName  = hmap.get('repair name') || 2;
    const colSev   = hmap.get('severity') || 3;
    const colPrio  = hmap.get('priority') || 4;
    const colCost  = hmap.get('cost') || 5;
    const colCat   = hmap.get('category') || 6;

    const out = [];
    const last = ws.rowCount;
    for (let r = 2; r <= last; r++) {
      const row = ws.getRow(r);
      if (rowIsEmpty(row)) continue;
      const sid = String(row.getCell(colSID).value ?? '').trim();
      if (!sid || String(sid).toLowerCase() !== String(stationId).toLowerCase()) continue;
      const name     = row.getCell(colName).value;
      const severity = row.getCell(colSev).value;
      const priority = row.getCell(colPrio).value;
      const cost     = row.getCell(colCost).value;
      const category = row.getCell(colCat).value;
      // Normalize output to the structure the UI expects
      out.push(normalizeItem({
        name,
        severity,
        priority,
        cost: (typeof cost === 'object' && cost?.result != null) ? cost.result : cost,
        category,
      }));
    }
    return out;
  } catch (e) {
    console.error('[repairs:list] failed:', e);
    return [];
  }
}

async function saveRepairs(siteName, stationId, items) {
  try {
    // Correct behavior: REPLACE this station's group instead of appending duplicates.
    // 1) Open workbook/sheet
    const { file, sheetName } = await resolveRepairsFileForStation(stationId);
    const wb = await loadWorkbook(file);
    const ws = ensureSheet(wb, sheetName);

    // 2) Build header map (case-insensitive)
    const hrow = ws.getRow(1);
    const hmax = ws.actualColumnCount || hrow.cellCount || HEADERS.length;
    const hmap = new Map(); // lowercased header -> 1-based col idx
    for (let c = 1; c <= hmax; c++) {
      const key = String(hrow.getCell(c)?.value ?? '').trim().toLowerCase();
      if (key) hmap.set(key, c);
    }
    const colSID   = hmap.get('station id') || 1;
    const colName  = hmap.get('repair name') || 2;
    const colSev   = hmap.get('severity')    || 3;
    const colPrio  = hmap.get('priority')    || 4;
    const colCost  = hmap.get('cost')        || 5;
    const colCat   = hmap.get('category')    || 6;

    // 3) Find ALL rows for this Station ID (anywhere in sheet), remove them (bottom-up to avoid index shifts)
    const toDelete = [];
    const last = ws.rowCount;
    for (let r = 2; r <= last; r++) {
      const sid = String(ws.getRow(r).getCell(colSID).value ?? '').trim();
      if (sid && sid.toLowerCase() === String(stationId).toLowerCase()) {
        toDelete.push(r);
      }
    }
    // Remember insertion anchor: first occurrence if any; else append at end
    const insertAt = toDelete.length ? Math.min(...toDelete) : (ws.rowCount + 1);
    // Delete from bottom to top
   for (let i = toDelete.length - 1; i >= 0; i--) {
      ws.spliceRows(toDelete[i], 1);
    }

    // 4) Insert the new block for this Station ID at the anchor
    const rows = Array.isArray(items) ? items.map(normalizeItem) : [];
    const payloadRows = rows.map(it => {
      const arr = new Array(Math.max(hmax, HEADERS.length)).fill('');
      arr[colSID   - 1] = stationId;
      arr[colName  - 1] = it.name;
      arr[colSev   - 1] = it.severity;
      arr[colPrio  - 1] = it.priority;
      arr[colCost  - 1] = it.cost;
      arr[colCat   - 1] = it.category;
      return arr;
    });
    if (payloadRows.length) {
      // ExcelJS spliceRows(start, deleteCount, ...rowsToInsert)
      ws.spliceRows(insertAt, 0, ...payloadRows);
    }

    // 5) Save
    await wb.xlsx.writeFile(file);
    return { success: true, count: rows.length, file, sheet: sheetName };
  } catch (e) {
    console.error('[repairs:save] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = { listRepairs, saveRepairs };
