import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { nextReconnectDelay, shouldReconnect } from './reconnect_policy.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));

const STATES = {
    IDLE: 'idle',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    RECONNECTING: 'reconnecting',
    STOPPED: 'stopped',
    FAILED: 'failed'
};

/** One isolated child-process lifecycle. A failure here never exits the fleet parent. */
export class AgentProcess {
    constructor(name, port, reconnect = {}, onStateChange = null, dependencies = {}) {
        this.name = name;
        this.port = port;
        // Injection points keep lifecycle behavior unit-testable without
        // Mineflayer, Socket.IO, or a real child process.
        this.spawnFactory = dependencies.spawnFactory || spawn;
        this.logoutAgent = dependencies.logoutAgent || (() => {});
        this.agentToken = dependencies.agentToken || null;
        this.schedule = dependencies.setTimeout || setTimeout;
        this.cancelSchedule = dependencies.clearTimeout || clearTimeout;
        this.logger = dependencies.logger || console;
        this.reconnect = {
            enabled: reconnect.enabled !== false,
            max_attempts: reconnect.max_attempts ?? 8,
            base_delay_ms: reconnect.base_delay_ms ?? 1000,
            max_delay_ms: reconnect.max_delay_ms ?? 30000,
            stable_reset_ms: reconnect.stable_reset_ms ?? 30000
        };
        this.onStateChange = onStateChange;
        this.running = false;
        this.intentionalStop = false;
        this.restartRequested = false;
        this.reconnectAttempts = 0;
        this.retryTimer = null;
        this.state = STATES.IDLE;
    }

    setState(state) {
        this.state = state;
        this.onStateChange?.(state, this.reconnectAttempts);
    }

    start(load_memory = false, init_message = null, count_id = 0) {
        if (this.running) return;
        this.cancelSchedule(this.retryTimer);
        this.retryTimer = null;
        this.count_id = count_id;
        this.load_memory = load_memory;
        this.init_message = init_message;
        this.intentionalStop = false;
        this.spawnChild();
    }

    spawnChild() {
        this.running = true;
        this.setState(STATES.CONNECTING);
        const args = [init_agent_path, this.name, '-n', this.name, '-c', this.count_id, '-p', this.port];
        if (this.load_memory) args.push('-l', this.load_memory);
        if (this.init_message) args.push('-m', this.init_message);

        const agentProcess = this.spawnFactory(process.execPath, args, {
            stdio: 'inherit',
            stderr: 'inherit',
            // Keep this ephemeral local credential out of process arguments
            // and dashboard settings; each worker authenticates its own socket.
            env: this.agentToken ? { ...process.env, DOOMBOTS_AGENT_TOKEN: this.agentToken } : process.env
        });
        this.process = agentProcess;
        const startedAt = Date.now();
        let exitHandled = false;
        const handleExitOnce = (code, signal) => {
            if (exitHandled) return;
            exitHandled = true;
            this.handleExit(code, signal, startedAt);
        };

        agentProcess.once('spawn', () => this.setState(STATES.CONNECTED));
        agentProcess.on('exit', handleExitOnce);
        agentProcess.on('error', error => {
            this.logger.error?.(`Agent process error for ${this.name}:`, error);
            // A ChildProcess error normally means spawning failed and may be
            // followed only by `close`, not `exit`. Treat it as a bounded
            // per-agent lifecycle failure rather than leaving the bot stuck.
            handleExitOnce(1, null);
        });
    }

    handleExit(code, signal, startedAt) {
        this.running = false;
        this.process = null;
        this.logoutAgent(this.name);
        this.logger.log?.(`Agent ${this.name} exited with code ${code} and signal ${signal}`);

        if (this.restartRequested) {
            this.restartRequested = false;
            this.intentionalStop = false;
            this.start(true, 'Agent process restarted.', this.count_id);
            return;
        }
        if (this.intentionalStop || signal === 'SIGINT' || code === 0) {
            this.setState(STATES.STOPPED);
            return;
        }

        this.setState(STATES.DISCONNECTED);
        // Task code 4 means a required collaborator was absent; retrying it in a
        // tight loop cannot fix the task and must not take down other bots.
        // Consecutive short-lived workers receive backoff. A worker that ran
        // stably for a while starts a fresh retry window rather than exhausting
        // a lifetime reconnect budget.
        if (Date.now() - startedAt < this.reconnect.stable_reset_ms) this.reconnectAttempts++;
        else this.reconnectAttempts = 1;
        if (!shouldReconnect({
            intentionalStop: this.intentionalStop,
            enabled: this.reconnect.enabled,
            code,
            attempt: this.reconnectAttempts,
            maxAttempts: this.reconnect.max_attempts
        })) {
            this.logger.error?.(`Agent ${this.name} will not reconnect after exit code ${code ?? 'unknown'}.`);
            this.setState(STATES.FAILED);
            return;
        }

        const delay = nextReconnectDelay(this.reconnect.base_delay_ms, this.reconnect.max_delay_ms, this.reconnectAttempts);
        this.setState(STATES.RECONNECTING);
        this.logger.warn?.(`Reconnecting ${this.name} in ${delay}ms (attempt ${this.reconnectAttempts}/${this.reconnect.max_attempts}).`);
        this.retryTimer = this.schedule(() => {
            this.retryTimer = null;
            if (!this.intentionalStop) this.start(true, 'Agent process reconnected.', this.count_id);
        }, delay);
    }

    stop() {
        this.intentionalStop = true;
        this.cancelSchedule(this.retryTimer);
        this.retryTimer = null;
        if (!this.running || !this.process) {
            this.setState(STATES.STOPPED);
            return;
        }
        this.process.kill('SIGINT');
    }

    forceRestart() {
        this.cancelSchedule(this.retryTimer);
        this.retryTimer = null;
        if (this.running && this.process && !this.process.killed) {
            this.restartRequested = true;
            this.intentionalStop = true;
            this.process.kill('SIGINT');
        } else {
            this.reconnectAttempts = 0;
            this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}

export { STATES as AgentProcessState };
