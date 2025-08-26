// main.js

process.env.ELECTRON_DISABLE_SANDBOX = 'true';
process.env.ELECTRON_ENABLE_LOGGING = 'true';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
let backend = null;
const { ensureLeafletVendor } = require('./backend/vendor_bootstrap');
app.commandLine.appendSwitch('log-level', '2');

app.disableHardwareAcceleration();

function createWindow () {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    const res = await ensureLeafletVendor();
    if (!res.ok) console.warn('[vendor] Leaflet bootstrap did not complete:', res);
    else console.log('[vendor] Leaflet ready at', res.vendorDir);
  } catch (e) {
    console.warn('[vendor] ensureLeafletVendor failed:', e);
  }

  backend = require('./backend/app');
  // IPC wiring (map + list needs)
  ipcMain.handle('getStationData',              () => backend.getStationData());
  ipcMain.handle('importMultipleStations',      (_e, b64) => backend.importMultipleStations(b64));

  ipcMain.handle('getActiveCompanies',          () => backend.getActiveCompanies());
  ipcMain.handle('getLocationsForCompany',      (_e, company) => backend.getLocationsForCompany(company));
  ipcMain.handle('getAssetTypesForLocation',    (_e, { company, loc }) => backend.getAssetTypesForLocation(company, loc));

  ipcMain.handle('getAssetTypeColor',           (_e, at) => backend.getAssetTypeColor(at));
  ipcMain.handle('setAssetTypeColor',           (_e, { assetType, color }) => backend.setAssetTypeColor(assetType, color));
  ipcMain.handle('getAssetTypeColorForLocation',(_e, { assetType, loc }) => backend.getAssetTypeColorForLocation(assetType, loc));
  ipcMain.handle('setAssetTypeColorForLocation',(_e, { assetType, loc, color }) => backend.setAssetTypeColorForLocation(assetType, loc, color));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
