const addProfileBtn = document.getElementById('addProfile');
const profilesContainer = document.getElementById('profilesContainer');
const addDomainBtn = document.getElementById('addDomain');
const domainList = document.getElementById('domainList');
const domainTable = document.getElementById('domainTable');
const autoFallbackSelect = document.getElementById('autoFallback');
const toggleBulkBtn = document.getElementById('toggleBulkSelection');
const bulkActions = document.getElementById('bulkActions');
const bulkModeSelect = document.getElementById('bulkModeSelect');
const bulkProfileSelect = document.getElementById('bulkProfileSelect');
const bulkProfileWrapper = document.getElementById('bulkProfileWrapper');
const bulkApplyBtn = document.getElementById('bulkApply');
const bulkDeleteBtn = document.getElementById('bulkDelete');
const bulkSelectedCount = document.getElementById('bulkSelectedCount');
const bulkClearBtn = document.getElementById('bulkClear');
const exportBtn = document.getElementById('exportData');
const importInput = document.getElementById('importFile');
const statusBanner = document.getElementById('statusBanner');

let statusTimer;
let state = {
  proxyProfiles: [],
  domainRules: [],
  globalProfileId: 'profile-1',
  autoModeFallback: 'direct'
};

let isBulkMode = false;
const selectedDomainIds = new Set();

function showStatus(message, type = 'success') {
  if (!statusBanner) return;
  statusBanner.textContent = message;
  statusBanner.dataset.type = type === 'error' ? 'error' : 'success';
  statusBanner.hidden = !message;
  clearTimeout(statusTimer);
  if (message) {
    statusTimer = setTimeout(() => {
      statusBanner.hidden = true;
    }, 4000);
  }
}

async function loadState() {
  const data = await chrome.storage.local.get([
    'proxyProfiles',
    'domainRules',
    'globalProfileId',
    'autoModeFallback'
  ]);
  state.proxyProfiles = Array.isArray(data.proxyProfiles) && data.proxyProfiles.length ? data.proxyProfiles : [createDefaultProfile()];
  state.domainRules = Array.isArray(data.domainRules) ? data.domainRules : [];
  state.globalProfileId = data.globalProfileId || state.proxyProfiles[0].id;
  state.autoModeFallback = data.autoModeFallback === 'proxy' ? 'proxy' : 'direct';
  ensureValidState();
  renderProfiles();
  renderDomains();
  updateAutoFallbackControl();
  updateBulkUI();
}

function ensureValidState() {
  state.autoModeFallback = state.autoModeFallback === 'proxy' ? 'proxy' : 'direct';
  if (!state.proxyProfiles.length) {
    state.proxyProfiles = [createDefaultProfile()];
  }
  if (!state.proxyProfiles.find((profile) => profile.id === state.globalProfileId)) {
    state.globalProfileId = state.proxyProfiles[0].id;
  }
  state.domainRules = state.domainRules.map((rule) => {
    const next = {
      id: rule.id || crypto.randomUUID(),
      pattern: rule.pattern || '',
      mode: rule.mode === 'direct' ? 'direct' : 'proxy',
      profileId: rule.profileId
    };
    if (next.mode === 'proxy' && !state.proxyProfiles.find((profile) => profile.id === next.profileId)) {
      next.profileId = state.globalProfileId;
    }
    if (next.mode === 'direct') {
      delete next.profileId;
    }
    return next;
  });
}

function createDefaultProfile() {
  return {
    id: crypto.randomUUID(),
    name: 'Новый профиль',
    scheme: 'http',
    host: '',
    port: '',
    username: '',
    password: ''
  };
}

