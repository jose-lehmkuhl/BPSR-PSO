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

// Inline breakdown: footer-based back button and renderers
function enterInlineHeader(_titleText) {
    try {
        // Footer toolbar elements
        const footer = document.querySelector('.footer-toolbar');
        const encounterLabel = footer ? footer.querySelector('label[for="encounterSelect"]') : null;
        const select = encounterSelect;
        if (encounterLabel) encounterLabel.classList.add('hidden');
        if (select) select.classList.add('hidden');
        // Create back button in footer
        if (!inlineBackBtn) {
            inlineBackBtn = document.createElement('button');
            inlineBackBtn.type = 'button';
            inlineBackBtn.textContent = '← Back';
            inlineBackBtn.className = 'btn';
            inlineBackBtn.onclick = ()=> {
                currentInlineView = null;
                exitInlineHeader();
                updateAll();
            };
        }
        if (footer && !inlineBackBtn.parentElement) {
            footer.appendChild(inlineBackBtn);
        }
        if (inlineBackBtn) inlineBackBtn.classList.remove('hidden');
    } catch {}
}

function exitInlineHeader() {
    try {
        const footer = document.querySelector('.footer-toolbar');
        const encounterLabel = footer ? footer.querySelector('label[for="encounterSelect"]') : null;
        const select = encounterSelect;
        if (encounterLabel) encounterLabel.classList.remove('hidden');
        if (select) select.classList.remove('hidden');
        if (inlineBackBtn) inlineBackBtn.classList.add('hidden');
    } catch {}
}

async function renderInlineSkills(user, modeOverride) {
    const uid = user.id;
    const isLiveSection = currentEncounter === 'current#section';
    const isHistorical = (currentEncounter !== 'current' && !isLiveSection);
    let endpoint = `/api/skill/${uid}`;
    if (isHistorical) {
        const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
        if (m) endpoint = `/api/history/${m[1]}/section/${m[2]}/skill/${uid}`;
        else endpoint = `/api/history/${currentEncounter}/skill/${uid}`;
    } else if (isLiveSection) {
        // Live section skill breakdown is not persisted; show a friendly message
        columnsContainer.innerHTML = '<div style="margin:8px">Skill breakdown for Current (Section) is available after the section closes (select the section under History). Use Current (Overall) for live skill totals.</div>';
        return;
    }
    try {
        const r = await fetch(endpoint);
        const resp = await r.json();
        const data = resp?.data || {};
        const skills = data.skills || {};
        if (!skillNameMap) {
            try {
                const nr = await fetch(`/api/skill-names`);
                const njs = await nr.json();
                if (njs && njs.data) skillNameMap = njs.data;
            } catch {}
        }
        const currentMode = modeOverride || rankingMode;
        const isHpsMode = (currentMode === 'hps');
        let skillEntries = Object.entries(skills)
            .filter(([sid, s]) => {
                const t = (s?.type || '').toString();
                const sidNum = Number(sid);
                if (isHpsMode) return t === '治疗' || (Number.isFinite(sidNum) && sidNum >= 1000000000);
                return t === '伤害' || (Number.isFinite(sidNum) && sidNum < 1000000000);
            })
            .map(([sid, s])=>{
                const rawName = (s.displayName ?? sid);
                let mapped = rawName;
                if (skillNameMap) {
                    const sidNum = Number(sid);
                    if (skillNameMap[String(sid)] != null) {
                        mapped = skillNameMap[String(sid)];
                    } else if (Number.isFinite(sidNum) && sidNum >= 1000000000 && skillNameMap[String(sidNum - 1000000000)] != null) {
                        // Normalize healing skill id back to base id for name mapping
                        mapped = skillNameMap[String(sidNum - 1000000000)];
                    }
                }
                return { id: sid, name: mapped, total: s.totalDamage||0, count: s.totalCount||0, critRate: (s.critRate!=null?s.critRate: ((s.totalCount||0)?(s.critCount||0)/(s.totalCount||0):0)) };
            });
        // Fallback mapping: if many names still equal IDs, try scene-level mapping file for this user
        try {
            const needsMap = skillEntries.some(e => String(e.name) === String(e.id) || /^\d+$/.test(String(e.name)));
            if (needsMap && isHistorical) {
                const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
                if (m) {
                    const sceneTs = m[1];
                    const rMap = await fetch(`/api/history/${sceneTs}/skill/${uid}`);
                    const jsMap = await rMap.json();
                    const sceneSkills = jsMap?.data?.skills || {};
                    const sceneNameMap = {};
                    for (const [sid, s] of Object.entries(sceneSkills)) {
                        sceneNameMap[String(sid)] = s.displayName ?? sid;
                    }
                    skillEntries = skillEntries.map(e => {
                        const sidNum = Number(e.id);
                        const baseKey = Number.isFinite(sidNum) && sidNum >= 1000000000 ? String(sidNum - 1000000000) : String(e.id);
                        const mapped = sceneNameMap[String(e.id)] || sceneNameMap[baseKey] || e.name;
                        return { ...e, name: mapped };
                    });
                }
            }
        } catch {}
        const totalSum = skillEntries.reduce((s, v)=> s + v.total, 0);
        const encSec = (currentEncounter === 'current') ? (getCurrentEncounterSeconds() || 1) : (historicalEncounterSeconds || 1);
        const top = Math.max(1, ...skillEntries.map(e=>e.total));
        const headerLeft = `${(data.name || ('#'+uid))}${data.profession?(' — '+data.profession):''}`;
        const headerRight = `Active: ${encSec || 1}s  Total: ${formatNumber(totalSum)}`;
        columnsContainer.innerHTML = '';
        const hdr = document.createElement('div');
        hdr.style.display = 'flex';
        hdr.style.justifyContent = 'space-between';
        hdr.style.margin = '6px 4px 10px';
        hdr.innerHTML = `<div style="font-weight:600">${isHpsMode?'Healing':'Damage'} Breakdown — ${headerLeft}</div><div>${headerRight}</div>`;
        columnsContainer.appendChild(hdr);
        const list = document.createElement('ul');
        list.className = 'data-list';
        list.style.padding = '0';
        list.style.margin = '0';
        list.style.listStyle = 'none';
        for (const e of skillEntries.sort((a,b)=> b.total - a.total)) {
            const percent = top > 0 ? (e.total / top) * 100 : 0;
            const dps = (e.total || 0) / (encSec || 1);
            const item = document.createElement('li');
            item.className = 'data-item';
            item.style.margin = '0 0 4px 0';
            const barFillColor = '#2563eb';
            item.innerHTML = `
                <div class="main-bar" style="width: 100%;">
                    <div class="dps-bar-fill" style="width: ${percent}%; background-color: ${barFillColor};"></div>
                    <div class="content">
                        <span class="name">${e.name}</span>
                        <span class="stats">${formatNumber(e.total)} (${formatNumber(dps)} ${isHpsMode?'HPS':'DPS'}, ${(totalSum? (e.total/totalSum*100):0).toFixed(1)}%)</span>
                    </div>
                </div>
            `;
            list.appendChild(item);
        }
        columnsContainer.appendChild(list);
    } catch {
        columnsContainer.innerHTML = '<div style="margin:8px">Failed to load skills.</div>';
    }
}

