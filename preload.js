// (no-op or existing code)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Stations
  getStationData:            () => ipcRenderer.invoke('stations:get'),
  importMultipleStations:    (b64) => ipcRenderer.invoke('stations:import', b64),
  invalidateStationCache:    () => ipcRenderer.invoke('stations:invalidate'),

  // Lookups (reads)
  getActiveCompanies:        () => ipcRenderer.invoke('lookups:getActiveCompanies'),
  getLocationsForCompany:    (company) => ipcRenderer.invoke('lookups:getLocationsForCompany', company),
  getAssetTypesForLocation:  (company, location) => ipcRenderer.invoke('lookups:getAssetTypesForLocation', company, location),

  // Lookups (writes)
  upsertCompany:             (name, active=true) => ipcRenderer.invoke('lookups:upsertCompany', name, active),
  upsertLocation:            (location, company) => ipcRenderer.invoke('lookups:upsertLocation', location, company),
  upsertAssetType:           (assetType, location) => ipcRenderer.invoke('lookups:upsertAssetType', assetType, location),

  // Colors
  getAssetTypeColor:         (assetType) => ipcRenderer.invoke('lookups:getAssetTypeColor', assetType),
  setAssetTypeColor:         (assetType, color) => ipcRenderer.invoke('lookups:setAssetTypeColor', assetType, color),
  getAssetTypeColorForLocation: (assetType, location) => ipcRenderer.invoke('lookups:getAssetTypeColorForLocation', assetType, location),
  setAssetTypeColorForLocation: (assetType, location, color) => ipcRenderer.invoke('lookups:setAssetTypeColorForLocation', assetType, location, color),
});
