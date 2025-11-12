// backend/schema_sync.js
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.NHS_DATA_DIR || path.join(__dirname, '..', 'data');
const COMPANIES_DIR = path.join(DATA_DIR, 'companies');

/**
 * Extract schema (sections and fields) from station data
 * Excludes General Information fields and values
 */
function extractSchema(stationData) {
  const schema = {
    sections: [],
    fields: []
  };
  
  const SEP = ' – ';
  const processedFields = new Set();
  
  Object.keys(stationData).forEach(key => {
    if (!key.includes(SEP)) return;
    
    const [section, field] = key.split(SEP, 2);
    const sectionNorm = String(section).trim();
    const fieldNorm = String(field).trim();
    
    // Skip General Information fields
    if (sectionNorm.toLowerCase() === 'general information') return;
    
    const fieldKey = `${sectionNorm}${SEP}${fieldNorm}`;
    if (!processedFields.has(fieldKey)) {
      schema.sections.push(sectionNorm);
      schema.fields.push(fieldNorm);
      processedFields.add(fieldKey);
    }
  });
  
  return schema;
}

/**
 * Get all location Excel files
 */
function getLocationFiles() {
  try {
    if (!fs.existsSync(COMPANIES_DIR)) return [];
    
    const result = [];
    
    // Traverse companies directory
    const companies = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    
    for (const companyDir of companies) {
      const companyPath = path.join(COMPANIES_DIR, companyDir.name);
      const locationFiles = fs.readdirSync(companyPath)
        .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
      
      for (const file of locationFiles) {
        result.push({

          fileName: file,
          locationName: file.replace('.xlsx', ''),
          company: companyDir.name,
          fullPath: path.join(companyPath, file)
        });
      }
    }
    
    return result;
  } catch (e) {
    console.error('[getLocationFiles] Error:', e);
    return [];
  }
}

/**
 * Synchronize schema for an asset type across ALL locations and companies
 * This is called after a station edit is saved (Functionality A)
 */
async function syncAssetTypeSchema(assetType, updatedSchema, sourceStationId) {
  const excel = require('./excel_worker_client');
  const results = {
    success: true,
    locationsUpdated: [],
    errors: [],
    stationsUpdated: 0,
    sheetsProcessed: []
  };
  
  console.log(`[syncAssetTypeSchema] Starting sync for asset type: ${assetType}`);
  console.log(`[syncAssetTypeSchema] Schema to apply:`, updatedSchema);
  
  try {
    // Get ALL location files
    const locationFiles = getLocationFiles();
    console.log(`[syncAssetTypeSchema] Found ${locationFiles.length} location files across all companies`);
    
    for (const locFile of locationFiles) {
      try {
        console.log(`[syncAssetTypeSchema] Processing: ${locFile.company}/${locFile.locationName}`);
        
        // Read the entire workbook to get all sheets
        const wb = await excel.readLocationWorkbook(locFile.company, locFile.locationName);
        if (!wb.success || !wb.sheets) {
          console.log(`[syncAssetTypeSchema] Could not read workbook for ${locFile.company}/${locFile.locationName}`);
          continue;
        }
        
        console.log(`[syncAssetTypeSchema] Sheets in ${locFile.company}/${locFile.fileName}:`, wb.sheets);
        
        // Process each sheet that might contain our asset type
        for (const sheetName of wb.sheets) {
          // Check if this sheet is for our asset type
          // Sheet names are like "Cableway BC" - case insensitive check
          const sheetLower = sheetName.toLowerCase();
          const assetLower = assetType.toLowerCase();
          
          // Check if sheet starts with the asset type (case insensitive)
          if (!sheetLower.startsWith(assetLower)) {
            console.log(`[syncAssetTypeSchema] Skipping sheet ${sheetName} - doesn't match ${assetType}`);
            continue;
          }
          
          console.log(`[syncAssetTypeSchema] Processing sheet: ${sheetName}`);
          
          // Read all stations from this sheet
          const sheetData = await excel.readSheetData(locFile.company, locFile.locationName, sheetName);
          if (!sheetData.success || !sheetData.rows || sheetData.rows.length === 0) {
            console.log(`[syncAssetTypeSchema] No data in sheet ${sheetName}`);
            continue;
          }
          
          console.log(`[syncAssetTypeSchema] Found ${sheetData.rows.length} stations in ${sheetName}`);
          
          // Update each station's schema (except the source station)
          for (const station of sheetData.rows) {
            const stationId = station['Station ID'] || station['station_id'] || station['StationID'] || station['ID'];
            
            // Skip the station that triggered this update
            if (String(stationId) === String(sourceStationId)) {
              console.log(`[syncAssetTypeSchema] Skipping source station: ${stationId}`);
              continue;
            }
            
            console.log(`[syncAssetTypeSchema] Updating station: ${stationId}`);
            
            // Apply schema changes
            const updatedStation = applySchemaToStation(station, updatedSchema);
            
            // Save the updated station back to Excel
            const updateResult = await excel.updateStationInLocationFile(
              locFile.company, locFile.locationName,
              stationId,
              updatedStation,
              updatedSchema
            );
            
            if (updateResult.success) {
              results.stationsUpdated++;
              console.log(`[syncAssetTypeSchema] Successfully updated station: ${stationId}`);
            } else {
              console.error(`[syncAssetTypeSchema] Failed to update station ${stationId}:`, updateResult.message);
            }
          }
          
          results.sheetsProcessed.push(`${locFile.company}/${locFile.locationName}/${sheetName}`);
        }
        
        if (results.sheetsProcessed.length > 0) {
          results.locationsUpdated.push(locFile.locationName);
        }
        
      } catch (locError) {
        console.error(`[syncAssetTypeSchema] Error processing ${locFile.company}/${locFile.fileName}:`, locError);
        results.errors.push({
          location: `${locFile.company}/${locFile.locationName}`,
          error: String(locError)
        });
      }
    }
    
    results.message = `Updated ${results.stationsUpdated} stations across ${results.locationsUpdated.length} locations`;
    console.log(`[syncAssetTypeSchema] Completed:`, results.message);
    
  } catch (error) {
    console.error('[syncAssetTypeSchema] Fatal error:', error);
    results.success = false;
    results.errors.push({
      location: 'general',
      error: String(error)
    });
  }
  
  return results;
}

