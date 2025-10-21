// backend/repository_factory.js
const fs = require('fs');
const path = require('path');

// Excel repositories
const excel = require('./excel_worker_client');

// MongoDB repositories
const MongoDBStationRepository = require('./repositories/mongodb/mongodb_station_repo');
const MongoDBLookupRepository = require('./repositories/mongodb/mongodb_lookup_repo');
const MongoDBAuthRepository = require('./repositories/mongodb/mongodb_auth_repo');
const MongoDBRepairRepository = require('./repositories/mongodb/mongodb_repair_repo');

// MongoDB client
const mongoClient = require('./repositories/mongodb/mongodb_client');

// Config
const CONFIG_PATH = path.join(__dirname, 'db_config.json');

let config = null;
let mongoInitialized = false;

/**
 * Load configuration from db_config.json
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      // Create default config
      const defaultConfig = {
        readFrom: 'excel',
        writeTo: 'both',
        mongodb: {
          enabled: false,
          connectionString: 'mongodb://localhost:27017',
          databaseName: 'nhs_infrastructure'
        }
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      config = defaultConfig;
    } else {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = JSON.parse(raw);
    }
    
    console.log('[Repository Factory] Config loaded:', {
      readFrom: config.readFrom,
      writeTo: config.writeTo,
      mongoEnabled: config.mongodb?.enabled
    });
    
    return config;
  } catch (error) {
    console.error('[Repository Factory] Failed to load config:', error);
    // Return safe defaults
    return {
      readFrom: 'excel',
      writeTo: 'both',
      mongodb: { enabled: false }
    };
  }
}

/**
 * Initialize MongoDB connection if enabled
 */
async function initMongoDB() {
  if (mongoInitialized) return;
  
  const cfg = config || loadConfig();
  
  if (cfg.mongodb?.enabled) {
    try {
      console.log('[Repository Factory] Initializing MongoDB...');
      await mongoClient.connect(
        cfg.mongodb.connectionString,
        cfg.mongodb.databaseName
      );
      mongoInitialized = true;
      console.log('[Repository Factory] MongoDB initialized successfully');
    } catch (error) {
      console.error('[Repository Factory] MongoDB initialization failed:', error);
      console.warn('[Repository Factory] Falling back to Excel-only mode');
      // Don't throw - just log and continue with Excel
    }
  }
}

/**
 * Create a wrapper repository that reads from configured source
 * and writes to configured destinations
 */
class DualWriteRepository {
  constructor(excelRepo, mongoRepo, type) {
    this.excelRepo = excelRepo;
    this.mongoRepo = mongoRepo;
    this.type = type;
    this.config = config || loadConfig();
  }

  async _readFrom() {
    const source = this.config.readFrom || 'excel';
    
    if (source === 'mongodb' && this.mongoRepo && mongoInitialized) {
      return this.mongoRepo;
    }
    return this.excelRepo;
  }

  async _writeTo(operation) {
    const mode = this.config.writeTo || 'both';
    const results = { excel: null, mongo: null };

    // Always write to Excel first (it's the source of truth)
    try {
      results.excel = await operation(this.excelRepo);
    } catch (error) {
      console.error(`[DualWrite ${this.type}] Excel write failed:`, error);
      throw error; // Excel write failures are critical
    }

    // Write to MongoDB if enabled
    if (mode === 'both' && this.mongoRepo && mongoInitialized) {
      try {
        results.mongo = await operation(this.mongoRepo);
      } catch (error) {
        console.error(`[DualWrite ${this.type}] MongoDB write failed (non-critical):`, error);
        // Don't throw - MongoDB write failures are logged but not critical
      }
    }

    return results.excel; // Return Excel result for consistency
  }

  async getAll(filters) {
    const repo = await this._readFrom();
    return repo.getAll(filters);
  }

  async getById(id) {
    const repo = await this._readFrom();
    return repo.getById(id);
  }

  async create(data) {
    return this._writeTo(repo => repo.create(data));
  }

  async update(id, data) {
    return this._writeTo(repo => repo.update(id, data));
  }

  async delete(id) {
    return this._writeTo(repo => repo.delete(id));
  }

  async findOne(query) {
    const repo = await this._readFrom();
    return repo.findOne(query);
  }

  async findMany(query) {
    const repo = await this._readFrom();
    return repo.findMany(query);
  }
}

/**
 * Excel repository wrapper for stations
 */
class ExcelStationRepository {
  async getAll(filters = {}) {
    const result = await excel.readStationsAggregate();
    return result.rows || [];
  }

