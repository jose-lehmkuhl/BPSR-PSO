/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function parseArgs() {
	const args = process.argv.slice(2);
	const out = { idle: 5000 };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--file' || a === '-f') out.file = args[++i];
		else if (a === '--users') out.users = args[++i];
		else if (a === '--enemies') out.enemies = args[++i];
		else if (a === '--idle') out.idle = Number(args[++i]) || 5000;
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

function main() {
	const args = parseArgs();
	if (args.help || !args.file) {
		console.log('Usage: node src/tools/analyze-ndjson.js --file <path.ndjson> [--users <allUserData.json>] [--enemies <enemies.json>] [--idle 5000] [--pretty]');
		process.exit(args.file ? 0 : 1);
	}
	const filePath = path.resolve(args.file);
	const raw = fs.readFileSync(filePath, 'utf8');
	const lines = raw.split(/\r?\n/);
	const base = analyze(lines, { idle: args.idle });
	const users = loadJsonSafe(args.users);
	const enemies = loadJsonSafe(args.enemies);
	const report = resolveNames(base, users, enemies);
	const out = args.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
	console.log(out);
}

if (require.main === module) {
	main();
}