function createProfileCard(profile, index) {
  const card = document.createElement('div');
  card.className = 'profile-card';

  const header = document.createElement('div');
  header.className = 'profile-card-header';

  const title = document.createElement('h3');
  title.textContent = profile.name || `Профиль ${index + 1}`;
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'profile-actions';

  const defaultLabel = document.createElement('label');
  defaultLabel.style.display = 'flex';
  defaultLabel.style.alignItems = 'center';
  defaultLabel.style.gap = '6px';
  const defaultRadio = document.createElement('input');
  defaultRadio.type = 'radio';
  defaultRadio.name = 'defaultProfile';
  defaultRadio.checked = state.globalProfileId === profile.id;
  defaultRadio.addEventListener('change', () => {
    state.globalProfileId = profile.id;
    saveProfiles();
    showStatus(`Профиль «${profile.name || `Профиль ${index + 1}`}» выбран по умолчанию.`);
  });
  defaultLabel.appendChild(defaultRadio);
  const defaultText = document.createElement('span');
  defaultText.textContent = 'По умолчанию';
  defaultLabel.appendChild(defaultText);
  actions.appendChild(defaultLabel);

  if (state.proxyProfiles.length > 1) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', () => removeProfile(profile.id));
    actions.appendChild(deleteBtn);
  }

  header.appendChild(actions);
  card.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'profile-grid';

  const nameField = createLabeledInput('Название', profile.name, 'text', (value) => {
    profile.name = value;
    title.textContent = value || `Профиль ${index + 1}`;
    saveProfiles();
  });
  grid.appendChild(nameField);

  const schemeField = document.createElement('label');
  schemeField.textContent = 'Протокол';
  const schemeSelect = document.createElement('select');
  ['http', 'https', 'socks4', 'socks5'].forEach((scheme) => {
    const option = document.createElement('option');
    option.value = scheme;
    option.textContent = scheme.toUpperCase();
    if ((profile.scheme || 'http').toLowerCase() === scheme) {
      option.selected = true;
    }
    schemeSelect.appendChild(option);
  });
  schemeSelect.addEventListener('change', (event) => {
    profile.scheme = event.target.value;
    saveProfiles();
  });
  schemeField.appendChild(schemeSelect);
  grid.appendChild(schemeField);

  const hostField = createLabeledInput('Хост', profile.host, 'text', (value) => {
    profile.host = value;
    saveProfiles();
  });
  grid.appendChild(hostField);

  const portField = createLabeledInput('Порт', profile.port, 'number', (value) => {
    profile.port = value;
    saveProfiles();
  });
  grid.appendChild(portField);

  const userField = createLabeledInput('Логин', profile.username, 'text', (value) => {
    profile.username = value;
    saveProfiles();
  });
  grid.appendChild(userField);

  const passwordField = createLabeledInput('Пароль', profile.password, 'password', (value) => {
    profile.password = value;
    saveProfiles();
  });
  grid.appendChild(passwordField);

  card.appendChild(grid);
  return card;
}

function createLabeledInput(labelText, value, type, onChange) {
  const wrapper = document.createElement('label');
  wrapper.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  if (type === 'number') {
    input.min = '0';
    input.step = '1';
  }
  input.value = value || '';
  input.addEventListener('change', (event) => onChange(event.target.value));
  wrapper.appendChild(input);
  return wrapper;
}

function renderProfiles() {
  profilesContainer.innerHTML = '';
  state.proxyProfiles.forEach((profile, index) => {
    profilesContainer.appendChild(createProfileCard(profile, index));
  });
  populateBulkProfiles();
}

function updateAutoFallbackControl() {
  if (!autoFallbackSelect) {
    return;
  }
  autoFallbackSelect.value = state.autoModeFallback;
}

function populateBulkProfiles() {
  if (!bulkProfileSelect) {
    return;
  }
  const previousValue = bulkProfileSelect.value;
  bulkProfileSelect.innerHTML = '';
  if (!state.proxyProfiles.length) {
    bulkProfileSelect.disabled = true;
    updateBulkModeVisibility();
    return;
  }
  state.proxyProfiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || profile.host || 'Безымянный профиль';
    bulkProfileSelect.appendChild(option);
  });
  const fallbackId = state.proxyProfiles.some((profile) => profile.id === previousValue)
    ? previousValue
    : state.globalProfileId;
  bulkProfileSelect.value = fallbackId || state.proxyProfiles[0].id;
  bulkProfileSelect.disabled = false;
  updateBulkModeVisibility();
}

function updateBulkModeVisibility() {
  if (!bulkProfileWrapper) {
    return;
  }
  const isProxyMode = bulkModeSelect?.value === 'proxy';
  bulkProfileWrapper.style.display = isProxyMode ? '' : 'none';
  if (bulkProfileSelect) {
    bulkProfileSelect.disabled = !isProxyMode || !bulkProfileSelect.options.length;
  }
}

function updateBulkUI() {
  const hasSelection = selectedDomainIds.size > 0;
  if (bulkActions) {
    bulkActions.hidden = !isBulkMode;
  }
  if (domainTable) {
    domainTable.classList.toggle('bulk-enabled', isBulkMode);
  }
  if (toggleBulkBtn) {
    toggleBulkBtn.textContent = isBulkMode ? 'Готово' : 'Выбрать несколько';
  }
  if (bulkSelectedCount) {
    bulkSelectedCount.textContent = `Выделено: ${selectedDomainIds.size}`;
  }
  if (bulkApplyBtn) {
    const needsProfile = bulkModeSelect?.value === 'proxy';
    const profileReady = !needsProfile || (bulkProfileSelect && bulkProfileSelect.value);
    bulkApplyBtn.disabled = !isBulkMode || !hasSelection || !profileReady;
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.disabled = !isBulkMode || !hasSelection;
  }
  if (bulkClearBtn) {
    bulkClearBtn.disabled = !isBulkMode || !hasSelection;
  }
  updateBulkModeVisibility();
}

