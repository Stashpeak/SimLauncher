const { ipcRenderer } = require('electron');

/* ==========================================================================
   CONFIGURATION
   ========================================================================== */
const CONFIG = {
    UTILITIES: [
        { key: 'simhub', id: 'simhub-path', name: 'SimHub' },
        { key: 'crewchief', id: 'crewchief-path', name: 'Crew Chief' },
        { key: 'tradingpaints', id: 'tradingpaints-path', name: 'Trading Paints' },
        { key: 'garage61', id: 'garage61-path', name: 'Garage 61' },
        { key: 'secondmonitor', id: 'secondmonitor-path', name: 'Second Monitor' },
        { key: 'customapp1', id: 'customapp1-path', name: 'Custom App 1', isCustom: true, defaultName: 'Custom App 1' },
        { key: 'customapp2', id: 'customapp2-path', name: 'Custom App 2', isCustom: true, defaultName: 'Custom App 2' },
        { key: 'customapp3', id: 'customapp3-path', name: 'Custom App 3', isCustom: true, defaultName: 'Custom App 3' },
        { key: 'customapp4', id: 'customapp4-path', name: 'Custom App 4', isCustom: true, defaultName: 'Custom App 4' },
        { key: 'customapp5', id: 'customapp5-path', name: 'Custom App 5', isCustom: true, defaultName: 'Custom App 5' }
    ],
    GAMES: [
        { key: 'ac', id: 'ac-path', name: 'Assetto Corsa' },
        { key: 'acc', id: 'acc-path', name: 'Assetto Corsa Competizione' },
        { key: 'acevo', id: 'acevo-path', name: 'Assetto Corsa Evo' },
        { key: 'acrally', id: 'acrally-path', name: 'Assetto Corsa Rally' },
        { key: 'ams', id: 'ams-path', name: 'Automobilista' },
        { key: 'ams2', id: 'ams2-path', name: 'Automobilista 2' },
        { key: 'beamng', id: 'beamng-path', name: 'BeamNG' },
        { key: 'dcsw', id: 'dcsw-path', name: 'DCS World' },
        { key: 'dirtrally', id: 'dirtrally-path', name: 'Dirt Rally' },
        { key: 'dirtrally2', id: 'dirtrally2-path', name: 'Dirt Rally 2.0' },
        { key: 'eawrc', id: 'eawrc-path', name: 'EA WRC' },
        { key: 'f124', id: 'f124-path', name: 'F1 24' },
        { key: 'f125', id: 'f125-path', name: 'F1 25' },
        { key: 'iracing', id: 'iracing-path', name: 'iRacing' },
        { key: 'lmu', id: 'lmu-path', name: 'Le Mans Ultimate' },
        { key: 'pmr', id: 'pmr-path', name: 'Project Motor Racing' },
        { key: 'raceroom', id: 'raceroom-path', name: 'RaceRoom Racing Experience' },
        { key: 'rbr', id: 'rbr-path', name: 'Richard Burns Rally' },
        { key: 'rennsport', id: 'rennsport-path', name: 'Rennsport' },
        { key: 'rf1', id: 'rf1-path', name: 'rFactor' },
        { key: 'rf2', id: 'rf2-path', name: 'rFactor 2' },
    ]
};

/* ==========================================================================
   STATE MANAGEMENT
   ========================================================================== */
const state = {
    appPaths: {},
    gamePaths: {},
    currentEditingGameKey: null
};

/* ==========================================================================
   UI LOGIC
   ========================================================================== */
const ui = {
    showTab: (tabId) => {
        const editor = document.getElementById('profile-editor');
        const launcher = document.getElementById('launcher');

        // Move editor back to launcher structure if needed (prevents bugs when switching tabs)
        if (editor.parentNode !== launcher) launcher.appendChild(editor);
        ui.hideProfileEditor();

        // Switch Tabs
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        document.getElementById('game-list').style.display = 'grid';

        if (tabId === 'launcher') ui.generateGameButtons();
    },

    generateGameButtons: () => {
        const listDiv = document.getElementById('game-list');
        listDiv.innerHTML = '';

        CONFIG.GAMES.forEach(game => {
            const key = game.key;
            // Only show games with configured paths
            if (!state.gamePaths[key] || state.gamePaths[key].trim() === "") return;

            const container = document.createElement('div');
            container.classList.add('game-profile');
            container.dataset.gameKey = key;

            // Note: onclick uses global functions defined at the bottom of this file
            container.innerHTML = `
                <img src="assets/${key}.png" alt="${game.name}" class="game-icon" onerror="this.style.display='none'">
                <button class="launch-icon" onclick="launchGame('${key}')"><span class="launch-icon-symbol">▶</span>  ${game.name}</button>
                <button class="settings-icon" onclick="event.stopPropagation(); profiles.openEditor('${key}', '${game.name}')">⚙️</button>
            `;
            listDiv.appendChild(container);
        });
    },

    hideProfileEditor: () => {
        document.getElementById('profile-editor').style.display = 'none';
        state.currentEditingGameKey = null;
    }
};

