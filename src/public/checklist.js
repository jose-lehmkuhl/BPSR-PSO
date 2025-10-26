const DEFAULT_DAILY = [
    { name: 'World Boss Keys', color: 'red', icon: 'daily_1.webp' },
    { name: 'World Boss Crusade', color: 'red', icon: 'daily_10.webp' },
    { name: 'Elite Boss Keys', color: 'red', icon: 'daily_2.webp' },
    { name: 'Commissions', color: 'purple', icon: 'daily_3.webp' },
    { name: 'Homestead Commissions', color: 'purple', icon: 'daily_4.webp' },
    { name: 'Unstable Space Dungeon', color: 'blue', icon: 'daily_5.webp' },
    { name: 'Season Activity Goals', color: 'green', icon: 'daily_6.webp' },
    { name: 'Focus', color: 'pink', icon: 'daily_7.webp' },
    { name: 'Guild Check-In', color: 'yellow', icon: 'daily_8.webp' },
    { name: 'Guild Cargo', color: 'yellow', icon: 'daily_9.webp' },
    { name: 'Mystery Shop', color: 'brown', icon: 'daily_11.webp' },
    { name: 'Guild Hunt', color: 'yellow', icon: 'daily_12.webp' },
];

const DEFAULT_WEEKLY = [
    { name: 'Guild Shop', color: 'yellow', icon: 'weekly_1.webp' },
    { name: 'Guild Activity Rewards', color: 'yellow', icon: 'weekly_8.webp' },
    { name: 'Trailblaze Rewards - Dungeons', color: 'cyan', icon: 'weekly_2.webp' },
    { name: 'Trailblaze Rewards - Bosses', color: 'cyan', icon: 'weekly_2.webp' },
    { name: 'Trailblaze Rewards - Focus', color: 'cyan', icon: 'weekly_2.webp' },
    { name: 'Colorful Shop', color: 'brown', icon: 'weekly_3.webp' },
    { name: 'Friendship Shop', color: 'brown', icon: 'weekly_4.webp' },
    { name: 'Honor Shop', color: 'brown', icon: 'weekly_5.webp' },
    { name: 'Reputation Shop', color: 'brown', icon: 'weekly_6.webp' },
    { name: 'Season Pass Shop', color: 'brown', icon: 'weekly_7.webp' },
    { name: 'Life Skill Quests', color: 'green', icon: 'weekly_9.webp' },
    { name: 'Void Spawn Boxes', color: 'purple', icon: 'weekly_10.webp' },
    { name: 'Crusade Reward Path', color: 'yellow', icon: 'weekly_11.webp' },
    { name: 'Stimen Vaults', color: 'yellow', icon: 'weekly_12.webp' },
    { name: 'Reclaim Hub', color: 'brown', icon: 'weekly_13.webp' },
    { name: 'Ice Dragon Raid - Normal', color: 'cyan', icon: 'must_1.webp' },
    { name: 'Ice Dragon Raid - Hard', color: 'cyan', icon: 'must_1.webp' },
    { name: 'Ice Dragon Raid - Nightmare', color: 'cyan', icon: 'must_1.webp' },
    { name: 'Dark Dragon Raid - Normal', color: 'red', icon: 'must_2.webp' },
    { name: 'Dark Dragon Raid - Hard', color: 'red', icon: 'must_2.webp' },
    { name: 'Dark Dragon Raid - Nightmare', color: 'red', icon: 'must_2.webp' },
    { name: 'Light Dragon Raid - Normal', color: 'yellow', icon: 'must_3.webp' },
    { name: 'Light Dragon Raid - Hard', color: 'yellow', icon: 'must_3.webp' },
    { name: 'Light Dragon Raid - Nightmare', color: 'yellow', icon: 'must_3.webp' },
];

const dailyGrid = document.getElementById('dailyGrid');
const weeklyGrid = document.getElementById('weeklyGrid');
const dailyProgress = document.getElementById('dailyProgress');
const weeklyProgress = document.getElementById('weeklyProgress');
const resetDailyBtn = document.getElementById('resetDaily');
const resetWeeklyBtn = document.getElementById('resetWeekly');

function updateProgress(container, progressEl) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const total = checkboxes.length;
    const completed = Array.from(checkboxes).filter(c=>c.checked).length;
    progressEl.textContent = `${completed} of ${total} completed`;
}

const ICON_BASE = 'assets/checklist/';

function renderList(container, items, state, onToggle) {
    container.innerHTML = '';
    for (const it of items) {
        const name = it.name;
        const item = document.createElement('div');
        item.className = `cl-item ${it.color||''}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!state[name];
        input.addEventListener('change', ()=> onToggle(name, input.checked));
        // Make the entire item clickable to toggle
        item.addEventListener('click', (e)=>{
            // avoid double toggle if the event originated on the checkbox itself
            if (e.target === input) return;
            input.checked = !input.checked;
            onToggle(name, input.checked);
        });
        const imgWrap = document.createElement('div');
        imgWrap.className = 'image';
        const img = document.createElement('img');
        img.className = 'cl-img';
        img.alt = name;
        if (it.icon) img.src = ICON_BASE + it.icon; // will 404 until assets are added; harmless
        imgWrap.appendChild(img);
        const label = document.createElement('span');
        label.textContent = name;
        item.appendChild(imgWrap);
        item.appendChild(input);
        item.appendChild(label);
        container.appendChild(item);
    }
}

async function loadState() {
    try {
        const state = await window.electronAPI.getChecklist();
        return state || { daily: {}, weekly: {} };
    } catch {
        return { daily: {}, weekly: {} };
    }
}

async function saveState(state) {
    try {
        await window.electronAPI.saveChecklist(state);
    } catch {}
}

document.addEventListener('DOMContentLoaded', async () => {
    let state = await loadState();

    function onDailyToggle(name, checked) {
        state.daily[name] = !!checked;
        saveState(state);
        updateProgress(dailyGrid, dailyProgress);
    }
    function onWeeklyToggle(name, checked) {
        state.weekly[name] = !!checked;
        saveState(state);
        updateProgress(weeklyGrid, weeklyProgress);
    }

    renderList(dailyGrid, DEFAULT_DAILY, state.daily || {}, onDailyToggle);
    renderList(weeklyGrid, DEFAULT_WEEKLY, state.weekly || {}, onWeeklyToggle);
    updateProgress(dailyGrid, dailyProgress);
    updateProgress(weeklyGrid, weeklyProgress);

    resetDailyBtn.addEventListener('click', async ()=>{
        if (!confirm('Reset all Daily items?')) return;
        state = await window.electronAPI.resetChecklist('daily');
        renderList(dailyGrid, DEFAULT_DAILY, state.daily || {}, onDailyToggle);
        updateProgress(dailyGrid, dailyProgress);
    });
    resetWeeklyBtn.addEventListener('click', async ()=>{
        if (!confirm('Reset all Weekly items?')) return;
        state = await window.electronAPI.resetChecklist('weekly');
        renderList(weeklyGrid, DEFAULT_WEEKLY, state.weekly || {}, onWeeklyToggle);
        updateProgress(weeklyGrid, weeklyProgress);
    });

    const closeBtn = document.getElementById('closeChecklist');
    if (closeBtn) {
        closeBtn.addEventListener('click', ()=>{
            window.close();
        });
    }
});


