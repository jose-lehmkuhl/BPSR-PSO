const colorHues = [
    210, // Blue
    30, // Orange
    270, // Purple
    150, // Teal
    330, // Magenta
    60, // Yellow
    180, // Cyan
    0, // Red
    240, // Indigo
];

let colorIndex = 0;

function getNextColorShades() {
    const h = colorHues[colorIndex];
    colorIndex = (colorIndex + 1) % colorHues.length;
    const s = 90;
    const l_dps = 30;
    const l_hps = 20;

    const dpsColor = `hsl(${h}, ${s}%, ${l_dps}%)`;
    const hpsColor = `hsl(${h}, ${s}%, ${l_hps}%)`;
    return { dps: dpsColor, hps: hpsColor };
}

// Fixed color per base class (single color used for both DPS/HPS)
const classColors = {
    'Stormblade': 'RoyalBlue',
    'Frost Mage': 'DeepSkyBlue',
    'Fire Warrior': 'Tomato',
    'Wind Knight': 'MediumSeaGreen',
    'Verdant Oracle': 'YellowGreen',
    'Marksman': 'Orange',
    'Heavy Guardian': 'SlateGray',
    'Reaper': 'MediumPurple',
    'Gunner': 'Turquoise',
    'Shield Knight': 'SteelBlue',
    'Soul Musician': 'HotPink',
};

function getBaseProfessionName(professionString) {
    if (!professionString) return '';
    return professionString.split('(')[0].trim();
}

const columnsContainer = document.getElementById('columnsContainer');
const modeDpsBtn = document.getElementById('modeDpsBtn');
const modeHpsBtn = document.getElementById('modeHpsBtn');
const modeTankingBtn = document.getElementById('modeTankingBtn');
const modeNpcTankingBtn = document.getElementById('modeNpcTankingBtn');
let rankingMode = 'dps';
const settingsContainer = document.getElementById('settingsContainer');
const helpContainer = document.getElementById('helpContainer');
const fightTimerEl = document.getElementById('fightTimer');
const oocTimer = document.getElementById('oocTimer');
const saveOocBtn = document.getElementById('saveOocBtn');
const encounterSelect = document.getElementById('encounterSelect');
const passthroughTitle = document.getElementById('passthroughTitle');
const pauseButton = document.getElementById('pauseButton');
const clearButton = document.getElementById('clearButton');
const helpButton = document.getElementById('helpButton');
const settingsButton = document.getElementById('settingsButton');
const closeButton = document.getElementById('closeButton');
const allButtons = [clearButton, pauseButton, helpButton, settingsButton, closeButton];
const serverStatus = document.getElementById('serverStatus');
const opacitySlider = document.getElementById('opacitySlider');
const hkClickthrough = document.getElementById('hkClickthrough');
const hkToggleWindow = document.getElementById('hkToggleWindow');
const saveHotkeysBtn = document.getElementById('saveHotkeysBtn');

let allUsers = {};
let allEnemies = {};
let userColors = {};
let isPaused = false;
let socket = null;
let isWebSocketConnected = false;
let lastWebSocketMessage = Date.now();
const WEBSOCKET_RECONNECT_INTERVAL = 5000;
let fightStartTs = 0;
let lastCombatTs = 0;
let lastTotals = { dmg: 0, heal: 0 };
let lastPerUser = {}; // no longer used for resets; kept for potential future use
let currentEncounter = 'current';
let historicalUsers = null;
let historicalEnemies = null;
const encounterOptions = new Set(['current']);

const SERVER_URL = 'localhost:8990';

function formatNumber(num) {
    if (isNaN(num)) return 'NaN';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return Math.round(num).toString();
}

