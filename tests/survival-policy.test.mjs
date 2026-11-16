import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedPotionName, SAFE_SELF_POTION_EFFECTS } from '../src/agent/safety/potions.js';
import { canAttemptClutch, isSolidLandingBlock, shouldHandleSurvivalState } from '../src/agent/safety/survival_policy.js';

test('potion parser supports legacy NBT and modern data components', () => {
    assert.equal(normalizedPotionName({ nbt: { value: { Potion: 'minecraft:fire_resistance' } }, name: 'potion' }), 'fire_resistance');
    assert.equal(normalizedPotionName({ components: { 'minecraft:potion_contents': { potion: 'minecraft:strong_healing' } }, name: 'potion' }), 'healing');
    assert.equal(normalizedPotionName({ components: new Map([['potion_contents', { potion: 'minecraft:slow_falling' }]]), name: 'potion' }), 'slow_falling');
    assert.equal(normalizedPotionName({ name: 'water_bucket' }), null);
    assert.equal(SAFE_SELF_POTION_EFFECTS.has('harming'), false);
    assert.equal(SAFE_SELF_POTION_EFFECTS.has('fire_resistance'), true);
});

test('survival policy only clutches a reachable dangerous fall', () => {
    const eligible = {
        onGround: false,
        verticalVelocity: -0.5,
        cooldownElapsed: true,
        landingDrop: 6,
        minFallBlocks: 4,
        landingDistance: 4.2
    };
    assert.equal(canAttemptClutch(eligible), true);
    assert.equal(canAttemptClutch({ ...eligible, landingDistance: 4.8 }), false);
    assert.equal(canAttemptClutch({ ...eligible, verticalVelocity: -0.1 }), false);
    assert.equal(canAttemptClutch({ ...eligible, landingDrop: 2 }), false);
    assert.equal(isSolidLandingBlock({ name: 'stone' }), true);
    assert.equal(isSolidLandingBlock({ name: 'water' }), false);
    assert.equal(shouldHandleSurvivalState({ inLavaOrFire: false, health: 20, emergencyHealthThreshold: 5, healthPotionThreshold: 9, falling: false }), false);
    assert.equal(shouldHandleSurvivalState({ inLavaOrFire: true, health: 20, emergencyHealthThreshold: 5, healthPotionThreshold: 9, falling: false }), true);
    assert.equal(shouldHandleSurvivalState({ inLavaOrFire: false, health: 20, emergencyHealthThreshold: 5, healthPotionThreshold: 9, falling: false, drowning: true }), true);
});
