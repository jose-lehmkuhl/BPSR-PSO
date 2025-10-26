import { globalShortcut, app } from 'electron';
import window from './Window.js';

const RESIZE_INCREMENT = 20;
const MOVE_INCREMENT = 20;

/**
 * Registers all global keyboard shortcuts for the application.
 */
export function registerShortcuts() {
    registerDynamicHotkeys();
    registerResize();
    registerMove();
}

/**
 * Registers the shortcut for toggling mouse event pass-through.
 */
function registerDynamicHotkeys() {
    const { clickthroughHotkey, toggleWindowHotkey, clearHotkey } = window.getHotkeys();
    if (clickthroughHotkey) {
        globalShortcut.register(clickthroughHotkey, () => {
            window.togglePassthrough();
        });
    }
    if (toggleWindowHotkey) {
        globalShortcut.register(toggleWindowHotkey, () => {
            window.toggleVisible();
        });
    }
    if (clearHotkey) {
        globalShortcut.register(clearHotkey, () => {
            // Trigger in-app reset: discard current log and start fresh
            window.webContents.executeJavaScript('window.clearData && window.clearData()').catch(()=>{});
        });
    }
}

/**
 * Registers shortcuts for resizing the window.
 */
function registerResize() {
    globalShortcut.register('Control+Up', () => {
        const [width, height] = window.getSize();
        const newHeight = Math.max(40, height - RESIZE_INCREMENT);
        window.setSize(width, newHeight);
    });

    globalShortcut.register('Control+Down', () => {
        const [width, height] = window.getSize();
        window.setSize(width, height + RESIZE_INCREMENT);
    });

    globalShortcut.register('Control+Left', () => {
        const [width, height] = window.getSize();
        const newWidth = Math.max(280, width - RESIZE_INCREMENT);
        window.setSize(newWidth, height);
    });

    globalShortcut.register('Control+Right', () => {
        const [width, height] = window.getSize();
        window.setSize(width + RESIZE_INCREMENT, height);
    });
}

/**
 * Registers shortcuts for moving the window.
 */
function registerMove() {
    globalShortcut.register('Control+Alt+Up', () => {
        const [x, y] = window.getPosition();
        window.setPosition(x, y - MOVE_INCREMENT);
    });

    globalShortcut.register('Control+Alt+Down', () => {
        const [x, y] = window.getPosition();
        window.setPosition(x, y + MOVE_INCREMENT);
    });

    globalShortcut.register('Control+Alt+Left', () => {
        const [x, y] = window.getPosition();
        window.setPosition(x - MOVE_INCREMENT, y);
    });

    globalShortcut.register('Control+Alt+Right', () => {
        const [x, y] = window.getPosition();
        window.setPosition(x + MOVE_INCREMENT, y);
    });
}

/**
 * Registers the shortcut for minimizing/restoring the window height.
 */
// removed minimize shortcut to keep header minimal
