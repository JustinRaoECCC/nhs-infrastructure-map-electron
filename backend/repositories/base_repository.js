// backend/repositories/base_repository.js
/**
 * Abstract base repository class defining the interface all repositories must implement.
 * Provides common CRUD operations.
 */
class BaseRepository {
  async getAll(filters = {}) {
    throw new Error('getAll() must be implemented by subclass');
  }

  async getById(id) {
    throw new Error('getById() must be implemented by subclass');
  }

  async create(data) {
    throw new Error('create() must be implemented by subclass');
  }

  async update(id, data) {
    throw new Error('update() must be implemented by subclass');
  }

  async delete(id) {
    throw new Error('delete() must be implemented by subclass');
  }

  async findOne(query) {
    throw new Error('findOne() must be implemented by subclass');
  }

  async findMany(query) {
    throw new Error('findMany() must be implemented by subclass');
  }
}

module.exports = BaseRepository;