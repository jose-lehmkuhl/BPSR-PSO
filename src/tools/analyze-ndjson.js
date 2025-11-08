/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function parseArgs() {
	const args = process.argv.slice(2);
	const out = { idle: 5000, mode: 'report' };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--file' || a === '-f') out.file = args[++i];
		else if (a === '--users') out.users = args[++i];
		else if (a === '--enemies') out.enemies = args[++i];
		else if (a === '--idle') out.idle = Number(args[++i]) || 5000;
		else if (a === '--mode') out.mode = String(args[++i] || '').trim();
		else if (a === '--section' || a === '-s') out.section = Number(args[++i]);
		else if (a === '--uid') out.uid = Number(args[++i]);
		else if (a === '--enemy' || a === '--enemyUid') out.enemyUid = Number(args[++i]);
		else if (a === '--pretty') out.pretty = true;
		else if (a === '--help' || a === '-h') out.help = true;
	}
	return out;
}

function loadJsonSafe(p) {
	if (!p) return {};
	try {
		const raw = fs.readFileSync(p, 'utf8');
		return JSON.parse(raw || '{}');
	} catch {
		return {};
	}
}

function valueFrom(data) {
	const v = Number(data?.hpLessen);
	if (Number.isFinite(v) && v > 0) return v;
	const vv = Number(data?.value);
	return Number.isFinite(vv) ? vv : 0;
}

function ensureMap(map, key) {
	let m = map.get(key);
	if (!m) {
		m = new Map();
		map.set(key, m);
	}
	return m;
}

