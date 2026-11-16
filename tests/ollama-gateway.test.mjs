import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaGateway } from '../src/mindcraft/ollama_gateway.js';

function response(payload) {
    return { ok: true, json: async () => payload };
}

test('Ollama gateway serialises queued requests and records metrics', async () => {
    let active = 0;
    let peak = 0;
    const gateway = new OllamaGateway({
        concurrency: 1,
        maxQueue: 3,
        fetchImpl: async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 15));
            active--;
            return response({ message: { content: 'ok' } });
        }
    });
    const request = agentName => ({ agentName, endpoint: '/api/chat', body: { model: 'qwen2.5:0.5b', messages: [] } });
    const replies = await Promise.all([gateway.enqueue(request('DoomScout')), gateway.enqueue(request('DoomMiner'))]);
    assert.equal(replies.length, 2);
    assert.equal(peak, 1);
    assert.equal(gateway.snapshot().completed, 2);
    assert.equal(gateway.snapshot().queuePeak, 2);
    assert.equal(gateway.snapshot().runningPeak, 1);
});

test('Ollama gateway runs queued high-priority work before lower-priority work', async () => {
    const started = [];
    const releases = [];
    const gateway = new OllamaGateway({
        concurrency: 1,
        maxQueue: 4,
        fetchImpl: async (_, options) => new Promise(resolve => {
            started.push(JSON.parse(options.body).messages[0].content);
            releases.push(() => resolve(response({ message: { content: 'ok' } })));
        })
    });
    const request = (agentName, priority, label) => gateway.enqueue({
        agentName,
        priority,
        endpoint: '/api/chat',
        body: { model: 'qwen2.5:0.5b', messages: [{ role: 'user', content: label }] }
    });
    const first = request('DoomScout', 0, 'running');
    const low = request('DoomMiner', 1, 'low');
    const high = request('DoomGuard', 10, 'high');
    assert.deepEqual(started, ['running']);
    releases.shift()();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(started, ['running', 'high']);
    releases.shift()();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(started, ['running', 'high', 'low']);
    releases.shift()();
    await Promise.all([first, low, high]);
});

test('Ollama gateway single-flights identical agent requests', async () => {
    let calls = 0;
    const gateway = new OllamaGateway({
        fetchImpl: async () => {
            calls++;
            await new Promise(resolve => setTimeout(resolve, 5));
            return response({ message: { content: 'shared' } });
        }
    });
    const request = { agentName: 'DoomScout', endpoint: '/api/chat', body: { model: 'qwen2.5:0.5b', messages: [] } };
    const [first, second] = await Promise.all([gateway.enqueue(request), gateway.enqueue({ ...request, body: { ...request.body } })]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.equal(gateway.snapshot().deduplicated, 1);
});

test('Ollama gateway rejects unsafe endpoints and bounded queue overflow', async () => {
    const gateway = new OllamaGateway({ concurrency: 1, maxQueue: 1, fetchImpl: async () => response({}) });
    await assert.rejects(gateway.enqueue({ agentName: 'DoomScout', endpoint: '/not-ollama', body: {} }), { code: 'OLLAMA_BAD_ENDPOINT' });
    await assert.rejects(
        gateway.enqueue({ agentName: 'DoomScout', endpoint: '/api/chat', body: { model: 'some-other-model' } }),
        { code: 'OLLAMA_MODEL_REJECTED' }
    );
    const held = gateway.enqueue({ agentName: 'DoomScout', endpoint: '/api/chat', body: { model: 'qwen2.5:0.5b' } });
    await assert.rejects(gateway.enqueue({ agentName: 'DoomMiner', endpoint: '/api/chat', body: { model: 'qwen2.5:0.5b' } }), { code: 'OLLAMA_QUEUE_FULL' });
    await held;
});

test('Ollama gateway turns slow and failed responses into bounded failures', async () => {
    const timers = [];
    const slowGateway = new OllamaGateway({
        setTimeout: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        clearTimeout() {},
        fetchImpl: (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        }))
    });
    const slowRequest = slowGateway.enqueue({
        agentName: 'DoomScout',
        endpoint: '/api/chat',
        timeoutMs: 1000,
        body: { model: 'qwen2.5:0.5b' }
    });
    assert.equal(timers[0].delay, 1000);
    timers[0].callback();
    await assert.rejects(slowRequest, { code: 'OLLAMA_TIMEOUT' });
    assert.equal(slowGateway.snapshot().timedOut, 1);

    const failedGateway = new OllamaGateway({ fetchImpl: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(
        failedGateway.enqueue({ agentName: 'DoomScout', endpoint: '/api/chat', body: { model: 'qwen2.5:0.5b' } }),
        { code: 'OLLAMA_HTTP_ERROR' }
    );
});

test('Ollama gateway reports a cancelled in-flight request distinctly', async () => {
    const gateway = new OllamaGateway({
        fetchImpl: (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        }))
    });
    const request = gateway.enqueue({
        agentName: 'DoomScout',
        endpoint: '/api/chat',
        body: { model: 'qwen2.5:0.5b' }
    });
    gateway.cancelAgent('DoomScout');
    await assert.rejects(request, { code: 'OLLAMA_CANCELLED' });
    assert.equal(gateway.snapshot().cancelled, 1);
});
