// backend/repositories/mongodb/mongodb_lookup_repo.js
const BaseRepository = require('../base_repository');
const { getCollection } = require('./mongodb_client');

class MongoDBLookupRepository extends BaseRepository {
  constructor() {
    super();
    this.collectionsMap = {
      companies: 'companies',
      locations: 'locations',
      assetTypes: 'asset_types',
      colors: 'colors',
      statusColors: 'status_colors',
      settings: 'settings',
      inspectionKeywords: 'inspection_keywords',
    };
  }

  /**
   * Get all companies
   */
  async getActiveCompanies() {
    try {
      const collection = getCollection(this.collectionsMap.companies);
      const companies = await collection.find({ active: true }).toArray();
      return companies.map(c => c.name);
    } catch (error) {
      console.error('[MongoDB Lookup Repo] getActiveCompanies failed:', error);
      throw error;
    }
  }

  /**
   * Get locations for company
   */
  async getLocationsForCompany(company) {
    try {
      const collection = getCollection(this.collectionsMap.locations);
      const locations = await collection.find({ company }).toArray();
      return locations.map(l => l.location);
    } catch (error) {
      console.error('[MongoDB Lookup Repo] getLocationsForCompany failed:', error);
      throw error;
    }
  }

  /**
   * Get asset types for company+location
   */
  async getAssetTypesForCompanyLocation(company, location) {
    try {
      const collection = getCollection(this.collectionsMap.assetTypes);
      const assetTypes = await collection.find({ company, location }).toArray();
      return assetTypes.map(at => at.asset_type);
    } catch (error) {
      console.error('[MongoDB Lookup Repo] getAssetTypesForCompanyLocation failed:', error);
      throw error;
    }
  }