function analyze(lines, opts) {
	const idleMs = opts.idle || 5000;
	const players = new Map(); // uid -> { damage, healing, perMonster: Map<enemyUid,total>, perSection: [{damage,healing, skills}], damageBySkill: Map<sid,total>, healBySkill: Map<sid,total> }
	const monsters = new Map(); // enemyUid -> { takenTotal, byPlayer: Map<attackerUid,total>, perSectionByPlayer: Map<sectionIndex, Map<playerUid,total>> }
	const sections = []; // { start, end }

	let currentOpenStart = null;
	let lastDamageTs = 0;
	let lastClosedEnd = -1; // for dedupe

	function commitClose(endTs) {
		if (currentOpenStart == null) return;
		if (endTs < currentOpenStart) return;
		if (lastClosedEnd === endTs) return; // idempotent
		sections.push({ start: currentOpenStart, end: endTs });
		lastClosedEnd = endTs;
		currentOpenStart = null;
	}

	for (const line of lines) {
		if (!line) continue;
		let obj;
		try { obj = JSON.parse(line); } catch { continue; }
		const { ts, type, data } = obj || {};
		if (!type) continue;

		if (type === 'battle_section_open') {
			// open idempotent
			if (currentOpenStart == null) {
				const s = Number(data?.start) || Number(ts) || Date.now();
				currentOpenStart = s;
			}
			continue;
		}
		if (type === 'battle_section_close') {
			const endTs = Number(data?.end) || Number(ts) || 0;
			// Only accept closes at least idle after last open
			if (currentOpenStart != null && endTs >= currentOpenStart + idleMs) {
				commitClose(endTs);
			}
			continue;
		}

		if (type === 'damage' || type === 'heal') {
			const attacker = Number(data?.attackerUid);
			const target = Number(data?.targetUid);
			const amt = valueFrom(data);
			const skillId = data?.skillId != null ? String(data.skillId) : undefined;
			const now = Number(ts) || Date.now();
			if (amt > 0) {
				// manage open section by activity if missing explicit markers
				if (currentOpenStart == null) currentOpenStart = now;
				lastDamageTs = now;
			}
			if (Number.isFinite(attacker)) {
				const p = players.get(attacker) || { damage: 0, healing: 0, perMonster: new Map(), perSection: [], damageBySkill: new Map(), healBySkill: new Map() };
				if (type === 'damage') p.damage += amt;
				else p.healing += amt;
				players.set(attacker, p);

				// per skill totals
				if (skillId) {
					if (type === 'damage') {
						p.damageBySkill.set(skillId, (p.damageBySkill.get(skillId) || 0) + amt);
					} else {
						p.healBySkill.set(skillId, (p.healBySkill.get(skillId) || 0) + amt);
					}
				}

				// per monster
				if (Number.isFinite(target)) {
					const perMon = ensureMap(p.perMonster, target);
					perMon.set('total', (perMon.get('total') || 0) + amt);
					// monster aggregates
					const mon = monsters.get(target) || { takenTotal: 0, byPlayer: new Map(), perSectionByPlayer: new Map() };
					if (type === 'damage') mon.takenTotal += amt;
					const prev = mon.byPlayer.get(attacker) || 0;
					mon.byPlayer.set(attacker, prev + (type === 'damage' ? amt : 0));
					monsters.set(target, mon);
				}
			}
		}
	}

	// If we had activity but no explicit close, close at lastDamageTs (exclude idle)
	if (currentOpenStart != null && lastDamageTs > 0) {
		if (lastDamageTs >= currentOpenStart) {
			commitClose(lastDamageTs);
		}
	}

	// Build per-section aggregates
	const perSectionDamageByPlayer = sections.map(() => new Map());
	const perSectionHealByPlayer = sections.map(() => new Map());
	const perSectionDamageSkill = sections.map(() => new Map()); // sectionIdx -> Map<playerUid, Map<skillId,total>>
	const perSectionHealSkill = sections.map(() => new Map()); // sectionIdx -> Map<playerUid, Map<skillId,total>>
	for (const line of lines) {
		if (!line) continue;
		let obj; try { obj = JSON.parse(line); } catch { continue; }
		const { ts, type, data } = obj || {};
		const now = Number(ts) || 0;
		if (!now) continue;
		if (type !== 'damage' && type !== 'heal') continue;
		const attacker = Number(data?.attackerUid);
		if (!Number.isFinite(attacker)) continue;
		const amt = valueFrom(data);
		if (amt <= 0) continue;
		const skillId = data?.skillId != null ? String(data.skillId) : undefined;
		// find section index (linear scan is fine for small counts)
		let idx = -1;
		for (let i = 0; i < sections.length; i++) {
			const s = sections[i];
			if (now >= s.start && now <= s.end) { idx = i; break; }
		}
		if (idx === -1) continue;
		if (type === 'damage') {
			perSectionDamageByPlayer[idx].set(attacker, (perSectionDamageByPlayer[idx].get(attacker) || 0) + amt);
			if (skillId) {
				const sMap = ensureMap(perSectionDamageSkill[idx], attacker);
				sMap.set(skillId, (sMap.get(skillId) || 0) + amt);
			}
		} else {
			perSectionHealByPlayer[idx].set(attacker, (perSectionHealByPlayer[idx].get(attacker) || 0) + amt);
			if (skillId) {
				const sMap = ensureMap(perSectionHealSkill[idx], attacker);
				sMap.set(skillId, (sMap.get(skillId) || 0) + amt);
			}
		}
	}

	// Finalize player views and monster per-section
	const combatTimeMs = sections.reduce((sum, s) => sum + Math.max(0, (s.end || 0) - (s.start || 0)), 0);
	const playersOut = {};
	for (const [uid, p] of players.entries()) {
		const perSection = sections.map((s, i) => {
			const d = perSectionDamageByPlayer[i].get(uid) || 0;
			const h = perSectionHealByPlayer[i].get(uid) || 0;
			const dur = Math.max(1, (s.end - s.start) / 1000);
			// skills for this section
			const dmgSkillsMap = perSectionDamageSkill[i].get(uid) || new Map();
			const healSkillsMap = perSectionHealSkill[i].get(uid) || new Map();
			const dmgSkills = {};
			const healSkills = {};
			for (const [sid, total] of dmgSkillsMap.entries()) {
				dmgSkills[sid] = { total, dps: total / dur };
			}
			for (const [sid, total] of healSkillsMap.entries()) {
				healSkills[sid] = { total, hps: total / dur };
			}
			return {
				index: i,
				start: s.start,
				end: s.end,
				durationMs: s.end - s.start,
				damage: d,
				healing: h,
				dps: d / dur,
				hps: h / dur,
				skills: { damage: dmgSkills, healing: healSkills },
			};
		});
		// overall skills
		const skillsDamage = {};
		const skillsHealing = {};
		const denom = Math.max(1, combatTimeMs / 1000);
		for (const [sid, total] of p.damageBySkill.entries()) {
			skillsDamage[sid] = { total, dps: total / denom };
		}
		for (const [sid, total] of p.healBySkill.entries()) {
			skillsHealing[sid] = { total, hps: total / denom };
		}
		const perMonster = {};
		for (const [enemyUid, mm] of p.perMonster.entries()) {
			perMonster[String(enemyUid)] = mm.get('total') || 0;
		}
		playersOut[String(uid)] = {
			name: undefined, // resolved later
			totalDamage: p.damage,
			totalHealing: p.healing,
			dps: combatTimeMs > 0 ? (p.damage / (combatTimeMs / 1000)) : 0,
			hps: combatTimeMs > 0 ? (p.healing / (combatTimeMs / 1000)) : 0,
			skillsDamage,
			skillsHealing,
			perMonsterDamage: perMonster,
			perSection,
		};
	}

	const monstersOut = {};
	for (const [enemyUid, m] of monsters.entries()) {
		const perSectionByPlayer = {};
		for (let i = 0; i < sections.length; i++) {
			// reconstruct from damage lines again would be heavy; do a second pass at the end if needed
			// For now, we only provide overall byPlayer and takenTotal (sufficient for most uses).
			// Advanced: could bucket by section similar to players if necessary.
		}
		const byPlayer = {};
		for (const [attackerUid, total] of m.byPlayer.entries()) {
			byPlayer[String(attackerUid)] = total;
		}
		monstersOut[String(enemyUid)] = {
			name: undefined, // resolved later
			totalDamageReceived: m.takenTotal,
			byPlayer,
			perSectionByPlayer: {}, // optional, can be filled if needed
		};
	}

	return {
		idleMs,
		sections,
		combatTimeMs,
		players: playersOut,
		monsters: monstersOut,
	};
}

