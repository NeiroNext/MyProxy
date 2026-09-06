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
  globalProfileId: DEFAULT_PROFILE_ID,
  autoModeFallback: 'direct'
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
  const pattern = typeof entry.pattern === 'string' ? entry.pattern.toLowerCase() : '';
  const cloned = {
    id: entry.id || crypto.randomUUID(),
    pattern,
    lastError: entry.lastError || '',
    resourceType: entry.resourceType || '',
    count: Number.isFinite(Number(entry.count)) && Number(entry.count) > 0 ? Number(entry.count) : 1,
    timestamp: entry.timestamp || Date.now()
  };
  if (typeof entry.tabId === 'number') {
    cloned.tabId = entry.tabId;
  }
  return cloned;
}

function normalizeState(raw = {}) {
  const mode = ['proxy', 'auto', 'auto_plus'].includes(raw.mode) ? raw.mode : 'direct';
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
  const autoModeFallback = raw.autoModeFallback === 'proxy' ? 'proxy' : 'direct';
  return {
    mode,
    proxyProfiles,
    domainRules,
    errorDomains,
    globalProfileId,
    autoModeFallback
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
  const currentAutoFallback = updates.autoModeFallback || data.autoModeFallback;
  if (currentAutoFallback !== 'proxy' && currentAutoFallback !== 'direct') {
    updates.autoModeFallback = 'direct';
  }
  if (Object.keys(updates).length) {
    await chrome.storage.local.set(updates);
  }
}

function parsePort(port) {
  const parsed = parseInt(port, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProfileUsable(profile) {
  return Boolean(profile && String(profile.host || '').trim() && String(profile.port || '').trim());
}

function profileLabel(profile, fallbackText = 'без названия') {
  if (!profile) {
    return fallbackText;
  }
  return String(profile.name || '').trim() || String(profile.host || '').trim() || fallbackText;
}

function buildProxyConfig(profile) {
  if (!isProfileUsable(profile)) {
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

function getProxyInstruction(profile) {
  if (!isProfileUsable(profile)) {
    return null;
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
  return `${proxyPrefix} ${profile.host}:${profile.port}`;
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

function stripScheme(value) {
  const schemeIndex = value.indexOf('://');
  return schemeIndex === -1 ? value : value.slice(schemeIndex + 3);
}

function splitPathPattern(rawPattern) {
  const withoutScheme = stripScheme(rawPattern);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) {
    return { hostPattern: normalizeHostPattern(withoutScheme), pathPattern: '' };
  }
  const hostPart = withoutScheme.slice(0, slashIndex);
  const pathPart = withoutScheme.slice(slashIndex);
  return {
    hostPattern: normalizeHostPattern(hostPart),
    pathPattern: pathPart || '/'
  };
}

function extractPathFromUrl(urlLower) {
  const withoutScheme = stripScheme(urlLower);
  const slashIndex = withoutScheme.indexOf('/');
  return slashIndex === -1 ? '/' : withoutScheme.slice(slashIndex);
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
      const isPathPattern = stripScheme(rawPattern).includes('/');
      let hostPattern = '';
      let pathPattern = '';
      let matchPattern;
      if (isPathPattern) {
        ({ hostPattern, pathPattern } = splitPathPattern(rawPattern));
        if (!pathPattern) {
          return null;
        }
        matchPattern = `${hostPattern}${pathPattern}`;
      } else {
        matchPattern = normalizeHostPattern(rawPattern);
        if (!matchPattern) {
          return null;
        }
      }
      const normalizedRule = {
        id: rule.id,
        mode: rule.mode === 'direct' ? 'direct' : 'proxy',
        profileId: rule.profileId,
        rawPattern,
        matchPattern,
        hostPattern,
        pathPattern,
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
  if (!rule.isPathPattern) {
    return matchesDomain(rule.matchPattern, hostLower);
  }
  if (rule.hostPattern && !matchesDomain(rule.hostPattern, hostLower)) {
    return false;
  }
  return extractPathFromUrl(urlLower).startsWith(rule.pathPattern);
}

function findMatchedRule(preparedRules, urlLower, hostLower) {
  const pathRule = preparedRules.find(
    (rule) => rule.isPathPattern && matchesPreparedRule(rule, urlLower, hostLower)
  );
  if (pathRule) {
    return pathRule;
  }
  return preparedRules.find(
    (rule) => !rule.isPathPattern && matchesPreparedRule(rule, urlLower, hostLower)
  );
}

function buildPacScript(profiles, rules, globalProfileId, autoModeFallback = 'direct') {
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
  lines.push('  function pathOf(value) {');
  lines.push('    var schemeIndex = value.indexOf("://");');
  lines.push('    var rest = schemeIndex === -1 ? value : value.substring(schemeIndex + 3);');
  lines.push('    var slashIndex = rest.indexOf("/");');
  lines.push('    return slashIndex === -1 ? "/" : rest.substring(slashIndex);');
  lines.push('  }');

  const orderedRules = [
    ...preparedRules.filter((rule) => rule.isPathPattern),
    ...preparedRules.filter((rule) => !rule.isPathPattern)
  ];

  for (const rule of orderedRules) {
    let condition;
    if (rule.isPathPattern) {
      const pathCheck = `pathOf(urlLower).indexOf("${sanitizeForPac(rule.pathPattern)}") === 0`;
      condition = rule.hostPattern
        ? `matchesDomain("${sanitizeForPac(rule.hostPattern)}") && ${pathCheck}`
        : pathCheck;
    } else {
      condition = `matchesDomain("${sanitizeForPac(rule.matchPattern)}")`;
    }

    if (rule.mode === 'direct') {
      lines.push(`  if (${condition}) { return "DIRECT"; }`);
      continue;
    }

    const profile = profileMap.get(rule.profileId) || fallbackProfile;
    const proxyLine = getProxyInstruction(profile);
    if (!proxyLine) {
      continue;
    }
    lines.push(`  if (${condition}) { return "${proxyLine}"; }`);
  }

  let defaultInstruction = 'DIRECT';
  if (autoModeFallback === 'proxy') {
    const fallbackInstruction = getProxyInstruction(fallbackProfile);
    if (fallbackInstruction) {
      defaultInstruction = fallbackInstruction;
    }
  }
  lines.push(`  return "${defaultInstruction}";`);
  lines.push('}');
  return lines.join('\n');
}

function collectConfigWarnings(mode, profiles, domainRules, activeProfile, effectiveFallback) {
  const warnings = [];
  if (mode === 'proxy' && !isProfileUsable(activeProfile)) {
    warnings.push(
      `Профиль «${profileLabel(activeProfile)}» не заполнен: не указан хост или порт. Весь трафик идёт напрямую.`
    );
  }
  if ((mode === 'auto' || mode === 'auto_plus') && effectiveFallback === 'proxy' && !isProfileUsable(activeProfile)) {
    warnings.push(
      `Профиль по умолчанию «${profileLabel(activeProfile)}» не заполнен: не указан хост или порт. ` +
        'Сайты вне списка идут напрямую, а не через прокси.'
    );
  }
  if (mode === 'auto' || mode === 'auto_plus') {
    const broken = new Set();
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    for (const rule of domainRules) {
      if (rule.mode !== 'proxy') {
        continue;
      }
      const profile = profileMap.get(rule.profileId) || activeProfile;
      if (!isProfileUsable(profile)) {
        broken.add((rule.pattern || '').trim() || '(пустое правило)');
      }
    }
    if (broken.size) {
      const shown = Array.from(broken).slice(0, 3).join(', ');
      const tail = broken.size > 3 ? ` и ещё ${broken.size - 3}` : '';
      warnings.push(`Правила без рабочего профиля не применяются: ${shown}${tail}.`);
    }
  }
  return warnings;
}

async function updateProxySettings(state = null) {
  const currentState = state ? normalizeState(state) : stateCache || (await loadStateCache());
  const { mode, proxyProfiles, domainRules, globalProfileId, autoModeFallback } = currentState;
  const profiles = proxyProfiles.length ? proxyProfiles : [cloneProfile(DEFAULT_PROFILE)];
  const activeProfile = profiles.find((profile) => profile.id === globalProfileId) || profiles[0];
  let effectiveFallback = 'direct';

  if (mode === 'proxy') {
    const config = buildProxyConfig(activeProfile);
    await chrome.proxy.settings.set({ value: config, scope: 'regular' });
  } else if (mode === 'auto' || mode === 'auto_plus') {
    effectiveFallback = mode === 'auto_plus' ? 'proxy' : autoModeFallback;
    const pacScript = buildPacScript(profiles, domainRules, globalProfileId, effectiveFallback);
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

  const warnings = collectConfigWarnings(mode, profiles, domainRules, activeProfile, effectiveFallback);
  const { configWarnings: previous = [] } = await chrome.storage.local.get('configWarnings');
  const changed =
    previous.length !== warnings.length || warnings.some((item, index) => item !== previous[index]);
  if (changed) {
    await chrome.storage.local.set({ configWarnings: warnings });
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

const MAX_ERROR_ENTRIES = 300;

// Записи идут по очереди: параллельные запросы иначе перетирали друг друга,
// потому что каждый читал storage целиком и клал обратно свою версию.
let errorWriteChain = Promise.resolve();

function queueErrorWrite(task) {
  errorWriteChain = errorWriteChain.then(task, task);
  return errorWriteChain.catch((error) => console.warn('Не удалось обновить список ошибок', error));
}

function sameErrorEntry(item, hostname, tabId) {
  if ((item.pattern || '').toLowerCase() !== hostname) {
    return false;
  }
  return tabId === null ? typeof item.tabId !== 'number' : item.tabId === tabId;
}

async function addErrorDomain(tabId, url, error, resourceType = '') {
  const hostname = extractHostname(url);
  if (!hostname) {
    return;
  }
  const normalizedTabId = typeof tabId === 'number' && tabId >= 0 ? tabId : null;
  const reason = typeof error === 'string' && error.trim() ? error.trim() : '';
  await queueErrorWrite(async () => {
    const { errorDomains = [] } = await chrome.storage.local.get('errorDomains');
    const list = Array.isArray(errorDomains) ? [...errorDomains] : [];
    const index = list.findIndex((item) => sameErrorEntry(item, hostname, normalizedTabId));
    const now = Date.now();
    if (index >= 0) {
      const previous = list[index];
      list[index] = {
        ...previous,
        lastError: reason || previous.lastError || '',
        resourceType: resourceType || previous.resourceType || '',
        count: (Number(previous.count) || 1) + 1,
        timestamp: now
      };
    } else {
      const entry = {
        id: crypto.randomUUID(),
        pattern: hostname,
        lastError: reason,
        resourceType: resourceType || '',
        count: 1,
        timestamp: now
      };
      if (normalizedTabId !== null) {
        entry.tabId = normalizedTabId;
      }
      list.push(entry);
    }
    const trimmed =
      list.length > MAX_ERROR_ENTRIES
        ? list.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ERROR_ENTRIES)
        : list;
    await chrome.storage.local.set({ errorDomains: trimmed });
  });
}

// Список должен показывать ошибки текущей загрузки, а не копиться вечно.
async function clearTabErrors(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }
  await queueErrorWrite(async () => {
    const { errorDomains = [] } = await chrome.storage.local.get('errorDomains');
    if (!Array.isArray(errorDomains) || !errorDomains.length) {
      return;
    }
    const remaining = errorDomains.filter((item) => item.tabId !== tabId);
    if (remaining.length !== errorDomains.length) {
      await chrome.storage.local.set({ errorDomains: remaining });
    }
  });
}

function formatHttpError(details) {
  const code = typeof details?.statusCode === 'number' ? details.statusCode : null;
  if (!code || code < 400) {
    return '';
  }
  const line = typeof details.statusLine === 'string' ? details.statusLine.trim() : '';
  if (line) {
    const match = line.match(/\s\d+\s(.+)$/);
    if (match && match[1]) {
      return `HTTP ${code} – ${match[1]}`;
    }
  }
  return `HTTP ${code}`;
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
    changes.mode ||
    changes.proxyProfiles ||
    changes.domainRules ||
    changes.globalProfileId ||
    changes.autoModeFallback
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

// Раньше сетевые ошибки писались только для main_frame, поэтому упавшие
// XHR/fetch/картинки были видны лишь в консоли разработчика.
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId === -1) {
      return;
    }
    addErrorDomain(details.tabId, details.url, details.error, details.type);
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId === -1 || typeof details.statusCode !== 'number' || details.statusCode < 400) {
      return;
    }
    addErrorDomain(details.tabId, details.url, formatHttpError(details), details.type);
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearTabErrors(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabErrors(tabId);
});

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
  if (request?.type === 'resolveErrorDomains') {
    handleResolveErrorDomains(request.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.warn('Не удалось определить прокси для доменов', error);
        sendResponse({ success: false, results: {} });
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
  if (!['direct', 'proxy', 'auto', 'auto_plus'].includes(mode)) {
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
  const matchedRule = findMatchedRule(preparedRules, urlLower, hostLower);

  const profiles = Array.isArray(state.proxyProfiles) ? state.proxyProfiles : [];
  const fallbackProfile =
    (state.globalProfileId && profiles.find((profile) => profile.id === state.globalProfileId)) ||
    profiles[0] ||
    null;

  let mode = 'direct';
  let profileId = null;

  if (matchedRule) {
    mode = matchedRule.mode;
    profileId = matchedRule.mode === 'proxy' ? matchedRule.profileId : null;
  } else if (state.mode === 'proxy') {
    mode = 'proxy';
    profileId = state.globalProfileId;
  } else if (state.mode === 'auto_plus') {
    mode = 'proxy';
    profileId = state.globalProfileId;
  } else if (state.mode === 'auto' && state.autoModeFallback === 'proxy') {
    mode = 'proxy';
    profileId = state.globalProfileId;
  }

  if (mode === 'proxy') {
    const resolvedProfile =
      (profileId && profiles.find((profile) => profile.id === profileId)) || fallbackProfile;
    if (resolvedProfile && resolvedProfile.host && resolvedProfile.port) {
      profileId = resolvedProfile.id;
    } else {
      mode = 'direct';
      profileId = null;
    }
  }

  return {
    success: true,
    hostname,
    mode,
    profileId,
    explicit: Boolean(matchedRule)
  };
}

// Для списка проблемных доменов: что для каждого действует прямо сейчас.
async function handleResolveErrorDomains(payload = {}) {
  const patterns = Array.isArray(payload.patterns) ? payload.patterns : [];
  const state = await getStateSnapshot();
  const preparedRules = prepareDomainRules(state.domainRules);
  const profiles = Array.isArray(state.proxyProfiles) ? state.proxyProfiles : [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const globalIsProxy =
    state.mode === 'proxy' ||
    state.mode === 'auto_plus' ||
    (state.mode === 'auto' && state.autoModeFallback === 'proxy');

  const results = {};
  for (const raw of patterns) {
    const hostLower = String(raw || '').trim().toLowerCase();
    if (!hostLower || results[hostLower]) {
      continue;
    }
    const matchedRule = findMatchedRule(preparedRules, `http://${hostLower}/`, hostLower);
    let mode = 'direct';
    let profileId = null;
    if (matchedRule) {
      mode = matchedRule.mode;
      profileId = matchedRule.mode === 'proxy' ? matchedRule.profileId : null;
    } else if (globalIsProxy) {
      mode = 'proxy';
      profileId = state.globalProfileId;
    }

    let profileName = '';
    if (mode === 'proxy') {
      const resolved =
        (profileId && profileMap.get(profileId)) ||
        profileMap.get(state.globalProfileId) ||
        profiles[0];
      if (isProfileUsable(resolved)) {
        profileId = resolved.id;
        profileName = profileLabel(resolved);
      } else {
        mode = 'direct';
        profileId = null;
      }
    }

    results[hostLower] = { mode, profileId, profileName, explicit: Boolean(matchedRule) };
  }
  return { success: true, results };
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
