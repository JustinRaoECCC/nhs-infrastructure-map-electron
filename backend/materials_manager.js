'use strict';

/**
 * Materials Manager backend
 * - Per-company workbook: data/companies/<Company>/materials.xlsx
 * - Sheet "StorageLocations" stores locations + sheet mapping
 * - One sheet per storage location for materials
 * - Optional "Filters" sheet to persist saved filter definitions
 * - Dual-write to MongoDB when configured (collections: materials_locations, materials_items, materials_filters)
 */

const path = require('path');
const fse = require('fs-extra');
const ExcelJS = require('exceljs');
const config = require('./config');
const mongoClient = require('./db/mongoClient');

const DATA_DIR = path.join(__dirname, '..', 'data', 'companies');
const STORAGE_SHEET = 'StorageLocations';
const FILTER_SHEET = 'Filters';
const DEFAULT_COLUMNS_LOCATIONS = [
  { header: 'Location ID', key: 'id', width: 24 },
  { header: 'Location Name', key: 'name', width: 28 },
  { header: 'Description', key: 'description', width: 32 },
  { header: 'Sheet Name', key: 'sheetName', width: 24 },
  { header: 'Notes', key: 'notes', width: 32 },
  { header: 'Created At', key: 'created_at', width: 22 },
];
const DEFAULT_COLUMNS_MATERIALS = [
  { header: 'Material ID', key: 'id', width: 24 },
  { header: 'Location ID', key: 'location_id', width: 22 },
  { header: 'Material Name', key: 'name', width: 32 },
  { header: 'Category', key: 'category', width: 18 },
  { header: 'Quantity', key: 'quantity', width: 14 },
  { header: 'Unit', key: 'unit', width: 10 },
  { header: 'Value', key: 'value', width: 14 },
  { header: 'Tags', key: 'tags', width: 22 },
  { header: 'Attributes (JSON)', key: 'attributes', width: 40 },
  { header: 'Notes', key: 'notes', width: 32 },
  { header: 'Updated At', key: 'updated_at', width: 22 },
];
const DEFAULT_COLUMNS_FILTERS = [
  { header: 'Filter ID', key: 'id', width: 24 },
  { header: 'Name', key: 'name', width: 28 },
  { header: 'Field', key: 'field', width: 20 },
  { header: 'Operator', key: 'operator', width: 16 },
  { header: 'Value', key: 'value', width: 32 },
];

const dbConfig = config.getDbConfig();
const SHOULD_READ_MONGO = (dbConfig?.read?.source || '').toLowerCase() === 'mongodb';
const SHOULD_WRITE_MONGO = (dbConfig?.write?.targets || []).map(t => String(t).toLowerCase()).includes('mongodb');
const SHOULD_WRITE_EXCEL = (dbConfig?.write?.targets || []).map(t => String(t).toLowerCase()).includes('excel') || !SHOULD_WRITE_MONGO;

