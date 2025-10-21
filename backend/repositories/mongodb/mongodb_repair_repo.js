// backend/repositories/mongodb/mongodb_repair_repo.js
const BaseRepository = require('../base_repository');
const { getCollection } = require('./mongodb_client');

class MongoDBRepairRepository extends BaseRepository {
  constructor() {
    super();
    this.collectionName = 'repairs';
  }

  getCollection() {
    return getCollection(this.collectionName);
  }

  async listRepairsForStation(company, location, assetType, stationId) {
    try {
      const collection = this.getCollection();
      const repairs = await collection.find({
        company,
        location,
        assetType,
        station_id: stationId
      }).toArray();

      return repairs.map(this._fromMongo);
    } catch (error) {
      console.error('[MongoDB Repair Repo] listRepairsForStation failed:', error);
      throw error;
    }
  }

  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    try {
      const collection = this.getCollection();
      
      // Delete existing repairs for this station
      await collection.deleteMany({
        company,
        location,
        assetType,
        station_id: stationId
      });

      // Insert new repairs
      if (repairs.length > 0) {
        const docs = repairs.map(r => this._toMongo({
          ...r,
          company,
          location,
          assetType,
          station_id: stationId
        }));

        await collection.insertMany(docs);
      }

      return { success: true, count: repairs.length };
    } catch (error) {
      console.error('[MongoDB Repair Repo] saveStationRepairs failed:', error);
      throw error;
    }
  }

  async appendRepair(company, location, assetType, repair) {
    try {
      const collection = this.getCollection();
      const doc = this._toMongo({
        ...repair,
        company,
        location,
        assetType
      });

      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Repair Repo] appendRepair failed:', error);
      throw error;
    }
  }

  async getAllRepairs() {
    try {
      const collection = this.getCollection();
      const repairs = await collection.find({}).toArray();
      return repairs.map(this._fromMongo);
    } catch (error) {
      console.error('[MongoDB Repair Repo] getAllRepairs failed:', error);
      throw error;
    }
  }

  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    try {
      const repairs = await this.listRepairsForStation(company, location, assetType, stationId);
      
      if (repairIndex >= 0 && repairIndex < repairs.length) {
        repairs.splice(repairIndex, 1);
        await this.saveStationRepairs(company, location, assetType, stationId, repairs);
        return { success: true };
      }

      return { success: false, message: 'Invalid repair index' };
    } catch (error) {
      console.error('[MongoDB Repair Repo] deleteRepair failed:', error);
      throw error;
    }
  }

  _fromMongo(doc) {
    if (!doc) return null;
    const { _id, created_at, updated_at, ...rest } = doc;
    return rest;
  }

  _toMongo(data) {
    return {
      ...data,
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  // Base class implementations
  async getAll() { return this.getAllRepairs(); }
  async getById(id) { throw new Error('Not implemented'); }
  async create(data) { return this.appendRepair(data.company, data.location, data.assetType, data); }
  async update(id, data) { throw new Error('Not implemented'); }
  async delete(id) { throw new Error('Not implemented'); }
  async findOne(query) { throw new Error('Not implemented'); }
  async findMany(query) { throw new Error('Not implemented'); }
}

module.exports = MongoDBRepairRepository;