function resolveNames(report, usersJson, enemiesJson) {
	const users = usersJson || {};
	const enemies = enemiesJson || {};
	for (const [uid, p] of Object.entries(report.players)) {
		if (!p.name && users[uid] && typeof users[uid].name === 'string') {
			p.name = users[uid].name;
		}
	}
	for (const [eid, m] of Object.entries(report.monsters)) {
		if (!m.name && enemies[eid]) m.name = enemies[eid];
	}
	return report;
}

function buildSections(lines, idleMs) {
	const sections = [];
	let currentOpenStart = null;
	let lastDamageTs = -1;
	let lastClosedEnd = -1;
	for (const line of lines) {
		if (!line) continue;
		let obj; try { obj = JSON.parse(line); } catch { continue; }
		if (!obj || !obj.type) continue;
		const ts = Number(obj.ts || 0);
		if (obj.type === 'battle_section_open') {
			if (currentOpenStart == null) currentOpenStart = (Number(obj?.data?.start) || ts || Date.now());
			continue;
		}
		if (obj.type === 'battle_section_close') {
			const endTs = Number(obj?.data?.end) || ts || 0;
			if (currentOpenStart != null && endTs >= currentOpenStart + idleMs && lastClosedEnd !== endTs) {
				sections.push({ start: currentOpenStart, end: endTs });
				lastClosedEnd = endTs;
				currentOpenStart = null;
			}
			continue;
		}
		if (obj.type === 'damage' || obj.type === 'taken_damage') {
			if (currentOpenStart == null) currentOpenStart = ts;
			if (ts > lastDamageTs) lastDamageTs = ts;
		}
	}
	if (currentOpenStart != null && lastDamageTs >= currentOpenStart && lastClosedEnd !== lastDamageTs) {
		sections.push({ start: currentOpenStart, end: lastDamageTs });
	}
	return sections;
}

function within(ts, s) { return ts >= s.start && ts <= s.end; }

function endpoint_analysis(lines, enemies, idleMs) {
	const sections = buildSections(lines, idleMs);
	// Per-section top enemy
	const sectionsOut = sections.map((s, index) => {
		const totals = {};
		for (const line of lines) {
			if (!line) continue;
			let obj; try { obj = JSON.parse(line); } catch { continue; }
			if (!obj || obj.type !== 'damage') continue;
			const ts = Number(obj.ts || 0);
			if (!within(ts, s)) continue;
			const d = obj.data || {};
			const tgt = Number(d.targetUid);
			const val = valueFrom(d);
			if (!Number.isFinite(tgt) || val <= 0) continue;
			totals[tgt] = (totals[tgt] || 0) + val;
		}
		let topId = null, topVal = -1;
		for (const [eidStr, tot] of Object.entries(totals)) {
			const eid = Number(eidStr);
			if (tot > topVal) { topVal = tot; topId = eid; }
		}
		return { index, start: s.start, end: s.end, durationMs: s.end - s.start, topEnemyId: topId, topEnemyName: enemies[String(topId)] || (topId != null ? `#${topId}` : '') };
	});
	// Scene name = longest section's top enemy
	let sceneName = '';
	if (sectionsOut.length) {
		let longest = sectionsOut[0];
		for (const sec of sectionsOut) if ((sec.durationMs||0) > (longest.durationMs||0)) longest = sec;
		sceneName = longest.topEnemyName || '';
	}
	return { code: 0, data: { sections: sectionsOut, sceneName } };
}