function toggleBulkMode(force) {
  const shouldEnable = typeof force === 'boolean' ? force : !isBulkMode;
  isBulkMode = shouldEnable;
  if (!isBulkMode) {
    selectedDomainIds.clear();
  }
  updateBulkUI();
  renderDomains();
}

async function handleBulkApply() {
  if (!isBulkMode || !selectedDomainIds.size) {
    showStatus('Выберите записи для изменения.', 'error');
    return;
  }
  const mode = bulkModeSelect?.value === 'proxy' ? 'proxy' : 'direct';
  let targetProfileId = null;
  if (mode === 'proxy') {
    targetProfileId = bulkProfileSelect?.value;
    if (!targetProfileId) {
      showStatus('Выберите профиль прокси.', 'error');
      return;
    }
  }
  state.domainRules = state.domainRules.map((rule) => {
    if (!selectedDomainIds.has(rule.id)) {
      return rule;
    }
    const updated = { ...rule, mode };
    if (mode === 'proxy') {
      updated.profileId = targetProfileId;
    } else {
      delete updated.profileId;
    }
    return updated;
  });
  await saveDomains();
  renderDomains();
  updateBulkUI();
  showStatus('Изменения применены к выбранным доменам.');
}

async function handleBulkDelete() {
  if (!isBulkMode || !selectedDomainIds.size) {
    showStatus('Выберите записи для удаления.', 'error');
    return;
  }
  state.domainRules = state.domainRules.filter((rule) => !selectedDomainIds.has(rule.id));
  selectedDomainIds.clear();
  await saveDomains();
  renderDomains();
  updateBulkUI();
  showStatus('Выбранные домены удалены.');
}

function clearBulkSelection() {
  if (!isBulkMode) {
    return;
  }
  selectedDomainIds.clear();
  updateBulkUI();
  renderDomains();
}

function renderDomains() {
  domainList.innerHTML = '';
  if (selectedDomainIds.size) {
    const validIds = new Set(state.domainRules.map((rule) => rule.id));
    for (const id of Array.from(selectedDomainIds)) {
      if (!validIds.has(id)) {
        selectedDomainIds.delete(id);
      }
    }
  }
  if (!state.domainRules.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Список доменов пока пуст.';
    domainList.appendChild(empty);
    updateBulkUI();
    return;
  }

  state.domainRules
    .slice()
    .sort((a, b) => a.pattern.localeCompare(b.pattern))
    .forEach((rule) => {
      const row = document.createElement('div');
      row.className = 'table-row';

      if (isBulkMode) {
        const selectCell = document.createElement('div');
        selectCell.className = 'select-cell';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedDomainIds.has(rule.id);
        checkbox.addEventListener('change', (event) => {
          if (event.target.checked) {
            selectedDomainIds.add(rule.id);
          } else {
            selectedDomainIds.delete(rule.id);
          }
          updateBulkUI();
        });
        selectCell.appendChild(checkbox);
        row.appendChild(selectCell);
      }

      const patternInput = document.createElement('input');
      patternInput.type = 'text';
      patternInput.value = rule.pattern;
      patternInput.placeholder = 'example.com или https://example.com/page';
      patternInput.addEventListener('change', (event) => {
        rule.pattern = event.target.value.trim();
        saveDomains();
      });
      row.appendChild(patternInput);

      const modeSelect = document.createElement('select');
      ['proxy', 'direct'].forEach((mode) => {
        const option = document.createElement('option');
        option.value = mode;
        option.textContent = mode === 'proxy' ? 'Прокси' : 'Без прокси';
        if (rule.mode === mode) {
          option.selected = true;
        }
        modeSelect.appendChild(option);
      });
      modeSelect.addEventListener('change', (event) => {
        rule.mode = event.target.value;
        if (rule.mode === 'proxy' && !rule.profileId) {
          rule.profileId = state.globalProfileId;
        }
        if (rule.mode === 'direct') {
          delete rule.profileId;
        }
        saveDomains();
        renderDomains();
      });
      row.appendChild(modeSelect);

      const profileSelect = document.createElement('select');
      state.proxyProfiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name || profile.host || 'Безымянный профиль';
        if (rule.profileId === profile.id) {
          option.selected = true;
        }
        profileSelect.appendChild(option);
      });
      profileSelect.disabled = rule.mode !== 'proxy';
      profileSelect.addEventListener('change', (event) => {
        rule.profileId = event.target.value;
        saveDomains();
      });
      row.appendChild(profileSelect);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'danger';
      deleteBtn.textContent = 'Удалить';
      deleteBtn.addEventListener('click', () => {
        state.domainRules = state.domainRules.filter((item) => item.id !== rule.id);
        saveDomains();
        renderDomains();
      });
      row.appendChild(deleteBtn);

      domainList.appendChild(row);
    });
  updateBulkUI();
}

