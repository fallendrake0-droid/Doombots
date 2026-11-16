import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReconnectDelay, shouldReconnect } from '../src/process/reconnect_policy.js';

test('reconnect delay backs off and caps', () => {
    assert.equal(nextReconnectDelay(1000, 30000, 1), 1000);
    assert.equal(nextReconnectDelay(1000, 30000, 5), 16000);
    assert.equal(nextReconnectDelay(1000, 30000, 8), 30000);
});

test('only unexpected retryable exits reconnect', () => {
    assert.equal(shouldReconnect({ intentionalStop: true, enabled: true, code: 1, attempt: 1, maxAttempts: 8 }), false);
    assert.equal(shouldReconnect({ intentionalStop: false, enabled: false, code: 1, attempt: 1, maxAttempts: 8 }), false);
    assert.equal(shouldReconnect({ intentionalStop: false, enabled: true, code: 4, attempt: 1, maxAttempts: 8 }), false);
    assert.equal(shouldReconnect({ intentionalStop: false, enabled: true, code: 1, attempt: 8, maxAttempts: 8 }), true);
    assert.equal(shouldReconnect({ intentionalStop: false, enabled: true, code: 1, attempt: 9, maxAttempts: 8 }), false);
});
