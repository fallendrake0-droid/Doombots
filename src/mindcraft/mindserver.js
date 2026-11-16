import { Server } from 'socket.io';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mindcraft from './mindcraft.js';
import { readFileSync } from 'fs';
import { FleetCoordinator } from './fleet_coordinator.js';
import { OllamaGateway } from './ollama_gateway.js';
import { RuntimeMetrics } from './runtime_metrics.js';
import { validateDoomBotsSettings } from './model_policy.js';
import { validateConnectionSettings } from './connection_policy.js';
import { createControlToken, validControlToken } from './control_auth.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mindserver is:
// - central hub for communication between all agent processes
// - api to control from other languages and remote users 
// - host for webapp

let io;
let server;
const agent_connections = {};
const agent_listeners = [];
const fleetCoordinator = new FleetCoordinator();
const ollamaGateway = new OllamaGateway();
const runtimeMetrics = new RuntimeMetrics();

const settings_spec = JSON.parse(readFileSync(path.join(__dirname, 'public/settings_spec.json'), 'utf8'));

function runtimeMetricSources(fleet = fleetCoordinator.snapshot()) {
    const connections = Object.entries(agent_connections);
    const lifecycle = {};
    const reconnecting = [];
    for (const [name, connection] of connections) {
        lifecycle[connection.lifecycle] = (lifecycle[connection.lifecycle] || 0) + 1;
        if (connection.reconnect_attempt > 0) reconnecting.push({ name, attempt: connection.reconnect_attempt, lifecycle: connection.lifecycle });
    }
    const pathfinding = fleet.bots.map(bot => ({ name: bot.name, ...(bot.pathfinding || { moving: false, mining: false, building: false }) }));
    return {
        bots: {
            registered: connections.length,
            inGame: connections.filter(([, connection]) => connection.in_game).length,
            connectedSockets: connections.filter(([, connection]) => !!connection.socket).length,
            lifecycle
        },
        tasks: fleet.metrics,
        aiQueue: ollamaGateway.snapshot(),
        pathfinding,
        reconnection: { reconnecting }
    };
}

function getRuntimeMetrics(force = false) {
    const fleet = fleetCoordinator.snapshot();
    return runtimeMetrics.collect(runtimeMetricSources(fleet), force);
}

function emitFleetState(forceMetrics = false) {
    if (!io) return;
    io.emit('fleet-status', fleetCoordinator.snapshot());
    io.emit('runtime-metrics', getRuntimeMetrics(forceMetrics));
}

class AgentConnection {
    constructor(settings, viewer_port) {
        this.socket = null;
        // Per-process credential stays out of dashboard-visible settings and
        // prevents an arbitrary local Socket.IO client from replacing a bot's
        // control channel by merely knowing its public Minecraft name.
        this.controlToken = createControlToken();
        this.settings = settings;
        this.in_game = false;
        this.full_state = null;
        this.viewer_port = viewer_port;
        this.lifecycle = 'connecting';
        this.reconnect_attempt = 0;
    }
    setSettings(settings) {
        this.settings = settings;
    }
}

export function registerAgent(settings, viewer_port) {
    // All five profiles receive the same parent coordinator settings. Applying
    // them here also covers dashboard-created agents without opening a second
    // unbounded coordinator or metrics stream.
    fleetCoordinator.configure(settings.fleet || {});
    runtimeMetrics.configure(settings.metrics || {});
    const agentConnection = new AgentConnection(settings, viewer_port);
    agent_connections[settings.profile.name] = agentConnection;
    return agentConnection;
}

export function logoutAgent(agentName) {
    if (agent_connections[agentName]) {
        agent_connections[agentName].in_game = false;
        fleetCoordinator.markAgentUnavailable(agentName, 'Agent process exited.', agent_connections);
        agentsStatusUpdate();
        emitFleetState();
    }
}

export function setAgentLifecycle(agentName, lifecycle, reconnectAttempt = 0) {
    const connection = agent_connections[agentName];
    if (!connection) return;
    connection.lifecycle = lifecycle;
    connection.reconnect_attempt = reconnectAttempt;
    agentsStatusUpdate();
    emitFleetState();
}

