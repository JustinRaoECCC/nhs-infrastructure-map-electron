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

      // Project Keywords
      await mongoClient.createIndexes(COLLECTIONS.PROJECT_KEYWORDS, [
        { key: { keyword: 1 }, unique: true }
      ]);

      // Funding Settings
      await mongoClient.createIndexes(COLLECTIONS.FUNDING_SETTINGS, [
        { key: { company: 1, location: 1, assetType: 1 }, unique: true },
        { key: { company: 1, location: 1 } }
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

    // Shape must match Excel snapshot: array of { name, description, email }
    return companies.map(c => ({
      name: c.name,
      description: c.description || '',
      email: c.email || '',
    }));
  }

  async upsertCompany(name, active = true, description = '', email = '') {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const now = new Date();

      await collection.updateOne(
        { name },
        {
          $set: { name, active, description: description || '', email: email || '', _updatedAt: now },
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

      // Project keywords
      const projectKeywordsCollection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
      const projectKeywordsDocs = await projectKeywordsCollection.find({}).toArray();
      const projectKeywords = projectKeywordsDocs.map(k => k.keyword);

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
  // LOOKUPS - PROJECT KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  async getProjectKeywords() {
    const collection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
    const keywords = await collection.find({}).toArray();
    return keywords.map(k => k.keyword);
  }

  async setProjectKeywords(keywords) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);

      // Clear existing keywords
      await collection.deleteMany({});

      // Insert new keywords
      if (keywords.length > 0) {
        const docs = keywords.map(keyword => addMetadata({ keyword }, 'manual'));
        await collection.insertMany(docs);
      }

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setProjectKeywords failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FUNDING TYPE OVERRIDE SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  async getFundingSettings(company, location) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);

      // Get location-wide funding settings (where assetType is empty string)
      const settings = await collection.findOne({ company, location, assetType: '' });

      if (!settings) {
        // Return empty settings if none found
        return { om: '', capital: '', decommission: '' };
      }

      return {
        om: settings.om || '',
        capital: settings.capital || '',
        decommission: settings.decommission || ''
      };
    } catch (error) {
      console.error('[MongoPersistence] getFundingSettings failed:', error.message);
      return { om: '', capital: '', decommission: '' };
    }
  }

  async saveFundingSettings(company, location, settings) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);
      const now = new Date();

      await collection.updateOne(
        { company, location, assetType: '' },
        {
          $set: {
            company,
            location,
            assetType: '',
            om: settings.om || '',
            capital: settings.capital || '',
            decommission: settings.decommission || '',
            _updatedAt: now
          },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] saveFundingSettings failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async saveFundingSettingsForAssetType(company, location, assetType, settings) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);
      const now = new Date();

      await collection.updateOne(
        { company, location, assetType },
        {
          $set: {
            company,
            location,
            assetType,
            om: settings.om || '',
            capital: settings.capital || '',
            decommission: settings.decommission || '',
            _updatedAt: now
          },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] saveFundingSettingsForAssetType failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getAllFundingSettings(company) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);

      // Get all funding settings for the company
      const allSettings = await collection.find({ company }).toArray();

      // Build a Map of location -> funding settings
      const settingsMap = new Map();

      for (const setting of allSettings) {
        const { location, assetType, om, capital, decommission } = setting;

        if (!settingsMap.has(location)) {
          settingsMap.set(location, {});
        }

        const locSettings = settingsMap.get(location);
        const key = assetType || '_default'; // Empty string means location-wide default

        locSettings[key] = { om, capital, decommission };
      }

      return settingsMap;
    } catch (error) {
      console.error('[MongoPersistence] getAllFundingSettings failed:', error.message);
      return new Map();
    }
  }

  async normalizeFundingOverrides() {
    try {
      // This function ensures consistency across all funding settings
      // For MongoDB, we can validate that all funding settings have proper structure
      const collection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);
      const allSettings = await collection.find({}).toArray();

      let updateCount = 0;

      for (const setting of allSettings) {
        let needsUpdate = false;
        const updates = {};

        // Ensure all three funding fields exist (even if empty)
        if (!setting.hasOwnProperty('om')) {
          updates.om = '';
          needsUpdate = true;
        }
        if (!setting.hasOwnProperty('capital')) {
          updates.capital = '';
          needsUpdate = true;
        }
        if (!setting.hasOwnProperty('decommission')) {
          updates.decommission = '';
          needsUpdate = true;
        }

        if (needsUpdate) {
          await collection.updateOne(
            { _id: setting._id },
            { $set: { ...updates, _updatedAt: new Date() } }
          );
          updateCount++;
        }
      }

      console.log(`[MongoPersistence] Normalized ${updateCount} funding settings`);
      return { success: true, message: `Normalized ${updateCount} funding settings` };
    } catch (error) {
      console.error('[MongoPersistence] normalizeFundingOverrides failed:', error.message);
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

        // Enrich each station with funding information
        for (const station of stations) {
          const company = station.company;
          const location = station.location_file || station.location;
          const assetType = station.asset_type || station.assetType;
          const stationId = station.station_id;

          // Funding is already in the station document, but we ensure consistent fields
          if (company && location && assetType && stationId) {
            // The funding fields should already be in the station document from import
            // But we can ensure they exist by looking them up if missing
            const hasFunding = station.hasOwnProperty('om') || station.hasOwnProperty('O&M') ||
                              station.hasOwnProperty('capital') || station.hasOwnProperty('Capital');

            if (!hasFunding) {
              // Funding not in document, look it up (this shouldn't normally happen)
              const funding = await this._lookupFundingOverridesFor(company, location, assetType, stationId);
              station.om = funding.om;
              station.capital = funding.capital;
              station.decommission = funding.decommission;
            } else {
              // Normalize field names to lowercase
              station.om = station.om || station['O&M'] || station['Funding Type Override Settings – O&M'] || '';
              station.capital = station.capital || station['Capital'] || station['Funding Type Override Settings – Capital'] || '';
              station.decommission = station.decommission || station['Decommission'] || station['Funding Type Override Settings – Decommission'] || '';
            }
          }
        }

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
      const rawData = await collection.find({}).toArray();

      // Apply header normalization to each document
      const normalizedData = rawData.map(doc => this._normalizeDocumentHeaders(doc));

      return { success: true, data: normalizedData };
    } catch (error) {
      console.error('[MongoPersistence] readSheetData failed:', error.message);
      return { success: false, data: [] };
    }
  }

  _normalizeDocumentHeaders(doc) {
    const normalized = {};
    const giFields = ['station id', 'stationid', 'id', 'category', 'asset type', 'type',
                      'site name', 'station name', 'name', 'province', 'location',
                      'latitude', 'lat', 'longitude', 'lon', 'status'];

    // Helper to normalize a header pair (section, field)
    const normalizeHeaderPair = (sec, fld) => {
      const s = String(sec || '').trim();
      const f = String(fld || '').trim();
      const fl = f.toLowerCase();

      // Normalize synonyms to canonical names
      if (fl === 'asset type' || fl === 'type' || fl === 'category') {
        return { sec: 'General Information', fld: 'Category' };
      }

      if (['site name', 'station name', 'name'].includes(fl)) {
        return { sec: 'General Information', fld: 'Station Name' };
      }

      // Check if it's a GI field
      if (giFields.includes(fl)) {
        return { sec: 'General Information', fld: f };
      }

      // Non-GI field: use provided section or "Extra Information"
      return { sec: s || 'Extra Information', fld: f };
    };

    // Process each field in the document
    for (const [key, value] of Object.entries(doc)) {
      // Skip metadata fields
      if (key.startsWith('_')) {
        normalized[key] = value;
        continue;
      }

      // Store field with its original name (no composite keys)
      // The field name from Excel row 2 already has the context
      normalized[key] = value;
    }

    return normalized;
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

      // Transform rows to MongoDB documents with two-row header support
      const now = new Date();

      // Build composite keys from sections and headers if both are provided
      const hasCompositeHeaders = sections && sections.length > 0 && headers && headers.length === sections.length;

      // Insert or update each document
      for (const row of rows) {
        // Separate metadata from data
        const { _id, _createdAt, _updatedAt, _source, ...cleanRow } = row;

        // Transform row data to use composite keys if two-row headers are provided
        const transformedRow = {};

        if (hasCompositeHeaders) {
          // Process with two-row header structure
          for (let i = 0; i < headers.length; i++) {
            const section = sections[i] || '';
            const field = headers[i];

            if (!field) continue;

            // Look for this field's value in the row data
            // Try various key formats: "Section – Field", field alone, etc.
            const compositeKey = section ? `${section} – ${field}` : field;
            let value = cleanRow[compositeKey] || cleanRow[field];

            // Try lowercase variations
            if (value === undefined) {
              const rowKeys = Object.keys(cleanRow);
              for (const key of rowKeys) {
                if (key.toLowerCase() === compositeKey.toLowerCase() || key.toLowerCase() === field.toLowerCase()) {
                  value = cleanRow[key];
                  break;
                }
              }
            }

            // Store with field name only (not composite key)
            // The field name already contains the context (e.g., "Land Ownership - LB")
            // We don't need to prepend the section name
            transformedRow[field] = value !== undefined ? value : '';
          }
        } else {
          // No two-row headers - just use the row as-is
          Object.assign(transformedRow, cleanRow);
        }

        // Extract station ID (try various field names)
        const stationId = transformedRow.station_id || transformedRow['Station ID'] ||
                         transformedRow['General Information – Station ID'] ||
                         row.station_id || row['Station ID'];

        await collection.updateOne(
          { station_id: stationId },
          {
            $set: {
              ...transformedRow,
              station_id: stationId, // Ensure station_id is always set
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
          // Apply schema merging if schema is provided
          let mergedData;
          if (schema && schema.sections && schema.fields) {
            mergedData = await this._mergeStationWithSchema(existing, updatedRowData, schema);
          } else {
            // Simple update without schema merging
            const { _id, _createdAt, _updatedAt, _source, ...cleanData } = updatedRowData;
            mergedData = cleanData;
          }

          await collection.updateOne(
            { station_id: stationId },
            {
              $set: {
                ...mergedData,
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

  async _mergeStationWithSchema(existingStation, updatedData, schema) {
    // Field synonym mappings for General Information fields
    const fieldSynonyms = {
      'station id': ['stationid', 'id', 'station id', 'station_id'],
      'category': ['asset type', 'type', 'category', 'asset_type'],
      'site name': ['station name', 'name', 'site name'],
      'station name': ['site name', 'name', 'station name'],
      'province': ['location', 'state', 'region', 'province'],
      'latitude': ['lat', 'y', 'latitude'],
      'longitude': ['long', 'lng', 'lon', 'x', 'longitude'],
      'status': ['status']
    };

    // Helper to find value considering field synonyms
    const findValue = (field, section, source) => {
      const fieldLower = field.toLowerCase();

      // Try exact match first
      let value = source[field];
      if (value !== undefined) return value;

      // Try lowercase keys
      const allKeys = Object.keys(source);
      for (const key of allKeys) {
        if (key.toLowerCase() === fieldLower) {
          return source[key];
        }
      }

      // Try synonyms for GI fields
      for (const [canonical, synonyms] of Object.entries(fieldSynonyms)) {
        if (synonyms.includes(fieldLower)) {
          for (const syn of synonyms) {
            value = source[syn];
            if (value !== undefined) return value;

            // Try with different casing
            for (const key of allKeys) {
              if (key.toLowerCase() === syn) {
                return source[key];
              }
            }
          }
        }
      }

      return undefined;
    };

    // Build merged station object
    const mergedStation = {};

    // General Information fields - preserve from existing or update
    const giFields = ['station_id', 'station id', 'category', 'asset_type', 'site name',
                      'station name', 'name', 'province', 'location', 'latitude',
                      'lat', 'longitude', 'lon', 'status', 'company', 'location_file'];

    // First, copy all GI fields from existing station
    for (const key of Object.keys(existingStation)) {
      const keyLower = key.toLowerCase();
      if (giFields.includes(keyLower) || key.startsWith('_')) {
        mergedStation[key] = existingStation[key];
      }
    }

    // Update GI fields from updatedData if provided
    for (const key of Object.keys(updatedData)) {
      const keyLower = key.toLowerCase();
      if (giFields.includes(keyLower) && !key.startsWith('_')) {
        mergedStation[key] = updatedData[key];
      }
    }

    // Build current values map from existing station (excluding GI and metadata)
    const currentValues = new Map();
    for (const [key, value] of Object.entries(existingStation)) {
      const keyLower = key.toLowerCase();
      if (!giFields.includes(keyLower) && !key.startsWith('_')) {
        currentValues.set(keyLower, value);
        currentValues.set(key, value); // Keep original casing too
      }
    }

    // Apply schema fields
    if (schema.fields && schema.sections) {
      for (let i = 0; i < schema.fields.length; i++) {
        const section = schema.sections[i];
        const field = schema.fields[i];

        // Skip General Information fields - already handled
        if (section && section.toLowerCase() === 'general information') continue;

        // Use field name only (not composite key)
        // The field name already contains the context from Excel

        // Get value: priority is updatedData > currentValues > empty string
        let value = findValue(field, section, updatedData);

        if (value === undefined) {
          // Look in current values
          value = findValue(field, section, existingStation);
        }

        if (value === undefined) {
          value = ''; // Default to empty string for missing fields
        }

        // Store with field name only
        mergedStation[field] = value;
      }
    } else {
      // No schema provided, merge updatedData into existing
      for (const [key, value] of Object.entries(updatedData)) {
        if (!key.startsWith('_')) {
          mergedStation[key] = value;
        }
      }
    }

    // Remove metadata fields
    const { _id, _createdAt, _updatedAt, _source, ...cleanMerged } = mergedStation;

    return cleanMerged;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEMA MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  async updateAssetTypeSchema(assetType, schema, excludeStationId) {
    try {
      // Find all station collections for this asset type across all companies/locations
      const collections = await mongoClient.listCollections();
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const assetNorm = normalize(assetType);

      // Find collections matching this asset type
      const relevantCollections = collections.filter(name =>
        name.endsWith(`_${assetNorm}_stationData`)
      );

      console.log(`[MongoPersistence] Updating schema for ${assetType} across ${relevantCollections.length} collections`);

      const db = mongoClient.getDatabase();
      let updateCount = 0;

      for (const collName of relevantCollections) {
        const collection = db.collection(collName);
        const stations = await collection.find({}).toArray();

        for (const station of stations) {
          // Skip excluded station if specified
          if (excludeStationId && station.station_id === excludeStationId) {
            continue;
          }

          // Schema synchronization: ensure all fields from schema exist
          // This is a simplified version - full schema merging is complex
          let needsUpdate = false;
          const updates = {};

          if (schema && schema.headers) {
            for (const header of schema.headers) {
              if (!station.hasOwnProperty(header) && header !== 'Station ID') {
                updates[header] = '';
                needsUpdate = true;
              }
            }
          }

          if (needsUpdate) {
            await collection.updateOne(
              { _id: station._id },
              { $set: { ...updates, _updatedAt: new Date() } }
            );
            updateCount++;
          }
        }
      }

      console.log(`[MongoPersistence] Updated ${updateCount} stations with new schema`);
      return { success: true, message: `Updated ${updateCount} stations` };
    } catch (error) {
      console.error('[MongoPersistence] updateAssetTypeSchema failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DELETION OPERATIONS
  // ════════════════════════════════════════════════════════════════════════════

  async deleteCompanyFromLookups(companyName) {
    try {
      console.log(`[MongoPersistence] Deleting company: ${companyName}`);

      // Delete from companies collection
      const companiesCollection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      await companiesCollection.deleteOne({ name: companyName });

      // Delete all locations for this company
      const locationsCollection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      await locationsCollection.deleteMany({ company: companyName });

      // Delete all asset types for this company
      const assetTypesCollection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      await assetTypesCollection.deleteMany({ company: companyName });

      // Delete funding settings for this company
      const fundingCollection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);
      await fundingCollection.deleteMany({ company: companyName });

      console.log(`[MongoPersistence] Successfully deleted company: ${companyName}`);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] deleteCompanyFromLookups failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteLocationFromLookups(companyName, locationName) {
    try {
      console.log(`[MongoPersistence] Deleting location: ${companyName}/${locationName}`);

      // Delete from locations collection
      const locationsCollection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      await locationsCollection.deleteOne({ company: companyName, location: locationName });

      // Delete all asset types for this location
      const assetTypesCollection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      await assetTypesCollection.deleteMany({ company: companyName, location: locationName });

      // Delete funding settings for this location
      const fundingCollection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);
      await fundingCollection.deleteMany({ company: companyName, location: locationName });

      console.log(`[MongoPersistence] Successfully deleted location: ${companyName}/${locationName}`);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] deleteLocationFromLookups failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteAssetTypeFromLookups(companyName, locationName, assetTypeName) {
    try {
      console.log(`[MongoPersistence] Deleting asset type from lookups: ${companyName}/${locationName}/${assetTypeName}`);

      // Delete from asset types collection
      const assetTypesCollection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      await assetTypesCollection.deleteOne({
        company: companyName,
        location: locationName,
        assetType: assetTypeName
      });

      // Delete funding settings for this asset type
      const fundingCollection = mongoClient.getCollection(COLLECTIONS.FUNDING_SETTINGS);
      await fundingCollection.deleteMany({
        company: companyName,
        location: locationName,
        assetType: assetTypeName
      });

      console.log(`[MongoPersistence] Successfully deleted asset type from lookups: ${assetTypeName}`);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] deleteAssetTypeFromLookups failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteAssetTypeFromLocation(companyName, locationName, assetTypeName) {
    try {
      console.log(`[MongoPersistence] Deleting asset type data: ${companyName}/${locationName}/${assetTypeName}`);

      // Drop the station data collection for this asset type
      const collectionName = mongoClient.getStationDataCollectionName(companyName, locationName, assetTypeName);
      const db = mongoClient.getDatabase();

      // Check if collection exists first
      const collections = await mongoClient.listCollections();
      if (collections.includes(collectionName)) {
        await db.collection(collectionName).drop();
        console.log(`[MongoPersistence] Dropped collection: ${collectionName}`);
      }

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] deleteAssetTypeFromLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HELPERS - FUNDING
  // ════════════════════════════════════════════════════════════════════════════

  async _lookupFundingOverridesFor(company, location, assetType, stationId) {
    const result = { om: '', capital: '', decommission: '' };

    if (!assetType || !stationId) {
      return result;
    }

    try {
      // Find the station data collection for this company/location/assetType
      const collectionName = mongoClient.getStationDataCollectionName(company, location, assetType);
      const collection = mongoClient.getCollection(collectionName);

      // Query for the specific station
      const station = await collection.findOne({ station_id: stationId });

      if (!station) {
        return result;
      }

      // Look for funding fields - they may be stored with various key formats:
      // - "Funding Type Override Settings – O&M"
      // - "Funding Type Override Settings - O&M"
      // - "O&M"
      // - etc.
      const keys = Object.keys(station);

      for (const key of keys) {
        const lowerKey = key.toLowerCase();

        // Check for O&M
        if (lowerKey.includes('o&m') || lowerKey.includes('om')) {
          if (lowerKey.includes('funding') || key === 'O&M') {
            result.om = station[key] || '';
          }
        }

        // Check for Capital
        if (lowerKey.includes('capital')) {
          if (lowerKey.includes('funding') || key === 'Capital') {
            result.capital = station[key] || '';
          }
        }

        // Check for Decommission
        if (lowerKey.includes('decommission') || lowerKey.includes('decomm')) {
          if (lowerKey.includes('funding') || key === 'Decommission') {
            result.decommission = station[key] || '';
          }
        }
      }

      return result;
    } catch (error) {
      console.error('[MongoPersistence] _lookupFundingOverridesFor failed:', error.message);
      return result;
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

      // Extract station ID and asset type
      const stationId = cleanRepair.station_id || cleanRepair['Station ID'];
      const at = cleanRepair.assetType || cleanRepair['Asset Type'] || assetType;

      // Lookup funding overrides from station data
      const funding = await this._lookupFundingOverridesFor(company, location, at, stationId);

      // Determine which funding column to populate based on Category
      const category = cleanRepair.category || cleanRepair.Category || 'Capital';
      const categoryLower = category.toLowerCase();

      let omValue = '';
      let capitalValue = '';
      let decommissionValue = '';

      if (/^o&?m$/i.test(categoryLower)) {
        // O&M category - populate O&M field
        omValue = funding.om || '';
      } else if (/^decomm/i.test(categoryLower)) {
        // Decommission category - populate Decommission field
        decommissionValue = funding.decommission || '';
      } else {
        // Capital category (default) - populate Capital field
        capitalValue = funding.capital || '';
      }

      const doc = {
        ...cleanRepair,
        station_id: stationId,
        assetType: at,
        category: category,
        location,
        company,
        'O&M': omValue,
        'Capital': capitalValue,
        'Decommission': decommissionValue,
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

  async parseRows(b64) {
    // This operation is Excel-specific and requires Excel parsing
    // MongoDB doesn't handle Excel file parsing
    // For MongoDB migration, data should already be in the database
    console.warn('[MongoPersistence] parseRows is Excel-specific - not supported in MongoDB');
    return [];
  }

  async parseRowsFromSheet(b64, sheetName) {
    // This operation is Excel-specific and requires Excel parsing
    // MongoDB doesn't handle Excel file parsing
    // For MongoDB migration, data should already be in the database
    console.warn('[MongoPersistence] parseRowsFromSheet is Excel-specific - not supported in MongoDB');
    return [];
  }

  async getWorkbookFieldCatalog(company, locationName) {
    try {
      // Extract all field names from station collections for this location
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      const stationCollections = collections.filter(name =>
        name.startsWith(prefix) && name.endsWith('_stationData')
      );

      const repairsCollectionName = mongoClient.getRepairsCollectionName(company, locationName);
      const repairsFields = [];
      const sheetFields = {};

      // Get repairs fields
      if (collections.includes(repairsCollectionName)) {
        const repairsCollection = db.collection(repairsCollectionName);
        const sample = await repairsCollection.findOne({});
        if (sample) {
          repairsFields.push(...Object.keys(sample).filter(k => !k.startsWith('_')));
        }
      }

      // Get fields from each station collection
      for (const collName of stationCollections) {
        const collection = db.collection(collName);
        const sample = await collection.findOne({});
        if (sample) {
          // Extract sheet name from collection name
          const sheetName = collName.replace(prefix, '').replace('_stationData', '');
          sheetFields[sheetName] = Object.keys(sample).filter(k => !k.startsWith('_'));
        }
      }

      return { repairsFields, sheetFields };
    } catch (error) {
      console.error('[MongoPersistence] getWorkbookFieldCatalog failed:', error.message);
      return { repairsFields: [], sheetFields: {} };
    }
  }

  async ensureLookupsReady() {
    // For MongoDB, ensure all collections exist (they're created automatically on first insert)
    return { success: true };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION (Future Use - Currently Disabled)
  // ════════════════════════════════════════════════════════════════════════════

  async createAuthWorkbook() {
    try {
      // For MongoDB, we just ensure the auth collection exists
      // It will be created automatically on first insert
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] createAuthWorkbook failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async createAuthUser(userData) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const now = new Date();

      const doc = {
        ...userData,
        _createdAt: now,
        _updatedAt: now,
        _source: 'manual'
      };

      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] createAuthUser failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async loginAuthUser(name, hashedPassword) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);

      const user = await collection.findOne({ name, hashedPassword });

      if (user) {
        // Update last login timestamp
        await collection.updateOne(
          { _id: user._id },
          { $set: { lastLogin: new Date() } }
        );

        return { success: true, user: { name: user.name, role: user.role } };
      }

      return { success: false, message: 'Invalid credentials' };
    } catch (error) {
      console.error('[MongoPersistence] loginAuthUser failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async logoutAuthUser(name) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);

      await collection.updateOne(
        { name },
        { $set: { lastLogout: new Date() } }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] logoutAuthUser failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getAllAuthUsers() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const users = await collection.find({}).toArray();

      // Strip sensitive data
      return users.map(u => ({
        name: u.name,
        role: u.role,
        lastLogin: u.lastLogin,
        lastLogout: u.lastLogout
      }));
    } catch (error) {
      console.error('[MongoPersistence] getAllAuthUsers failed:', error.message);
      return [];
    }
  }

  async hasAuthUsers() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const count = await collection.countDocuments();
      return count > 0;
    } catch (error) {
      console.error('[MongoPersistence] hasAuthUsers failed:', error.message);
      return false;
    }
  }
}

module.exports = MongoPersistence;
