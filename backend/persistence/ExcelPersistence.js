// backend/persistence/ExcelPersistence.js
// Excel-based persistence implementation
// This wraps the existing excel_worker_client functionality

const IPersistence = require('./IPersistence');

// Lazy-load excel_worker_client to avoid starting the worker thread on import
let excel = null;
function getExcel() {
  if (!excel) {
    console.log('[ExcelPersistence] Lazy-loading excel_worker_client');
    excel = require('../excel_worker_client');
  }
  return excel;
}

class ExcelPersistence extends IPersistence {
  constructor() {
    super();
    this.initialized = false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════════

  async initialize() {
    try {
      console.log('[ExcelPersistence] Initializing...');
      const excel = getExcel();
      await excel.ensureLookupsReady();
      this.initialized = true;
      console.log('[ExcelPersistence] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[ExcelPersistence] Initialization failed:', error.message);
      return false;
    }
  }

  async close() {
    console.log('[ExcelPersistence] Closing');
    // Excel doesn't need explicit cleanup
    this.initialized = false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COMPANIES
  // ════════════════════════════════════════════════════════════════════════════

  async getActiveCompanies() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.companies || [];
  }

  async upsertCompany(name, active = true) {
    const excel = getExcel();
    return await excel.upsertCompany(name, active);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - LOCATIONS
  // ════════════════════════════════════════════════════════════════════════════

  async getLocationsForCompany(company) {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.locsByCompany[company] || [];
  }

  async upsertLocation(location, company) {
    const excel = getExcel();
    return await excel.upsertLocation(location, company);
  }

  async setLocationLink(company, location, link) {
    const excel = getExcel();
    return await excel.setLocationLink(company, location, link);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - ASSET TYPES
  // ════════════════════════════════════════════════════════════════════════════

  async getAssetTypesForCompanyLocation(company, location) {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    const companyAssets = snapshot.assetsByCompanyLocation[company] || {};
    return companyAssets[location] || [];
  }

  async upsertAssetType(assetType, company, location) {
    const excel = getExcel();
    return await excel.upsertAssetType(assetType, company, location);
  }

  async setAssetTypeLink(assetType, company, location, link) {
    const excel = getExcel();
    return await excel.setAssetTypeLink(assetType, company, location, link);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COLORS
  // ════════════════════════════════════════════════════════════════════════════

  async getColorMaps() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();

    // Convert plain objects to Maps
    const global = new Map(Object.entries(snapshot.colorsGlobal || {}));

    const byLocation = new Map(
      Object.entries(snapshot.colorsByLoc || {}).map(
        ([loc, obj]) => [loc, new Map(Object.entries(obj))]
      )
    );

    const byCompanyLocation = new Map(
      Object.entries(snapshot.colorsByCompanyLoc || {}).map(
        ([company, locObj]) => [
          company,
          new Map(Object.entries(locObj).map(
            ([loc, obj]) => [loc, new Map(Object.entries(obj))]
          ))
        ]
      )
    );

    return { global, byLocation, byCompanyLocation };
  }

  async setAssetTypeColor(assetType, color) {
    const excel = getExcel();
    return await excel.setAssetTypeColor(assetType, color);
  }

  async setAssetTypeColorForLocation(assetType, location, color) {
    const excel = getExcel();
    return await excel.setAssetTypeColorForLocation(assetType, location, color);
  }

  async setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
    const excel = getExcel();
    return await excel.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - SNAPSHOT & TREE
  // ════════════════════════════════════════════════════════════════════════════

  async readLookupsSnapshot() {
    const excel = getExcel();
    return await excel.readLookupsSnapshot();
  }

  async getLookupTree() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return {
      companies: snapshot.companies || [],
      locationsByCompany: snapshot.locsByCompany || {},
      assetsByCompanyLocation: snapshot.assetsByCompanyLocation || {}
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - STATUS & REPAIR SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  async getStatusAndRepairSettings() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return {
      statusColors: snapshot.statusColors || {},
      applyStatusColorsOnMap: snapshot.applyStatusColorsOnMap || false,
      repairColors: snapshot.repairColors || {},
      applyRepairColorsOnMap: snapshot.applyRepairColorsOnMap || false
    };
  }

  async setStatusColor(statusKey, color) {
    const excel = getExcel();
    return await excel.setStatusColor(statusKey, color);
  }

  async setSettingBoolean(key, value) {
    const excel = getExcel();
    return await excel.setSettingBoolean(key, value);
  }

  async deleteStatusRow(statusKey) {
    const excel = getExcel();
    return await excel.deleteStatusRow(statusKey);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - INSPECTION KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  async getInspectionKeywords() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.inspectionKeywords || [];
  }

  async setInspectionKeywords(keywords) {
    const excel = getExcel();
    return await excel.setInspectionKeywords(keywords);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - READ
  // ════════════════════════════════════════════════════════════════════════════

  async readStationsAggregate() {
    const excel = getExcel();
    return await excel.readStationsAggregate();
  }

  async readLocationWorkbook(company, locationName) {
    const excel = getExcel();
    return await excel.readLocationWorkbook(company, locationName);
  }

  async readSheetData(company, locationName, sheetName) {
    const excel = getExcel();
    return await excel.readSheetData(company, locationName, sheetName);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - WRITE
  // ════════════════════════════════════════════════════════════════════════════

  async writeLocationRows(company, location, sheetName, sections, headers, rows) {
    const excel = getExcel();
    return await excel.writeLocationRows(company, location, sheetName, sections, headers, rows);
  }

  async updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema) {
    const excel = getExcel();
    return await excel.updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPAIRS
  // ════════════════════════════════════════════════════════════════════════════

  async listRepairsForStation(company, location, assetType, stationId) {
    const excel = getExcel();
    return await excel.listRepairsForStation(company, location, assetType, stationId);
  }

  async getAllRepairs() {
    const excel = getExcel();
    return await excel.getAllRepairs();
  }

  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    const excel = getExcel();
    return await excel.saveStationRepairs(company, location, assetType, stationId, repairs);
  }

  async appendRepair(company, location, assetType, repair) {
    const excel = getExcel();
    return await excel.appendRepair(company, location, assetType, repair);
  }

  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    const excel = getExcel();
    return await excel.deleteRepair(company, location, assetType, stationId, repairIndex);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ALGORITHM DATA
  // ════════════════════════════════════════════════════════════════════════════

  async getAlgorithmParameters() {
    const excel = getExcel();
    return await excel.getAlgorithmParameters();
  }

  async saveAlgorithmParameters(rows) {
    const excel = getExcel();
    return await excel.saveAlgorithmParameters(rows);
  }

  async getWorkplanConstants() {
    const excel = getExcel();
    return await excel.getWorkplanConstants();
  }

  async saveWorkplanConstants(rows) {
    const excel = getExcel();
    return await excel.saveWorkplanConstants(rows);
  }

  async getCustomWeights() {
    const excel = getExcel();
    return await excel.getCustomWeights();
  }

  async addCustomWeight(weight, active) {
    const excel = getExcel();
    return await excel.addCustomWeight(weight, active);
  }

  async getFixedParameters() {
    const excel = getExcel();
    return await excel.getFixedParameters();
  }

  async saveFixedParameters(params) {
    const excel = getExcel();
    return await excel.saveFixedParameters(params);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  async listSheets(b64) {
    const excel = getExcel();
    return await excel.listSheets(b64);
  }

  async ensureLookupsReady() {
    const excel = getExcel();
    return await excel.ensureLookupsReady();
  }
}

module.exports = ExcelPersistence;
