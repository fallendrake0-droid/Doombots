import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetCoordinator } from '../src/mindcraft/fleet_coordinator.js';

function connection(name, role) {
    const messages = [];
    return {
        messages,
        value: {
            in_game: true,
            socket: { emit: (event, payload) => messages.push({ event, payload }) },
            settings: { profile: { name, role } }
        }
    };
}

function task(coordinator, id) {
    return coordinator.snapshot().tasks.find(entry => entry.id === id);
}

test('fleet queues work by configured priority, assigns ownership, and blocks duplicate objectives', () => {
    let now = 10_000;
    const coordinator = new FleetCoordinator({ now: () => now, retryDelayMs: 0, priorities: { gather: 10, defend: 95 } });
    const guard = connection('DoomGuard', 'guard');
    assert.equal(coordinator.validateTask({ type: 'guard', target: 'Steve', amount: 1, priority: null }).task.priority, 80);
    const gather = coordinator.assign({ type: 'gather', target: 'oak_log', amount: 8 }, {});
    const defend = coordinator.assign({ type: 'defend', target: 'Steve', amount: 1 }, {});
    assert.equal(gather.task.state, 'queued');
    assert.equal(defend.task.state, 'queued');
    assert.equal(coordinator.assign({ type: 'gather', target: 'oak_log', amount: 8 }, {}).ok, false);

    const connections = { DoomGuard: guard.value };
    coordinator.pump(connections);
    assert.equal(task(coordinator, defend.task.id).assignedTo, 'DoomGuard');
    assert.equal(task(coordinator, gather.task.id).state, 'queued');
    assert.equal(guard.messages[0].payload.id, defend.task.id);

    assert.equal(coordinator.report('DoomGuard', defend.task.id, 'active', 'starting', {}, connections).ok, true);
    assert.equal(coordinator.report('DoomScout', defend.task.id, 'completed', 'not owner', {}, connections).ok, false);
    assert.equal(coordinator.report('DoomGuard', defend.task.id, 'completed', 'safe', {}, connections).ok, true);
    assert.equal(task(coordinator, gather.task.id).state, 'queued');
});

test('fleet never allocates a role-specific task to an unrelated available bot', () => {
    const coordinator = new FleetCoordinator();
    const builder = connection('DoomBuilder', 'builder');
    const connections = { DoomBuilder: builder.value };
    const queued = coordinator.assign({ type: 'guard', target: 'Alex', amount: 1 }, connections);
    assert.equal(queued.task.state, 'queued');
    assert.equal(builder.messages.length, 0);
});

test('fleet retries interrupted work with bounded attempts and clears ownership on disconnect', () => {
    let now = 20_000;
    const coordinator = new FleetCoordinator({ now: () => now, maxRetries: 1, retryDelayMs: 0 });
    const guard = connection('DoomGuard', 'guard');
    const scout = connection('DoomScout', 'scout');
    const connections = { DoomGuard: guard.value, DoomScout: scout.value };
    const assigned = coordinator.assign({ type: 'guard', target: 'Steve', amount: 1 }, connections);
    assert.equal(assigned.task.assignedTo, 'DoomGuard');
    assert.equal(coordinator.report('DoomGuard', assigned.task.id, 'active', 'guarding', {}, connections).ok, true);

    guard.value.in_game = false;
    coordinator.markAgentUnavailable('DoomGuard', 'network loss', connections);
    const recovered = task(coordinator, assigned.task.id);
    assert.equal(recovered.state, 'assigned');
    assert.equal(recovered.assignedTo, 'DoomScout');
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.retriesRemaining, 0);

    assert.equal(coordinator.report('DoomScout', recovered.id, 'failed', 'second network loss', { retryable: true }, connections).ok, true);
    assert.equal(task(coordinator, recovered.id).state, 'failed');
    assert.equal(coordinator.snapshot().metrics.retried, 1);
});

test('fleet timeouts interrupt then fail after the configured retry limit', () => {
    let now = 30_000;
    const coordinator = new FleetCoordinator({ now: () => now, taskTimeoutMs: 1000, retryDelayMs: 0, maxRetries: 1 });
    const miner = connection('DoomMiner', 'miner');
    const connections = { DoomMiner: miner.value };
    const assigned = coordinator.assign({ type: 'gather', target: 'stone', amount: 4 }, connections);
    coordinator.report('DoomMiner', assigned.task.id, 'active', 'mining', {}, connections);

    now += 1001;
    coordinator.prune(connections);
    const secondAttempt = task(coordinator, assigned.task.id);
    assert.equal(secondAttempt.state, 'assigned');
    assert.equal(secondAttempt.attempts, 2);
    coordinator.report('DoomMiner', assigned.task.id, 'active', 'retrying', {}, connections);

    now += 1001;
    coordinator.prune(connections);
    const failed = task(coordinator, assigned.task.id);
    assert.equal(failed.state, 'expired');
    assert.equal(failed.failureHistory.length, 2);
    assert.equal(coordinator.snapshot().metrics.expired, 2);
    assert.ok(miner.messages.some(message => message.event === 'fleet-task-cancel'));
});

