import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AgentProcess, AgentProcessState } from '../src/process/agent_process.js';

class FakeChild extends EventEmitter {
    constructor() {
        super();
        this.killed = false;
        this.killSignals = [];
    }

    kill(signal) {
        this.killed = true;
        this.killSignals.push(signal);
        this.emit('exit', null, signal);
        return true;
    }
}

function lifecycleHarness(reconnect = {}) {
    const children = [];
    const timers = [];
    const states = [];
    const loggedOut = [];
    const process = new AgentProcess('DoomScout', 8080, {
        base_delay_ms: 1,
        max_delay_ms: 1000,
        stable_reset_ms: 1000,
        ...reconnect
    }, (state, attempt) => states.push({ state, attempt }), {
        spawnFactory: () => {
            const child = new FakeChild();
            children.push(child);
            return child;
        },
        logoutAgent: name => loggedOut.push(name),
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: timer => {
            if (timer) timer.cancelled = true;
        },
        logger: { log() {}, warn() {}, error() {} }
    });
    const flushTimers = () => {
        for (const timer of timers.splice(0)) if (!timer.cancelled) timer.callback();
    };
    return { process, children, timers, states, loggedOut, flushTimers };
}

test('agent lifecycle starts one child and a clean exit remains stopped', () => {
    const harness = lifecycleHarness();
    harness.process.start(false, 'hello', 2);
    harness.process.start(false, 'ignored duplicate', 2);
    assert.equal(harness.children.length, 1);
    harness.children[0].emit('spawn');
    assert.equal(harness.process.state, AgentProcessState.CONNECTED);

    harness.children[0].emit('exit', 0, null);
    assert.equal(harness.process.state, AgentProcessState.STOPPED);
    assert.deepEqual(harness.loggedOut, ['DoomScout']);
    assert.equal(harness.timers.length, 0);
});

test('agent lifecycle reconnects only the failed bot and caps short-lived retries', () => {
    const harness = lifecycleHarness({ max_attempts: 2 });
    harness.process.start();
    harness.children[0].emit('exit', 1, null);
    assert.equal(harness.process.state, AgentProcessState.RECONNECTING);
    assert.equal(harness.timers[0].delay, 100);
    harness.flushTimers();
    assert.equal(harness.children.length, 2);

    harness.children[1].emit('exit', 1, null);
    assert.equal(harness.process.state, AgentProcessState.RECONNECTING);
    assert.equal(harness.timers[0].delay, 200);
    harness.flushTimers();
    assert.equal(harness.children.length, 3);

    harness.children[2].emit('exit', 1, null);
    assert.equal(harness.process.state, AgentProcessState.FAILED);
    assert.equal(harness.children.length, 3);
});

test('agent lifecycle treats a child-process spawn error as a bounded per-bot failure', () => {
    const harness = lifecycleHarness();
    harness.process.start();
    harness.children[0].emit('error', new Error('spawn failed'));
    assert.equal(harness.process.state, AgentProcessState.RECONNECTING);
    harness.flushTimers();
    assert.equal(harness.children.length, 2);
});

test('agent lifecycle cancellation and forced restart do not leave a reconnect timer running', () => {
    const stopped = lifecycleHarness();
    stopped.process.start();
    stopped.children[0].emit('exit', 1, null);
    assert.equal(stopped.process.state, AgentProcessState.RECONNECTING);
    stopped.process.stop();
    stopped.flushTimers();
    assert.equal(stopped.process.state, AgentProcessState.STOPPED);
    assert.equal(stopped.children.length, 1);

    const restarted = lifecycleHarness();
    restarted.process.start();
    restarted.process.forceRestart();
    assert.equal(restarted.children[0].killSignals[0], 'SIGINT');
    assert.equal(restarted.children.length, 2);
    assert.equal(restarted.process.state, AgentProcessState.CONNECTING);
});

test('agent lifecycle does not retry a task-configuration exit and resets after stable runtime', () => {
    const harness = lifecycleHarness();
    harness.process.start();
    harness.children[0].emit('exit', 4, null);
    assert.equal(harness.process.state, AgentProcessState.FAILED);

    harness.process.reconnectAttempts = 5;
    harness.process.running = true;
    harness.process.process = new FakeChild();
    harness.process.handleExit(1, null, Date.now() - 2000);
    assert.equal(harness.process.reconnectAttempts, 1);
    assert.equal(harness.process.state, AgentProcessState.RECONNECTING);
});
