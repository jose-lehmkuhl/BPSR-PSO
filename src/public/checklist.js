const DEFAULT_DAILY = [
    'World Boss Keys',
    'World Boss Crusade',
    'Elite Boss Keys',
    'Commissions',
    'Homestead Commissions',
    'Unstable Space Dungeon',
    'Season Activity Goals',
    'Focus',
    'Guild Check-In',
    'Guild Cargo',
    'Mystery Shop',
    'Guild Hunt',
];

const DEFAULT_WEEKLY = [
    'Guild Shop', 'Guild Activity Rewards', 'Trailblaze Rewards - Dungeons', 'Trailblaze Rewards - Bosses', 'Trailblaze Rewards - Focus',
    'Colorful Shop', 'Friendship Shop', 'Honor Shop', 'Reputation Shop', 'Season Pass Shop', 'Life Skill Quests', 'Void Spawn Boxes',
    'Crusade Reward Path', 'Stimen Vaults', 'Reclaim Hub',
    'Ice Dragon Raid - Normal', 'Ice Dragon Raid - Hard', 'Ice Dragon Raid - Nightmare',
    'Dark Dragon Raid - Normal', 'Dark Dragon Raid - Hard', 'Dark Dragon Raid - Nightmare',
    'Light Dragon Raid - Normal', 'Light Dragon Raid - Hard', 'Light Dragon Raid - Nightmare'
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

function renderList(container, names, state, onToggle) {
    container.innerHTML = '';
    for (const name of names) {
        const item = document.createElement('div');
        item.className = 'cl-item';
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
        const label = document.createElement('span');
        label.textContent = name;
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