function endpoint_scene_data(lines, users, enemies, idleMs) {
	// Aggregate across whole scene
	const userAgg = new Map(); // uid -> { name, total_damage:{total}, total_healing:{total}, taken_damage }
	const enemiesAgg = new Map(); // enemyUid -> taken_total
	for (const line of lines) {
		if (!line) continue;
		let obj; try { obj = JSON.parse(line); } catch { continue; }
		if (!obj || !obj.type) continue;
		const d = obj.data || {};
		if (obj.type === 'damage') {
			const attacker = Number(d.attackerUid);
			const target = Number(d.targetUid);
			const val = valueFrom(d);
			if (Number.isFinite(attacker) && val > 0) {
				const u = userAgg.get(attacker) || { name: users[String(attacker)]?.name || `#${attacker}`, total_damage:{ total:0 }, total_healing:{ total:0 }, taken_damage:0 };
				u.total_damage.total += val;
				userAgg.set(attacker, u);
			}
			if (Number.isFinite(target) && val > 0) {
				enemiesAgg.set(target, (enemiesAgg.get(target) || 0) + val);
			}
		} else if (obj.type === 'heal') {
			const attacker = Number(d.attackerUid);
			const val = valueFrom(d);
			if (Number.isFinite(attacker) && val > 0) {
				const u = userAgg.get(attacker) || { name: users[String(attacker)]?.name || `#${attacker}`, total_damage:{ total:0 }, total_healing:{ total:0 }, taken_damage:0 };
				u.total_healing.total += val;
				userAgg.set(attacker, u);
			}
		} else if (obj.type === 'taken_damage') {
			const victim = Number(d.targetUid);
			const val = Number(d.value) || 0;
			if (Number.isFinite(victim) && val > 0) {
				const u = userAgg.get(victim) || { name: users[String(victim)]?.name || `#${victim}`, total_damage:{ total:0 }, total_healing:{ total:0 }, taken_damage:0 };
				u.taken_damage += val;
				userAgg.set(victim, u);
			}
		}
	}
	const userOut = {};
	for (const [uid, u] of userAgg.entries()) {
		const meta = users[String(uid)] || {};
		const profession = typeof meta.profession === 'string' ? meta.profession : '';
		const fightPoint = (meta?.attr && typeof meta.attr.fightPoint === 'number') ? meta.attr.fightPoint
			: (typeof meta.fightPoint === 'number' ? meta.fightPoint : undefined);
		userOut[String(uid)] = { name: u.name, profession, fightPoint, total_damage: u.total_damage, total_healing: u.total_healing, total_dps: 0, total_hps: 0, taken_damage: u.taken_damage };
	}
	const enemiesOut = {};
	for (const [eid, total] of enemiesAgg.entries()) {
		enemiesOut[String(eid)] = { id: eid, name: enemies[String(eid)] || `#${eid}`, taken_total: total };
	}
	return { code: 0, user: userOut, enemies: enemiesOut };
}

