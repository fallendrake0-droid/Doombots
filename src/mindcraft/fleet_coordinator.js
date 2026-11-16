const TASK_TYPES = new Set(['guard', 'escort', 'gather', 'defend']);
const ROLE_PREFERENCES = {
    guard: ['guard', 'scout'],
    escort: ['guard', 'scout'],
    defend: ['guard', 'miner', 'scout'],
    gather: ['miner', 'farmer', 'scout', 'builder']
};

function normaliseRole(profile = {}) {
    return String(profile.role || profile.name || '').replace(/^Doom/i, '').toLowerCase();
}

function validTarget(target) {
    return typeof target === 'string' && target.length > 0 && target.length <= 64 && /^[A-Za-z0-9_:. -]+$/.test(target);
}

function taskKey(task) {
    return `${task.type}:${task.target}:${task.amount || 0}`.toLowerCase();
}

/**
 * Parent-process fleet allocator. Agents stay isolated in child processes; this
 * class exchanges only compact status snapshots and validated task messages.
 */
export class FleetCoordinator {
    constructor(options = {}) {
        this.statuses = new Map();
        this.tasks = new Map();
        this.nextTaskId = 1;
        this.taskTimeoutMs = options.taskTimeoutMs ?? 15 * 60 * 1000;
    }

    updateStatus(agentName, status = {}) {
        if (!agentName) return;
        this.statuses.set(agentName, {
            name: agentName,
            updatedAt: Date.now(),
            inGame: status.inGame === true,
            action: typeof status.action === 'string' ? status.action.slice(0, 120) : '',
            health: Number.isFinite(status.health) ? status.health : null,
            position: status.position || null,
            bodyguard: status.bodyguard || null,
            combat: status.combat || null
        });
        this.prune();
    }

    prune() {
        const now = Date.now();
        for (const [id, task] of this.tasks) {
            if (task.state === 'active' && now - task.createdAt > this.taskTimeoutMs) {
                task.state = 'expired';
                task.completedAt = now;
            }
            if (task.state !== 'active' && now - (task.completedAt || task.createdAt) > this.taskTimeoutMs) {
                this.tasks.delete(id);
            }
        }
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
        return { ok: true, task: { type, target, amount } };
    }

    hasActiveTaskFor(agentName) {
        return [...this.tasks.values()].some(task => task.state === 'active' && task.assignedTo === agentName);
    }

    chooseAgent(task, connections) {
        const preferences = ROLE_PREFERENCES[task.type] || [];
        const candidates = Object.entries(connections)
            .map(([name, connection]) => ({
                name,
                connection,
                status: this.statuses.get(name),
                role: normaliseRole(connection.settings?.profile)
            }))
            .filter(candidate => candidate.connection.in_game && candidate.connection.socket && !this.hasActiveTaskFor(candidate.name));

        candidates.sort((a, b) => {
            const aBusy = a.status?.action && a.status.action !== '' ? 1 : 0;
            const bBusy = b.status?.action && b.status.action !== '' ? 1 : 0;
            const aRole = preferences.indexOf(a.role);
            const bRole = preferences.indexOf(b.role);
            const aRank = aRole === -1 ? preferences.length + 1 : aRole;
            const bRank = bRole === -1 ? preferences.length + 1 : bRole;
            return aBusy - bBusy || aRank - bRank || a.name.localeCompare(b.name);
        });
        return candidates[0] || null;
    }

    assign(request, connections) {
        this.prune();
        const validated = this.validateTask(request);
        if (!validated.ok) return validated;
        const duplicate = [...this.tasks.values()].find(task => task.state === 'active' && task.key === taskKey(validated.task));
        if (duplicate) return { ok: false, error: `An equivalent squad task is already active as ${duplicate.id}.` };

        const candidate = this.chooseAgent(validated.task, connections);
        if (!candidate) return { ok: false, error: 'No connected DoomBot is available for this squad task.' };

        const task = {
            id: `fleet-${this.nextTaskId++}`,
            key: taskKey(validated.task),
            ...validated.task,
            requestedBy: request.requestedBy || 'unknown',
            assignedTo: candidate.name,
            createdAt: Date.now(),
            state: 'active'
        };
        this.tasks.set(task.id, task);
        candidate.connection.socket.emit('fleet-task', task);
        return { ok: true, task };
    }

    complete(agentName, taskId, success, detail = '') {
        const task = this.tasks.get(taskId);
        if (!task || task.assignedTo !== agentName) return false;
        task.state = success ? 'completed' : 'failed';
        task.detail = String(detail).slice(0, 300);
        task.completedAt = Date.now();
        return true;
    }

    markAgentUnavailable(agentName, detail = 'Assigned bot disconnected.') {
        const now = Date.now();
        for (const task of this.tasks.values()) {
            if (task.state === 'active' && task.assignedTo === agentName) {
                task.state = 'failed';
                task.detail = String(detail).slice(0, 300);
                task.completedAt = now;
            }
        }
    }

    snapshot() {
        this.prune();
        return {
            bots: [...this.statuses.values()],
            tasks: [...this.tasks.values()]
        };
    }
}

export { TASK_TYPES };
