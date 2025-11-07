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

    // Clear all statistics (same path used by OOC timeout)
    router.get('/clear', async (req, res) => {
        try {
            await userDataManager.clearAll();
            logger.info('Statistics have been cleared!');
            res.json({ code: 0, msg: 'Statistics have been cleared!' });
        } catch (e) {
            logger.error('Failed to clear stats', e);
            res.status(500).json({ code: 1, msg: 'Failed to clear stats' });
        }
    });

    // Request clear on next event (SR-like immediate UI reset, server clears on next packet)
    router.post('/clear-request', (req, res) => {
        try {
            userDataManager.requestClear();
            res.json({ code: 0, msg: 'Clear requested' });
        } catch (e) {
            logger.error('Failed to request clear', e);
            res.status(500).json({ code: 1, msg: 'Failed to request clear' });
        }
    });

    // Reset current encounter without saving (discard current log and start new)
    router.post('/reset', async (req, res) => {
        try {
            await userDataManager.resetWithoutSave();
            logger.info('Current encounter discarded and reset.');
            res.json({ code: 0, msg: 'Encounter reset' });
        } catch (e) {
            logger.error('Failed to reset encounter', e);
            res.status(500).json({ code: 1, msg: 'Failed to reset encounter' });
        }
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

    // Get tanking breakdown (who hit this player and how much)
    router.get('/tanking/:uid', (req, res) => {
        try {
            const uid = parseInt(req.params.uid);
            const data = userDataManager.getTankingBreakdown(uid);
            res.json({ code: 0, data });
        } catch (e) {
            logger.error('Failed to get tanking breakdown', e);
            res.status(500).json({ code: 1, msg: 'Failed to get tanking breakdown' });
        }
    });

    // Get NPC breakdown (per enemy, how much each player dealt)
    router.get('/npc/:enemyUid', (req, res) => {
        try {
            const enemyUid = parseInt(req.params.enemyUid);
            const data = userDataManager.getNpcBreakdown(enemyUid);
            res.json({ code: 0, data });
        } catch (e) {
            logger.error('Failed to get NPC breakdown', e);
            res.status(500).json({ code: 1, msg: 'Failed to get NPC breakdown' });
        }
    });

    // Historical tanking breakdown by victim from events.ndjson
    router.get('/history/:timestamp/tanking/:uid', async (req, res) => {
        try {
            const { timestamp, uid } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const usersPath = path.join(logDir, 'allUserData.json');
            const enemiesPath = path.join(logDir, 'enemies.json');
            let userNames = {};
            let enemyNames = {};
            try {
                const rawU = await fsPromises.readFile(usersPath, 'utf8');
                const objU = JSON.parse(rawU || '{}');
                for (const [k, v] of Object.entries(objU || {})) {
                    if (v && typeof v.name === 'string') userNames[k] = v.name;
                }
            } catch (_) {}
            try {
                const rawE = await fsPromises.readFile(enemiesPath, 'utf8');
                const objE = JSON.parse(rawE || '{}');
                enemyNames = objE || {};
            } catch (_) {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\\r?\\n/);
            const victim = Number.parseInt(uid, 10);
            const byAttacker = new Map();
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || (obj.type !== 'damage' && obj.type !== 'taken_damage')) continue;
                const d = obj.data || {};
                if (Number(d.targetUid) !== victim) continue;
                const attackerUid = Number(d.attackerUid);
                if (!Number.isFinite(attackerUid)) continue;
                const val = (obj.type === 'damage')
                    ? ((Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0)
                    : (Number(d.value) || 0);
                if (val <= 0) continue;
                byAttacker.set(attackerUid, (byAttacker.get(attackerUid) || 0) + val);
            }
            let total = 0;
            const items = [];
            for (const [attackerUid, amount] of byAttacker.entries()) {
                total += amount;
                const name = userNames[String(attackerUid)] || enemyNames[String(attackerUid)] || `#${attackerUid}`;
                items.push({ attackerUid, name, amount });
            }
            items.sort((a,b)=> b.amount - a.amount);
            res.json({ code: 0, data: { victimUid: victim, total, items } });
        } catch (e) {
            logger.error('Failed to build historical tanking breakdown', e);
            res.status(500).json({ code: 1, msg: 'Failed to get historical tanking breakdown' });
        }
    });

    // Historical NPC breakdown by enemy from events.ndjson
    router.get('/history/:timestamp/npc/:enemyUid', async (req, res) => {
        try {
            const { timestamp, enemyUid } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const usersPath = path.join(logDir, 'allUserData.json');
            const enemiesPath = path.join(logDir, 'enemies.json');
            let userNames = {};
            let enemyNames = {};
            try {
                const rawU = await fsPromises.readFile(usersPath, 'utf8');
                const objU = JSON.parse(rawU || '{}');
                for (const [k, v] of Object.entries(objU || {})) {
                    if (v && typeof v.name === 'string') userNames[k] = v.name;
                }
            } catch (_) {}
            try {
                const rawE = await fsPromises.readFile(enemiesPath, 'utf8');
                const objE = JSON.parse(rawE || '{}');
                enemyNames = objE || {};
            } catch (_) {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\\r?\\n/);
            const targetEnemy = Number.parseInt(enemyUid, 10);
            const byAttacker = new Map();
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || obj.type !== 'damage') continue;
                const d = obj.data || {};
                if (Number(d.targetUid) !== targetEnemy) continue;
                const attackerUid = Number(d.attackerUid);
                if (!Number.isFinite(attackerUid)) continue;
                const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                if (val <= 0) continue;
                byAttacker.set(attackerUid, (byAttacker.get(attackerUid) || 0) + val);
            }
            let total = 0;
            const items = [];
            for (const [attackerUid, amount] of byAttacker.entries()) {
                total += amount;
                const name = userNames[String(attackerUid)] || `#${attackerUid}`;
                items.push({ attackerUid, name, amount });
            }
            items.sort((a,b)=> b.amount - a.amount);
            const enemyName = enemyNames[String(targetEnemy)] || `#${targetEnemy}`;
            res.json({ code: 0, data: { enemyUid: targetEnemy, enemyName, total, items } });
        } catch (e) {
            logger.error('Failed to build historical NPC breakdown', e);
            res.status(500).json({ code: 1, msg: 'Failed to get historical NPC breakdown' });
        }
    });

    // Scene-level enemies aggregate (total taken per enemy across the scene)
    router.get('/history/:timestamp/enemies-agg', async (req, res) => {
        try {
            const { timestamp } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const enemiesPath = path.join(logDir, 'enemies.json');
            let enemyNames = {};
            try {
                const rawE = await fsPromises.readFile(enemiesPath, 'utf8');
                enemyNames = JSON.parse(rawE || '{}') || {};
            } catch (_) {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            const enemiesAgg = new Map();
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || obj.type !== 'damage') continue;
                const d = obj.data || {};
                const target = Number(d.targetUid);
                const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                if (!Number.isFinite(target) || val <= 0) continue;
                enemiesAgg.set(target, (enemiesAgg.get(target) || 0) + val);
            }
            const out = {};
            for (const [eid, total] of enemiesAgg.entries()) {
                out[String(eid)] = { id: eid, name: enemyNames[String(eid)] || `#${eid}`, taken_total: total };
            }
            res.json({ code: 0, data: out });
        } catch (e) {
            logger.error('Failed to aggregate enemies for scene', e);
            res.status(500).json({ code: 1, msg: 'Failed to aggregate enemies' });
        }
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

    // Analyze sections and produce labels for a scene
    router.get('/history/:timestamp/analysis', async (req, res) => {
        try {
            const { timestamp } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const enemiesPath = path.join(logDir, 'enemies.json');
            let enemyNames = {};
            try {
                const rawE = await fsPromises.readFile(enemiesPath, 'utf8');
                enemyNames = JSON.parse(rawE || '{}') || {};
            } catch {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            // collect sections
            const sections = [];
            let currentStart = null;
            let lastEnd = -1;
            let lastActiveTs = -1; // last ts of damage or taken_damage
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || !obj.type) continue;
                if (obj.type === 'damage' || obj.type === 'taken_damage') {
                    const t = Number(obj.ts || 0);
                    if (Number.isFinite(t)) {
                        if (lastActiveTs < t) lastActiveTs = t;
                        // Infer open if missing
                        if (currentStart == null) currentStart = t;
                    }
                }
                if (obj.type === 'battle_section_open') {
                    const s = Number(obj?.data?.start || obj.ts || 0);
                    if (s && currentStart == null) currentStart = s;
                } else if (obj.type === 'battle_section_close') {
                    const end = Number(obj?.data?.end || obj.ts || 0);
                    if (currentStart != null && end >= currentStart && end !== lastEnd) {
                        sections.push({ start: currentStart, end });
                        lastEnd = end;
                        currentStart = null;
                    }
                }
            }
            // include trailing open section closed at lastActiveTs
            if (currentStart != null && lastActiveTs >= currentStart && lastActiveTs !== lastEnd) {
                sections.push({ start: currentStart, end: lastActiveTs });
                currentStart = null;
            }
            // guard: sort and drop invalid
            const norm = sections.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start)
                .sort((a,b)=> a.start - b.start);
            // compute per-section top enemy
            const perSection = norm.map((s, idx) => ({ index: idx, ...s, durationMs: (s.end - s.start), topEnemyId: null, topEnemyName: '', totalsByEnemy: {} }));
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || obj.type !== 'damage') continue;
                const ts = Number(obj.ts || 0);
                const d = obj.data || {};
                const target = Number(d.targetUid);
                if (!Number.isFinite(ts) || !Number.isFinite(target)) continue;
                const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                if (val <= 0) continue;
                // find section
                for (const sec of perSection) {
                    if (ts >= sec.start && ts <= sec.end) {
                        sec.totalsByEnemy[target] = (sec.totalsByEnemy[target] || 0) + val;
                        break;
                    }
                }
            }
            for (const sec of perSection) {
                let bestId = null, bestVal = -1;
                for (const [eidStr, total] of Object.entries(sec.totalsByEnemy)) {
                    const eid = Number(eidStr);
                    if (total > bestVal) { bestVal = total; bestId = eid; }
                }
                sec.topEnemyId = bestId;
                sec.topEnemyName = (bestId != null) ? (enemyNames[String(bestId)] || `#${bestId}`) : '';
            }
            // scene label: longest section's top enemy
            let sceneName = '';
            if (perSection.length > 0) {
                let longest = perSection[0];
                for (const s of perSection) { if ((s.durationMs || 0) > (longest.durationMs || 0)) longest = s; }
                sceneName = longest.topEnemyName || '';
            }
            res.json({ code: 0, data: { sections: perSection, sceneName } });
        } catch (e) {
            logger.error('Failed to analyze sections', e);
            res.status(500).json({ code: 1, msg: 'Failed to analyze sections' });
        }
    });

    // Section-specific meta
    router.get('/history/:timestamp/section/:index/meta', async (req, res) => {
        try {
            const { timestamp, index } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const enemiesPath = path.join(logDir, 'enemies.json');
            let enemyNames = {};
            try {
                const rawE = await fsPromises.readFile(enemiesPath, 'utf8');
                enemyNames = JSON.parse(rawE || '{}') || {};
            } catch {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            // reuse simple scan to build sections
            const secs = [];
            let currentStart = null, lastEnd = -1, lastActiveTs = -1;
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || !obj.type) continue;
                if (obj.type === 'damage' || obj.type === 'taken_damage') {
                    const t = Number(obj.ts || 0);
                    if (Number.isFinite(t)) {
                        if (lastActiveTs < t) lastActiveTs = t;
                        if (currentStart == null) currentStart = t;
                    }
                }
                if (obj.type === 'battle_section_open') {
                    const s = Number(obj?.data?.start || obj.ts || 0);
                    if (s && currentStart == null) currentStart = s;
                } else if (obj.type === 'battle_section_close') {
                    const end = Number(obj?.data?.end || obj.ts || 0);
                    if (currentStart != null && end >= currentStart && end !== lastEnd) {
                        secs.push({ start: currentStart, end });
                        lastEnd = end;
                        currentStart = null;
                    }
                }
            }
            if (currentStart != null && lastActiveTs >= currentStart && lastActiveTs !== lastEnd) {
                secs.push({ start: currentStart, end: lastActiveTs });
                currentStart = null;
            }
            const idx = Number.parseInt(index, 10);
            if (!(idx >= 0 && idx < secs.length)) return res.status(404).json({ code: 1, msg: 'Section not found' });
            const s = secs[idx];
            // compute top enemy within this section
            const totals = {};
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || obj.type !== 'damage') continue;
                const ts = Number(obj.ts || 0);
                const d = obj.data || {};
                const target = Number(d.targetUid);
                if (!Number.isFinite(ts) || !Number.isFinite(target)) continue;
                if (ts < s.start || ts > s.end) continue;
                const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                if (val <= 0) continue;
                totals[target] = (totals[target] || 0) + val;
            }
            let bestId = null, bestVal = -1;
            for (const [eidStr, total] of Object.entries(totals)) {
                const eid = Number(eidStr);
                if (total > bestVal) { bestVal = total; bestId = eid; }
            }
            const durationMs = Math.max(0, s.end - s.start);
            const label = `${enemyNames[String(bestId)] || (bestId != null ? `#${bestId}` : 'Section')} [${String(Math.floor(durationMs/60000)).padStart(2,'0')}:${String(Math.floor((durationMs%60000)/1000)).padStart(2,'0')}]`;
            res.json({ code: 0, data: { index: idx, start: s.start, end: s.end, durationMs, topEnemyId: bestId, topEnemyName: enemyNames[String(bestId)] || (bestId != null ? `#${bestId}` : ''), label } });
        } catch (e) {
            logger.error('Failed to build section meta', e);
            res.status(500).json({ code: 1, msg: 'Failed to build section meta' });
        }
    });

    // Section-specific aggregated data (users/enemies)
    router.get('/history/:timestamp/section/:index/data', async (req, res) => {
        try {
            const { timestamp, index } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const usersPath = path.join(logDir, 'allUserData.json');
            const enemiesPath = path.join(logDir, 'enemies.json');
            let userNames = {};
            let userMeta = {};
            let enemyNames = {};
            try {
                const rawU = await fsPromises.readFile(usersPath, 'utf8');
                const objU = JSON.parse(rawU || '{}');
                userMeta = objU || {};
                for (const [k, v] of Object.entries(userMeta)) {
                    if (v && typeof v.name === 'string') userNames[k] = v.name;
                }
            } catch (_) {}
            try {
                const rawE = await fsPromises.readFile(enemiesPath, 'utf8');
                const objE = JSON.parse(rawE || '{}');
                enemyNames = objE || {};
            } catch (_) {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            // Build sections
            const secs = [];
            let currentStart = null, lastEnd = -1, lastActiveTs = -1;
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || !obj.type) continue;
                if (obj.type === 'damage' || obj.type === 'taken_damage') {
                    const t = Number(obj.ts || 0);
                    if (Number.isFinite(t)) {
                        if (lastActiveTs < t) lastActiveTs = t;
                        if (currentStart == null) currentStart = t;
                    }
                }
                if (obj.type === 'battle_section_open') {
                    const s = Number(obj?.data?.start || obj.ts || 0);
                    if (s && currentStart == null) currentStart = s;
                } else if (obj.type === 'battle_section_close') {
                    const end = Number(obj?.data?.end || obj.ts || 0);
                    if (currentStart != null && end >= currentStart && end !== lastEnd) {
                        secs.push({ start: currentStart, end });
                        lastEnd = end;
                        currentStart = null;
                    }
                }
            }
            if (currentStart != null && lastActiveTs >= currentStart && lastActiveTs !== lastEnd) {
                secs.push({ start: currentStart, end: lastActiveTs });
                currentStart = null;
            }
            const idx = Number.parseInt(index, 10);
            if (!(idx >= 0 && idx < secs.length)) return res.status(404).json({ code: 1, msg: 'Section not found' });
            const s = secs[idx];
            const start = s.start, end = s.end;
            // Aggregate
            const userAgg = new Map(); // uid -> { name, total_damage:{total}, total_healing:{total}, total_dps, total_hps, taken_damage }
            const enemiesAgg = new Map(); // enemyUid -> taken_total
            const durationSec = Math.max(1, Math.floor((end - start) / 1000));
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                const ts = Number(obj?.ts || 0);
                if (!Number.isFinite(ts) || ts < start || ts > end) continue;
                if (obj.type === 'damage') {
                    const d = obj.data || {};
                    const attacker = Number(d.attackerUid);
                    const target = Number(d.targetUid);
                    const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                    if (Number.isFinite(attacker) && val > 0) {
                        const u = userAgg.get(attacker) || { name: userNames[String(attacker)] || `#${attacker}`, total_damage:{ total:0 }, total_healing:{ total:0 }, total_dps:0, total_hps:0, taken_damage:0 };
                        u.total_damage.total += val;
                        userAgg.set(attacker, u);
                    }
                    if (Number.isFinite(target) && val > 0) {
                        enemiesAgg.set(target, (enemiesAgg.get(target) || 0) + val);
                    }
                } else if (obj.type === 'heal') {
                    const d = obj.data || {};
                    const attacker = Number(d.attackerUid);
                    const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                    if (Number.isFinite(attacker) && val > 0) {
                        const u = userAgg.get(attacker) || { name: userNames[String(attacker)] || `#${attacker}`, total_damage:{ total:0 }, total_healing:{ total:0 }, total_dps:0, total_hps:0, taken_damage:0 };
                        u.total_healing.total += val;
                        userAgg.set(attacker, u);
                    }
                } else if (obj.type === 'taken_damage') {
                    const d = obj.data || {};
                    const victim = Number(d.targetUid);
                    const val = Number(d.value) || 0;
                    if (Number.isFinite(victim) && val > 0) {
                        const u = userAgg.get(victim) || { name: userNames[String(victim)] || `#${victim}`, total_damage:{ total:0 }, total_healing:{ total:0 }, total_dps:0, total_hps:0, taken_damage:0 };
                        u.taken_damage += val;
                        userAgg.set(victim, u);
                    }
                }
            }
            // compute rates
            for (const [uid, u] of userAgg.entries()) {
                u.total_dps = (u.total_damage.total || 0) / durationSec;
                u.total_hps = (u.total_healing.total || 0) / durationSec;
            }
            const userOut = {};
            for (const [uid, u] of userAgg.entries()) {
                const meta = userMeta[String(uid)] || {};
                const profession = typeof meta.profession === 'string' ? meta.profession : '';
                const fightPoint = (meta.attr && typeof meta.attr.fightPoint === 'number') ? meta.attr.fightPoint
                                   : (typeof meta.fightPoint === 'number' ? meta.fightPoint : undefined);
                userOut[String(uid)] = {
                    name: u.name,
                    profession,
                    fightPoint,
                    total_damage: u.total_damage,
                    total_healing: u.total_healing,
                    total_dps: u.total_dps,
                    total_hps: u.total_hps,
                    taken_damage: u.taken_damage
                };
            }
            const enemiesOut = {};
            for (const [eid, total] of enemiesAgg.entries()) {
                enemiesOut[String(eid)] = { id: eid, name: enemyNames[String(eid)] || `#${eid}`, taken_total: total };
            }
            res.json({ code: 0, user: userOut, enemies: enemiesOut, durationSec: durationSec });
        } catch (e) {
            logger.error('Failed to build section data', e);
            res.status(500).json({ code: 1, msg: 'Failed to build section data' });
        }
    });

    // Section-specific tanking breakdown
    router.get('/history/:timestamp/section/:index/tanking/:uid', async (req, res) => {
        try {
            const { timestamp, index, uid } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const usersPath = path.join(logDir, 'allUserData.json');
            let userNames = {};
            try {
                const rawU = await fsPromises.readFile(usersPath, 'utf8');
                const objU = JSON.parse(rawU || '{}');
                for (const [k, v] of Object.entries(objU || {})) {
                    if (v && typeof v.name === 'string') userNames[k] = v.name;
                }
            } catch (_) {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            // sections
            const secs = [];
            let currentStart = null, lastEnd = -1, lastActiveTs = -1;
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || !obj.type) continue;
                if (obj.type === 'damage' || obj.type === 'taken_damage') {
                    const t = Number(obj.ts || 0);
                    if (Number.isFinite(t) && t > lastActiveTs) lastActiveTs = t;
                }
                if (obj.type === 'battle_section_open') {
                    const s = Number(obj?.data?.start || obj.ts || 0);
                    if (s && currentStart == null) currentStart = s;
                } else if (obj.type === 'battle_section_close') {
                    const end = Number(obj?.data?.end || obj.ts || 0);
                    if (currentStart != null && end >= currentStart && end !== lastEnd) {
                        secs.push({ start: currentStart, end });
                        lastEnd = end;
                        currentStart = null;
                    }
                }
            }
            if (currentStart != null && lastActiveTs >= currentStart && lastActiveTs !== lastEnd) {
                secs.push({ start: currentStart, end: lastActiveTs });
                currentStart = null;
            }
            const idx = Number.parseInt(index, 10);
            if (!(idx >= 0 && idx < secs.length)) return res.status(404).json({ code: 1, msg: 'Section not found' });
            const s = secs[idx];
            const victim = Number.parseInt(uid, 10);
            const byAttacker = new Map();
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || (obj.type !== 'taken_damage' && obj.type !== 'damage')) continue;
                const ts = Number(obj.ts || 0);
                if (ts < s.start || ts > s.end) continue;
                const d = obj.data || {};
                // Prefer damage events with explicit attacker and target; fallback to taken_damage value when present
                if (Number(d.targetUid) !== victim) continue;
                const attackerUid = Number(d.attackerUid);
                if (!Number.isFinite(attackerUid)) continue;
                const val = (obj.type === 'damage')
                    ? ((Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0)
                    : (Number(d.value) || 0);
                if (val <= 0) continue;
                byAttacker.set(attackerUid, (byAttacker.get(attackerUid) || 0) + val);
            }
            let total = 0;
            const items = [];
            for (const [attackerUid, amount] of byAttacker.entries()) {
                total += amount;
                const name = userNames[String(attackerUid)] || `#${attackerUid}`;
                items.push({ attackerUid, name, amount });
            }
            items.sort((a,b)=> b.amount - a.amount);
            res.json({ code: 0, data: { victimUid: victim, total, items } });
        } catch (e) {
            logger.error('Failed to build section tanking breakdown', e);
            res.status(500).json({ code: 1, msg: 'Failed to get section tanking breakdown' });
        }
    });

    // Section-specific NPC breakdown
    router.get('/history/:timestamp/section/:index/npc/:enemyUid', async (req, res) => {
        try {
            const { timestamp, index, enemyUid } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const usersPath = path.join(logDir, 'allUserData.json');
            const enemiesPath = path.join(logDir, 'enemies.json');
            let userNames = {};
            let enemyNames = {};
            try {
                const rawU = await fsPromises.readFile(usersPath, 'utf8');
                const objU = JSON.parse(rawU || '{}');
                for (const [k, v] of Object.entries(objU || {})) {
                    if (v && typeof v.name === 'string') userNames[k] = v.name;
                }
            } catch (_) {}
            try {
                const rawE = await fsPromises.readFile(enemiesPath, 'utf8');
                const objE = JSON.parse(rawE || '{}');
                enemyNames = objE || {};
            } catch (_) {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            // sections
            const secs = [];
            let currentStart = null, lastEnd = -1, lastActiveTs = -1;
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || !obj.type) continue;
                if (obj.type === 'damage' || obj.type === 'taken_damage') {
                    const t = Number(obj.ts || 0);
                    if (Number.isFinite(t) && t > lastActiveTs) lastActiveTs = t;
                }
                if (obj.type === 'battle_section_open') {
                    const s = Number(obj?.data?.start || obj.ts || 0);
                    if (s && currentStart == null) currentStart = s;
                } else if (obj.type === 'battle_section_close') {
                    const end = Number(obj?.data?.end || obj.ts || 0);
                    if (currentStart != null && end >= currentStart && end !== lastEnd) {
                        secs.push({ start: currentStart, end });
                        lastEnd = end;
                        currentStart = null;
                    }
                }
            }
            if (currentStart != null && lastActiveTs >= currentStart && lastActiveTs !== lastEnd) {
                secs.push({ start: currentStart, end: lastActiveTs });
                currentStart = null;
            }
            const idx = Number.parseInt(index, 10);
            if (!(idx >= 0 && idx < secs.length)) return res.status(404).json({ code: 1, msg: 'Section not found' });
            const s = secs[idx];
            const targetEnemy = Number.parseInt(enemyUid, 10);
            const byAttacker = new Map();
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || obj.type !== 'damage') continue;
                const ts = Number(obj.ts || 0);
                if (ts < s.start || ts > s.end) continue;
                const d = obj.data || {};
                if (Number(d.targetUid) !== targetEnemy) continue;
                const attackerUid = Number(d.attackerUid);
                if (!Number.isFinite(attackerUid)) continue;
                const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                if (val <= 0) continue;
                byAttacker.set(attackerUid, (byAttacker.get(attackerUid) || 0) + val);
            }
            let total = 0;
            const items = [];
            for (const [attackerUid, amount] of byAttacker.entries()) {
                total += amount;
                const name = userNames[String(attackerUid)] || `#${attackerUid}`;
                items.push({ attackerUid, name, amount });
            }
            items.sort((a,b)=> b.amount - a.amount);
            const enemyName = enemyNames[String(targetEnemy)] || `#${targetEnemy}`;
            res.json({ code: 0, data: { enemyUid: targetEnemy, enemyName, total, items } });
        } catch (e) {
            logger.error('Failed to build section NPC breakdown', e);
            res.status(500).json({ code: 1, msg: 'Failed to get section NPC breakdown' });
        }
    });

    // Section-specific skill breakdown
    router.get('/history/:timestamp/section/:index/skill/:uid', async (req, res) => {
        try {
            const { timestamp, index, uid } = req.params;
            const logDir = path.join('./logs', timestamp);
            const eventsPath = path.join(logDir, 'events.ndjson');
            const usersPath = path.join(logDir, 'allUserData.json');
            let userName = `#${uid}`;
            let profession = '';
            let fightPoint = undefined;
            try {
                const rawU = await fsPromises.readFile(usersPath, 'utf8');
                const objU = JSON.parse(rawU || '{}');
                const me = objU?.[uid];
                if (me) {
                    if (typeof me.name === 'string') userName = me.name;
                    if (typeof me.profession === 'string') profession = me.profession;
                    if (me?.attr && typeof me.attr.fightPoint === 'number') fightPoint = me.attr.fightPoint;
                    else if (typeof me.fightPoint === 'number') fightPoint = me.fightPoint;
                }
            } catch (_) {}
            const raw = await fsPromises.readFile(eventsPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            // sections
            const secs = [];
            let currentStart = null, lastEnd = -1, lastActiveTs = -1;
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                if (!obj || !obj.type) continue;
                if (obj.type === 'damage' || obj.type === 'taken_damage') {
                    const t = Number(obj.ts || 0);
                    if (Number.isFinite(t) && t > lastActiveTs) lastActiveTs = t;
                }
                if (obj.type === 'battle_section_open') {
                    const s = Number(obj?.data?.start || obj.ts || 0);
                    if (s && currentStart == null) currentStart = s;
                } else if (obj.type === 'battle_section_close') {
                    const end = Number(obj?.data?.end || obj.ts || 0);
                    if (currentStart != null && end >= currentStart && end !== lastEnd) {
                        secs.push({ start: currentStart, end });
                        lastEnd = end;
                        currentStart = null;
                    }
                }
            }
            if (currentStart != null && lastActiveTs >= currentStart && lastActiveTs !== lastEnd) {
                secs.push({ start: currentStart, end: lastActiveTs });
                currentStart = null;
            }
            const idx = Number.parseInt(index, 10);
            if (!(idx >= 0 && idx < secs.length)) return res.status(404).json({ code: 1, msg: 'Section not found' });
            const s = secs[idx];
            const me = Number.parseInt(uid, 10);
            const skills = {};
            for (const line of lines) {
                if (!line) continue;
                let obj; try { obj = JSON.parse(line); } catch { continue; }
                const ts = Number(obj.ts || 0);
                if (ts < s.start || ts > s.end) continue;
                const d = obj.data || {};
                const attacker = Number(d.attackerUid);
                if (!Number.isFinite(attacker) || attacker !== me) continue;
                const sid = d.skillId != null ? String(d.skillId) : undefined;
                if (!sid) continue;
                const val = (Number(d.hpLessen) > 0 ? Number(d.hpLessen) : Number(d.value)) || 0;
                const isCrit = !!d.crit;
                if (!skills[sid]) skills[sid] = { totalDamage: 0, totalCount: 0, critCount: 0, type: (obj.type === 'heal' ? '治疗' : '伤害'), displayName: sid };
                skills[sid].totalDamage += val > 0 ? val : 0;
                skills[sid].totalCount += 1;
                if (isCrit) skills[sid].critCount += 1;
            }
            // compute critRate
            for (const sid of Object.keys(skills)) {
                const sObj = skills[sid];
                sObj.critRate = sObj.totalCount ? (sObj.critCount / sObj.totalCount) : 0;
            }
            const attr = (typeof fightPoint === 'number') ? { fightPoint } : undefined;
            res.json({ code: 0, data: { name: userName, profession, fightPoint, ...(attr?{attr}:{}), skills } });
        } catch (e) {
            logger.error('Failed to build section skill breakdown', e);
            res.status(500).json({ code: 1, msg: 'Failed to get section skill breakdown' });
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
