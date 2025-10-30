const DEFAULT_PROFILE_ID = 'profile-1';
const DEFAULT_PROFILE = {
  id: DEFAULT_PROFILE_ID,
  name: 'Основной профиль',
  scheme: 'http',
  host: '',
  port: '',
  username: '',
  password: ''
};

const DEFAULT_STATE = {
  mode: 'direct',
  proxyProfiles: [{ ...DEFAULT_PROFILE }],
  domainRules: [],
  errorDomains: [],
  globalProfileId: DEFAULT_PROFILE_ID
};

let stateCache = null;

async function getStateSnapshot() {
  if (stateCache) {
    return stateCache;
  }
  const state = await loadStateCache();
  return state;
}

function cloneProfile(profile) {
  return {
    id: profile.id || crypto.randomUUID(),
    name: profile.name || '',
    scheme: (profile.scheme || 'http').toLowerCase(),
    host: profile.host || '',
    port: profile.port || '',
    username: profile.username || '',
    password: profile.password || ''
  };
}

function cloneRule(rule) {
  const next = {
    id: rule.id || crypto.randomUUID(),
    pattern: (rule.pattern || '').trim(),
    mode: rule.mode === 'direct' ? 'direct' : 'proxy'
  };
  if (next.mode === 'proxy' && rule.profileId) {
    next.profileId = rule.profileId;
  }
  return next;
}

function cloneError(entry) {
  return {
    id: entry.id || crypto.randomUUID(),
    pattern: entry.pattern || '',
    lastError: entry.lastError || '',
    timestamp: entry.timestamp || Date.now()
  };
}

function normalizeState(raw = {}) {
  const mode = raw.mode === 'proxy' || raw.mode === 'auto' ? raw.mode : 'direct';
  const proxyProfiles = Array.isArray(raw.proxyProfiles) && raw.proxyProfiles.length
    ? raw.proxyProfiles.map(cloneProfile)
    : [cloneProfile(DEFAULT_PROFILE)];
  const domainRules = Array.isArray(raw.domainRules)
    ? raw.domainRules.map(cloneRule)
    : [];
  const errorDomains = Array.isArray(raw.errorDomains)
    ? raw.errorDomains.map(cloneError)
    : [];
  let globalProfileId = raw.globalProfileId;
  if (!globalProfileId || !proxyProfiles.some((profile) => profile.id === globalProfileId)) {
    globalProfileId = proxyProfiles[0].id;
  }
  return {
    mode,
    proxyProfiles,
    domainRules,
    errorDomains,
    globalProfileId
  };
}

async function loadStateCache() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  stateCache = normalizeState(data);
  return stateCache;
}

function applyChangesToCache(changes) {
  if (!stateCache) {
    return loadStateCache();
  }
  const merged = { ...stateCache };
  for (const [key, change] of Object.entries(changes)) {
    merged[key] = change.newValue;
  }
  stateCache = normalizeState(merged);
  return stateCache;
}

async function ensureDefaults() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  const updates = {};
  for (const [key, value] of Object.entries(DEFAULT_STATE)) {
    if (data[key] === undefined || (Array.isArray(value) && (!Array.isArray(data[key]) || data[key].length === 0))) {
      if (Array.isArray(value)) {
        updates[key] = value.map((item) => (typeof item === 'object' ? { ...item } : item));
      } else if (typeof value === 'object' && value !== null) {
        updates[key] = { ...value };
      } else {
        updates[key] = value;
      }
    }
  }
  const profiles = updates.proxyProfiles || data.proxyProfiles;
  if (!data.globalProfileId || !Array.isArray(profiles) || !profiles.some((profile) => profile.id === data.globalProfileId)) {
    const firstProfile = Array.isArray(profiles) && profiles.length ? profiles[0] : DEFAULT_PROFILE;
    updates.globalProfileId = firstProfile.id;
  }
  if (Object.keys(updates).length) {
    await chrome.storage.local.set(updates);
  }
}

