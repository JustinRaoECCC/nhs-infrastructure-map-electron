// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// simple in-preload cache so we don't spam disk
let stationCache = null;

contextBridge.exposeInMainWorld('electronAPI', {
  // Stations
  async getStationData() {
    if (!stationCache) stationCache = await ipcRenderer.invoke('getStationData');
    return stationCache;
  },
  invalidateStationCache() { stationCache = null; },

  // Import
  importMultipleStations: (b64) => ipcRenderer.invoke('importMultipleStations', b64),

  // Filters / Lookups
  getActiveCompanies:       ()                 => ipcRenderer.invoke('getActiveCompanies'),
  getLocationsForCompany:   (company)          => ipcRenderer.invoke('getLocationsForCompany', company),
  getAssetTypesForLocation: (company, loc)     => ipcRenderer.invoke('getAssetTypesForLocation', { company, loc }),

  // Colors (global)
  getAssetTypeColor:  (assetType)              => ipcRenderer.invoke('getAssetTypeColor', assetType),
  setAssetTypeColor:  (assetType, color)       => ipcRenderer.invoke('setAssetTypeColor', { assetType, color }),

  // Colors (per location)
  getAssetTypeColorForLocation: (assetType, loc)    => ipcRenderer.invoke('getAssetTypeColorForLocation', { assetType, loc }),
  setAssetTypeColorForLocation: ({assetType, loc, color}) =>
      ipcRenderer.invoke('setAssetTypeColorForLocation', { assetType, loc, color }),
});
