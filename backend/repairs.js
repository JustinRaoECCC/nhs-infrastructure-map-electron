// backend/repairs.js
const excel = require('./excel_worker_client');
const app = require('./app');

/**
 * Normalize repair item data
 */
function normalizeItem(raw) {
  const item = raw || {};
  
  // Cost: numeric if possible; else keep as string
  let cost = item.cost;
  if (typeof cost !== 'number') {
    const num = Number(String(cost ?? '').replace(/[, $]/g, ''));
    cost = Number.isFinite(num) ? num : String(cost ?? '').trim();
  }
  
  // Normalize category
  const category = /^o&?m$/i.test(item.category) ? 'O&M' : 'Capital';
  
  // Normalize type
  const type = /^monitor/i.test(item.type) ? 'Monitoring' : 'Repair';
  
  // Ensure date format
  const date = String(item.date ?? '').trim() || new Date().toISOString().slice(0, 10);
  
  return {
    date,
    station_id: String(item.station_id ?? '').trim(),
    // Handle both 'name' and 'Repair Name' fields
    name: String(item.name || item['Repair Name'] || item.repair_name || '').trim(),
    severity: String(item.severity ?? '').trim(),
    priority: String(item.priority ?? '').trim(),
    cost,
    category,
    type,
    location: String(item.location ?? '').trim(),
    assetType: String(item.assetType ?? '').trim()
  };
}

/**
 * Resolve station information to get location and asset type
 */
async function resolveStationInfo(stationId) {
  const all = await app.getStationData({ skipColors: true });
  const st = (all || []).find(s => String(s.station_id) === String(stationId));
  
  if (!st) {
    throw new Error(`Station not found for ID: ${stationId}`);
  }
  
  const location = String(st.location_file || st.province || 'Unknown').trim();
  const assetType = String(st.asset_type || 'Unknown').trim();
  
  return { location, assetType, station: st };
}

/**
 * List repairs for a specific station
 * @param {string} siteName - Station site name (for compatibility)
 * @param {string} stationId - Station ID
 * @returns {Array} List of repairs for the station
 */
async function listRepairs(siteName, stationId) {
  try {
    const { location, assetType } = await resolveStationInfo(stationId);
    const repairs = await excel.listRepairsForStation(location, assetType, stationId);
    
    // Normalize and return
    return (repairs || []).map(r => normalizeItem({
      ...r,
      location,
      assetType
    }));
  } catch (e) {
    console.error('[repairs:list] failed:', e);
    return [];
  }
}

/**
 * Save repairs for a specific station (replaces all repairs for that station)
 * @param {string} siteName - Station site name (for compatibility)
 * @param {string} stationId - Station ID
 * @param {Array} items - Array of repair items to save
 * @returns {Object} Success status and details
 */
