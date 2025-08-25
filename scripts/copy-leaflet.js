// scripts/copy-leaflet.js

// Copy Leaflet assets into the renderer so paths always resolve in Electron
const path = require('path');
const fse = require('fs-extra');

const src  = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist');
const dest = path.join(__dirname, '..', 'frontend', 'vendor', 'leaflet');

(async () => {
  try {
    await fse.ensureDir(dest);
    await fse.copy(src, dest, { overwrite: true });
    console.log('[postinstall] Copied Leaflet → frontend/vendor/leaflet');
  } catch (e) {
    console.warn('[postinstall] Failed to copy Leaflet:', e.message);
  }
})();