// Initialize the server
export function createMindServer(host_public = false, port = 8080) {
    const app = express();
    server = http.createServer(app);
    io = new Server(server);

    // Serve static files
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    app.use(express.static(path.join(__dirname, 'public')));

    // Texture proxy: resolve item/block textures using minecraft-assets with version fallback
    app.get('/assets/item/:agent/:name.png', async (req, res) => {
        try {
            const agentName = req.params.agent;
            const rawName = req.params.name;
            const itemName = String(rawName).toLowerCase();
            const conn = agent_connections[agentName];
            const preferred = conn?.settings?.minecraft_version;
            const candidates = [];
            if (preferred && preferred !== 'auto') candidates.push(preferred);
            candidates.push('1.21.8');

            // Lazy import to avoid ESM/CJS conflicts
            const mod = await import('minecraft-assets');
            const mcAssetsFactory = mod.default || mod;

            for (const ver of candidates) {
                try {
                    const assets = mcAssetsFactory(ver);
                    // Prefer items path first, then blocks
                    const item = assets.items[itemName];
                    const block = assets.blocks[itemName];
                    const tex = assets.textureContent?.[itemName]?.texture
                        || (item ? assets.textureContent?.[itemName]?.texture : null)
                        || (block ? assets.textureContent?.[itemName]?.texture : null);
                    if (tex) {
                        // textureContent already provides a data URL in many versions
                        if (tex.startsWith('data:image')) {
                            const base64 = tex.split(',')[1];
                            const img = globalThis.Buffer.from(base64, 'base64');
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(img);
                        }
                    }
                    // If textureContent missing, try static path resolution inside package
                    // Helps with some strange blocks like Leaf Litter
                    const guessPaths = [];
                    const base = assets.directory;
                    guessPaths.push(path.join(base, 'items', `${itemName}.png`));
                    guessPaths.push(path.join(base, 'blocks', `${itemName}.png`));
                    for (const p of guessPaths) {
                        try {
                            const fsMod = await import('fs');
                            const buf = fsMod.readFileSync(p);
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(buf);
                        } catch { /* ignore */ }
                    }
                } catch { /* ignore */ }
            }
            // Not found, fallback svg
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(404).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">?</text></svg>');
        } catch (e) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(500).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">!</text></svg>');
        }
    });

    // Socket.io connection handling
    io.on('connection', (socket) => {
        let curAgentName = null;
        console.log('Client connected');

        agentsStatusUpdate(socket);

        socket.on('create-agent', async (settings, callback) => {
            console.log('API create agent...');
            for (let key in settings_spec) {
                if (!(key in settings)) {
                    if (settings_spec[key].required) {
                        callback({ success: false, error: `Setting ${key} is required` });
                        return;
                    }
                    else {
                        settings[key] = settings_spec[key].default;
                    }
                }
            }
            for (let key in settings) {
                if (!(key in settings_spec)) {
                    delete settings[key];
                }
            }
            if (settings.profile?.name) {
                if (settings.profile.name in agent_connections) {
                    callback({ success: false, error: 'Agent already exists' });
                    return;
                }
                let returned = await mindcraft.createAgent(settings);
                callback({ success: returned.success, error: returned.error });
                let name = settings.profile.name;
                if (!returned.success && agent_connections[name]) {
                    mindcraft.destroyAgent(name);
                    delete agent_connections[name];
                }
                agentsStatusUpdate();
            }
            else {
                console.error('Agent name is required in profile');
                callback({ success: false, error: 'Agent name is required in profile' });
            }
        });

        socket.on('get-settings', (agentName, callback) => {
            if (agent_connections[agentName]) {
                callback({ settings: agent_connections[agentName].settings });
            } else {
                callback({ error: `Agent '${agentName}' not found.` });
            }
        });

        socket.on('connect-agent-process', (agentName, token, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};
            const agent = agent_connections[agentName];
            if (!agent || !validControlToken(agent.controlToken, token)) {
                console.warn(`[mindserver:agent-auth] rejected process connection for ${String(agentName || 'unknown').slice(0, 64)}.`);
                respond({ ok: false, error: 'Agent control authentication failed.' });
                return;
            }
            agent.socket = socket;
            curAgentName = agentName;
            agentsStatusUpdate();
            respond({ ok: true });
        });

        socket.on('login-agent', (agentName) => {
            const agent = agent_connections[agentName];
            if (agent && curAgentName === agentName && agent.socket === socket) {
                agent.in_game = true;
                agentsStatusUpdate();
                emitFleetState();
            }
            else {
                console.warn(`[mindserver:agent-auth] rejected login for ${String(agentName || 'unknown').slice(0, 64)}.`);
            }
        });

        socket.on('disconnect', () => {
            const agent = agent_connections[curAgentName];
            // A superseded socket must not clear the channel or availability of
            // the worker that successfully reconnected after it.
            if (agent?.socket === socket) {
                console.log(`Agent ${curAgentName} disconnected`);
                ollamaGateway.cancelAgent(curAgentName);
                // Mark unavailable before pumping a retry, otherwise the just
                // disconnected socket can receive its own recovered task.
                agent.in_game = false;
                agent.socket = null;
                fleetCoordinator.markAgentUnavailable(curAgentName, 'Agent control socket disconnected.', agent_connections);
                agentsStatusUpdate();
                emitFleetState();
            }
            if (agent_listeners.includes(socket)) {
                removeListener(socket);
            }
        });

        socket.on('chat-message', (agentName, json) => {
            const recipient = agent_connections[agentName];
            if (!curAgentName || !recipient?.socket) {
                console.warn(`[mindserver:chat] rejected sender=${curAgentName || 'unknown'} recipient=${agentName}: recipient is unavailable.`);
                return;
            }
            const message = typeof json?.message === 'string' ? json.message.slice(0, 2000) : '';
            if (!message) return;
            console.log(`${curAgentName} sending message to ${agentName}: ${message}`);
            recipient.socket.emit('chat-message', curAgentName, { ...json, message });
        });

        socket.on('set-agent-settings', (agentName, settings, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};
            const agent = agent_connections[agentName];
            if (!agent) return respond({ ok: false, error: `Unknown agent ${agentName}.` });
            const policy = validateDoomBotsSettings(settings);
            if (!policy.ok) return respond({ ok: false, error: policy.error });
            const connectionPolicy = validateConnectionSettings(settings);
            if (!connectionPolicy.ok) return respond({ ok: false, error: connectionPolicy.error });
            agent.setSettings(settings);
            fleetCoordinator.configure(settings.fleet || {});
            runtimeMetrics.configure(settings.metrics || {});
            if (agent.socket) agent.socket.emit('restart-agent');
            respond({ ok: true });
            emitFleetState(true);
        });

        socket.on('restart-agent', (agentName) => {
            const agent = agent_connections[agentName];
            if (!agent?.socket) return console.warn(`Cannot restart ${agentName}: control socket is unavailable.`);
            console.log(`Restarting agent: ${agentName}`);
            agent.socket.emit('restart-agent');
        });

        socket.on('stop-agent', (agentName) => {
            mindcraft.stopAgent(agentName);
        });

        socket.on('start-agent', (agentName) => {
            mindcraft.startAgent(agentName);
        });

        socket.on('destroy-agent', (agentName) => {
            if (agent_connections[agentName]) {
                mindcraft.destroyAgent(agentName);
                delete agent_connections[agentName];
            }
            agentsStatusUpdate();
        });

        socket.on('stop-all-agents', () => {
            console.log('Killing all agents');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
        });

        socket.on('shutdown', () => {
            console.log('Shutting down');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
            // wait 2 seconds
            setTimeout(() => {
                console.log('Exiting MindServer');
                globalThis.process.exit(0);
            }, 2000);
            
        });

		socket.on('send-message', (agentName, data) => {
			if (!agent_connections[agentName]) {
				console.warn(`Agent ${agentName} not in game, cannot send message via MindServer.`);
                return;
			}
			try {
                agent_connections[agentName].socket.emit('send-message', data);
			} catch (error) {
				console.error('Error: ', error);
			}
		});

        socket.on('bot-output', (agentName, message) => {
            io.emit('bot-output', agentName, message);
        });

        socket.on('fleet-status', (status) => {
            if (!curAgentName || !agent_connections[curAgentName]) return;
            fleetCoordinator.updateStatus(curAgentName, status, agent_connections);
            emitFleetState();
        });

        socket.on('fleet-task-request', (request, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};
            if (!curAgentName || !agent_connections[curAgentName]) {
                respond({ ok: false, error: 'Only a registered agent can request a fleet task.' });
                return;
            }
            const response = fleetCoordinator.assign({ ...request, requestedBy: curAgentName }, agent_connections);
            respond(response);
            emitFleetState();
        });

        socket.on('fleet-task-status', (update = {}, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};
            if (!curAgentName) {
                respond({ ok: false, error: 'Only a registered agent can update a fleet task.' });
                return;
            }
            const response = fleetCoordinator.report(
                curAgentName,
                update.taskId,
                update.state,
                update.detail,
                { retryable: update.retryable !== false },
                agent_connections
            );
            respond(response);
            emitFleetState();
        });

        // Backward-compatible completion event for older dashboard clients.
        socket.on('fleet-task-complete', ({ taskId, success, detail } = {}) => {
            if (!curAgentName) return;
            fleetCoordinator.complete(curAgentName, taskId, success === true, detail, agent_connections);
            emitFleetState();
        });

        socket.on('fleet-observation-publish', (observation, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};
            if (!curAgentName || !agent_connections[curAgentName]) {
                respond({ ok: false, error: 'Only a registered agent can publish observations.' });
                return;
            }
            const response = fleetCoordinator.publishObservation(curAgentName, observation, agent_connections);
            if (response.ok) {
                for (const recipient of fleetCoordinator.observationRecipients(response.observation, agent_connections)) {
                    agent_connections[recipient].socket.emit('fleet-observation', response.observation);
                }
            }
            respond(response);
            emitFleetState();
        });

        socket.on('get-fleet-state', callback => {
            if (typeof callback === 'function') callback(fleetCoordinator.snapshot());
        });
        socket.on('get-ollama-metrics', callback => {
            if (typeof callback === 'function') callback(ollamaGateway.snapshot());
        });
        socket.on('get-runtime-metrics', callback => {
            if (typeof callback === 'function') callback(getRuntimeMetrics(true));
        });

        socket.on('ollama-request', async (request, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};
            if (!curAgentName || request?.agentName !== curAgentName) {
                respond({ ok: false, error: 'Unregistered Ollama request.', code: 'OLLAMA_UNREGISTERED' });
                return;
            }
            try {
                const data = await ollamaGateway.enqueue(request);
                respond({ ok: true, data });
            } catch (error) {
                console.warn(`[ollama-gateway:${curAgentName}] ${error.message}`);
                respond({ ok: false, error: error.message, code: error.code || 'OLLAMA_GATEWAY_ERROR' });
            } finally {
                io.emit('ollama-metrics', ollamaGateway.snapshot());
                io.emit('runtime-metrics', getRuntimeMetrics());
            }
        });

        socket.on('listen-to-agents', () => {
            addListener(socket);
        });
    });

    if (host_public) {
        console.log('Public hosting not supported yet. Using localhost.');
    }
    const host = 'localhost';
    server.listen(port, host, () => {
        console.log(`MindServer running on port ${port} on host ${host}`);
    });

    return server;
}