function safeCompanyFolder(company) {
  return String(company || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'Company';
}
function safeSheetName(name) {
  const cleaned = String(name || '').trim() || 'Storage';
  return cleaned.replace(/[\\/?*\\[\\]:]/g, '_').substring(0, 31);
}
function makeMaterialsPath(company) {
  return path.join(DATA_DIR, safeCompanyFolder(company), 'materials.xlsx');
}
function makeId(prefix = 'mat') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function normalizeAttributes(attrs) {
  if (!attrs) return {};
  if (Array.isArray(attrs)) {
    const out = {};
    attrs.forEach((pair) => {
      if (!pair) return;
      const k = String(pair.key || pair.name || '').trim();
      if (!k) return;
      out[k] = pair.value ?? '';
    });
    return out;
  }
  if (typeof attrs === 'object') return attrs;
  if (typeof attrs === 'string') {
    try { return JSON.parse(attrs); } catch { return {}; }
  }
  return {};
}
function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(t => String(t || '').trim()).filter(Boolean);
  if (typeof tags === 'string') {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

async function ensureMongoCollections() {
  if (!SHOULD_WRITE_MONGO && !SHOULD_READ_MONGO) return null;
  try {
    const connectionString = dbConfig?.database?.connectionString;
    if (!mongoClient.connected()) {
      const ok = await mongoClient.connect(connectionString);
      if (!ok) return null;
    }
    const db = mongoClient.getDatabase();
    const collections = {
      locations: db.collection('materials_locations'),
      materials: db.collection('materials_items'),
      filters: db.collection('materials_filters'),
    };
    // best-effort indexes
    await mongoClient.createIndexes('materials_locations', [{ key: { company: 1, id: 1 }, unique: true }]);
    await mongoClient.createIndexes('materials_items', [{ key: { company: 1, id: 1 }, unique: true }]);
    await mongoClient.createIndexes('materials_filters', [{ key: { company: 1, id: 1 }, unique: true }]);
    return collections;
  } catch (e) {
    console.error('[materials][mongo] Failed to ensure collections:', e.message);
    return null;
  }
}

async function ensureWorkbook(company) {
  const filePath = makeMaterialsPath(company);
  const dir = path.dirname(filePath);
  await fse.ensureDir(dir);

  const workbook = new ExcelJS.Workbook();
  if (await fse.pathExists(filePath)) {
    await workbook.xlsx.readFile(filePath);
  }

  let storageSheet = workbook.getWorksheet(STORAGE_SHEET);
  if (!storageSheet) {
    storageSheet = workbook.addWorksheet(STORAGE_SHEET);
    storageSheet.columns = DEFAULT_COLUMNS_LOCATIONS;
  }
  if (!storageSheet.getRow(1).values || storageSheet.getRow(1).cellCount < DEFAULT_COLUMNS_LOCATIONS.length) {
    storageSheet.columns = DEFAULT_COLUMNS_LOCATIONS;
  }

  let filterSheet = workbook.getWorksheet(FILTER_SHEET);
  if (!filterSheet) {
    filterSheet = workbook.addWorksheet(FILTER_SHEET);
    filterSheet.columns = DEFAULT_COLUMNS_FILTERS;
  }
  if (!filterSheet.getRow(1).values || filterSheet.getRow(1).cellCount < DEFAULT_COLUMNS_FILTERS.length) {
    filterSheet.columns = DEFAULT_COLUMNS_FILTERS;
  }

  return { workbook, filePath };
}

function upsertRow(sheet, matcher, values) {
  let targetRow = null;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (matcher(row)) targetRow = row;
  });
  if (!targetRow) {
    targetRow = sheet.addRow(values);
  } else {
    Object.entries(values).forEach(([k, v]) => {
      const col = sheet.getColumn(k);
      if (col && col.number) targetRow.getCell(col.number).value = v;
    });
  }
  return targetRow;
}

function readSheetRows(sheet, keys) {
  const rows = [];
  if (!sheet) return rows;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    keys.forEach((k, idx) => {
      obj[k] = row.getCell(idx + 1).value ?? '';
    });
    rows.push(obj);
  });
  return rows;
}

function parseFilters(filterSheet) {
  if (!filterSheet) return [];
  const out = [];
  filterSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = row.getCell(1).value || '';
    const name = row.getCell(2).value || '';
    const field = row.getCell(3).value || '';
    const operator = row.getCell(4).value || '';
    const value = row.getCell(5).value || '';
    if (id || name) {
      out.push({ id: String(id), name: String(name), field: String(field), operator: String(operator), value: String(value) });
    }
  });
  return out;
}

async function saveFiltersExcel(company, filters) {
  const { workbook, filePath } = await ensureWorkbook(company);
  const filterSheet = workbook.getWorksheet(FILTER_SHEET);
  filterSheet.spliceRows(2, Math.max(0, filterSheet.rowCount)); // clear existing except header
  (filters || []).forEach(f => {
    filterSheet.addRow({
      id: f.id || makeId('fil'),
      name: f.name || '',
      field: f.field || '',
      operator: f.operator || '',
      value: f.value || '',
    });
  });
  await workbook.xlsx.writeFile(filePath);
}

async function saveFiltersMongo(company, filters) {
  const cols = await ensureMongoCollections();
  if (!cols) return;
  const bulk = (filters || []).map(f => ({
    updateOne: {
      filter: { company, id: f.id },
      update: { $set: { company, ...f } },
      upsert: true,
    }
  }));
  const ids = new Set((filters || []).map(f => f.id));
  await cols.filters.deleteMany({ company, id: { $nin: Array.from(ids) } });
  if (bulk.length) await cols.filters.bulkWrite(bulk, { ordered: false });
}

