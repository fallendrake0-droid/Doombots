const TASK_TYPES = new Set(['guard', 'escort', 'gather', 'defend']);
const TASK_STATES = new Set(['queued', 'assigned', 'active', 'completed', 'failed', 'interrupted', 'expired', 'cancelled']);
const ACTIVE_TASK_STATES = new Set(['queued', 'assigned', 'active']);
const TERMINAL_TASK_STATES = new Set(['completed', 'failed', 'expired', 'cancelled']);
const ROLE_PREFERENCES = {
    guard: ['guard', 'scout'],
    escort: ['guard', 'scout'],
    defend: ['guard', 'miner', 'scout'],
    gather: ['miner', 'farmer', 'scout', 'builder']
};
const DEFAULT_PRIORITIES = { defend: 90, guard: 80, escort: 70, gather: 40 };
const OBSERVATION_TOPICS = new Set(['resource', 'hazard', 'threat', 'location']);
const OBSERVATION_ROLES = {
    resource: ['miner', 'builder', 'farmer', 'scout'],
    hazard: ['scout', 'miner', 'builder', 'farmer', 'guard'],
    threat: ['guard', 'scout'],
    location: ['scout', 'miner', 'builder', 'farmer', 'guard']
};
const ROLE_NAMES = new Set(['scout', 'miner', 'builder', 'farmer', 'guard']);

function normaliseRole(profile = {}) {
    return String(profile.role || profile.name || '').replace(/^Doom/i, '').toLowerCase();
}

function validTarget(target) {
    return typeof target === 'string' && target.length > 0 && target.length <= 64 && /^[A-Za-z0-9_:. -]+$/.test(target);
}

function taskKey(task) {
    return `${task.type}:${task.target}:${task.amount || 0}`.toLowerCase();
}

