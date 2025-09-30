// backend/excel_worker_client.js
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const path = require('path');

let w = null;
let seq = 1;
const pending = new Map();
const emitter = new EventEmitter();

function ensureWorker() {
  if (w && w.threadId) return;
  const workerPath = path.join(__dirname, 'excel_worker.js');
  w = new Worker(workerPath, { workerData: {} });
  w.on('message', (msg) => {
    // Progress messages have no id
    if (msg && msg.type === 'progress') {
      emitter.emit('progress', msg);
      return;
    }
    const { id, ok, result, error } = msg || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error || 'Worker error'));
  });
  w.on('error', (err) => {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  });
  w.on('exit', (code) => {
    w = null;
    // Optional: auto-restart on crash; lazy restart happens on next call()
  });
}

function call(cmd, ...args) {
  return new Promise((resolve, reject) => {
    ensureWorker();
    const id = seq++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, cmd, args });
  });
}

module.exports = {
  warm: () => { ensureWorker(); return call('ping').catch(() => {}); },
  onProgress: (cb) => { emitter.on('progress', cb); },
  // Excel from base64
  listSheets: (b64) => call('listSheets', b64),
  parseRows:  (b64) => call('parseRows',  b64),
  parseRowsFromSheet: (b64, sheetName) => call('parseRowsFromSheet', b64, sheetName),
  writeLocationRows: (location, sheetName, sections, headers, rows) =>
    call('writeLocationRows', location, sheetName, sections, headers, rows),
  readStationsAggregate: () => call('readStationsAggregate'),
  // Lookups workbook
  ensureLookupsReady:   () => call('ensureLookupsReady'),
  readLookupsSnapshot:  () => call('readLookupsSnapshot'),
  upsertCompany:        (name, active) => call('upsertCompany', name, !!active),
  upsertLocation:       (location, company) => call('upsertLocation', location, company),
  upsertAssetType:      (assetType, location) => call('upsertAssetType', assetType, location),
  setAssetTypeColor:    (assetType, color) => call('setAssetTypeColor', assetType, color),
  setAssetTypeColorForLocation: (assetType, location, color) =>
    call('setAssetTypeColorForLocation', assetType, location, color),
  setAssetTypeColorForCompanyLocation: (assetType, company, location, color) =>
    call('setAssetTypeColorForCompanyLocation', assetType, company, location, color),
  updateStationInLocationFile: (locationName, stationId, updatedRowData) =>
    call('updateStationInLocationFile', locationName, stationId, updatedRowData),
  readLocationWorkbook: (locationName) => call('readLocationWorkbook', locationName),
  readSheetData: (locationName, sheetName) => call('readSheetData', locationName, sheetName),
  updateAssetTypeSchema: (assetType, schema, excludeStationId) => 
    call('updateAssetTypeSchema', assetType, schema, excludeStationId),
  setStatusColor: (statusKey, color) => call('setStatusColor', statusKey, color),
  deleteStatusRow: (statusKey) => call('deleteStatusRow', statusKey),
  setSettingBoolean: (key, flag) => call('setSettingBoolean', key, !!flag),
  setLocationLink: (company, location, link) =>
    call('setLocationLink', company, location, link),
  setAssetTypeLink: (assetType, company, location, link) =>
    call('setAssetTypeLink', assetType, company, location, link),
  // Repairs (new single-sheet model)
  appendRepair: (location, assetType, repair) =>
    call('appendRepair', location, assetType, repair),
  listRepairsForStation: (location, assetType, stationId) =>
    call('listRepairsForStation', location, assetType, stationId),
  saveStationRepairs: (location, assetType, stationId, repairs) =>
    call('saveStationRepairs', location, assetType, stationId, repairs),
  getAllRepairs: () => call('getAllRepairs'),
  deleteRepair: (location, assetType, stationId, repairIndex) =>
    call('deleteRepair', location, assetType, stationId, repairIndex),
  // Inspection keywords (global list stored in lookups.xlsx)
  setInspectionKeywords: (keywords) =>
    call('setInspectionKeywords', Array.isArray(keywords) ? keywords : []),
  // NEW: Algorithm/Workplan
  getAlgorithmParameters: () => call('getAlgorithmParameters'),
  saveAlgorithmParameters: (rows) => call('saveAlgorithmParameters', rows),
  getWorkplanConstants: () => call('getWorkplanConstants'),
  saveWorkplanConstants: (rows) => call('saveWorkplanConstants', rows),
  getCustomWeights: () => call('getCustomWeights'),
  addCustomWeight: (weight, active) => call('addCustomWeight', weight, !!active),
  // Auth functions
  createAuthWorkbook: () => call('createAuthWorkbook'),
  createAuthUser: (userData) => call('createAuthUser', userData),
  loginAuthUser: (name, hashedPassword) => call('loginAuthUser', name, hashedPassword),
  logoutAuthUser: (name) => call('logoutAuthUser', name),
  getAllAuthUsers: () => call('getAllAuthUsers'),
  hasAuthUsers: () => call('hasAuthUsers'),
};