function renderDataList(users) {
    columnsContainer.innerHTML = '';

    const totalDamageOverall = users.reduce((sum, user) => sum + user.total_damage.total, 0);
    const totalHealingOverall = users.reduce((sum, user) => sum + user.total_healing.total, 0);
    const totalTakenOverall = users.reduce((sum, user) => sum + (user.taken_damage || 0), 0);

    const mode = rankingMode;
    if (mode === 'hps') {
        users.sort((a, b) => b.total_hps - a.total_hps);
    } else if (mode === 'tanking') {
        users.sort((a, b) => (b.taken_damage || 0) - (a.taken_damage || 0));
    } else {
        users.sort((a, b) => b.total_dps - a.total_dps);
    }

    users.forEach((user, index) => {
        const professionString = user.profession ? user.profession.trim() : '';
        const baseProf = getBaseProfessionName(professionString);
        let barColor = classColors[baseProf];
        if (!barColor) {
            // Fixed color when class is unknown
            barColor = 'DimGray';
        }
        const item = document.createElement('li');

        item.className = 'data-item';
        const damagePercent = totalDamageOverall > 0 ? (user.total_damage.total / totalDamageOverall) * 100 : 0;
        const healingPercent = totalHealingOverall > 0 ? (user.total_healing.total / totalHealingOverall) * 100 : 0;

        const specMatch = professionString ? professionString.match(/\([^)]*\)/) : null;
        const specSuffix = specMatch ? ` ${specMatch[0]}` : '';

        const safeName = (user.name && user.name !== '...') ? user.name : `#${user.id}`;
        const baseName = `${safeName}${specSuffix}`;
        const displayName = (typeof user.fightPoint === 'number' && user.fightPoint > 0)
            ? `${baseName} (${user.fightPoint})`
            : baseName;

        let classIconHtml = '';
        if (professionString && professionString !== '...') {
            const mainProfession = professionString.split('(')[0].trim();
            const iconFileName = mainProfession.toLowerCase().replace(/ /g, '_') + '.png';
            classIconHtml = `<img src="assets/${iconFileName}" class="class-icon" alt="${mainProfession}" onerror="this.style.display='none'">`;
        }

        // Remove embedded HPS sub-bar from DPS tab to keep modes separate
        let subBarHtml = '';

        let modeStats = `${formatNumber(user.total_damage.total)} (${formatNumber(user.total_dps)} DPS, ${damagePercent.toFixed(1)}%)`;
        let mainBarFill = `<div class="dps-bar-fill" style="width: ${damagePercent}%; background-color: ${barColor};"></div>`;
        if (mode === 'hps') {
            modeStats = `${formatNumber(user.total_healing.total)} (${formatNumber(user.total_hps)} HPS, ${healingPercent.toFixed(1)}%)`;
            mainBarFill = `<div class="hps-bar-fill" style="width: ${healingPercent}%; background-color: ${barColor};"></div>`;
        } else if (mode === 'tanking') {
            const tankTotal = user.taken_damage || 0;
            const tankPercent = totalTakenOverall > 0 ? (tankTotal / totalTakenOverall) * 100 : 0;
            modeStats = `${formatNumber(tankTotal)} TAKING (${tankPercent.toFixed(1)}%)`;
            mainBarFill = `<div class="tanking-bar-fill" style="width: ${tankPercent}%; background-color: rgba(255,0,0,0.5);"></div>`;
        }

        item.innerHTML = `
            <div class="main-bar">
                ${mainBarFill}
                <div class="content">
                    <span class="rank">${index + 1}.</span>
                    ${classIconHtml}
                    <span class="name">${displayName}</span>
                    <span class="stats">${modeStats}</span>
                </div>
            </div>
            ${mode === 'hps' ? '' : subBarHtml}
        `;
        columnsContainer.appendChild(item);
    });
}

