// backend/repositories/mongodb/mongodb_client.js
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Initialize MongoDB connection
 * @param {string} connectionString - MongoDB connection string
 * @param {string} dbName - Database name
 */
async function connect(connectionString, dbName) {
  if (client && client.topology && client.topology.isConnected()) {
    console.log('[MongoDB] Already connected');
    return db;
  }

  try {
    console.log('[MongoDB] Connecting...');
    client = new MongoClient(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await client.connect();
    db = client.db(dbName);
    console.log('[MongoDB] Connected successfully to', dbName);
    return db;
  } catch (error) {
    console.error('[MongoDB] Connection failed:', error);
    throw error;
  }
}

/**
 * Get the database instance
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connect() first.');
  }
  return db;
}

/**
 * Get a collection
 */
function getCollection(name) {
  return getDb().collection(name);
}

/**
 * Close connection
 */
async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('[MongoDB] Connection closed');
  }
}

/**
 * Check if connected
 */
function isConnected() {
  return client && client.topology && client.topology.isConnected();
}

module.exports = {
  connect,
  getDb,
  getCollection,
  close,
  isConnected,
};