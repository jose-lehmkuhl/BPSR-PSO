import { UserData } from '../models/UserData.js';
import { Lock } from '../models/Lock.js';
import { config } from '../config.js';
import socket from './Socket.js';
import logger from './Logger.js';
import fsPromises from 'fs/promises';
import path from 'path';
import monsterNamesEn from '../tables/monster_names_en.json' with { type: 'json' };

class UserDataManager {
    constructor(logger) {
        this.users = new Map();
        this.userCache = new Map();
        this.cacheFilePath = './users.json';

        this.saveThrottleDelay = 2000;
        this.saveThrottleTimer = null;
        this.pendingSave = false;

        this.hpCache = new Map();
        this.startTime = Date.now();

        this.logLock = new Lock();
        this.logDirExist = new Set();

        this.enemyCache = {
            name: new Map(),
            hp: new Map(),
            maxHp: new Map(),
        };

        // Track total damage taken per enemy (for NPC tanking view)
        this.enemiesTaken = new Map();

        // 自动保存
        this.lastAutoSaveTime = 0;
        this.lastLogTime = 0;
        setInterval(() => {
            if (this.lastLogTime < this.lastAutoSaveTime) return;
            this.lastAutoSaveTime = Date.now();
            this.saveAllUserData();
        }, 10 * 1000);

        // New: Interval to clean up inactive users every 30 seconds
        setInterval(() => {
            this.cleanUpInactiveUsers();
        }, 30 * 1000);

        // Per-user DPS time series (recorded once per second)
        this.userDpsSeries = new Map(); // uid -> [{ x: sec, y: dps }]

        // Front-triggered clear flag (handled in checkTimeoutClear on next event)
        this.forceClearRequested = false;

        // Scene-session mode: when enabled, encounters roll only on scene changes
        this.sceneSessionMode = true;

        // Heuristic window for scene-change inference via entity Appear bursts
        this.appearWindow = { count: 0, startTs: 0 };

        // Battle section tracking (scene-scoped)
        this.battleIdleMs = 5000;
        this.battleSections = [];
        this.currentBattleStartTs = null;
        this.lastDamageTs = 0;
    }

    // Compute live combat time: sum of closed sections plus open section clamped to lastDamage+idle
    getLiveCombatTimeMs(nowTs = Date.now()) {
        const sections = Array.isArray(this.battleSections) ? this.battleSections : [];
        let total = 0;
        for (const s of sections) {
            if (!s) continue;
            const start = s.start || 0;
            const end = s.end || 0;
            if (end > start) total += (end - start);
        }
        if (this.currentBattleStartTs != null) {
            // Do not include idle buffer in combat time; clamp to lastDamageTs
            const clampEnd = (this.lastDamageTs > 0 ? this.lastDamageTs : nowTs);
            if (clampEnd > this.currentBattleStartTs) total += (clampEnd - this.currentBattleStartTs);
        }
        return total;
    }

    getCombatClockSnapshot() {
        return {
            start: this.currentBattleStartTs || 0,
            last: this.lastDamageTs || 0,
            idle: this.battleIdleMs || 5000,
        };
    }

    // New: Method to remove users who have not been updated in 60 seconds
    cleanUpInactiveUsers() {
        const inactiveThreshold = 60 * 1000; // 1 minute
        const currentTime = Date.now();

        for (const [uid, user] of this.users.entries()) {
            if (currentTime - user.lastUpdateTime > inactiveThreshold) {
                socket.emit('user_deleted', { uid });

                this.users.delete(uid);
                logger.info(`Removed inactive user with uid ${uid}`);
            }
        }
    }

    async init() {
        await this.loadUserCache();
    }

    async loadUserCache() {
        try {
            await fsPromises.access(this.cacheFilePath);
            const data = await fsPromises.readFile(this.cacheFilePath, 'utf8');
            const cacheData = JSON.parse(data);
            this.userCache = new Map(Object.entries(cacheData));
            logger.info(`Loaded ${this.userCache.size} user cache entries`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Failed to load user cache:', error);
            }
        }
    }

