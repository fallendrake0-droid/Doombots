import test from 'node:test';
import assert from 'node:assert/strict';
import { finiteVector, leadTarget, planBowShot, withinReach } from '../src/agent/combat/math.js';

test('combat math removes invalid protocol vectors', () => {
    assert.deepEqual(finiteVector({ x: Number.NaN, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
    assert.deepEqual(finiteVector({ x: 1, y: -0.1, z: 0 }), { x: 1, y: -0.1, z: 0 });
});

test('bow planner returns a finite low-arc lead for a reachable moving target', () => {
    const shot = planBowShot({ x: 0, y: 1.6, z: 0 }, { x: 14, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 });
    assert.ok(shot);
    assert.ok(Number.isFinite(shot.yaw));
    assert.ok(Number.isFinite(shot.pitch));
    assert.ok(shot.flightTicks > 0);
    assert.ok(shot.target.x > 14);
});

test('bow planner refuses impossible trajectories and reach is bounded', () => {
    assert.equal(planBowShot({ x: 0, y: 0, z: 0 }, { x: 1, y: 200, z: 0 }), null);
    assert.equal(withinReach({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 3.05), true);
    assert.equal(withinReach({ x: 0, y: 0, z: 0 }, { x: 3.1, y: 0, z: 0 }, 3.05), false);
    assert.deepEqual(leadTarget({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, 1, 1), { x: 1, y: 0, z: 0 });
});
