import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .help()
        .alias('help', 'h')
        .parse();
}

function parseJsonEnv(name, fallback) {
    if (!process.env[name]) return fallback;
    try {
        return JSON.parse(process.env[name]);
    } catch (error) {
        throw new Error(`Invalid JSON in ${name}: ${error.message}`);
    }
}

function parseIntegerEnv(name, fallback, min = 0) {
    if (process.env[name] === undefined || process.env[name] === '') return fallback;
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < min) {
        throw new Error(`${name} must be an integer >= ${min}`);
    }
    return value;
}

function parseBooleanEnv(name, fallback) {
    if (process.env[name] === undefined) return fallback;
    const value = process.env[name].trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'off'].includes(value)) return false;
    throw new Error(`${name} must be true/false, 1/0, yes/no, or on/off`);
}

function validateSettings(config) {
    if (!Array.isArray(config.profiles) || config.profiles.length === 0 ||
        config.profiles.some(profile => typeof profile !== 'string' || !profile.trim())) {
        throw new Error('settings.profiles must be a non-empty array of profile file paths');
    }
    for (const key of ['port', 'mindserver_port']) {
        const value = Number(config[key]);
        if (!Number.isInteger(value) || (key === 'port' ? value < -1 || value > 65535 : value < 1 || value > 65535)) {
            throw new Error(`settings.${key} must be a valid TCP port${key === 'port' ? ' or -1' : ''}`);
        }
        config[key] = value;
    }
    for (const key of ['max_messages', 'num_examples', 'spawn_timeout', 'relevant_docs_count']) {
        if (config[key] !== undefined && (!Number.isInteger(Number(config[key])) ||
            (key !== 'relevant_docs_count' && Number(config[key]) < 0))) {
            throw new Error(`settings.${key} must be an integer`);
        }
        if (config[key] !== undefined) config[key] = Number(config[key]);
    }
    if (config.blocked_actions !== undefined && !Array.isArray(config.blocked_actions)) {
        throw new Error('settings.blocked_actions must be an array of strings');
    }
    if (Array.isArray(config.blocked_actions) &&
        config.blocked_actions.some(action => typeof action !== 'string')) {
        throw new Error('settings.blocked_actions must contain only strings');
    }
    if (typeof config.allow_insecure_coding !== 'boolean') {
        throw new Error('settings.allow_insecure_coding must be a boolean');
    }
}

const args = parseArguments();
if (args.profiles) {
    settings.profiles = args.profiles;
}
if (args.task_path) {
    const tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
    if (!args.task_id) {
        throw new Error('task_id is required when task_path is provided');
    }
    if (!tasks || typeof tasks !== 'object' || !Object.hasOwn(tasks, args.task_id)) {
        throw new Error(`Task "${args.task_id}" was not found in ${args.task_path}`);
    }
    settings.task = { ...tasks[args.task_id], task_id: args.task_id };
}

// Environment variables override selected settings.
if (process.env.MINECRAFT_PORT !== undefined) {
    settings.port = parseIntegerEnv('MINECRAFT_PORT', settings.port, -1);
}
if (process.env.MINDSERVER_PORT !== undefined) {
    settings.mindserver_port = parseIntegerEnv('MINDSERVER_PORT', settings.mindserver_port, 1);
}
if (process.env.PROFILES !== undefined) {
    const profiles = parseJsonEnv('PROFILES', settings.profiles);
    if (!Array.isArray(profiles)) throw new Error('PROFILES must be a JSON array of profile paths');
    if (profiles.length) settings.profiles = profiles;
}
if (process.env.INSECURE_CODING !== undefined) {
    settings.allow_insecure_coding = parseBooleanEnv('INSECURE_CODING', settings.allow_insecure_coding);
}
if (process.env.BLOCKED_ACTIONS !== undefined) {
    settings.blocked_actions = parseJsonEnv('BLOCKED_ACTIONS', settings.blocked_actions);
}
if (process.env.MAX_MESSAGES !== undefined) {
    settings.max_messages = parseIntegerEnv('MAX_MESSAGES', settings.max_messages, 0);
}
if (process.env.NUM_EXAMPLES !== undefined) {
    settings.num_examples = parseIntegerEnv('NUM_EXAMPLES', settings.num_examples, 0);
}
if (process.env.LOG_ALL !== undefined) {
    settings.log_all_prompts = parseBooleanEnv('LOG_ALL', settings.log_all_prompts);
}
if (process.env.SETTINGS_JSON !== undefined) {
    const overrides = parseJsonEnv('SETTINGS_JSON', {});
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        throw new Error('SETTINGS_JSON must contain a JSON object');
    }
    Object.assign(settings, overrides);
}

validateSettings(settings);

Mindcraft.init(false, settings.mindserver_port, settings.auto_open_ui);

for (const profile of settings.profiles) {
    let profile_json;
    try {
        profile_json = JSON.parse(readFileSync(profile, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to load profile "${profile}": ${error.message}`);
    }
    settings.profile = profile_json;
    Mindcraft.createAgent(settings);
}
