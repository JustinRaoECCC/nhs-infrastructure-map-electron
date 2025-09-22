const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os   = require('os');

// Import AFTER NHS_DATA_DIR is set so backends pick up the fast path.
const backend     = require('./backend/app');
const lookups     = require('./backend/lookups_repo');
const excelClient = require('./backend/excel_worker_client');
const nukeBackend = require('./backend/nuke');
const inspectionHistory = require('./backend/inspection_history');
const repairsBackend = require('./backend/repairs');

app.disableHardwareAcceleration();

async function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // Load UI immediately; heavy I/O happens after first paint
  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();

    // Kick off Excel load immediately after paint; progress goes to renderer
    setTimeout(() => {
      excelClient.warm().catch(err => console.error('[excel warm @show] failed:', err));
      lookups.ensureLookupsReady?.().catch(err => console.error('[ensure lookups @show] failed:', err));
      // also trigger a snapshot to finalize to 100%
      lookups.primeAllCaches?.().catch(err => console.error('[prime caches @show] failed:', err));
    }, 40);
  });
}

// Boot-time lookups bootstrap (runs as soon as the app is ready)
// - warms the worker thread
// - creates lookups.xlsx if missing (non-blocking)
// - primes caches
function bootstrapLookupsAtBoot() {
  // Start the worker immediately (non-blocking).
  excelClient.warm().catch(err => console.error('[excel warm @boot] failed:', err));

  // Fire-and-forget creation of the workbook + initial cache snapshot.
  Promise.resolve()
    .then(() => lookups.ensureLookupsReady?.())
    .then(() => lookups.primeAllCaches?.())
    .catch(err => console.error('[ensure lookups @boot] failed:', err));

  // Small failsafe retry in case the first attempt raced the worker startup.
  setTimeout(() => {
    lookups.ensureLookupsReady?.().catch(err => console.error('[ensure lookups @boot retry] failed:', err));
  }, 3000);
}

