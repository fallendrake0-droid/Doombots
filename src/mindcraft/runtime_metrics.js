import os from 'node:os';

const DEFAULTS = {
    enabled: true,
    sample_interval_ms: 5000,
    max_samples: 120,
    resource: true,
    bot: true,
    task: true,
    ai_queue: true,
    pathfinding: true,
    reconnection: true
};

function positiveInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

/**
 * Low-overhead parent-process metrics. Sampling occurs on status/query events,
 * never in an additional high-frequency loop, and retained samples are capped.
 */
export class RuntimeMetrics {
    constructor(options = {}) {
        this.now = options.now || (() => Date.now());
        this.resourceProvider = options.resourceProvider || (() => ({
            rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heapUsedMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            loadAverage: os.loadavg().map(value => Number(value.toFixed(2)))
        }));
        this.samples = [];
        this.lastSampleAt = 0;
        this.configure(options);
    }

    configure(config = {}) {
        const { now: _now, resourceProvider: _resourceProvider, ...metricConfig } = config;
        this.config = {
            ...DEFAULTS,
            ...(this.config || {}),
            ...metricConfig,
            sample_interval_ms: positiveInteger(metricConfig.sample_interval_ms, this.config?.sample_interval_ms ?? DEFAULTS.sample_interval_ms, 1000, 60 * 1000),
            max_samples: positiveInteger(metricConfig.max_samples, this.config?.max_samples ?? DEFAULTS.max_samples, 1, 1000)
        };
        while (this.samples.length > this.config.max_samples) this.samples.shift();
    }

    collect(sources = {}, force = false) {
        const now = this.now();
        if (!this.config.enabled) return { enabled: false, samples: [] };
        if (force || now - this.lastSampleAt >= this.config.sample_interval_ms) {
            const sample = { timestamp: now };
            if (this.config.resource) sample.resource = this.resourceProvider();
            if (this.config.bot) sample.bots = sources.bots || null;
            if (this.config.task) sample.tasks = sources.tasks || null;
            if (this.config.ai_queue) sample.aiQueue = sources.aiQueue || null;
            if (this.config.pathfinding) sample.pathfinding = sources.pathfinding || null;
            if (this.config.reconnection) sample.reconnection = sources.reconnection || null;
            this.samples.push(sample);
            if (this.samples.length > this.config.max_samples) this.samples.shift();
            this.lastSampleAt = now;
        }
        return this.snapshot();
    }

    snapshot() {
        const latest = this.samples.at(-1) || null;
        return {
            enabled: this.config.enabled,
            config: { ...this.config },
            latest: latest ? structuredClone(latest) : null,
            samples: this.samples.map(sample => structuredClone(sample))
        };
    }
}
