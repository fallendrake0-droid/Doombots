import test from 'node:test';
import assert from 'node:assert/strict';
import { entityIsUsable, isEligibleTarget, isExcludedPlayer } from '../src/agent/combat/target_policy.js';

const position = { x: 1, y: 64, z: 1 };

test('combat target policy excludes self/team players and malformed positions', () => {
    const teammate = { type: 'player', username: 'DoomGuard', position };
    const stranger = { type: 'player', username: 'Raider', position };
    assert.equal(isExcludedPlayer(teammate, ['DoomScout'], ['DoomGuard']), true);
    assert.equal(isExcludedPlayer(stranger, ['DoomScout'], ['DoomGuard']), false);
    assert.equal(isEligibleTarget(teammate, { allowPlayers: true, excludedPlayer: true }), false);
    assert.equal(isEligibleTarget(stranger, { allowPlayers: false, excludedPlayer: false }), false);
    assert.equal(isEligibleTarget(stranger, { allowPlayers: true, excludedPlayer: false }), true);
    assert.equal(entityIsUsable({ type: 'mob', position: { x: Number.NaN, y: 0, z: 0 } }), false);
});

test('combat target policy only accepts non-player entities flagged hostile', () => {
    const zombie = { type: 'mob', name: 'zombie', position };
    assert.equal(isEligibleTarget(zombie, { hostile: true }), true);
    assert.equal(isEligibleTarget(zombie, { hostile: false }), false);
});
