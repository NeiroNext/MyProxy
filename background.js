// --- Globals ---
let settings = {};
let proxyMode = 'direct';

// --- Default Settings ---
const defaultSettings = {
  proxyProfiles: [
    { id: 1, name: 'Default Profile', scheme: 'http', host: '127.0.0.1', port: 8080 }
  ],
  domainRules: [],
  nextProfileId: 2,
  nextRuleId: 1
};

// --- Core Functions ---

function applyProxySettings() {
  console.log(`Applying proxy mode: ${proxyMode}`);

  if (proxyMode === 'direct') {
    chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' });
    return;
  }

  if (proxyMode === 'system') {
    chrome.proxy.settings.set({ value: { mode: 'system' }, scope: 'regular' });
    return;
  }

  if (proxyMode === 'fixed_servers') {
    if (settings.proxyProfiles && settings.proxyProfiles.length > 0) {
      const profile = settings.proxyProfiles[0]; // Use the first profile by default
      const proxyConfig = {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme: profile.scheme,
            host: profile.host,
            port: profile.port
          },
          bypassList: ["<local>"]
        }
      };
      chrome.proxy.settings.set({ value: proxyConfig, scope: 'regular' });
    } else {
      console.error('Proxy mode selected, but no proxy profiles are configured.');
      // Fallback to direct connection
      chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' });
    }
    return;
  }

  if (proxyMode === 'pac_script') {
    const pacScript = generatePacScript();
    const proxyConfig = {
      mode: 'pac_script',
      pacScript: {
        data: pacScript
      }
    };
    chrome.proxy.settings.set({ value: proxyConfig, scope: 'regular' });
    return;
  }
}

function generatePacScript() {
  let conditions = [];

  settings.domainRules.forEach(rule => {
    let proxyString = 'DIRECT';
    if (rule.mode === 'proxy') {
      const profile = settings.proxyProfiles.find(p => p.id === rule.profileId);
      if (profile) {
        // Note: Chrome PAC script supports HTTP, HTTPS, SOCKS4, SOCKS5 proxies.
        // The scheme in PAC script is PROXY/HTTPS/SOCKS/SOCKS5.
        let pacScheme = 'PROXY'; // default for http
        if (profile.scheme === 'https') pacScheme = 'HTTPS';
        if (profile.scheme === 'socks4') pacScheme = 'SOCKS';
        if (profile.scheme === 'socks5') pacScheme = 'SOCKS5';
        proxyString = `${pacScheme} ${profile.host}:${profile.port}`;
      }
    }
    // shExpMatch is a shell expression matching function available in PAC scripts
    conditions.push(`if (shExpMatch(host, "${rule.domain}")) { return "${proxyString}"; }`);
  });

  const pacScript = `
    function FindProxyForURL(url, host) {
      ${conditions.join('\n      ')}
      return "DIRECT";
    }
  `;

  console.log("Generated PAC Script:", pacScript);
  return pacScript;
}

function loadInitialSettings() {
  chrome.storage.local.get(['proxySettings', 'proxyMode'], (data) => {
    settings = data.proxySettings || defaultSettings;
    proxyMode = data.proxyMode || 'direct';

    // Save defaults if they don't exist
    if (!data.proxySettings) {
      chrome.storage.local.set({ proxySettings: settings });
    }
    if (!data.proxyMode) {
      chrome.storage.local.set({ proxyMode: proxyMode });
    }

    applyProxySettings();
  });
}

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed.');
  loadInitialSettings();
});

chrome.runtime.onStartup.addListener(() => {
    console.log('Browser startup.');
    loadInitialSettings();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'proxy-mode-changed') {
    proxyMode = message.mode;
    applyProxySettings();
  } else if (message.type === 'settings-changed') {
    // Reload all settings and re-apply
    loadInitialSettings();
  }
});

// Load settings when the script is first loaded
loadInitialSettings();

// --- Error Handling ---
chrome.proxy.onProxyError.addListener((details) => {
    console.error(`Proxy Error: ${details.details}`, details);

    // Extract domain from the URL
    if (details.fatal) {
        try {
            const url = new URL(details.uri);
            const domain = url.hostname;

            chrome.storage.local.get({ proxyErrors: [] }, (data) => {
                const errors = data.proxyErrors;
                // Avoid duplicate domains
                if (!errors.includes(domain)) {
                    errors.push(domain);
                    chrome.storage.local.set({ proxyErrors: errors });
                }
            });
        } catch (e) {
            console.error("Could not parse domain from URI:", details.uri);
        }
    }
});