function endpoint_section_data(lines, users, enemies, idleMs, index) {
	const secs = buildSections(lines, idleMs);
	if (!(index >= 0 && index < secs.length)) return { code: 1, msg: 'Section not found' };
	const s = secs[index];
	const start = s.start, end = s.end;
	const durationSec = Math.max(1, Math.floor((end - start) / 1000));
	const userAgg = new Map();
	const enemiesAgg = new Map();
	for (const line of lines) {
		if (!line) continue;
		let obj; try { obj = JSON.parse(line); } catch { continue; }
		if (!obj || !obj.type) continue;
		const ts = Number(obj.ts || 0);
		if (!(ts >= start && ts <= end)) continue;
		const d = obj.data || {};
		if (obj.type === 'damage') {
			const attacker = Number(d.attackerUid);
			const target = Number(d.targetUid);
			const val = valueFrom(d);
			if (Number.isFinite(attacker) && val > 0) {
				const u = userAgg.get(attacker) || { name: users[String(attacker)]?.name || `#${attacker}`, total_damage:{ total:0 }, total_healing:{ total:0 }, taken_damage:0 };
				u.total_damage.total += val;
				userAgg.set(attacker, u);
			}
			if (Number.isFinite(target) && val > 0) enemiesAgg.set(target, (enemiesAgg.get(target) || 0) + val);
		} else if (obj.type === 'heal') {
			const attacker = Number(d.attackerUid);
			const val = valueFrom(d);
			if (Number.isFinite(attacker) && val > 0) {
				const u = userAgg.get(attacker) || { name: users[String(attacker)]?.name || `#${attacker}`, total_damage:{ total:0 }, total_healing:{ total:0 }, taken_damage:0 };
				u.total_healing.total += val;
				userAgg.set(attacker, u);
			}
		} else if (obj.type === 'taken_damage') {
			const victim = Number(d.targetUid);
			const val = Number(d.value) || 0;
			if (Number.isFinite(victim) && val > 0) {
				const u = userAgg.get(victim) || { name: users[String(victim)]?.name || `#${victim}`, total_damage:{ total:0 }, total_healing:{ total:0 }, taken_damage:0 };
				u.taken_damage += val;
				userAgg.set(victim, u);
			}
		}
	}
	const userOut = {};
	for (const [uid, u] of userAgg.entries()) {
		const meta = users[String(uid)] || {};
		const profession = typeof meta.profession === 'string' ? meta.profession : '';
		const fightPoint = (meta?.attr && typeof meta.attr.fightPoint === 'number') ? meta.attr.fightPoint
			: (typeof meta.fightPoint === 'number' ? meta.fightPoint : undefined);
		userOut[String(uid)] = { name: u.name, profession, fightPoint, total_damage: u.total_damage, total_healing: u.total_healing, total_dps: (u.total_damage.total||0)/durationSec, total_hps: (u.total_healing.total||0)/durationSec, taken_damage: u.taken_damage };
	}
	const enemiesOut = {};
	for (const [eid, total] of enemiesAgg.entries()) {
		enemiesOut[String(eid)] = { id: eid, name: enemies[String(eid)] || `#${eid}`, taken_total: total };
	}
	return { code: 0, user: userOut, enemies: enemiesOut, durationSec };
}

function endpoint_npc(lines, users, enemies, idleMs, enemyUid, index) {
	const secs = buildSections(lines, idleMs);
	let filter = () => true;
	if (Number.isFinite(index) && index >= 0 && index < secs.length) {
		const s = secs[index];
		filter = (ts) => within(ts, s);
	}
	const byAttacker = new Map();
	for (const line of lines) {
		if (!line) continue;
		let obj; try { obj = JSON.parse(line); } catch { continue; }
		if (!obj || obj.type !== 'damage') continue;
		const ts = Number(obj.ts || 0);
		if (!filter(ts)) continue;
		const d = obj.data || {};
		if (Number(d.targetUid) !== enemyUid) continue;
		const attacker = Number(d.attackerUid);
		const val = valueFrom(d);
		if (!Number.isFinite(attacker) || val <= 0) continue;
		byAttacker.set(attacker, (byAttacker.get(attacker) || 0) + val);
	}
	let total = 0;
	const items = [];
	for (const [attacker, amount] of byAttacker.entries()) {
		total += amount;
		const name = users[String(attacker)]?.name || `#${attacker}`;
		items.push({ attackerUid: attacker, name, amount });
	}
	items.sort((a,b)=> b.amount - a.amount);
	return { code: 0, data: { enemyUid, enemyName: enemies[String(enemyUid)] || `#${enemyUid}`, total, items } };
}

function endpoint_tanking(lines, users, enemies, idleMs, uid, index) {
	const secs = buildSections(lines, idleMs);
	let filter = () => true;
	if (Number.isFinite(index) && index >= 0 && index < secs.length) {
		const s = secs[index];
		filter = (ts) => within(ts, s);
	}
	const byAttacker = new Map();
	for (const line of lines) {
		if (!line) continue;
		let obj; try { obj = JSON.parse(line); } catch { continue; }
		if (!obj || (obj.type !== 'damage' && obj.type !== 'taken_damage')) continue;
		const ts = Number(obj.ts || 0);
		if (!filter(ts)) continue;
		const d = obj.data || {};
		if (Number(d.targetUid) !== uid) continue;
		const attacker = Number(d.attackerUid);
		const val = obj.type === 'damage' ? valueFrom(d) : (Number(d.value) || 0);
		if (!Number.isFinite(attacker) || val <= 0) continue;
		byAttacker.set(attacker, (byAttacker.get(attacker) || 0) + val);
	}
	let total = 0;
	const items = [];
	for (const [attacker, amount] of byAttacker.entries()) {
		total += amount;
		const name = users[String(attacker)]?.name || `#${attacker}`;
		items.push({ attackerUid: attacker, name, amount });
	}
	items.sort((a,b)=> b.amount - a.amount);
	return { code: 0, data: { victimUid: uid, total, items } };
}