/* ==========================================================================
   SETTINGS LOGIC (Global Paths)
   ========================================================================== */
const settings = {
generateForm: () => {
    const formDiv = document.getElementById('global-settings-form');

    // Insert Accent controls at the top so they follow the same .setting-item layout
    let html = `
        <div class="setting-item">
            <label for="accent-presets">Accent preset:</label>
            <select id="accent-presets">
                <option value="#00eaff">Electric Aqua</option>
                <option value="#3498db">SimHub Blue</option>
                <option value="#00ff88">Racing Green</option>
                <option value="#f1c40f">CrewChief Yellow</option>
                <option value="#6e5bfb">Cyber Purple</option>
                <option value="#ff2233">Milano Red</option>
                <option value="custom">Custom...</option>
            </select>
        </div>

        <div class="setting-item">
            <label for="accent-custom">Custom color:</label>
            <input type="color" id="accent-custom" disabled>
        </div>

        <h3>Apps</h3>
    `;

    // Custom & Standard Apps
    CONFIG.UTILITIES.forEach(item => {
        if (item.isCustom) {
            const customName = localStorage.getItem(`simLauncherAppName_${item.key}`) || item.defaultName;
            html += `
                <div class="setting-item custom-app-item">
                    <input type="text" class="custom-app-name-input" value="${customName}" placeholder="App Name" onchange="settings.saveCustomName('${item.key}', this.value)">
                    <input type="text" id="${item.id}" placeholder="Path to .exe">
                    <button onclick="browsePath('${item.id}')">Browse</button>
                </div>`;
        } else {
            html += `
                <div class="setting-item">
                    <label for="${item.id}">${item.name}:</label>
                    <input type="text" id="${item.id}" placeholder="Path to ${item.name}.exe">
                    <button onclick="browsePath('${item.id}')">Browse</button>
                </div>`;
        }
    });

    html += '<h3>Games</h3>';
    CONFIG.GAMES.forEach(item => {
        html += `
            <div class="setting-item">
                <label for="${item.id}">${item.name}:</label>
                <input type="text" id="${item.id}" placeholder="Path to ${item.name}.exe">
                <button onclick="browsePath('${item.id}')">Browse</button>
            </div>`;
    });

    formDiv.innerHTML = html;
},


    load: () => {
        state.appPaths = JSON.parse(localStorage.getItem('simLauncherAppPaths')) || {};
        state.gamePaths = JSON.parse(localStorage.getItem('simLauncherGamePaths')) || {};

        [...CONFIG.UTILITIES, ...CONFIG.GAMES].forEach(item => {
            const el = document.getElementById(item.id);
            if (el) el.value = state.appPaths[item.key] || state.gamePaths[item.key] || '';
        });
    },

    save: () => {
        [...CONFIG.UTILITIES, ...CONFIG.GAMES].forEach(item => {
            const val = document.getElementById(item.id).value;
            const isUtility = CONFIG.UTILITIES.some(u => u.key === item.key);
            if (isUtility) state.appPaths[item.key] = val;
            else state.gamePaths[item.key] = val;
        });

        localStorage.setItem('simLauncherAppPaths', JSON.stringify(state.appPaths));
        localStorage.setItem('simLauncherGamePaths', JSON.stringify(state.gamePaths));

        const status = document.getElementById('settings-status');
        notify("Settings saved!", "success");
        /*status.style.color = 'lightgreen';*/
        
        setTimeout(() => ui.generateGameButtons(), 50);
    },

    saveCustomName: (key, newName) => {
        const nameToSave = (newName && newName.trim() !== "") ? newName.trim() : CONFIG.UTILITIES.find(i => i.key === key).defaultName;
        localStorage.setItem(`simLauncherAppName_${key}`, nameToSave);
    }
};

/* ==========================================================================
   PROFILE LOGIC (Per-Game Settings)
   ========================================================================== */