function addProfile() {
  const profile = createDefaultProfile();
  state.proxyProfiles.push(profile);
  if (!state.globalProfileId) {
    state.globalProfileId = profile.id;
  }
  saveProfiles();
  renderProfiles();
  showStatus('Добавлен новый профиль. Заполните параметры подключения.');
}

function removeProfile(id) {
  if (state.proxyProfiles.length <= 1) {
    showStatus('Нельзя удалить единственный профиль.', 'error');
    return;
  }
  state.proxyProfiles = state.proxyProfiles.filter((profile) => profile.id !== id);
  if (state.globalProfileId === id) {
    state.globalProfileId = state.proxyProfiles[0].id;
  }
  state.domainRules = state.domainRules.map((rule) => {
    if (rule.profileId === id) {
      return { ...rule, profileId: state.globalProfileId };
    }
    return rule;
  });
  saveProfiles();
  saveDomains();
  renderProfiles();
  renderDomains();
  showStatus('Профиль удалён. Домены переключены на профиль по умолчанию.');
}

function addDomain() {
  const newRule = {
    id: crypto.randomUUID(),
    pattern: '',
    mode: 'proxy',
    profileId: state.globalProfileId
  };
  state.domainRules = [...state.domainRules, newRule];
  saveDomains();
  renderDomains();
  showStatus('Добавьте домен или адрес и выберите нужный режим.');
}

async function saveProfiles() {
  ensureValidState();
  await chrome.storage.local.set({
    proxyProfiles: state.proxyProfiles,
    globalProfileId: state.globalProfileId
  });
}

async function saveDomains() {
  ensureValidState();
  await chrome.storage.local.set({ domainRules: state.domainRules });
}

async function handleAutoFallbackChange(event) {
  const nextValue = event.target.value === 'proxy' ? 'proxy' : 'direct';
  state.autoModeFallback = nextValue;
  ensureValidState();
  await chrome.storage.local.set({ autoModeFallback: state.autoModeFallback });
  updateBulkUI();
  const message =
    nextValue === 'proxy'
      ? 'Автопрокси теперь использует прокси по умолчанию.'
      : 'Автопрокси теперь пропускает новые сайты без прокси.';
  showStatus(message);
}

function exportData() {
  const data = {
    proxyProfiles: state.proxyProfiles,
    domainRules: state.domainRules,
    globalProfileId: state.globalProfileId,
    autoModeFallback: state.autoModeFallback
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'smart-proxy-settings.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showStatus('Настройки экспортированы в smart-proxy-settings.json');
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.proxyProfiles) || !Array.isArray(parsed.domainRules)) {
        throw new Error('Некорректный файл настроек.');
      }
      state.proxyProfiles = parsed.proxyProfiles;
      state.domainRules = parsed.domainRules;
      state.globalProfileId = parsed.globalProfileId || (state.proxyProfiles[0] && state.proxyProfiles[0].id) || crypto.randomUUID();
      state.autoModeFallback = parsed.autoModeFallback === 'proxy' ? 'proxy' : 'direct';
      ensureValidState();
      await chrome.storage.local.set({
        proxyProfiles: state.proxyProfiles,
        domainRules: state.domainRules,
        globalProfileId: state.globalProfileId,
        autoModeFallback: state.autoModeFallback
      });
      renderProfiles();
      renderDomains();
      updateAutoFallbackControl();
      updateBulkUI();
      showStatus('Настройки успешно импортированы.');
    } catch (error) {
      console.error(error);
      showStatus('Не удалось импортировать файл настроек.', 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

addProfileBtn.addEventListener('click', addProfile);
addDomainBtn.addEventListener('click', addDomain);
exportBtn.addEventListener('click', exportData);
importInput.addEventListener('change', handleImport);
if (autoFallbackSelect) {
  autoFallbackSelect.addEventListener('change', handleAutoFallbackChange);
}
if (toggleBulkBtn) {
  toggleBulkBtn.addEventListener('click', () => toggleBulkMode());
}
if (bulkModeSelect) {
  bulkModeSelect.addEventListener('change', () => {
    updateBulkModeVisibility();
    updateBulkUI();
  });
}
if (bulkApplyBtn) {
  bulkApplyBtn.addEventListener('click', handleBulkApply);
}
if (bulkDeleteBtn) {
  bulkDeleteBtn.addEventListener('click', handleBulkDelete);
}
if (bulkClearBtn) {
  bulkClearBtn.addEventListener('click', clearBulkSelection);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.proxyProfiles || changes.domainRules || changes.globalProfileId || changes.autoModeFallback) {
    loadState();
  }
});

loadState();