app.whenReady().then(() => {
  // Create folders immediately (sync, no ExcelJS)
  if (typeof lookups.ensureDataFoldersSync === 'function') {
    lookups.ensureDataFoldersSync();
  }
  bootstrapLookupsAtBoot();
  createWindow();

  // Forward worker progress to all windows
  excelClient.onProgress((data) => {
    try {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('excel:progress', data);
      }
    } catch (e) {
      console.error('[excel:progress forward] failed:', e);
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Warm the color cache ASAP without blocking the UI
  setTimeout(() => {
    lookups.primeAllCaches().catch(err => console.error('[prime lookups @800ms]', err));
  }, 800);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Stations ─────────────────────────────────────────────────────────
ipcMain.handle('stations:get', async (_evt, opts) => backend.getStationData(opts || {}));
ipcMain.handle('stations:importSelection', async (_evt, payload) => backend.addStationsFromSelection(payload));
ipcMain.handle('stations:invalidate', async () => backend.invalidateStationCache());

// ─── IPC: Manual Asset Creation ───────────────────────────────────────────
ipcMain.handle('manual:addInstance', async (_evt, payload) => backend.manualAddInstance(payload));

// ─── IPC: Lookups (reads) ──────────────────────────────────────────────────
ipcMain.handle('lookups:getActiveCompanies', async () => backend.getActiveCompanies());
ipcMain.handle('lookups:getLocationsForCompany', async (_evt, company) => backend.getLocationsForCompany(company));
ipcMain.handle('lookups:getAssetTypesForLocation', async (_evt, company, location) => backend.getAssetTypesForLocation(company, location));
ipcMain.handle('lookups:getTree', async () => backend.getLookupTree());

// ─── IPC: Lookups (writes) ─────────────────────────────────────────────────
ipcMain.handle('lookups:upsertCompany', async (_evt, name, active) => backend.upsertCompany(name, !!active));
ipcMain.handle('lookups:upsertLocation', async (_evt, location, company) => backend.upsertLocation(location, company));
ipcMain.handle('lookups:upsertAssetType', async (_evt, assetType, location) => backend.upsertAssetType(assetType, location));

// Colors
ipcMain.handle('getColorMaps', async () => {
  const maps = await lookups.getColorMaps();
  // Convert Maps to plain objects for IPC safety
  const toObj = (m) => Object.fromEntries(m instanceof Map ? m : new Map(Object.entries(m || {})));
  // byLocation
  const byLocObj = {};
  for (const [loc, inner] of (maps.byLocation instanceof Map ? maps.byLocation : new Map(Object.entries(maps.byLocation || {}))).entries()) {
    byLocObj[loc] = toObj(inner);
  }
  const byCoLocObj = {};
  for (const [co, locMapLike] of (maps.byCompanyLocation instanceof Map ? maps.byCompanyLocation : new Map(Object.entries(maps.byCompanyLocation || {}))).entries()) {
    const locMap = locMapLike instanceof Map ? locMapLike : new Map(Object.entries(locMapLike));
    byCoLocObj[co] = {};
    for (const [loc, inner] of locMap.entries()) byCoLocObj[co][loc] = toObj(inner);
  }
  return { global: toObj(maps.global), byLocation: byLocObj, byCompanyLocation: byCoLocObj };
});
ipcMain.handle('setAssetTypeColor', async (_, assetType, color) =>
  lookups.setAssetTypeColor(assetType, color)
);
ipcMain.handle('setAssetTypeColorForLocation', async (_, assetType, location, color) =>
  lookups.setAssetTypeColorForLocation(assetType, location, color)
);
// Allow saving colors at Company+Location granularity by encoding key as "COMPANY@@LOCATION"
ipcMain.handle('setAssetTypeColorForCompanyLocation', async (_evt, assetType, company, location, color) => {
  return lookups.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
});

// ─── IPC: Colors ───────────────────────────────────────────────────────────
ipcMain.handle('lookups:getAssetTypeColor', async (_evt, assetType) => backend.getAssetTypeColor(assetType));
ipcMain.handle('lookups:setAssetTypeColor', async (_evt, assetType, color) => backend.setAssetTypeColor(assetType, color));
ipcMain.handle('lookups:getAssetTypeColorForLocation', async (_evt, assetType, location) => backend.getAssetTypeColorForLocation(assetType, location));
ipcMain.handle('lookups:setAssetTypeColorForLocation', async (_evt, assetType, location, color) => backend.setAssetTypeColorForLocation(assetType, location, color));
ipcMain.handle('excel:listSheets', async (_evt, b64) => backend.listExcelSheets(b64));
ipcMain.handle('excel:parseRowsFromSheet', async (_evt, b64, sheetName) =>
  excelClient.parseRowsFromSheet(b64, sheetName)
);

ipcMain.handle('photos:getRecent', async (_evt, { siteName, stationId, limit }) =>
  backend.getRecentPhotos(siteName, stationId, limit)
);

ipcMain.handle('stations:update', async (_evt, stationData) => backend.updateStationData(stationData));

// Schema synchronization handlers
ipcMain.handle('schema:sync', async (_evt, assetType, schema, excludeStationId) => {
  const schemaSync = require('./backend/schema_sync');
  return schemaSync.syncAssetTypeSchema(assetType, schema, excludeStationId);
});

ipcMain.handle('schema:getExisting', async (_evt, assetType) => {
  const schemaSync = require('./backend/schema_sync');
  return schemaSync.getExistingSchemaForAssetType(assetType);
});

// Add handler for Excel worker's new functions
ipcMain.handle('excel:readLocationWorkbook', async (_evt, locationName) =>
  excelClient.readLocationWorkbook(locationName)
);

ipcMain.handle('excel:readSheetData', async (_evt, locationName, sheetName) =>
  excelClient.readSheetData(locationName, sheetName)
);

ipcMain.handle('excel:updateAssetTypeSchema', async (_evt, assetType, schema, excludeStationId) =>
  excelClient.updateAssetTypeSchema(assetType, schema, excludeStationId)
);

// ─── IPC: Inspections ─────────────────────────────────────────────────────
// Accept optional opts (e.g., { keywords: [...] }) and pass through to backend.
ipcMain.handle('inspections:list', async (_evt, siteName, stationId, opts) =>
  inspectionHistory.listInspections(siteName, stationId, 5, opts || {})
);

// ─── IPC: Inspection History Keywords (global, lookups.xlsx) ─────────────
ipcMain.handle('inspectionKeywords:get', async () =>
  lookups.getInspectionKeywords()
);
ipcMain.handle('inspectionKeywords:set', async (_evt, keywords) =>
  lookups.setInspectionKeywords(Array.isArray(keywords) ? keywords : [])
);

ipcMain.handle('inspections:delete', async (_evt, siteName, stationId, folderName) =>
  inspectionHistory.deleteInspectionFolder(siteName, stationId, folderName)
);

// ─── IPC: Inspections (pickers) ───────────────────────────────────────────
ipcMain.handle('inspections:pickPhotos', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select inspection photos',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg','jpeg','png','gif','webp','bmp','tif','tiff'] }
    ]
  });
  // Nudge focus back to our window (fixes occasional "can't type" after dialog)
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()?.[0];
    setTimeout(() => win?.focus(), 0);
  } catch(_) {}
  return canceled ? { filePaths: [] } : { filePaths };
});

