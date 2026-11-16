import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildPlan, MAX_BLOCKS } from '../src/agent/build/build_plan.js';

const origin = { x: 10.8, y: 64.1, z: -3.2 };

test('bounded builder plans unique blocks and an accessible shelter doorway', () => {
    const shelter = createBuildPlan('shelter', origin, 5);
    const keys = new Set(shelter.map(position => `${position.x}:${position.y}:${position.z}`));
    assert.equal(keys.size, shelter.length);
    assert.ok(shelter.length <= MAX_BLOCKS);
    assert.equal(keys.has('12:65:-4'), false);
    assert.equal(keys.has('12:66:-4'), false);
});

test('builder clamps plans and rejects unsupported structures', () => {
    assert.equal(createBuildPlan('platform', origin, 99).length, 81);
    assert.equal(createBuildPlan('tower', origin, 1).length, 3);
    assert.throws(() => createBuildPlan('castle', origin, 5), /Unsupported structure/);
});
