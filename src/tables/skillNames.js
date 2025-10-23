import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import skill_names from './skill_names.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultMap = (skill_names && skill_names.skill_names) ? skill_names.skill_names : {};
let englishMap = {};

// Try to load SR Skills.en.resx if present (for English names)
try {
    const repoRoot = path.resolve(__dirname, '../../../..'); // go up to repo root
    const resxPath = path.join(repoRoot, 'StarResonanceDps', 'StarResonanceDpsAnalysis', 'Properties', 'Skills.en.resx');
    if (fs.existsSync(resxPath)) {
        const raw = fs.readFileSync(resxPath, 'utf8');
        const re = /<data name="Skill_(\d+)_Name"[\s\S]*?<value>([^<]+)<\/value>/g;
        let m;
        while ((m = re.exec(raw)) !== null) {
            const id = m[1];
            const name = m[2];
            if (id && name) englishMap[id] = name;
        }
    }
} catch {}

export function getSkillName(id) {
    const key = String(id);
    return englishMap[key] || defaultMap[id] || key;
}