function renderNpcTankingList(enemies) {
    columnsContainer.innerHTML = '';
    // Prefer aggregated taken_total; fallback to current HP loss
    const getTaken = (e) => (e.taken_total != null ? e.taken_total : Math.max(0, (e.max_hp || 0) - (e.hp || 0)));
    const totalNpcTaken = enemies.reduce((sum, e) => sum + getTaken(e), 0);
    enemies.sort((a, b) => (getTaken(b) - getTaken(a)));
    enemies.forEach((e, index) => {
        const item = document.createElement('li');
        item.className = 'data-item';
        const taken = getTaken(e);
        const percent = totalNpcTaken > 0 ? (taken / totalNpcTaken) * 100 : 0;
        const displayName = e.name || `#${e.id}`;
        item.innerHTML = `
            <div class="main-bar">
                <div class="tanking-bar-fill" style="width: ${percent}%; background-color: rgba(255,0,0,0.5);"></div>
                <div class="content">
                    <span class="rank">${index + 1}.</span>
                    <span class="name">${displayName}</span>
                    <span class="stats">${formatNumber(taken)} (${percent.toFixed(1)}%)</span>
                </div>
            </div>
        `;
        columnsContainer.appendChild(item);
    });
}

function updateAll() {
    if (currentEncounter !== 'current') {
        // Historical view: render from cached historical arrays
        if (rankingMode === 'npc') {
            const enemiesArray = Array.isArray(historicalEnemies) ? historicalEnemies : [];
            renderNpcTankingList(enemiesArray);
            return;
        } else {
            const usersArray = Array.isArray(historicalUsers) ? historicalUsers : [];
            renderDataList(usersArray);
            return;
        }
    }
    if (rankingMode === 'npc') {
        const enemiesArray = Object.entries(allEnemies).map(([id, e]) => ({ id, ...e }))
            .filter((e) => (e.hp || 0) >= 0);
        renderNpcTankingList(enemiesArray);
    } else {
        const usersArray = Object.values(allUsers).filter((user) => user.total_dps > 0 || user.total_hps > 0 || (user.taken_damage||0)>0);
        renderDataList(usersArray);
    }
}

function processDataUpdate(data) {
    if (isPaused) return;
    if (!data.user) {
        console.warn('Received data without a "user" object:', data);
        return;
    }

    for (const userId in data.user) {
        const newUser = data.user[userId];
        const existingUser = allUsers[userId] || {};

        const updatedUser = {
            ...existingUser,
            ...newUser,
            id: userId,
        };

        const hasNewValidName = newUser.name && typeof newUser.name === 'string';
        if (hasNewValidName) {
            updatedUser.name = newUser.name;
        } else if (!existingUser.name || existingUser.name === '...') {
            updatedUser.name = '...';
        }

        const hasNewProfession = newUser.profession && typeof newUser.profession === 'string';
        if (hasNewProfession) {
            updatedUser.profession = newUser.profession;
        } else if (!existingUser.profession) {
            updatedUser.profession = '';
        }

        const hasNewFightPoint = newUser.fightPoint !== undefined && typeof newUser.fightPoint === 'number';
        if (hasNewFightPoint) {
            updatedUser.fightPoint = newUser.fightPoint;
        } else if (existingUser.fightPoint === undefined) {
            updatedUser.fightPoint = 0;
        }

        allUsers[userId] = updatedUser;
    }

    // Detect per-user decreases (new fight started after server clear but first payload not empty)
    const nowTs = Date.now();
    const sumDmg = Object.values(allUsers).reduce((s,u)=> s + ((u.total_damage?.total)||0), 0);
    const sumHeal = Object.values(allUsers).reduce((s,u)=> s + ((u.total_healing?.total)||0), 0);
    // Per-user decrease heuristic removed to avoid false positives mid-combat
    // Combat timing: detect activity only when totals increase (not just > 0)
    const increased = sumDmg > lastTotals.dmg || sumHeal > lastTotals.heal;
    if (increased) {
        const oocSec = parseInt(oocTimer?.value || '15', 10);
        const newFightDetected = fightStartTs && lastCombatTs && (nowTs - lastCombatTs) >= oocSec * 1000;
        if (newFightDetected) {
            // Start fresh locally (no server clear): clear bars/colors and reset timer
            allUsers = {};
            userColors = {};
            fightStartTs = nowTs;
            lastCombatTs = nowTs;
            lastTotals = { dmg: sumDmg, heal: sumHeal };
            updateAll();
            return;
        }
        if (!fightStartTs) fightStartTs = nowTs;
        lastCombatTs = nowTs;
        lastTotals = { dmg: sumDmg, heal: sumHeal };
    }

    // Use server-provided timing for accurate fight window
    if (data.fightStartTime) fightStartTs = data.fightStartTime;
    if (data.lastActivityTime) lastCombatTs = data.lastActivityTime;

    updateAll();
}

