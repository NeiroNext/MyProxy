const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
const errorsButton = document.getElementById('errorsButton');
const settingsButton = document.getElementById('settingsButton');
const errorsPanel = document.getElementById('errorsPanel');
const errorList = document.getElementById('errorList');
const errorAction = document.getElementById('errorAction');
const errorProfileContainer = document.getElementById('errorProfileContainer');
const errorProfile = document.getElementById('errorProfile');
const applyErrors = document.getElementById('applyErrors');
const statusMessage = document.getElementById('statusMessage');
const errorStatus = document.getElementById('errorStatus');
const currentSiteSection = document.getElementById('currentSiteSection');
const currentSiteLabel = document.getElementById('currentSiteLabel');
const currentSiteSelect = document.getElementById('currentSiteSelect');
const currentSiteStatus = document.getElementById('currentSiteStatus');

let currentErrors = [];
let currentProfiles = [];
let currentGlobalProfileId = '';
let currentMode = 'direct';
let currentSiteDetails = null;
let isUpdatingSiteSelect = false;

async function loadState() {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'getStateSnapshot' });
  } catch (error) {
    response = null;
  }
  let mode = 'direct';
  let errorDomains = [];
  let proxyProfiles = [];
  let globalProfileId;
  if (response?.success && response.state) {
    ({ mode = 'direct', errorDomains = [], proxyProfiles = [], globalProfileId } = response.state);
  } else {
    const fallback = await chrome.storage.local.get(['mode', 'errorDomains', 'proxyProfiles', 'globalProfileId']);
    mode = fallback.mode || 'direct';
    errorDomains = Array.isArray(fallback.errorDomains) ? fallback.errorDomains : [];
    proxyProfiles = Array.isArray(fallback.proxyProfiles) ? fallback.proxyProfiles : [];
    globalProfileId = fallback.globalProfileId;
  }
  currentErrors = errorDomains;
  currentProfiles = proxyProfiles;
  currentGlobalProfileId = globalProfileId;
  currentMode = mode;
  const activeRadio = modeRadios.find((radio) => radio.value === mode);
  if (activeRadio) {
    activeRadio.checked = true;
  }
  renderErrors();
  updateStatus(mode, proxyProfiles, globalProfileId);
  populateErrorProfiles(proxyProfiles, globalProfileId);
  toggleErrorProfileField();
  await refreshCurrentSiteSelector();
}

function updateStatus(mode, profiles, globalProfileId) {
  let text = '';
  if (mode === 'direct') {
    text = 'Режим: без прокси';
  } else if (mode === 'proxy') {
    const profile = profiles?.find((item) => item.id === globalProfileId) || profiles?.[0];
    text = `Режим: все через прокси${profile?.name ? ` (${profile.name})` : ''}`;
  } else {
    text = 'Режим: автопрокси';
  }
  statusMessage.textContent = text;
}

function renderErrors() {
  errorList.innerHTML = '';
  errorStatus.textContent = '';
  if (!currentErrors.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Ошибок подключения пока нет.';
    errorList.appendChild(empty);
    applyErrors.disabled = true;
    return;
  }

  applyErrors.disabled = false;

  currentErrors
    .sort((a, b) => b.timestamp - a.timestamp)
    .forEach((item) => {
      const container = document.createElement('div');
      container.className = 'error-item';

      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.id;
      label.appendChild(checkbox);

      const text = document.createElement('span');
      text.textContent = item.pattern;
      label.appendChild(text);

      container.appendChild(label);

      const hint = document.createElement('small');
      hint.textContent = item.lastError || '';
      container.appendChild(hint);

      errorList.appendChild(container);
    });
}

function populateErrorProfiles(profiles, globalProfileId) {
  if (!errorProfile) {
    return;
  }
  const previousValue = errorProfile.value;
  errorProfile.innerHTML = '';
  if (!Array.isArray(profiles) || !profiles.length) {
    errorProfileContainer?.classList.add('hidden');
    return;
  }
  profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || 'Профиль';
    errorProfile.appendChild(option);
  });
  const preferredId =
    (previousValue && profiles.some((profile) => profile.id === previousValue))
      ? previousValue
      : profiles.find((profile) => profile.id === globalProfileId)?.id || profiles[0].id;
  errorProfile.value = preferredId;
}