  /**
   * Upsert company
   */
  async upsertCompany(name, active = true) {
    try {
      const collection = getCollection(this.collectionsMap.companies);
      await collection.updateOne(
        { name },
        { $set: { name, active, updated_at: new Date() } },
        { upsert: true }
      );
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Lookup Repo] upsertCompany failed:', error);
      throw error;
    }
  }

  /**
   * Upsert location
   */
  async upsertLocation(location, company, link = '') {
    try {
      const collection = getCollection(this.collectionsMap.locations);
      await collection.updateOne(
        { location, company },
        { $set: { location, company, link, updated_at: new Date() } },
        { upsert: true }
      );
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Lookup Repo] upsertLocation failed:', error);
      throw error;
    }
  }

  /**
   * Upsert asset type
   */
  async upsertAssetType(assetType, company, location, color = null, link = '') {
    try {
      const collection = getCollection(this.collectionsMap.assetTypes);
      const update = {
        asset_type: assetType,
        company,
        location,
        link,
        updated_at: new Date()
      };
      
      if (color) {
        update.color = color;
      }

      await collection.updateOne(
        { asset_type: assetType, company, location },
        { $set: update },
        { upsert: true }
      );
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Lookup Repo] upsertAssetType failed:', error);
      throw error;
    }
  }

  /**
   * Get color maps (hierarchical)
   */
  async getColorMaps() {
    try {
      const collection = getCollection(this.collectionsMap.colors);
      const colors = await collection.find({}).toArray();

      const maps = {
        global: new Map(),
        byLocation: new Map(),
        byCompanyLocation: new Map(),
      };

      colors.forEach(doc => {
        const { asset_type, location, company, color } = doc;
        
        if (!company && !location) {
          // Global
          maps.global.set(asset_type, color);
        } else if (company && location) {
          // Company+Location
          if (!maps.byCompanyLocation.has(company)) {
            maps.byCompanyLocation.set(company, new Map());
          }
          const locMap = maps.byCompanyLocation.get(company);
          if (!locMap.has(location)) {
            locMap.set(location, new Map());
          }
          locMap.get(location).set(asset_type, color);
        } else if (location) {
          // Location only
          if (!maps.byLocation.has(location)) {
            maps.byLocation.set(location, new Map());
          }
          maps.byLocation.get(location).set(asset_type, color);
        }
      });

      return maps;
    } catch (error) {
      console.error('[MongoDB Lookup Repo] getColorMaps failed:', error);
      throw error;
    }
  }

  /**
   * Set color for asset type (hierarchical)
   */
  async setAssetTypeColor(assetType, company, location, color) {
    try {
      const collection = getCollection(this.collectionsMap.colors);
      const query = { asset_type: assetType };
      
      if (company) query.company = company;
      if (location) query.location = location;

      await collection.updateOne(
        query,
        { $set: { asset_type: assetType, company, location, color, updated_at: new Date() } },
        { upsert: true }
      );
      
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Lookup Repo] setAssetTypeColor failed:', error);
      throw error;
    }
  }

  /**
   * Get status colors and settings
   */
  async getStatusAndRepairSettings() {
    try {
      const statusColorsCol = getCollection(this.collectionsMap.statusColors);
      const settingsCol = getCollection(this.collectionsMap.settings);

      const statusColorDocs = await statusColorsCol.find({}).toArray();
      const settingDocs = await settingsCol.find({}).toArray();

      const statusColors = {};
      statusColorDocs.forEach(doc => {
        statusColors[doc.status.toLowerCase()] = doc.color;
      });

      const settings = {};
      settingDocs.forEach(doc => {
        settings[doc.key] = doc.value;
      });

      return {
        statusColors,
        applyStatusColorsOnMap: settings.applyStatusColorsOnMap === 'TRUE',
        repairColors: {},
        applyRepairColorsOnMap: settings.applyRepairColorsOnMap === 'TRUE',
      };
    } catch (error) {
      console.error('[MongoDB Lookup Repo] getStatusAndRepairSettings failed:', error);
      throw error;
    }
  }

  /**
   * Set status color
   */
  async setStatusColor(statusKey, color) {
    try {
      const collection = getCollection(this.collectionsMap.statusColors);
      await collection.updateOne(
        { status: statusKey },
        { $set: { status: statusKey, color, updated_at: new Date() } },
        { upsert: true }
      );
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Lookup Repo] setStatusColor failed:', error);
      throw error;
    }
  }

  /**
   * Get inspection keywords
   */
  async getInspectionKeywords() {
    try {
      const collection = getCollection(this.collectionsMap.inspectionKeywords);
      const doc = await collection.findOne({ _id: 'keywords' });
      return doc ? doc.keywords : ['inspection'];
    } catch (error) {
      console.error('[MongoDB Lookup Repo] getInspectionKeywords failed:', error);
      return ['inspection'];
    }
  }

  /**
   * Set inspection keywords
   */
  async setInspectionKeywords(keywords) {
    try {
      const collection = getCollection(this.collectionsMap.inspectionKeywords);
      await collection.updateOne(
        { _id: 'keywords' },
        { $set: { keywords, updated_at: new Date() } },
        { upsert: true }
      );
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Lookup Repo] setInspectionKeywords failed:', error);
      throw error;
    }
  }

  /**
   * Get photos base (links)
   */
  async getPhotosBase({ company, location, assetType }) {
    try {
      // Try asset type link first
      if (company && location && assetType) {
        const assetCol = getCollection(this.collectionsMap.assetTypes);
        const doc = await assetCol.findOne({ company, location, asset_type: assetType });
        if (doc && doc.link) return doc.link;
      }

      // Try location link
      if (company && location) {
        const locCol = getCollection(this.collectionsMap.locations);
        const doc = await locCol.findOne({ company, location });
        if (doc && doc.link) return doc.link;
      }

      return null;
    } catch (error) {
      console.error('[MongoDB Lookup Repo] getPhotosBase failed:', error);
      return null;
    }
  }

  // Placeholder implementations for base class methods
  async getAll() { throw new Error('Use specific lookup methods'); }
  async getById() { throw new Error('Use specific lookup methods'); }
  async create() { throw new Error('Use specific lookup methods'); }
  async update() { throw new Error('Use specific lookup methods'); }
  async delete() { throw new Error('Use specific lookup methods'); }
  async findOne() { throw new Error('Use specific lookup methods'); }
  async findMany() { throw new Error('Use specific lookup methods'); }
}

module.exports = MongoDBLookupRepository;