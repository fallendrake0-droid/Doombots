import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRequiredDigest, validateDoomBotsModel, validateDoomBotsSettings, verifyRequiredOllamaModel } from '../src/mindcraft/model_policy.js';

test('model policy permits only the required local Ollama profile', () => {
    const profile = {
        model: { api: 'ollama', model: 'qwen2.5:0.5b' },
        model_digest: 'a8b0c5157701'
    };
    assert.equal(validateDoomBotsModel(profile).ok, true);
    assert.equal(validateDoomBotsModel({ ...profile, model: { api: 'ollama', model: 'qwen2.5:1.5b' } }).ok, false);
    assert.equal(validateDoomBotsModel({ ...profile, model_digest: 'wrong' }).ok, false);
    assert.equal(hasRequiredDigest('sha256:a8b0c5157701abcdef'), true);
    assert.equal(hasRequiredDigest('deadbeef'), false);
    const safeSettings = { profile, allow_insecure_coding: false, blocked_actions: ['!newAction'] };
    assert.equal(validateDoomBotsSettings(safeSettings).ok, true);
    assert.equal(validateDoomBotsSettings({ ...safeSettings, allow_insecure_coding: true }).ok, false);
    assert.equal(validateDoomBotsSettings({ ...safeSettings, blocked_actions: [] }).ok, false);
});

test('Ollama startup verification requires the exact installed digest', async () => {
    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ models: [{ name: 'qwen2.5:0.5b', digest: 'sha256:a8b0c5157701example' }] })
    });
    assert.equal((await verifyRequiredOllamaModel({ fetchImpl })).ok, true);
    const wrongDigest = await verifyRequiredOllamaModel({
        fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen2.5:0.5b', digest: 'sha256:wrong' }] }) })
    });
    assert.equal(wrongDigest.ok, false);
});
