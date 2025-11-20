// backend/persistence/MongoPersistence.js

// MongoDB-based persistence implementation

const IPersistence = require('./IPersistence');
const mongoClient = require('../db/mongoClient');
const { COLLECTIONS, addMetadata, stripMetadata } = require('../db/mongoSchemas');

// Lazy-load excel worker client for import utilities (parsing Excel files)
// We need this even in MongoDB mode to support the "Import from Excel" wizard
let excelWorker = null;
function getExcelWorker() {
  if (!excelWorker) {
    console.log('[MongoPersistence] Lazy-loading excel_worker_client for file parsing');
    excelWorker = require('../excel_worker_client');
  }
  return excelWorker;
}

class MongoPersistence extends IPersistence {
  constructor() {
    super();
    this.initialized = false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════════

  async initialize() {
    // Connection should be established via config, but we can verify here
    if (!mongoClient.connected()) {
      console.error('[MongoPersistence] MongoDB not connected');
      return false;
    }

    try {
      // Create indexes for collections
      await this._createIndexes();
      this.initialized = true;
      console.log('[MongoPersistence] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[MongoPersistence] Initialization failed:', error.message);
      return false;
    }
  }

  async close() {
    await mongoClient.disconnect();
    this.initialized = false;
  }

  async _createIndexes() {
    try {
      // Companies
      await mongoClient.createIndexes(COLLECTIONS.COMPANIES, [
        { key: { company: 1 }, unique: true }
      ]);

      // Locations
      await mongoClient.createIndexes(COLLECTIONS.LOCATIONS, [
        { key: { location: 1, company: 1 }, unique: true },
        { key: { company: 1 } }
      ]);

      // Asset Types
      await mongoClient.createIndexes(COLLECTIONS.ASSET_TYPES, [
        { key: { asset_type: 1, location: 1, company: 1 }, unique: true },
        { key: { asset_type: 1 } },
        { key: { company: 1, location: 1 } }
      ]);

      // Workplan Constants
      await mongoClient.createIndexes(COLLECTIONS.WORKPLAN_CONSTANTS, [
        { key: { Field: 1 }, unique: true }
      ]);

      // Algorithm Parameters
      await mongoClient.createIndexes(COLLECTIONS.ALGORITHM_PARAMETERS, [
        { key: { Parameter: 1 }, unique: true }
      ]);

      // Fixed Parameters
      await mongoClient.createIndexes(COLLECTIONS.FIXED_PARAMETERS, [
        { key: { Name: 1 }, unique: true }
      ]);

      // Status Colors
      await mongoClient.createIndexes(COLLECTIONS.STATUS_COLORS, [
        { key: { Status: 1 }, unique: true }
      ]);

      // Settings
      await mongoClient.createIndexes(COLLECTIONS.SETTINGS, [
        { key: { Key: 1 }, unique: true }
      ]);

      // Inspection Keywords
      await mongoClient.createIndexes(COLLECTIONS.INSPECTION_KEYWORDS, [
        { key: { Keyword: 1 }, unique: true }
      ]);

      // Project Keywords
      await mongoClient.createIndexes(COLLECTIONS.PROJECT_KEYWORDS, [
        { key: { Keyword: 1 }, unique: true }
      ]);

      console.log('[MongoPersistence] Indexes created successfully');
    } catch (error) {
      console.warn('[MongoPersistence] Some indexes may already exist:', error.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COMPANIES
  // ════════════════════════════════════════════════════════════════════════════

  async getActiveCompanies() {
    const collection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
    const companies = await collection.find({ active: true }).toArray();
    return companies.map(c => c.company);
  }

  async upsertCompany(name, active = true, description = '', email = '') {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const now = new Date();

      await collection.updateOne(
        { company: name },
        {
          $set: { company: name, active, description, email, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] upsertCompany failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - LOCATIONS
  // ════════════════════════════════════════════════════════════════════════════

  async getLocationsForCompany(company) {
    const collection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
    const locations = await collection.find({ company }).toArray();
    return locations.map(l => l.location);
  }

  async upsertLocation(location, company) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const now = new Date();

      await collection.updateOne(
        { location, company },
        {
          $set: { location, company, _updatedAt: now },
          $setOnInsert: { link: '', _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] upsertLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setLocationLink(company, location, link) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const now = new Date();

      await collection.updateOne(
        { location, company },
        { $set: { link: link || '', _updatedAt: now } }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setLocationLink failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - ASSET TYPES
  // ════════════════════════════════════════════════════════════════════════════

  async getAssetTypesForCompanyLocation(company, location) {
    const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
    const assets = await collection.find({ company, location }).toArray();
    return assets.map(a => a.asset_type);
  }

  async upsertAssetType(assetType, company, location) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, location, company },
        {
          $set: { asset_type: assetType, location, company, _updatedAt: now },
          $setOnInsert: { color: '', link: '', _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] upsertAssetType failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setAssetTypeLink(assetType, company, location, link) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, company, location },
        { $set: { link: link || '', _updatedAt: now } }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeLink failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COLORS
  // ════════════════════════════════════════════════════════════════════════════

  async getColorMaps() {
    const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
    const assets = await collection.find({ color: { $ne: '' } }).toArray();

    const global = new Map();
    const byLocation = new Map();
    const byCompanyLocation = new Map();

    for (const asset of assets) {
      const { asset_type, location, company, color } = asset;

      if (!color) continue;

      if (company && location) {
        if (!byCompanyLocation.has(company)) {
          byCompanyLocation.set(company, new Map());
        }
        const locMap = byCompanyLocation.get(company);

        if (!locMap.has(location)) {
          locMap.set(location, new Map());
        }
        const assetMap = locMap.get(location);
        assetMap.set(asset_type, color);
      }
    }

    return { global, byLocation, byCompanyLocation };
  }

  async setAssetTypeColor(assetType, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, location: '', company: '' },
        {
          $set: { asset_type: assetType, location: '', company: '', color, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeColor failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setAssetTypeColorForLocation(assetType, location, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, location, company: '' },
        {
          $set: { asset_type: assetType, location, company: '', color, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeColorForLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, company, location },
        { $set: { color: color || '', _updatedAt: now } }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeColorForCompanyLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - SNAPSHOT & TREE
  // ════════════════════════════════════════════════════════════════════════════

  async readLookupsSnapshot() {
    try {
      const companiesCollection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const companiesDocs = await companiesCollection.find({ active: true }).toArray();
      
      // Map to Objects to support frontend filters.js
      const companies = companiesDocs.map(c => ({
        name: c.company,
        description: c.description || '',
        email: c.email || ''
      }));

      const locsByCompany = {};
      const locationsCollection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const allLocations = await locationsCollection.find({}).toArray();
      for (const loc of allLocations) {
        if (!locsByCompany[loc.company]) {
          locsByCompany[loc.company] = [];
        }
        locsByCompany[loc.company].push(loc.location);
      }

      const assetsByCompanyLocation = {};
      const assetsCollection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const allAssets = await assetsCollection.find({}).toArray();
      for (const asset of allAssets) {
        if (!asset.company || !asset.location) continue;
        if (!assetsByCompanyLocation[asset.company]) {
          assetsByCompanyLocation[asset.company] = {};
        }
        if (!assetsByCompanyLocation[asset.company][asset.location]) {
          assetsByCompanyLocation[asset.company][asset.location] = [];
        }
        assetsByCompanyLocation[asset.company][asset.location].push(asset.asset_type);
      }

      const colorsGlobal = {};
      const colorsByLoc = {};
      const colorsByCompanyLoc = {};

      for (const asset of allAssets) {
        if (!asset.color) continue;
        if (!asset.location && !asset.company) {
          colorsGlobal[asset.asset_type] = asset.color;
        } else if (asset.location && !asset.company) {
          if (!colorsByLoc[asset.location]) colorsByLoc[asset.location] = {};
          colorsByLoc[asset.location][asset.asset_type] = asset.color;
        } else if (asset.company && asset.location) {
          if (!colorsByCompanyLoc[asset.company]) colorsByCompanyLoc[asset.company] = {};
          if (!colorsByCompanyLoc[asset.company][asset.location]) colorsByCompanyLoc[asset.company][asset.location] = {};
          colorsByCompanyLoc[asset.company][asset.location][asset.asset_type] = asset.color;
        }
      }

      const locationLinks = {};
      for (const loc of allLocations) {
        if (loc.link) {
          if (!locationLinks[loc.company]) locationLinks[loc.company] = {};
          locationLinks[loc.company][loc.location] = loc.link;
        }
      }

      const assetTypeLinks = {};
      for (const asset of allAssets) {
        if (asset.link && asset.company && asset.location) {
          if (!assetTypeLinks[asset.company]) assetTypeLinks[asset.company] = {};
          if (!assetTypeLinks[asset.company][asset.location]) assetTypeLinks[asset.company][asset.location] = {};
          assetTypeLinks[asset.company][asset.location][asset.asset_type] = asset.link;
        }
      }

      const statusColorsMap = {};
      const statusColorsCollection = mongoClient.getCollection(COLLECTIONS.STATUS_COLORS);
      const statusColorsDocs = await statusColorsCollection.find({}).toArray();
      for (const doc of statusColorsDocs) {
        statusColorsMap[doc.Status] = doc.Color;
      }

      const settingsCollection = mongoClient.getCollection(COLLECTIONS.SETTINGS);
      const applyStatusSetting = await settingsCollection.findOne({ Key: 'applyStatusColorsOnMap' });
      const applyRepairSetting = await settingsCollection.findOne({ Key: 'applyRepairColorsOnMap' });

      const inspectionKeywordsCollection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);
      const inspectionKeywordsDocs = await inspectionKeywordsCollection.find({}).toArray();
      const inspectionKeywords = inspectionKeywordsDocs.map(k => k.Keyword);

      const projectKeywordsCollection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
      const projectKeywordsDocs = await projectKeywordsCollection.find({}).toArray();
      const projectKeywords = projectKeywordsDocs.map(k => k.Keyword);

      return {
        mtimeMs: Date.now(),
        companies,
        locsByCompany,
        assetsByCompanyLocation,
        colorsGlobal,
        colorsByLoc,
        colorsByCompanyLoc,
        locationLinks,
        assetTypeLinks,
        statusColors: statusColorsMap,
        applyStatusColorsOnMap: applyStatusSetting ? applyStatusSetting.Value : false,
        repairColors: {},
        applyRepairColorsOnMap: applyRepairSetting ? applyRepairSetting.Value : false,
        inspectionKeywords,
        projectKeywords
      };
    } catch (error) {
      console.error('[MongoPersistence] readLookupsSnapshot failed:', error.message);
      return {
        mtimeMs: Date.now(),
        companies: [],
        locsByCompany: {},
        assetsByCompanyLocation: {},
        colorsGlobal: {},
        colorsByLoc: {},
        colorsByCompanyLoc: {},
        locationLinks: {},
        assetTypeLinks: {},
        statusColors: {},
        applyStatusColorsOnMap: false,
        repairColors: {},
        applyRepairColorsOnMap: false,
        inspectionKeywords: [],
        projectKeywords: []
      };
    }
  }

  async getLookupTree() {
    const snapshot = await this.readLookupsSnapshot();
    return {
      companies: snapshot.companies,
      locationsByCompany: snapshot.locsByCompany,
      assetsByCompanyLocation: snapshot.assetsByCompanyLocation
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - STATUS & REPAIR SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  async getStatusAndRepairSettings() {
    const snapshot = await this.readLookupsSnapshot();
    return {
      statusColors: snapshot.statusColors,
      applyStatusColorsOnMap: snapshot.applyStatusColorsOnMap,
      repairColors: snapshot.repairColors,
      applyRepairColorsOnMap: snapshot.applyRepairColorsOnMap
    };
  }

  async setStatusColor(statusKey, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.STATUS_COLORS);
      const now = new Date();

      await collection.updateOne(
        { Status: statusKey },
        {
          $set: { Status: statusKey, Color: color, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setStatusColor failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setSettingBoolean(key, value) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.SETTINGS);
      const now = new Date();

      await collection.updateOne(
        { Key: key },
        {
          $set: { Key: key, Value: !!value, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setSettingBoolean failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteStatusRow(statusKey) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.STATUS_COLORS);
      await collection.deleteOne({ Status: statusKey });
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] deleteStatusRow failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - INSPECTION KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  async getInspectionKeywords() {
    const collection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);
    const keywords = await collection.find({}).toArray();
    return keywords.map(k => k.Keyword);
  }

  async setInspectionKeywords(keywords) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);
      await collection.deleteMany({});
      if (keywords.length > 0) {
        const docs = keywords.map(keyword => addMetadata({ Keyword: keyword }, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setInspectionKeywords failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - PROJECT KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  async getProjectKeywords() {
    const collection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
    const keywords = await collection.find({}).toArray();
    return keywords.map(k => k.Keyword);
  }

  async setProjectKeywords(keywords) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
      await collection.deleteMany({});
      if (keywords.length > 0) {
        const docs = keywords.map(keyword => addMetadata({ Keyword: keyword }, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setProjectKeywords failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - READ
  // ════════════════════════════════════════════════════════════════════════════

  async readStationsAggregate() {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      // Filter station data collections (suffix _stationData)
      const stationCollections = collections.filter(name => name.endsWith('_stationData'));
      console.log(`[MongoPersistence] Found ${stationCollections.length} station collections.`);

      const allStations = [];

      for (const collName of stationCollections) {
        const collection = db.collection(collName);
        const stations = await collection.find({}).toArray();
        // The documents already contain company, location_file, asset_type, etc.
        allStations.push(...stations);
      }

      console.log(`[MongoPersistence] Read ${allStations.length} total stations from MongoDB`);
      return { success: true, rows: allStations };
    } catch (error) {
      console.error('[MongoPersistence] readStationsAggregate failed:', error.message);
      return { success: false, rows: [] };
    }
  }

  async readLocationWorkbook(company, locationName) {
    try {
      // In MongoDB, we treat collections as "sheets".
      // We look for collections named {Company}_{Location}_*
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      // Find all collections matching the company/location prefix
      const matching = collections.filter(name => name.startsWith(prefix));
      
      // Convert collection names to friendly "Sheet Names"
      const sheets = matching.map(collName => {
        // Remove prefix
        let suffix = collName.replace(prefix, '');
        
        if (suffix.endsWith('_stationData')) {
          // E.g. "Cableway_stationData" -> "Cableway"
          return suffix.replace('_stationData', '').replace(/_/g, ' ');
        } else if (suffix === 'repairs') {
          // "repairs" -> "Repairs"
          return 'Repairs';
        }
        return suffix;
      });

      return { success: true, sheets: sheets.sort() };
    } catch (error) {
      console.error('[MongoPersistence] readLocationWorkbook failed:', error.message);
      return { success: false, sheets: [] };
    }
  }

  async readSheetData(company, locationName, sheetName) {
    try {
      let collectionName;
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      if (sheetName.toLowerCase() === 'repairs') {
        collectionName = mongoClient.getRepairsCollectionName(company, locationName);
      } else {
        // Assume it is an Asset Type sheet
        collectionName = mongoClient.getStationCollectionName(company, locationName, sheetName);
      }

      const collection = mongoClient.getCollection(collectionName);
      const rows = await collection.find({}).toArray();

      return { success: true, rows };
    } catch (error) {
      // Collection might not exist yet, which is fine
      return { success: true, rows: [] };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - WRITE
  // ════════════════════════════════════════════════════════════════════════════

  async writeLocationRows(company, location, sheetName, sections, headers, rows) {
    try {
      // 1. Determine Collection Name based on sheetName (Asset Type)
      let assetType = sheetName;
      if (sheetName.endsWith(' ' + location)) {
          assetType = sheetName.substring(0, sheetName.lastIndexOf(' ' + location));
      }
      
      const collectionName = mongoClient.getStationCollectionName(company, location, assetType);
      console.log(`[MongoPersistence] Writing ${rows.length} stations to collection: ${collectionName}`);

      const collection = mongoClient.getCollection(collectionName);
      const now = new Date();

      // Use bulkWrite for performance
      const operations = rows.map(row => {
        const stationId = row['Station ID'] || row['station_id'] || row['StationID'] || row['ID'];
        if (!stationId) return null; // Skip invalid rows

        // Normalize specific core fields for the aggregate view
        const coreFields = {
          station_id: String(stationId).trim(),
          asset_type: row['Category'] || row['asset_type'] || assetType,
          name: row['Site Name'] || row['name'] || row['Station Name'] || '',
          province: row['Province'] || row['province'] || row['Location'] || location,
          lat: row['Latitude'] || row['lat'] || '',
          lon: row['Longitude'] || row['lon'] || '',
          status: row['Status'] || row['status'] || 'Active',
          company: company,
          location_file: location, // Used for filters
          _updatedAt: now
        };

        // Combine core fields with the dynamic Excel fields
        // We strip any existing metadata (_id, etc) from the incoming row first
        const { _id, _createdAt, ...dynamicData } = row;
        
        const doc = {
          ...dynamicData, // The "Excel" columns (e.g. "General Information – Depth")
          ...coreFields   // The enforced root fields
        };

        return {
          updateOne: {
            filter: { station_id: coreFields.station_id },
            update: {
              $set: doc,
              $setOnInsert: { _createdAt: now, _source: 'manual' }
            },
            upsert: true
          }
        };
      }).filter(op => op !== null);

      if (operations.length > 0) {
        await collection.bulkWrite(operations);
      }

      console.log(`[MongoPersistence] Successfully wrote ${operations.length} stations to ${collectionName}`);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] writeLocationRows failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema) {
    try {
      // We need to find WHICH collection this station is in.
      // It matches {Company}_{Location}_*_{stationData}
      
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      const candidates = collections.filter(name => 
        name.startsWith(prefix) && name.endsWith('_stationData')
      );

      let found = false;
      
      for (const collName of candidates) {
        const collection = db.collection(collName);
        const existing = await collection.findOne({ station_id: stationId });

        if (existing) {
          // Prepare update
          const { _id, _createdAt, ...rest } = updatedRowData;
          
          // Ensure core fields are updated too if they are in updatedRowData
          const updatePayload = {
            ...rest,
            _updatedAt: new Date()
          };
          
          // Sync core fields if present in the update
          if (rest['Site Name']) updatePayload.name = rest['Site Name'];
          if (rest['Latitude']) updatePayload.lat = rest['Latitude'];
          if (rest['Longitude']) updatePayload.lon = rest['Longitude'];
          if (rest['Status']) updatePayload.status = rest['Status'];

          await collection.updateOne(
            { station_id: stationId },
            { $set: updatePayload }
          );
          found = true;
          break;
        }
      }

      if (!found) {
        return { success: false, message: 'Station not found in any asset collection for this location' };
      }

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] updateStationInLocationFile failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPAIRS
  // ════════════════════════════════════════════════════════════════════════════

  async listRepairsForStation(company, location, assetType, stationId) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);
      const repairs = await collection.find({ station_id: stationId }).toArray();
      return repairs;
    } catch (error) {
      // Collection might not exist yet
      return [];
    }
  }

  async getAllRepairs() {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      // Filter repair collections
      const repairCollections = collections.filter(name => name.endsWith('_repairs'));

      const allRepairs = [];

      for (const collName of repairCollections) {
        const collection = db.collection(collName);
        const repairs = await collection.find({}).toArray();

        // Extract company and location from collection name
        const parts = collName.replace('_repairs', '').split('_');
        const company = parts[0];
        const location = parts.slice(1).join('_');

        // Add location info to each repair
        const enriched = repairs.map(r => ({
          ...r,
          company: r.company || company,
          location: r.location || location
        }));

        allRepairs.push(...enriched);
      }

      return allRepairs;
    } catch (error) {
      console.error('[MongoPersistence] getAllRepairs failed:', error.message);
      return [];
    }
  }

  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);

      // Delete existing repairs for this station
      await collection.deleteMany({ station_id: stationId });

      if (repairs.length > 0) {
        const now = new Date();
        const docs = repairs.map(repair => {
          const { _id, ...clean } = repair;
          return {
            ...clean,
            station_id: stationId,
            assetType: clean.assetType || assetType,
            location,
            company,
            _createdAt: now,
            _updatedAt: now,
            _source: 'manual'
          };
        });
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] saveStationRepairs failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async appendRepair(company, location, assetType, repair) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);

      const { _id, ...clean } = repair;
      const now = new Date();
      
      const doc = {
        ...clean,
        station_id: clean.station_id || clean['Station ID'],
        assetType: clean.assetType || assetType,
        location,
        company,
        _createdAt: now,
        _updatedAt: now,
        _source: 'manual'
      };

      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] appendRepair failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);

      const repairs = await collection.find({ station_id: stationId }).sort({ date: 1 }).toArray();

      if (repairIndex >= 0 && repairIndex < repairs.length) {
        const target = repairs[repairIndex];
        await collection.deleteOne({ _id: target._id });
        return { success: true };
      }
      return { success: false, message: 'Invalid repair index' };
    } catch (error) {
      console.error('[MongoPersistence] deleteRepair failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ALGORITHM DATA
  // ════════════════════════════════════════════════════════════════════════════

  async getAlgorithmParameters() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ALGORITHM_PARAMETERS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async saveAlgorithmParameters(rows) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ALGORITHM_PARAMETERS);
      await collection.deleteMany({});
      if (rows.length > 0) {
        const docs = rows.map(row => addMetadata(row, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getWorkplanConstants() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.WORKPLAN_CONSTANTS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async saveWorkplanConstants(rows) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.WORKPLAN_CONSTANTS);
      await collection.deleteMany({});
      if (rows.length > 0) {
        const docs = rows.map(row => addMetadata(row, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getCustomWeights() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.CUSTOM_WEIGHTS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async addCustomWeight(weight, active) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.CUSTOM_WEIGHTS);
      const doc = addMetadata({ weight, active: !!active }, 'manual');
      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getFixedParameters() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FIXED_PARAMETERS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async saveFixedParameters(params) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FIXED_PARAMETERS);
      await collection.deleteMany({});
      if (params.length > 0) {
        const docs = params.map(param => addMetadata(param, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  // The Import Wizard (Step 3 & 4) requires parsing the user-uploaded Excel file.
  // We delegate this parsing to the Excel Worker, even if we are in "MongoDB Mode".

  async listSheets(b64) {
    const excel = getExcelWorker();
    return await excel.listSheets(b64);
  }

  async parseRows(b64) {
    const excel = getExcelWorker();
    return await excel.parseRows(b64);
  }

  async parseRowsFromSheet(b64, sheetName) {
    const excel = getExcelWorker();
    return await excel.parseRowsFromSheet(b64, sheetName);
  }

  async ensureLookupsReady() {
    return { success: true };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - DELETE OPERATIONS (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async deleteCompanyFromLookups(companyName) {
    try {
      const companies = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const locations = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const assets = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);

      // Delete from Companies
      await companies.deleteOne({ company: companyName });

      // Cascade delete from Locations
      await locations.deleteMany({ company: companyName });

      // Cascade delete from AssetTypes
      await assets.deleteMany({ company: companyName });

      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async deleteLocationFromLookups(companyName, locationName) {
    try {
      const locations = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const assets = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);

      // Delete specific location
      await locations.deleteOne({ company: companyName, location: locationName });

      // Cascade delete associated AssetTypes
      await assets.deleteMany({ company: companyName, location: locationName });

      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async deleteAssetTypeFromLookups(companyName, locationName, assetTypeName) {
    try {
      const assets = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      await assets.deleteOne({
        company: companyName,
        location: locationName,
        asset_type: assetTypeName
      });
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async deleteAssetTypeFromLocation(companyName, locationName, assetTypeName) {
    try {
      // In MongoDB, this means dropping the specific collection for this asset type
      const collectionName = mongoClient.getStationCollectionName(companyName, locationName, assetTypeName);
      const db = mongoClient.getDatabase();
      
      // Check if collection exists before dropping to avoid error
      const collections = await mongoClient.listCollections();
      if (collections.includes(collectionName)) {
        await db.collection(collectionName).drop();
      }
      
      return { success: true };
    } catch (error) {
      // Ignore "ns not found" errors, strictly speaking success if it's gone
      return { success: true, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEMA MANAGEMENT (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async updateAssetTypeSchema(assetType, schema, excludeStationId) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      
      // Find all collections that might match this asset type
      // Logic mirrors Excel: matches asset type name in collection name
      const targets = collections.filter(c => 
        c.endsWith('_stationData') && c.toLowerCase().includes(assetType.toLowerCase())
      );

      let totalUpdated = 0;
      const results = [];

      for (const collName of targets) {
        const collection = db.collection(collName);
        
        // 1. Identify new fields from schema
        const newFields = {};
        schema.fields.forEach((field, idx) => {
          const section = schema.sections[idx];
          // In Mongo we store flat or specific keys. 
          // We ensure the field exists. If usage expects "Section - Field", ensures that key.
          // If usage expects plain "Field", ensures that key.
          // Based on writeLocationRows, we primarily use plain keys or composite if collision.
          // For schema sync, we simply ensure the key exists in the document.
          const composite = section ? `${section} – ${field}` : field;
          newFields[composite] = ""; // Default value for new fields
        });

        // 2. Update all documents in this collection
        // We use $set to add missing fields without overwriting existing data
        // Note: MongoDB allows dynamic schema, so strictly "adding columns" isn't necessary,
        // but putting empty strings ensures they appear in UI grids.
        
        // Filter out the excluded station
        const filter = excludeStationId ? { station_id: { $ne: excludeStationId } } : {};
        
        // We iterate to perform smart updates (only set if missing)
        // Or use updateMany with pipeline if Mongo 4.2+
        const cursor = collection.find(filter);
        
        while(await cursor.hasNext()) {
          const doc = await cursor.next();
          const updates = {};
          let hasUpdate = false;

          for (const key of Object.keys(newFields)) {
            // If key missing, add it
            if (doc[key] === undefined) {
              updates[key] = "";
              hasUpdate = true;
            }
          }

          if (hasUpdate) {
            await collection.updateOne({ _id: doc._id }, { $set: updates });
            totalUpdated++;
          }
        }
        results.push({ collection: collName, updated: true });
      }

      return { 
        success: true, 
        totalUpdated, 
        results,
        message: `Updated schema for ${totalUpdated} stations across ${results.length} collections`
      };
    } catch (error) {
      console.error('[MongoPersistence] updateAssetTypeSchema failed:', error);
      return { success: false, message: error.message };
    }
  }

  async getWorkbookFieldCatalog(company, locationName) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const result = { repairs: [], sheets: {} };

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      // 1. Get Repairs Fields
      const repairsCollName = mongoClient.getRepairsCollectionName(company, locationName);
      if (collections.includes(repairsCollName)) {
        const sample = await db.collection(repairsCollName).findOne({});
        if (sample) {
          // Filter out internal mongo fields
          result.repairs = Object.keys(sample).filter(k => !k.startsWith('_')).sort();
        }
      }

      // 2. Get Station Sheets Fields
      const stationColls = collections.filter(c => c.startsWith(prefix) && c.endsWith('_stationData'));
      
      for (const collName of stationColls) {
        // Extract "Sheet Name" (Asset Type) from collection name
        let suffix = collName.replace(prefix, '').replace('_stationData', '');
        // Reconstruct friendly name (underscores to spaces)
        const sheetName = suffix.replace(/_/g, ' ');

        const sample = await db.collection(collName).findOne({});
        if (sample) {
          result.sheets[sheetName] = Object.keys(sample).filter(k => !k.startsWith('_')).sort();
        } else {
          result.sheets[sheetName] = [];
        }
      }

      return result;
    } catch (error) {
      return { repairs: [], sheets: {} };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION SYSTEM (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async createAuthWorkbook() {
    // In MongoDB, we just ensure the collection exists with an index
    try {
      await mongoClient.createIndexes(COLLECTIONS.AUTH_USERS, [
        { key: { name: 1 }, unique: true },
        { key: { email: 1 }, unique: true }
      ]);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async createAuthUser(userData) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      
      // Check duplicates
      const existing = await collection.findOne({ 
        $or: [
          { name: new RegExp(`^${userData.name}$`, 'i') },
          { email: new RegExp(`^${userData.email}$`, 'i') }
        ]
      });

      if (existing) {
        return { success: false, message: 'User already exists' };
      }

      const now = new Date();
      const doc = {
        name: userData.name,
        email: userData.email,
        password: userData.password, // Note: In a real app, hash this. Matching Excel implementation which stores plain.
        admin: userData.admin,
        permissions: userData.permissions,
        status: userData.status,
        created: userData.created || now.toISOString(),
        lastLogin: userData.lastLogin || '',
        _createdAt: now,
        _updatedAt: now
      };

      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async loginAuthUser(name, hashedPassword) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const user = await collection.findOne({ name, password: hashedPassword });

      if (!user) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Update status and login time
      await collection.updateOne(
        { _id: user._id },
        { 
          $set: { 
            status: 'Active',
            lastLogin: new Date().toISOString(),
            _updatedAt: new Date()
          }
        }
      );

      return {
        success: true,
        user: {
          name: user.name,
          email: user.email,
          admin: user.admin === 'Yes' || user.admin === true, // Handle Excel string vs Boolean
          permissions: user.permissions
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async logoutAuthUser(name) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      await collection.updateOne(
        { name },
        { $set: { status: 'Inactive', _updatedAt: new Date() } }
      );
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getAllAuthUsers() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const docs = await collection.find({}).toArray();
      
      const users = docs.map(doc => ({
        name: doc.name,
        email: doc.email,
        password: doc.password,
        admin: doc.admin,
        permissions: doc.permissions,
        status: doc.status,
        created: doc.created,
        lastLogin: doc.lastLogin
      }));

      return { users };
    } catch (error) {
      return { users: [] };
    }
  }

  async hasAuthUsers() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const count = await collection.countDocuments();
      return { hasUsers: count > 0 };
    } catch (error) {
      return { hasUsers: false };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FUNDING SETTINGS (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async getFundingSettings(company, location) {
    // Logic: Try to find ONE document in any collection for this location that has funding set.
    // Since Excel "Settings" implies consistency, we pick the first available.
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(location)}_`;
      
      const stationColls = collections.filter(c => c.startsWith(prefix) && c.endsWith('_stationData'));

      // Iterate collections until we find one with data
      for (const collName of stationColls) {
        const doc = await db.collection(collName).findOne({});
        if (doc) {
          // Extract values if they exist, using loose matching
          const getVal = (key) => doc[key] || doc[key.toUpperCase()] || '';
          return {
            om: getVal('O&M'),
            capital: getVal('Capital'),
            decommission: getVal('Decommission')
          };
        }
      }
      return { om: '', capital: '', decommission: '' };
    } catch (error) {
      return { om: '', capital: '', decommission: '' };
    }
  }

  async saveFundingSettings(company, location, settings) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(location)}_`;
      
      // Update ALL station collections for this location
      const stationColls = collections.filter(c => c.startsWith(prefix) && c.endsWith('_stationData'));
      let touchedSheets = 0;

      for (const collName of stationColls) {
        const collection = db.collection(collName);
        
        // Update logic:
        // If the document has "Funding Split", we must calculate the specific value (like Excel does).
        // However, simpler Mongo approach: We assume the frontend passes the raw "50%Token" string 
        // OR we simply update the fields.
        // The Excel implementation recalculates based on tokens.
        // For strict parity, we need to fetch, calc, update (slow) or use a pipeline update (fast).
        // Simplified: We simply set the overrides provided in `settings`.
        // If complex logic needed, we'd use updateMany with aggregation pipeline.
        
        // We will perform a basic update for now. 
        // NOTE: This does not re-calculate based on row-specific tokens unless we implement pipeline.
        
        const updates = {};
        if (settings.om !== undefined) updates['O&M'] = settings.om;
        if (settings.capital !== undefined) updates['Capital'] = settings.capital;
        if (settings.decommission !== undefined) updates['Decommission'] = settings.decommission;

        if (Object.keys(updates).length > 0) {
          await collection.updateMany({}, { $set: updates });
          touchedSheets++;
        }
      }

      return { success: true, updatedSheets: touchedSheets };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async saveFundingSettingsForAssetType(company, location, assetType, settings) {
    try {
      const collectionName = mongoClient.getStationCollectionName(company, location, assetType);
      const collection = mongoClient.getCollection(collectionName);

      const updates = {};
      if (settings.om !== undefined) updates['O&M'] = settings.om;
      if (settings.capital !== undefined) updates['Capital'] = settings.capital;
      if (settings.decommission !== undefined) updates['Decommission'] = settings.decommission;

      await collection.updateMany({}, { $set: updates });
      return { success: true };
    } catch (error) {
      // Collection might not exist
      return { success: false, message: error.message };
    }
  }

  async getAllFundingSettings(company) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      
      // Filter for this company
      const coPrefix = `${normalize(company)}_`;
      const stationColls = collections.filter(c => c.startsWith(coPrefix) && c.endsWith('_stationData'));

      const result = new Map();

      for (const collName of stationColls) {
        // Parse name back to parts
        const parts = collName.replace('_stationData', '').split('_');
        // Format: Company_Location_AssetType
        // Company is parts[0]
        const loc = parts[1];
        const assetType = parts.slice(2).join('_'); // handle spaces in asset type if they became underscores
        
        const doc = await db.collection(collName).findOne({});
        if (doc && (doc['O&M'] || doc['Capital'] || doc['Decommission'])) {
           const key = `${company}|${loc}|${assetType}`; // Replicating Excel Map key format
           result.set(key, {
             om: doc['O&M'] || '',
             capital: doc['Capital'] || '',
             decommission: doc['Decommission'] || ''
           });
        }
      }
      return Object.fromEntries(result);
    } catch (error) {
      return {};
    }
  }

  async normalizeFundingOverrides() {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const stationColls = collections.filter(c => c.endsWith('_stationData'));
      let filesTouched = 0;

      for (const collName of stationColls) {
        const collection = db.collection(collName);
        
        // In Excel, this copies "Funding Split" to O&M/Capital/Decommission if they are empty.
        // We use an aggregation pipeline update to do this atomically and efficiently.
        
        await collection.updateMany(
          { 
            $or: [
              { 'O&M': { $exists: false } }, 
              { 'O&M': '' },
              { 'Capital': { $exists: false } }, 
              { 'Capital': '' },
              { 'Decommission': { $exists: false } }, 
              { 'Decommission': '' }
            ],
            'Funding Split': { $exists: true, $ne: '' }
          },
          [
            {
              $set: {
                'O&M': {
                  $cond: {
                    if: { $or: [{ $not: ["$O&M"] }, { $eq: ["$O&M", ""] }] },
                    then: "50%Default", // Simplified: Excel does complex token parsing logic here.
                    else: "$O&M"
                  }
                },
                'Capital': {
                  $cond: {
                     if: { $or: [{ $not: ["$Capital"] }, { $eq: ["$Capital", ""] }] },
                     then: "50%Default",
                    else: "$Capital"
                  }
                }
                // Logic repeats... 
                // NOTE: Full replication of Excel token parsing in Mongo pipeline is very complex.
                // This is a placeholder indicating where that logic belongs.
              }
            }
          ]
        );
        filesTouched++;
      }
      return { success: true, filesTouched };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // NUKE (RESET)
  // ════════════════════════════════════════════════════════════════════════════

  async nuke() {
    try {
      const db = mongoClient.getDatabase();
      await db.dropDatabase();
      console.log('[MongoPersistence] Database dropped successfully');
      
      // Re-create indexes immediately so app can restart cleanly without crash
      await this._createIndexes();
      
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] Nuke failed:', error);
      return { success: false, message: error.message };
    }
  }

}

module.exports = MongoPersistence;