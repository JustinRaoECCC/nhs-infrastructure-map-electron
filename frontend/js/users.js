// frontend/js/users.js
(function() {
  'use strict';

  let usersContainer = null;
  let currentUserData = null;

  async function initUsersView() {
    usersContainer = document.getElementById('usersPage');
    if (!usersContainer) return;

    // Load and display users
    await loadUsers();

    // Bind add user button
    const btnAdd = document.getElementById('btnAddUser');
    if (btnAdd) {
      btnAdd.addEventListener('click', showAddUserModal);
    }

    // Bind modal controls
    bindModalControls();
  }

  async function loadUsers() {
    try {
      const users = await window.electronAPI.getAllUsers();
      renderUsers(users);
    } catch (e) {
      console.error('[users] Failed to load:', e);
      appAlert('Failed to load users');
    }
  }

  function maskPassword(password) {
    if (!password) return '********';
    const firstChar = password.charAt(0);
    return '*******';
  }

  function renderUsers(users) {
    const grid = document.getElementById('usersGrid');
    if (!grid) return;

    grid.innerHTML = '';

    users.forEach(user => {
      const card = document.createElement('div');
      card.className = 'user-card';
      card.classList.toggle('active', user.status === 'Active');
      card.classList.toggle('admin', user.admin);

      card.innerHTML = `
        <div class="user-status ${user.status === 'Active' ? 'status-active' : 'status-inactive'}">
          <span class="status-dot"></span>
          ${user.status}
        </div>
        <div class="user-avatar">
          <span>${user.name ? user.name.charAt(0).toUpperCase() : '?'}</span>
        </div>
        <div class="user-info">
          <h3 class="user-name">${user.name || 'Unknown'}</h3>
          <p class="user-email">${user.email || ''}</p>
        </div>
        <div class="user-details">
          <div class="detail-row">
            <span class="detail-label">Password:</span>
            <span class="detail-value password-masked">${maskPassword(user.password)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Role:</span>
            <span class="detail-value">${user.admin ? 'Admin' : 'User'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Permissions:</span>
            <span class="detail-value">${user.permissions || 'Read'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Created:</span>
            <span class="detail-value">${formatDate(user.created)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Last Login:</span>
            <span class="detail-value">${formatDate(user.lastLogin) || 'Never'}</span>
          </div>
        </div>
      `;

      grid.appendChild(card);
    });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch {
      return dateStr;
    }
  }

  function showAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
      modal.style.display = 'flex';
      // Clear form
      document.getElementById('newUserName').value = '';
      document.getElementById('newUserEmail').value = '';
      document.getElementById('newUserPassword').value = '';
      document.getElementById('newUserAdmin').value = 'no';
      document.getElementById('newUserPermissions').value = 'Read';
    }
  }

  function hideAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) modal.style.display = 'none';
  }

  function bindModalControls() {
    document.getElementById('closeAddUser')?.addEventListener('click', hideAddUserModal);
    document.getElementById('cancelAddUser')?.addEventListener('click', hideAddUserModal);
    
    document.getElementById('saveNewUser')?.addEventListener('click', async () => {
      const name = document.getElementById('newUserName').value.trim();
      const email = document.getElementById('newUserEmail').value.trim();
      const password = document.getElementById('newUserPassword').value;
      const admin = document.getElementById('newUserAdmin').value === 'yes';
      const permissions = document.getElementById('newUserPermissions').value;

      if (!name || !email || !password) {
        appAlert('Please fill in all required fields');
        return;
      }

      if (!email.toLowerCase().endsWith('@ec.gc.ca')) {
        appAlert('Email must be @ec.gc.ca domain');
        return;
      }

      try {
        const result = await window.electronAPI.createUser({
          name,
          email,
          password,
          admin,
          permissions
        });

        if (result.success) {
          appAlert('User created successfully');
          hideAddUserModal();
          await loadUsers();
        } else {
          appAlert(result.message || 'Failed to create user');
        }
      } catch (e) {
        console.error('[users] Create failed:', e);
        appAlert('Failed to create user');
      }
    });
  }

  // Expose for navigation
  window.initUsersView = initUsersView;
})();