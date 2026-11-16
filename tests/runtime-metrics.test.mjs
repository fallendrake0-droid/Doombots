import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeMetrics } from '../src/mindcraft/runtime_metrics.js';

test('runtime metrics sample on demand at a bounded interval and cap retained memory', () => {
    let now = 1_000;
    let resourceCalls = 0;
    const metrics = new RuntimeMetrics({
        now: () => now,
        sample_interval_ms: 1000,
        max_samples: 2,
        resourceProvider: () => ({ rssMiB: ++resourceCalls })
    });
    const sources = { bots: { registered: 5 }, tasks: { retainedTasks: 1 }, aiQueue: { queueLength: 0 }, pathfinding: [], reconnection: {} };
    metrics.collect(sources);
    metrics.collect(sources);
    assert.equal(resourceCalls, 1);
    now += 1000;
    metrics.collect(sources);
    now += 1000;
    const snapshot = metrics.collect(sources);
    assert.equal(resourceCalls, 3);
    assert.equal(snapshot.samples.length, 2);
    assert.equal(snapshot.latest.resource.rssMiB, 3);
});

test('runtime metrics honour disabled categories without a background sampler', () => {
    const metrics = new RuntimeMetrics({ enabled: true, resource: false, task: false, pathfinding: false, max_samples: 1 });
    const snapshot = metrics.collect({ bots: { registered: 5 }, tasks: { retainedTasks: 9 }, pathfinding: [{ name: 'DoomGuard' }] }, true);
    assert.equal('resource' in snapshot.latest, false);
    assert.equal('tasks' in snapshot.latest, false);
    assert.equal('pathfinding' in snapshot.latest, false);
    assert.deepEqual(snapshot.latest.bots, { registered: 5 });
});
