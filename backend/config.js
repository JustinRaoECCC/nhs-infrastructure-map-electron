// backend/config.js
// Default UNC/base folder where station photo folders live
const DEFAULT_PHOTOS_BASE = '\\\\Ecbcv6cwvfsp001.ncr.int.ec.gc.ca\\msc$\\401\\WSCConstruction\\Stations';
// const DEFAULT_PHOTOS_BASE = 'C:\\Users\\nitsu\\OneDrive\\Documents\\Stations';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff'];

/**
 * Resolve the base folder using lookups.xlsx:
 * - If AssetTypes.link exists (for {company,location,assetType}) → use it
 * - else if Locations.link exists (for {company,location}) → use it
 * - else → DEFAULT_PHOTOS_BASE
 */
async function getPhotosBase(ctx = {}) {
  try {
    const lookups = require('./lookups_repo');
    const fromLookups = await lookups.getPhotosBase({
      company: ctx.company || '',
      location: ctx.location || '',
      assetType: ctx.assetType || '',
    });
    return fromLookups || DEFAULT_PHOTOS_BASE;
  } catch {
    return DEFAULT_PHOTOS_BASE;
  }
}

module.exports = {
  DEFAULT_PHOTOS_BASE,           // raw default (string)
  IMAGE_EXTS,                    // unchanged
  getPhotosBase,                 // async resolver (preferred)
  // keep a simple PHOTOS_BASE export for code that reads the constant
  PHOTOS_BASE: DEFAULT_PHOTOS_BASE,
};
