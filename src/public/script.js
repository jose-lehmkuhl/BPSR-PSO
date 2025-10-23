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

const columnsContainer = document.getElementById('columnsContainer');
const modeDpsBtn = document.getElementById('modeDpsBtn');
const modeHpsBtn = document.getElementById('modeHpsBtn');
const modeTankingBtn = document.getElementById('modeTankingBtn');
const modeNpcTankingBtn = document.getElementById('modeNpcTankingBtn');
let rankingMode = 'dps';
const settingsContainer = document.getElementById('settingsContainer');
const helpContainer = document.getElementById('helpContainer');
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
        if (!userColors[user.id]) {
            userColors[user.id] = getNextColorShades();
        }
        const colors = userColors[user.id];
        const item = document.createElement('li');

        item.className = 'data-item';
        const damagePercent = totalDamageOverall > 0 ? (user.total_damage.total / totalDamageOverall) * 100 : 0;
        const healingPercent = totalHealingOverall > 0 ? (user.total_healing.total / totalHealingOverall) * 100 : 0;

        const professionString = user.profession ? user.profession.trim() : '';
        const specMatch = professionString ? professionString.match(/\([^)]*\)/) : null;
        const specSuffix = specMatch ? ` ${specMatch[0]}` : '';

        const baseName = `${user.name}${specSuffix}`;
        const displayName = user.fightPoint ? `${baseName} (${user.fightPoint})` : baseName;

        let classIconHtml = '';
        if (professionString) {
            const mainProfession = professionString.split('(')[0].trim();
            const iconFileName = mainProfession.toLowerCase().replace(/ /g, '_') + '.png';
            classIconHtml = `<img src="assets/${iconFileName}" class="class-icon" alt="${mainProfession}" onerror="this.style.display='none'">`;
        }

        let subBarHtml = '';
        if (user.total_healing.total > 0 || user.total_hps > 0) {
            subBarHtml = `
                <div class="sub-bar">
                    <div class="hps-bar-fill" style="width: ${healingPercent}%; background-color: ${colors.hps};"></div>
                    <div class="hps-stats">
                       ${formatNumber(user.total_healing.total)} (${formatNumber(user.total_hps)} HPS, ${healingPercent.toFixed(1)}%)
                    </div>
                </div>
            `;
        }

        let modeStats = `${formatNumber(user.total_damage.total)} (${formatNumber(user.total_dps)} DPS, ${damagePercent.toFixed(1)}%)`;
        let mainBarFill = `<div class="dps-bar-fill" style="width: ${damagePercent}%; background-color: ${colors.dps};"></div>`;
        if (mode === 'hps') {
            modeStats = `${formatNumber(user.total_healing.total)} (${formatNumber(user.total_hps)} HPS, ${healingPercent.toFixed(1)}%)`;
            mainBarFill = `<div class="hps-bar-fill" style="width: ${healingPercent}%; background-color: ${colors.hps};"></div>`;
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
    const totalNpcHpLoss = enemies.reduce((sum, e) => sum + ((e.max_hp || 0) - (e.hp || 0)), 0);
    enemies.sort((a, b) => (((b.max_hp||0)-(b.hp||0)) - ((a.max_hp||0)-(a.hp||0))));
    enemies.forEach((e, index) => {
        const item = document.createElement('li');
        item.className = 'data-item';
        const lost = Math.max(0, (e.max_hp || 0) - (e.hp || 0));
        const percent = totalNpcHpLoss > 0 ? (lost / totalNpcHpLoss) * 100 : 0;
        const name = e.name || `NPC #${e.id}`;
        item.innerHTML = `
            <div class="main-bar">
                <div class="tanking-bar-fill" style="width: ${percent}%; background-color: rgba(255,0,0,0.5);"></div>
                <div class="content">
                    <span class="rank">${index + 1}.</span>
                    <span class="name">${name}</span>
                    <span class="stats">${formatNumber(lost)} (${percent.toFixed(1)}%)</span>
                </div>
            </div>
        `;
        columnsContainer.appendChild(item);
    });
}

function updateAll() {
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

        const hasNewValidName = newUser.name && typeof newUser.name === 'string' && newUser.name !== '未知';
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
    function setActive(btn){ [modeDpsBtn,modeHpsBtn,modeTankingBtn,modeNpcTankingBtn].forEach(b=> b&&b.classList.remove('active')); btn&&btn.classList.add('active'); }
    if (modeDpsBtn) modeDpsBtn.addEventListener('click', () => { rankingMode = 'dps'; setActive(modeDpsBtn); updateAll(); });
    if (modeHpsBtn) modeHpsBtn.addEventListener('click', () => { rankingMode = 'hps'; setActive(modeHpsBtn); updateAll(); });
    if (modeTankingBtn) modeTankingBtn.addEventListener('click', () => { rankingMode = 'tanking'; setActive(modeTankingBtn); updateAll(); });
    if (modeNpcTankingBtn) modeNpcTankingBtn.addEventListener('click', () => { rankingMode = 'npc'; setActive(modeNpcTankingBtn); updateAll(); });
    setActive(modeDpsBtn);

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