    async saveUserCache() {
        try {
            const cacheData = Object.fromEntries(this.userCache);
            await fsPromises.writeFile(this.cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8');
        } catch (error) {
            logger.error('Failed to save user cache:', error);
        }
    }

    saveUserCacheThrottled() {
        this.pendingSave = true;
        if (this.saveThrottleTimer) {
            clearTimeout(this.saveThrottleTimer);
        }
        this.saveThrottleTimer = setTimeout(async () => {
            if (this.pendingSave) {
                await this.saveUserCache();
                this.pendingSave = false;
                this.saveThrottleTimer = null;
            }
        }, this.saveThrottleDelay);
    }

    async forceUserCacheSave() {
        await this.saveAllUserData(this.users, this.startTime);
        if (this.saveThrottleTimer) {
            clearTimeout(this.saveThrottleTimer);
            this.saveThrottleTimer = null;
        }
        if (this.pendingSave) {
            await this.saveUserCache();
            this.pendingSave = false;
        }
    }

    getUser(uid) {
        if (!this.users.has(uid)) {
            const user = new UserData(uid);
            const cachedData = this.userCache.get(String(uid));
            if (cachedData) {
                if (cachedData.name) {
                    user.setName(cachedData.name);
                }
                if (cachedData.profession) {
                    user.setProfession(cachedData.profession);
                }
                if (cachedData.fightPoint !== undefined && cachedData.fightPoint !== null) {
                    user.setFightPoint(cachedData.fightPoint);
                }
                if (cachedData.maxHp !== undefined && cachedData.maxHp !== null) {
                    user.setAttrKV('max_hp', cachedData.maxHp);
                }
            }
            if (this.hpCache.has(uid)) {
                user.setAttrKV('hp', this.hpCache.get(uid));
            }
            this.users.set(uid, user);
        }
        return this.users.get(uid);
    }

    async addDamage(uid, skillId, element, damage, isCrit, isLucky, isCauseLucky, hpLessenValue = 0, targetUid) {
        if (config.IS_PAUSED) return;
        this.checkTimeoutClear();
        try { await this._tickCombat(Date.now()); } catch (_) {}
        const user = this.getUser(uid);
        user.addDamage(skillId, element, damage, isCrit, isLucky, isCauseLucky, hpLessenValue);
    }

    addHealing(uid, skillId, element, healing, isCrit, isLucky, isCauseLucky, targetUid) {
        if (config.IS_PAUSED) return;
        this.checkTimeoutClear();
        if (uid !== 0) {
            const user = this.getUser(uid);
            user.addHealing(skillId, element, healing, isCrit, isLucky, isCauseLucky);
        }
    }

    async addTakenDamage(uid, damage, isDead) {
        if (config.IS_PAUSED) return;
        this.checkTimeoutClear();
        try { await this._tickCombat(Date.now()); } catch (_) {}
        const user = this.getUser(uid);
        user.addTakenDamage(damage, isDead);
    }

    async addLog(log) {
        if (config.IS_PAUSED) return;

        const logDir = path.join('./logs', String(this.startTime));
        const logFile = path.join(logDir, 'fight.log');
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${log}\n`;

        this.lastLogTime = Date.now();

        await this.logLock.acquire();
        try {
            if (!this.logDirExist.has(logDir)) {
                try {
                    await fsPromises.access(logDir);
                } catch (error) {
                    await fsPromises.mkdir(logDir, { recursive: true });
                }
                this.logDirExist.add(logDir);
            }
            await fsPromises.appendFile(logFile, logEntry, 'utf8');
        } catch (error) {
            logger.error('Failed to save log:', error);
        }
        this.logLock.release();
    }

    async addEvent(type, data) {
        if (config.IS_PAUSED) return;
        const logDir = path.join('./logs', String(this.startTime));
        const eventsFile = path.join(logDir, 'events.ndjson');
        const nowTs = Date.now();

        // Close an open battle section if we've been idle for >= battleIdleMs
        if (this.currentBattleStartTs != null && this.lastDamageTs > 0) {
            if (nowTs - this.lastDamageTs >= this.battleIdleMs) {
                // Close section at lastDamageTs (exclude idle)
                const endTs = this.lastDamageTs;
                const section = { start: this.currentBattleStartTs, end: endTs };
                this.battleSections.push(section);
                await this._writeEvent(eventsFile, logDir, 'battle_section_close', { start: section.start, end: section.end, durationMs: section.end - section.start });
                this.currentBattleStartTs = null;
            }
        }

        // On damage given or received events, open or extend a battle section
        if (type === 'damage' || type === 'taken_damage') {
            if (this.currentBattleStartTs == null) {
                this.currentBattleStartTs = nowTs;
                await this._writeEvent(eventsFile, logDir, 'battle_section_open', { start: nowTs });
            }
            this.lastDamageTs = nowTs;
        }

        await this._writeEvent(eventsFile, logDir, type, data);
        this.lastLogTime = nowTs;
    }

    async _writeEvent(eventsFile, logDir, type, data) {
        const entry = { ts: Date.now(), type, ...({ data }) };
        await this.logLock.acquire();
        try {
            if (!this.logDirExist.has(logDir)) {
                try { await fsPromises.access(logDir); } catch (_) { await fsPromises.mkdir(logDir, { recursive: true }); }
                this.logDirExist.add(logDir);
            }
            await fsPromises.appendFile(eventsFile, JSON.stringify(entry) + '\n', 'utf8');
        } catch (error) {
            logger.error('Failed to save event:', error);
        }
        this.logLock.release();
    }

    // Ensure combat timer opens/closes on damage ticks regardless of downstream addEvent calls
    async _tickCombat(nowTs) {
        const logDir = path.join('./logs', String(this.startTime));
        const eventsFile = path.join(logDir, 'events.ndjson');
        // Close if idle exceeded
        if (this.currentBattleStartTs != null && this.lastDamageTs > 0) {
            if (nowTs - this.lastDamageTs >= this.battleIdleMs) {
                // Close section at lastDamageTs (exclude idle)
                const endTs = this.lastDamageTs;
                const section = { start: this.currentBattleStartTs, end: endTs };
                this.battleSections.push(section);
                await this._writeEvent(eventsFile, logDir, 'battle_section_close', { start: section.start, end: section.end, durationMs: section.end - section.start });
                this.currentBattleStartTs = null;
            }
        }
        // Open if not active
        if (this.currentBattleStartTs == null) {
            this.currentBattleStartTs = nowTs;
            await this._writeEvent(eventsFile, logDir, 'battle_section_open', { start: nowTs });
        }
        this.lastDamageTs = nowTs;
    }

    async addRawPacket(meta, buffer) {
        if (!buffer || buffer.length === 0) return;
        const logDir = path.join('./logs', String(this.startTime));
        const rawFile = path.join(logDir, 'raw.ndjson');
        const entry = { ts: Date.now(), ...(meta || {}), data_b64: buffer.toString('base64') };
        await this.logLock.acquire();
        try {
            if (!this.logDirExist.has(logDir)) {
                try { await fsPromises.access(logDir); } catch (_) { await fsPromises.mkdir(logDir, { recursive: true }); }
                this.logDirExist.add(logDir);
            }
            await fsPromises.appendFile(rawFile, JSON.stringify(entry) + '\n', 'utf8');
        } catch (error) {
            logger.error('Failed to save raw packet:', error);
        }
        this.logLock.release();
    }

    // Heuristic: large bursts of entity Appear within a short window imply map/scene load
    recordAppearBatch(count) {
        const now = Date.now();
        const WINDOW_MS = 3000;
        const INSTANT_THRESHOLD = 15; // single notify
        const CUMULATIVE_THRESHOLD = 30; // within window
        if (!count || count <= 0) return;
        if (!this.appearWindow.startTs || (now - this.appearWindow.startTs) > WINDOW_MS) {
            this.appearWindow.startTs = now;
            this.appearWindow.count = 0;
        }
        this.appearWindow.count += count;
        const trigger = (count >= INSTANT_THRESHOLD) || (this.appearWindow.count >= CUMULATIVE_THRESHOLD);
        if (trigger) {
            try { this.addEvent('scene_change_inferred', { reason: 'appear_burst', instant: count, windowCount: this.appearWindow.count }); } catch (_) {}
            // In scene-session mode, roll immediately
            if (this.sceneSessionMode) {
                this.clearAll();
                try { this.addEvent('scene_rollover', { source: 'appear_burst' }); } catch (_) {}
            } else {
                this.requestClear();
            }
            // reset window to avoid multiple triggers
            this.appearWindow.startTs = now;
            this.appearWindow.count = 0;
        }
    }

    setProfession(uid, profession) {
        const user = this.getUser(uid);
        if (user.profession !== profession) {
            user.setProfession(profession);
            logger.info(`Found profession ${profession} for uid ${uid}`);
            const uidStr = String(uid);
            if (!this.userCache.has(uidStr)) {
                this.userCache.set(uidStr, {});
            }
            this.userCache.get(uidStr).profession = profession;
            this.saveUserCacheThrottled();
        }
    }

    setName(uid, name) {
        const user = this.getUser(uid);
        if (user.name !== name) {
            user.setName(name);
            logger.info(`Found player name ${name} for uid ${uid}`);
            const uidStr = String(uid);
            if (!this.userCache.has(uidStr)) {
                this.userCache.set(uidStr, {});
            }
            this.userCache.get(uidStr).name = name;
            this.saveUserCacheThrottled();
        }
    }

    setFightPoint(uid, fightPoint) {
        const user = this.getUser(uid);
        if (user.fightPoint != fightPoint) {
            user.setFightPoint(fightPoint);
            logger.info(`Found fight point ${fightPoint} for uid ${uid}`);
            const uidStr = String(uid);
            if (!this.userCache.has(uidStr)) {
                this.userCache.set(uidStr, {});
            }
            this.userCache.get(uidStr).fightPoint = fightPoint;
            this.saveUserCacheThrottled();
        }
    }

    setAttrKV(uid, key, value) {
        const user = this.getUser(uid);
        user.attr[key] = value;
        if (key === 'max_hp') {
            const uidStr = String(uid);
            if (!this.userCache.has(uidStr)) {
                this.userCache.set(uidStr, {});
            }
            this.userCache.get(uidStr).maxHp = value;
            this.saveUserCacheThrottled();
        }
        if (key === 'hp') {
            this.hpCache.set(uid, value);
        }
    }

    updateAllRealtimeDps() {
        const now = Date.now();
        const secFromStart = Math.max(0, Math.floor((now - this.startTime) / 1000));
        for (const user of this.users.values()) {
            user.updateRealtimeDps();
            const uid = user.uid;
            const dps = user.damageStats?.realtimeStats?.value || 0;
            if (!this.userDpsSeries.has(uid)) this.userDpsSeries.set(uid, []);
            const series = this.userDpsSeries.get(uid);
            const last = series.length ? series[series.length - 1] : null;
            if (!last || last.x !== secFromStart) {
                series.push({ x: secFromStart, y: dps });
                if (series.length > 3 * 3600) series.shift();
            } else {
                last.y = dps;
            }
        }
    }

    getUserSkillData(uid) {
        const user = this.users.get(uid);
        if (!user) return null;
        const dSeries = Array.isArray(this.userDpsSeries.get(uid)) ? this.userDpsSeries.get(uid) : [];
        return {
            uid: user.uid,
            name: user.name,
            profession: user.profession + (user.subProfession ? `-${user.subProfession}` : ''),
            total_dps: user.getTotalDps(),
            skills: user.getSkillSummary(),
            attr: user.attr,
            dps_series: dSeries,
        };
    }

    getAllUsersData() {
        const result = {};
        for (const [uid, user] of this.users.entries()) {
            result[uid] = user.getSummary();
        }
        return result;
    }

    getAllEnemiesData() {
        const result = {};
        const enemyIds = new Set([
            ...this.enemyCache.name.keys(),
            ...this.enemyCache.hp.keys(),
            ...this.enemyCache.maxHp.keys(),
        ]);
        enemyIds.forEach((id) => {
            result[id] = {
                name: this.enemyCache.name.get(id),
                hp: this.enemyCache.hp.get(id),
                max_hp: this.enemyCache.maxHp.get(id),
                taken_total: this.enemiesTaken.get(id) || 0,
            };
        });
        return result;
    }

    deleteEnemyData(id) {
        this.enemyCache.name.delete(id);
        this.enemyCache.hp.delete(id);
        this.enemyCache.maxHp.delete(id);
        this.enemiesTaken.delete(id);
    }

    refreshEnemyCache() {
        this.enemyCache.name.clear();
        this.enemyCache.hp.clear();
        this.enemyCache.maxHp.clear();
        this.enemiesTaken.clear();
    }

    // Discard current encounter logs and reset state without saving
    async resetWithoutSave() {
        try {
            const logDir = path.join('./logs', String(this.startTime));
            try {
                await fsPromises.rm(logDir, { recursive: true, force: true });
            } catch (_) {}
        } catch (_) {}
        this.users = new Map();
        this.refreshEnemyCache();
        if (this.userDpsSeries && this.userDpsSeries.clear) this.userDpsSeries.clear();
        this.startTime = Date.now();
        this.lastAutoSaveTime = 0;
        this.lastLogTime = 0;
    }

    async clearAll() {
        // Prevent addLog from writing to the wrong folder during rollover
        await this.logLock.acquire();
        let usersToSave, saveStartTime, enemiesNameSnapshot, enemiesTakenSnapshot, dpsSeriesSnapshot, battleSectionsSnapshot;
        try {
            usersToSave = this.users;
            saveStartTime = this.startTime;
            enemiesNameSnapshot = new Map(this.enemyCache.name);
            enemiesTakenSnapshot = new Map(this.enemiesTaken);
            dpsSeriesSnapshot = new Map();
            for (const [uid, arr] of this.userDpsSeries.entries()) {
                dpsSeriesSnapshot.set(uid, Array.isArray(arr) ? arr.slice() : []);
            }
            // Finalize any open battle section before rollover
            battleSectionsSnapshot = Array.isArray(this.battleSections) ? this.battleSections.slice() : [];
            if (this.currentBattleStartTs != null) {
                // Finalize at lastDamageTs (exclude idle buffer)
                const endTs = this.lastDamageTs > 0 ? this.lastDamageTs : Date.now();
                const section = { start: this.currentBattleStartTs, end: endTs };
                battleSectionsSnapshot.push(section);
            }
            // Switch to a fresh encounter immediately so subsequent logs go to a new folder
            this.users = new Map();
            this.startTime = Date.now();
            this.lastAutoSaveTime = 0;
            this.lastLogTime = 0;
            this.refreshEnemyCache();
            this.userDpsSeries.clear();
            // Reset battle section state for new scene
            this.battleSections = [];
            this.currentBattleStartTs = null;
            this.lastDamageTs = 0;
        } finally {
            this.logLock.release();
        }
        // Persist previous encounter outside the lock
        this.saveAllUserData(usersToSave, saveStartTime, enemiesNameSnapshot, enemiesTakenSnapshot, dpsSeriesSnapshot, battleSectionsSnapshot);
    }

    clearIdentities() {
        // Reset in-memory users
        for (const user of this.users.values()) {
            user.setName('');
            user.setSubProfession('');
            user.setProfession('...');
            if (user.specScores) user.specScores.clear();
        }
        // Reset persistent cache
        this.userCache.clear();
        this.forceUserCacheSave().catch(() => {});
    }

    addEnemyTaken(targetUid, hpLessenValue, damageValue) {
        const addVal = (hpLessenValue && hpLessenValue > 0) ? hpLessenValue : (damageValue || 0);
        if (addVal <= 0) return;
        const prev = this.enemiesTaken.get(targetUid) || 0;
        this.enemiesTaken.set(targetUid, prev + addVal);
    }

    getUserIds() {
        return Array.from(this.users.keys());
    }

    async saveAllUserData(usersToSave = null, startTime = null, enemiesNameSnapshot = null, enemiesTakenSnapshot = null, dpsSeriesSnapshot = null, battleSectionsSnapshot = null) {
        try {
            const endTime = Date.now();
            const users = usersToSave || this.users;
            const timestamp = startTime || this.startTime;
            const logDir = path.join('./logs', String(timestamp));
            const usersDir = path.join(logDir, 'users');
            const summary = {
                startTime: timestamp,
                endTime,
                duration: endTime - timestamp,
                userCount: users.size,
                version: config.VERSION,
            };

            const allUsersData = {};
            const userDatas = new Map();
            // Pre-compute combat time from snapshot if available
            const sectionsSnap = Array.isArray(battleSectionsSnapshot) ? battleSectionsSnapshot : [];
            const combatTimeMsSnap = sectionsSnap.reduce((acc, s) => acc + Math.max(0, (s.end || 0) - (s.start || 0)), 0);
            for (const [uid, user] of users.entries()) {
                const summary = user.getSummary();
                const totalDamage = user?.damageStats?.stats?.total || 0;
                const dpsCombat = combatTimeMsSnap > 0 ? (totalDamage / combatTimeMsSnap) * 1000 : 0;
                summary.total_dps = Number.isFinite(dpsCombat) ? dpsCombat : 0;
                allUsersData[uid] = summary;
                const userData = {
                    uid: user.uid,
                    name: user.name,
                    profession: user.profession + (user.subProfession ? `-${user.subProfession}` : ''),
                    total_dps: Number.isFinite(dpsCombat) ? dpsCombat : 0,
                    skills: user.getSkillSummary(),
                    attr: user.attr,
                    dps_series: Array.isArray((dpsSeriesSnapshot || this.userDpsSeries).get(uid)) ? (dpsSeriesSnapshot || this.userDpsSeries).get(uid) : [],
                };
                userDatas.set(uid, userData);
            }

            try {
                await fsPromises.access(usersDir);
            } catch (error) {
                await fsPromises.mkdir(usersDir, { recursive: true });
            }

            const allUserDataPath = path.join(logDir, 'allUserData.json');
            await fsPromises.writeFile(allUserDataPath, JSON.stringify(allUsersData, null, 2), 'utf8');
            for (const [uid, userData] of userDatas.entries()) {
                const userDataPath = path.join(usersDir, `${uid}.json`);
                await fsPromises.writeFile(userDataPath, JSON.stringify(userData, null, 2), 'utf8');
            }
            // Persist enemies (uid -> name) for historical meta (use snapshot if provided)
            const enemiesMap = enemiesNameSnapshot || this.enemyCache.name;
            const enemiesObj = Object.fromEntries(enemiesMap);
            await fsPromises.writeFile(path.join(logDir, 'enemies.json'), JSON.stringify(enemiesObj, null, 2), 'utf8');
            await fsPromises.writeFile(path.join(logDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
            // Write encounter meta (name/duration/targets) to simplify client
            try {
                let topId = null;
                let topVal = -1;
                const takenMap = enemiesTakenSnapshot || this.enemiesTaken;
                for (const [eid, taken] of takenMap.entries()) {
                    if (taken > topVal) { topVal = taken; topId = eid; }
                }
                let topName = '';
                if (topId != null) {
                    const nameMap = enemiesNameSnapshot || this.enemyCache.name;
                    topName = nameMap.get(topId) || monsterNamesEn[String(topId)] || `#${topId}`;
                }
                const mm = String(Math.floor((summary.duration || 0) / 60000)).padStart(2, '0');
                const ss = String(Math.floor(((summary.duration || 0) % 60000) / 1000)).padStart(2, '0');
                // Compute combat sections and total combat time
                const sections = Array.isArray(battleSectionsSnapshot) ? battleSectionsSnapshot : [];
                const combatTimeMs = sections.reduce((acc, s) => acc + Math.max(0, (s.end || 0) - (s.start || 0)), 0);
                const cmm = String(Math.floor((combatTimeMs || 0) / 60000)).padStart(2, '0');
                const css = String(Math.floor(((combatTimeMs || 0) % 60000) / 1000)).padStart(2, '0');

                const meta = {
                    name: topName,
                    targetCount: (enemiesTakenSnapshot ? enemiesTakenSnapshot.size : this.enemiesTaken.size),
                    durationMs: combatTimeMs,
                    startTime: summary.startTime,
                    endTime: summary.endTime,
                    label: `${topName || 'Encounter'}(${enemiesTakenSnapshot ? enemiesTakenSnapshot.size : this.enemiesTaken.size}) [${cmm}:${css}]`,
                    combatSections: sections,
                    combatTimeMs,
                };
                await fsPromises.writeFile(path.join(logDir, 'encounter_meta.json'), JSON.stringify(meta, null, 2), 'utf8');

                // Persist enemies_tanking for historical NPC tab
                const tankObj = {};
                const nameMap = enemiesNameSnapshot || this.enemyCache.name;
                for (const [eid, taken] of takenMap.entries()) {
                    const nm = nameMap.get(eid) || monsterNamesEn[String(eid)] || `#${eid}`;
                    tankObj[eid] = { name: nm, taken_total: taken };
                }
                await fsPromises.writeFile(path.join(logDir, 'enemies_tanking.json'), JSON.stringify(tankObj, null, 2), 'utf8');
            } catch {}
            logger.debug(`Saved data for ${summary.userCount} users to ${logDir}`);
        } catch (error) {
            logger.error('Failed to save all user data:', error);
            throw error;
        }
    }

    checkTimeoutClear() {
        // If front requested a clear (e.g., on scene change), honor immediately
        if (this.forceClearRequested) {
            this.forceClearRequested = false;
            this.clearAll();
            logger.info('Front-requested clear executed.');
            return;
        }
        // When scene-session mode is enabled, do not auto-clear by OOC timer
        if (this.sceneSessionMode) return;
        const thresholdSec = config.GLOBAL_SETTINGS.outOfCombatClearSeconds || 0;
        if (!thresholdSec || this.lastLogTime === 0 || this.users.size === 0) return;
        const currentTime = Date.now();
        if (this.lastLogTime && currentTime - this.lastLogTime > thresholdSec * 1000) {
            this.clearAll();
            logger.info('Out-of-combat timeout reached, statistics cleared!');
        }
    }

    requestClear() {
        this.forceClearRequested = true;
    }

    getGlobalSettings() {
        return config.GLOBAL_SETTINGS;
    }
}

const userDataManager = new UserDataManager();
export default userDataManager;
