// backend/repairs.js
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const ExcelJS = require('exceljs');

const lookupsRepo = require('./lookups_repo');
const backendApp = require('./app'); // to fetch stations (getStationData)
const { ensureDir } = require('./utils/fs_utils');

// ----- Table spec (single-sheet model) -----
// One workbook per company/location: data/repairs/<Company>/<Location>.xlsx
// One sheet per workbook, named "Repairs".
// Columns: Date (leftmost), Station ID (for grouping), …, Type (rightmost).
const HEADERS = [
  'Date',       // <-- new leftmost
  'Station ID',
  'Repair Name',
  'Severity',
  'Priority',
  'Cost',
  'Category',
  'Type'        // <-- new rightmost (Repair | Monitoring)
];
const COL_WIDTHS = [14, 18, 40, 16, 16, 14, 14, 14];

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

  const type =
    /^monitor/i.test(item.type) ? 'Monitoring'
    : 'Repair';

  // date as yyyy-mm-dd string if present; else empty
  const d = String(item.date ?? '').trim();

  return {
    date: d,
    name: String(item.name ?? '').trim(),
    severity: String(item.severity ?? '').trim(),
    priority: String(item.priority ?? '').trim(),
    cost,
    category,
    type,
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

  // Path: data/repairs/<Company>/<Location>.xlsx (single "Repairs" sheet)
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
    const colDate  = hmap.get('date');
    const colSID   = hmap.get('station id') || 1;
    const colName  = hmap.get('repair name') || 2;
    const colSev   = hmap.get('severity') || 3;
    const colPrio  = hmap.get('priority') || 4;
    const colCost  = hmap.get('cost') || 5;
    const colCat   = hmap.get('category') || 6;
    const colType  = hmap.get('type');

    const out = [];
    const last = ws.rowCount;
    for (let r = 2; r <= last; r++) {
      const row = ws.getRow(r);
      if (rowIsEmpty(row)) continue;
      const sid = String(row.getCell(colSID).value ?? '').trim();
      if (!sid || String(sid).toLowerCase() !== String(stationId).toLowerCase()) continue;

      const date     = colDate ? row.getCell(colDate).value : '';
      const name     = row.getCell(colName).value;
      const severity = row.getCell(colSev).value;
      const priority = row.getCell(colPrio).value;
      const cost     = row.getCell(colCost).value;
      const category = row.getCell(colCat).value;
      const type     = colType ? row.getCell(colType).value : 'Repair';

      out.push(normalizeItem({
        date,
        name,
        severity,
        priority,
        cost: (typeof cost === 'object' && cost?.result != null) ? cost.result : cost,
        category,
        type,
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
    // Replace this station's group instead of appending duplicates.
    const { file, sheetName } = await resolveRepairsFileForStation(stationId);
    const wb = await loadWorkbook(file);
    const ws = ensureSheet(wb, sheetName);

    // Build header map (case-insensitive)
    const hrow = ws.getRow(1);
    const hmax = ws.actualColumnCount || hrow.cellCount || HEADERS.length;
    const hmap = new Map(); // lowercased header -> 1-based col idx
    for (let c = 1; c <= hmax; c++) {
      const key = String(hrow.getCell(c)?.value ?? '').trim().toLowerCase();
      if (key) hmap.set(key, c);
    }
    const colDate  = hmap.get('date')        || 1;
    const colSID   = hmap.get('station id')  || 2;
    const colName  = hmap.get('repair name') || 3;
    const colSev   = hmap.get('severity')    || 4;
    const colPrio  = hmap.get('priority')    || 5;
    const colCost  = hmap.get('cost')        || 6;
    const colCat   = hmap.get('category')    || 7;
    const colType  = hmap.get('type')        || 8;

    // Find ALL rows for this Station ID (anywhere in sheet), remove them (bottom-up)
    const toDelete = [];
    const last = ws.rowCount;
    for (let r = 2; r <= last; r++) {
      const sid = String(ws.getRow(r).getCell(colSID).value ?? '').trim();
      if (sid && sid.toLowerCase() === String(stationId).toLowerCase()) {
        toDelete.push(r);
      }
    }
    const insertAt = toDelete.length ? Math.min(...toDelete) : (ws.rowCount + 1);
    for (let i = toDelete.length - 1; i >= 0; i--) {
      ws.spliceRows(toDelete[i], 1);
    }

    // Insert new block
    const rows = Array.isArray(items) ? items.map(normalizeItem) : [];
    const payloadRows = rows.map(it => {
      const arr = new Array(Math.max(hmax, HEADERS.length)).fill('');
      arr[colDate - 1] = it.date || new Date().toISOString().slice(0, 10);
      arr[colSID  - 1] = stationId;
      arr[colName - 1] = it.name;
      arr[colSev  - 1] = it.severity;
      arr[colPrio - 1] = it.priority;
      arr[colCost - 1] = it.cost;
      arr[colCat  - 1] = it.category;
      arr[colType - 1] = it.type || 'Repair';
      return arr;
    });
    if (payloadRows.length) {
      ws.spliceRows(insertAt, 0, ...payloadRows);
    }

    // Save
    await wb.xlsx.writeFile(file);
    return { success: true, count: rows.length, file, sheet: sheetName };
  } catch (e) {
    console.error('[repairs:save] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = { listRepairs, saveRepairs };