function parsePort(port) {
  const parsed = parseInt(port, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildProxyConfig(profile) {
  if (!profile || !profile.host || !profile.port) {
    return { mode: 'direct' };
  }
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: profile.scheme || 'http',
        host: profile.host,
        port: parsePort(profile.port)
      },
      bypassList: []
    }
  };
}

function sanitizeForPac(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeHostPattern(pattern) {
  if (!pattern) {
    return '';
  }
  let normalized = pattern;
  if (normalized.startsWith('*.')) {
    normalized = normalized.slice(2);
  }
  while (normalized.startsWith('.')) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

function computeRulePriority(rule) {
  const baseLength = rule.matchPattern.length;
  return baseLength + (rule.isPathPattern ? 1000 : 0);
}

function prepareDomainRules(rules) {
  return rules
    .map((rule, index) => {
      const rawPattern = (rule.pattern || '').toLowerCase().trim();
      if (!rawPattern) {
        return null;
      }
      const isPathPattern = rawPattern.includes('/');
      const matchPattern = isPathPattern ? rawPattern : normalizeHostPattern(rawPattern);
      if (!matchPattern) {
        return null;
      }
      const normalizedRule = {
        id: rule.id,
        mode: rule.mode === 'direct' ? 'direct' : 'proxy',
        profileId: rule.profileId,
        rawPattern,
        matchPattern,
        isPathPattern,
        index
      };
      normalizedRule.priority = computeRulePriority(normalizedRule);
      return normalizedRule;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.index - b.index;
    });
}

function matchesPreparedRule(rule, urlLower, hostLower) {
  if (rule.isPathPattern) {
    return urlLower.includes(rule.matchPattern);
  }
  return matchesDomain(rule.matchPattern, hostLower);
}

function buildPacScript(profiles, rules, globalProfileId) {
  const profileMap = new Map();
  for (const profile of profiles) {
    profileMap.set(profile.id, profile);
  }
  const firstProfile = profileMap.size ? profileMap.values().next().value : null;
  const fallbackProfile = (globalProfileId && profileMap.get(globalProfileId)) || firstProfile || DEFAULT_PROFILE;
  const preparedRules = prepareDomainRules(rules);

  const lines = [];
  lines.push('function FindProxyForURL(url, host) {');
  lines.push('  var hostLower = host.toLowerCase();');
  lines.push('  var urlLower = url.toLowerCase();');
  lines.push('  function matchesDomain(pattern) {');
  lines.push('    if (hostLower === pattern) { return true; }');
  lines.push('    if (hostLower.length <= pattern.length) { return false; }');
  lines.push('    return hostLower.substr(hostLower.length - pattern.length - 1) === "." + pattern;');
  lines.push('  }');

  for (const rule of preparedRules) {
    const pattern = sanitizeForPac(rule.matchPattern);
    if (rule.isPathPattern) {
      if (rule.mode === 'direct') {
        lines.push(`  if (urlLower.indexOf("${pattern}") !== -1) { return "DIRECT"; }`);
        continue;
      }
      const profile = profileMap.get(rule.profileId) || fallbackProfile;
      if (!profile || !profile.host || !profile.port) {
        continue;
      }
      const scheme = (profile.scheme || 'http').toLowerCase();
      let proxyPrefix = 'PROXY';
      if (scheme === 'https') {
        proxyPrefix = 'HTTPS';
      } else if (scheme === 'socks5') {
        proxyPrefix = 'SOCKS5';
      } else if (scheme === 'socks' || scheme === 'socks4') {
        proxyPrefix = 'SOCKS';
      }
      const proxyLine = `${proxyPrefix} ${profile.host}:${profile.port}`;
      lines.push(`  if (urlLower.indexOf("${pattern}") !== -1) { return "${proxyLine}"; }`);
      continue;
    }

    if (rule.mode === 'direct') {
      lines.push(`  if (matchesDomain("${pattern}")) { return "DIRECT"; }`);
      continue;
    }

    const profile = profileMap.get(rule.profileId) || fallbackProfile;
    if (!profile || !profile.host || !profile.port) {
      continue;
    }
    const scheme = (profile.scheme || 'http').toLowerCase();
    let proxyPrefix = 'PROXY';
    if (scheme === 'https') {
      proxyPrefix = 'HTTPS';
    } else if (scheme === 'socks5') {
      proxyPrefix = 'SOCKS5';
    } else if (scheme === 'socks' || scheme === 'socks4') {
      proxyPrefix = 'SOCKS';
    }
    const proxyLine = `${proxyPrefix} ${profile.host}:${profile.port}`;
    lines.push(`  if (matchesDomain("${pattern}")) { return "${proxyLine}"; }`);
  }

  lines.push('  return "DIRECT";');
  lines.push('}');
  return lines.join('\n');
}

async function updateProxySettings(state = null) {
  const currentState = state ? normalizeState(state) : stateCache || (await loadStateCache());
  const { mode, proxyProfiles, domainRules, globalProfileId } = currentState;
  const profiles = proxyProfiles.length ? proxyProfiles : [cloneProfile(DEFAULT_PROFILE)];
  const activeProfile = profiles.find((profile) => profile.id === globalProfileId) || profiles[0];

  if (mode === 'proxy') {
    const config = buildProxyConfig(activeProfile);
    await chrome.proxy.settings.set({ value: config, scope: 'regular' });
  } else if (mode === 'auto') {
    const pacScript = buildPacScript(profiles, domainRules, globalProfileId);
    await chrome.proxy.settings.set({
      value: {
        mode: 'pac_script',
        pacScript: { data: pacScript }
      },
      scope: 'regular'
    });
  } else {
    await chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' });
  }
}

function matchesDomain(pattern, hostLower) {
  pattern = normalizeHostPattern(pattern);
  if (hostLower === pattern) {
    return true;
  }
  if (!pattern || !hostLower || hostLower.length <= pattern.length) {
    return false;
  }
  return hostLower.endsWith(`.${pattern}`);
}

function normalizeRulePatternValue(pattern) {
  return typeof pattern === 'string' ? pattern.trim().toLowerCase() : '';
}

function extractHostname(url = '') {
  if (!url || typeof url !== 'string') {
    return '';
  }
  try {
    const parsed = new URL(url);
    const blockedProtocols = new Set([
      'chrome:',
      'edge:',
      'about:',
      'devtools:',
      'file:',
      'chrome-extension:',
      'moz-extension:'
    ]);
    if (blockedProtocols.has(parsed.protocol)) {
      return '';
    }
    return (parsed.hostname || '').toLowerCase();
  } catch (error) {
    return '';
  }
}

async function addErrorDomain(url, error) {
  try {
    const { errorDomains = [] } = await chrome.storage.local.get('errorDomains');
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      hostname = url;
    }
    if (!hostname) return;
    const exists = errorDomains.find((item) => item.pattern === hostname);
    const now = Date.now();
    const entry = {
      id: exists ? exists.id : crypto.randomUUID(),
      pattern: hostname,
      lastError: error,
      timestamp: now
    };
    let updated;
    if (exists) {
      updated = errorDomains.map((item) => (item.pattern === hostname ? entry : item));
    } else {
      updated = [...errorDomains, entry];
    }
    await chrome.storage.local.set({ errorDomains: updated });
  } catch (err) {
    console.warn('Не удалось сохранить домен с ошибкой', err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await loadStateCache();
  await updateProxySettings(stateCache);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await loadStateCache();
  await updateProxySettings(stateCache);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const requiresUpdate = Boolean(
    changes.mode || changes.proxyProfiles || changes.domainRules || changes.globalProfileId
  );
  const maybeState = applyChangesToCache(changes);
  const triggerUpdate = (state) => {
    if (requiresUpdate) {
      updateProxySettings(state);
    }
  };
  if (maybeState instanceof Promise) {
    maybeState.then(triggerUpdate).catch((error) => console.warn('Не удалось обновить кэш настроек', error));
  } else {
    triggerUpdate(maybeState);
  }
});

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId !== -1 && details.type === 'main_frame') {
      addErrorDomain(details.url, details.error);
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'getStateSnapshot') {
    getStateSnapshot()
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => {
        console.warn('Не удалось получить снимок состояния', error);
        sendResponse({ success: false, message: 'Не удалось получить данные' });
      });
    return true;
  }
  if (request?.type === 'setMode') {
    handleSetMode(request.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.warn('Не удалось обновить режим', error);
        sendResponse({ success: false, message: 'Ошибка при сохранении режима' });
      });
    return true;
  }
  if (request?.type === 'clearErrors') {
    chrome.storage.local.set({ errorDomains: [] }).then(() => sendResponse({ success: true }));
    return true;
  }
  if (request?.type === 'applyErrorDomains') {
    handleApplyErrorDomains(request.payload).then((result) => sendResponse(result));
    return true;
  }
  if (request?.type === 'resolveUrlRule') {
    handleResolveUrlRule(request.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.warn('Не удалось определить правило для адреса', error);
        sendResponse({ success: false, message: 'Ошибка определения правила' });
      });
    return true;
  }
  if (request?.type === 'setDomainRule') {
    handleSetDomainRule(request.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.warn('Не удалось обновить правило домена', error);
        sendResponse({ success: false, message: 'Не удалось сохранить правило' });
      });
    return true;
  }
  return false;
});

