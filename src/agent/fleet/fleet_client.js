import * as skills from '../library/skills.js';
import settings from '../settings.js';
import { serverProxy } from '../mindserver_proxy.js';

function safePathfindingStatus(bot) {
    const pathfinder = bot?.pathfinder;
    if (!pathfinder) return null;
    try {
        return {
            moving: pathfinder.isMoving?.() === true,
            mining: pathfinder.isMining?.() === true,
            building: pathfinder.isBuilding?.() === true
        };
    } catch (error) {
        console.warn('[fleet] unable to read pathfinder metrics:', error.message);
        return null;
    }
}

/** Client-side bridge for compact status, task ownership, and relevant observations. */
export class FleetClient {
    constructor(agent, config = {}) {
        this.agent = agent;
        this.config = {
            status_interval_ms: 2000,
            status_heartbeat_ms: 10000,
            max_observations: 32,
            ...(settings.fleet || {}),
            ...config
        };
        this.knownBots = [];
        this.statusTimer = null;
        this.activeTaskId = null;
        this.activeTaskType = null;
        this.activeTask = null;
        this.observations = new Map();
        this.lastStatusFingerprint = null;
        this.lastStatusAt = 0;
        this.unsubscribeTask = null;
        this.unsubscribeCancel = null;
        this.unsubscribeObservation = null;
    }

    start() {
        if (this.statusTimer) return;
        this.knownBots = serverProxy.getAgents().map(agent => agent.name);
        this.unsubscribeTask = serverProxy.onFleetTask(task => this.handleTask(task));
        this.unsubscribeCancel = serverProxy.onFleetTaskCancel(cancel => this.handleTaskCancel(cancel));
        this.unsubscribeObservation = serverProxy.onFleetObservation(observation => this.receiveObservation(observation));
        this.statusTimer = setInterval(() => this.reportStatus(), this.config.status_interval_ms);
        this.reportStatus(true);
    }

    stop() {
        if (this.statusTimer) clearInterval(this.statusTimer);
        this.statusTimer = null;
        this.unsubscribeTask?.();
        this.unsubscribeCancel?.();
        this.unsubscribeObservation?.();
        this.unsubscribeTask = null;
        this.unsubscribeCancel = null;
        this.unsubscribeObservation = null;
    }

    getKnownBotNames() {
        return this.knownBots;
    }

    getObservations() {
        return [...this.observations.values()].map(observation => ({ ...observation }));
    }

    reportStatus(force = false) {
        this.knownBots = serverProxy.getAgents().map(agent => agent.name);
        const bot = this.agent.bot;
        if (!bot?.entity) return;
        const status = {
            inGame: true,
            action: this.agent.actions.currentActionLabel || (this.agent.bodyguard?.isActive() ? 'bodyguard' : ''),
            activeTaskId: this.activeTaskId,
            health: bot.health,
            position: {
                x: Number(bot.entity.position.x.toFixed(1)),
                y: Number(bot.entity.position.y.toFixed(1)),
                z: Number(bot.entity.position.z.toFixed(1))
            },
            bodyguard: this.agent.bodyguard?.getStatus(),
            combat: this.agent.combat?.getStatus(),
            pathfinding: safePathfindingStatus(bot)
        };
        const now = Date.now();
        const fingerprint = JSON.stringify(status);
        if (!force && fingerprint === this.lastStatusFingerprint && now - this.lastStatusAt < this.config.status_heartbeat_ms) return;
        this.lastStatusFingerprint = fingerprint;
        this.lastStatusAt = now;
        serverProxy.reportFleetStatus(status);
    }

    async requestTask(type, target, amount = null, priority = null) {
        return serverProxy.requestFleetTask({ type, target, amount, priority });
    }

    reportTask(taskId, state, detail = '', options = {}) {
        serverProxy.reportFleetTask({ taskId, state, detail, retryable: options.retryable !== false });
    }

    async complete(task, success, detail, retryable = !success) {
        if (this.activeTaskId === task.id) {
            this.activeTaskId = null;
            this.activeTaskType = null;
            this.activeTask = null;
        }
        this.reportTask(task.id, success ? 'completed' : 'failed', detail, { retryable });
        this.reportStatus(true);
    }

