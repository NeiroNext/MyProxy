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

let currentErrors = [];
let currentProfiles = [];
let currentGlobalProfileId = '';
let currentMode = 'direct';

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.mode || changes.errorDomains || changes.proxyProfiles || changes.globalProfileId) {
    loadState();
  }
});

loadState();
