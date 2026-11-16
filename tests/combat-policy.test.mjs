import test from 'node:test';
import assert from 'node:assert/strict';
import { attackDelayMs, chooseCombatOperation, chooseMeleeWeapon } from '../src/agent/combat/combat_policy.js';

const ranged = { enabled: true, min_range: 7, max_range: 22 };

test('combat policy chooses the strongest available legal melee weapon and cooldown', () => {
    assert.equal(chooseMeleeWeapon([{ name: 'wooden_sword' }, { name: 'diamond_sword' }, { name: 'apple' }]).name, 'diamond_sword');
    assert.equal(chooseMeleeWeapon([{ name: 'apple' }]), null);
    assert.ok(attackDelayMs({ name: 'diamond_sword' }) >= 625);
    assert.ok(attackDelayMs({ name: 'iron_axe' }) > attackDelayMs({ name: 'diamond_sword' }));
});

test('combat policy prioritises idle, retreat, melee, ranged, and follow safely', () => {
    const base = { health: 20, retreatHealth: 6, targetDistance: 10, attackRange: 3.05, hasBow: true, ranged };
    assert.equal(chooseCombatOperation({ ...base, hasTarget: false }), 'idle');
    assert.equal(chooseCombatOperation({ ...base, hasTarget: true, health: 6 }), 'retreat');
    assert.equal(chooseCombatOperation({ ...base, hasTarget: true, targetDistance: 3 }), 'melee');
    assert.equal(chooseCombatOperation({ ...base, hasTarget: true }), 'ranged');
    assert.equal(chooseCombatOperation({ ...base, hasTarget: true, hasBow: false }), 'follow');
    assert.equal(chooseCombatOperation({ ...base, hasTarget: true, targetDistance: 30 }), 'follow');
});
