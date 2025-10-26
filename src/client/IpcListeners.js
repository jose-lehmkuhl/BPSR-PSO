import { app, ipcMain } from 'electron';
import window from './Window.js';
import { createBreakdownWindow } from './breakdownWindow.js';
import { createChecklistWindow } from './checklistWindow.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const checklistPath = path.join(__dirname, '../../checklist.json');

function readChecklist() {
    try {
        if (fs.existsSync(checklistPath)) {
            const raw = fs.readFileSync(checklistPath, 'utf8');
            const data = JSON.parse(raw);
            return { daily: data.daily || {}, weekly: data.weekly || {} };
        }
    } catch (e) {
        console.error('Failed to read checklist file', e);
    }
    return { daily: {}, weekly: {} };
}

function writeChecklist(payload) {
    try {
        const state = readChecklist();
        const next = {
            daily: payload?.daily ?? state.daily ?? {},
            weekly: payload?.weekly ?? state.weekly ?? {},
        };
        fs.writeFileSync(checklistPath, JSON.stringify(next, null, 4));
        return next;
    } catch (e) {
        console.error('Failed to write checklist file', e);
        return readChecklist();
    }
}

ipcMain.on('close-client', (event) => {
    app.quit();
});

ipcMain.handle('get-hotkeys', () => {
    return window.getHotkeys();
});

ipcMain.handle('set-hotkeys', (event, payload) => {
    window.setHotkeys(payload || {});
    return window.getHotkeys();
});

ipcMain.on('open-breakdown', (event, payload) => {
    createBreakdownWindow(payload || {});
});

ipcMain.on('open-checklist', () => {
    createChecklistWindow();
});

ipcMain.handle('get-checklist', () => {
    return readChecklist();
});

ipcMain.handle('save-checklist', (event, payload) => {
    return writeChecklist(payload || {});
});

ipcMain.handle('reset-checklist', (event, type) => {
    const state = readChecklist();
    if (type === 'daily') state.daily = {};
    else if (type === 'weekly') state.weekly = {};
    fs.writeFileSync(checklistPath, JSON.stringify(state, null, 4));
    return state;
});

ipcMain.on('relaunch-app', () => {
    app.relaunch();
    app.exit(0);
});
