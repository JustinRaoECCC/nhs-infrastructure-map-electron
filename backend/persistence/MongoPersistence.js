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
}

module.exports = MongoPersistence;