async function saveRepairs(siteName, stationId, items) {
  try {
    const { location, assetType } = await resolveStationInfo(stationId);
    
    // Normalize items
    const normalizedItems = Array.isArray(items) 
      ? items.map(item => normalizeItem({ ...item, location, assetType }))
      : [];
    
    // Save to Excel
    const result = await excel.saveStationRepairs(
      location, 
      assetType, 
      stationId, 
      normalizedItems
    );
    
    return result;
  } catch (e) {
    console.error('[repairs:save] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Add a single repair to a location/asset type
 * @param {string} location - Location (e.g., "BC")
 * @param {string} assetType - Asset type (e.g., "Cableway")
 * @param {Object} repair - Repair data including Station ID
 * @returns {Object} Success status and details
 */
async function addRepair(location, assetType, repair) {
  try {
    // Ensure required fields
    if (!location) {
      throw new Error('Location is required');
    }
    if (!assetType) {
      throw new Error('Asset type is required');
    }
    if (!repair['Station ID'] && !repair.station_id) {
      throw new Error('Station ID is required');
    }
    
    // Normalize the repair data
    const normalizedRepair = normalizeItem({
      ...repair,
      location,
      assetType
    });
    
    // Call Excel worker to append the repair
    const result = await excel.appendRepair(
      location, 
      assetType, 
      normalizedRepair
    );
    
    return result;
  } catch (e) {
    console.error('[repairs:add] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Get all repairs across all locations and asset types
 * @returns {Array} List of all repairs
 */
async function getAllRepairs() {
  try {
    const allRepairs = await excel.getAllRepairs();
    
    // Normalize all repairs
    return (allRepairs || []).map(normalizeItem);
  } catch (e) {
    console.error('[repairs:getAll] failed:', e);
    return [];
  }
}

/**
 * Delete a specific repair by index
 * @param {string} location - Location
 * @param {string} assetType - Asset type
 * @param {string} stationId - Station ID
 * @param {number} repairIndex - Index of repair to delete
 * @returns {Object} Success status
 */
async function deleteRepair(location, assetType, stationId, repairIndex) {
  try {
    if (!location || !assetType || !stationId) {
      throw new Error('Location, asset type, and station ID are required');
    }
    
    if (!Number.isInteger(repairIndex) || repairIndex < 0) {
      throw new Error('Valid repair index is required');
    }
    
    const result = await excel.deleteRepair(
      location, 
      assetType, 
      stationId, 
      repairIndex
    );
    
    return result;
  } catch (e) {
    console.error('[repairs:delete] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Get repairs filtered by location and/or asset type
 * @param {Object} filters - { location?, assetType? }
 * @returns {Array} Filtered list of repairs
 */
async function getFilteredRepairs(filters = {}) {
  try {
    const allRepairs = await getAllRepairs();
    
    // Apply filters
    let filtered = allRepairs;
    
    if (filters.location) {
      filtered = filtered.filter(r => 
        String(r.location).toLowerCase() === String(filters.location).toLowerCase()
      );
    }
    
    if (filters.assetType) {
      filtered = filtered.filter(r => 
        String(r.assetType).toLowerCase() === String(filters.assetType).toLowerCase()
      );
    }
    
    if (filters.type) {
      filtered = filtered.filter(r => 
        String(r.type).toLowerCase() === String(filters.type).toLowerCase()
      );
    }
    
    return filtered;
  } catch (e) {
    console.error('[repairs:getFiltered] failed:', e);
    return [];
  }
}

/**
 * Get repair statistics
 * @returns {Object} Statistics about repairs
 */
async function getRepairStatistics() {
  try {
    const allRepairs = await getAllRepairs();
    
    const stats = {
      total: allRepairs.length,
      byType: {
        repairs: allRepairs.filter(r => r.type === 'Repair').length,
        monitoring: allRepairs.filter(r => r.type === 'Monitoring').length
      },
      byCategory: {
        capital: allRepairs.filter(r => r.category === 'Capital').length,
        oAndM: allRepairs.filter(r => r.category === 'O&M').length
      },
      byLocation: {},
      byAssetType: {},
      totalCost: 0
    };
    
    // Calculate costs and groupings
    allRepairs.forEach(repair => {
      // Sum costs
      if (typeof repair.cost === 'number') {
        stats.totalCost += repair.cost;
      }
      
      // Count by location
      const loc = repair.location || 'Unknown';
      stats.byLocation[loc] = (stats.byLocation[loc] || 0) + 1;
      
      // Count by asset type
      const at = repair.assetType || 'Unknown';
      stats.byAssetType[at] = (stats.byAssetType[at] || 0) + 1;
    });
    
    return stats;
  } catch (e) {
    console.error('[repairs:getStatistics] failed:', e);
    return {
      total: 0,
      byType: { repairs: 0, monitoring: 0 },
      byCategory: { capital: 0, oAndM: 0 },
      byLocation: {},
      byAssetType: {},
      totalCost: 0
    };
  }
}

/**
 * Bulk add repairs from import
 * @param {Array} repairs - Array of repair objects with location and assetType
 * @returns {Object} Results of bulk add operation
 */
async function bulkAddRepairs(repairs) {
  try {
    if (!Array.isArray(repairs)) {
      throw new Error('Repairs must be an array');
    }
    
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };
    
    // Group repairs by location and asset type for efficiency
    const grouped = {};
    repairs.forEach(repair => {
      const key = `${repair.location}||${repair.assetType}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(repair);
    });
    
    // Process each group
    for (const [key, groupRepairs] of Object.entries(grouped)) {
      const [location, assetType] = key.split('||');
      
      for (const repair of groupRepairs) {
        try {
          const result = await addRepair(location, assetType, repair);
          if (result.success) {
            results.success++;
          } else {
            results.failed++;
            results.errors.push(`Failed: ${repair.name || 'Unknown'} - ${result.message}`);
          }
        } catch (e) {
          results.failed++;
          results.errors.push(`Error: ${repair.name || 'Unknown'} - ${String(e)}`);
        }
      }
    }
    
    return {
      success: true,
      added: results.success,
      failed: results.failed,
      errors: results.errors,
      total: repairs.length
    };
  } catch (e) {
    console.error('[repairs:bulkAdd] failed:', e);
    return {
      success: false,
      message: String(e),
      added: 0,
      failed: repairs.length,
      total: repairs.length
    };
  }
}

// Export all functions
module.exports = {
  // Core functions (for compatibility)
  listRepairs,
  saveRepairs,
  
  // New functions
  addRepair,
  getAllRepairs,
  deleteRepair,
  getFilteredRepairs,
  getRepairStatistics,
  bulkAddRepairs,
  
  // Utility functions
  normalizeItem,
  resolveStationInfo
};