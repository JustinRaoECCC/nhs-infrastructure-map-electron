// main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os   = require('os');

// Import AFTER NHS_DATA_DIR is set so backends pick up the fast path.
const backend     = require('./backend/app');
const algorithms  = require('./backend/algorithms');
const lookups     = require('./backend/lookups_repo');
const nukeBackend = require('./backend/nuke');
const inspectionHistory = require('./backend/inspection_history');
const projectHistory = require('./backend/project_history');
const repairsBackend = require('./backend/repairs');
const auth = require('./backend/auth');
// Persistence layer (MongoDB / Excel)
const config = require('./backend/config');
const { getPersistence } = require('./backend/persistence');
const testConfig = require('./backend/config_test_algorithm');

const photoTab = require('./backend/photo_tab');

const documentsTab = require('./backend/documents_tab');
const { shell } = require('electron');

// Lazy-load excel_worker_client to avoid starting the worker thread on import
let excelClient = null;
function getExcelClient() {
  if (!excelClient) {
    console.log('[Main] Lazy-loading excel_worker_client');
    excelClient = require('./backend/excel_worker_client');
  }
  return excelClient;
}

app.disableHardwareAcceleration();

let mainWindow = null;
let loginWindow = null;

async function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 500,
    height: 700,
    show: false,
    resizable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  loginWindow.loadFile(path.join(__dirname, 'frontend', 'login.html'));
  
  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
  });

  loginWindow.on('closed', () => {
    loginWindow = null;
  });
}

async function createWindow () {
  mainWindow = new BrowserWindow({
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
  mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Kick off data load immediately after paint
    setTimeout(() => {
      const dbConfig = config.getDbConfig();
      const useExcel = dbConfig.read?.source === 'excel' ||
                       (dbConfig.write?.targets || []).includes('excel');

      if (useExcel) {
        const excel = getExcelClient();
        excel.warm().catch(err => console.error('[excel warm @show] failed:', err));
        lookups.ensureLookupsReady?.().catch(err => console.error('[ensure lookups @show] failed:', err));
        // Normalize Funding Override blanks at startup (safe, idempotent)
        excel.normalizeFundingOverrides?.().catch(err => console.error('[normalizeFundingOverrides @show] failed:', err));
      }

      // Always trigger cache snapshot to finalize loading
      lookups.primeAllCaches?.().catch(err => console.error('[prime caches @show] failed:', err));
    }, 40);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    auth.logoutUser();
    app.quit();
  });

}

// Boot-time lookups bootstrap (runs as soon as the app is ready)
// - warms the worker thread (only if using Excel)
// - creates lookups.xlsx if missing (non-blocking)
// - primes caches
function bootstrapLookupsAtBoot(useExcel = true) {
  if (useExcel) {
    const excel = getExcelClient();
    // Start the worker immediately (non-blocking).
    excel.warm().catch(err => console.error('[excel warm @boot] failed:', err));

    // Fire-and-forget creation of the workbook + initial cache snapshot.
    Promise.resolve()
      .then(() => lookups.ensureLookupsReady?.())
      .then(() => lookups.primeAllCaches?.())
      .catch(err => console.error('[ensure lookups @boot] failed:', err));

    // Small failsafe retry in case the first attempt raced the worker startup.
    setTimeout(() => {
      lookups.ensureLookupsReady?.().catch(err => console.error('[ensure lookups @boot retry] failed:', err));
    }, 3000);
  } else {
    // MongoDB mode - just prime caches without Excel worker
    console.log('[Main] Using MongoDB - skipping Excel worker initialization');
    Promise.resolve()
      .then(() => lookups.primeAllCaches?.())
      .catch(err => console.error('[prime caches @boot] failed:', err));
  }
}

