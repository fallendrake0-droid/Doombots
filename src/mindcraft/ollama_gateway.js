import { REQUIRED_OLLAMA_MODEL } from './model_policy.js';

const ALLOWED_ENDPOINTS = new Set(['/api/chat', '/api/embeddings']);

function errorWithCode(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/**
 * A parent-process queue shared by all DoomBot workers. It keeps one Ollama
 * model warm and prevents five agents from creating an unbounded inference
 * backlog on a small machine.
 */
export class OllamaGateway {
    constructor(options = {}) {
        this.fetchImpl = options.fetchImpl || fetch;
        this.schedule = options.setTimeout || setTimeout;
        this.cancelSchedule = options.clearTimeout || clearTimeout;
        this.baseUrl = (options.baseUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
        this.concurrency = Math.max(1, Number(options.concurrency || process.env.DOOMBOTS_OLLAMA_CONCURRENCY || 1));
        this.maxQueue = Math.max(this.concurrency, Number(options.maxQueue || process.env.DOOMBOTS_OLLAMA_MAX_QUEUE || 12));
        this.defaultTimeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.DOOMBOTS_OLLAMA_TIMEOUT_MS || 45000));
        this.queue = [];
        this.running = 0;
        this.inFlight = new Map();
        this.nextInFlightId = 1;
        this.pendingRequests = new Map();
        this.metrics = {
            completed: 0,
            failed: 0,
            rejected: 0,
            deduplicated: 0,
            totalWaitMs: 0,
            totalRunMs: 0
        };
    }

    snapshot() {
        const completed = Math.max(1, this.metrics.completed);
        return {
            queueLength: this.queue.length,
            running: this.running,
            completed: this.metrics.completed,
            failed: this.metrics.failed,
            rejected: this.metrics.rejected,
            deduplicated: this.metrics.deduplicated,
            averageWaitMs: Math.round(this.metrics.totalWaitMs / completed),
            averageRunMs: Math.round(this.metrics.totalRunMs / completed)
        };
    }

    validate(request) {
        if (!request || typeof request !== 'object') throw errorWithCode('Invalid Ollama request.', 'OLLAMA_BAD_REQUEST');
        if (!ALLOWED_ENDPOINTS.has(request.endpoint)) throw errorWithCode('Ollama endpoint is not allowed.', 'OLLAMA_BAD_ENDPOINT');
        if (!request.agentName || typeof request.agentName !== 'string') throw errorWithCode('Agent name is required.', 'OLLAMA_BAD_AGENT');
        if (!request.body || typeof request.body !== 'object') throw errorWithCode('Ollama request body is required.', 'OLLAMA_BAD_BODY');
        if (request.body.model !== REQUIRED_OLLAMA_MODEL) {
            throw errorWithCode(`Only ${REQUIRED_OLLAMA_MODEL} is allowed by the DoomBots gateway.`, 'OLLAMA_MODEL_REJECTED');
        }
        let serializedBody;
        try {
            serializedBody = JSON.stringify(request.body);
        } catch (error) {
            throw errorWithCode(`Ollama request body must be JSON serializable: ${error.message}`, 'OLLAMA_BAD_BODY');
        }
        if (serializedBody.length > 262144) throw errorWithCode('Ollama prompt exceeds the 256 KB safety limit.', 'OLLAMA_PROMPT_TOO_LARGE');
    }

    requestFingerprint(request) {
        return `${request.agentName}\u0000${request.endpoint}\u0000${JSON.stringify(request.body)}`;
    }

    enqueue(request) {
        try {
            this.validate(request);
        } catch (error) {
            this.metrics.rejected++;
            return Promise.reject(error);
        }
        const fingerprint = this.requestFingerprint(request);
        const pending = this.pendingRequests.get(fingerprint);
        if (pending) {
            this.metrics.deduplicated++;
            return pending.promise;
        }
        if (this.queue.length + this.running >= this.maxQueue) {
            this.metrics.rejected++;
            return Promise.reject(errorWithCode('Ollama request queue is full; retry later.', 'OLLAMA_QUEUE_FULL'));
        }

        const priority = Number.isFinite(request.priority) ? request.priority : 0;
        let resolveRequest;
        let rejectRequest;
        const promise = new Promise((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        this.pendingRequests.set(fingerprint, { promise });
        this.queue.push({
            request: { ...request, priority },
            resolve: resolveRequest,
            reject: rejectRequest,
            fingerprint,
            queuedAt: Date.now()
        });
        this.queue.sort((a, b) => b.request.priority - a.request.priority || a.queuedAt - b.queuedAt);
        this.drain();
        return promise;
    }

    cancelAgent(agentName) {
        const retained = [];
        for (const item of this.queue) {
            if (item.request.agentName === agentName) {
                this.metrics.rejected++;
                this.pendingRequests.delete(item.fingerprint);
                item.reject(errorWithCode('Ollama request cancelled because the bot disconnected.', 'OLLAMA_CANCELLED'));
            } else {
                retained.push(item);
            }
        }
        this.queue = retained;
        for (const item of this.inFlight.values()) {
            if (item.request.agentName === agentName) {
                item.cancelled = true;
                item.controller.abort();
            }
        }
    }

    drain() {
        while (this.running < this.concurrency && this.queue.length > 0) {
            const item = this.queue.shift();
            this.running++;
            this.run(item)
                .then(item.resolve, item.reject)
                .finally(() => {
                    this.pendingRequests.delete(item.fingerprint);
                    this.running--;
                    this.drain();
                });
        }
    }

    async run(item) {
        const startedAt = Date.now();
        const { request } = item;
        const controller = new AbortController();
        const timeoutMs = Math.min(120000, Math.max(1000, Number(request.timeoutMs || this.defaultTimeoutMs)));
        const timeout = this.schedule(() => controller.abort(), timeoutMs);
        const key = `${request.agentName}:${this.nextInFlightId++}`;
        const inFlightItem = { request, controller, cancelled: false };
        this.inFlight.set(key, inFlightItem);

        try {
            const url = new URL(request.endpoint, `${this.baseUrl}/`);
            const response = await this.fetchImpl(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(request.body),
                signal: controller.signal
            });
            if (!response.ok) {
                throw errorWithCode(`Ollama returned HTTP ${response.status}.`, 'OLLAMA_HTTP_ERROR');
            }
            const data = await response.json();
            this.metrics.completed++;
            this.metrics.totalWaitMs += startedAt - item.queuedAt;
            this.metrics.totalRunMs += Date.now() - startedAt;
            return data;
        } catch (error) {
            this.metrics.failed++;
            if (inFlightItem.cancelled) {
                throw errorWithCode('Ollama request cancelled because the bot disconnected.', 'OLLAMA_CANCELLED');
            }
            if (error.name === 'AbortError') {
                throw errorWithCode(`Ollama request timed out after ${timeoutMs}ms.`, 'OLLAMA_TIMEOUT');
            }
            throw error;
        } finally {
            this.cancelSchedule(timeout);
            this.inFlight.delete(key);
        }
    }
}
