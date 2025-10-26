import { BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let checklistWin = null;

export function createChecklistWindow() {
    if (checklistWin && !checklistWin.isDestroyed()) {
        checklistWin.focus();
        return checklistWin;
    }
    checklistWin = new BrowserWindow({
        width: 600,
        height: 700,
        show: true,
        minWidth: 480,
        minHeight: 400,
        title: 'Checklist',
        backgroundColor: '#0f1113',
        transparent: false,
        frame: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, '../preload.js') },
    });
    checklistWin.setMenuBarVisibility(false);
    checklistWin.loadFile(path.join(__dirname, '../public/checklist.html'));
    checklistWin.on('closed', () => { checklistWin = null; });
    return checklistWin;
}


