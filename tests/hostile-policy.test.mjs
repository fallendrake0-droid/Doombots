import test from 'node:test';
import assert from 'node:assert/strict';
import { isHostileEntity } from '../src/agent/combat/hostile_policy.js';

test('hostile policy is conservative with Mineflayer mob types', () => {
    assert.equal(isHostileEntity({ type: 'mob', name: 'zombie' }), true);
    assert.equal(isHostileEntity({ type: 'mob', name: 'cow' }), false);
    assert.equal(isHostileEntity({ type: 'mob', name: 'villager' }), false);
    assert.equal(isHostileEntity({ type: 'mob', mobType: 'hostile', name: 'unknown_mod_mob' }), true);
    assert.equal(isHostileEntity({ type: 'player', name: 'Raider', mobType: 'hostile' }), false);
});