async function handleApplyErrorDomains(payload) {
  const { domainIds = [], mode = 'proxy', profileId } = payload || {};
  if (!domainIds.length) {
    return { success: false, message: 'Не выбраны домены.' };
  }
  const store = await chrome.storage.local.get(['domainRules', 'errorDomains', 'proxyProfiles']);
  const rules = Array.isArray(store.domainRules) ? [...store.domainRules] : [];
  const errors = Array.isArray(store.errorDomains) ? store.errorDomains : [];
  const profiles = Array.isArray(store.proxyProfiles) && store.proxyProfiles.length ? store.proxyProfiles : [DEFAULT_PROFILE];
  const fallbackProfile = profiles.find((profile) => profile.id === profileId) || profiles[0] || DEFAULT_PROFILE;

  const selectedErrors = errors.filter((item) => domainIds.includes(item.id));
  for (const item of selectedErrors) {
    const existingIndex = rules.findIndex((rule) => rule.pattern === item.pattern);
    if (existingIndex >= 0) {
      const updatedRule = {
        ...rules[existingIndex],
        mode
      };
      if (mode === 'proxy') {
        updatedRule.profileId = rules[existingIndex].profileId || fallbackProfile.id;
      } else {
        delete updatedRule.profileId;
      }
      rules[existingIndex] = updatedRule;
    } else {
      const newRule = {
        id: crypto.randomUUID(),
        pattern: item.pattern,
        mode
      };
      if (mode === 'proxy') {
        newRule.profileId = fallbackProfile.id;
      }
      rules.push(newRule);
    }
  }
  const remainingErrors = errors.filter((item) => !domainIds.includes(item.id));
  await chrome.storage.local.set({ domainRules: rules, errorDomains: remainingErrors });
  return { success: true };
}

