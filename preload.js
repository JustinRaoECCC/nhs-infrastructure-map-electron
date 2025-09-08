// preload.js
// Expose a minimal, explicit API surface to the renderer.
// (keeps the filter drawer non-persistent for now — no lookup READs)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Stations ────────────────────────────────────────────────────────────
  getStationData:         (opts) => ipcRenderer.invoke('stations:get', opts || {}),
  importMultipleStations: (b64) => ipcRenderer.invoke('stations:import', b64),
  invalidateStationCache: () => ipcRenderer.invoke('stations:invalidate'),

  // ─── Lookups (reads) ────────────────────────────────────────────────────
  // Drives the hierarchical filter tree (Company ▸ Locations ▸ Asset Types).
  // Lookups / colors
  getColorMaps:       () => ipcRenderer.invoke('getColorMaps'),
  setAssetTypeColor:  (assetType, color) => ipcRenderer.invoke('setAssetTypeColor', assetType, color),
  setAssetTypeColorForLocation: (assetType, location, color) => ipcRenderer.invoke('setAssetTypeColorForLocation', assetType, location, color),
  setAssetTypeColorForCompanyLocation: (assetType, company, location, color) =>
    ipcRenderer.invoke('setAssetTypeColorForCompanyLocation', assetType, company, location, color),
  getLookupTree:          ()      => ipcRenderer.invoke('lookups:getTree'),

  // ─── Lookups (writes only — used by Add Infrastructure wizard) ──────────
  upsertCompany:  (name, active = true)       => ipcRenderer.invoke('lookups:upsertCompany', name, !!active),
  upsertLocation: (location, company)         => ipcRenderer.invoke('lookups:upsertLocation', location, company),
  upsertAssetType:(assetType, location)       => ipcRenderer.invoke('lookups:upsertAssetType', assetType, location),

  // ─── Excel helper for Step 3 sheet picker ───────────────────────────────
  excelListSheets: (b64)                      => ipcRenderer.invoke('excel:listSheets', b64),
  excelParseRowsFromSheet: (b64, sheetName)   => ipcRenderer.invoke('excel:parseRowsFromSheet', b64, sheetName),

  // ─── Boot progress from the worker (UI progress bar) ────────────────────
  onExcelProgress: (handler) => {
    const listener = (_evt, payload) => { try { handler(payload); } catch (_) {} };
    ipcRenderer.on('excel:progress', listener);
    // return an unsubscribe in case you want to detach later
    return () => ipcRenderer.removeListener('excel:progress', listener);
  },

  // ─── Selections → file + pins ───────────────────────────────────────────
  importSelection: (payload) => ipcRenderer.invoke('stations:importSelection', payload),

  getRecentPhotos: (siteName, stationId, limit = 5) =>
    ipcRenderer.invoke('photos:getRecent', { siteName, stationId, limit }),

  // ─── Station Updates ─────────────────────────────────────────────────────
  updateStationData: (stationData) => ipcRenderer.invoke('stations:update', stationData),

  // Schema synchronization
  syncAssetTypeSchema: (assetType, schema, excludeStationId) => 
    ipcRenderer.invoke('schema:sync', assetType, schema, excludeStationId),
    
  getExistingSchema: (assetType) => 
    ipcRenderer.invoke('schema:getExisting', assetType),

  // Excel worker extensions
  readLocationWorkbook: (locationName) =>
    ipcRenderer.invoke('excel:readLocationWorkbook', locationName),
    
  readSheetData: (locationName, sheetName) =>
    ipcRenderer.invoke('excel:readSheetData', locationName, sheetName),
    
  updateAssetTypeSchema: (assetType, schema, excludeStationId) =>
    ipcRenderer.invoke('excel:updateAssetTypeSchema', assetType, schema, excludeStationId),

  // ─── Inspections ─────────────────────────────────────────────────────────
  listInspections: (siteName, stationId) =>
    ipcRenderer.invoke('inspections:list', siteName, stationId),

  deleteInspection: (siteName, stationId, folderName) =>
    ipcRenderer.invoke('inspections:delete', siteName, stationId, folderName),

});