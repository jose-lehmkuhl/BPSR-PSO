import express from 'express';
import path from 'path';
import logger from '../services/Logger.js';
import { promises as fsPromises } from 'fs';
import userDataManager from '../services/UserDataManager.js';

/**
 * Creates and returns an Express Router instance configured with all API endpoints.
 * @param {object} userDataManager The data manager instance for user data.
 * @param {object} logger The Winston logger instance.
 * @param {boolean} isPaused The state of the statistics being paused.
 * @param {string} SETTINGS_PATH The path to the settings file.
 * @returns {express.Router} An Express Router with all routes defined.
 */
export function createApiRouter(isPaused, SETTINGS_PATH) {
    const router = express.Router();

    // Middleware to parse JSON requests
    router.use(express.json());

    // GET all user data
    router.get('/data', (req, res) => {
        const userData = userDataManager.getAllUsersData();
        const data = {
            code: 0,
            user: userData,
        };
        res.json(data);
    });

    // GET all enemy data
    router.get('/enemies', (req, res) => {
        const enemiesData = userDataManager.getAllEnemiesData();
        const data = {
            code: 0,
            enemy: enemiesData,
        };
        res.json(data);
    });

    // Clear all statistics
    router.get('/clear', (req, res) => {
        userDataManager.clearAll();
        logger.info('Statistics have been cleared!');
        res.json({
            code: 0,
            msg: 'Statistics have been cleared!',
        });
    });

    // Clear identities (names/classes/specs) and persistent cache
    router.post('/clear-identities', (req, res) => {
        try {
            userDataManager.clearIdentities();
            logger.info('Identities have been cleared!');
            res.json({ code: 0, msg: 'Identities have been cleared!' });
        } catch (e) {
            logger.error('Failed to clear identities', e);
            res.status(500).json({ code: 1, msg: 'Failed to clear identities' });
        }
    });

    // Pause/Resume statistics
    router.post('/pause', (req, res) => {
        const { paused } = req.body;
        isPaused = paused;
        logger.info(`Statistics ${isPaused ? 'paused' : 'resumed'}!`);
        res.json({
            code: 0,
            msg: `Statistics ${isPaused ? 'paused' : 'resumed'}!`,
            paused: isPaused,
        });
    });

    // Get pause state
    router.get('/pause', (req, res) => {
        res.json({
            code: 0,
            paused: isPaused,
        });
    });

    // Get skill data for a specific user ID
    router.get('/skill/:uid', (req, res) => {
        const uid = parseInt(req.params.uid);
        const skillData = userDataManager.getUserSkillData(uid);

        if (!skillData) {
            return res.status(404).json({
                code: 1,
                msg: 'User not found',
            });
        }

        res.json({ code: 0, data: skillData });
    });

    // Get history summary for a specific timestamp
    router.get('/history/:timestamp/summary', async (req, res) => {
        const { timestamp } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'summary.json');

        try {
            const data = await fsPromises.readFile(historyFilePath, 'utf8');
            const summaryData = JSON.parse(data);
            res.json({
                code: 0,
                data: summaryData,
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History summary file not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History summary file not found',
                });
            } else {
                logger.error('Failed to read history summary file:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to read history summary file',
                });
            }
        }
    });

    // Get encounter meta (top enemy name, target count, duration)
    router.get('/history/:timestamp/meta', async (req, res) => {
        const { timestamp } = req.params;
        const logDir = path.join('./logs', timestamp);
        try {
            // Prefer precomputed meta from end-of-combat save
            try {
                const metaRaw = await fsPromises.readFile(path.join(logDir, 'encounter_meta.json'), 'utf8');
                const meta = JSON.parse(metaRaw);
                return res.json({
                    code: 0,
                    data: {
                        topEnemyName: meta.name || '',
                        targetCount: meta.targetCount || 0,
                        durationMs: meta.durationMs || 0,
                        label: meta.label || '',
                    },
                });
            } catch {}

            // duration from summary if available
            let durationMs = null;
            try {
                const sumRaw = await fsPromises.readFile(path.join(logDir, 'summary.json'), 'utf8');
                const summary = JSON.parse(sumRaw);
                durationMs = summary?.duration ?? null;
            } catch {}

            // parse fight log for enemy target stats
            let topEnemyName = '';
            let targetCount = 0;
            try {
                const logRaw = await fsPromises.readFile(path.join(logDir, 'fight.log'), 'utf8');
                const lines = logRaw.split(/\r?\n/);
                const idToName = new Map();
                const idToTaken = new Map();
                let firstTs = null, lastTs = null;
                // Load persisted enemy names
                try {
                    const enemiesJson = await fsPromises.readFile(path.join(logDir, 'enemies.json'), 'utf8');
                    const persisted = JSON.parse(enemiesJson);
                    for (const [k, v] of Object.entries(persisted)) idToName.set(Number(k), v);
                } catch {}
                for (const line of lines) {
                    // timestamps fallback for duration
                    const tsMatch = line.match(/^\[(.*?)\]/);
                    if (tsMatch && tsMatch[1]) {
                        const t = Date.parse(tsMatch[1]);
                        if (!Number.isNaN(t)) {
                            if (firstTs == null) firstTs = t;
                            lastTs = t;
                        }
                    }
                    if (!line.includes('[DMG]')) continue;
                    const tgtIdx = line.indexOf(' TGT: ');
                    if (tgtIdx === -1) continue;
                    const seg = line.slice(tgtIdx + 6);
                    // format like "SomeName#123(enemy)"
                    const hashIdx = seg.indexOf('#');
                    const parIdx = seg.indexOf('(enemy)');
                    if (hashIdx === -1 || parIdx === -1) continue;
                    const name = seg.slice(0, hashIdx).trim();
                    const idStr = seg.slice(hashIdx + 1, parIdx).trim();
                    const idNum = Number.parseInt(idStr, 10);
                    if (!Number.isFinite(idNum)) continue;
                    idToName.set(idNum, name || idToName.get(idNum) || '');
                    // parse VAL: NNN and HPLSN: MMM
                    let dmg = 0;
                    const valMatch = line.match(/\bVAL: (\d+)/);
                    const hpMatch = line.match(/\bHPLSN: (\d+)/);
                    if (hpMatch && hpMatch[1]) dmg = Number(hpMatch[1]);
                    if ((!dmg || dmg === 0) && valMatch && valMatch[1]) dmg = Number(valMatch[1]);
                    const prev = idToTaken.get(idNum) || 0;
                    idToTaken.set(idNum, prev + (dmg || 0));
                }
                targetCount = idToTaken.size;
                let topId = null, topVal = -1;
                for (const [id, val] of idToTaken.entries()) {
                    if (val > topVal) { topVal = val; topId = id; }
                }
                if (topId != null) {
                    topEnemyName = idToName.get(topId) || `#${topId}`;
                }
                // duration fallback if summary missing
                if ((durationMs == null || durationMs === 0) && firstTs != null && lastTs != null) {
                    durationMs = Math.max(0, lastTs - firstTs);
                }
            } catch {}

            res.json({ code: 0, data: { topEnemyName, targetCount, durationMs } });
        } catch (e) {
            logger.error('Failed to build encounter meta', e);
            res.status(500).json({ code: 1, msg: 'Failed to load encounter meta' });
        }
    });

    // Get history data for a specific timestamp
    router.get('/history/:timestamp/data', async (req, res) => {
        const { timestamp } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'allUserData.json');

        try {
            const data = await fsPromises.readFile(historyFilePath, 'utf8');
            const userData = JSON.parse(data);
            // Load historical NPC tanking if available
            let enemiesData = null;
            try {
                const e = await fsPromises.readFile(path.join('./logs', timestamp, 'enemies_tanking.json'), 'utf8');
                enemiesData = JSON.parse(e);
            } catch {}
            res.json({ code: 0, user: userData, enemies: enemiesData });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History data file not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History data file not found',
                });
            } else {
                logger.error('Failed to read history data file:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to read history data file',
                });
            }
        }
    });

    // Get history skill data for a specific timestamp and user
    router.get('/history/:timestamp/skill/:uid', async (req, res) => {
        const { timestamp, uid } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'users', `${uid}.json`);

        try {
            const data = await fsPromises.readFile(historyFilePath, 'utf8');
            const skillData = JSON.parse(data);
            res.json({ code: 0, data: skillData });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History skill file not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History skill file not found',
                });
            } else {
                logger.error('Failed to read history skill file:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to read history skill file',
                });
            }
        }
    });

    // Download historical fight log
    router.get('/history/:timestamp/download', (req, res) => {
        const { timestamp } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'fight.log');
        res.download(historyFilePath, `fight_${timestamp}.log`);
    });

    // Get a list of available history timestamps
    router.get('/history/list', async (req, res) => {
        try {
            const data = (await fsPromises.readdir('./logs', { withFileTypes: true }))
                .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
                .map((e) => e.name);
            res.json({
                code: 0,
                data: data,
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History path not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History path not found',
                });
            } else {
                logger.error('Failed to load history path:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to load history path',
                });
            }
        }
    });

    // Delete all encounter logs (except current active)
    router.delete('/history', async (req, res) => {
        try {
            const logsRoot = path.join('./logs');
            const dirents = await fsPromises.readdir(logsRoot, { withFileTypes: true });
            const active = String(userDataManager.startTime || '');
            let deleted = 0;
            for (const d of dirents) {
                if (!d.isDirectory()) continue;
                const name = d.name;
                if (!/^\d+$/.test(name)) continue;
                if (name === active) continue; // keep current encounter
                await fsPromises.rm(path.join(logsRoot, name), { recursive: true, force: true });
                deleted++;
            }
            res.json({ code: 0, msg: 'Logs cleared', deleted });
        } catch (e) {
            logger.error('Failed to clear logs', e);
            res.status(500).json({ code: 1, msg: 'Failed to clear logs' });
        }
    });

    // Get current settings
    router.get('/settings', (req, res) => {
        res.json({ code: 0, data: globalSettings });
    });

    // Update settings
    router.post('/settings', async (req, res) => {
        const newSettings = req.body;
        globalSettings = { ...globalSettings, ...newSettings };
        await fsPromises.writeFile(SETTINGS_PATH, JSON.stringify(globalSettings, null, 2), 'utf8');
        res.json({ code: 0, data: globalSettings });
    });

    return router;
}