async function upsertStorageLocation(company, payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'Location name is required' };
  const id = payload.id || makeId('loc');
  const sheetName = safeSheetName(payload.sheetName || name);
  const record = {
    id,
    name,
    description: payload.description || '',
    sheetName,
    notes: payload.notes || '',
    created_at: payload.created_at || new Date().toISOString(),
  };

  if (SHOULD_WRITE_EXCEL) {
    const { workbook, filePath } = await ensureWorkbook(company);
    const storageSheet = workbook.getWorksheet(STORAGE_SHEET);
    upsertRow(storageSheet, (row) => {
      const rid = row.getCell(1).value;
      const rname = row.getCell(2).value;
      return String(rid) === String(id) || String(rname || '').trim().toLowerCase() === name.toLowerCase();
    }, record);

    let locSheet = workbook.getWorksheet(sheetName);
    if (!locSheet) {
      locSheet = workbook.addWorksheet(sheetName);
      locSheet.columns = DEFAULT_COLUMNS_MATERIALS;
    } else if (locSheet.getRow(1).cellCount < DEFAULT_COLUMNS_MATERIALS.length) {
      locSheet.columns = DEFAULT_COLUMNS_MATERIALS;
    }

    await workbook.xlsx.writeFile(filePath);
  }

  if (SHOULD_WRITE_MONGO) {
    const cols = await ensureMongoCollections();
    if (cols) {
      await cols.locations.updateOne(
        { company, id },
        { $set: { company, ...record } },
        { upsert: true }
      );
    }
  }

  return { success: true, location: record };
}

async function upsertMaterial(company, payload = {}) {
  const locationId = payload.location_id || payload.locationId;
  if (!locationId) return { success: false, message: 'Location is required' };
  const name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'Material name is required' };
  const id = payload.id || makeId('mat');
  const attrsObj = normalizeAttributes(payload.attributes);
  const tagsArr = normalizeTags(payload.tags);

  const material = {
    id,
    location_id: locationId,
    name,
    category: payload.category || '',
    quantity: payload.quantity ?? '',
    unit: payload.unit || '',
    value: payload.value ?? '',
    tags: tagsArr.join(', '),
    attributes: JSON.stringify(attrsObj),
    notes: payload.notes || '',
    updated_at: new Date().toISOString(),
  };

  if (SHOULD_WRITE_EXCEL) {
    const { workbook, filePath } = await ensureWorkbook(company);
    const storageSheet = workbook.getWorksheet(STORAGE_SHEET);
    let targetSheetName = null;
    storageSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rid = row.getCell(1).value;
      if (String(rid) === String(locationId)) {
        targetSheetName = row.getCell(4).value || row.getCell(2).value;
      }
    });
    targetSheetName = safeSheetName(targetSheetName || 'Storage');
    let locSheet = workbook.getWorksheet(targetSheetName);
    if (!locSheet) {
      locSheet = workbook.addWorksheet(targetSheetName);
      locSheet.columns = DEFAULT_COLUMNS_MATERIALS;
    } else if (locSheet.getRow(1).cellCount < DEFAULT_COLUMNS_MATERIALS.length) {
      locSheet.columns = DEFAULT_COLUMNS_MATERIALS;
    }
    upsertRow(locSheet, (row) => String(row.getCell(1).value) === String(id), material);
    await workbook.xlsx.writeFile(filePath);
  }

  if (SHOULD_WRITE_MONGO) {
    const cols = await ensureMongoCollections();
    if (cols) {
      await cols.materials.updateOne(
        { company, id },
        { $set: { company, ...material, tags: tagsArr, attributes: attrsObj } },
        { upsert: true }
      );
    }
  }

  return { success: true, material };
}

async function saveFilters(company, filters = []) {
  if (SHOULD_WRITE_EXCEL) await saveFiltersExcel(company, filters);
  if (SHOULD_WRITE_MONGO) await saveFiltersMongo(company, filters);
  return { success: true };
}

