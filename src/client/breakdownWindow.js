import { BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let breakdownWin = null;

export function createBreakdownWindow({ uid, timestamp }) {
    if (breakdownWin && !breakdownWin.isDestroyed()) {
        breakdownWin.focus();
        breakdownWin.webContents.send('breakdown-load', { uid, timestamp });
        return breakdownWin;
    }
    breakdownWin = new BrowserWindow({
        width: 900,
        height: 600,
        show: true,
        minWidth: 700,
        minHeight: 400,
        title: 'Skill Breakdown',
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, '../preload.js') },
    });
    breakdownWin.setMenuBarVisibility(false);
    breakdownWin.loadFile(path.join(__dirname, '../public/breakdown.html'));
    breakdownWin.on('closed', () => { breakdownWin = null; });
    breakdownWin.webContents.once('did-finish-load', () => {
        breakdownWin.webContents.send('breakdown-load', { uid, timestamp });
    });
    return breakdownWin;
}


