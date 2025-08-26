const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const backend = require('./backend/app');
const lookups = require('./backend/lookups_repo');

async function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  await lookups.ensureLookupsReady();
  await win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Stations ─────────────────────────────────────────────────────────
ipcMain.handle('stations:get', async () => backend.getStationData());
ipcMain.handle('stations:import', async (_evt, b64) => backend.importMultipleStations(b64));
ipcMain.handle('stations:invalidate', async () => backend.invalidateStationCache());

// ─── IPC: Lookups (reads) ──────────────────────────────────────────────────
ipcMain.handle('lookups:getActiveCompanies', async () => backend.getActiveCompanies());
ipcMain.handle('lookups:getLocationsForCompany', async (_evt, company) => backend.getLocationsForCompany(company));
ipcMain.handle('lookups:getAssetTypesForLocation', async (_evt, company, location) => backend.getAssetTypesForLocation(company, location));

// ─── IPC: Lookups (writes) ─────────────────────────────────────────────────
ipcMain.handle('lookups:upsertCompany', async (_evt, name, active) => backend.upsertCompany(name, !!active));
ipcMain.handle('lookups:upsertLocation', async (_evt, location, company) => backend.upsertLocation(location, company));
ipcMain.handle('lookups:upsertAssetType', async (_evt, assetType, location) => backend.upsertAssetType(assetType, location));

// ─── IPC: Colors ───────────────────────────────────────────────────────────
ipcMain.handle('lookups:getAssetTypeColor', async (_evt, assetType) => backend.getAssetTypeColor(assetType));
ipcMain.handle('lookups:setAssetTypeColor', async (_evt, assetType, color) => backend.setAssetTypeColor(assetType, color));
ipcMain.handle('lookups:getAssetTypeColorForLocation', async (_evt, assetType, location) => backend.getAssetTypeColorForLocation(assetType, location));
ipcMain.handle('lookups:setAssetTypeColorForLocation', async (_evt, assetType, location, color) => backend.setAssetTypeColorForLocation(assetType, location, color));