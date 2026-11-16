import { io } from 'socket.io-client';
import convoManager from './conversation.js';
import { setSettings } from './settings.js';
import { getFullState } from './library/full_state.js';

// agent's individual connection to the mindserver
// always connect to localhost

class MindServerProxy {
    constructor() {
        if (MindServerProxy.instance) {
            return MindServerProxy.instance;
        }
        
        this.socket = null;
        this.connected = false;
        this.agents = [];
        this.fleetTaskHandlers = [];
        this.fleetTaskCancelHandlers = [];
        this.fleetObservationHandlers = [];
        MindServerProxy.instance = this;
    }

    async connect(name, port, agentToken = null) {
        if (this.connected) return;
        
        this.name = name;
        this.agentToken = agentToken;
        this.socket = io(`http://localhost:${port}`);

        await new Promise((resolve, reject) => {
            this.socket.on('connect', resolve);
            this.socket.on('connect_error', (err) => {
                console.error('Connection failed:', err);
                reject(err);
            });
        });

        this.connected = true;
        console.log(name, 'connected to MindServer');

        this.socket.on('disconnect', () => {
            console.log('Disconnected from MindServer');
            this.connected = false;
            if (this.agent) {
                this.agent.cleanKill('Disconnected from MindServer. Killing agent process.');
            }
        });

        this.socket.on('chat-message', (agentName, json) => {
            convoManager.receiveFromBot(agentName, json);
        });

        this.socket.on('agents-status', (agents) => {
            this.agents = agents;
            convoManager.updateAgents(agents);
            if (this.agent?.task) {
                console.log(this.agent.name, 'updating available agents');
                this.agent.task.updateAvailableAgents(agents);
            }
        });

        this.socket.on('fleet-task', (task) => {
            for (const handler of this.fleetTaskHandlers) {
                Promise.resolve(handler(task)).catch(error => {
                    console.error('Fleet task handler failed:', error.message);
                });
            }
        });

        this.socket.on('fleet-task-cancel', (cancel) => {
            for (const handler of this.fleetTaskCancelHandlers) {
                Promise.resolve(handler(cancel)).catch(error => {
                    console.error('Fleet task cancellation handler failed:', error.message);
                });
            }
        });

        this.socket.on('fleet-observation', (observation) => {
            for (const handler of this.fleetObservationHandlers) {
                Promise.resolve(handler(observation)).catch(error => {
                    console.error('Fleet observation handler failed:', error.message);
                });
            }
        });

        this.socket.on('restart-agent', (agentName) => {
            console.log(`Restarting agent: ${agentName}`);
            this.agent.cleanKill();
        });
		
        this.socket.on('send-message', (data) => {
            try {
                this.agent.respondFunc(data.from, data.message);
            } catch (error) {
                console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            }
        });

        this.socket.on('get-full-state', (callback) => {
            try {
                const state = getFullState(this.agent);
                callback(state);
            } catch (error) {
                console.error('Error getting full state:', error);
                callback(null);
            }
        });

        // Request settings and wait for response
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Settings request timed out after 5 seconds'));
            }, 5000);

            this.socket.emit('get-settings', name, (response) => {
                clearTimeout(timeout);
                if (response.error) {
                    return reject(new Error(response.error));
                }
                setSettings(response.settings);
                this.socket.timeout(5000).emit('connect-agent-process', name, this.agentToken, (authError, authResponse) => {
                    if (authError) return reject(new Error('Agent control authentication timed out.'));
                    if (!authResponse?.ok) return reject(new Error(authResponse?.error || 'Agent control authentication failed.'));
                    resolve();
                });
            });
        });
    }

    setAgent(agent) {
        this.agent = agent;
    }

    getAgents() {
        return this.agents;
    }

    getNumOtherAgents() {
        return this.agents.length - 1;
    }

    login() {
        this.socket.emit('login-agent', this.agent.name);
    }

    shutdown() {
        this.socket.emit('shutdown');
    }

    getSocket() {
        return this.socket;
    }

    onFleetTask(handler) {
        this.fleetTaskHandlers.push(handler);
        return () => {
            const index = this.fleetTaskHandlers.indexOf(handler);
            if (index !== -1) this.fleetTaskHandlers.splice(index, 1);
        };
    }

    onFleetTaskCancel(handler) {
        this.fleetTaskCancelHandlers.push(handler);
        return () => {
            const index = this.fleetTaskCancelHandlers.indexOf(handler);
            if (index !== -1) this.fleetTaskCancelHandlers.splice(index, 1);
        };
    }

    onFleetObservation(handler) {
        this.fleetObservationHandlers.push(handler);
        return () => {
            const index = this.fleetObservationHandlers.indexOf(handler);
            if (index !== -1) this.fleetObservationHandlers.splice(index, 1);
        };
    }

    reportFleetStatus(status) {
        if (this.connected && this.socket) this.socket.emit('fleet-status', status);
    }

    requestFleetTask(task) {
        if (!this.connected || !this.socket) return Promise.reject(new Error('MindServer is unavailable.'));
        return new Promise((resolve, reject) => {
            this.socket.timeout(5000).emit('fleet-task-request', task, (error, response) => {
                if (error) return reject(new Error('Fleet coordinator timed out.'));
                if (!response?.ok) return reject(new Error(response?.error || 'Fleet task was rejected.'));
                resolve(response.task);
            });
        });
    }

    reportFleetTask(update) {
        if (this.connected && this.socket) this.socket.emit('fleet-task-status', update);
    }

    completeFleetTask(taskId, success, detail = '') {
        this.reportFleetTask({ taskId, state: success ? 'completed' : 'failed', detail, retryable: !success });
    }

    publishFleetObservation(observation) {
        if (!this.connected || !this.socket) return Promise.reject(new Error('MindServer is unavailable.'));
        return new Promise((resolve, reject) => {
            this.socket.timeout(5000).emit('fleet-observation-publish', observation, (error, response) => {
                if (error) return reject(new Error('Fleet observation request timed out.'));
                if (!response?.ok) return reject(new Error(response?.error || 'Fleet observation was rejected.'));
                resolve(response.observation);
            });
        });
    }

    requestOllama(request) {
        if (!this.connected || !this.socket) return Promise.reject(new Error('MindServer is unavailable for Ollama.'));
        const timeout = Math.min(125000, Math.max(1000, Number(request.timeoutMs || 45000) + 5000));
        return new Promise((resolve, reject) => {
            this.socket.timeout(timeout).emit('ollama-request', request, (error, response) => {
                if (error) return reject(new Error('Ollama gateway timed out.'));
                if (!response?.ok) {
                    const err = new Error(response?.error || 'Ollama gateway request failed.');
                    err.code = response?.code;
                    return reject(err);
                }
                resolve(response.data);
            });
        });
    }
}

// Create and export a singleton instance
export const serverProxy = new MindServerProxy();

// for chatting with other bots
export function sendBotChatToServer(agentName, json) {
    serverProxy.getSocket().emit('chat-message', agentName, json);
}

// for sending general output to server for display
export function sendOutputToServer(agentName, message) {
    serverProxy.getSocket().emit('bot-output', agentName, message);
}
