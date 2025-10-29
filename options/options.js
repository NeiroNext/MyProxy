document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const addProfileBtn = document.getElementById('add-profile-btn');
  const addRuleBtn = document.getElementById('add-rule-btn');
  const importBtn = document.getElementById('import-btn');
  const exportBtn = document.getElementById('export-btn');
  const importFileInput = document.getElementById('import-file-input');
  const profilesListDiv = document.getElementById('proxy-profiles-list');
  const rulesListDiv = document.getElementById('domain-rules-list');

  let settings = {};

  // Default settings structure
  const defaultSettings = {
    proxyProfiles: [
      { id: 1, name: 'Default Profile', scheme: 'http', host: '127.0.0.1', port: 8080 }
    ],
    domainRules: [],
    nextProfileId: 2,
    nextRuleId: 1
  };

  // --- Data Functions ---

  function loadSettings() {
    chrome.storage.local.get('proxySettings', (data) => {
      if (data.proxySettings) {
        settings = data.proxySettings;
      } else {
        settings = defaultSettings;
        // Save default settings if nothing is stored yet
        saveSettings();
      }
      renderUI();
    });
  }

  function saveSettings() {
    chrome.storage.local.set({ proxySettings: settings }, () => {
      console.log('Settings saved.');
      // Notify background script that settings have changed
      chrome.runtime.sendMessage({ type: 'settings-changed' });
    });
  }

  // --- UI Rendering ---

  function renderUI() {
    renderProfiles();
    renderRules();
  }

  function renderProfiles() {
    profilesListDiv.innerHTML = ''; // Clear previous content
    if (!settings.proxyProfiles || settings.proxyProfiles.length === 0) {
      profilesListDiv.innerHTML = '<p>No profiles configured.</p>';
      return;
    }

    settings.proxyProfiles.forEach(profile => {
      const profileEl = document.createElement('div');
      profileEl.className = 'list-item';
      profileEl.innerHTML = `
        <span><strong>${profile.name}</strong> (${profile.scheme}://${profile.host}:${profile.port})</span>
        <div class="item-actions">
          <button class="edit-profile-btn" data-id="${profile.id}">Edit</button>
          <button class="delete-profile-btn" data-id="${profile.id}">Delete</button>
        </div>
      `;
      profilesListDiv.appendChild(profileEl);
    });
  }

  function renderRules() {
    rulesListDiv.innerHTML = ''; // Clear previous content
    if (!settings.domainRules || settings.domainRules.length === 0) {
      rulesListDiv.innerHTML = '<p>No rules configured.</p>';
      return;
    }

    settings.domainRules.forEach(rule => {
      const ruleEl = document.createElement('div');
      ruleEl.className = 'list-item';
      const profile = settings.proxyProfiles.find(p => p.id === rule.profileId) || { name: 'N/A' };
      ruleEl.innerHTML = `
        <span><strong>${rule.domain}</strong> -> ${rule.mode} (Profile: ${profile.name})</span>
        <div class="item-actions">
          <button class="edit-rule-btn" data-id="${rule.id}">Edit</button>
          <button class="delete-rule-btn" data-id="${rule.id}">Delete</button>
        </div>
      `;
      rulesListDiv.appendChild(ruleEl);
    });
  }

  // --- Event Handlers ---

  addProfileBtn.addEventListener('click', () => {
    const name = prompt('Enter profile name:', 'New Profile');
    if (!name) return;
    const scheme = prompt('Enter scheme (http, https, socks4, socks5):', 'http');
    if (!scheme) return;
    const host = prompt('Enter host:', '127.0.0.1');
    if (!host) return;
    const port = parseInt(prompt('Enter port:', '8080'), 10);
    if (isNaN(port)) return;

    settings.proxyProfiles.push({ id: settings.nextProfileId++, name, scheme, host, port });
    saveSettings();
    renderUI();
  });

  addRuleBtn.addEventListener('click', () => {
    const domain = prompt('Enter domain or URL:', '*.example.com');
    if (!domain) return;
    const mode = confirm('Use proxy for this domain?') ? 'proxy' : 'direct';
    const profileId = parseInt(prompt('Enter profile ID to use:', settings.proxyProfiles[0]?.id || 1), 10);
    if (isNaN(profileId) || !settings.proxyProfiles.find(p => p.id === profileId)) {
      alert('Invalid Profile ID.');
      return;
    }

    settings.domainRules.push({ id: settings.nextRuleId++, domain, mode, profileId });
    saveSettings();
    renderUI();
  });

  exportBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "proxy-settings.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  });

  importBtn.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedSettings = JSON.parse(e.target.result);
        // Basic validation
        if (importedSettings.proxyProfiles && importedSettings.domainRules) {
          settings = importedSettings;
          saveSettings();
          renderUI();
          alert('Settings imported successfully!');
        } else {
          alert('Invalid settings file.');
        }
      } catch (error) {
        alert('Error parsing settings file: ' + error.message);
      }
    };
    reader.readAsText(file);
    // Reset file input
    importFileInput.value = '';
  });

  // --- Event Delegation for Edit/Delete ---

  profilesListDiv.addEventListener('click', (e) => {
    const target = e.target;
    const profileId = parseInt(target.dataset.id, 10);

    if (target.classList.contains('delete-profile-btn')) {
      if (confirm('Are you sure you want to delete this profile?')) {
        settings.proxyProfiles = settings.proxyProfiles.filter(p => p.id !== profileId);
        // Also remove rules associated with this profile
        settings.domainRules = settings.domainRules.filter(r => r.profileId !== profileId);
        saveSettings();
        renderUI();
      }
    } else if (target.classList.contains('edit-profile-btn')) {
        const profile = settings.proxyProfiles.find(p => p.id === profileId);
        if (profile) {
            const newName = prompt('Enter new name:', profile.name);
            if (newName) profile.name = newName;

            const newHost = prompt('Enter new host:', profile.host);
            if (newHost) profile.host = newHost;

            const newPort = prompt('Enter new port:', profile.port);
            if (newPort) profile.port = parseInt(newPort, 10);

            saveSettings();
            renderUI();
        }
    }
  });

  rulesListDiv.addEventListener('click', (e) => {
    const target = e.target;
    const ruleId = parseInt(target.dataset.id, 10);

    if (target.classList.contains('delete-rule-btn')) {
      if (confirm('Are you sure you want to delete this rule?')) {
        settings.domainRules = settings.domainRules.filter(r => r.id !== ruleId);
        saveSettings();
        renderUI();
      }
    } else if (target.classList.contains('edit-rule-btn')) {
        const rule = settings.domainRules.find(r => r.id === ruleId);
        if(rule) {
            const newDomain = prompt('Enter new domain/URL:', rule.domain);
            if (newDomain) rule.domain = newDomain;

            const newMode = confirm('Use proxy for this domain?') ? 'proxy' : 'direct';
            rule.mode = newMode;

            saveSettings();
            renderUI();
        }
    }
  });

  // --- Initial Load ---

  loadSettings();
});
