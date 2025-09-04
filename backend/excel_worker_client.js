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
};