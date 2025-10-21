// backend/migrate_to_mongodb.js
/**
 * One-time migration script to populate MongoDB from existing Excel files
 * Run with: node backend/migrate_to_mongodb.js
 */

const fs = require('fs');
const path = require('path');
const mongoClient = require('./repositories/mongodb/mongodb_client');
const excel = require('./excel_worker_client');

const CONFIG_PATH = path.join(__dirname, 'db_config.json');

async function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

async function migrateStations() {
  console.log('\n=== Migrating Stations ===');
  
  const result = await excel.readStationsAggregate();
  const stations = result.rows || [];
  
  console.log(`Found ${stations.length} stations in Excel`);
  
  if (stations.length === 0) {
    console.log('No stations to migrate');
    return;
  }

  const collection = mongoClient.getCollection('stations');
  
  // Clear existing data
  await collection.deleteMany({});
  console.log('Cleared existing stations in MongoDB');
  
  // Prepare documents
  const docs = stations.map(station => ({
    ...station,
    created_at: new Date(),
    updated_at: new Date()
  }));
  
  // Insert in batches of 100
  const batchSize = 100;
  let inserted = 0;
  
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    try {
      await collection.insertMany(batch, { ordered: false });
      inserted += batch.length;
      console.log(`Inserted ${inserted}/${docs.length} stations...`);
    } catch (error) {
      console.error(`Batch ${i / batchSize + 1} had errors:`, error.message);
      // Continue with next batch
    }
  }
  
  console.log(`✓ Migrated ${inserted} stations`);
  
  // Create indexes
  await collection.createIndex({ station_id: 1 }, { unique: true });
  await collection.createIndex({ company: 1, location_file: 1, asset_type: 1 });
  console.log('✓ Created indexes on stations collection');
}