/**
 * Apply a schema to a station, preserving values but updating structure
 */
function applySchemaToStation(stationData, schema) {
  const updated = {};
  const SEP = ' – ';
  
  // First, copy all non-section fields and General Information fields
  Object.keys(stationData).forEach(key => {
    if (!key.includes(SEP)) {
      // Simple field (not in a section)
      updated[key] = stationData[key];
    } else {
      // Check if it's General Information
      const [section] = key.split(SEP, 2);
      if (section.toLowerCase() === 'general information') {
        updated[key] = stationData[key];
      }
    }
  });
  
  // Now add all fields from the schema
  schema.sections.forEach((section, index) => {
    const field = schema.fields[index];
    const compositeKey = `${section}${SEP}${field}`;
    
    // Try to find existing value for this field
    let value = '';
    
    // First, check if we have the exact composite key
    if (stationData[compositeKey] !== undefined) {
      value = stationData[compositeKey];
    } else {
      // Look for the field under any section
      Object.keys(stationData).forEach(key => {
        if (key.includes(SEP)) {
          const [, existingField] = key.split(SEP, 2);
          if (existingField === field && value === '') {
            value = stationData[key];
          }
        }
      });
      
      // Also check if the field exists without a section
      if (value === '' && stationData[field] !== undefined) {
        value = stationData[field];
      }
    }
    
    updated[compositeKey] = value;
  });
  
  return updated;
}

/**
 * Get the schema from existing stations of the given asset type
 * Searches across ALL locations
 * @param {string} assetType - The asset type to search for
 * @param {string[]} [stationIdsToExclude] - Optional array of station IDs to skip (e.g., those being imported)
 */
async function getExistingSchemaForAssetType(assetType, stationIdsToExclude = []) {
  const excel = require('./excel_worker_client');
  const excludeSet = new Set(stationIdsToExclude.map(String));
  
  console.log(`[getExistingSchemaForAssetType] Looking for existing schema for: ${assetType}`);
  console.log(`[getExistingSchemaForAssetType] Excluding ${excludeSet.size} IDs`);
  
  try {
    const locationFiles = getLocationFiles();
    console.log(`[getExistingSchemaForAssetType] Searching in ${locationFiles.length} location files`);
    
    for (const locFile of locationFiles) {
      const wb = await excel.readLocationWorkbook(locFile.company, locFile.locationName);
      if (!wb.success || !wb.sheets) continue;
      
      for (const sheetName of wb.sheets) {
        // Case-insensitive check for asset type
        const sheetLower = sheetName.toLowerCase();
        const assetLower = assetType.toLowerCase();
        
        if (!sheetLower.startsWith(assetLower)) continue;
        
        console.log(`[getExistingSchemaForAssetType] Found matching sheet: ${sheetName} in ${locFile.locationName}`);
        
        // Read the first station from this sheet
        const sheetData = await excel.readSheetData(locFile.company, locFile.locationName, sheetName);
        if (!sheetData.success || !sheetData.rows || sheetData.rows.length === 0) {
          continue;
        }
        
        // Find the first station on this sheet that is NOT in our exclude list
        for (const station of sheetData.rows) {
          const stationId = station['Station ID'] || station['station_id'] || station['StationID'] || station['ID'];
          
          if (stationId && !excludeSet.has(String(stationId))) {
            // Found a valid, existing station. This is our master schema.
            const schema = extractSchema(station);
            console.log(`[getExistingSchemaForAssetType] Extracted schema from: ${stationId}`, schema);
            return schema;
          }
        }
        // If all stations on this sheet were in the exclude list, keep searching
        console.log(`[getExistingSchemaForAssetType] All stations on sheet ${sheetName} were in exclude list`);
      }
    }
    
    console.log(`[getExistingSchemaForAssetType] No existing stations found for ${assetType}`);
    return null;
    
  } catch (error) {
    console.error('[getExistingSchemaForAssetType] Error:', error);
    return null;
  }
}

/**
 * Sync schema to newly imported stations AFTER they've been written to Excel
 * This is for Functionality B - when importing new data
 */
async function syncNewlyImportedStations(assetType, company, locationName, existingSchema, importedStationIds) {
  const excel = require('./excel_worker_client');
  const results = {
    success: true,
    message: '',
    stationsUpdated: 0
  };
  
  console.log(`[syncNewlyImportedStations] Syncing ${importedStationIds.length} imported stations to existing schema`);
  
  try {
    // Build the sheet name where the new stations were imported
    // Use the standard naming convention: "AssetType Location"
    const sheetName = `${assetType} ${locationName}`;
    
    console.log(`[syncNewlyImportedStations] Reading from sheet: ${sheetName}`);
    
    // Read the just-imported data
    const sheetData = await excel.readSheetData(company, locationName, sheetName);
    if (!sheetData.success || !sheetData.rows || sheetData.rows.length === 0) {
      return { 
        success: false, 
        message: `Could not read imported data from ${sheetName}` 
      };
    }
    
    console.log(`[syncNewlyImportedStations] Found ${sheetData.rows.length} stations in sheet`);
    
    // Update each imported station to match the existing schema
    for (const station of sheetData.rows) {
      const stationId = station['Station ID'] || station['station_id'] || station['StationID'] || station['ID'];
      
      // Only update the stations we just imported
      if (!importedStationIds.includes(String(stationId))) {
        console.log(`[syncNewlyImportedStations] Skipping non-imported station: ${stationId}`);
        continue;
      }
      
      console.log(`[syncNewlyImportedStations] Updating imported station: ${stationId}`);
      
      // Apply the existing schema while preserving values
      const updatedStation = applySchemaToStation(station, existingSchema);
      
      // Write back to Excel
      const updateResult = await excel.updateStationInLocationFile(
        company,
        locationName,
        stationId,
        updatedStation,
        existingSchema
      );
      
      if (updateResult.success) {
        results.stationsUpdated++;
        console.log(`[syncNewlyImportedStations] Successfully updated station: ${stationId}`);
      } else {
        console.error(`[syncNewlyImportedStations] Failed to update station ${stationId}:`, updateResult.message);
      }
    }
    
    results.success = true;
    results.message = `Updated ${results.stationsUpdated} newly imported stations to match existing schema`;
    console.log(`[syncNewlyImportedStations] Completed:`, results.message);
    
  } catch (error) {
    console.error('[syncNewlyImportedStations] Error:', error);
    results.success = false;
    results.message = String(error);
  }
  
  return results;
}

module.exports = {
  extractSchema,
  syncAssetTypeSchema,
  applySchemaToStation,
  getExistingSchemaForAssetType,
  syncNewlyImportedStations
};