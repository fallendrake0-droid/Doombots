import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlToken, validControlToken } from '../src/mindcraft/control_auth.js';

test('worker control tokens are unique and only exact credentials authenticate', () => {
    const first = createControlToken();
    const second = createControlToken();
    assert.match(first, /^[a-f0-9]{48}$/);
    assert.notEqual(first, second);
    assert.equal(validControlToken(first, first), true);
    assert.equal(validControlToken(first, second), false);
    assert.equal(validControlToken(first, `${first}x`), false);
    assert.equal(validControlToken(first, null), false);
});
