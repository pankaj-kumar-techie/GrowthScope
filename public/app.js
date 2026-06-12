// public/app.js — ARMA Audit Engine Client

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.panel');
  
  const healthDot = document.getElementById('health-dot');
  const healthText = document.getElementById('health-text');
  
  // Forms
  const liteForm = document.getElementById('lite-form');
  const liteSubmit = document.getElementById('lite-submit');
  const fullForm = document.getElementById('full-form');
  const fullSubmit = document.getElementById('full-submit');
  const speedForm = document.getElementById('speed-check-form');
  const speedSubmit = document.getElementById('speed-submit-btn');
  const debugForm = document.getElementById('mappack-debug-form');
  const debugSubmit = document.getElementById('debug-submit-btn');
  
  // Format selection
  const formatToggles = document.querySelectorAll('.toggle-group .toggle-btn');
  let selectedFormat = 'pdf'; // default

  // Viewers
  const viewerTitleIcon = document.getElementById('viewer-type-icon');
  const viewerTitleText = document.getElementById('viewer-title-text');
  const viewerActions = document.getElementById('viewer-actions');
  const copyJsonBtn = document.getElementById('copy-json-btn');
  const downloadPdfBtn = document.getElementById('download-pdf-btn');
  const clearViewerBtn = document.getElementById('clear-viewer-btn');
  
  const viewerPlaceholder = document.getElementById('viewer-placeholder');
  const pdfIframe = document.getElementById('pdf-iframe');
  const jsonPre = document.getElementById('json-pre');
  const diagnosticGrid = document.getElementById('diagnostic-grid');
  
  // Terminal log
  const terminalBody = document.getElementById('terminal-body');
  
  // Diagnostics UI
  const leadsCountText = document.getElementById('leads-count');
  const cacheCountText = document.getElementById('cache-count');
  const refreshStatusBtn = document.getElementById('refresh-status-btn');
  const refreshCacheBtn = document.getElementById('refresh-cache-btn');
  const cacheListContainer = document.getElementById('cache-list-container');
  const clearAllCacheBtn = document.getElementById('clear-all-cache-btn');

  // State
  let currentJsonData = null;
  let currentPdfBlobUrl = null;

  // Initialize
  checkHealth();
  // Poll health every 30 seconds
  setInterval(checkHealth, 30000);

  // ── Tab Navigation ────────────────────────────────────────────────────────
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      // Update buttons
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update panels
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(targetTab).classList.add('active');
      
      log(`Switched to tab: ${btn.querySelector('span').textContent}`, 'info');

      // Update workspace view depending on active tab
      if (targetTab === 'tools-tab') {
        showDiagnosticsView();
      } else {
        restoreViewerState();
      }
    });
  });

  // ── Format Toggle Logic ───────────────────────────────────────────────────
  formatToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      formatToggles.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = btn.getAttribute('data-format');
      log(`Selected output format: ${selectedFormat.toUpperCase()}`, 'info');
    });
  });

  // ── Helper functions for Viewer View States ──────────────────────────────
  function clearViewers() {
    pdfIframe.style.display = 'none';
    jsonPre.style.display = 'none';
    diagnosticGrid.style.display = 'none';
    viewerPlaceholder.style.display = 'flex';
    viewerActions.style.display = 'none';
    copyJsonBtn.style.display = 'none';
    downloadPdfBtn.style.display = 'none';
    
    // Revoke old object URL to free memory
    if (currentPdfBlobUrl) {
      URL.revokeObjectURL(currentPdfBlobUrl);
      currentPdfBlobUrl = null;
    }
    currentJsonData = null;
  }

  function showPdfView(blobUrl, title = 'Audit Report PDF') {
    clearViewers();
    viewerPlaceholder.style.display = 'none';
    pdfIframe.style.display = 'block';
    pdfIframe.src = blobUrl;
    
    viewerTitleIcon.className = 'fa-solid fa-file-pdf';
    viewerTitleIcon.style.color = '#ef4444'; // PDF red
    viewerTitleText.textContent = title;
    
    viewerActions.style.display = 'flex';
    downloadPdfBtn.style.display = 'block';
    
    currentPdfBlobUrl = blobUrl;
  }

  function showJsonView(jsonData, title = 'API Response JSON') {
    clearViewers();
    viewerPlaceholder.style.display = 'none';
    jsonPre.style.display = 'block';
    jsonPre.textContent = JSON.stringify(jsonData, null, 2);
    
    viewerTitleIcon.className = 'fa-solid fa-code';
    viewerTitleIcon.style.color = '#6366f1'; // Indigo
    viewerTitleText.textContent = title;
    
    viewerActions.style.display = 'flex';
    copyJsonBtn.style.display = 'block';
    
    currentJsonData = jsonData;
  }

  function showDiagnosticsView() {
    // Save current view state if not diagnostics
    if (pdfIframe.style.display === 'block') {
      pdfIframe.dataset.wasVisible = 'true';
    } else if (jsonPre.style.display === 'block') {
      jsonPre.dataset.wasVisible = 'true';
    } else {
      delete pdfIframe.dataset.wasVisible;
      delete jsonPre.dataset.wasVisible;
    }

    pdfIframe.style.display = 'none';
    jsonPre.style.display = 'none';
    viewerPlaceholder.style.display = 'none';
    diagnosticGrid.style.display = 'grid';
    viewerActions.style.display = 'none';
    
    viewerTitleIcon.className = 'fa-solid fa-sliders';
    viewerTitleIcon.style.color = '#10b981'; // Green
    viewerTitleText.textContent = 'Diagnostics & System Status';
    
    // Auto-refresh stats
    refreshDiagnostics();
  }

  function restoreViewerState() {
    if (pdfIframe.dataset.wasVisible === 'true') {
      diagnosticGrid.style.display = 'none';
      pdfIframe.style.display = 'block';
      viewerActions.style.display = 'flex';
      downloadPdfBtn.style.display = 'block';
      viewerTitleIcon.className = 'fa-solid fa-file-pdf';
      viewerTitleIcon.style.color = '#ef4444';
      viewerTitleText.textContent = 'Audit Report PDF';
    } else if (jsonPre.dataset.wasVisible === 'true') {
      diagnosticGrid.style.display = 'none';
      jsonPre.style.display = 'block';
      viewerActions.style.display = 'flex';
      copyJsonBtn.style.display = 'block';
      viewerTitleIcon.className = 'fa-solid fa-code';
      viewerTitleIcon.style.color = '#6366f1';
      viewerTitleText.textContent = 'API Response JSON';
    } else {
      clearViewers();
    }
  }

  clearViewerBtn.addEventListener('click', () => {
    clearViewers();
    delete pdfIframe.dataset.wasVisible;
    delete jsonPre.dataset.wasVisible;
    log('Viewer cleared.', 'info');
  });

  copyJsonBtn.addEventListener('click', () => {
    if (currentJsonData) {
      navigator.clipboard.writeText(JSON.stringify(currentJsonData, null, 2))
        .then(() => log('JSON copied to clipboard!', 'success'))
        .catch(err => log('Failed to copy JSON: ' + err, 'error'));
    }
  });

  downloadPdfBtn.addEventListener('click', () => {
    if (currentPdfBlobUrl) {
      const a = document.createElement('a');
      a.href = currentPdfBlobUrl;
      a.download = `ARMA_Report_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      log('Report download initiated.', 'success');
    }
  });

  // ── Logging System ────────────────────────────────────────────────────────
  function log(message, type = 'info') {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = timestamp;
    
    const msgSpan = document.createElement('span');
    msgSpan.className = 'log-msg';
    msgSpan.textContent = message;
    
    entry.appendChild(timeSpan);
    entry.appendChild(msgSpan);
    
    terminalBody.appendChild(entry);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  // ── Active Timer Helper ───────────────────────────────────────────────────
  let logTimerInterval = null;
  function startProgressTimer(label) {
    let seconds = 0;
    log(`Starting: ${label}...`, 'info');
    logTimerInterval = setInterval(() => {
      seconds += 1;
      log(`Running: ${label} for ${seconds}s...`, 'info');
    }, 5000);
    return () => {
      clearInterval(logTimerInterval);
      log(`Finished: ${label}`, 'success');
    };
  }

  // ── API Health Check ──────────────────────────────────────────────────────
  async function checkHealth() {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        healthDot.className = 'status-dot online';
        healthText.textContent = 'Server Online';
        leadsCountText.textContent = data.leads_in_db ?? 0;
        cacheCountText.textContent = data.mappack_cache_live ?? 0;
      } else {
        throw new Error('Health returned non-ok status');
      }
    } catch (e) {
      healthDot.className = 'status-dot offline';
      healthText.textContent = 'Server Offline';
      log(`Health Check Failed: Server is unreachable.`, 'error');
    }
  }

  // ── Submit Lite Report ────────────────────────────────────────────────────
  liteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = document.getElementById('lite-url').value.trim();
    const city = document.getElementById('lite-city').value.trim();
    const state = document.getElementById('lite-state').value.trim().toUpperCase();
    const vertical = document.getElementById('lite-vertical').value.trim();
    
    if (!url || !city || !state) {
      log('Please fill in URL, City, and State.', 'warning');
      return;
    }
    
    liteSubmit.disabled = true;
    const stopTimer = startProgressTimer(`Lite Report [${url}]`);
    log(`Triggering Lite Report for "${city}, ${state}"...`, 'info');

    try {
      const requestBody = { url, city, state };
      if (vertical) requestBody.vertical = vertical;
      
      // If user selected JSON format, we ask the backend for json output format
      if (selectedFormat === 'json') {
        requestBody.format = 'json';
      }

      const response = await fetch('/lite-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const contentType = response.headers.get('content-type');
      
      // Check if response is JSON (error or JSON report)
      if (!response.ok || (contentType && contentType.includes('application/json'))) {
        const result = await response.json();
        if (response.ok && selectedFormat === 'json') {
          stopTimer();
          log('Lite Report (JSON) generated successfully!', 'success');
          showJsonView(result, `Lite Report: ${result.domain}`);
          
          // Pre-fill the Full Report URL input for convenience
          document.getElementById('full-url').value = url;
        } else {
          stopTimer();
          log(`Lite Report failed: ${result.error || 'Server error'}`, 'error');
          showJsonView(result, 'Error Details');
        }
      } else {
        // Response is PDF Blob
        const blob = await response.blob();
        stopTimer();
        log('Lite Report (PDF) generated successfully!', 'success');
        
        const blobUrl = URL.createObjectURL(blob);
        showPdfView(blobUrl, `Lite Report: ${url.replace(/https?:\/\/(www\.)?/, '')}`);
        
        // Pre-fill Full Report form
        document.getElementById('full-url').value = url;
      }
    } catch (err) {
      stopTimer();
      log(`Network error: ${err.message}`, 'error');
    } finally {
      liteSubmit.disabled = false;
      checkHealth();
    }
  });

  // ── Submit Full Report ────────────────────────────────────────────────────
  fullForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = document.getElementById('full-url').value.trim();
    if (!url) {
      log('Please fill in target URL.', 'warning');
      return;
    }

    fullSubmit.disabled = true;
    const stopTimer = startProgressTimer(`Full Report [${url}] (Note: this runs crawlers, PageSpeed and Claude AI, it may take 1-2 minutes)`);

    try {
      const response = await fetch('/full-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const contentType = response.headers.get('content-type');

      if (!response.ok || (contentType && contentType.includes('application/json'))) {
        const result = await response.json();
        stopTimer();
        log(`Full Report failed: ${result.error || 'Server error'}`, 'error');
        showJsonView(result, 'Error Details');
      } else {
        const blob = await response.blob();
        stopTimer();
        log('Full Report (PDF) generated successfully!', 'success');
        
        const blobUrl = URL.createObjectURL(blob);
        showPdfView(blobUrl, `Full Audit: ${url.replace(/https?:\/\/(www\.)?/, '')}`);
      }
    } catch (err) {
      stopTimer();
      log(`Network error: ${err.message}`, 'error');
    } finally {
      fullSubmit.disabled = false;
      checkHealth();
    }
  });

  // ── Direct PageSpeed Check ────────────────────────────────────────────────
  speedForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('speed-url').value.trim();
    if (!url) return;

    speedSubmit.disabled = true;
    const stopTimer = startProgressTimer(`PageSpeed check for ${url}`);

    try {
      const response = await fetch(`/pagespeed-check?url=${encodeURIComponent(url)}&strategy=mobile`);
      const result = await response.json();
      stopTimer();
      
      if (response.ok) {
        log(`PageSpeed completed for ${url}! Mobile Score: ${result.mobile.score * 100}, Desktop: ${result.desktop.score * 100}`, 'success');
        showJsonView(result, `PageSpeed Score: ${url}`);
      } else {
        log(`PageSpeed check failed: ${result.error}`, 'error');
        showJsonView(result, 'PageSpeed Error');
      }
    } catch (err) {
      stopTimer();
      log(`PageSpeed check network error: ${err.message}`, 'error');
    } finally {
      speedSubmit.disabled = false;
    }
  });

  // ── Live MapPack Debug ───────────────────────────────────────────────────
  debugForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vertical = document.getElementById('debug-vertical').value.trim();
    const city = document.getElementById('debug-city').value.trim();
    const state = document.getElementById('debug-state').value.trim().toUpperCase();
    
    if (!vertical || !city || !state) return;

    debugSubmit.disabled = true;
    const stopTimer = startProgressTimer(`Map Pack Debug for "${vertical}" in "${city}, ${state}"`);

    try {
      const url = `/mappack-debug?vertical=${encodeURIComponent(vertical)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`;
      const response = await fetch(url);
      const result = await response.json();
      stopTimer();
      
      if (response.ok) {
        log(`Map Pack Debug completed! Source: ${result.source}, Businesses found: ${result.count}`, 'success');
        showJsonView(result, `MapPack Debug: ${vertical} in ${city}`);
      } else {
        log(`Map Pack Debug failed: ${result.error}`, 'error');
        showJsonView(result, 'MapPack Debug Error');
      }
    } catch (err) {
      stopTimer();
      log(`Map Pack Debug network error: ${err.message}`, 'error');
    } finally {
      debugSubmit.disabled = false;
    }
  });

  // ── Diagnostics & Cache Operations ────────────────────────────────────────
  async function refreshDiagnostics() {
    checkHealth();
    loadCacheList();
  }

  async function loadCacheList() {
    cacheListContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 1rem;">Loading cache...</div>';
    try {
      const res = await fetch('/cache-status');
      if (res.ok) {
        const data = await res.json();
        
        if (!data.entries || data.entries.length === 0) {
          cacheListContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 1rem;">No cached Map Packs found.</div>';
          return;
        }

        cacheListContainer.innerHTML = '';
        data.entries.forEach(entry => {
          const item = document.createElement('div');
          item.className = 'cache-item';
          
          const info = document.createElement('div');
          info.className = 'cache-info';
          
          const key = document.createElement('span');
          key.className = 'cache-key';
          key.textContent = `${entry.keyword}`;
          
          const meta = document.createElement('span');
          meta.className = 'cache-meta';
          meta.textContent = `${entry.city}, ${entry.state} (Age: ${entry.age_hours}h)`;
          
          info.appendChild(key);
          info.appendChild(meta);
          
          const actions = document.createElement('div');
          actions.className = 'cache-actions';
          
          const delBtn = document.createElement('button');
          delBtn.className = 'btn-small-danger';
          delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
          delBtn.title = 'Evict from Cache';
          delBtn.addEventListener('click', async () => {
            delBtn.disabled = true;
            try {
              const clearRes = await fetch(`/cache-clear?keyword=${encodeURIComponent(entry.keyword)}&city=${encodeURIComponent(entry.city)}&state=${encodeURIComponent(entry.state)}`, {
                method: 'DELETE'
              });
              const clearResult = await clearRes.json();
              log(`Cleared cache for keyword "${entry.keyword}" @ ${entry.city}, ${entry.state}`, 'success');
              loadCacheList();
              checkHealth();
            } catch (err) {
              log(`Failed to delete cache: ${err.message}`, 'error');
              delBtn.disabled = false;
            }
          });
          
          actions.appendChild(delBtn);
          item.appendChild(info);
          item.appendChild(actions);
          
          cacheListContainer.appendChild(item);
        });
      } else {
        throw new Error('Failed to load cache status');
      }
    } catch (err) {
      cacheListContainer.innerHTML = `<div style="color: var(--danger); font-size: 0.8rem; text-align: center; padding: 1rem;">Error: ${err.message}</div>`;
    }
  }

  clearAllCacheBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear ALL cached Map Packs? This will force a fresh fetch from external APIs on next request.')) {
      return;
    }
    
    clearAllCacheBtn.disabled = true;
    log('Clearing entire Map Pack cache...', 'info');
    try {
      const res = await fetch('/cache-clear', { method: 'DELETE' });
      const data = await res.json();
      log(`Cache cleared successfully! Entries deleted: ${data.cleared}`, 'success');
      refreshDiagnostics();
    } catch (err) {
      log(`Failed to clear cache: ${err.message}`, 'error');
    } finally {
      clearAllCacheBtn.disabled = false;
    }
  });

  refreshStatusBtn.addEventListener('click', refreshDiagnostics);
  refreshCacheBtn.addEventListener('click', loadCacheList);
});