async function clearData() {
    try {
        const currentStatus = getServerStatus();
        showServerStatus('cleared');

        const response = await fetch(`http://${SERVER_URL}/api/clear`);
        const result = await response.json();

        if (result.code === 0) {
            allUsers = {};
            userColors = {};
            // Reset fight timer state on manual clear
            fightStartTs = 0;
            lastCombatTs = 0;
            lastTotals = { dmg: 0, heal: 0 };
            lastPerUser = {};
            updateAll();
            showServerStatus('cleared');
            console.log('Data cleared successfully.');
        } else {
            console.error('Failed to clear data on server:', result.msg);
        }

        setTimeout(() => showServerStatus(currentStatus), 1000);
    } catch (error) {
        console.error('Error sending clear request to server:', error);
    }
}

function togglePause() {
    isPaused = !isPaused;
    pauseButton.innerText = isPaused ? 'Resume' : 'Pause';
    showServerStatus(isPaused ? 'paused' : 'connected');
}

function closeClient() {
    window.electronAPI.closeClient();
}

function showServerStatus(status) {
    const statusElement = document.getElementById('serverStatus');
    statusElement.className = `status-indicator ${status}`;
}

function getServerStatus() {
    const statusElement = document.getElementById('serverStatus');
    return statusElement.className.replace('status-indicator ', '');
}

function connectWebSocket() {
    socket = io(`ws://${SERVER_URL}`);

    socket.on('connect', () => {
        isWebSocketConnected = true;
        showServerStatus('connected');
        lastWebSocketMessage = Date.now();
    });

    socket.on('disconnect', () => {
        isWebSocketConnected = false;
        showServerStatus('disconnected');
    });

    socket.on('data', (data) => {
        processDataUpdate(data);
        if (data.enemies) {
            allEnemies = data.enemies || {};
        }
        lastWebSocketMessage = Date.now();
        // Avoid overriding historical view on live updates
        if (currentEncounter === 'current') updateAll();
    });

    socket.on('user_deleted', (data) => {
        console.log(`User ${data.uid} was removed due to inactivity.`);
        delete allUsers[data.uid];
        updateAll();
    });

    socket.on('connect_error', (error) => {
        showServerStatus('disconnected');
        console.error('WebSocket connection error:', error);
    });
}

function checkConnection() {
    if (!isWebSocketConnected && socket && socket.disconnected) {
        showServerStatus('reconnecting');
        socket.connect();
    }

    if (isWebSocketConnected && Date.now() - lastWebSocketMessage > WEBSOCKET_RECONNECT_INTERVAL) {
        isWebSocketConnected = false;
        if (socket) socket.disconnect();
        connectWebSocket();
        showServerStatus('reconnecting');
    }
}

function initialize() {
    connectWebSocket();
    setInterval(checkConnection, WEBSOCKET_RECONNECT_INTERVAL);
}

function toggleSettings() {
    const isSettingsVisible = !settingsContainer.classList.contains('hidden');

    if (isSettingsVisible) {
        settingsContainer.classList.add('hidden');
        columnsContainer.classList.remove('hidden');
    } else {
        settingsContainer.classList.remove('hidden');
        columnsContainer.classList.add('hidden');
        helpContainer.classList.add('hidden'); // Also hide help
    }
}