async function migrateLookups() {
  console.log('\n=== Migrating Lookups ===');
  
  const snapshot = await excel.readLookupsSnapshot();
  
  // Companies
  const companiesCol = mongoClient.getCollection('companies');
  await companiesCol.deleteMany({});
  
  if (snapshot.companies && snapshot.companies.length > 0) {
    const companyDocs = snapshot.companies.map(name => ({
      name,
      active: true,
      created_at: new Date(),
      updated_at: new Date()
    }));
    await companiesCol.insertMany(companyDocs);
    console.log(`✓ Migrated ${companyDocs.length} companies`);
  }
  
  // Locations
  const locationsCol = mongoClient.getCollection('locations');
  await locationsCol.deleteMany({});
  
  const locationDocs = [];
  for (const [company, locations] of Object.entries(snapshot.locsByCompany || {})) {
    for (const location of locations) {
      const link = snapshot.locationLinks?.[company]?.[location] || '';
      locationDocs.push({
        company,
        location,
        link,
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  }
  
  if (locationDocs.length > 0) {
    await locationsCol.insertMany(locationDocs);
    console.log(`✓ Migrated ${locationDocs.length} locations`);
  }
  
  // Asset Types
  const assetTypesCol = mongoClient.getCollection('asset_types');
  await assetTypesCol.deleteMany({});
  
  const assetTypeDocs = [];
  for (const [company, locationMap] of Object.entries(snapshot.assetsByCompanyLocation || {})) {
    for (const [location, assetTypes] of Object.entries(locationMap)) {
      for (const assetType of assetTypes) {
        const link = snapshot.assetTypeLinks?.[company]?.[location]?.[assetType] || '';
        
        // Try to get color
        let color = null;
        if (snapshot.colorsByCompanyLoc?.[company]?.[location]?.[assetType]) {
          color = snapshot.colorsByCompanyLoc[company][location][assetType];
        } else if (snapshot.colorsByLoc?.[location]?.[assetType]) {
          color = snapshot.colorsByLoc[location][assetType];
        } else if (snapshot.colorsGlobal?.[assetType]) {
          color = snapshot.colorsGlobal[assetType];
        }
        
        assetTypeDocs.push({
          company,
          location,
          asset_type: assetType,
          color,
          link,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }
  }
  
  if (assetTypeDocs.length > 0) {
    await assetTypesCol.insertMany(assetTypeDocs);
    console.log(`✓ Migrated ${assetTypeDocs.length} asset types`);
  }
  
  // Colors (hierarchical)
  const colorsCol = mongoClient.getCollection('colors');
  await colorsCol.deleteMany({});
  
  const colorDocs = [];
  
  // Global colors
  for (const [assetType, color] of Object.entries(snapshot.colorsGlobal || {})) {
    colorDocs.push({
      asset_type: assetType,
      color,
      company: null,
      location: null,
      created_at: new Date(),
      updated_at: new Date()
    });
  }
  
  // Location colors
  for (const [location, assetMap] of Object.entries(snapshot.colorsByLoc || {})) {
    for (const [assetType, color] of Object.entries(assetMap)) {
      colorDocs.push({
        asset_type: assetType,
        color,
        company: null,
        location,
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  }
  
  // Company+Location colors
  for (const [company, locationMap] of Object.entries(snapshot.colorsByCompanyLoc || {})) {
    for (const [location, assetMap] of Object.entries(locationMap)) {
      for (const [assetType, color] of Object.entries(assetMap)) {
        colorDocs.push({
          asset_type: assetType,
          color,
          company,
          location,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }
  }
  
  if (colorDocs.length > 0) {
    await colorsCol.insertMany(colorDocs);
    console.log(`✓ Migrated ${colorDocs.length} color mappings`);
  }
  
  // Status Colors
  const statusColorsCol = mongoClient.getCollection('status_colors');
  await statusColorsCol.deleteMany({});
  
  const statusColorDocs = [];
  for (const [status, color] of Object.entries(snapshot.statusColors || {})) {
    statusColorDocs.push({
      status,
      color,
      created_at: new Date(),
      updated_at: new Date()
    });
  }
  
  if (statusColorDocs.length > 0) {
    await statusColorsCol.insertMany(statusColorDocs);
    console.log(`✓ Migrated ${statusColorDocs.length} status colors`);
  }
  
  // Settings
  const settingsCol = mongoClient.getCollection('settings');
  await settingsCol.deleteMany({});
  
  await settingsCol.insertMany([
    {
      key: 'applyStatusColorsOnMap',
      value: snapshot.applyStatusColorsOnMap ? 'TRUE' : 'FALSE',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      key: 'applyRepairColorsOnMap',
      value: snapshot.applyRepairColorsOnMap ? 'TRUE' : 'FALSE',
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);
  console.log('✓ Migrated settings');
  
  // Inspection Keywords
  const keywordsCol = mongoClient.getCollection('inspection_keywords');
  await keywordsCol.deleteMany({});
  
  await keywordsCol.insertOne({
    _id: 'keywords',
    keywords: snapshot.inspectionKeywords || ['inspection'],
    created_at: new Date(),
    updated_at: new Date()
  });
  console.log('✓ Migrated inspection keywords');
}

async function migrateAuth() {
  console.log('\n=== Migrating Auth ===');
  
  const authResult = await excel.getAllAuthUsers();
  const users = authResult.users || [];
  
  if (users.length === 0) {
    console.log('No users to migrate');
    return;
  }
  
  const usersCol = mongoClient.getCollection('users');
  await usersCol.deleteMany({});
  
  const userDocs = users.map(user => ({
    name: user.name,
    email: user.email,
    password: user.password,
    admin: user.admin ? 'Yes' : 'No',
    permissions: user.permissions,
    status: user.status,
    created: user.created,
    lastLogin: user.lastLogin,
    created_at: new Date(),
    updated_at: new Date()
  }));
  
  await usersCol.insertMany(userDocs);
  console.log(`✓ Migrated ${userDocs.length} users`);
  
  // Create index
  await usersCol.createIndex({ name: 1 }, { unique: true });
  await usersCol.createIndex({ email: 1 }, { unique: true });
  console.log('✓ Created indexes on users collection');
}

async function migrateRepairs() {
  console.log('\n=== Migrating Repairs ===');
  
  const repairs = await excel.getAllRepairs();
  
  if (repairs.length === 0) {
    console.log('No repairs to migrate');
    return;
  }
  
  const repairsCol = mongoClient.getCollection('repairs');
  await repairsCol.deleteMany({});
  
  const repairDocs = repairs.map(repair => ({
    ...repair,
    created_at: new Date(),
    updated_at: new Date()
  }));
  
  await repairsCol.insertMany(repairDocs);
  console.log(`✓ Migrated ${repairDocs.length} repairs`);
  
  // Create indexes
  await repairsCol.createIndex({ company: 1, location: 1, assetType: 1, station_id: 1 });
  console.log('✓ Created indexes on repairs collection');
}

async function main() {
  try {
    console.log('=== NHS Infrastructure MongoDB Migration ===\n');
    
    // Load config
    const config = await loadConfig();
    
    if (!config.mongodb?.enabled) {
      console.error('ERROR: MongoDB is not enabled in db_config.json');
      console.log('Please enable MongoDB before running migration');
      process.exit(1);
    }
    
    console.log('Config:', {
      connectionString: config.mongodb.connectionString,
      databaseName: config.mongodb.databaseName
    });
    
    // Connect to MongoDB
    console.log('\nConnecting to MongoDB...');
    await mongoClient.connect(
      config.mongodb.connectionString,
      config.mongodb.databaseName
    );
    console.log('✓ Connected to MongoDB\n');
    
    // Run migrations
    await migrateStations();
    await migrateLookups();
    await migrateAuth();
    await migrateRepairs();
    
    console.log('\n=== Migration Complete! ===');
    console.log('\nNext steps:');
    console.log('1. Verify data in MongoDB using MongoDB Compass or mongo shell');
    console.log('2. Update db_config.json to set "readFrom": "mongodb" if desired');
    console.log('3. Restart the application');
    
    await mongoClient.close();
    process.exit(0);
    
  } catch (error) {
    console.error('\n=== Migration Failed ===');
    console.error('Error:', error);
    
    try {
      await mongoClient.close();
    } catch (e) {
      // Ignore
    }
    
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };