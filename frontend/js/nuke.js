// frontend/nuke.js

(function () {
  'use strict';

  let mounted = false;

  function setFooterHidden(hidden){
    const root = document.getElementById('settingsPage');
    if (!root) return;
    root.classList.toggle('nuke-active', !!hidden);
  }

  async function mountNukePanel() {
    if (mounted) return;
    const panel = document.getElementById('tab-nuke');
    const mount = document.getElementById('nukeMount');
    if (!panel || !mount) return;


    // Load the simple HTML fragment
    try {
      const resp = await fetch('nuke.html', { cache: 'no-store' });
      const html = await resp.text();
      mount.innerHTML = html;
    } catch (e) {
      mount.innerHTML = `
        <div class="nuke-section">
          <button id="nukeBtn" class="btn btn-danger">Nuke Program</button>
          <p class="hint">This button is for debugging purposes, and will delete the .xlsx files inside of the data folder</p>
          <div id="nukeStatus" class="hint" style="margin-top:.5rem;"></div>
        </div>`;
    }

    const btn = document.getElementById('nukeBtn');
    const status = document.getElementById('nukeStatus');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const ok = window.confirm(
        'WARNING: This will permanently delete ALL .xlsx files under the data folder (including subfolders) and the .lookups_cache.json file, then restart the app.\n\nDo you want to continue?'
      );
      if (!ok) return;

      btn.disabled = true;
      if (status) status.textContent = 'Deleting files and restarting…';

      try {
        // Triggers deletion + relaunch in main process
        const res = await (window.electronAPI?.nukeProgram?.() || Promise.reject(new Error('IPC not available')));
        // App will relaunch; no further code will run after exit()
      } catch (e) {
        if (status) status.textContent = 'Failed: ' + (e && e.message ? e.message : 'Unknown error');
        btn.disabled = false;
      }
    });

    mounted = true;
    setFooterHidden(true);
  }

  // Try once at startup
  document.addEventListener('DOMContentLoaded', () => {
    // If we load directly on Nuke, hide footer
    const active = document.querySelector('.tab-btn.active');
    setFooterHidden(active?.dataset?.tab === 'nuke');
    mountNukePanel();
  });


  // Mount when user clicks the Nuke tab (event delegation on the whole doc)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    // Toggle footer visibility based on tab
    setFooterHidden(btn.dataset.tab === 'nuke');
    if (btn.dataset.tab === 'nuke') setTimeout(mountNukePanel, 0);
  });

  // Also watch the DOM for when #nukeMount is injected later
  const mo = new MutationObserver(() => mountNukePanel());
  mo.observe(document.documentElement, { childList: true, subtree: true });

})();
