// backend/nuke.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const lookups = require('./lookups_repo'); // for DATA_DIR

function isXlsx(name) {
  return /\.xlsx$/i.test(name);
}

async function deleteXlsxRecursive(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) {
        await deleteXlsxRecursive(full);
      } else if (ent.isFile() && isXlsx(ent.name)) {
        await fsp.unlink(full).catch(() => {});
      }
    } catch (_) { /* best-effort */ }
  }
}

async function nuke() {
  const DATA_DIR = lookups.DATA_DIR;
  if (!DATA_DIR) {
    return { success: false, message: 'DATA_DIR not resolved' };
  }

  // 1) Delete all .xlsx files under data/ recursively
  await deleteXlsxRecursive(DATA_DIR);

  // 2) Delete cache file
  const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
  try { await fsp.unlink(cachePath); } catch (_) {}

  return { success: true };
}

module.exports = { nuke };
