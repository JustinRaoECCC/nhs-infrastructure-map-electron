// frontend/js/login.js
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    // Check if we need to show registration (no users exist)
    const hasUsers = await window.electronAPI.hasUsers();
    
    if (!hasUsers) {
      showRegisterForm();
      document.getElementById('showLogin').style.display = 'none';
    }

    bindEvents();
  }

  function bindEvents() {
    document.getElementById('showRegister')?.addEventListener('click', (e) => {
      e.preventDefault();
      showRegisterForm();
    });

    document.getElementById('showLogin')?.addEventListener('click', (e) => {
      e.preventDefault();
      showLoginForm();
    });

    document.getElementById('btnLogin')?.addEventListener('click', handleLogin);
    document.getElementById('btnRegister')?.addEventListener('click', handleRegister);

    // Enter key handlers
    document.getElementById('loginPassword')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    document.getElementById('regPassword')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleRegister();
    });
  }

  function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
  }

  function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
  }

  async function handleLogin() {
    const name = document.getElementById('loginName').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!name || !password) {
      window.appAlert('Please enter name and password');
      return;
    }

    try {
      const result = await window.electronAPI.loginUser(name, password);
      
      if (result.success) {
        window.electronAPI.navigateToMain();
      } else {
        window.appAlert(result.message || 'Login failed');
      }
    } catch (e) {
      console.error('[login] Error:', e);
      window.appAlert('Login error occurred');
    }
  }

  async function handleRegister() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const admin = document.getElementById('regAdmin').value === 'yes';
    const permissions = document.getElementById('regPermissions').value;

    if (!name || !email || !password) {
      window.appAlert('Please fill in all required fields');
      return;
    }

    if (!email.toLowerCase().endsWith('@ec.gc.ca')) {
      window.appAlert('Email must be @ec.gc.ca domain');
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
        window.appAlert('Account created! Please login.');
        showLoginForm();
      } else {
        window.appAlert(result.message || 'Registration failed');
      }
    } catch (e) {
      console.error('[register] Error:', e);
      window.appAlert('Registration error occurred');
    }
  }
})();