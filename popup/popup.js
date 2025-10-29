document.addEventListener('DOMContentLoaded', () => {
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const settingsBtn = document.getElementById('settingsBtn');
  const errorsBtn = document.getElementById('errorsBtn');

  // 1. Load the saved mode and update the UI
  chrome.storage.local.get('proxyMode', (data) => {
    if (data.proxyMode) {
      const radio = document.querySelector(`input[value="${data.proxyMode}"]`);
      if (radio) {
        radio.checked = true;
      }
    }
  });

  // 2. Save the new mode when a radio button is clicked
  modeRadios.forEach(radio => {
    radio.addEventListener('change', (event) => {
      const newMode = event.target.value;
      chrome.storage.local.set({ proxyMode: newMode }, () => {
        // 3. Notify the background script to apply changes
        chrome.runtime.sendMessage({ type: 'proxy-mode-changed', mode: newMode });
      });
    });
  });

  // 4. Handle Settings button click
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 5. Handle Errors button and modal logic
  const errorModal = document.getElementById('error-modal');
  const closeBtn = document.querySelector('.close-btn');
  const errorListDiv = document.getElementById('error-list');
  const applyErrorActionBtn = document.getElementById('apply-error-action');
  const errorActionSelect = document.getElementById('error-action-select');
  const errorProfileSelect = document.getElementById('error-profile-select');

  function populateProfileSelect() {
      chrome.storage.local.get('proxySettings', (data) => {
          const profiles = data.proxySettings?.proxyProfiles || [];
          errorProfileSelect.innerHTML = '';
          profiles.forEach(p => {
              const option = document.createElement('option');
              option.value = p.id;
              option.textContent = p.name;
              errorProfileSelect.appendChild(option);
          });
      });
  }

  errorActionSelect.addEventListener('change', () => {
      errorProfileSelect.style.display = errorActionSelect.value === 'proxy' ? 'inline-block' : 'none';
  });

  errorsBtn.addEventListener('click', () => {
    populateProfileSelect();
    errorActionSelect.dispatchEvent(new Event('change')); // Trigger change to set initial visibility
    // Load errors from storage and display them
    chrome.storage.local.get({ proxyErrors: [] }, (data) => {
      errorListDiv.innerHTML = '';
      if (data.proxyErrors.length > 0) {
        data.proxyErrors.forEach(domain => {
          const checkbox = document.createElement('label');
          checkbox.innerHTML = `<input type="checkbox" value="${domain}"> ${domain}`;
          errorListDiv.appendChild(checkbox);
        });
      } else {
        errorListDiv.innerHTML = '<p>No errors recorded.</p>';
      }
      errorModal.style.display = 'block';
    });
  });

  closeBtn.addEventListener('click', () => {
    errorModal.style.display = 'none';
  });

  applyErrorActionBtn.addEventListener('click', () => {
    const selectedDomains = Array.from(errorListDiv.querySelectorAll('input:checked')).map(cb => cb.value);
    const action = errorActionSelect.value;
    const profileId = parseInt(errorProfileSelect.value, 10);

    if (selectedDomains.length > 0) {
      chrome.storage.local.get('proxySettings', (data) => {
        const settings = data.proxySettings;

        selectedDomains.forEach(domain => {
            // Avoid adding duplicate rules
            if (!settings.domainRules.some(rule => rule.domain === domain)) {
                 settings.domainRules.push({
                    id: settings.nextRuleId++,
                    domain: domain,
                    mode: action,
                    profileId: action === 'proxy' ? profileId : (settings.proxyProfiles[0]?.id || 1)
                });
            }
        });

        chrome.storage.local.set({ proxySettings: settings }, () => {
            // Remove the processed domains from the error list
            chrome.storage.local.get({ proxyErrors: [] }, (errData) => {
                const newErrors = errData.proxyErrors.filter(d => !selectedDomains.includes(d));
                chrome.storage.local.set({ proxyErrors: newErrors }, () => {
                    alert('Rules updated!');
                    errorModal.style.display = 'none';
                    chrome.runtime.sendMessage({ type: 'settings-changed' });
                });
            });
        });
      });
    } else {
      errorModal.style.display = 'none';
    }
  });
});
