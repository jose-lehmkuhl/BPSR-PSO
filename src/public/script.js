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
// High-contrast class colors against white text (AA compliant heuristics)
const classColors = {
    'Stormblade': '#1E3A8A',      // dark blue
    'Frost Mage': '#065F46',      // dark teal
    'Fire Warrior': '#7C2D12',    // dark burnt orange
    'Wind Knight': '#14532D',     // dark green
    'Verdant Oracle': '#3F6212',  // dark olive
    'Marksman': '#7C3E0A',        // dark amber/brown
    'Heavy Guardian': '#374151',  // slate gray
    'Reaper': '#4C1D95',          // deep purple
    'Gunner': '#064E3B',          // deep teal/green
    'Shield Knight': '#1F2937',   // dark steel
    'Soul Musician': '#7E22CE',   // purple
};

function getBaseProfessionName(professionString) {
    if (!professionString) return '';
    return professionString.split('(')[0].trim();
}

const columnsContainer = document.getElementById('columnsContainer');
const modeMenuButton = document.getElementById('modeMenuButton');
const modeMenu = document.getElementById('modeMenu');
let rankingMode = 'dps';
const settingsContainer = document.getElementById('settingsContainer');
const helpContainer = document.getElementById('helpContainer');
const fightTimerEl = document.getElementById('fightTimer');
const oocTimer = document.getElementById('oocTimer');
const saveOocBtn = document.getElementById('saveOocBtn');
const encounterSelect = document.getElementById('encounterSelect');
const passthroughTitle = document.getElementById('passthroughTitle');
const clearButton = document.getElementById('clearButton');
const helpButton = document.getElementById('helpButton');
const settingsButton = document.getElementById('settingsButton');
const closeButton = document.getElementById('closeButton');
const allButtons = [clearButton, helpButton, settingsButton, closeButton].filter(Boolean);
const serverStatus = document.getElementById('serverStatus');
const opacitySlider = document.getElementById('opacitySlider');
const hkClickthrough = document.getElementById('hkClickthrough');
const hkToggleWindow = document.getElementById('hkToggleWindow');
const hkClear = document.getElementById('hkClear');
const saveHotkeysBtn = document.getElementById('saveHotkeysBtn');
const deleteLogsBtn = document.getElementById('deleteLogsBtn');
const breakdownModal = document.getElementById('breakdownModal');
const breakdownClose = document.getElementById('breakdownClose');
const breakdownBody = document.getElementById('breakdownBody');
const breakdownTitle = document.getElementById('breakdownTitle');

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
let wasOnCurrentEncounter = true;
let historicalUsers = null;
let historicalEnemies = null;
let lastKnownFightStart = 0;
let historicalEncounterSeconds = null;
let combatIdleMsFromServer = null;
let combatTimeMsFromServer = null;
let combatClockFromServer = { start: 0, last: 0, idle: 5000 };

const SERVER_URL = window.location.host;

function formatNumber(num) {
    if (isNaN(num)) return 'NaN';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return Math.round(num).toString();
}

function getCurrentEncounterSeconds() {
    if (currentEncounter !== 'current') return null;
    if (typeof combatTimeMsFromServer === 'number' && combatTimeMsFromServer >= 0) {
        return Math.floor(combatTimeMsFromServer / 1000);
    }
    // Fallback to server combatClock
    if (combatClockFromServer && combatClockFromServer.start && combatClockFromServer.last) {
        const now = Date.now();
        const clampEnd = Math.min(now, combatClockFromServer.last + (combatClockFromServer.idle || 5000));
        const ms = Math.max(0, clampEnd - combatClockFromServer.start);
        return Math.floor(ms / 1000);
    }
    return 0;
}