async function readFromExcel(company) {
  const { workbook } = await ensureWorkbook(company);
  const storageSheet = workbook.getWorksheet(STORAGE_SHEET);
  const filterSheet = workbook.getWorksheet(FILTER_SHEET);
  const locations = [];
  storageSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = row.getCell(1).value || '';
    const name = row.getCell(2).value || '';
    if (!id && !name) return;
    locations.push({
      id: String(id),
      name: String(name),
      description: row.getCell(3).value || '',
      sheetName: safeSheetName(row.getCell(4).value || name),
      notes: row.getCell(5).value || '',
      created_at: row.getCell(6).value || '',
    });
  });

  const materials = [];
  const skip = new Set([STORAGE_SHEET, FILTER_SHEET]);
  workbook.worksheets.forEach((sheet) => {
    if (skip.has(sheet.name)) return;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const id = row.getCell(1).value || '';
      const name = row.getCell(3).value || '';
      if (!id && !name) return;
      const attrRaw = row.getCell(9).value || '{}';
      materials.push({
        id: String(id),
        location_id: String(row.getCell(2).value || ''),
        name: String(name),
        category: row.getCell(4).value || '',
        quantity: row.getCell(5).value ?? '',
        unit: row.getCell(6).value || '',
        value: row.getCell(7).value ?? '',
        tags: normalizeTags(row.getCell(8).value || ''),
        attributes: normalizeAttributes(attrRaw),
        notes: row.getCell(10).value || '',
        updated_at: row.getCell(11).value || '',
      });
    });
  });

  const filters = parseFilters(filterSheet);
  return { locations, materials, filters };
}

async function readFromMongo(company) {
  const cols = await ensureMongoCollections();
  if (!cols) return { locations: [], materials: [], filters: [] };
  const [locations, materials, filters] = await Promise.all([
    cols.locations.find({ company }).toArray(),
    cols.materials.find({ company }).toArray(),
    cols.filters.find({ company }).toArray(),
  ]);
  return {
    locations: locations.map(l => ({ ...l, id: String(l.id) })),
    materials: materials.map(m => ({
      ...m,
      id: String(m.id),
      location_id: String(m.location_id || m.locationId || ''),
      tags: normalizeTags(m.tags),
      attributes: normalizeAttributes(m.attributes),
    })),
    filters: filters.map(f => ({ ...f, id: String(f.id) })),
  };
}

async function getCompanyData(company) {
  if (!company) return { locations: [], materials: [], filters: [] };
  if (SHOULD_READ_MONGO) {
    try {
      return await readFromMongo(company);
    } catch (e) {
      console.warn('[materials] Mongo read failed, falling back to Excel:', e.message);
    }
  }
  const excelData = await readFromExcel(company);
  // opportunistic dual-write to Mongo to keep in sync
  if (SHOULD_WRITE_MONGO) {
    const cols = await ensureMongoCollections();
    if (cols) {
      try {
        const locBulk = excelData.locations.map(l => ({
          updateOne: { filter: { company, id: l.id }, update: { $set: { company, ...l } }, upsert: true }
        }));
        if (locBulk.length) await cols.locations.bulkWrite(locBulk, { ordered: false });
        const matBulk = excelData.materials.map(m => ({
          updateOne: { filter: { company, id: m.id }, update: { $set: { company, ...m } }, upsert: true }
        }));
        if (matBulk.length) await cols.materials.bulkWrite(matBulk, { ordered: false });
        const filBulk = excelData.filters.map(f => ({
          updateOne: { filter: { company, id: f.id }, update: { $set: { company, ...f } }, upsert: true }
        }));
        if (filBulk.length) await cols.filters.bulkWrite(filBulk, { ordered: false });
      } catch (e) {
        console.warn('[materials] Mongo sync skipped:', e.message);
      }
    }
  }
  return excelData;
}

async function ensureCompanyWorkbook(company) {
  if (!company) return { success: false, message: 'company is required' };
  await ensureWorkbook(company);
  return { success: true };
}

module.exports = {
  ensureCompanyWorkbook,
  getCompanyData,
  upsertStorageLocation,
  upsertMaterial,
  saveFilters,
  health() {
    return { success: true };
  },
};
