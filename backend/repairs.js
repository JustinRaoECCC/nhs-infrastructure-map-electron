// backend/repairs.js
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const ExcelJS = require('exceljs');

const lookupsRepo = require('./lookups_repo');
const backendApp = require('./app'); // to fetch stations (getStationData)
const { ensureDir } = require('./utils/fs_utils');

// ----- Table spec -----
const HEADERS = ['Repair Name', 'Severity', 'Priority', 'Cost', 'Category'];
const COL_WIDTHS = [40, 16, 16, 14, 14];

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

  const assetType = String(st.asset_type || 'Unknown').trim() || 'Unknown';
  const location  = String(st.location_file || st.province || 'Unknown').trim() || 'Unknown';
  const company   = await companyForLocation(location);

  const baseDir = path.join(__dirname, '..', 'data', 'repairs',
    sanitizeFolder(company),
    sanitizeFolder(location)
  );
  const file = path.join(baseDir, `${sanitizeFolder(assetType)}_Repairs.xlsx`);
  const sheetName = String(st.station_id);

  await ensureDir(baseDir);
  return { file, sheetName };
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

function ensureSheet(wb, sheetName) {
  let ws = wb.getWorksheet(sheetName);
  if (!ws) {
    ws = wb.addWorksheet(sheetName);
    ws.addRow(HEADERS);
    ws.getRow(1).font = { bold: true };
    COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  } else {
    // Make sure header row exists/matches
    const r1 = ws.getRow(1);
    const vals = (r1.values || []).slice(1).map(v => String(v ?? '').trim());
    const same = HEADERS.every((h, i) => (vals[i] || '').toLowerCase() === h.toLowerCase());
    if (!same) {
      r1.values = [ , ...HEADERS ];
      r1.font = { bold: true };
    }
    // Apply widths (idempotent)
    COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }
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

    const out = [];
    const last = ws.rowCount;
    for (let r = 2; r <= last; r++) {
      const row = ws.getRow(r);
      if (rowIsEmpty(row)) continue;
      const [name, severity, priority, cost, category] = [
        row.getCell(1).value, row.getCell(2).value, row.getCell(3).value,
        row.getCell(4).value, row.getCell(5).value
      ];
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
    const { file, sheetName } = await resolveRepairsFileForStation(stationId);
    const wb = await loadWorkbook(file);
    const ws = ensureSheet(wb, sheetName);

    // Clear existing data rows (keep header at row 1)
    if (ws.rowCount > 1) {
      ws.spliceRows(2, ws.rowCount - 1);
    }

    const rows = Array.isArray(items) ? items.map(normalizeItem) : [];
    for (const it of rows) {
      ws.addRow([it.name, it.severity, it.priority, it.cost, it.category]);
    }

    await wb.xlsx.writeFile(file);
    return { success: true, count: rows.length, file, sheet: sheetName };
  } catch (e) {
    console.error('[repairs:save] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = { listRepairs, saveRepairs };
