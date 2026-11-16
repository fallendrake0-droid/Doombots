import os from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const ollamaUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const packageVersions = {};

for (const name of ['mineflayer', 'minecraft-data', 'mineflayer-pathfinder', 'mineflayer-armor-manager', 'mineflayer-collectblock', 'mineflayer-auto-eat', 'socket.io']) {
    try {
        packageVersions[name] = require(`${name}/package.json`).version;
    } catch (error) {
        packageVersions[name] = error.code === 'MODULE_NOT_FOUND' ? 'not installed' : `unreadable: ${error.message}`;
    }
}

const report = {
    project: packageJson.name,
    moduleSystem: packageJson.type,
    node: process.version,
    platform: `${process.platform} ${os.release()} (${process.arch})`,
    cpus: os.cpus().length,
    hostMemoryMiB: {
        total: Math.round(os.totalmem() / 1024 / 1024),
        free: Math.round(os.freemem() / 1024 / 1024)
    },
    processMemoryMiB: Object.fromEntries(Object.entries(process.memoryUsage()).map(([name, bytes]) => [name, Math.round(bytes / 1024 / 1024)])),
    packageManager: process.env.npm_config_user_agent || 'unknown',
    configuredMinecraftVersion: 'auto (runtime server negotiation required)',
    dependencies: packageVersions,
    ollama: { url: ollamaUrl, available: false, version: null, models: [] }
};

try {
    const [versionResponse, tagsResponse] = await Promise.all([
        fetch(`${ollamaUrl}/api/version`),
        fetch(`${ollamaUrl}/api/tags`)
    ]);
    if (!versionResponse.ok || !tagsResponse.ok) {
        report.ollama.error = `HTTP version=${versionResponse.status}, tags=${tagsResponse.status}`;
    } else {
        const version = await versionResponse.json();
        const tags = await tagsResponse.json();
        report.ollama = {
            url: ollamaUrl,
            available: true,
            version: version.version || version,
            models: (tags.models || []).map(model => ({ name: model.name, digest: model.digest, size: model.size }))
        };
    }
} catch (error) {
    report.ollama.error = error.message;
}

console.log(JSON.stringify(report, null, 2));