  async getById(stationId) {
    const all = await this.getAll();
    return all.find(s => s.station_id === stationId) || null;
  }

  async create(data) {
    throw new Error('Use addStationsFromSelection for Excel station creation');
  }

  async update(stationId, data) {
    // Need to resolve company and location from existing data
    const existing = await this.getById(stationId);
    if (!existing) {
      throw new Error(`Station ${stationId} not found`);
    }

    return excel.updateStationInLocationFile(
      existing.company,
      existing.location_file || existing.province,
      stationId,
      data,
      data.schema || null
    );
  }

  async delete(stationId) {
    throw new Error('Station deletion not implemented');
  }

  async findOne(query) {
    const all = await this.getAll(query);
    return all[0] || null;
  }

  async findMany(query) {
    return this.getAll(query);
  }

  async bulkCreate(stations) {
    throw new Error('Use addStationsFromSelection for Excel bulk creation');
  }

  async updateSchema(assetType, schema, excludeStationId) {
    return excel.updateAssetTypeSchema(assetType, schema, excludeStationId);
  }
}

/**
 * Excel repository wrapper for lookups
 */
class ExcelLookupRepository {
  async getActiveCompanies() {
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.companies || [];
  }

  async getLocationsForCompany(company) {
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.locsByCompany?.[company] || [];
  }

  async getAssetTypesForCompanyLocation(company, location) {
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.assetsByCompanyLocation?.[company]?.[location] || [];
  }

  async upsertCompany(name, active = true) {
    return excel.upsertCompany(name, active);
  }

  async upsertLocation(location, company, link = '') {
    await excel.upsertLocation(location, company);
    if (link) {
      await excel.setLocationLink(company, location, link);
    }
    return { success: true };
  }

  async upsertAssetType(assetType, company, location, color = null, link = '') {
    await excel.upsertAssetType(assetType, company, location);
    if (link) {
      await excel.setAssetTypeLink(assetType, company, location, link);
    }
    if (color) {
      await excel.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
    }
    return { success: true };
  }

  async getColorMaps() {
    const snapshot = await excel.readLookupsSnapshot();
    return {
      global: new Map(Object.entries(snapshot.colorsGlobal || {})),
      byLocation: new Map(
        Object.entries(snapshot.colorsByLoc || {}).map(([loc, obj]) => 
          [loc, new Map(Object.entries(obj))]
        )
      ),
      byCompanyLocation: new Map(
        Object.entries(snapshot.colorsByCompanyLoc || {}).map(([co, locObj]) =>
          [co, new Map(
            Object.entries(locObj).map(([loc, obj]) => 
              [loc, new Map(Object.entries(obj))]
            )
          )]
        )
      )
    };
  }

  async setAssetTypeColor(assetType, company, location, color) {
    if (company && location) {
      return excel.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
    } else if (location) {
      return excel.setAssetTypeColorForLocation(assetType, location, color);
    } else {
      return excel.setAssetTypeColor(assetType, color);
    }
  }

  async getStatusAndRepairSettings() {
    const snapshot = await excel.readLookupsSnapshot();
    return {
      statusColors: snapshot.statusColors || {},
      applyStatusColorsOnMap: snapshot.applyStatusColorsOnMap || false,
      repairColors: {},
      applyRepairColorsOnMap: snapshot.applyRepairColorsOnMap || false
    };
  }

  async setStatusColor(statusKey, color) {
    return excel.setStatusColor(statusKey, color);
  }

  async getInspectionKeywords() {
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.inspectionKeywords || ['inspection'];
  }

  async setInspectionKeywords(keywords) {
    return excel.setInspectionKeywords(keywords);
  }

  async getPhotosBase({ company, location, assetType }) {
    const snapshot = await excel.readLookupsSnapshot();
    
    // Try asset type link
    if (company && location && assetType) {
      const link = snapshot.assetTypeLinks?.[company]?.[location]?.[assetType];
      if (link) return link;
    }
    
    // Try location link
    if (company && location) {
      const link = snapshot.locationLinks?.[company]?.[location];
      if (link) return link;
    }
    
    return null;
  }
}

/**
 * Excel repository wrapper for auth
 */
class ExcelAuthRepository {
  async createUser(userData) {
    return excel.createAuthUser(userData);
  }

  async loginUser(name, hashedPassword) {
    return excel.loginAuthUser(name, hashedPassword);
  }

  async logoutUser(name) {
    return excel.logoutAuthUser(name);
  }

  async getAllUsers() {
    const result = await excel.getAllAuthUsers();
    return result.users || [];
  }

