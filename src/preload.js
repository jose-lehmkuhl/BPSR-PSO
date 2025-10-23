const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    closeClient: () => ipcRenderer.send('close-client'),
    onTogglePassthrough: (callback) => ipcRenderer.on('passthrough-toggled', (_event, value) => callback(value)),
    getHotkeys: () => ipcRenderer.invoke('get-hotkeys'),
    setHotkeys: (payload) => ipcRenderer.invoke('set-hotkeys', payload),
    openBreakdown: (payload) => ipcRenderer.send('open-breakdown', payload),
    onBreakdownLoad: (callback) => ipcRenderer.on('breakdown-load', (_event, payload) => callback(payload)),
    relaunchApp: () => ipcRenderer.send('relaunch-app'),
});
