import { app, ipcMain } from 'electron';
import window from './Window.js';

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
