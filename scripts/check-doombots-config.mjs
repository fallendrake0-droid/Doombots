import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import settings from '../settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const expectedProfiles = [
    './profiles/doombots/scout.json',
    './profiles/doombots/miner.json',
    './profiles/doombots/builder.json',
    './profiles/doombots/farmer.json',
    './profiles/doombots/guard.json'
];

function check(condition, message) {
    if (!condition) failures.push(message);
}

check(Array.isArray(settings.profiles), 'settings.profiles must be an array.');
check(settings.profiles?.length === 5, 'DoomBots must start exactly five bot profiles.');
check(JSON.stringify(settings.profiles) === JSON.stringify(expectedProfiles), 'The default profiles must be the five DoomBots role profiles.');
check(settings.num_examples === 0, 'Low-RAM mode must disable example embeddings.');
check(settings.command_docs === 'compact', 'Low-RAM mode must use compact command docs.');
check(settings.blocked_actions.includes('!newAction'), 'Low-RAM mode must block !newAction.');

const names = new Set();
for (const profilePath of settings.profiles || []) {
    let profile;
    try {
        profile = JSON.parse(readFileSync(path.resolve(root, profilePath), 'utf8'));
    } catch (error) {
        failures.push(`Cannot read ${profilePath}: ${error.message}`);
        continue;
    }

    check(/^[A-Za-z0-9_]{3,16}$/.test(profile.name || ''), `${profilePath} has an invalid Minecraft bot name.`);
    check(!names.has(profile.name), `${profilePath} reuses the bot name ${profile.name}.`);
    names.add(profile.name);
    check(profile.model?.api === 'ollama', `${profilePath} must use the Ollama API.`);
    check(profile.model?.model === 'qwen2.5:0.5b', `${profilePath} must use qwen2.5:0.5b.`);
    check(profile.model?.params?.options?.num_ctx === 2048, `${profilePath} must cap Ollama context at 2048 tokens.`);
    check(profile.embedding === 'none', `${profilePath} must not load a second embedding model.`);
}

if (failures.length > 0) {
    console.error('DoomBots configuration check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
} else {
    console.log('DoomBots configuration is valid: 5 qwen2.5:0.5b bots, one shared Ollama model, embeddings disabled.');
}
