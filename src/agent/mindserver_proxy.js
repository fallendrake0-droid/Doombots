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
        MindServerProxy.instance = this;
    }

    async connect(name, port) {
        if (this.connected) return;
        
        this.name = name;
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
                this.agent.task.updateAvailableAgents(agents);
            }
        });

        this.socket.on('restart-agent', (agentName) => {
            console.log(`Restarting agent: ${agentName}`);
            this.agent.cleanKill();
        });
		
        this.socket.on('send-message', async (data) => {
            try {
                const from = data?.from || 'ADMIN';
                let message = data?.message || String(data);
                if (typeof message === 'string') {
                    message = message.trim().replace(/^["'`“‘]+|["'`”’]+$/g, '').trim();
                }

                // If bot is still connecting/spawning into Minecraft, wait for it to be ready
                if (!this.agent?.bot?.entity?.position || typeof this.agent?.respondFunc !== 'function') {
                    let waited = 0;
                    while ((!this.agent?.bot?.entity?.position || typeof this.agent?.respondFunc !== 'function') && waited < 10000) {
                        await new Promise(r => setTimeout(r, 400));
                        waited += 400;
                    }
                }

                if (typeof this.agent?.respondFunc === 'function') {
                    this.agent.respondFunc(from, message);
                } else if (this.agent?.bot?.entity?.position && typeof this.agent?.handleMessage === 'function') {
                    this.agent.handleMessage(from, message);
                } else {
                    console.warn(`[${this.agent?.name || 'Agent'}] Discarded message "${message}" because bot is not fully spawned yet.`);
                }
            } catch (error) {
                console.error('Error in send-message: ', error?.message || error);
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
                this.socket.emit('connect-agent-process', name);
                resolve();
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
        this._loggedIn = true;
        const name = this.name || this.agent?.name;
        if (this.socket && this.connected && name) {
            this.socket.emit('login-agent', name);
        }
    }

    shutdown() {
        this.socket.emit('shutdown');
    }

    getSocket() {
        return this.socket;
    }
}

// Create and export a singleton instance
export const serverProxy = new MindServerProxy();

// for chatting with other bots
export function sendBotChatToServer(agentName, json) {
    serverProxy.getSocket()?.emit('chat-message', agentName, json);
}

// for sending general output to server for display
export function sendOutputToServer(agentName, message) {
    serverProxy.getSocket()?.emit('bot-output', agentName, message);
}
