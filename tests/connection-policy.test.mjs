import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConnectionSettings } from '../src/mindcraft/connection_policy.js';

test('connection policy accepts bounded offline and Microsoft settings', () => {
    assert.equal(validateConnectionSettings({ host: '127.0.0.1', port: 25565, auth: 'offline', minecraft_version: 'auto' }).ok, true);
    assert.equal(validateConnectionSettings({ host: 'mc.example.test', port: -1, auth: 'microsoft', minecraft_version: '1.21.4' }).ok, true);
});

test('connection policy rejects malformed endpoint and authentication values before spawning a worker', () => {
    assert.equal(validateConnectionSettings({ host: 'bad host', port: 25565, auth: 'offline' }).ok, false);
    assert.equal(validateConnectionSettings({ host: '127.0.0.1', port: 70000, auth: 'offline' }).ok, false);
    assert.equal(validateConnectionSettings({ host: '127.0.0.1', port: 25565, auth: 'token' }).ok, false);
});
