// backend/persistence/MongoPersistence.js
// MongoDB-based persistence implementation

const IPersistence = require('./IPersistence');
const mongoClient = require('../db/mongoClient');
const { COLLECTIONS, addMetadata, stripMetadata } = require('../db/mongoSchemas');

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
        { key: { name: 1 }, unique: true }
      ]);

      // Locations
      await mongoClient.createIndexes(COLLECTIONS.LOCATIONS, [
        { key: { location: 1, company: 1 }, unique: true },
        { key: { company: 1 } }
      ]);

      // Asset Types
      await mongoClient.createIndexes(COLLECTIONS.ASSET_TYPES, [
        { key: { assetType: 1, location: 1, company: 1 }, unique: true },
        { key: { assetType: 1 } },
        { key: { company: 1, location: 1 } }
      ]);

      // Workplan Constants
      await mongoClient.createIndexes(COLLECTIONS.WORKPLAN_CONSTANTS, [
        { key: { parameter: 1 }, unique: true }
      ]);

      // Algorithm Parameters
      await mongoClient.createIndexes(COLLECTIONS.ALGORITHM_PARAMETERS, [
        { key: { parameter: 1 }, unique: true }
      ]);

      // Fixed Parameters
      await mongoClient.createIndexes(COLLECTIONS.FIXED_PARAMETERS, [
        { key: { parameter: 1 }, unique: true }
      ]);

      // Status Colors
      await mongoClient.createIndexes(COLLECTIONS.STATUS_COLORS, [
        { key: { status: 1 }, unique: true }
      ]);

      // Settings
      await mongoClient.createIndexes(COLLECTIONS.SETTINGS, [
        { key: { key: 1 }, unique: true }
      ]);

      // Inspection Keywords
      await mongoClient.createIndexes(COLLECTIONS.INSPECTION_KEYWORDS, [
        { key: { keyword: 1 }, unique: true }
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
    return companies.map(c => c.name);
  }

  async upsertCompany(name, active = true) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const now = new Date();

      await collection.updateOne(
        { name },
        {
          $set: { name, active, _updatedAt: now },
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
    return assets.map(a => a.assetType);
  }

  async upsertAssetType(assetType, company, location) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { assetType, location, company },
        {
          $set: { assetType, location, company, _updatedAt: now },
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
        { assetType, company, location },
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
      const { assetType, location, company, color } = asset;

      if (!color) continue;

      // Global colors (no location or company specified - would need separate logic)
      // For now, we'll populate byCompanyLocation only

      if (company && location) {
        if (!byCompanyLocation.has(company)) {
          byCompanyLocation.set(company, new Map());
        }
        const locMap = byCompanyLocation.get(company);

        if (!locMap.has(location)) {
          locMap.set(location, new Map());
        }
        const assetMap = locMap.get(location);
        assetMap.set(assetType, color);
      }
    }

    return { global, byLocation, byCompanyLocation };
  }

  async setAssetTypeColor(assetType, color) {
    try {
      // Global color - store with empty location/company
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { assetType, location: '', company: '' },
        {
          $set: { assetType, location: '', company: '', color, _updatedAt: now },
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
      // Location-specific color - store with empty company
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { assetType, location, company: '' },
        {
          $set: { assetType, location, company: '', color, _updatedAt: now },
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
        { assetType, company, location },
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
      // Gather all lookups data
      const companies = await this.getActiveCompanies();

      // Build locsByCompany
      const locsByCompany = {};
      const locationsCollection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const allLocations = await locationsCollection.find({}).toArray();
      for (const loc of allLocations) {
        if (!locsByCompany[loc.company]) {
          locsByCompany[loc.company] = [];
        }
        locsByCompany[loc.company].push(loc.location);
      }

      // Build assetsByCompanyLocation
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
        assetsByCompanyLocation[asset.company][asset.location].push(asset.assetType);
      }

      // Build color maps
      const colorsGlobal = {};
      const colorsByLoc = {};
      const colorsByCompanyLoc = {};

      for (const asset of allAssets) {
        if (!asset.color) continue;

        if (!asset.location && !asset.company) {
          // Global
          colorsGlobal[asset.assetType] = asset.color;
        } else if (asset.location && !asset.company) {
          // By location
          if (!colorsByLoc[asset.location]) {
            colorsByLoc[asset.location] = {};
          }
          colorsByLoc[asset.location][asset.assetType] = asset.color;
        } else if (asset.company && asset.location) {
          // By company + location
          if (!colorsByCompanyLoc[asset.company]) {
            colorsByCompanyLoc[asset.company] = {};
          }
          if (!colorsByCompanyLoc[asset.company][asset.location]) {
            colorsByCompanyLoc[asset.company][asset.location] = {};
          }
          colorsByCompanyLoc[asset.company][asset.location][asset.assetType] = asset.color;
        }
      }

      // Build location links
      const locationLinks = {};
      for (const loc of allLocations) {
        if (loc.link) {
          if (!locationLinks[loc.company]) {
            locationLinks[loc.company] = {};
          }
          locationLinks[loc.company][loc.location] = loc.link;
        }
      }

      // Build asset type links
      const assetTypeLinks = {};
      for (const asset of allAssets) {
        if (asset.link && asset.company && asset.location) {
          if (!assetTypeLinks[asset.company]) {
            assetTypeLinks[asset.company] = {};
          }
          if (!assetTypeLinks[asset.company][asset.location]) {
            assetTypeLinks[asset.company][asset.location] = {};
          }
          assetTypeLinks[asset.company][asset.location][asset.assetType] = asset.link;
        }
      }

      // Status and repair settings
      const statusColorsMap = {};
      const statusColorsCollection = mongoClient.getCollection(COLLECTIONS.STATUS_COLORS);
      const statusColorsDocs = await statusColorsCollection.find({}).toArray();
      for (const doc of statusColorsDocs) {
        statusColorsMap[doc.status] = doc.color;
      }

      const settingsCollection = mongoClient.getCollection(COLLECTIONS.SETTINGS);
      const applyStatusSetting = await settingsCollection.findOne({ key: 'applyStatusColorsOnMap' });
      const applyRepairSetting = await settingsCollection.findOne({ key: 'applyRepairColorsOnMap' });

      // Inspection keywords
      const keywordsCollection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);
      const keywordsDocs = await keywordsCollection.find({}).toArray();
      const inspectionKeywords = keywordsDocs.map(k => k.keyword);

      return {
        mtimeMs: Date.now(), // Use current timestamp for MongoDB
        companies,
        locsByCompany,
        assetsByCompanyLocation,
        colorsGlobal,
        colorsByLoc,
        colorsByCompanyLoc,
        locationLinks,
        assetTypeLinks,
        statusColors: statusColorsMap,
        applyStatusColorsOnMap: applyStatusSetting ? applyStatusSetting.value : false,
        repairColors: {},
        applyRepairColorsOnMap: applyRepairSetting ? applyRepairSetting.value : false,
        inspectionKeywords
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
        inspectionKeywords: []
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
        { status: statusKey },
        {
          $set: { status: statusKey, color, _updatedAt: now },
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
        { key },
        {
          $set: { key, value: !!value, _updatedAt: now },
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
      await collection.deleteOne({ status: statusKey });
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
    return keywords.map(k => k.keyword);
  }

  async setInspectionKeywords(keywords) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);

      // Clear existing keywords
      await collection.deleteMany({});

      // Insert new keywords
      if (keywords.length > 0) {
        const docs = keywords.map(keyword => addMetadata({ keyword }, 'manual'));
        await collection.insertMany(docs);
      }

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setInspectionKeywords failed:', error.message);
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

      // Filter station data collections
      const stationCollections = collections.filter(name => name.endsWith('_stationData'));
      console.log(`[MongoPersistence] Found ${stationCollections.length} station collections:`, stationCollections);

      const allStations = [];

      for (const collName of stationCollections) {
        const collection = db.collection(collName);
        const stations = await collection.find({}).toArray();

        // Add to aggregate
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
      // For MongoDB, we don't have workbooks, but we can simulate it
      // by gathering all station collections for the company/location
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      const relevantCollections = collections.filter(name =>
        name.startsWith(prefix) && name.endsWith('_stationData')
      );

      const sheets = {};
      for (const collName of relevantCollections) {
        const collection = db.collection(collName);
        const data = await collection.find({}).toArray();
        sheets[collName] = data;
      }

      return { success: true, sheets };
    } catch (error) {
      console.error('[MongoPersistence] readLocationWorkbook failed:', error.message);
      return { success: false, sheets: {} };
    }
  }

  async readSheetData(company, locationName, sheetName) {
    try {
      // Determine collection name from sheet name
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      // If sheetName doesn't already include company/location, construct it
      let collectionName;
      if (sheetName.includes('_stationData')) {
        collectionName = sheetName;
      } else {
        // Extract asset type from sheet name (e.g., "Cableway BC" -> "Cableway")
        const parts = sheetName.split(' ');
        const assetType = parts.slice(0, -1).join(' '); // Remove last part (location)
        collectionName = mongoClient.getStationCollectionName(company, locationName, assetType);
      }

      const collection = mongoClient.getCollection(collectionName);
      const data = await collection.find({}).toArray();

      return { success: true, data };
    } catch (error) {
      console.error('[MongoPersistence] readSheetData failed:', error.message);
      return { success: false, data: [] };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - WRITE
  // ════════════════════════════════════════════════════════════════════════════

  async writeLocationRows(company, location, sheetName, sections, headers, rows) {
    try {
      // Extract asset type from sheet name (e.g., "Cableway BC" -> "Cableway")
      const parts = sheetName.split(' ');
      const assetType = parts.slice(0, -1).join(' ');

      const collectionName = mongoClient.getStationCollectionName(company, location, assetType);
      console.log(`[MongoPersistence] Writing ${rows.length} stations to collection: ${collectionName}`);

      const collection = mongoClient.getCollection(collectionName);

      // Transform rows to MongoDB documents
      const now = new Date();

      // Insert or update each document
      for (const row of rows) {
        // Separate metadata from data
        const { _id, _createdAt, _updatedAt, _source, ...cleanRow } = row;

        await collection.updateOne(
          { station_id: row.station_id || row['Station ID'] },
          {
            $set: {
              ...cleanRow,
              company,
              location_file: location,
              asset_type: assetType,
              _updatedAt: now
            },
            $setOnInsert: {
              _createdAt: now,
              _source: 'manual'
            }
          },
          { upsert: true }
        );
      }

      console.log(`[MongoPersistence] Successfully wrote ${rows.length} stations to ${collectionName}`);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] writeLocationRows failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema) {
    try {
      // Find which collection contains this station
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      const stationCollections = collections.filter(name =>
        name.startsWith(prefix) && name.endsWith('_stationData')
      );

      let updated = false;
      for (const collName of stationCollections) {
        const collection = db.collection(collName);
        const existing = await collection.findOne({ station_id: stationId });

        if (existing) {
          // Remove metadata fields from update
          const { _id, _createdAt, _updatedAt, _source, ...cleanData } = updatedRowData;

          await collection.updateOne(
            { station_id: stationId },
            {
              $set: {
                ...cleanData,
                _updatedAt: new Date()
              }
            }
          );
          updated = true;
          break;
        }
      }

      if (!updated) {
        return { success: false, message: 'Station not found' };
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
      console.error('[MongoPersistence] listRepairsForStation failed:', error.message);
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

      // Insert new repairs
      if (repairs.length > 0) {
        const now = new Date();
        const docs = repairs.map(repair => {
          const { _id, _createdAt, _updatedAt, _source, ...cleanRepair } = repair;
          return {
            ...cleanRepair,
            station_id: stationId,
            assetType: cleanRepair.assetType || assetType,
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
      console.log(`[MongoPersistence] Appending repair to collection: ${collectionName}`);

      const collection = mongoClient.getCollection(collectionName);

      const { _id, _createdAt, _updatedAt, _source, ...cleanRepair } = repair;
      const now = new Date();

      const doc = {
        ...cleanRepair,
        station_id: cleanRepair.station_id || cleanRepair['Station ID'],
        assetType: cleanRepair.assetType || cleanRepair['Asset Type'] || assetType,
        location,
        company,
        _createdAt: now,
        _updatedAt: now,
        _source: 'manual'
      };

      await collection.insertOne(doc);

      console.log(`[MongoPersistence] Successfully appended repair to ${collectionName}`);
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

      // Get repairs for this station
      const repairs = await collection.find({ station_id: stationId }).sort({ date: 1 }).toArray();

      if (repairIndex < 0 || repairIndex >= repairs.length) {
        return { success: false, message: 'Invalid repair index' };
      }

      // Delete the specific repair by _id
      await collection.deleteOne({ _id: repairs[repairIndex]._id });

      return { success: true };
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
      const params = await collection.find({}).toArray();
      return params;
    } catch (error) {
      console.error('[MongoPersistence] getAlgorithmParameters failed:', error.message);
      return [];
    }
  }

  async saveAlgorithmParameters(rows) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ALGORITHM_PARAMETERS);

      // Clear existing parameters
      await collection.deleteMany({});

      // Insert new parameters
      if (rows.length > 0) {
        const docs = rows.map(row => addMetadata(row, 'manual'));
        await collection.insertMany(docs);
      }

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] saveAlgorithmParameters failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getWorkplanConstants() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.WORKPLAN_CONSTANTS);
      const constants = await collection.find({}).toArray();
      return constants;
    } catch (error) {
      console.error('[MongoPersistence] getWorkplanConstants failed:', error.message);
      return [];
    }
  }

  async saveWorkplanConstants(rows) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.WORKPLAN_CONSTANTS);

      // Clear existing constants
      await collection.deleteMany({});

      // Insert new constants
      if (rows.length > 0) {
        const docs = rows.map(row => addMetadata(row, 'manual'));
        await collection.insertMany(docs);
      }

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] saveWorkplanConstants failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getCustomWeights() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.CUSTOM_WEIGHTS);
      const weights = await collection.find({}).toArray();
      return weights;
    } catch (error) {
      console.error('[MongoPersistence] getCustomWeights failed:', error.message);
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
      console.error('[MongoPersistence] addCustomWeight failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getFixedParameters() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FIXED_PARAMETERS);
      const params = await collection.find({}).toArray();
      return params;
    } catch (error) {
      console.error('[MongoPersistence] getFixedParameters failed:', error.message);
      return [];
    }
  }

  async saveFixedParameters(params) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FIXED_PARAMETERS);

      // Clear existing parameters
      await collection.deleteMany({});

      // Insert new parameters
      if (params.length > 0) {
        const docs = params.map(param => addMetadata(param, 'manual'));
        await collection.insertMany(docs);
      }

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] saveFixedParameters failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  async listSheets(b64) {
    // This operation is Excel-specific, delegate to Excel for base64 parsing
    // MongoDB doesn't handle Excel file parsing
    return { success: false, message: 'listSheets not supported for MongoDB - use Excel persistence' };
  }

  async ensureLookupsReady() {
    // For MongoDB, ensure all collections exist (they're created automatically on first insert)
    return { success: true };
  }
}

module.exports = MongoPersistence;