function toggleHelp() {
    const isHelpVisible = !helpContainer.classList.contains('hidden');
    if (isHelpVisible) {
        helpContainer.classList.add('hidden');
        columnsContainer.classList.remove('hidden');
    } else {
        helpContainer.classList.remove('hidden');
        columnsContainer.classList.add('hidden');
        settingsContainer.classList.add('hidden'); // Also hide settings
    }
}

function setBackgroundOpacity(value) {
    document.documentElement.style.setProperty('--main-bg-opacity', value);
}

document.addEventListener('DOMContentLoaded', () => {
    initialize();
    // Load current hotkeys
    if (window.electronAPI.getHotkeys) {
        window.electronAPI.getHotkeys().then((hk) => {
            if (hkClickthrough && hk?.clickthroughHotkey) hkClickthrough.value = hk.clickthroughHotkey;
            if (hkToggleWindow && hk?.toggleWindowHotkey) hkToggleWindow.value = hk.toggleWindowHotkey;
        });
    }

    if (saveHotkeysBtn) {
        saveHotkeysBtn.addEventListener('click', async () => {
            const payload = {
                clickthroughHotkey: hkClickthrough?.value?.trim() || 'F6',
                toggleWindowHotkey: hkToggleWindow?.value?.trim() || 'F7',
            };
            try {
                await window.electronAPI.setHotkeys(payload);
                alert('Hotkeys saved. Restart app to apply.');
            } catch (e) {
                console.error('Failed to save hotkeys', e);
                alert('Failed to save hotkeys');
            }
        });
    }
    // Load and save OOC timer
    if (saveOocBtn && oocTimer) {
        fetch(`http://${SERVER_URL}/api/settings`).then((r) => r.json()).then((resp) => {
            if (resp?.data?.outOfCombatClearSeconds != null) oocTimer.value = resp.data.outOfCombatClearSeconds;
        }).catch(() => {});
        saveOocBtn.addEventListener('click', async () => {
            const seconds = Math.max(5, Math.min(600, parseInt(oocTimer.value || '15', 10)));
            try {
                await fetch(`http://${SERVER_URL}/api/settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ outOfCombatClearSeconds: seconds })
                });
                alert('Saved.');
            } catch {}
        });
    }

    // Fight timer updater: counts while in combat; after OOC threshold, freezes at (lastCombatTs - fightStartTs)
    setInterval(() => {
        if (currentEncounter !== 'current') { if (fightTimerEl) fightTimerEl.textContent = '--:--'; return; }
        const now = Date.now();
        const oocSec = parseInt(oocTimer?.value || '15', 10);
        if (!fightStartTs || !lastCombatTs) {
            if (fightTimerEl) fightTimerEl.textContent = '00:00';
            return;
        }
        const sinceLast = now - lastCombatTs;
        let showMs;
        if (sinceLast < oocSec * 1000) {
            showMs = Math.max(0, now - fightStartTs);
        } else {
            showMs = Math.max(0, lastCombatTs - fightStartTs); // subtract OOC window implicitly
        }
        const mm = String(Math.floor(showMs / 60000)).padStart(2, '0');
        const ss = String(Math.floor((showMs % 60000) / 1000)).padStart(2, '0');
        if (fightTimerEl) fightTimerEl.textContent = `${mm}:${ss}`;
    }, 500);
    function setActive(btn){ [modeDpsBtn,modeHpsBtn,modeTankingBtn,modeNpcTankingBtn].forEach(b=> b&&b.classList.remove('active')); btn&&btn.classList.add('active'); }
    if (modeDpsBtn) modeDpsBtn.addEventListener('click', () => { rankingMode = 'dps'; setActive(modeDpsBtn); updateAll(); });
    if (modeHpsBtn) modeHpsBtn.addEventListener('click', () => { rankingMode = 'hps'; setActive(modeHpsBtn); updateAll(); });
    if (modeTankingBtn) modeTankingBtn.addEventListener('click', () => { rankingMode = 'tanking'; setActive(modeTankingBtn); updateAll(); });
    if (modeNpcTankingBtn) modeNpcTankingBtn.addEventListener('click', () => { rankingMode = 'npc'; setActive(modeNpcTankingBtn); updateAll(); });
    setActive(modeDpsBtn);

    // Populate/refresh encounter list
    if (encounterSelect) {
        const refreshEncounters = () => {
            fetch(`http://${SERVER_URL}/api/history/list`).then(r=>r.json()).then((resp)=>{
                if (Array.isArray(resp?.data)) {
                    // newest first
                    resp.data.sort((a,b)=> Number(b) - Number(a));
                    for (const ts of resp.data) {
                        if (encounterOptions.has(ts)) continue;
                        encounterOptions.add(ts);
                        const opt = document.createElement('option');
                        opt.value = ts; opt.textContent = ts;
                        // Fetch meta to label as Name(Targets) [mm:ss]
                        fetch(`http://${SERVER_URL}/api/history/${ts}/meta`).then(r=>r.json()).then(meta=>{
                            if (meta?.code === 0 && meta.data) {
                                const name = meta.data.topEnemyName || ts;
                                const targets = meta.data.targetCount || 0;
                                const dur = meta.data.durationMs || 0;
                                const mm = String(Math.floor(dur/60000)).padStart(2,'0');
                                const ss = String(Math.floor((dur%60000)/1000)).padStart(2,'0');
                                opt.textContent = `${name}(${targets}) [${mm}:${ss}]`;
                            }
                        }).catch(()=>{});
                        encounterSelect.appendChild(opt);
                    }
                }
            }).catch(()=>{});
        };
        refreshEncounters();
        setInterval(refreshEncounters, 5000);
        encounterSelect.addEventListener('change', async (e)=>{
            currentEncounter = e.target.value || 'current';
            if (currentEncounter === 'current') {
                historicalUsers = null;
                historicalEnemies = null;
                updateAll();
                return;
            }
            try {
                const res = await fetch(`http://${SERVER_URL}/api/history/${currentEncounter}/data`);
                const json = await res.json();
                if (json?.code === 0 && json.user) {
                    // show historical users
                    historicalUsers = Object.entries(json.user).map(([id, u])=> ({ id, ...u }))
                        .filter((u)=> (u.total_dps>0 || u.total_hps>0 || (u.taken_damage||0)>0));
                    // optional: load enemies here similarly if needed
                    updateAll();
                }
            } catch {}
        });
    }

    setBackgroundOpacity(opacitySlider.value);

    opacitySlider.addEventListener('input', (event) => {
        setBackgroundOpacity(event.target.value);
    });

    // Listen for the passthrough toggle event from the main process
    window.electronAPI.onTogglePassthrough((isIgnoring) => {
        if (isIgnoring) {
            allButtons.forEach((button) => {
                button.classList.add('hidden');
            });
            passthroughTitle.classList.remove('hidden');
            // Update hotkey hint dynamically
            if (window.electronAPI.getHotkeys) {
                window.electronAPI.getHotkeys().then((hk) => {
                    const key = hk?.clickthroughHotkey || 'F6';
                    passthroughTitle.textContent = ` Clickthrough Enabled (${key}) `;
                });
            } else {
                passthroughTitle.textContent = ' Clickthrough Enabled (F6) ';
            }
            columnsContainer.classList.remove('hidden');
            settingsContainer.classList.add('hidden');
            helpContainer.classList.add('hidden');
        } else {
            allButtons.forEach((button) => {
                button.classList.remove('hidden');
            });
            passthroughTitle.classList.add('hidden');
        }
    });
});

window.clearData = clearData;
window.togglePause = togglePause;
window.toggleSettings = toggleSettings;
window.closeClient = closeClient;
window.toggleHelp = toggleHelp;