app.whenReady().then(async () => {
  // Initialize persistence layer (MongoDB / Excel based on config)
  let dbConfig;
  let useExcel = true;

  try {
    dbConfig = config.getDbConfig();
    console.log('[Main] Database config:', {
      readFrom: dbConfig.read?.source,
      writeTo: dbConfig.write?.targets
    });

    // Determine if we need Excel worker
    useExcel = dbConfig.read?.source === 'excel' ||
               (dbConfig.write?.targets || []).includes('excel');

    console.log(`[Main] Excel worker ${useExcel ? 'ENABLED' : 'DISABLED'}`);

    // Initialize persistence layer (will connect to MongoDB if configured)
    await getPersistence();
    console.log('[Main] Persistence layer initialized successfully');
  } catch (error) {
    console.error('[Main] Persistence initialization error:', error);
    console.log('[Main] Note: The app will attempt to use Excel by default');
  }

  // Create folders immediately (sync, no ExcelJS)
  if (typeof lookups.ensureDataFoldersSync === 'function') {
    lookups.ensureDataFoldersSync();
  }
  bootstrapLookupsAtBoot(useExcel);

  // Also normalize funding overrides in the background at boot (only if using Excel)
  if (useExcel) {
    try { getExcelClient().normalizeFundingOverrides?.(); } catch (_) {}
  }

  // Initialize auth and decide which window to show
  auth.initAuthWorkbook()
    .then((res) => {
      if (res && res.disabled) {
        // Auth disabled: go straight to main window
        createWindow();
      } else {
        createLoginWindow();
      }
    })
    .catch(e => {
      console.error('[auth.initAuthWorkbook] failed:', e);
      // On error, fallback to login window
      createLoginWindow();
    });

  // Forward worker progress to all windows (only if Excel is enabled)
  if (useExcel) {
    const excel = getExcelClient();
    excel.onProgress((data) => {
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send('excel:progress', data);
        }
      } catch (e) {
        console.error('[excel:progress forward] failed:', e);
      }
    });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createLoginWindow();
  });

  // Warm the cache ASAP without blocking the UI (MongoDB or Excel)
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
ipcMain.handle('lookups:upsertAssetType', async (_evt, assetType, company, location) => backend.upsertAssetType(assetType, company, location));

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
  getExcelClient().parseRowsFromSheet(b64, sheetName)
);

ipcMain.handle('photos:getRecent', async (_evt, { siteName, stationId, limit }) =>
  backend.getRecentPhotos(siteName, stationId, limit)
);

ipcMain.handle('stations:update', async (_evt, stationData, schema) => backend.updateStationData(stationData, schema));

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
ipcMain.handle('excel:readLocationWorkbook', async (_evt, company, locationName) =>
  getExcelClient().readLocationWorkbook(company, locationName)
);

ipcMain.handle('excel:readSheetData', async (_evt, company, locationName, sheetName) =>
  getExcelClient().readSheetData(company, locationName, sheetName)
);

ipcMain.handle('excel:updateAssetTypeSchema', async (_evt, assetType, schema, excludeStationId) =>
  getExcelClient().updateAssetTypeSchema(assetType, schema, excludeStationId)
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

// ─── IPC: Projects ────────────────────────────────────────────────────────
ipcMain.handle('projects:list', async (_evt, siteName, stationId, opts) =>
  projectHistory.listProjects(siteName, stationId, 5, opts || {})
);

// ─── IPC: Project History Keywords (global, lookups.xlsx) ─────────────────
ipcMain.handle('projectKeywords:get', async () =>
  lookups.getProjectKeywords()
);
ipcMain.handle('projectKeywords:set', async (_evt, keywords) =>
  lookups.setProjectKeywords(Array.isArray(keywords) ? keywords : [])
);

ipcMain.handle('projects:delete', async (_evt, siteName, stationId, folderName) =>
  projectHistory.deleteProjectFolder(siteName, stationId, folderName)
);

// ─── IPC: Projects (pickers) ──────────────────────────────────────────────
ipcMain.handle('projects:pickPhotos', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select project photos',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg','jpeg','png','gif','webp','bmp','tif','tiff'] }
    ]
  });
  try {
    const win = BrowserWindow.getFocusedWindow();
    setTimeout(() => win?.focus(), 0);
  } catch(_) {}
  return canceled ? { filePaths: [] } : { filePaths };
});

ipcMain.handle('projects:pickReport', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select project report (PDF)',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  try {
    const win = BrowserWindow.getFocusedWindow();
    setTimeout(() => win?.focus(), 0);
  } catch(_) {}
  return canceled || !filePaths?.length ? { filePath: null } : { filePath: filePaths[0] };
});

// ─── IPC: Projects (create) ───────────────────────────────────────────────
ipcMain.handle('projects:create', async (_evt, siteName, stationId, payload) =>
  projectHistory.createProjectFolder(siteName, stationId, payload)
);