    completeActiveTask(success, detail, expectedTypes = null) {
        if (!this.activeTaskId || (expectedTypes && !expectedTypes.includes(this.activeTaskType))) return false;
        const task = this.activeTask || { id: this.activeTaskId };
        this.activeTaskId = null;
        this.activeTaskType = null;
        this.activeTask = null;
        this.reportTask(task.id, success ? 'completed' : 'failed', detail, { retryable: !success });
        this.reportStatus(true);
        return true;
    }

    interruptActiveTask(detail = 'Interrupted by operator.', retryable = true) {
        if (!this.activeTaskId) return false;
        const task = this.activeTask || { id: this.activeTaskId };
        if (['guard', 'escort', 'defend'].includes(this.activeTaskType)) this.agent.bodyguard?.stop();
        this.activeTaskId = null;
        this.activeTaskType = null;
        this.activeTask = null;
        this.reportTask(task.id, 'interrupted', detail, { retryable });
        this.reportStatus(true);
        return true;
    }

    publishObservation(topic, key, detail = '', roles = null) {
        const position = this.agent.bot?.entity?.position;
        return serverProxy.publishFleetObservation({
            topic,
            key,
            detail,
            roles,
            position: position ? { x: position.x, y: position.y, z: position.z } : null,
            timestamp: Date.now()
        });
    }

    receiveObservation(observation) {
        if (!observation?.id || !Number.isFinite(observation.timestamp)) return;
        const previous = this.observations.get(observation.id);
        if (previous && previous.timestamp >= observation.timestamp) return;
        this.observations.set(observation.id, { ...observation });
        while (this.observations.size > this.config.max_observations) {
            const oldest = [...this.observations.values()].sort((a, b) => a.timestamp - b.timestamp)[0];
            if (!oldest) break;
            this.observations.delete(oldest.id);
        }
        this.agent.bot?.emit?.('fleet-observation', observation);
    }

    async handleTask(task) {
        if (!task?.id) return;
        if (this.activeTaskId) {
            this.reportTask(task.id, 'interrupted', 'Agent already owns another task.', { retryable: true });
            return;
        }
        this.activeTaskId = task.id;
        this.activeTaskType = task.type;
        this.activeTask = task;
        this.reportTask(task.id, 'active', 'Task accepted by worker.');
        this.reportStatus(true);
        try {
            if (task.type === 'guard' || task.type === 'escort' || task.type === 'defend') {
                const result = this.agent.bodyguard.start(task.target);
                if (!result.success) await this.complete(task, false, result.error, true);
                else this.reportStatus(true); // stays active until stopped, interrupted, or timed out
                return;
            }
            if (task.type === 'gather') {
                const result = await this.agent.actions.runAction('fleet:gather', async () => {
                    return skills.collectBlock(this.agent.bot, task.target, task.amount);
                }, { timeout: 10 });
                if (result.interrupted) {
                    await this.complete(task, false, result.message || 'Gather task interrupted.', true);
                } else {
                    await this.complete(task, result.success === true, result.message || 'Gather task finished.', result.success !== true);
                }
                return;
            }
            await this.complete(task, false, `Unsupported task ${task.type}.`, false);
        } catch (error) {
            await this.complete(task, false, `Task failure: ${error.message}`, true);
        }
    }

    handleTaskCancel(cancel) {
        if (!cancel?.id || cancel.id !== this.activeTaskId) return;
        const task = this.activeTask;
        if (['guard', 'escort', 'defend'].includes(this.activeTaskType)) this.agent.bodyguard?.stop();
        this.agent.actions?.cancelResume();
        this.agent.requestInterrupt?.();
        this.activeTaskId = null;
        this.activeTaskType = null;
        this.activeTask = null;
        // The parent already changed ownership/state before issuing this event.
        // Clear the worker promptly so a recovered task cannot overlap locally.
        this.reportStatus(true);
        console.warn(`[fleet:${this.agent.name}] task ${task?.id || cancel.id} cancelled: ${cancel.detail || 'no detail'}`);
    }
}
