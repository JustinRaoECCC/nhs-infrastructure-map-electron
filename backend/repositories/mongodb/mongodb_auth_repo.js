// backend/repositories/mongodb/mongodb_auth_repo.js
const BaseRepository = require('../base_repository');
const { getCollection } = require('./mongodb_client');

class MongoDBAuthRepository extends BaseRepository {
  constructor() {
    super();
    this.collectionName = 'users';
  }

  getCollection() {
    return getCollection(this.collectionName);
  }

  async createUser(userData) {
    try {
      const collection = this.getCollection();
      
      // Check if user exists
      const existing = await collection.findOne({
        $or: [
          { name: userData.name },
          { email: userData.email }
        ]
      });

      if (existing) {
        return { success: false, message: 'User already exists' };
      }

      await collection.insertOne({
        ...userData,
        created_at: new Date(),
        updated_at: new Date(),
      });

      return { success: true };
    } catch (error) {
      console.error('[MongoDB Auth Repo] createUser failed:', error);
      throw error;
    }
  }

  async loginUser(name, hashedPassword) {
    try {
      const collection = this.getCollection();
      const user = await collection.findOne({ name, password: hashedPassword });

      if (!user) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Update last login
      await collection.updateOne(
        { name },
        { 
          $set: { 
            status: 'Active',
            lastLogin: new Date().toISOString(),
            updated_at: new Date()
          }
        }
      );

      return {
        success: true,
        user: {
          name: user.name,
          email: user.email,
          admin: user.admin === 'Yes',
          permissions: user.permissions
        }
      };
    } catch (error) {
      console.error('[MongoDB Auth Repo] loginUser failed:', error);
      throw error;
    }
  }

  async logoutUser(name) {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { name },
        { $set: { status: 'Inactive', updated_at: new Date() } }
      );
      return { success: true };
    } catch (error) {
      console.error('[MongoDB Auth Repo] logoutUser failed:', error);
      return { success: true }; // Don't fail logout
    }
  }

  async getAllUsers() {
    try {
      const collection = this.getCollection();
      const users = await collection.find({}).toArray();
      return users.map(u => ({
        name: u.name,
        email: u.email,
        password: u.password,
        admin: u.admin === 'Yes',
        permissions: u.permissions,
        status: u.status,
        created: u.created || u.created_at,
        lastLogin: u.lastLogin
      }));
    } catch (error) {
      console.error('[MongoDB Auth Repo] getAllUsers failed:', error);
      return [];
    }
  }

  async hasUsers() {
    try {
      const collection = this.getCollection();
      const count = await collection.countDocuments();
      return count > 0;
    } catch (error) {
      console.error('[MongoDB Auth Repo] hasUsers failed:', error);
      return false;
    }
  }

  // Base class implementations (not used for auth)
  async getAll() { return this.getAllUsers(); }
  async getById(id) { throw new Error('Not implemented'); }
  async create(data) { return this.createUser(data); }
  async update(id, data) { throw new Error('Not implemented'); }
  async delete(id) { throw new Error('Not implemented'); }
  async findOne(query) { throw new Error('Not implemented'); }
  async findMany(query) { throw new Error('Not implemented'); }
}

module.exports = MongoDBAuthRepository;