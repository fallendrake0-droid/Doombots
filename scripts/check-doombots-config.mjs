import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import settings from '../settings.js';
import { validateDoomBotsModel } from '../src/mindcraft/model_policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const expectedRoles = ['scout', 'miner', 'builder', 'farmer', 'guard'];
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
check(settings.allow_insecure_coding === false, 'DoomBots must not permit arbitrary model-generated JavaScript.');
check(settings.blocked_actions.includes('!newAction'), 'Low-RAM mode must block !newAction.');
check(settings.survival?.clutch?.enabled === true, 'Safety clutching must be enabled.');
check(settings.bodyguard?.enabled === true, 'Bodyguard mode must be enabled.');
check(settings.reconnect?.enabled === true, 'Bounded per-bot reconnect must be enabled.');
check(Number.isInteger(settings.fleet?.max_retries) && settings.fleet.max_retries >= 0 && settings.fleet.max_retries <= 8, 'Fleet max_retries must be bounded from 0 to 8.');
check(Number.isInteger(settings.fleet?.max_tasks) && settings.fleet.max_tasks >= 1 && settings.fleet.max_tasks <= 512, 'Fleet task retention must be bounded.');
check(settings.fleet?.task_priorities?.defend > settings.fleet?.task_priorities?.gather, 'Urgent defend tasks must outrank gather tasks.');
check(settings.metrics?.enabled === true && Number.isInteger(settings.metrics?.max_samples) && settings.metrics.max_samples >= 1 && settings.metrics.max_samples <= 1000, 'Runtime metrics must be enabled with bounded retention.');

const names = new Set();
for (const [profileIndex, profilePath] of (settings.profiles || []).entries()) {
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
    check(profile.role === expectedRoles[profileIndex], `${profilePath} must have the expected DoomBots role.`);
    const modelCheck = validateDoomBotsModel(profile);
    check(modelCheck.ok, `${profilePath}: ${modelCheck.error}`);
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
