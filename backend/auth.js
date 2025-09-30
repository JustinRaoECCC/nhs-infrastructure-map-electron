// backend/auth.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDir } = require('./utils/fs_utils');

const DATA_DIR = process.env.NHS_DATA_DIR || path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'Login_Information.xlsx');

let currentUser = null;
let sessionToken = null;

// We'll use the excel worker client for all Excel operations
const excelClient = require('./excel_worker_client');

// Initialize auth workbook
async function initAuthWorkbook() {
  try {
    ensureDir(DATA_DIR);
    
    if (fs.existsSync(AUTH_FILE)) {
      console.log('[auth] Login_Information.xlsx already exists');
      return { exists: true };
    }

    console.log('[auth] Creating Login_Information.xlsx...');
    
    // Create the file through the worker
    const result = await excelClient.createAuthWorkbook();
    console.log('[auth] Auth workbook created:', result);
    
    return { exists: false };
  } catch (error) {
    console.error('[auth] Error initializing auth workbook:', error);
    throw error;
  }
}

// Hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Validate email domain
function validateEmail(email) {
  const normalized = email.toLowerCase().trim();
  return normalized.endsWith('@ec.gc.ca');
}

// Create user
async function createUser(userData) {
  try {
    const { name, email, password, admin, permissions } = userData;
    
    console.log('[auth] Creating user:', name);
    
    if (!validateEmail(email)) {
      return { success: false, message: 'Email must be @ec.gc.ca domain' };
    }

    const hashedPassword = hashPassword(password);
    
    const result = await excelClient.createAuthUser({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      admin: admin ? 'Yes' : 'No',
      permissions: permissions || 'Read',
      status: 'Inactive',
      created: new Date().toISOString(),
      lastLogin: ''
    });

    console.log('[auth] User creation result:', result);
    return result;
  } catch (error) {
    console.error('[auth] Error creating user:', error);
    return { success: false, message: String(error) };
  }
}

// Login user
async function loginUser(name, password) {
  try {
    console.log('[auth] Login attempt for:', name);
    
    if (!fs.existsSync(AUTH_FILE)) {
      return { success: false, message: 'No users exist. Please create an account.' };
    }

    const hashedPassword = hashPassword(password);
    
    const result = await excelClient.loginAuthUser(name, hashedPassword);
    
    if (result.success) {
      currentUser = result.user;
      sessionToken = crypto.randomBytes(32).toString('hex');
      console.log('[auth] Login successful for:', name);
      
      return { 
        success: true, 
        user: currentUser,
        token: sessionToken
      };
    }
    
    return result;
  } catch (error) {
    console.error('[auth] Login error:', error);
    return { success: false, message: 'Login error occurred' };
  }
}

// Logout user
async function logoutUser() {
  try {
    if (!currentUser) return { success: true };

    const result = await excelClient.logoutAuthUser(currentUser.name);
    
    currentUser = null;
    sessionToken = null;

    return result;
  } catch (error) {
    console.error('[auth] Logout error:', error);
    return { success: true }; // Still clear local session
  }
}

// Get all users
async function getAllUsers() {
  try {
    if (!fs.existsSync(AUTH_FILE)) {
      return [];
    }

    const result = await excelClient.getAllAuthUsers();
    return result.users || [];
  } catch (error) {
    console.error('[auth] Error getting users:', error);
    return [];
  }
}

// Check if any users exist
async function hasUsers() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return false;
    
    const result = await excelClient.hasAuthUsers();
    return result.hasUsers || false;
  } catch (error) {
    console.error('[auth] Error checking users:', error);
    return false;
  }
}

// Get current user
function getCurrentUser() {
  return currentUser;
}

// Verify session
function verifySession(token) {
  return token === sessionToken && currentUser !== null;
}

module.exports = {
  initAuthWorkbook,
  createUser,
  loginUser,
  logoutUser,
  getAllUsers,
  hasUsers,
  getCurrentUser,
  verifySession
};