const profiles = {
    openEditor: (gameKey, gameName) => {
        const editor = document.getElementById('profile-editor');

        // Toggle logic: Close if clicking the same gear icon again
        if (state.currentEditingGameKey === gameKey && editor.style.display === 'block') {
            ui.hideProfileEditor();
            return;
        }

        state.currentEditingGameKey = gameKey;
        document.getElementById('editor-title').textContent = `Profile Settings: ${gameName}`;
        
        // Load Saved Profile
        const savedProfile = JSON.parse(localStorage.getItem(`profile_${gameKey}`)) || {};
        const checkboxesDiv = document.getElementById('app-checkboxes');
        checkboxesDiv.innerHTML = '';

        // Generate Checkboxes
        CONFIG.UTILITIES.forEach(item => {
            // Check if path exists
            if (!state.appPaths[item.key] || state.appPaths[item.key].trim() === "") return;

            // Resolve Name (Custom or Standard)
            const displayName = item.isCustom 
                ? (localStorage.getItem(`simLauncherAppName_${item.key}`) || item.defaultName) 
                : item.name;

            const div = document.createElement('div');
            div.classList.add('checkbox-item');
            
            // Checkbox logic
            const isChecked = savedProfile[item.key] ? 'checked' : '';
            div.innerHTML = `
                <input type="checkbox" id="check_${item.key}" ${isChecked}>
                <label for="check_${item.key}">${displayName}</label>
            `;
            checkboxesDiv.appendChild(div);
        });

        // Set Auto-Launch checkbox state
        document.getElementById('launch-game-automatically').checked = (savedProfile.launchAutomatically !== false);

        // Position and Show Editor
        const gameRow = document.querySelector(`.game-profile[data-game-key="${gameKey}"]`);
        if (gameRow) gameRow.parentNode.insertBefore(editor, gameRow.nextSibling);
        editor.style.display = 'block';
    },

    save: () => {
        const gameName = CONFIG.GAMES.find(g => g.key === state.currentEditingGameKey)?.name;
        const profileSettings = {};
        CONFIG.UTILITIES.forEach(item => {
            const checkbox = document.getElementById(`check_${item.key}`);
            if (checkbox) profileSettings[item.key] = checkbox.checked;
        });

        profileSettings.launchAutomatically = document.getElementById('launch-game-automatically').checked;
        localStorage.setItem(`profile_${state.currentEditingGameKey}`, JSON.stringify(profileSettings));

        const status = document.getElementById('profile-status');
        notify(`Profile saved for ${gameName}!`, "success", 2500);
        /*status.style.color = 'lightgreen';*/
        /*setTimeout(() => status.textContent = '', 1000);*/
    }
};

/* ==========================================================================
   LAUNCH LOGIC
   ========================================================================== */
function launchGame(gameKey) {
    const appsToLaunch = [];
    const statusDiv = document.getElementById('status');
    const savedProfile = JSON.parse(localStorage.getItem(`profile_${gameKey}`)) || {};
    const shouldAutoLaunchGame = (savedProfile.launchAutomatically !== false);

    // 1. Collect Utilities
    CONFIG.UTILITIES.forEach(item => {
        if (savedProfile[item.key] && state.appPaths[item.key]) {
            appsToLaunch.push(state.appPaths[item.key]);
        }
    });

    // 2. Collect Game (if auto-launch enabled)
    const gameConfig = CONFIG.GAMES.find(g => g.key === gameKey);
    const gameName = gameConfig ? gameConfig.name : gameKey;

    if (shouldAutoLaunchGame) {
        if (state.gamePaths[gameKey]) appsToLaunch.push(state.gamePaths[gameKey]);
        else {
            notify(`Path to ${gameName} not set!`, "error", 6000);
            return;
        }
    }

    // 3. Send to Main Process
    if (appsToLaunch.length > 0) {
        ipcRenderer.send('launch-profile', appsToLaunch);
        
        ipcRenderer.once('launch-result', (event, result) => {
            if (result.success) {
                const msg = shouldAutoLaunchGame 
                    ? `✅ Starting ${gameName} + apps.` 
                    : `✅ Apps started. Launch ${gameName} manually.`;
                notify(msg, "success", 4000);
                setTimeout(() => statusDiv.textContent = '', shouldAutoLaunchGame ? 5000 : 15000);
            } else {
                notify(`ERROR: ${result.error}`, "error", 5000);
            }
        });
    } else {
        statusDiv.textContent = `ERROR: Nothing selected to launch!`;
    }
}

/* ==========================================================================
   IPC & HELPERS
   ========================================================================== */
function browsePath(inputId) {
    if (document.getElementById(inputId)) ipcRenderer.send('browse-path', inputId);
}

