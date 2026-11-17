import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTpaRequest } from '../src/agent/commands/player_command_policy.js';

test('TPA requests use one normal plugin command and validate player names', () => {
    assert.deepEqual(buildTpaRequest('Alex_42'), { ok: true, target: 'Alex_42', command: '/tpa Alex_42' });
    assert.equal(buildTpaRequest('ab').ok, false);
    assert.equal(buildTpaRequest('Alex; /op me').ok, false);
    assert.equal(buildTpaRequest('Alex\n/tp @s').ok, false);
});