function agentsStatusUpdate(socket) {
    if (!socket) {
        socket = io;
    }
    let agents = [];
    for (let agentName in agent_connections) {
        const conn = agent_connections[agentName];
        agents.push({
            name: agentName, 
            in_game: conn.in_game,
            viewerPort: conn.viewer_port,
            socket_connected: !!conn.socket,
            lifecycle: conn.lifecycle,
            reconnect_attempt: conn.reconnect_attempt
        });
    };
    socket.emit('agents-status', agents);
}


let listenerInterval = null;
let statePollInFlight = false;
const STATE_REQUEST_TIMEOUT_MS = 3000;
const STATE_POLL_INTERVAL_MS = Math.max(1000, Math.min(10000, Number(process.env.DOOMBOTS_STATE_POLL_MS || 2000)));

function requestAgentState(agentName, agent) {
    if (!agent?.socket) return Promise.resolve([agentName, { error: 'Agent socket is unavailable.' }]);
    return new Promise(resolve => {
        let settled = false;
        const finish = state => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve([agentName, state]);
        };
        const timeout = setTimeout(() => finish({ error: `State request timed out after ${STATE_REQUEST_TIMEOUT_MS}ms.` }), STATE_REQUEST_TIMEOUT_MS);
        try {
            agent.socket.emit('get-full-state', state => finish(state || { error: 'Agent returned no state.' }));
        } catch (error) {
            finish({ error: `State request failed: ${error.message}` });
        }
    });
}