test('fleet uses one bounded retry timer to recover delayed work without polling', () => {
    let now = 35_000;
    const timers = [];
    const coordinator = new FleetCoordinator({
        now: () => now,
        retryDelayMs: 2000,
        maxRetries: 1,
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: timer => { if (timer) timer.cancelled = true; }
    });
    const guard = connection('DoomGuard', 'guard');
    const connections = { DoomGuard: guard.value };
    const assigned = coordinator.assign({ type: 'guard', target: 'Alex', amount: 1 }, connections);
    coordinator.report('DoomGuard', assigned.task.id, 'failed', 'temporary path failure', { retryable: true }, connections);
    assert.equal(task(coordinator, assigned.task.id).state, 'queued');
    const retryTimer = timers.find(timer => !timer.cancelled);
    assert.equal(timers.filter(timer => !timer.cancelled).length, 1);
    assert.equal(retryTimer.delay, 2000);
    now += 2000;
    retryTimer.callback();
    assert.equal(task(coordinator, assigned.task.id).state, 'assigned');
    assert.equal(task(coordinator, assigned.task.id).attempts, 2);
});

test('fleet schedules task expiry without relying on an unrelated status event', () => {
    let now = 38_000;
    const timers = [];
    const coordinator = new FleetCoordinator({
        now: () => now,
        taskTimeoutMs: 1000,
        maxRetries: 0,
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: timer => { if (timer) timer.cancelled = true; }
    });
    const miner = connection('DoomMiner', 'miner');
    const connections = { DoomMiner: miner.value };
    const assigned = coordinator.assign({ type: 'gather', target: 'stone', amount: 1 }, connections);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 1000);
    now += 1000;
    timers[0].callback();
    assert.equal(task(coordinator, assigned.task.id).state, 'expired');
    assert.equal(coordinator.snapshot().metrics.expired, 1);
});

test('fleet cancellation is terminal, signals its owner, and is counted once', () => {
    const coordinator = new FleetCoordinator();
    const guard = connection('DoomGuard', 'guard');
    const connections = { DoomGuard: guard.value };
    const assigned = coordinator.assign({ type: 'guard', target: 'Alex', amount: 1 }, connections);
    assert.equal(coordinator.cancel(assigned.task.id, 'operator stopped guard', connections), true);
    assert.equal(task(coordinator, assigned.task.id).state, 'cancelled');
    assert.equal(coordinator.snapshot().metrics.cancelled, 1);
    assert.ok(guard.messages.some(message => message.event === 'fleet-task-cancel'));
    assert.equal(coordinator.cancel(assigned.task.id, 'second cancel', connections), false);
    assert.equal(coordinator.snapshot().metrics.cancelled, 1);
});

test('fleet keeps only newer validated observations and routes resource notes to relevant roles', () => {
    let now = 40_000;
    const coordinator = new FleetCoordinator({ now: () => now, maxObservations: 2 });
    const miner = connection('DoomMiner', 'miner');
    const builder = connection('DoomBuilder', 'builder');
    const guard = connection('DoomGuard', 'guard');
    const connections = { DoomMiner: miner.value, DoomBuilder: builder.value, DoomGuard: guard.value };

    const first = coordinator.publishObservation('DoomScout', {
        topic: 'resource', key: 'diamond_ore', detail: 'vein near ravine', timestamp: now - 1, position: { x: 1, y: 12, z: 3 }
    }, connections);
    assert.equal(first.ok, true);
    assert.deepEqual(coordinator.observationRecipients(first.observation, connections).sort(), ['DoomBuilder', 'DoomMiner']);

    const stale = coordinator.publishObservation('DoomScout', {
        topic: 'resource', key: 'diamond_ore', detail: 'old position', timestamp: now - 2
    }, connections);
    assert.equal(stale.ok, false);
    now += 1;
    const newer = coordinator.publishObservation('DoomScout', {
        topic: 'resource', key: 'diamond_ore', detail: 'confirmed deeper vein', timestamp: now
    }, connections);
    assert.equal(newer.ok, true);
    const observation = coordinator.snapshot().observations[0];
    assert.equal(observation.detail, 'confirmed deeper vein');
    assert.equal(coordinator.snapshot().metrics.staleObservations, 1);
});