  async hasUsers() {
    const result = await excel.hasAuthUsers();
    return result.hasUsers || false;
  }
}

/**
 * Excel repository wrapper for repairs
 */
class ExcelRepairRepository {
  async listRepairsForStation(company, location, assetType, stationId) {
    return excel.listRepairsForStation(company, location, assetType, stationId);
  }

  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    return excel.saveStationRepairs(company, location, assetType, stationId, repairs);
  }

  async appendRepair(company, location, assetType, repair) {
    return excel.appendRepair(company, location, assetType, repair);
  }

  async getAllRepairs() {
    return excel.getAllRepairs();
  }

  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    return excel.deleteRepair(company, location, assetType, stationId, repairIndex);
  }
}

// Singleton instances
let stationRepo = null;
let lookupRepo = null;
let authRepo = null;
let repairRepo = null;

/**
 * Get station repository
 */
async function getStationRepository() {
  if (!stationRepo) {
    await initMongoDB();
    
    const excelRepo = new ExcelStationRepository();
    const mongoRepo = mongoInitialized ? new MongoDBStationRepository() : null;
    
    stationRepo = new DualWriteRepository(excelRepo, mongoRepo, 'Station');
    
    // Add station-specific methods
    stationRepo.bulkCreate = async (stations) => {
      if (mongoRepo && mongoInitialized) {
        try {
          await mongoRepo.bulkCreate(stations);
        } catch (error) {
          console.error('[Station Repo] MongoDB bulk create failed:', error);
        }
      }
      return excelRepo.bulkCreate(stations);
    };
    
    stationRepo.updateSchema = async (assetType, schema, excludeStationId) => {
      const result = await excelRepo.updateSchema(assetType, schema, excludeStationId);
      if (mongoRepo && mongoInitialized) {
        try {
          await mongoRepo.updateSchema(assetType, schema, excludeStationId);
        } catch (error) {
          console.error('[Station Repo] MongoDB schema update failed:', error);
        }
      }
      return result;
    };
  }
  
  return stationRepo;
}

/**
 * Get lookup repository
 */
async function getLookupRepository() {
  if (!lookupRepo) {
    await initMongoDB();
    
    const excelRepo = new ExcelLookupRepository();
    const mongoRepo = mongoInitialized ? new MongoDBLookupRepository() : null;
    
    // Lookup repo needs custom dual-write for its unique methods
    lookupRepo = {
      getActiveCompanies: async () => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getActiveCompanies();
        }
        return excelRepo.getActiveCompanies();
      },
      
      getLocationsForCompany: async (company) => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getLocationsForCompany(company);
        }
        return excelRepo.getLocationsForCompany(company);
      },
      
      getAssetTypesForCompanyLocation: async (company, location) => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getAssetTypesForCompanyLocation(company, location);
        }
        return excelRepo.getAssetTypesForCompanyLocation(company, location);
      },
      
      upsertCompany: async (name, active) => {
        const result = await excelRepo.upsertCompany(name, active);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.upsertCompany(name, active);
          } catch (error) {
            console.error('[Lookup Repo] MongoDB upsertCompany failed:', error);
          }
        }
        return result;
      },
      
      upsertLocation: async (location, company, link) => {
        const result = await excelRepo.upsertLocation(location, company, link);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.upsertLocation(location, company, link);
          } catch (error) {
            console.error('[Lookup Repo] MongoDB upsertLocation failed:', error);
          }
        }
        return result;
      },
      
      upsertAssetType: async (assetType, company, location, color, link) => {
        const result = await excelRepo.upsertAssetType(assetType, company, location, color, link);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.upsertAssetType(assetType, company, location, color, link);
          } catch (error) {
            console.error('[Lookup Repo] MongoDB upsertAssetType failed:', error);
          }
        }
        return result;
      },
      
      getColorMaps: async () => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getColorMaps();
        }
        return excelRepo.getColorMaps();
      },
      
      setAssetTypeColor: async (assetType, company, location, color) => {
        const result = await excelRepo.setAssetTypeColor(assetType, company, location, color);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.setAssetTypeColor(assetType, company, location, color);
          } catch (error) {
            console.error('[Lookup Repo] MongoDB setAssetTypeColor failed:', error);
          }
        }
        return result;
      },
      
      getStatusAndRepairSettings: async () => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getStatusAndRepairSettings();
        }
        return excelRepo.getStatusAndRepairSettings();
      },
      
      setStatusColor: async (statusKey, color) => {
        const result = await excelRepo.setStatusColor(statusKey, color);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.setStatusColor(statusKey, color);
          } catch (error) {
            console.error('[Lookup Repo] MongoDB setStatusColor failed:', error);
          }
        }
        return result;
      },
      
      getInspectionKeywords: async () => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getInspectionKeywords();
        }
        return excelRepo.getInspectionKeywords();
      },
      
      setInspectionKeywords: async (keywords) => {
        const result = await excelRepo.setInspectionKeywords(keywords);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.setInspectionKeywords(keywords);
          } catch (error) {
            console.error('[Lookup Repo] MongoDB setInspectionKeywords failed:', error);
          }
        }
        return result;
      },
      
      getPhotosBase: async (ctx) => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getPhotosBase(ctx);
        }
        return excelRepo.getPhotosBase(ctx);
      }
    };
  }
  
  return lookupRepo;
}