async function handleSetMode(payload) {
  const { mode, profileId } = payload || {};
  if (!['direct', 'proxy', 'auto'].includes(mode)) {
    return { success: false, message: 'Недопустимый режим' };
  }
  const nextState = await getStateSnapshot();
  const updates = { mode };
  if (mode === 'proxy' && profileId) {
    const profiles = Array.isArray(nextState.proxyProfiles) ? nextState.proxyProfiles : [];
    if (profiles.some((profile) => profile.id === profileId)) {
      updates.globalProfileId = profileId;
    }
  }
  await chrome.storage.local.set(updates);
  return { success: true };
}

async function handleResolveUrlRule(payload = {}) {
  const inputUrl = typeof payload.url === 'string' ? payload.url : '';
  const inputPattern = normalizeRulePatternValue(payload.pattern);
  const hostname = extractHostname(inputUrl) || inputPattern;
  if (!hostname) {
    return { success: false, message: 'Не удалось определить домен.' };
  }

  const state = await getStateSnapshot();
  const preparedRules = prepareDomainRules(state.domainRules);
  const hostLower = hostname.toLowerCase();
  const urlLower = inputUrl ? inputUrl.toLowerCase() : '';
  const matchedRule = preparedRules.find((rule) => matchesPreparedRule(rule, urlLower, hostLower));
  const explicitRule = state.domainRules.find(
    (rule) => normalizeRulePatternValue(rule.pattern) === hostLower
  );

  let mode = matchedRule?.mode || 'direct';
  let profileId = matchedRule?.mode === 'proxy' ? matchedRule.profileId : null;

  if (explicitRule) {
    mode = explicitRule.mode === 'proxy' ? 'proxy' : 'direct';
    profileId = explicitRule.mode === 'proxy' ? explicitRule.profileId : null;
  }

  const profiles = Array.isArray(state.proxyProfiles) ? state.proxyProfiles : [];
  if (mode === 'proxy') {
    if (!profiles.some((profile) => profile.id === profileId)) {
      const fallback =
        (state.globalProfileId && profiles.find((profile) => profile.id === state.globalProfileId)) ||
        profiles[0];
      profileId = fallback ? fallback.id : null;
    }
  }

  return {
    success: true,
    hostname,
    mode,
    profileId,
    explicit: Boolean(explicitRule)
  };
}