async function renderInlineNpc(enemyUid, enemyName) {
    const isLiveSection = currentEncounter === 'current#section';
    const isHistorical = (currentEncounter !== 'current' && !isLiveSection);
    let endpoint = `/api/npc/${enemyUid}`;
    if (isHistorical) {
        const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
        if (m) endpoint = `/api/history/${m[1]}/section/${m[2]}/npc/${enemyUid}`;
        else endpoint = `/api/history/${currentEncounter}/npc/${enemyUid}`;
    } // live section falls back to live scene endpoint (no per-section live API)
    try {
        const r = await fetch(endpoint);
        const resp = await r.json();
        const data = resp?.data || {};
        const total = data.total || 0;
        columnsContainer.innerHTML = '';
        const hdr = document.createElement('div');
        hdr.style.display = 'flex';
        hdr.style.justifyContent = 'space-between';
        hdr.style.margin = '6px 4px 10px';
        hdr.innerHTML = `<div style="font-weight:600">NPC Breakdown — ${data.enemyName || enemyName || ('#'+enemyUid)}</div><div>Total: ${formatNumber(total)}</div>`;
        columnsContainer.appendChild(hdr);
        const items = Array.isArray(data.items)? data.items : [];
        const top = Math.max(1, ...items.map(i=>i.amount||0));
        const list = document.createElement('ul');
        list.className = 'data-list';
        list.style.padding = '0';
        list.style.margin = '0';
        list.style.listStyle = 'none';
        for (const it of items.sort((a,b)=> b.amount - a.amount)) {
            const percent = top>0 ? (it.amount/top)*100 : 0;
            const item = document.createElement('li');
            item.className = 'data-item';
            item.style.margin = '0 0 4px 0';
            item.innerHTML = `
                <div class="main-bar" style="width: 100%;">
                    <div class="tanking-bar-fill" style="width: ${percent}%; background-color: rgba(255,0,0,0.5);"></div>
                    <div class="content">
                        <span class="name">${it.name || ('#'+it.attackerUid)}</span>
                        <span class="stats">${formatNumber(it.amount)} (${((total? (it.amount/total*100):0).toFixed(1))}%)</span>
                    </div>
                </div>
            `;
            list.appendChild(item);
        }
        columnsContainer.appendChild(list);
    } catch {
        columnsContainer.innerHTML = '<div style="margin:8px">Failed to load NPC breakdown.</div>';
    }
}

