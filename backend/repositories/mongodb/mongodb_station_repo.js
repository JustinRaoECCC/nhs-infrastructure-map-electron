// backend/repositories/mongodb/mongodb_station_repo.js
const BaseRepository = require('../base_repository');
const { getCollection } = require('./mongodb_client');

class MongoDBStationRepository extends BaseRepository {
  constructor() {
    super();
    this.collectionName = 'stations';
  }

  getCollection() {
    return getCollection(this.collectionName);
  }

  /**
   * Get all stations with optional filters
   */
  async getAll(filters = {}) {
    try {
      const collection = this.getCollection();
      const query = this._buildQuery(filters);
      const stations = await collection.find(query).toArray();
      return stations.map(this._fromMongo);
    } catch (error) {
      console.error('[MongoDB Station Repo] getAll failed:', error);
      throw error;
    }
  }

  /**
   * Get station by ID
   */
  async getById(stationId) {
    try {
      const collection = this.getCollection();
      const station = await collection.findOne({ station_id: stationId });
      return station ? this._fromMongo(station) : null;
    } catch (error) {
      console.error('[MongoDB Station Repo] getById failed:', error);
      throw error;
    }
  }

  /**
   * Create new station
   */
  async create(data) {
    try {
      const collection = this.getCollection();
      const doc = this._toMongo(data);
      
      // Check if station already exists
      const existing = await collection.findOne({ station_id: doc.station_id });
      if (existing) {
        throw new Error(`Station ${doc.station_id} already exists`);
      }

      const result = await collection.insertOne(doc);
      return { success: true, insertedId: result.insertedId };
    } catch (error) {
      console.error('[MongoDB Station Repo] create failed:', error);
      throw error;
    }
  }

  /**
   * Update station
   */
  async update(stationId, data) {
    try {
      const collection = this.getCollection();
      const doc = this._toMongo(data);
      
      // Remove station_id from update data to prevent changing it
      delete doc.station_id;
      
      const result = await collection.updateOne(
        { station_id: stationId },
        { 
          $set: { ...doc, updated_at: new Date() }
        }
      );

      if (result.matchedCount === 0) {
        throw new Error(`Station ${stationId} not found`);
      }

      return { success: true, modifiedCount: result.modifiedCount };
    } catch (error) {
      console.error('[MongoDB Station Repo] update failed:', error);
      throw error;
    }
  }

  /**
   * Delete station
   */
  async delete(stationId) {
    try {
      const collection = this.getCollection();
      const result = await collection.deleteOne({ station_id: stationId });
      
      if (result.deletedCount === 0) {
        throw new Error(`Station ${stationId} not found`);
      }

      return { success: true, deletedCount: result.deletedCount };
    } catch (error) {
      console.error('[MongoDB Station Repo] delete failed:', error);
      throw error;
    }
  }

  /**
   * Find one station by query
   */
  async findOne(query) {
    try {
      const collection = this.getCollection();
      const mongoQuery = this._buildQuery(query);
      const station = await collection.findOne(mongoQuery);
      return station ? this._fromMongo(station) : null;
    } catch (error) {
      console.error('[MongoDB Station Repo] findOne failed:', error);
      throw error;
    }
  }

  /**
   * Find many stations by query
   */
  async findMany(query) {
    try {
      const collection = this.getCollection();
      const mongoQuery = this._buildQuery(query);
      const stations = await collection.find(mongoQuery).toArray();
      return stations.map(this._fromMongo);
    } catch (error) {
      console.error('[MongoDB Station Repo] findMany failed:', error);
      throw error;
    }
  }

  /**
   * Bulk insert stations
   */
  async bulkCreate(stations) {
    try {
      const collection = this.getCollection();
      const docs = stations.map(s => this._toMongo(s));
      const result = await collection.insertMany(docs, { ordered: false });
      return { success: true, insertedCount: result.insertedCount };
    } catch (error) {
      console.error('[MongoDB Station Repo] bulkCreate failed:', error);
      throw error;
    }
  }

  /**
   * Update station schema (add/rename fields)
   */
  async updateSchema(assetType, schema, excludeStationId) {
    try {
      const collection = this.getCollection();
      
      // Find all stations of this asset type
      const query = { asset_type: assetType };
      if (excludeStationId) {
        query.station_id = { $ne: excludeStationId };
      }

      const stations = await collection.find(query).toArray();
      
      // Update each station with new schema
      const bulkOps = stations.map(station => ({
        updateOne: {
          filter: { _id: station._id },
          update: {
            $set: {
              schema: schema,
              updated_at: new Date()
            }
          }
        }
      }));

      if (bulkOps.length > 0) {
        await collection.bulkWrite(bulkOps);
      }

      return { success: true, updatedCount: bulkOps.length };
    } catch (error) {
      console.error('[MongoDB Station Repo] updateSchema failed:', error);
      throw error;
    }
  }

  /**
   * Build MongoDB query from filters
   */
  _buildQuery(filters) {
    const query = {};

    if (filters.company) {
      query.company = filters.company;
    }
    if (filters.location || filters.location_file) {
      query.location_file = filters.location || filters.location_file;
    }
    if (filters.asset_type) {
      query.asset_type = filters.asset_type;
    }
    if (filters.status) {
      query.status = filters.status;
    }

    return query;
  }

  /**
   * Convert from MongoDB document to application format
   */
  _fromMongo(doc) {
    if (!doc) return null;

    const { _id, created_at, updated_at, ...rest } = doc;
    
    return {
      ...rest,
      _mongoId: _id,
      _createdAt: created_at,
      _updatedAt: updated_at,
    };
  }

  /**
   * Convert from application format to MongoDB document
   */
  _toMongo(data) {
    const { _mongoId, _createdAt, _updatedAt, ...rest } = data;
    
    return {
      ...rest,
      created_at: _createdAt || new Date(),
      updated_at: _updatedAt || new Date(),
    };
  }
}

module.exports = MongoDBStationRepository;