async function handleSetDomainRule(payload = {}) {
  const inputUrl = typeof payload.url === 'string' ? payload.url : '';
  const patternInput = normalizeRulePatternValue(payload.pattern) || extractHostname(inputUrl);
  if (!patternInput) {
    return { success: false, message: 'Не удалось определить домен.' };
  }

  const desiredMode = payload.mode === 'proxy' ? 'proxy' : 'direct';
  const state = await getStateSnapshot();
  const existingRules = Array.isArray(state.domainRules) ? state.domainRules : [];
  const profiles = Array.isArray(state.proxyProfiles) ? state.proxyProfiles : [];
  const normalizedPattern = normalizeRulePatternValue(patternInput);
  const existingRule = existingRules.find(
    (rule) => normalizeRulePatternValue(rule.pattern) === normalizedPattern
  );

  let targetProfileId = null;
  if (desiredMode === 'proxy') {
    const requestedProfile = payload.profileId;
    const profileMatch = profiles.find((profile) => profile.id === requestedProfile);
    if (profileMatch) {
      targetProfileId = profileMatch.id;
    } else if (state.globalProfileId) {
      const fallbackProfile = profiles.find((profile) => profile.id === state.globalProfileId);
      if (fallbackProfile) {
        targetProfileId = fallbackProfile.id;
      }
    }
    if (!targetProfileId && profiles.length) {
      targetProfileId = profiles[0].id;
    }
    if (!targetProfileId) {
      return { success: false, message: 'Нет доступного профиля прокси.' };
    }
  }

  let updatedRule;
  if (existingRule) {
    updatedRule = {
      ...existingRule,
      pattern: normalizedPattern,
      mode: desiredMode
    };
  } else {
    updatedRule = {
      id: crypto.randomUUID(),
      pattern: normalizedPattern,
      mode: desiredMode
    };
  }

  if (desiredMode === 'proxy') {
    updatedRule.profileId = targetProfileId;
  } else {
    delete updatedRule.profileId;
  }

  const nextRules = existingRule
    ? existingRules.map((rule) => (rule.id === existingRule.id ? updatedRule : rule))
    : [...existingRules, updatedRule];

  await chrome.storage.local.set({ domainRules: nextRules });
  return { success: true };
}

ensureDefaults()
  .then(loadStateCache)
  .then((state) => updateProxySettings(state))
  .catch((error) => console.warn('Не удалось инициализировать настройки прокси', error));