ipcMain.handle('inspections:pickReport', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select inspection report (PDF)',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()?.[0];
    setTimeout(() => win?.focus(), 0);
  } catch(_) {}
  return canceled || !filePaths?.length ? { filePath: null } : { filePath: filePaths[0] };
});

// ─── IPC: Inspections (create) ────────────────────────────────────────────
ipcMain.handle('inspections:create', async (_evt, siteName, stationId, payload) =>
  inspectionHistory.createInspectionFolder(siteName, stationId, payload)
);

// ─── IPC: Repairs ─────────────────────────────────────────────────────────
ipcMain.handle('repairs:list', async (_evt, siteName, stationId) =>
  repairsBackend.listRepairs(siteName, stationId)
);
ipcMain.handle('repairs:save', async (_evt, siteName, stationId, items) =>
  repairsBackend.saveRepairs(siteName, stationId, items)
);

// ─── IPC: Nuke (delete .xlsx + cache, then relaunch) ───────────────────────
ipcMain.handle('nuke:run', async () => {
  try {
    const res = await nukeBackend.nuke();
    if (!res || res.success === false) return res || { success:false };
    app.relaunch();   // schedule relaunch
    app.exit(0);      // exit current instance
    return { success: true }; // likely not reached
  } catch (e) {
    return { success: false, message: String(e) };
  }
});

// ─── IPC: Status / Repair settings ─────────────────────────────────────────
ipcMain.handle('status:get', async () => lookups.getStatusAndRepairSettings());
ipcMain.handle('status:setColor', async (_evt, key, color) => lookups.setStatusColor(key, color));
ipcMain.handle('status:delete', async (_evt, key) => lookups.deleteStatus(key));
ipcMain.handle('status:setApply', async (_evt, flag) => lookups.setApplyStatusColors(!!flag));
ipcMain.handle('repair:setApply', async (_evt, flag) => lookups.setApplyRepairColors(!!flag));

// ─── IPC: UI Confirm (sync) ───────────────────────────────────────────────
ipcMain.on('ui:confirm:sync', (event, opts = {}) => {
  const { message = 'Are you sure?', title = 'Confirm' } = opts || {};
  const win = BrowserWindow.fromWebContents(event.sender);
  const response = dialog.showMessageBoxSync(win, {
    type: 'question',
    title,
    message,
    buttons: ['Cancel', 'OK'], // index 0 = Cancel, 1 = OK
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    normalizeAccessKeys: true,
  });
  // Nudge focus back to our window (rarely needed, but harmless)
  try {
    const w = win || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()?.[0];
    setTimeout(() => w?.focus(), 0);
  } catch (_) {}
  event.returnValue = (response === 1);
});

ipcMain.handle('lookups:setLocationLink', async (_evt, company, location, link) =>
  lookups.setLocationLink(company, location, link)
);
ipcMain.handle('lookups:setAssetTypeLink', async (_evt, assetType, company, location, link) =>
  lookups.setAssetTypeLink(assetType, company, location, link)
);

ipcMain.handle('getPhotosBase', async (_evt, ctx) => 
  lookups.getPhotosBase(ctx)
);

ipcMain.handle('browseForFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return { path: result.filePaths[0] };
  }
  return null;
});

// ─── IPC: Dashboard data + Excel helpers ───────────────────────────────────
ipcMain.handle('app:getStationData', async () => backend.getStationData({}));

ipcMain.handle('excel:importRepairsExcel', async (_e, b64) => {
  // first sheet rows
  return await excelClient.parseRows(b64);
});

// Algorithm Parameters / Constants / Custom Weights
// ─── Excel/dashboard IPC (new) ─────────────────────────────────────────────
ipcMain.handle('excel:getAlgorithmParameters', async () =>
  backend.getAlgorithmParameters()
);
ipcMain.handle('excel:saveAlgorithmParameters', async (_e, rows) =>
  backend.saveAlgorithmParameters(rows)
);
ipcMain.handle('excel:getWorkplanConstants', async () =>
  backend.getWorkplanConstants()
);
ipcMain.handle('excel:saveWorkplanConstants', async (_e, rows) =>
  backend.saveWorkplanConstants(rows)
);
ipcMain.handle('excel:getCustomWeights', async () =>
  backend.getCustomWeights()
);
ipcMain.handle('excel:addCustomWeight', async (_e, weight, active) =>
  backend.addCustomWeight(weight, active)
);

// Optimization I / II
ipcMain.handle('algo:optimizeWorkplan', async (_e, payload) => await backend.optimizeWorkplan(payload));
ipcMain.handle('algo:runGeographical', async (_e, payload) => await backend.runGeographicalAlgorithm(payload));