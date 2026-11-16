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

test('fleet assigns guard work to the guard bot and prevents duplicates', () => {
    const guard = connection('DoomGuard', 'guard');
    const miner = connection('DoomMiner', 'miner');
    const coordinator = new FleetCoordinator();
    coordinator.updateStatus('DoomGuard', { inGame: true, action: '' });
    coordinator.updateStatus('DoomMiner', { inGame: true, action: '' });
    const connections = { DoomGuard: guard.value, DoomMiner: miner.value };

    const result = coordinator.assign({ type: 'guard', target: 'Steve', amount: 1, requestedBy: 'Tester' }, connections);
    assert.equal(result.ok, true);
    assert.equal(result.task.assignedTo, 'DoomGuard');
    assert.equal(guard.messages.length, 1);
    assert.equal(miner.messages.length, 0);
    assert.equal(coordinator.assign({ type: 'guard', target: 'Steve', amount: 1 }, connections).ok, false);
    assert.equal(coordinator.assign({ type: 'escort', target: 'Alex', amount: 1 }, connections).task.assignedTo, 'DoomMiner');
});

test('fleet frees work assigned to an unavailable bot', () => {
    const guard = connection('DoomGuard', 'guard');
    const miner = connection('DoomMiner', 'miner');
    const coordinator = new FleetCoordinator();
    const connections = { DoomGuard: guard.value, DoomMiner: miner.value };
    const assigned = coordinator.assign({ type: 'guard', target: 'Steve', amount: 1 }, connections);
    assert.equal(assigned.ok, true);
    coordinator.markAgentUnavailable('DoomGuard', 'network loss');
    guard.value.in_game = false;
    assert.equal(coordinator.snapshot().tasks[0].state, 'failed');
    const reassigned = coordinator.assign({ type: 'guard', target: 'Steve', amount: 1 }, connections);
    assert.equal(reassigned.ok, true);
    assert.equal(reassigned.task.assignedTo, 'DoomMiner');
});

test('fleet preserves task ownership and expires stale work', () => {
    const guard = connection('DoomGuard', 'guard');
    const coordinator = new FleetCoordinator({ taskTimeoutMs: 5 });
    const connections = { DoomGuard: guard.value };
    const assigned = coordinator.assign({ type: 'guard', target: 'Steve', amount: 1 }, connections);
    assert.equal(coordinator.complete('DoomScout', assigned.task.id, true), false);
    assert.equal(coordinator.complete('DoomGuard', assigned.task.id, true, 'relieved'), true);

    const stale = coordinator.assign({ type: 'escort', target: 'Alex', amount: 1 }, connections);
    stale.task.createdAt = Date.now() - 10;
    assert.equal(coordinator.snapshot().tasks.find(task => task.id === stale.task.id).state, 'expired');
});

test('fleet validates task parameters and selects an idle specialist', () => {
    const miner = connection('DoomMiner', 'miner');
    const farmer = connection('DoomFarmer', 'farmer');
    const coordinator = new FleetCoordinator();
    coordinator.updateStatus('DoomMiner', { inGame: true, action: 'bodyguard' });
    coordinator.updateStatus('DoomFarmer', { inGame: true, action: '' });
    const connections = { DoomMiner: miner.value, DoomFarmer: farmer.value };

    assert.equal(coordinator.assign({ type: 'gather', target: 'stone', amount: 0 }, connections).ok, false);
    const result = coordinator.assign({ type: 'gather', target: 'oak_log', amount: 12 }, connections);
    assert.equal(result.ok, true);
    assert.equal(result.task.assignedTo, 'DoomFarmer');
});
