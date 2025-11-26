// backend/auth.js
const crypto = require('crypto');
const { getPersistence } = require('./persistence');

// Toggle to enable/disable authentication logic.
// false means NO LOGIN
// true means YES LOGIN
const AUTH_ENABLED = false;

let currentUser = null;
let sessionToken = null;

// Default dev user used when auth is disabled
const DEV_USER = {
  name: 'Developer',
  email: 'developer@local',
  admin: 'Yes',
  permissions: 'All',
  status: 'Active',
  created: new Date().toISOString(),
  lastLogin: ''
};

// Initialize auth workbook
async function initAuthWorkbook() {
  try {
    if (!AUTH_ENABLED) {
      console.log('[auth] Auth disabled. Skipping workbook initialization.');
      return { exists: true, disabled: true };
    }

    console.log('[auth] Initializing auth persistence...');
    const persistence = await getPersistence();

    // Create the file through the worker
    const result = await persistence.createAuthWorkbook();
    console.log('[auth] Auth persistence initialized:', result);
    
    return { exists: result.success };
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
    if (!AUTH_ENABLED) {
      console.log('[auth] Auth disabled. createUser ignored.');
      return { success: false, message: 'Authentication is disabled in backend/auth.js' };
    }

    const { name, email, password, admin, permissions } = userData;
    
    console.log('[auth] Creating user:', name);
    
    if (!validateEmail(email)) {
      return { success: false, message: 'Email must be @ec.gc.ca domain' };
    }

    const hashedPassword = hashPassword(password);
    const persistence = await getPersistence();

    const result = await persistence.createAuthUser({
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

    if (!AUTH_ENABLED) {
      // Bypass login and issue a dev session
      currentUser = { ...DEV_USER, name: name || DEV_USER.name };
      sessionToken = crypto.randomBytes(32).toString('hex');
      console.log('[auth] Auth disabled. Bypassing login for:', currentUser.name);
      return {
        success: true,
        user: currentUser,
        token: sessionToken,
        disabled: true
      };
    }
    
    // Check if any users exist via persistence before trying login
    const userCheck = await hasUsers(); // Call local function directly
    if (!userCheck) {
      return { success: false, message: 'No users exist. Please create an account.' };
    }

    const hashedPassword = hashPassword(password);
    const persistence = await getPersistence();

    const result = await persistence.loginAuthUser(name, hashedPassword);
    
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

    if (!AUTH_ENABLED) {
      currentUser = null;
      sessionToken = null;
      return { success: true, disabled: true };
    }

    const persistence = await getPersistence();
    const result = await persistence.logoutAuthUser(currentUser.name);
    
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
    if (!AUTH_ENABLED) {
      return [DEV_USER];
    }

    const persistence = await getPersistence();
    const result = await persistence.getAllAuthUsers();
    return result.users || [];
  } catch (error) {
    console.error('[auth] Error getting users:', error);
    return [];
  }
}

// Check if any users exist
async function hasUsers() {
  try {
    if (!AUTH_ENABLED) return true;

    const persistence = await getPersistence();
    const result = await persistence.hasAuthUsers();
    return result.hasUsers || false;
  } catch (error) {
    console.error('[auth] Error checking users:', error);
    return false;
  }
}

// Get current user
function getCurrentUser() {
  if (!AUTH_ENABLED) {
    return currentUser || DEV_USER;
  }
  return currentUser;
}

// Verify session
function verifySession(token) {
  if (!AUTH_ENABLED) return true;
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