async function renderInlineTanking(user) {
    const uid = user.id;
    const isLiveSection = currentEncounter === 'current#section';
    const isHistorical = (currentEncounter !== 'current' && !isLiveSection);
    let endpoint = `/api/tanking/${uid}`;
    if (isHistorical) {
        const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
        if (m) endpoint = `/api/history/${m[1]}/section/${m[2]}/tanking/${uid}`;
        else endpoint = `/api/history/${currentEncounter}/tanking/${uid}`;
    } // live section falls back to live scene endpoint (no per-section live API)
    try {
        const r = await fetch(endpoint);
        const resp = await r.json();
        const data = resp?.data || {};
        const total = data.total || 0;
        columnsContainer.innerHTML = '';
        const hdr = document.createElement('div');
        hdr.style.display = 'flex';
        hdr.style.justifyContent = 'space-between';
        hdr.style.margin = '6px 4px 10px';
        const headerName = (user.name && user.name!=='...') ? user.name : ('#'+uid);
        hdr.innerHTML = `<div style="font-weight:600">Tanking Breakdown — ${headerName}</div><div>Total: ${formatNumber(total)}</div>`;
        columnsContainer.appendChild(hdr);
        const items = Array.isArray(data.items)? data.items : [];
        const top = Math.max(1, ...items.map(i=>i.amount||0));
        const list = document.createElement('ul');
        list.className = 'data-list';
        list.style.padding = '0';
        list.style.margin = '0';
        list.style.listStyle = 'none';
        for (const it of items.sort((a,b)=> b.amount - a.amount)) {
            const percent = top>0 ? (it.amount/top)*100 : 0;
            const item = document.createElement('li');
            item.className = 'data-item';
            item.style.margin = '0 0 4px 0';
            item.innerHTML = `
                <div class="main-bar" style="width: 100%;">
                    <div class="tanking-bar-fill" style="width: ${percent}%; background-color: rgba(255,0,0,0.5);"></div>
                    <div class="content">
                        <span class="name">${it.name || ('#'+it.attackerUid)}</span>
                        <span class="stats">${formatNumber(it.amount)} (${((total? (it.amount/total*100):0).toFixed(1))}%)</span>
                    </div>
                </div>
            `;
            list.appendChild(item);
        }
        columnsContainer.appendChild(list);
    } catch {
        columnsContainer.innerHTML = '<div style="margin:8px">Failed to load Tanking breakdown.</div>';
    }
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
let liveEncounterSeconds = 0; // monotonic combat seconds within the current scene
let lastSceneStartTs = 0;
let currentInlineView = null; // { type: 'skills'|'npc'|'tanking', payload: {...} }
let inlineBackBtn = null;
let prevHeaderText = '';
let skillNameMap = null;
let lastSectionStartNotified = 0;

const SERVER_URL = window.location.host;

function formatNumber(num) {
    if (isNaN(num)) return 'NaN';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return Math.round(num).toString();
}

function renderTotalBar(users, encSec) {
    const container = document.getElementById('totalBarContainer');
    if (!container) return;
    // For NPC/tanking views or inline breakdown, hide the bar
    if (rankingMode === 'npc' || currentInlineView) { container.classList.add('hidden'); container.innerHTML = ''; return; }
    const totalDamage = users.reduce((sum, u)=> sum + ((u.total_damage?.total)||0), 0);
    const dps = (encSec && encSec>0) ? (totalDamage / encSec) : 0;
    const labelLeft = 'All';
    const labelRight = `${formatNumber(totalDamage)} (${formatNumber(dps)} DPS)`;
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="total-bar">
            <div class="total-bar-fill"></div>
            <div class="total-bar-content">
                <span>${labelLeft}</span>
                <span>${labelRight}</span>
            </div>
        </div>
    `;
}

function getCurrentEncounterSeconds() {
    if (currentEncounter !== 'current') return null;
    if (liveEncounterSeconds && liveEncounterSeconds > 0) {
        return liveEncounterSeconds;
    }
    if (typeof combatTimeMsFromServer === 'number' && combatTimeMsFromServer >= 0) {
        return Math.floor(combatTimeMsFromServer / 1000);
    }
    // Fallback to server combatClock
    if (combatClockFromServer && combatClockFromServer.start && combatClockFromServer.last) {
        const now = Date.now();
        // Exclude idle buffer: clamp to lastDamageTs
        const clampEnd = Math.min(now, combatClockFromServer.last);
        const ms = Math.max(0, clampEnd - combatClockFromServer.start);
        return Math.floor(ms / 1000);
    }
    return 0;
}

function renderDataList(users) {
    // Inline breakdown view takes precedence
    if (currentInlineView) {
        if (currentInlineView.type === 'skills') return renderInlineSkills(currentInlineView.payload.user, currentInlineView.payload.mode);
        if (currentInlineView.type === 'npc') return renderInlineNpc(currentInlineView.payload.enemyUid, currentInlineView.payload.enemyName);
        if (currentInlineView.type === 'tanking') return renderInlineTanking(currentInlineView.payload.user);
    }
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

        // Capture current mode on the DOM node to use at click time (avoids race with mode switch)
        item.dataset.mode = rankingMode;
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
            if (rankingMode === 'npc') return;
            if (rankingMode === 'tanking') {
                currentInlineView = { type: 'tanking', payload: { user } };
                enterInlineHeader('Tanking Breakdown');
                updateAll(); return;
            }
            const mode = item.dataset.mode || rankingMode;
            currentInlineView = { type: 'skills', payload: { user, mode } };
            enterInlineHeader(`${mode==='hps'?'Healing':'Damage'} Breakdown`);
            updateAll();
        });
        columnsContainer.appendChild(item);
    });
}

function renderNpcTankingList(enemies) {
    if (currentInlineView && currentInlineView.type === 'npc') {
        return renderInlineNpc(currentInlineView.payload.enemyUid, currentInlineView.payload.enemyName);
    }
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
        // Open NPC breakdown (who hit this enemy and how much)
        item.addEventListener('click', () => {
            currentInlineView = { type: 'npc', payload: { enemyUid: e.id, enemyName: displayName } };
            enterInlineHeader('NPC Breakdown');
            updateAll();
        });
        columnsContainer.appendChild(item);
    });
}

function updateAll() {
    if (currentEncounter !== 'current' && currentEncounter !== 'current#section') {
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
    if (currentEncounter === 'current#section') {
        const usersArray = Object.values(allUsers).filter((user) => (user.total_damage?.total||0) > 0 || (user.total_healing?.total||0) > 0 || (user.taken_damage||0)>0);
        const sec = window.__liveSection || null;
        const encSec = (() => {
            if (sec && sec.start && sec.end) return Math.max(1, Math.floor((Math.min(Date.now(), sec.end) - sec.start) / 1000));
            if (combatClockFromServer && combatClockFromServer.start && combatClockFromServer.last) {
                const now = Date.now();
                const clampEnd = Math.min(now, combatClockFromServer.last);
                return Math.max(1, Math.floor((clampEnd - combatClockFromServer.start) / 1000));
            }
            return 1;
        })();
        const totals = (sec && sec.totals) ? sec.totals : {};
        const mapped = usersArray.map(u => {
            const t = totals[String(u.id)] || { damage: 0, healing: 0 };
            return {
                ...u,
                total_damage: { total: t.damage || 0 },
                total_healing: { total: t.healing || 0 },
                total_dps: (t.damage || 0) / encSec,
                total_hps: (t.healing || 0) / encSec
            };
        });
        renderDataList(mapped);
        return;
    }
    if (rankingMode === 'npc') {
        const enemiesArray = Object.entries(allEnemies).map(([id, e]) => ({ id, ...e }))
            .filter((e) => (e.hp || 0) >= 0);
        renderNpcTankingList(enemiesArray);
    } else {
        const usersArray = Object.values(allUsers).filter((user) => (user.total_damage?.total||0) > 0 || (user.total_healing?.total||0) > 0 || (user.taken_damage||0)>0);
        renderDataList(usersArray);
        if (!currentInlineView) {
            // const encSec = getCurrentEncounterSeconds();
            // renderTotalBar(usersArray, encSec);
        } else {
            // ensure total-bar hidden in inline view
            const container = document.getElementById('totalBarContainer');
            if (container) { container.classList.add('hidden'); container.innerHTML = ''; }
        }
    }
}

function processDataUpdate(data) {
    if (isPaused) return;
    if (!data.user) {
        console.warn('Received data without a "user" object:', data);
        return;
    }
    if (data.liveSection) {
        window.__liveSection = data.liveSection;
    }
    // Refresh encounter list only when a new section starts (to avoid flicker)
    try {
        const ls = data.liveSection;
        if (ls && typeof ls.start === 'number' && ls.start > 0 && ls.start !== lastSectionStartNotified) {
            lastSectionStartNotified = ls.start;
            if (window.refreshEncounters) window.refreshEncounters();
        }
    } catch(_) {}

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

    // Remove any client-side encounter reset heuristics; rely only on scene changes.
    // Keep last totals for potential future display/diagnostics, but do not reset UI or timers locally.
    const nowTs = Date.now();
    const sumDmg = Object.values(allUsers).reduce((s,u)=> s + ((u.total_damage?.total)||0), 0);
    const sumHeal = Object.values(allUsers).reduce((s,u)=> s + ((u.total_healing?.total)||0), 0);
    lastTotals = { dmg: sumDmg, heal: sumHeal };

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
        // Detect new scene by start time; reset live accumulator
        if (typeof data.fightStartTime === 'number') {
            if (lastSceneStartTs !== data.fightStartTime) {
                lastSceneStartTs = data.fightStartTime;
                liveEncounterSeconds = 0;
            }
        }
        if (typeof data.combatIdleMs === 'number') combatIdleMsFromServer = data.combatIdleMs;
        if (typeof data.combatTimeMs === 'number') combatTimeMsFromServer = data.combatTimeMs;
        if (data.combatClock && typeof data.combatClock === 'object') combatClockFromServer = data.combatClock;
        // Update monotonic combat seconds to avoid transient drops
        let secsCandidate = 0;
        if (typeof combatTimeMsFromServer === 'number' && combatTimeMsFromServer >= 0) {
            secsCandidate = Math.floor(combatTimeMsFromServer / 1000);
        } else if (combatClockFromServer && combatClockFromServer.start && combatClockFromServer.last) {
            const now = Date.now();
            const clampEnd = Math.min(now, combatClockFromServer.last);
            const ms = Math.max(0, clampEnd - combatClockFromServer.start);
            secsCandidate = Math.floor(ms / 1000);
        }
        if (secsCandidate > liveEncounterSeconds) {
            liveEncounterSeconds = secsCandidate;
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

function openTankingBreakdown(user) {
    if (!user || !breakdownModal) return;
    const uid = user.id;
    const isHistorical = currentEncounter !== 'current';
    // Support section-specific history (value format: ts#sec:idx)
    let endpoint = `/api/tanking/${uid}`;
    if (isHistorical) {
        const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
        if (m) {
            endpoint = `/api/history/${m[1]}/section/${m[2]}/tanking/${uid}`;
        } else {
            endpoint = `/api/history/${currentEncounter}/tanking/${uid}`;
        }
    }
    fetch(endpoint).then(r=>r.json()).then(resp=>{
        if (!(resp?.code === 0 && resp.data)) return;
        const data = resp.data;
        const total = data.total || 0;
        const items = Array.isArray(data.items) ? data.items : [];
        const rows = items.map(it=> ({ name: it.name || ('#'+it.attackerUid), total: it.amount||0, pct: total? ((it.amount||0)/total*100):0 })).sort((a,b)=> b.total-a.total);
        const encSec = getCurrentEncounterSeconds() || 1;
        // Header
        const headerName = (user.name && user.name!=='...') ? user.name : ('#'+uid);
        breakdownTitle.textContent = `${headerName} — Tanking Breakdown`;
        // Table
        const tableHtml = [
            '<div class="bd-header"><span class="title">Tanking Sources</span><span>Total: '+formatNumber(total)+'</span></div>',
            '<table class="bd-table">',
            '<thead><tr>',
            '<th>Source</th><th style="text-align:right">Total</th><th style="text-align:right">%</th>',
            '</tr></thead><tbody>'
        ];
        for (const r of rows) {
            tableHtml.push('<tr>');
            tableHtml.push('<td>'+r.name+'</td>');
            tableHtml.push('<td style="text-align:right">'+formatNumber(r.total)+'</td>');
            tableHtml.push('<td style="text-align:right">'+r.pct.toFixed(1)+'%</td>');
            tableHtml.push('</tr>');
        }
        tableHtml.push('</tbody></table>');
        breakdownBody.innerHTML = tableHtml.join('');
        breakdownModal.classList.remove('hidden');
    }).catch(()=>{});
}

function openNpcBreakdown(enemyUid, enemyName) {
    if (!breakdownModal) return;
    const isHistorical = currentEncounter !== 'current';
    const buildAndShow = (resp) => {
        if (!(resp?.code === 0 && resp.data)) return false;
        const data = resp.data;
        const total = data.total || 0;
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) return false;
        const rows = items.map(it=> ({ name: it.name || ('#'+it.attackerUid), total: it.amount||0, pct: total? ((it.amount||0)/total*100):0 })).sort((a,b)=> b.total-a.total);
        const title = data.enemyName || enemyName || ('#'+enemyUid);
        breakdownTitle.textContent = `${title} — NPC Breakdown`;
        const tableHtml = [
            '<div class="bd-header"><span class="title">Damage By Player</span><span>Total: '+formatNumber(total)+'</span></div>',
            '<table class="bd-table">',
            '<thead><tr>',
            '<th>Player</th><th style="text-align:right">Total</th><th style="text-align:right">%</th>',
            '</tr></thead><tbody>'
        ];
        for (const r of rows) {
            tableHtml.push('<tr>');
            tableHtml.push('<td>'+r.name+'</td>');
            tableHtml.push('<td style="text-align:right">'+formatNumber(r.total)+'</td>');
            tableHtml.push('<td style="text-align:right">'+r.pct.toFixed(1)+'%</td>');
            tableHtml.push('</tr>');
        }
        tableHtml.push('</tbody></table>');
        breakdownBody.innerHTML = tableHtml.join('');
        breakdownModal.classList.remove('hidden');
        return true;
    };
    (async ()=>{
        try {
            if (isHistorical) {
                const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
                if (m) {
                    const r = await fetch(`/api/history/${m[1]}/section/${m[2]}/npc/${enemyUid}`);
                    const js = await r.json();
                    buildAndShow(js);
                    return;
                }
                const r2 = await fetch(`/api/history/${currentEncounter}/npc/${enemyUid}`);
                const js2 = await r2.json();
                buildAndShow(js2);
                return;
            }
            const rLive = await fetch(`/api/npc/${enemyUid}`);
            const jsLive = await rLive.json();
            buildAndShow(jsLive);
        } catch(_){ }
    })();
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

function openBreakdown(user, modeOverride) {
    if (!user || !breakdownModal) return;
    // Build skills array from skill summaries on demand via API if historical; else from live snapshot composed server-side
    const uid = user.id;
    const isHistorical = currentEncounter !== 'current';
    const buildAndShow = async (resp) => {
        if (!(resp?.code === 0 && resp.data)) return false;
        const data = resp.data || {};
        const skills = data.skills || {};
        const currentMode = modeOverride || rankingMode;
        const isHpsMode = (currentMode === 'hps');
        const skillEntries = Object.entries(skills)
            .filter(([sid, s]) => {
                const t = (s?.type || '').toString();
                const sidNum = Number(sid);
                if (isHpsMode) {
                    // healing: explicit type or healing-sid heuristic (sid shifted by +1e9 in addHealing)
                    return t === '治疗' || (Number.isFinite(sidNum) && sidNum >= 1000000000);
                }
                // damage: explicit type or sid below 1e9
                return t === '伤害' || (Number.isFinite(sidNum) && sidNum < 1000000000);
            });
        const totalSum = skillEntries.reduce((s, [_, v])=> s + (v.totalDamage||0), 0) || 0;
        const activeSeconds = isHistorical
            ? (historicalEncounterSeconds || 1)
            : Math.max(1, Math.floor(((typeof combatTimeMsFromServer === 'number' && combatTimeMsFromServer >= 0)
                ? combatTimeMsFromServer
                : (lastCombatTs && fightStartTs ? Math.max(0, Date.now() - fightStartTs) : 0)) / 1000));
        const rows = skillEntries.map(([sid, s]) => {
            const total = s.totalDamage || 0;
            const dps = total / activeSeconds; // shown as DPS/HPS depending on mode
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
            '<div class="bd-header"><span class="title">'+(isHpsMode?'Healing':'Damage')+' Breakdown</span><span>Active: '+activeSeconds+'s <span class="bd-badge">'+formatNumber(totalSum)+' total</span></span></div>',
            '<table class="bd-table">',
            '<thead><tr>',
            '<th>Skill</th><th style="text-align:right">Total</th><th style="text-align:right">'+(isHpsMode?'HPS':'DPS')+'</th><th style="text-align:right">Hits</th><th style="text-align:right">Crit%</th><th style="text-align:right">Avg/Hit</th><th style="text-align:right">%</th>',
            '</tr></thead><tbody>'
        ];
        if (rows.length === 0) {
            tableHtml.push('<tr><td colspan="7" style="text-align:center;color:#aaa">No skill data for this selection.</td></tr>');
        } else {
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
        }
        tableHtml.push('</tbody></table>');
        // Add Damage by Target list (DPS mode only)
        if (!isHpsMode) {
            try {
                let ptUrl = null;
                if (isHistorical) {
                    const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
                    if (m) ptUrl = `/api/history/${m[1]}/section/${m[2]}/player-targets/${uid}`;
                    else ptUrl = `/api/history/${currentEncounter}/player-targets/${uid}`;
                }
                if (ptUrl) {
                    const pr = await fetch(ptUrl);
                    const pjs = await pr.json();
                    if (pjs?.code === 0 && pjs.data) {
                        const items = Array.isArray(pjs.data.items) ? pjs.data.items : [];
                        const totalT = pjs.data.total || 0;
                        tableHtml.push('<div class="bd-header" style="margin-top:10px"><span class="title">Damage By Target</span><span>Total: '+formatNumber(totalT)+'</span></div>');
                        tableHtml.push('<table class="bd-table"><thead><tr><th>Target</th><th style="text-align:right">Total</th><th style="text-align:right">%</th></tr></thead><tbody>');
                        if (items.length === 0) {
                            tableHtml.push('<tr><td colspan="3" style="text-align:center;color:#aaa">No target data.</td></tr>');
                        } else {
                            for (const it of items) {
                                const pct = totalT ? (it.amount/totalT*100) : 0;
                                tableHtml.push('<tr><td>'+ (it.name || ('#'+it.targetUid)) +'</td><td style="text-align:right">'+formatNumber(it.amount)+'</td><td style="text-align:right">'+pct.toFixed(1)+'%</td></tr>');
                            }
                        }
                        tableHtml.push('</tbody></table>');
                    }
                }
            } catch (_) {}
        }
        breakdownBody.innerHTML = tableHtml.join('');
        breakdownModal.classList.remove('hidden');
        return true;
    };
    // Prefer Electron window when available (supports scene and section via timestamp parsing)
    if (window?.electronAPI?.openBreakdown) {
        const payload = { uid: user.id, timestamp: isHistorical ? currentEncounter : 'current' };
        window.electronAPI.openBreakdown(payload);
        return;
    }
    (async ()=>{
        try {
            if (isHistorical) {
                const m = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
                if (m) {
                    const r = await fetch(`/api/history/${m[1]}/section/${m[2]}/skill/${uid}`);
                    const js = await r.json();
                    buildAndShow(js);
                    return;
                }
                const r2 = await fetch(`/api/history/${currentEncounter}/skill/${uid}`);
                const js2 = await r2.json();
                buildAndShow(js2);
                return;
            }
            const rLive = await fetch(`/api/skill/${uid}`);
            const jsLive = await rLive.json();
            buildAndShow(jsLive);
        } catch(_){ }
    })();
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
    // Default selection: Current (Section)
    try {
        if (encounterSelect) {
            encounterSelect.value = 'current#section';
            currentEncounter = 'current#section';
        }
    } catch {}
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
    // Removed OOC timer settings (scene-session mode controls resets)

    // Fight timer updater: counts while in combat; after OOC threshold, freezes at (lastCombatTs - fightStartTs)
    setInterval(() => {
        if (currentEncounter !== 'current') { if (fightTimerEl) fightTimerEl.textContent = '--:--'; return; }
        const now = Date.now();
        if (!fightStartTs || !lastCombatTs) {
            if (fightTimerEl) fightTimerEl.textContent = '00:00';
            return;
        }
        // Prefer server-provided combat time to display the timer
        let showMs;
        if (liveEncounterSeconds && liveEncounterSeconds > 0) {
            showMs = liveEncounterSeconds * 1000;
        } else if (typeof combatTimeMsFromServer === 'number' && combatTimeMsFromServer > 0) {
            showMs = combatTimeMsFromServer;
        } else if (combatClockFromServer && combatClockFromServer.start && combatClockFromServer.last) {
            // Exclude idle buffer: clamp to lastDamageTs
            const clampEnd = Math.min(now, combatClockFromServer.last);
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
            const selectedBefore = encounterSelect.value || 'current';
            // Reset select to desired base ordering: Current (Overall), Current (Section)
            encounterSelect.innerHTML = '';
            const optCur = document.createElement('option');
            optCur.value = 'current';
            optCur.textContent = 'Current (Overall)';
            encounterSelect.appendChild(optCur);
            const optCurSec = document.createElement('option');
            optCurSec.value = 'current#section';
            optCurSec.textContent = 'Current (Section)';
            encounterSelect.appendChild(optCurSec);
            // Then append historical scenes (newest first) and their sections
            fetch(`/api/history/list`).then(r=>r.json()).then((resp)=>{
                if (!Array.isArray(resp?.data)) return;
                const list = resp.data.slice().sort((a,b)=> Number(b) - Number(a));
                for (const ts of list) {
                    // Fetch meta to label as Name(Targets) Overall [mm:ss]
                    fetch(`/api/history/${ts}/meta`).then(r=>r.json()).then(meta=>{
                        if (!(meta?.code === 0 && meta.data)) return;
                        let labelText = '';
                        if (meta.data.label) {
                            const idx = meta.data.label.lastIndexOf('[');
                            if (idx > 0) {
                                const headText = meta.data.label.slice(0, idx).trim();
                                const tailText = meta.data.label.slice(idx);
                                labelText = `${headText} Overall ${tailText}`;
                            } else {
                                labelText = meta.data.label;
                            }
                        } else {
                            const name = meta.data.topEnemyName || '';
                            const targets = meta.data.targetCount || 0;
                            const dur = meta.data.durationMs || 0;
                            const mm = String(Math.floor(dur/60000)).padStart(2,'0');
                            const ss = String(Math.floor((dur%60000)/1000)).padStart(2,'0');
                            labelText = `${name || 'Encounter'}(${targets}) Overall [${mm}:${ss}]`;
                        }
                        const head = (labelText || '').split('(')[0].trim();
                        if (!head || head === 'Encounter') return;
                        const opt = document.createElement('option');
                        opt.value = ts;
                        opt.textContent = labelText;
                        encounterSelect.appendChild(opt);
                        // Append section entries for this scene (newest first), grouped right under this scene
                        fetch(`/api/history/${ts}/analysis`).then(r=>r.json()).then(analysis=>{
                            if (!(analysis?.code === 0 && Array.isArray(analysis.data?.sections))) return;
                            const sceneName = analysis.data.sceneName || head || '';
                            const secs = analysis.data.sections.slice().sort((a,b)=> (b.end||0) - (a.end||0));
                            // anchor starts at the scene option; each section is inserted right after the last inserted one
                            let anchor = opt;
                            for (let i = 0; i < secs.length; i++) {
                                const s = secs[i];
                                const val = `${ts}#sec:${s.index}`;
                                const d = s.durationMs || 0;
                                const mm = String(Math.floor(d/60000)).padStart(2,'0');
                                const ss = String(Math.floor((d%60000)/1000)).padStart(2,'0');
                                const secLabel = `Sec ${s.index+1} — ${s.topEnemyName || 'Section'} [${mm}:${ss}] — Scene: ${sceneName}`;
                                let secOpt = encounterSelect.querySelector(`option[value="${val}"]`);
                                if (!secOpt) {
                                    secOpt = document.createElement('option');
                                    secOpt.value = val;
                                }
                                if (secOpt.textContent !== secLabel) secOpt.textContent = secLabel;
                                // Ensure placement immediately after the current anchor
                                if (secOpt.parentElement !== encounterSelect || secOpt.previousSibling !== anchor) {
                                    if (secOpt.parentElement === encounterSelect) {
                                        encounterSelect.removeChild(secOpt);
                                    }
                                    if (anchor && anchor.nextSibling) {
                                        encounterSelect.insertBefore(secOpt, anchor.nextSibling);
                                    } else {
                                        encounterSelect.appendChild(secOpt);
                                    }
                                }
                                anchor = secOpt;
                            }
                            // Restore selection if it still exists
                            if (encounterSelect.querySelector(`option[value="${selectedBefore}"]`)) {
                                encounterSelect.value = selectedBefore;
                            }
                        }).catch(()=>{});
                    }).catch(()=>{});
                }
            }).catch(()=>{});
        };
        refreshEncounters();
        // expose to other functions
        window.refreshEncounters = refreshEncounters;
        encounterSelect.addEventListener('change', async (e)=>{
            const nextEncounter = e.target.value || 'current';
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
                // Support scene or section selection
                const secMatch = currentEncounter.match(/^([0-9]+)#sec:(\d+)$/);
                if (secMatch) {
                    const ts = secMatch[1];
                    const idx = secMatch[2];
                    // meta
                    try {
                        const mres = await fetch(`/api/history/${ts}/section/${idx}/meta`);
                        const mjs = await mres.json();
                        if (mjs?.code === 0 && mjs.data) {
                            const durMs = Number(mjs.data.durationMs || 0);
                            historicalEncounterSeconds = Math.max(1, Math.floor(durMs / 1000));
                        } else {
                            historicalEncounterSeconds = null;
                        }
                    } catch (_) { historicalEncounterSeconds = null; }
                    // data
                    const res = await fetch(`/api/history/${ts}/section/${idx}/data`);
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
                } else {
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
                        } else {
                            // Fallback: aggregate enemies from events if not present
                            try {
                                const er = await fetch(`/api/history/${currentEncounter}/enemies-agg`);
                                const ejs = await er.json();
                                if (ejs?.code === 0 && ejs.data) {
                                    historicalEnemies = Object.entries(ejs.data).map(([id, e])=> ({ id, ...e }));
                                } else {
                                    historicalEnemies = [];
                                }
                            } catch { historicalEnemies = []; }
                        }
                        updateAll();
                        wasOnCurrentEncounter = false;
                    }
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