async function broadcastStates() {
    if (statePollInFlight) return;
    statePollInFlight = true;
    try {
        const entries = Object.entries(agent_connections).filter(([, agent]) => agent.in_game);
        const results = await Promise.all(entries.map(([agentName, agent]) => requestAgentState(agentName, agent)));
        const states = Object.fromEntries(results);
        for (const listener of [...agent_listeners]) listener.emit('state-update', states);
    } finally {
        statePollInFlight = false;
    }
}

function addListener(listener_socket) {
    if (!agent_listeners.includes(listener_socket)) agent_listeners.push(listener_socket);
    if (agent_listeners.length === 1) {
        listenerInterval = setInterval(() => {
            void broadcastStates();
        }, STATE_POLL_INTERVAL_MS);
        void broadcastStates();
    }
}

function removeListener(listener_socket) {
    const index = agent_listeners.indexOf(listener_socket);
    if (index !== -1) agent_listeners.splice(index, 1);
    if (agent_listeners.length === 0 && listenerInterval) {
        clearInterval(listenerInterval);
        listenerInterval = null;
    }
}

// Optional: export these if you need access to them from other files
export const getIO = () => io;
export const getServer = () => server;
export const numStateListeners = () => agent_listeners.length;
export const getFleetSnapshot = () => fleetCoordinator.snapshot();
export const getOllamaMetrics = () => ollamaGateway.snapshot();
export const getRuntimeMetricsSnapshot = () => getRuntimeMetrics(true);