/**
 * Get auth repository
 */
async function getAuthRepository() {
  if (!authRepo) {
    await initMongoDB();
    
    const excelRepo = new ExcelAuthRepository();
    const mongoRepo = mongoInitialized ? new MongoDBAuthRepository() : null;
    
    authRepo = {
      createUser: async (userData) => {
        const result = await excelRepo.createUser(userData);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.createUser(userData);
          } catch (error) {
            console.error('[Auth Repo] MongoDB createUser failed:', error);
          }
        }
        return result;
      },
      
      loginUser: async (name, hashedPassword) => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.loginUser(name, hashedPassword);
        }
        return excelRepo.loginUser(name, hashedPassword);
      },
      
      logoutUser: async (name) => {
        const result = await excelRepo.logoutUser(name);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.logoutUser(name);
          } catch (error) {
            console.error('[Auth Repo] MongoDB logoutUser failed:', error);
          }
        }
        return result;
      },
      
      getAllUsers: async () => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getAllUsers();
        }
        return excelRepo.getAllUsers();
      },
      
      hasUsers: async () => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.hasUsers();
        }
        return excelRepo.hasUsers();
      }
    };
  }
  
  return authRepo;
}

/**
 * Get repair repository
 */
async function getRepairRepository() {
  if (!repairRepo) {
    await initMongoDB();
    
    const excelRepo = new ExcelRepairRepository();
    const mongoRepo = mongoInitialized ? new MongoDBRepairRepository() : null;
    
    repairRepo = {
      listRepairsForStation: async (company, location, assetType, stationId) => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.listRepairsForStation(company, location, assetType, stationId);
        }
        return excelRepo.listRepairsForStation(company, location, assetType, stationId);
      },
      
      saveStationRepairs: async (company, location, assetType, stationId, repairs) => {
        const result = await excelRepo.saveStationRepairs(company, location, assetType, stationId, repairs);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.saveStationRepairs(company, location, assetType, stationId, repairs);
          } catch (error) {
            console.error('[Repair Repo] MongoDB saveStationRepairs failed:', error);
          }
        }
        return result;
      },
      
      appendRepair: async (company, location, assetType, repair) => {
        const result = await excelRepo.appendRepair(company, location, assetType, repair);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.appendRepair(company, location, assetType, repair);
          } catch (error) {
            console.error('[Repair Repo] MongoDB appendRepair failed:', error);
          }
        }
        return result;
      },
      
      getAllRepairs: async () => {
        const source = (config || loadConfig()).readFrom;
        if (source === 'mongodb' && mongoRepo && mongoInitialized) {
          return mongoRepo.getAllRepairs();
        }
        return excelRepo.getAllRepairs();
      },
      
      deleteRepair: async (company, location, assetType, stationId, repairIndex) => {
        const result = await excelRepo.deleteRepair(company, location, assetType, stationId, repairIndex);
        if (mongoRepo && mongoInitialized) {
          try {
            await mongoRepo.deleteRepair(company, location, assetType, stationId, repairIndex);
          } catch (error) {
            console.error('[Repair Repo] MongoDB deleteRepair failed:', error);
          }
        }
        return result;
      }
    };
  }
  
  return repairRepo;
}

/**
 * Reload configuration (useful for runtime config changes)
 */
function reloadConfig() {
  config = loadConfig();
  console.log('[Repository Factory] Configuration reloaded');
  return config;
}

/**
 * Get current configuration
 */
function getConfig() {
  return config || loadConfig();
}

module.exports = {
  getStationRepository,
  getLookupRepository,
  getAuthRepository,
  getRepairRepository,
  initMongoDB,
  reloadConfig,
  getConfig,
  loadConfig
};