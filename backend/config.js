// backend/config.js
// Default UNC/base folder where station photo folders live

// BC - saved to easily copy paste into the application
// const DEFAULT_PHOTOS_BASE = '\\Ecbcv6cwvfsp001.ncr.int.ec.gc.ca\msc$\401\WSCConstruction\Stations';

// AB - saved to easily copy paste into the application
// const DEFAULT_PHOTOS_BASE = '\\int.ec.gc.ca\shares\ECCC\PVM\GV1\WSCInfrastructure\Stations_Alberta';

// Justin's PC - exists for debugging (because I am not on Justin's PC so this link fails)
const DEFAULT_PHOTOS_BASE = 'C:\Users\nitsu\OneDrive\Documents\Stations';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff'];

/**
 * Resolve the base folder using lookups.xlsx:
 * - If AssetTypes.link exists (for {company,location,assetType}) → use it
 * - else if Locations.link exists (for {company,location}) → use it
 * - else → DEFAULT_PHOTOS_BASE
 */
async function getPhotosBase(ctx = {}) {
  try {
    console.log(`[DEBUG config.getPhotosBase] Input ctx:`, ctx);
    const lookups = require('./lookups_repo');
    const fromLookups = await lookups.getPhotosBase({
      company: ctx.company || '',
      location: ctx.location || '',
      assetType: ctx.assetType || '',
    });
    console.log(`[DEBUG config.getPhotosBase] fromLookups result:`, fromLookups);
    console.log(`[DEBUG config.getPhotosBase] DEFAULT_PHOTOS_BASE:`, DEFAULT_PHOTOS_BASE);
    const result = fromLookups || DEFAULT_PHOTOS_BASE;
    console.log(`[DEBUG config.getPhotosBase] Final result:`, result);
    return result;
  } catch (e) {
    console.error(`[DEBUG config.getPhotosBase] Error:`, e);
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