// ─── IPC: Repairs ─────────────────────────────────────────────────────────
ipcMain.handle('repairs:list', async (_evt, siteName, stationId) =>
  repairsBackend.listRepairs(siteName, stationId)
);
ipcMain.handle('repairs:save', async (_evt, siteName, stationId, items) =>
  repairsBackend.saveRepairs(siteName, stationId, items)
);

ipcMain.handle('repairs:getAll', async () =>
  repairsBackend.getAllRepairs()
);
ipcMain.handle('repairs:add', async (_evt, location, assetType, repair) =>
  repairsBackend.addRepair(location, assetType, repair)
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
  return await getExcelClient().parseRows(b64);
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

// Fixed Parameters (for Optimization I constraint filtering)
ipcMain.handle('excel:getFixedParameters', async () =>
  backend.getFixedParameters()
);
ipcMain.handle('excel:saveFixedParameters', async (_e, params) =>
  backend.saveFixedParameters(params)
);

// Optimization I / II (now call the dedicated algorithms module)
ipcMain.handle('algo:optimizeWorkplan', async (_e, payload) => algorithms.optimizeWorkplan(payload));
ipcMain.handle('algo:groupRepairsIntoTrips', async (_e, payload) => algorithms.groupRepairsIntoTrips(payload));
ipcMain.handle('algo:assignTripsToYears', async (_e, payload) => algorithms.assignTripsToYears(payload));

// ─── IPC: Database Config ──────────────────────────────────────────────────
ipcMain.handle('db:getConfig', async () => {
  const dbConfig = config.getDbConfig();
  return {
    readSource: dbConfig.read?.source || 'excel',
    writeTargets: dbConfig.write?.targets || ['excel']
  };
});

// ─── IPC: Test Algorithm Config ────────────────────────────────────────────
ipcMain.handle('test:getTabEnabled', async () => {
  return testConfig.TEST_TAB_ENABLED;
});

// ─── IPC: Authentication ───────────────────────────────────────────────────
ipcMain.handle('auth:hasUsers', async () => auth.hasUsers());
ipcMain.handle('auth:createUser', async (_evt, userData) => auth.createUser(userData));
ipcMain.handle('auth:login', async (_evt, name, password) => auth.loginUser(name, password));
ipcMain.handle('auth:logout', async () => auth.logoutUser());
ipcMain.handle('auth:getCurrentUser', async () => auth.getCurrentUser());
ipcMain.handle('auth:getAllUsers', async () => auth.getAllUsers());

ipcMain.handle('auth:navigateToMain', async () => {
  if (loginWindow) {
    loginWindow.close();
  }
  createWindow();
});

ipcMain.handle('append-repair', async (event, payload) => {
  return await backend.appendRepair(payload);
});

ipcMain.handle('excel:getFundingSettings', async (_evt, company, location) =>
  getExcelClient().getFundingSettings(company, location)
);
ipcMain.handle('excel:saveFundingSettings', async (_evt, company, location, settings) =>
  getExcelClient().saveFundingSettings(company, location, settings)
);
ipcMain.handle('excel:saveFundingSettingsForAssetType', async (_evt, company, location, assetType, settings) =>
  getExcelClient().saveFundingSettingsForAssetType(company, location, assetType, settings)
);
ipcMain.handle('excel:getAllFundingSettings', async (_evt, company) =>
  getExcelClient().getAllFundingSettings(company)
);

// Field catalog for dropdowns (scans data/companies/<company>/<location>.xlsx)
ipcMain.handle('excel:getWorkbookFieldCatalog', async (_evt, company, locationName) =>
  getExcelClient().getWorkbookFieldCatalog(company, locationName)
);

// Get station photo structure
ipcMain.handle('getStationPhotoStructure', async (event, siteName, stationId, subPath) => {
  try {
    return await photoTab.getStationPhotoStructure(siteName, stationId, subPath);
  } catch (e) {
    console.error('[IPC] getStationPhotoStructure failed:', e);
    return { success: false, message: String(e) };
  }
});

// Create photo folder
ipcMain.handle('createPhotoFolder', async (event, siteName, stationId, folderPath) => {
  try {
    return await photoTab.createPhotoFolder(siteName, stationId, folderPath);
  } catch (e) {
    console.error('[IPC] createPhotoFolder failed:', e);
    return { success: false, message: String(e) };
  }
});

// Save photos
ipcMain.handle('savePhotos', async (event, siteName, stationId, folderPath, files) => {
  try {
    return await photoTab.savePhotos(siteName, stationId, folderPath, files);
  } catch (e) {
    console.error('[IPC] savePhotos failed:', e);
    return { success: false, message: String(e) };
  }
});

// Get photo URL
ipcMain.handle('getPhotoUrl', async (event, siteName, stationId, photoPath) => {
  try {
    return await photoTab.getPhotoUrl(siteName, stationId, photoPath);
  } catch (e) {
    console.error('[IPC] getPhotoUrl failed:', e);
    return { success: false, message: String(e) };
  }
});

// Delete photo
ipcMain.handle('deletePhoto', async (event, siteName, stationId, photoPath) => {
  try {
    return await photoTab.deletePhoto(siteName, stationId, photoPath);
  } catch (e) {
    console.error('[IPC] deletePhoto failed:', e);
    return { success: false, message: String(e) };
  }
});

// Delete folder
ipcMain.handle('deleteFolder', async (event, siteName, stationId, folderPath) => {
  try {
    return await photoTab.deleteFolder(siteName, stationId, folderPath);
  } catch (e) {
    console.error('[IPC] deleteFolder failed:', e);
    return { success: false, message: String(e) };
  }
});

// Get station document structure
ipcMain.handle('getStationDocumentStructure', async (event, siteName, stationId, subPath) => {
  try {
    return await documentsTab.getStationDocumentStructure(siteName, stationId, subPath);
  } catch (e) {
    console.error('[IPC] getStationDocumentStructure failed:', e);
    return { success: false, message: String(e) };
  }
});

// Create document folder
ipcMain.handle('createDocumentFolder', async (event, siteName, stationId, folderPath) => {
  try {
    return await documentsTab.createDocumentFolder(siteName, stationId, folderPath);
  } catch (e) {
    console.error('[IPC] createDocumentFolder failed:', e);
    return { success: false, message: String(e) };
  }
});

// Save documents
ipcMain.handle('saveDocuments', async (event, siteName, stationId, folderPath, files) => {
  try {
    return await documentsTab.saveDocuments(siteName, stationId, folderPath, files);
  } catch (e) {
    console.error('[IPC] saveDocuments failed:', e);
    return { success: false, message: String(e) };
  }
});

// Open document in default application
ipcMain.handle('openDocument', async (event, siteName, stationId, docPath) => {
  try {
    const result = await documentsTab.getDocumentPath(siteName, stationId, docPath);
    if (result.success) {
      await shell.openPath(result.path);
      return { success: true };
    }
    return result;
  } catch (e) {
    console.error('[IPC] openDocument failed:', e);
    return { success: false, message: String(e) };
  }
});

// Reveal document in file explorer
ipcMain.handle('revealDocument', async (event, siteName, stationId, docPath) => {
  try {
    const result = await documentsTab.getDocumentPath(siteName, stationId, docPath);
    if (result.success) {
      shell.showItemInFolder(result.path);
      return { success: true };
    }
    return result;
  } catch (e) {
    console.error('[IPC] revealDocument failed:', e);
    return { success: false, message: String(e) };
  }
});

// Delete document
ipcMain.handle('deleteDocument', async (event, siteName, stationId, docPath) => {
  try {
    return await documentsTab.deleteDocument(siteName, stationId, docPath);
  } catch (e) {
    console.error('[IPC] deleteDocument failed:', e);
    return { success: false, message: String(e) };
  }
});

// Delete folder
ipcMain.handle('deleteDocumentFolder', async (event, siteName, stationId, folderPath) => {
  try {
    return await documentsTab.deleteDocumentFolder(siteName, stationId, folderPath);
  } catch (e) {
    console.error('[IPC] deleteDocumentFolder failed:', e);
    return { success: false, message: String(e) };
  }
});

ipcMain.handle('assignRepairsToYearsIndividually', async (event, params) => {
  return await algorithms.assignRepairsToYearsIndividually(params);
});

ipcMain.handle('groupTripsWithinYears', async (event, params) => {
  return await algorithms.groupTripsWithinYears(params);
});