function finiteInteger(value, fallback, minimum, maximum) {
    if (value == null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function finiteNumber(value, fallback, minimum, maximum) {
    if (value == null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, parsed));
}

function compactPosition(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return null;
    return {
        x: Number(position.x.toFixed(1)),
        y: Number(position.y.toFixed(1)),
        z: Number(position.z.toFixed(1))
    };
}

function cloneTask(task) {
    return {
        ...task,
        retriesRemaining: Math.max(0, task.maxAttempts - task.attempts),
        failureHistory: task.failureHistory.map(entry => ({ ...entry }))
    };
}

/**
 * Parent-process task and compact-observation coordinator. It deliberately has
 * no world or Mineflayer references: child agents exchange only validated,
 * bounded summaries over the existing control socket.
 */
export class FleetCoordinator {
    constructor(options = {}) {
        const { now, setTimeout: schedule, clearTimeout: cancelSchedule, ...config } = options;
        this.now = now || (() => Date.now());
        this.schedule = schedule || setTimeout;
        this.cancelSchedule = cancelSchedule || clearTimeout;
        this.retryTimer = null;
        this.retryTimerAt = null;
        this.lastConnections = null;
        this.statuses = new Map();
        this.tasks = new Map();
        this.observations = new Map();
        this.nextTaskId = 1;
        this.metrics = {
            created: 0,
            assigned: 0,
            completed: 0,
            failed: 0,
            interrupted: 0,
            expired: 0,
            cancelled: 0,
            retried: 0,
            duplicates: 0,
            statusUpdates: 0,
            observationsAccepted: 0,
            observationsRejected: 0,
            staleObservations: 0
        };
        this.configure(config);
    }

    configure(config = {}) {
        const priorities = { ...DEFAULT_PRIORITIES, ...(config.priorities || config.task_priorities || {}) };
        this.config = {
            taskTimeoutMs: finiteInteger(config.taskTimeoutMs ?? config.task_timeout_ms, this.config?.taskTimeoutMs ?? 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
            taskRetentionMs: finiteInteger(config.taskRetentionMs ?? config.task_retention_ms, this.config?.taskRetentionMs ?? 15 * 60 * 1000, 1000, 7 * 24 * 60 * 60 * 1000),
            maxRetries: finiteInteger(config.maxRetries ?? config.max_retries, this.config?.maxRetries ?? 2, 0, 8),
            retryDelayMs: finiteInteger(config.retryDelayMs ?? config.retry_delay_ms, this.config?.retryDelayMs ?? 2000, 0, 5 * 60 * 1000),
            maxTasks: finiteInteger(config.maxTasks ?? config.max_tasks, this.config?.maxTasks ?? 64, 1, 512),
            statusTtlMs: finiteInteger(config.statusTtlMs ?? config.status_ttl_ms, this.config?.statusTtlMs ?? 15_000, 1000, 10 * 60 * 1000),
            observationTtlMs: finiteInteger(config.observationTtlMs ?? config.observation_ttl_ms, this.config?.observationTtlMs ?? 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
            maxObservations: finiteInteger(config.maxObservations ?? config.max_observations, this.config?.maxObservations ?? 96, 1, 512),
            maxObservationAgeMs: finiteInteger(config.maxObservationAgeMs ?? config.max_observation_age_ms, this.config?.maxObservationAgeMs ?? 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
            maxFutureObservationMs: finiteInteger(config.maxFutureObservationMs ?? config.max_future_observation_ms, this.config?.maxFutureObservationMs ?? 10_000, 0, 60 * 1000),
            priorities: Object.fromEntries(Object.entries(priorities).map(([type, priority]) => [type, finiteNumber(priority, DEFAULT_PRIORITIES[type] ?? 50, 0, 100)]))
        };
    }

    updateStatus(agentName, status = {}, connections = null) {
        if (!agentName) return;
        const now = this.now();
        this.statuses.set(agentName, {
            name: agentName,
            updatedAt: now,
            inGame: status.inGame === true,
            action: typeof status.action === 'string' ? status.action.slice(0, 120) : '',
            health: Number.isFinite(status.health) ? status.health : null,
            position: compactPosition(status.position),
            bodyguard: status.bodyguard || null,
            combat: status.combat || null,
            pathfinding: status.pathfinding && typeof status.pathfinding === 'object' ? {
                moving: status.pathfinding.moving === true,
                mining: status.pathfinding.mining === true,
                building: status.pathfinding.building === true
            } : null,
            activeTaskId: typeof status.activeTaskId === 'string' ? status.activeTaskId.slice(0, 64) : null
        });
        this.metrics.statusUpdates++;
        this.prune(connections);
        if (connections) this.pump(connections);
    }

    validateTask(request) {
        const type = String(request?.type || '').toLowerCase();
        const target = String(request?.target || '');
        const amount = request?.amount == null ? null : Number(request.amount);
        if (!TASK_TYPES.has(type)) return { ok: false, error: `Unsupported squad task '${type}'.` };
        if (!validTarget(target)) return { ok: false, error: 'Task target must be 1–64 safe characters.' };
        if (amount != null && (!Number.isInteger(amount) || amount < 1 || amount > 2304)) {
            return { ok: false, error: 'Task amount must be a whole number from 1 to 2304.' };
        }
        if (type === 'gather' && amount == null) return { ok: false, error: 'Gather tasks require an amount.' };
        const priority = finiteNumber(request?.priority, this.config.priorities[type] ?? 50, 0, 100);
        const requestedRetries = request?.maxRetries ?? request?.max_retries;
        const maxRetries = finiteInteger(requestedRetries, this.config.maxRetries, 0, 8);
        return { ok: true, task: { type, target, amount, priority, maxAttempts: maxRetries + 1 } };
    }

    hasActiveTaskFor(agentName) {
        return [...this.tasks.values()].some(task => ACTIVE_TASK_STATES.has(task.state) && task.assignedTo === agentName);
    }

    chooseAgent(task, connections) {
        const preferences = ROLE_PREFERENCES[task.type] || [];
        const now = this.now();
        const candidates = Object.entries(connections || {})
            .map(([name, connection]) => ({
                name,
                connection,
                status: this.statuses.get(name),
                role: normaliseRole(connection.settings?.profile)
            }))
            .filter(candidate => {
                if (!candidate.connection.in_game || !candidate.connection.socket || this.hasActiveTaskFor(candidate.name)) return false;
                // A connected agent that has never sent a compact status can
                // still receive its first task; stale known status is avoided.
                if (candidate.status && now - candidate.status.updatedAt > this.config.statusTtlMs) return false;
                // Keep allocation role-aware. The preference list also permits
                // intentional fallback roles when the specialist is absent.
                return preferences.length === 0 || preferences.includes(candidate.role);
            });

        candidates.sort((a, b) => {
            const aBusy = a.status?.action ? 1 : 0;
            const bBusy = b.status?.action ? 1 : 0;
            const aRole = preferences.indexOf(a.role);
            const bRole = preferences.indexOf(b.role);
            const aRank = aRole === -1 ? preferences.length + 1 : aRole;
            const bRank = bRole === -1 ? preferences.length + 1 : bRole;
            return aBusy - bBusy || aRank - bRank || a.name.localeCompare(b.name);
        });
        return candidates[0] || null;
    }

    assign(request, connections) {
        this.prune(connections);
        const validated = this.validateTask(request);
        if (!validated.ok) return validated;
        const duplicate = [...this.tasks.values()].find(task => ACTIVE_TASK_STATES.has(task.state) && task.key === taskKey(validated.task));
        if (duplicate) {
            this.metrics.duplicates++;
            return { ok: false, error: `An equivalent squad task is already active as ${duplicate.id}.`, task: cloneTask(duplicate) };
        }
        if (this.tasks.size >= this.config.maxTasks) {
            return { ok: false, error: 'Fleet task retention limit reached; wait for old task records to expire.' };
        }

        const now = this.now();
        const task = {
            id: `fleet-${this.nextTaskId++}`,
            key: taskKey(validated.task),
            ...validated.task,
            requestedBy: String(request.requestedBy || 'unknown').slice(0, 64),
            assignedTo: null,
            lastAssignedTo: null,
            state: 'queued',
            attempts: 0,
            createdAt: now,
            updatedAt: now,
            assignedAt: null,
            retryAt: now,
            detail: '',
            failureHistory: []
        };
        this.metrics.created++;
        this.tasks.set(task.id, task);
        this.pump(connections);
        return { ok: true, task: cloneTask(task) };
    }

    scheduleRetryPump(connections = null) {
        if (connections) this.lastConnections = connections;
        const availableConnections = connections || this.lastConnections;
        if (!availableConnections) return;
        const now = this.now();
        const nextPumpAt = [...this.tasks.values()]
            .reduce((earliest, task) => {
                if (task.state === 'queued' && task.retryAt > now) return Math.min(earliest, task.retryAt);
                if (task.state === 'assigned' || task.state === 'active') {
                    return Math.min(earliest, task.updatedAt + this.config.taskTimeoutMs);
                }
                return earliest;
            }, Infinity);
        if (!Number.isFinite(nextPumpAt)) {
            if (this.retryTimer) this.cancelSchedule(this.retryTimer);
            this.retryTimer = null;
            this.retryTimerAt = null;
            return;
        }
        if (this.retryTimer && this.retryTimerAt != null && this.retryTimerAt <= nextPumpAt) return;
        if (this.retryTimer) this.cancelSchedule(this.retryTimer);
        this.retryTimerAt = nextPumpAt;
        this.retryTimer = this.schedule(() => {
            this.retryTimer = null;
            this.retryTimerAt = null;
            this.prune(availableConnections);
            this.pump(availableConnections);
        }, Math.max(1, nextPumpAt - now));
    }

    pump(connections) {
        if (!connections) return;
        this.lastConnections = connections;
        const now = this.now();
        const queued = [...this.tasks.values()]
            .filter(task => task.state === 'queued' && task.retryAt <= now)
            .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        for (const task of queued) {
            const candidate = this.chooseAgent(task, connections);
            if (!candidate) break;
            task.state = 'assigned';
            task.assignedTo = candidate.name;
            task.lastAssignedTo = candidate.name;
            task.attempts++;
            task.assignedAt = now;
            task.updatedAt = now;
            this.metrics.assigned++;
            candidate.connection.socket.emit('fleet-task', cloneTask(task));
        }
        this.scheduleRetryPump(connections);
    }

    report(agentName, taskId, state, detail = '', options = {}, connections = null) {
        const task = this.tasks.get(taskId);
        if (!task || task.assignedTo !== agentName || !TASK_STATES.has(state)) return { ok: false, error: 'Task ownership or state is invalid.' };
        const now = this.now();
        if (state === 'active') {
            if (task.state !== 'assigned' && task.state !== 'active') return { ok: false, error: 'Only assigned work can become active.' };
            task.state = 'active';
            task.updatedAt = now;
            task.detail = String(detail || '').slice(0, 300);
            this.scheduleRetryPump(connections);
            return { ok: true, task: cloneTask(task) };
        }
        if (state === 'completed') {
            task.state = 'completed';
            task.updatedAt = now;
            task.completedAt = now;
            task.detail = String(detail || '').slice(0, 300);
            this.metrics.completed++;
            this.pump(connections);
            return { ok: true, task: cloneTask(task) };
        }
        if (!['failed', 'interrupted', 'cancelled'].includes(state)) return { ok: false, error: 'Only active, completed, failed, interrupted, or cancelled reports are accepted.' };
        return this.retryOrFinish(task, state, detail, options.retryable !== false, connections);
    }

    complete(agentName, taskId, success, detail = '', connections = null) {
        return this.report(agentName, taskId, success ? 'completed' : 'failed', detail, { retryable: !success }, connections).ok;
    }

    retryOrFinish(task, state, detail, retryable, connections = null) {
        const now = this.now();
        const originalOwner = task.assignedTo;
        task.detail = String(detail || '').slice(0, 300);
        task.updatedAt = now;
        task.failureHistory.push({ state, detail: task.detail, at: now, owner: originalOwner });
        if (task.failureHistory.length > 8) task.failureHistory.shift();
        if (state === 'interrupted') this.metrics.interrupted++;
        if (state === 'expired') this.metrics.expired++;
        if (state === 'cancelled') {
            this.metrics.cancelled++;
            retryable = false;
        }
        if (retryable && task.attempts < task.maxAttempts) {
            task.state = 'queued';
            task.assignedTo = null;
            task.retryAt = now + this.config.retryDelayMs;
            this.metrics.retried++;
        } else {
            task.state = state === 'cancelled' || state === 'expired' ? state : 'failed';
            task.completedAt = now;
            this.metrics.failed++;
        }
        this.pump(connections);
        return { ok: true, task: cloneTask(task) };
    }

    markAgentUnavailable(agentName, detail = 'Assigned bot disconnected.', connections = null) {
        for (const task of this.tasks.values()) {
            if (ACTIVE_TASK_STATES.has(task.state) && task.assignedTo === agentName) {
                this.retryOrFinish(task, 'interrupted', detail, true, connections);
            }
        }
        this.pump(connections);
    }

    cancel(taskId, detail = 'Cancelled by coordinator.', connections = null) {
        const task = this.tasks.get(taskId);
        if (!task || TERMINAL_TASK_STATES.has(task.state)) return false;
        const owner = task.assignedTo;
        if (owner && connections?.[owner]?.socket) {
            connections[owner].socket.emit('fleet-task-cancel', { id: task.id, detail: String(detail).slice(0, 300) });
        }
        task.state = 'cancelled';
        task.detail = String(detail).slice(0, 300);
        task.updatedAt = this.now();
        task.completedAt = task.updatedAt;
        this.metrics.cancelled++;
        this.pump(connections);
        return true;
    }

    validateObservation(observation) {
        const topic = String(observation?.topic || '').toLowerCase();
        const key = String(observation?.key || '').toLowerCase();
        const detail = observation?.detail == null ? '' : String(observation.detail);
        const timestamp = Number(observation?.timestamp);
        const now = this.now();
        if (!OBSERVATION_TOPICS.has(topic)) return { ok: false, error: 'Observation topic is not relevant to the fleet.' };
        if (!validTarget(key)) return { ok: false, error: 'Observation key must be 1–64 safe characters.' };
        if (detail.length > 180 || /[\u0000-\u001f]/.test(detail)) return { ok: false, error: 'Observation detail must be compact text.' };
        if (!Number.isFinite(timestamp) || timestamp < now - this.config.maxObservationAgeMs || timestamp > now + this.config.maxFutureObservationMs) {
            return { ok: false, error: 'Observation timestamp is stale or too far in the future.' };
        }
        const requestedRoles = Array.isArray(observation.roles) ? observation.roles : OBSERVATION_ROLES[topic];
        const roles = [...new Set(requestedRoles.map(role => String(role).toLowerCase()).filter(role => ROLE_NAMES.has(role)))];
        if (roles.length === 0) return { ok: false, error: 'Observation has no valid recipient roles.' };
        return { ok: true, observation: { topic, key, detail, timestamp, position: compactPosition(observation.position), roles } };
    }

    publishObservation(agentName, observation, connections = null) {
        this.prune(connections);
        const validated = this.validateObservation(observation);
        if (!validated.ok) {
            this.metrics.observationsRejected++;
            return validated;
        }
        const item = validated.observation;
        const id = `${item.topic}:${item.key}`;
        const previous = this.observations.get(id);
        if (previous && item.timestamp <= previous.timestamp) {
            this.metrics.observationsRejected++;
            this.metrics.staleObservations++;
            return { ok: false, error: 'Observation is older than the current fleet record.' };
        }
        if (!previous && this.observations.size >= this.config.maxObservations) {
            const oldest = [...this.observations.values()].sort((a, b) => a.timestamp - b.timestamp)[0];
            if (oldest) this.observations.delete(oldest.id);
        }
        const now = this.now();
        const stored = {
            id,
            ...item,
            source: String(agentName || 'unknown').slice(0, 64),
            updatedAt: now,
            expiresAt: Math.max(now, item.timestamp) + this.config.observationTtlMs
        };
        this.observations.set(id, stored);
        this.metrics.observationsAccepted++;
        return { ok: true, observation: { ...stored } };
    }

    observationRecipients(observation, connections) {
        return Object.entries(connections || {})
            .filter(([name, connection]) => name !== observation.source && connection.in_game && connection.socket && observation.roles.includes(normaliseRole(connection.settings?.profile)))
            .map(([name]) => name);
    }

    prune(connections = null) {
        const now = this.now();
        for (const [name, status] of this.statuses) {
            if (now - status.updatedAt > this.config.statusTtlMs * 4) this.statuses.delete(name);
        }
        for (const [id, observation] of this.observations) {
            if (observation.expiresAt <= now) this.observations.delete(id);
        }
        for (const [id, task] of this.tasks) {
            if (['assigned', 'active'].includes(task.state) && now - task.updatedAt >= this.config.taskTimeoutMs) {
                const owner = task.assignedTo;
                if (owner && connections?.[owner]?.socket) {
                    connections[owner].socket.emit('fleet-task-cancel', { id: task.id, detail: 'Task timed out; coordinator is recovering it.' });
                }
                this.retryOrFinish(task, 'expired', 'Task timed out before completion.', true, connections);
            }
            if (TERMINAL_TASK_STATES.has(task.state) && now - (task.completedAt || task.updatedAt) > this.config.taskRetentionMs) {
                this.tasks.delete(id);
            }
        }
    }

    taskMetrics() {
        const states = Object.fromEntries([...TASK_STATES].map(state => [state, 0]));
        for (const task of this.tasks.values()) states[task.state]++;
        return { ...this.metrics, states, retainedTasks: this.tasks.size, retainedObservations: this.observations.size };
    }

    snapshot() {
        this.prune();
        return {
            bots: [...this.statuses.values()].map(status => ({ ...status, position: status.position ? { ...status.position } : null })),
            tasks: [...this.tasks.values()].map(cloneTask).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt),
            observations: [...this.observations.values()].map(observation => ({ ...observation, position: observation.position ? { ...observation.position } : null })),
            metrics: this.taskMetrics()
        };
    }
}

export { TASK_TYPES, TASK_STATES, OBSERVATION_TOPICS };
