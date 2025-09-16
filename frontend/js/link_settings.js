// frontend/js/link_settings.js (simplified)
(function () {
  'use strict';

  // State
  const state = {
    lookupTree: null,
    originalLinks: new Map(), // Original values for cancel
    currentLinks: new Map(),  // Current edited values
    hasChanges: false
  };

  // Helper functions
  function normStr(s) {
    return String(s || '').trim();
  }

  function makeLocationKey(company, location) {
    return `loc||${normStr(company)}||${normStr(location)}`;
  }

  function makeAssetTypeKey(company, location, assetType) {
    return `at||${normStr(company)}||${normStr(location)}||${normStr(assetType)}`;
  }

  // IPC wrappers
  async function getLookupTree() {
    const api = window.electronAPI || {};
    if (typeof api.getLookupTree !== 'function') {
      return { companies: [], locationsByCompany: {}, assetsByLocation: {} };
    }
    try {
      return await api.getLookupTree();
    } catch (e) {
      console.error('[link_settings] getLookupTree failed:', e);
      return { companies: [], locationsByCompany: {}, assetsByLocation: {} };
    }
  }

  async function getPhotosBase(company, location, assetType) {
    const api = window.electronAPI || {};
    if (typeof api.getPhotosBase !== 'function') return null;
    try {
      return await api.getPhotosBase({ company, location, assetType });
    } catch (e) {
      console.error('[link_settings] getPhotosBase failed:', e);
      return null;
    }
  }

  async function setLocationLink(company, location, link) {
    const api = window.electronAPI || {};
    if (typeof api.setLocationLink !== 'function') return { success: false };
    try {
      return await api.setLocationLink(company, location, link);
    } catch (e) {
      console.error('[link_settings] setLocationLink failed:', e);
      return { success: false };
    }
  }

  async function setAssetTypeLink(assetType, company, location, link) {
    const api = window.electronAPI || {};
    if (typeof api.setAssetTypeLink !== 'function') return { success: false };
    try {
      return await api.setAssetTypeLink(assetType, company, location, link);
    } catch (e) {
      console.error('[link_settings] setAssetTypeLink failed:', e);
      return { success: false };
    }
  }

  // Load all current links
  async function loadAllLinks() {
    state.originalLinks.clear();
    state.currentLinks.clear();

    if (!state.lookupTree) return;

    const { locationsByCompany, assetsByLocation } = state.lookupTree;

    // Load all links by querying each combination
    for (const [company, locations] of Object.entries(locationsByCompany)) {
      for (const location of locations || []) {
        // Get location-level link
        const locKey = makeLocationKey(company, location);
        const locLink = await getPhotosBase(company, location, '');
        state.originalLinks.set(locKey, locLink || '');
        state.currentLinks.set(locKey, locLink || '');

        // Get asset-type-level links
        const assetTypes = assetsByLocation[location] || [];
        for (const assetType of assetTypes) {
          const atKey = makeAssetTypeKey(company, location, assetType);
          const atLink = await getPhotosBase(company, location, assetType);
          
          // Only store if different from location link
          if (atLink && atLink !== locLink) {
            state.originalLinks.set(atKey, atLink);
            state.currentLinks.set(atKey, atLink);
          } else {
            state.originalLinks.set(atKey, '');
            state.currentLinks.set(atKey, '');
          }
        }
      }
    }
  }

  // Render the tree view
  function renderTree() {
    const container = document.getElementById('linkTree');
    if (!container || !state.lookupTree) return;

    const { companies, locationsByCompany, assetsByLocation } = state.lookupTree;

    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    companies.forEach(company => {
      const locations = locationsByCompany[company] || [];
      
      if (locations.length === 0) return;

      const companyDiv = document.createElement('div');
      companyDiv.className = 'link-company expanded';
      
      const companyHeader = document.createElement('div');
      companyHeader.className = 'link-company-header';
      companyHeader.innerHTML = `
        <span>${company}</span>
        <span class="chevron">▶</span>
      `;
      companyHeader.onclick = () => {
        companyDiv.classList.toggle('expanded');
      };
      
      const companyContent = document.createElement('div');
      companyContent.className = 'link-company-content';

      locations.forEach(location => {
        const locDiv = document.createElement('div');
        locDiv.className = 'link-location';
        
        // Location header with input
        const locHeader = document.createElement('div');
        locHeader.className = 'link-location-header';
        
        const locName = document.createElement('div');
        locName.className = 'link-location-name';
        locName.textContent = location;
        
        const locKey = makeLocationKey(company, location);
        const locInput = document.createElement('input');
        locInput.type = 'text';
        locInput.className = 'link-path-input';
        locInput.placeholder = 'No path set (uses default)';
        locInput.value = state.currentLinks.get(locKey) || '';
        locInput.dataset.linkKey = locKey;
        locInput.dataset.linkType = 'location';
        locInput.dataset.company = company;
        locInput.dataset.location = location;
        
        locInput.addEventListener('input', handleInputChange);
        
        locHeader.appendChild(locName);
        locHeader.appendChild(locInput);
        locDiv.appendChild(locHeader);
        
        // Asset types
        const assetTypes = assetsByLocation[location] || [];
        if (assetTypes.length > 0) {
          const atContainer = document.createElement('div');
          atContainer.className = 'link-asset-types';
          
          assetTypes.forEach(assetType => {
            const atDiv = document.createElement('div');
            atDiv.className = 'link-asset-type';
            
            const atName = document.createElement('div');
            atName.className = 'link-asset-type-name';
            atName.textContent = assetType;
            
            const atKey = makeAssetTypeKey(company, location, assetType);
            const atInput = document.createElement('input');
            atInput.type = 'text';
            atInput.className = 'link-path-input';
            atInput.placeholder = 'Uses location path';
            atInput.value = state.currentLinks.get(atKey) || '';
            atInput.dataset.linkKey = atKey;
            atInput.dataset.linkType = 'assetType';
            atInput.dataset.company = company;
            atInput.dataset.location = location;
            atInput.dataset.assetType = assetType;
            
            atInput.addEventListener('input', handleInputChange);
            
            atDiv.appendChild(atName);
            atDiv.appendChild(atInput);
            atContainer.appendChild(atDiv);
          });
          
          locDiv.appendChild(atContainer);
        }
        
        companyContent.appendChild(locDiv);
      });

      companyDiv.appendChild(companyHeader);
      companyDiv.appendChild(companyContent);
      frag.appendChild(companyDiv);
    });

    container.appendChild(frag);
  }

  // Handle input changes
  function handleInputChange(e) {
    const input = e.target;
    const key = input.dataset.linkKey;
    const value = normStr(input.value);
    
    // Normalize UNC paths
    let normalizedValue = value;
    if (normalizedValue.startsWith('\\\\')) {
      // UNC path - ensure single backslashes after the initial \\
      const parts = normalizedValue.substring(2).split(/\\+/);
      normalizedValue = '\\\\' + parts.join('\\');
    }
    
    state.currentLinks.set(key, normalizedValue);
    state.hasChanges = true;
    
    // Mark settings as having changes
    if (window.linkSettingsChanged) {
      window.linkSettingsChanged();
    }
  }

  // Save all changes
  async function saveChanges() {
    const changes = [];
    
    // Find all changes
    for (const [key, currentValue] of state.currentLinks) {
      const originalValue = state.originalLinks.get(key);
      if (currentValue !== originalValue) {
        changes.push({ key, value: currentValue });
      }
    }
    
    if (changes.length === 0) return { success: true, message: 'No changes to save' };
    
    let successCount = 0;
    let failCount = 0;
    
    // Apply changes
    for (const { key, value } of changes) {
      // Parse the key to get type and parameters
      const parts = key.split('||');
      const type = parts[0];
      
      let result;
      if (type === 'loc') {
        const [, company, location] = parts;
        result = await setLocationLink(company, location, value);
      } else if (type === 'at') {
        const [, company, location, assetType] = parts;
        result = await setAssetTypeLink(assetType, company, location, value);
      }
      
      if (result && result.success) {
        successCount++;
        // Update the original value on success
        state.originalLinks.set(key, value);
      } else {
        failCount++;
      }
    }
    
    if (failCount === 0) {
      state.hasChanges = false;
    }
    
    // Refresh cache
    if (typeof window.electronAPI?.invalidateStationCache === 'function') {
      await window.electronAPI.invalidateStationCache();
    }
    
    return { 
      success: failCount === 0, 
      message: failCount > 0 
        ? `Saved ${successCount} changes, ${failCount} failed` 
        : `Saved ${successCount} changes`
    };
  }

  // Cancel changes (revert to original)
  function cancelChanges() {
    // Reset current links to original values
    state.currentLinks.clear();
    for (const [key, value] of state.originalLinks) {
      state.currentLinks.set(key, value);
    }
    state.hasChanges = false;
    
    // Re-render to show original values
    renderTree();
  }

  // Initialize
  async function initLinkSettings() {
    // Load data
    state.lookupTree = await getLookupTree();
    await loadAllLinks();
    renderTree();
  }

  // Export for external access
  window.linkSettings = {
    init: initLinkSettings,
    save: saveChanges,
    cancel: cancelChanges,
    hasChanges: () => state.hasChanges
  };

  // Auto-init if the tab exists
  document.addEventListener('DOMContentLoaded', () => {
    const tab = document.getElementById('tab-photoLinks');
    if (tab) {
      initLinkSettings();
    }
  });

})();