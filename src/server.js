import cors from 'cors';
import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes/api.js';
import { PacketInterceptor } from './services/PacketInterceptor.js';
import userDataManager from './services/UserDataManager.js';
import socket from './services/Socket.js';
import logger from './services/Logger.js';

import skillConfig from './tables/skill_names.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
let isPaused = false;
let globalSettings = {
    autoClearOnServerChange: true,
    autoClearOnTimeout: false,
    onlyRecordEliteDummy: false,
};

class Server {
    start = async () =>
        new Promise(async (resolve, reject) => {
            try {
                this.resolve = resolve;
                this.reject = reject;

                await this._loadGlobalSettings();

                const app = express();
                app.use(cors());
                app.use(express.static(path.join(__dirname, 'public')));

                const apiRouter = createApiRouter(isPaused, SETTINGS_PATH);
                app.use('/api', apiRouter);

                this.server = http.createServer(app);
                this.server.on('error', (err) => reject(err));

                socket.init(this.server);
                userDataManager.init();

                this._configureProcessEvents();
                this._configureSocketEmitter();
                this._configureSocketListener();
                // Cleanup logs without enemies on startup and periodically
                await this._cleanupEmptyLogs();
                setInterval(() => { this._cleanupEmptyLogs().catch(()=>{}); }, 5 * 60 * 1000);
                await this._startPacketInterceptor();
            } catch (error) {
                console.error('Error during server startup:', error);
                reject(error);
            }
        });

    _configureProcessEvents() {
        process.on('SIGINT', () => {
            userDataManager.forceUserCacheSave().then(() => {
                process.exit(0);
            });
        });
        process.on('SIGTERM', () => {
            userDataManager.forceUserCacheSave().then(() => {
                process.exit(0);
            });
        });
    }

    _configureSocketEmitter() {
        setInterval(() => {
            if (!isPaused) {
                userDataManager.updateAllRealtimeDps();
                const userData = userDataManager.getAllUsersData();
                const enemiesData = userDataManager.getAllEnemiesData();
                socket.emit('data', {
                    code: 0,
                    user: userData,
                    enemies: enemiesData,
                    fightStartTime: userDataManager.startTime,
                    lastActivityTime: userDataManager.lastLogTime,
                    combatIdleMs: userDataManager.battleIdleMs,
                    combatTimeMs: userDataManager.getLiveCombatTimeMs(),
                });
            }
        }, 100);
    }

    _configureSocketListener() {
        socket.on('connection', (sock) => {
            logger.info(`WebSocket client connected: ${sock.id}`);
            sock.on('disconnect', () => {
                logger.info(`WebSocket client disconnected: ${sock.id}`);
            });
        });
    }

    async _cleanupEmptyLogs() {
        try {
            const logsRoot = path.join(__dirname, 'logs');
            const dirents = await fsPromises.readdir(logsRoot, { withFileTypes: true });
            const active = String(userDataManager.startTime || '');
            const nonEmptyCandidates = [];
            for (const d of dirents) {
                if (!d.isDirectory()) continue;
                const name = d.name;
                if (!/^\d+$/.test(name)) continue;
                if (name === active) continue; // skip current encounter
                const logDir = path.join(logsRoot, name);
                const enemiesPath = path.join(logDir, 'enemies.json');
                let empty = false;
                try {
                    const raw = await fsPromises.readFile(enemiesPath, 'utf8');
                    const obj = JSON.parse(raw || '{}');
                    if (!obj || Object.keys(obj).length === 0) empty = true;
                } catch (e) {
                    // missing or unreadable enemies.json → treat as empty
                    empty = true;
                }
                if (empty) {
                    try {
                        await fsPromises.rm(logDir, { recursive: true, force: true });
                        logger.info(`Pruned empty encounter log: ${name}`);
                    } catch (e) {
                        logger.warn(`Failed pruning log ${name}: ${e?.message || e}`);
                    }
                } else {
                    nonEmptyCandidates.push(name);
                }
            }

            // Keep only the newest 50 non-empty logs
            if (nonEmptyCandidates.length > 50) {
                nonEmptyCandidates.sort((a, b) => Number(a) - Number(b)); // oldest first
                const toDelete = nonEmptyCandidates.slice(0, nonEmptyCandidates.length - 50);
                for (const name of toDelete) {
                    const logDir = path.join(logsRoot, name);
                    try {
                        await fsPromises.rm(logDir, { recursive: true, force: true });
                        logger.info(`Pruned old encounter log: ${name}`);
                    } catch (e) {
                        logger.warn(`Failed pruning old log ${name}: ${e?.message || e}`);
                    }
                }
            }
        } catch (e) {
            // no-op if logs dir missing
        }
    }

    async _startPacketInterceptor() {
        const checkPort = (port) =>
            new Promise((resolve) => {
                const s = net.createServer();
                s.once('error', () => resolve(false));
                s.once('listening', () => s.close(() => resolve(true)));
                s.listen(port);
            });

        let server_port = 8990;
        while (!(await checkPort(server_port))) {
            logger.warn(`port ${server_port} is already in use`);
            server_port++;
        }

        PacketInterceptor.start(this.server, server_port, this.resolve, this.reject);
    }

    async _loadGlobalSettings() {
        try {
            const data = await fsPromises.readFile(SETTINGS_PATH, 'utf8');
            globalSettings = { ...globalSettings, ...JSON.parse(data) };
        } catch (e) {
            if (e.code !== 'ENOENT') {
                logger.error('Failed to load settings:', e);
            }
        }
    }
}

const server = new Server();
export default server;