function renderDataList(users) {
    columnsContainer.innerHTML = '';

    const totalDamageOverall = users.reduce((sum, user) => sum + user.total_damage.total, 0);
    const totalHealingOverall = users.reduce((sum, user) => sum + user.total_healing.total, 0);
    const totalTakenOverall = users.reduce((sum, user) => sum + (user.taken_damage || 0), 0);
    // Top totals for relative-width bars (100% = top player)
    const topDamage = Math.max(1, ...users.map(u => u.total_damage.total || 0));
    const topHealing = Math.max(1, ...users.map(u => u.total_healing.total || 0));
    const topTaken  = Math.max(1, ...users.map(u => (u.taken_damage || 0)));

    const mode = rankingMode;
    const encSec = (currentEncounter === 'current') ? getCurrentEncounterSeconds() : (historicalEncounterSeconds || null);
    if (mode === 'hps') {
        users.sort((a, b) => {
            const ah = (currentEncounter === 'current') ? ((encSec && encSec>0) ? ((a.total_healing?.total || 0) / encSec) : 0) : ((encSec ? ((a.total_healing?.total || 0)/encSec) : (a.total_hps || 0)));
            const bh = (currentEncounter === 'current') ? ((encSec && encSec>0) ? ((b.total_healing?.total || 0) / encSec) : 0) : ((encSec ? ((b.total_healing?.total || 0)/encSec) : (b.total_hps || 0)));
            return bh - ah;
        });
    } else if (mode === 'tanking') {
        users.sort((a, b) => (b.taken_damage || 0) - (a.taken_damage || 0));
    } else {
        users.sort((a, b) => {
            const ad = (currentEncounter === 'current') ? ((encSec && encSec>0) ? ((a.total_damage?.total || 0) / encSec) : 0) : ((encSec ? ((a.total_damage?.total || 0)/encSec) : (a.total_dps || 0)));
            const bd = (currentEncounter === 'current') ? ((encSec && encSec>0) ? ((b.total_damage?.total || 0) / encSec) : 0) : ((encSec ? ((b.total_damage?.total || 0)/encSec) : (b.total_dps || 0)));
            return bd - ad;
        });
    }

    users.forEach((user, index) => {
        const professionString = user.profession ? user.profession.trim() : '';
        const baseProf = getBaseProfessionName(professionString);
        let barColor = classColors[baseProf];
        if (!barColor) {
            // Fixed color when class is unknown
            barColor = '#374151';
        }
        const item = document.createElement('li');

        item.className = 'data-item';
        const damagePercent = topDamage > 0 ? (user.total_damage.total / topDamage) * 100 : 0;
        const healingPercent = topHealing > 0 ? (user.total_healing.total / topHealing) * 100 : 0;

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

        const displayDps = (currentEncounter === 'current')
            ? ((encSec && encSec > 0) ? ((user.total_damage.total || 0) / encSec) : 0)
            : (encSec ? ((user.total_damage.total || 0) / encSec) : (user.total_dps || 0));
        const displayHps = (currentEncounter === 'current')
            ? ((encSec && encSec > 0) ? ((user.total_healing.total || 0) / encSec) : 0)
            : (encSec ? ((user.total_healing.total || 0) / encSec) : (user.total_hps || 0));
        let modeStats = `${formatNumber(user.total_damage.total)} (${formatNumber(displayDps)} DPS, ${damagePercent.toFixed(1)}%)`;
        let mainBarFill = `<div class="dps-bar-fill" style="width: ${damagePercent}%; background-color: ${barColor};"></div>`;
        if (mode === 'hps') {
            modeStats = `${formatNumber(user.total_healing.total)} (${formatNumber(displayHps)} HPS, ${healingPercent.toFixed(1)}%)`;
            mainBarFill = `<div class="hps-bar-fill" style="width: ${healingPercent}%; background-color: ${barColor};"></div>`;
        } else if (mode === 'tanking') {
            const tankTotal = user.taken_damage || 0;
            const tankPercent = topTaken > 0 ? (tankTotal / topTaken) * 100 : 0;
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
        // Attach breakdown click for DPS/HPS rows (anywhere on the item)
        item.addEventListener('click', () => {
            if (rankingMode === 'tanking' || rankingMode === 'npc') return;
            const payload = { uid: user.id, timestamp: currentEncounter };
            if (window?.electronAPI?.openBreakdown) {
                window.electronAPI.openBreakdown(payload);
            } else {
                openBreakdown(user);
            }
        });
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
        const usersArray = Object.values(allUsers).filter((user) => (user.total_damage?.total||0) > 0 || (user.total_healing?.total||0) > 0 || (user.taken_damage||0)>0);
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
    // Only apply scene start when server doesn't provide combat time (avoid using map time)
    if (typeof combatTimeMsFromServer !== 'number' && data.fightStartTime) {
        if (fightStartTs !== data.fightStartTime) {
            lastKnownFightStart = fightStartTs || 0;
            fightStartTs = data.fightStartTime;
            if (currentEncounter === 'current') {
                setTimeout(() => { if (window.refreshEncounters) window.refreshEncounters(); }, 700);
            }
        }
    }
    if (data.lastActivityTime) lastCombatTs = data.lastActivityTime;

    updateAll();
}

async function clearData() {
    try {
        const currentStatus = getServerStatus();
        showServerStatus('cleared');

        // Immediately wipe UI like SR DPS "Reload"
        allUsers = {}; allEnemies = {}; userColors = {};
        currentEncounter = 'current'; historicalUsers = null; historicalEnemies = null;
        fightStartTs = 0; lastCombatTs = 0; lastTotals = { dmg: 0, heal: 0 }; lastPerUser = {};
        updateAll();

        // Ask server to clear immediately (same flow as OOC timeout)
        let msg = '';
        let ok = false;
        try {
            const resp = await fetch(`/api/clear`);
            const js = await resp.json();
            ok = js?.code === 0; msg = js?.msg || '';
        } catch (e) { ok = false; }

        if (ok) {
            showServerStatus('cleared');
            console.log('Encounter reset/clear requested; counting from zero.');
        } else {
            console.error('Failed to reset/clear encounter on server:', msg);
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
    socket = io();

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
        if (typeof data.combatIdleMs === 'number') combatIdleMsFromServer = data.combatIdleMs;
        if (typeof data.combatTimeMs === 'number') combatTimeMsFromServer = data.combatTimeMs;
        if (data.combatClock && typeof data.combatClock === 'object') combatClockFromServer = data.combatClock;
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

function openBreakdown(user) {
    if (!user || !breakdownModal) return;
    // Build skills array from skill summaries on demand via API if historical; else from live snapshot composed server-side
    const uid = user.id;
        const isHistorical = currentEncounter !== 'current';
        const endpoint = isHistorical ? `http://${SERVER_URL}/api/history/${currentEncounter}/skill/${uid}` : `http://${SERVER_URL}/api/skill/${uid}`;
    fetch(endpoint).then(r=>r.json()).then((resp)=>{
        if (!(resp?.code === 0 && resp.data)) return;
        const data = resp.data;
        const skills = data.skills || {};
        const totalSum = Object.values(skills).reduce((s, v)=> s + (v.totalDamage||0), 0) || 1;
        const activeSeconds = isHistorical
            ? (historicalEncounterSeconds || 1)
            : Math.max(1, Math.floor(((typeof combatTimeMsFromServer === 'number' && combatTimeMsFromServer >= 0)
                ? combatTimeMsFromServer
                : (lastCombatTs && fightStartTs ? Math.max(0, Date.now() - fightStartTs) : 0)) / 1000));
        const rows = Object.entries(skills).map(([sid, s]) => {
            const total = s.totalDamage || 0;
            const dps = total / activeSeconds;
            const count = s.totalCount || 0;
            const critRate = s.critRate != null ? s.critRate : (s.totalCount ? (s.critCount || 0)/s.totalCount : 0);
            const avg = count ? total / count : 0;
            const pct = totalSum ? (total / totalSum) * 100 : 0;
            return { id: sid, name: s.displayName ?? sid, total, dps, count, critRate, avg, pct };
        }).sort((a,b)=> b.total - a.total);

        // Header
        const headerName = data.name || ('#'+uid);
        const headerProf = data.profession || '';
        const headerFp = (data.attr?.fightPoint || data.fightPoint) ? ` | AP ${data.attr?.fightPoint || data.fightPoint}` : '';
        breakdownTitle.textContent = `${headerName}${headerProf ? ' — ' + headerProf : ''}${headerFp}`;

        // Table
        const tableHtml = [
            '<div class="bd-header"><span class="title">Skill Breakdown</span><span>Active: '+activeSeconds+'s <span class="bd-badge">'+formatNumber(totalSum)+' total</span></span></div>',
            '<table class="bd-table">',
            '<thead><tr>',
            '<th>Skill</th><th style="text-align:right">Total</th><th style="text-align:right">DPS</th><th style="text-align:right">Hits</th><th style="text-align:right">Crit%</th><th style="text-align:right">Avg/Hit</th><th style="text-align:right">%</th>',
            '</tr></thead><tbody>'
        ];
        for (const r of rows) {
            tableHtml.push('<tr>');
            tableHtml.push('<td>'+r.name+'</td>');
            tableHtml.push('<td style="text-align:right">'+formatNumber(r.total)+'</td>');
            tableHtml.push('<td style="text-align:right">'+formatNumber(r.dps)+'</td>');
            tableHtml.push('<td style="text-align:right">'+r.count+'</td>');
            tableHtml.push('<td style="text-align:right">'+(r.critRate*100).toFixed(1)+'%</td>');
            tableHtml.push('<td style="text-align:right">'+formatNumber(r.avg)+'</td>');
            tableHtml.push('<td style="text-align:right">'+r.pct.toFixed(1)+'%</td>');
            tableHtml.push('</tr>');
        }
        tableHtml.push('</tbody></table>');
        breakdownBody.innerHTML = tableHtml.join('');
        breakdownModal.classList.remove('hidden');
    }).catch(()=>{});
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
            if (hkClear && hk?.clearHotkey) hkClear.value = hk.clearHotkey;
        });
    }

    if (saveHotkeysBtn) {
        saveHotkeysBtn.addEventListener('click', async () => {
            const payload = {
                clickthroughHotkey: hkClickthrough?.value?.trim() || 'F6',
                toggleWindowHotkey: hkToggleWindow?.value?.trim() || 'F7',
                clearHotkey: hkClear?.value?.trim() || 'F5',
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
        fetch(`/api/settings`).then((r) => r.json()).then((resp) => {
            if (resp?.data?.outOfCombatClearSeconds != null) oocTimer.value = resp.data.outOfCombatClearSeconds;
        }).catch(() => {});
        saveOocBtn.addEventListener('click', async () => {
            const seconds = Math.max(5, Math.min(600, parseInt(oocTimer.value || '15', 10)));
            try {
                await fetch(`/api/settings`, {
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
        const oocMs = (typeof combatIdleMsFromServer === 'number' && combatIdleMsFromServer > 0)
            ? combatIdleMsFromServer
            : (parseInt(oocTimer?.value || '15', 10) * 1000);
        if (!fightStartTs || !lastCombatTs) {
            if (fightTimerEl) fightTimerEl.textContent = '00:00';
            return;
        }
        // Prefer server-provided combat time to display the timer
        let showMs;
        if (typeof combatTimeMsFromServer === 'number' && combatTimeMsFromServer > 0) {
            showMs = combatTimeMsFromServer;
        } else if (combatClockFromServer && combatClockFromServer.start && combatClockFromServer.last) {
            const clampEnd = Math.min(now, combatClockFromServer.last + (combatClockFromServer.idle || 5000));
            showMs = Math.max(0, clampEnd - combatClockFromServer.start);
        } else {
            // No combat info yet → show 00:00 (do not use scene timers)
            showMs = 0;
        }
        const mm = String(Math.floor(showMs / 60000)).padStart(2, '0');
        const ss = String(Math.floor((showMs % 60000) / 1000)).padStart(2, '0');
        if (fightTimerEl) fightTimerEl.textContent = `${mm}:${ss}`;
    }, 500);
    if (modeMenuButton && modeMenu) {
        modeMenuButton.addEventListener('click', (e)=>{
            e.stopPropagation();
            modeMenu.classList.toggle('hidden');
        });
        modeMenu.querySelectorAll('.mode-item').forEach((el)=>{
            el.addEventListener('click', (e)=>{
                rankingMode = el.getAttribute('data-mode');
                modeMenu.classList.add('hidden');
                modeMenuButton.textContent = (rankingMode==='dps'?'🗡️': rankingMode==='hps'?'✚': rankingMode==='tanking'?'🛡️':'💀');
                updateAll();
            });
        });
        document.addEventListener('click', ()=> modeMenu.classList.add('hidden'));
    }

    if (deleteLogsBtn) {
        deleteLogsBtn.addEventListener('click', async ()=>{
            if (!confirm('Delete all encounter logs (except the current one)?')) return;
            try {
            const res = await fetch(`/api/history`, { method:'DELETE' });
                const js = await res.json();
                if (js.code === 0) {
                    alert('Logs deleted.');
                    if (window.refreshEncounters) window.refreshEncounters();
                } else {
                    alert('Failed to delete logs');
                }
            } catch(e) {
                alert('Failed to delete logs');
            }
        });
    }
    // Populate/refresh encounter list
    if (encounterSelect) {
        const refreshEncounters = () => {
            fetch(`/api/history/list`).then(r=>r.json()).then((resp)=>{
                if (!Array.isArray(resp?.data)) return;
                // newest first
                const list = resp.data.slice().sort((a,b)=> Number(b) - Number(a));
                // Build a set of current option values
                const existing = new Set(Array.from(encounterSelect.options).map(o=>o.value));
                const insertAfter = encounterSelect.querySelector('option[value="current"]');
                let insertRef = insertAfter ? insertAfter.nextSibling : encounterSelect.firstChild;
                for (const ts of list) {
                    if (existing.has(ts)) continue; // don't disturb current selection
                    // Fetch meta to label as Name(Targets) [mm:ss]
                    fetch(`/api/history/${ts}/meta`).then(r=>r.json()).then(meta=>{
                        if (!(meta?.code === 0 && meta.data)) return;
                        let labelText = '';
                        if (meta.data.label) {
                            labelText = meta.data.label;
                        } else {
                            const name = meta.data.topEnemyName || '';
                            const targets = meta.data.targetCount || 0;
                            const dur = meta.data.durationMs || 0;
                            const mm = String(Math.floor(dur/60000)).padStart(2,'0');
                            const ss = String(Math.floor((dur%60000)/1000)).padStart(2,'0');
                            labelText = `${name || 'Encounter'}(${targets}) [${mm}:${ss}]`;
                        }
                        const head = labelText.split('(')[0].trim();
                        if (!head || head === 'Encounter') return; // filter placeholder
                        const opt = document.createElement('option');
                        opt.value = ts; opt.textContent = labelText;
                        if (insertRef) {
                            encounterSelect.insertBefore(opt, insertRef);
                        } else {
                            encounterSelect.appendChild(opt);
                        }
                    }).catch(()=>{});
                }
                // Update labels for existing options (including the most recent one that just finalized)
                for (const opt of Array.from(encounterSelect.options)) {
                    const ts = opt.value;
                    if (!ts || ts === 'current') continue;
                    fetch(`/api/history/${ts}/meta`).then(r=>r.json()).then(meta=>{
                        if (!(meta?.code === 0 && meta.data)) return;
                        let labelText = meta.data.label;
                        if (!labelText) {
                            const name = meta.data.topEnemyName || '';
                            const targets = meta.data.targetCount || 0;
                            const dur = meta.data.durationMs || 0;
                            const mm = String(Math.floor(dur/60000)).padStart(2,'0');
                            const ss = String(Math.floor((dur%60000)/1000)).padStart(2,'0');
                            labelText = `${name || 'Encounter'}(${targets}) [${mm}:${ss}]`;
                        }
                        const head = (labelText || '').split('(')[0].trim();
                        if (!head || head === 'Encounter') return; // don't replace with placeholder
                        if (opt.textContent !== labelText) opt.textContent = labelText;
                    }).catch(()=>{});
                }
            }).catch(()=>{});
        };
        refreshEncounters();
        setInterval(refreshEncounters, 5000);
        // expose to other functions
        window.refreshEncounters = refreshEncounters;
        encounterSelect.addEventListener('change', async (e)=>{
            const nextEncounter = e.target.value || 'current';
            // If leaving current to view a historical encounter, end the current encounter immediately
            if (wasOnCurrentEncounter && nextEncounter !== 'current') {
                fetch(`/api/clear`).catch(()=>{});
            }
            currentEncounter = nextEncounter;
            if (currentEncounter === 'current') {
                historicalUsers = null;
                historicalEnemies = null;
                historicalEncounterSeconds = null;
                updateAll();
                wasOnCurrentEncounter = true;
                return;
            }
            try {
                // Load encounter meta to get duration seconds for historical DPS/HPS
                try {
                    const metaRes = await fetch(`/api/history/${currentEncounter}/meta`);
                    const metaJs = await metaRes.json();
                    if (metaJs?.code === 0 && metaJs.data) {
                        const durMs = Number(metaJs.data.durationMs || 0);
                        historicalEncounterSeconds = Math.max(1, Math.floor(durMs / 1000));
                    } else {
                        historicalEncounterSeconds = null;
                    }
                } catch (_) { historicalEncounterSeconds = null; }
                const res = await fetch(`/api/history/${currentEncounter}/data`);
                const json = await res.json();
                if (json?.code === 0) {
                    if (json.user) {
                        historicalUsers = Object.entries(json.user).map(([id, u])=> ({ id, ...u }))
                            .filter((u)=> (u.total_dps>0 || u.total_hps>0 || (u.taken_damage||0)>0));
                    } else { historicalUsers = []; }
                    if (json.enemies) {
                        historicalEnemies = Object.entries(json.enemies).map(([id, e])=> ({ id, ...e }));
                    } else { historicalEnemies = []; }
                    updateAll();
                    wasOnCurrentEncounter = false;
                }
            } catch {}
        });
    }

    // Breakdown modal close
    if (breakdownClose && breakdownModal) {
        breakdownClose.addEventListener('click', ()=> breakdownModal.classList.add('hidden'));
        breakdownModal.addEventListener('click', (e)=>{ if (e.target === breakdownModal) breakdownModal.classList.add('hidden'); });
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
window.relaunchApp = () => { try { window.electronAPI.relaunchApp(); } catch (e) { location.reload(); } };
window.togglePause = togglePause;
window.toggleSettings = toggleSettings;
window.closeClient = closeClient;
window.toggleHelp = toggleHelp;
window.openChecklist = () => { try { window.electronAPI.openChecklist(); } catch (e) {} };
