import * as skills from '../library/skills.js';
import { serverProxy } from '../mindserver_proxy.js';

/** Client-side bridge for compact fleet status and validated coordinator tasks. */
export class FleetClient {
    constructor(agent) {
        this.agent = agent;
        this.knownBots = [];
        this.statusTimer = null;
        this.activeTaskId = null;
        this.activeTaskType = null;
    }

    start() {
        this.knownBots = serverProxy.getAgents().map(agent => agent.name);
        serverProxy.onFleetTask(task => this.handleTask(task));
        this.statusTimer = setInterval(() => this.reportStatus(), 2000);
        this.reportStatus();
    }

    stop() {
        if (this.statusTimer) clearInterval(this.statusTimer);
        this.statusTimer = null;
    }

    getKnownBotNames() {
        return this.knownBots;
    }

    reportStatus() {
        this.knownBots = serverProxy.getAgents().map(agent => agent.name);
        const bot = this.agent.bot;
        if (!bot?.entity) return;
        serverProxy.reportFleetStatus({
            inGame: true,
            action: this.agent.actions.currentActionLabel || (this.agent.bodyguard?.isActive() ? 'bodyguard' : ''),
            health: bot.health,
            position: {
                x: Number(bot.entity.position.x.toFixed(1)),
                y: Number(bot.entity.position.y.toFixed(1)),
                z: Number(bot.entity.position.z.toFixed(1))
            },
            bodyguard: this.agent.bodyguard?.getStatus(),
            combat: this.agent.combat?.getStatus()
        });
    }

    async requestTask(type, target, amount = null) {
        return serverProxy.requestFleetTask({ type, target, amount });
    }

    async complete(task, success, detail) {
        if (this.activeTaskId === task.id) {
            this.activeTaskId = null;
            this.activeTaskType = null;
        }
        serverProxy.completeFleetTask(task.id, success, detail);
        this.reportStatus();
    }

    completeActiveTask(success, detail, expectedTypes = null) {
        if (!this.activeTaskId || (expectedTypes && !expectedTypes.includes(this.activeTaskType))) return false;
        const taskId = this.activeTaskId;
        this.activeTaskId = null;
        this.activeTaskType = null;
        serverProxy.completeFleetTask(taskId, success, detail);
        this.reportStatus();
        return true;
    }

    async handleTask(task) {
        if (!task?.id || this.activeTaskId) return;
        this.activeTaskId = task.id;
        this.activeTaskType = task.type;
        try {
            if (task.type === 'guard' || task.type === 'escort' || task.type === 'defend') {
                const result = this.agent.bodyguard.start(task.target);
                if (!result.success) await this.complete(task, false, result.error);
                else this.reportStatus(); // guard tasks stay active until explicitly stopped or they expire
                return;
            }
            if (task.type === 'gather') {
                const result = await this.agent.actions.runAction('fleet:gather', async () => {
                    return skills.collectBlock(this.agent.bot, task.target, task.amount);
                }, { timeout: 10 });
                await this.complete(task, result.success && !result.interrupted, result.message || 'Gather task finished.');
                return;
            }
            await this.complete(task, false, `Unsupported task ${task.type}.`);
        } catch (error) {
            await this.complete(task, false, error.message);
        }
    }
}