ipcRenderer.on('browse-path-result', (event, result) => {
    if (result.filePath) {
        document.getElementById(result.inputId).value = result.filePath;
        settings.save();
    }
});

/* ==========================================================================
   INITIALIZATION & EXPOSE TO WINDOW
   ========================================================================== */
window.onload = () => {
    settings.generateForm();
    settings.load();
    settings.initAccentPresets();
    ui.generateGameButtons();
    ui.showTab('launcher');
};

// CRITICAL: Make functions globally available for HTML onclick attributes
window.ui = ui;
window.settings = settings;
window.profiles = profiles;
window.launchGame = launchGame;
window.browsePath = browsePath;

// Helper: convert hex like "#rrggbb" to rgba(r,g,b,a)
function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(0,234,255,${alpha})`;
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2), 16);
    const g = parseInt(h.substring(2,4), 16);
    const b = parseInt(h.substring(4,6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// Apply accent hex and computed glow (24% opacity)
function applyAccentColor(hex) {
    if (!hex || typeof hex !== 'string') return;
    document.documentElement.style.setProperty('--accent', hex);
    // compute glow as rgba with 24% alpha
    const glow = hexToRgba(hex, 0.24);
    document.documentElement.style.setProperty('--accent-glow', glow);
}

// Replacement: initialize accent presets and persist custom color separately
settings.initAccentPresets = () => {
    const presetSelect = document.getElementById('accent-presets');
    const customInput = document.getElementById('accent-custom');

    if (!presetSelect || !customInput) return;

    // find the surrounding row so we can grey it out
    const customRow = customInput.closest('.setting-item');

    // Load saved values
    const savedPreset = localStorage.getItem('simLauncherAccentPreset') || '';
    const savedCustom = localStorage.getItem('simLauncherAccentCustom') || '';

    // Always restore saved custom color (so it's remembered)
    if (savedCustom) {
        customInput.value = savedCustom;
    } else {
        const rootAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00eaff';
        customInput.value = rootAccent;
    }

    // Apply saved preset (custom takes precedence)
    if (savedPreset === 'custom' && customInput.value) {
        applyAccentColor(customInput.value);
        presetSelect.value = 'custom';
        customInput.disabled = false;
        if (customRow) customRow.classList.remove('disabled');
    } else if (savedPreset) {
        applyAccentColor(savedPreset);
        presetSelect.value = savedPreset;
        customInput.disabled = true;             // disable when non-custom
        if (customRow) customRow.classList.add('disabled');
    } else {
        const rootAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00eaff';
        applyAccentColor(rootAccent);
        presetSelect.value = rootAccent;
        customInput.disabled = true;
        if (customRow) customRow.classList.add('disabled');
    }

    // When user selects a preset
    presetSelect.addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === 'custom') {
            // enable the color control and apply its current value
            customInput.disabled = false;
            if (customRow) customRow.classList.remove('disabled');

            const color = customInput.value || '#00eaff';
            applyAccentColor(color);
            localStorage.setItem('simLauncherAccentPreset', 'custom');
            localStorage.setItem('simLauncherAccentCustom', color);
        } else {
            // disable color control and apply preset
            customInput.disabled = true;
            if (customRow) customRow.classList.add('disabled');

            applyAccentColor(v);
            localStorage.setItem('simLauncherAccentPreset', v);
            // keep stored custom color intact (do not clear)
        }
    });

    // When user picks a custom color we ALWAYS save it
    customInput.addEventListener('input', (e) => {
        const color = e.target.value;
        localStorage.setItem('simLauncherAccentCustom', color);

        // If 'custom' preset is active, apply immediately
        if (presetSelect.value === 'custom') {
            applyAccentColor(color);
            localStorage.setItem('simLauncherAccentPreset', 'custom');
        }
    });
};
/* =====================================================================
   NOTIFICATION MANAGER (global popup messages)
   ===================================================================== */

window.notify = function (message, type = 'success', duration = 3000) {
    const container = document.getElementById('notifications');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = `
        ${message}
        <div class="progress"></div>
    `;

    // Adjust animation duration dynamically
    const bar = el.querySelector('.progress');
    bar.style.animationDuration = duration + 'ms';

    container.appendChild(el);

    // Close on click
    el.addEventListener("click", () => {
    el.style.opacity = 0;
    el.style.transform = "translateX(20px) scale(0.95)";
    setTimeout(() => el.remove(), 50);
    });


    // Remove after duration
    setTimeout(() => {
        el.style.opacity = 0;
        el.style.transform = "translateX(20px)";
        setTimeout(() => el.remove(), 250);
    }, duration);
};