function endpoint_skill(lines, users, idleMs, uid, index) {
	const secs = buildSections(lines, idleMs);
	let filter = () => true;
	if (Number.isFinite(index) && index >= 0 && index < secs.length) {
		const s = secs[index];
		filter = (ts) => within(ts, s);
	}
	const skills = {};
	for (const line of lines) {
		if (!line) continue;
		let obj; try { obj = JSON.parse(line); } catch { continue; }
		if (!obj || (obj.type !== 'damage' && obj.type !== 'heal')) continue;
		const ts = Number(obj.ts || 0);
		if (!filter(ts)) continue;
		const d = obj.data || {};
		const attacker = Number(d.attackerUid);
		if (!Number.isFinite(attacker) || attacker !== uid) continue;
		const sid = d.skillId != null ? String(d.skillId) : undefined;
		if (!sid) continue;
		const val = valueFrom(d);
		const type = obj.type === 'heal' ? '治疗' : '伤害';
		if (!skills[sid]) skills[sid] = { displayName: sid, type, totalDamage: 0, totalCount: 0, critCount: 0 };
		skills[sid].totalDamage += val > 0 ? val : 0;
		skills[sid].totalCount += 1;
		if (d.crit) skills[sid].critCount += 1;
	}
	for (const sid of Object.keys(skills)) {
		const s = skills[sid];
		s.critRate = s.totalCount ? (s.critCount / s.totalCount) : 0;
	}
	const u = users[String(uid)] || {};
	const name = typeof u.name === 'string' ? u.name : `#${uid}`;
	const profession = typeof u.profession === 'string' ? u.profession : '';
	const fightPoint = (u?.attr && typeof u.attr.fightPoint === 'number') ? u.attr.fightPoint : (typeof u.fightPoint === 'number' ? u.fightPoint : undefined);
	const attr = (typeof fightPoint === 'number') ? { fightPoint } : undefined;
	return { code: 0, data: { name, profession, fightPoint, ...(attr?{attr}:{}), skills } };
}

function main() {
	const args = parseArgs();
	if (args.help || !args.file) {
		console.log('Usage: node src/tools/analyze-ndjson.js --file <events.ndjson> [--users allUserData.json] [--enemies enemies.json] [--idle 5000] [--mode report|analysis|scene-data|section-data|npc|tanking|skill] [--section N] [--uid X] [--enemy Y] [--pretty]');
		process.exit(args.file ? 0 : 1);
	}
	const filePath = path.resolve(args.file);
	const raw = fs.readFileSync(filePath, 'utf8');
	const lines = raw.split(/\r?\n/);
	const users = loadJsonSafe(args.users);
	const enemies = loadJsonSafe(args.enemies);
	let payload;
	switch (args.mode) {
		case 'analysis':
			payload = endpoint_analysis(lines, enemies, args.idle);
			break;
		case 'scene-data':
			payload = endpoint_scene_data(lines, users, enemies, args.idle);
			break;
		case 'section-data':
			payload = endpoint_section_data(lines, users, enemies, args.idle, Number(args.section||0));
			break;
		case 'npc':
			payload = endpoint_npc(lines, users, enemies, args.idle, Number(args.enemyUid), Number.isFinite(args.section)?Number(args.section):undefined);
			break;
		case 'tanking':
			payload = endpoint_tanking(lines, users, enemies, args.idle, Number(args.uid), undefined);
			break;
		case 'skill':
			payload = endpoint_skill(lines, users, args.idle, Number(args.uid), Number.isFinite(args.section)?Number(args.section):undefined);
			break;
		case 'report':
		default: {
			const base = analyze(lines, { idle: args.idle });
			const report = resolveNames(base, users, enemies);
			payload = report;
			break;
		}
	}
	const out = args.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
	console.log(out);
}

if (require.main === module) {
	main();
}


