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
});