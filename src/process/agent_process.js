import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { logoutAgent } from '../mindcraft/mindserver.js';
import settings from '../../settings.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));

class ReconnectCoordinator {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.lastConnectionTime = 0;
    }

    enqueue(agentProcess, count_id, isThrottled) {
        // Prevent duplicate enqueuing of the same bot
        if (this.queue.some(item => item.agentProcess.name === agentProcess.name)) {
            return;
        }
        this.queue.push({ agentProcess, count_id, isThrottled, enqueuedAt: Date.now() });
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            const now = Date.now();
            const timeSinceLast = now - this.lastConnectionTime;

            // Spigot/Aternos connection throttle requires strict spacing (settings.spawn_delay or min 14s)
            const minStagger = Math.max(14000, parseInt(settings?.spawn_delay || 14, 10) * 1000);
            const requiredWait = item.isThrottled ? Math.max(minStagger, 20000) : minStagger;

            if (timeSinceLast < requiredWait) {
                const sleepMs = requiredWait - timeSinceLast;
                console.log(`\x1b[36m[LoginGuard]\x1b[0m ⏳ Staggering reconnect for \x1b[33m${item.agentProcess.name}\x1b[0m (waiting ${(sleepMs / 1000).toFixed(1)}s to clear Spigot/Aternos connection throttle)...`);
                await new Promise(r => setTimeout(r, sleepMs));
            }

            this.lastConnectionTime = Date.now();
            console.log(`\x1b[32m[LoginGuard]\x1b[0m 🚀 Reconnecting \x1b[33m${item.agentProcess.name}\x1b[0m to server...`);
            item.agentProcess.start(true, 'Agent process restarted.', item.count_id);

            // Wait 5s before proceeding to next bot in queue to allow the socket handshake to register
            await new Promise(r => setTimeout(r, 5000));
        }

        this.isProcessing = false;
    }
}

const reconnectCoordinator = new ReconnectCoordinator();

export class AgentProcess {
    constructor(name, port) {
        this.name = name;
        this.port = port;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        this.count_id = count_id;
        this.running = true;

        // Node V8 options must come before the script path!
        let nodeArgs = [];
        const maxMem = process.env.AGENT_MAX_MEMORY || 
            (settings?.max_agent_memory_mb ? settings.max_agent_memory_mb : 1024);

        if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes('max-old-space-size')) {
            nodeArgs.push(`--max-old-space-size=${maxMem}`);
        }
        if (settings?.low_memory_mode || process.env.EXPOSE_GC) {
            nodeArgs.push('--expose-gc');
        }

        let args = [...nodeArgs, init_agent_path, this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        const agentProcess = spawn(process.execPath, args, {
            stdio: 'inherit',
            stderr: 'inherit',
            env: {
                ...process.env,
                LOW_MEMORY_MODE: settings?.low_memory_mode ? 'true' : (process.env.LOW_MEMORY_MODE || ''),
                FAST_MODE: settings?.fast_mode ? 'true' : (process.env.FAST_MODE || ''),
            }
        });
        
        let last_restart = Date.now();
        this.retryCount = this.retryCount || 0;
        const MAX_RETRIES = 15;

        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            logoutAgent(this.name);
            
            if (code > 1 && code !== 4) {
                console.log(`Ending task`);
                process.exit(code);
            }

            if (code !== 0 && signal !== 'SIGINT') {
                if (Date.now() - last_restart >= 30000) {
                    this.retryCount = 0;
                }

                if (this.retryCount < MAX_RETRIES) {
                    this.retryCount++;
                    const isThrottled = code === 4;
                    console.log(`[AgentProcess] Reconnect queued for ${this.name} (attempt ${this.retryCount}/${MAX_RETRIES}${isThrottled ? ' - throttle backoff' : ''})...`);
                    reconnectCoordinator.enqueue(this, count_id, isThrottled);
                } else {
                    console.error(`[AgentProcess] Reached ${MAX_RETRIES} attempts for ${this.name}. Pausing 45s before resuming reconnect loop...`);
                    setTimeout(() => {
                        this.retryCount = 0;
                        reconnectCoordinator.enqueue(this, count_id, false);
                    }, 45000);
                }
            } else {
                this.retryCount = 0;
            }
        });
    
        agentProcess.on('error', (err) => {
            console.error('Agent process error:', err);
        });

        this.process = agentProcess;
    }

    stop() {
        if (!this.running) return;
        this.process.kill('SIGINT');
    }

    forceRestart() {
        if (this.running && this.process && !this.process.killed) {
            console.log(`Agent process for ${this.name} is still running. Attempting to force restart.`);
            
            const restartTimeout = setTimeout(() => {
                console.warn(`Agent ${this.name} did not stop in time. It might be stuck.`);
            }, 5000); // 5 seconds to exit

            this.process.once('exit', () => {
                 clearTimeout(restartTimeout);
                 console.log(`Stopped hanging agent ${this.name}. Now restarting.`);
                 this.start(true, 'Agent process restarted.', this.count_id);
            });
            this.stop(); // sends SIGINT
        } else {
             this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}