function toggleErrorProfileField() {
  if (!errorProfileContainer) {
    return;
  }
  const isProxy = errorAction.value === 'proxy';
  if (isProxy && errorProfile.options.length) {
    errorProfileContainer.classList.remove('hidden');
  } else {
    errorProfileContainer.classList.add('hidden');
  }
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

function buildCurrentSiteOptions() {
  const options = [
    { value: 'direct', label: 'Без прокси' }
  ];
  if (Array.isArray(currentProfiles)) {
    currentProfiles.forEach((profile) => {
      options.push({
        value: `proxy:${profile.id}`,
        label: profile.name || profile.host || 'Профиль'
      });
    });
  }
  return options;
}

async function refreshCurrentSiteSelector() {
  if (!currentSiteSection || !currentSiteSelect) {
    return;
  }
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (error) {
    tab = null;
  }
  const url = tab?.url || '';
  const hostname = extractHostname(url);
  if (!hostname) {
    currentSiteDetails = null;
    currentSiteSection.classList.add('hidden');
    if (currentSiteStatus) {
      currentSiteStatus.textContent = 'Откройте сайт, чтобы выбрать правило.';
    }
    return;
  }

  currentSiteSection.classList.remove('hidden');
  currentSiteDetails = { hostname, url };
  if (currentSiteLabel) {
    currentSiteLabel.textContent = `Текущий сайт: ${hostname}`;
  }

  const options = buildCurrentSiteOptions();
  isUpdatingSiteSelect = true;
  try {
    currentSiteSelect.innerHTML = '';
    options.forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      currentSiteSelect.appendChild(option);
    });
    currentSiteSelect.disabled = true;
    if (currentSiteStatus) {
      currentSiteStatus.textContent = 'Обновление...';
    }

    let response = null;
    try {
      response = await chrome.runtime.sendMessage({ type: 'resolveUrlRule', payload: { url } });
    } catch (error) {
      response = null;
    }

    let selectedValue = 'direct';
    if (response?.success) {
      if (response.mode === 'proxy' && Array.isArray(currentProfiles) && currentProfiles.length) {
        const matchedProfile = currentProfiles.find((profile) => profile.id === response.profileId);
        const profileToUse = matchedProfile || currentProfiles[0];
        if (profileToUse) {
          selectedValue = `proxy:${profileToUse.id}`;
        }
      }
      if (response.mode !== 'proxy') {
        selectedValue = 'direct';
      }
      if (currentSiteStatus) {
        if (response.mode === 'proxy') {
          currentSiteStatus.textContent = response.explicit
            ? 'Используется отдельное правило для сайта.'
            : 'Сайт использует общее правило прокси.';
        } else {
          currentSiteStatus.textContent = 'Сайт открыт без прокси.';
        }
      }
    } else if (currentSiteStatus) {
      currentSiteStatus.textContent = response?.message || 'Не удалось определить правило.';
    }

    if (!Array.from(currentSiteSelect.options).some((option) => option.value === selectedValue)) {
      selectedValue = 'direct';
    }

    currentSiteSelect.value = selectedValue;
  } finally {
    currentSiteSelect.disabled = false;
    isUpdatingSiteSelect = false;
  }
}

async function applyCurrentSiteSelection(value) {
  if (!currentSiteDetails || !value) {
    return;
  }
  const mode = value === 'direct' ? 'direct' : 'proxy';
  const payload = {
    url: currentSiteDetails.url,
    pattern: currentSiteDetails.hostname,
    mode
  };
  if (mode === 'proxy') {
    const [, profileId] = value.split(':');
    if (!profileId) {
      if (currentSiteStatus) {
        currentSiteStatus.textContent = 'Выберите профиль прокси.';
      }
      return;
    }
    payload.profileId = profileId;
  }

  if (currentSiteStatus) {
    currentSiteStatus.textContent = 'Сохранение...';
  }
  currentSiteSelect.disabled = true;

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'setDomainRule', payload });
  } catch (error) {
    response = null;
  }

  if (response?.success) {
    if (currentSiteStatus) {
      currentSiteStatus.textContent = 'Правило обновлено.';
    }
    await refreshCurrentSiteSelector();
  } else {
    if (currentSiteStatus) {
      currentSiteStatus.textContent = response?.message || 'Не удалось сохранить правило.';
    }
    currentSiteSelect.disabled = false;
  }
}

modeRadios.forEach((radio) => {
  radio.addEventListener('change', async (event) => {
    if (!event.target.checked) return;
    const desiredMode = event.target.value;
    const result = await chrome.runtime.sendMessage({
      type: 'setMode',
      payload: { mode: desiredMode }
    });
    if (!result?.success) {
      errorStatus.textContent = result?.message || 'Не удалось сохранить режим.';
      return;
    }
    currentMode = desiredMode;
    errorStatus.textContent = '';
    updateStatus(currentMode, currentProfiles, currentGlobalProfileId);
  });
});

errorsButton.addEventListener('click', () => {
  errorsPanel.classList.toggle('hidden');
});

errorAction.addEventListener('change', () => {
  toggleErrorProfileField();
});

settingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

applyErrors.addEventListener('click', async () => {
  const checked = Array.from(errorList.querySelectorAll('input[type="checkbox"]:checked'));
  if (!checked.length) {
    errorStatus.textContent = 'Выберите хотя бы один домен.';
    return;
  }
  errorStatus.textContent = 'Сохранение...';
  const domainIds = checked.map((item) => item.value);
  const mode = errorAction.value === 'proxy' ? 'proxy' : 'direct';
  const payload = { domainIds, mode };
  if (mode === 'proxy') {
    if (!errorProfile.value) {
      errorStatus.textContent = 'Выберите профиль прокси.';
      return;
    }
    payload.profileId = errorProfile.value;
  }
  const response = await chrome.runtime.sendMessage({
    type: 'applyErrorDomains',
    payload
  });
  if (response?.success) {
    await loadState();
    errorStatus.textContent = 'Обновлено.';
  } else {
    errorStatus.textContent = response?.message || 'Не удалось применить изменения.';
  }
});

if (currentSiteSelect) {
  currentSiteSelect.addEventListener('change', (event) => {
    if (isUpdatingSiteSelect) {
      return;
    }
    applyCurrentSiteSelection(event.target.value);
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.mode || changes.errorDomains || changes.proxyProfiles || changes.globalProfileId) {
    loadState();
  }
});

loadState();
