// backend/nuke.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const lookups = require('./lookups_repo'); // for DATA_DIR
const excelClient = require('./excel_worker_client');

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

// Delete a specific company and all its locations/assets
async function deleteCompany(companyName) {
  try {
    const DATA_DIR = lookups.DATA_DIR;
    const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
    
    // 1. Delete company directory and all its files
    const companyDir = path.join(COMPANIES_DIR, companyName);
    if (fs.existsSync(companyDir)) {
      await fsp.rm(companyDir, { recursive: true, force: true });
    }
    
    // 2. Remove from lookups.xlsx
    await excelClient.deleteCompanyFromLookups(companyName);
    
    // 3. Invalidate cache
    const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
    try { await fsp.unlink(cachePath); } catch (_) {}
    
    return { success: true };
  } catch (error) {
    console.error('[deleteCompany] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Delete a specific location and all its assets
async function deleteLocation(companyName, locationName) {
  try {
    const DATA_DIR = lookups.DATA_DIR;
    const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
    
    // 1. Delete location xlsx file
    const locationFile = path.join(COMPANIES_DIR, companyName, `${locationName}.xlsx`);
    if (fs.existsSync(locationFile)) {
      await fsp.unlink(locationFile);
    }
    
    // 2. Remove from lookups.xlsx
    await excelClient.deleteLocationFromLookups(companyName, locationName);
    
    // 3. Invalidate cache
    const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
    try { await fsp.unlink(cachePath); } catch (_) {}
    
    return { success: true };
  } catch (error) {
    console.error('[deleteLocation] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Delete a specific asset type
async function deleteAssetType(companyName, locationName, assetTypeName) {
  try {
    const DATA_DIR = lookups.DATA_DIR;
    
    // 1. Remove asset type data from location xlsx
    await excelClient.deleteAssetTypeFromLocation(companyName, locationName, assetTypeName);
    
    // 2. Remove from lookups.xlsx
    await excelClient.deleteAssetTypeFromLookups(companyName, locationName, assetTypeName);
    
    // 3. Invalidate cache
    const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
    try { await fsp.unlink(cachePath); } catch (_) {}
    
    return { success: true };
  } catch (error) {
    console.error('[deleteAssetType] Error:', error);
    return { success: false, message: String(error) };
  }
}

module.exports = { nuke, deleteCompany, deleteLocation, deleteAssetType };