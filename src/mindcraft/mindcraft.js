import { createMindServer, registerAgent, numStateListeners, setAgentLifecycle, logoutAgent } from './mindserver.js';
import { AgentProcess } from '../process/agent_process.js';
import { getServer } from './mcserver.js';
import open from 'open';
import { validateDoomBotsSettings } from './model_policy.js';
import { validateConnectionSettings } from './connection_policy.js';

let mindserver;
let connected = false;
let agent_processes = {};
let agent_count = 0;
let mindserver_port = 8080;

export async function init(host_public=false, port=8080, auto_open_ui=true) {
    if (connected) {
        console.error('Already initiliazed!');
        return;
    }
    mindserver = createMindServer(host_public, port);
    mindserver_port = port;
    connected = true;
    if (auto_open_ui) {
        setTimeout(() => {
            // check if browser listener is already open
            if (numStateListeners() === 0) {
                open('http://localhost:'+port);
            }
        }, 3000);
    }
}

export async function createAgent(settings) {
    const modelPolicy = validateDoomBotsSettings(settings);
    if (!modelPolicy.ok) {
        console.error(modelPolicy.error);
        return { success: false, error: modelPolicy.error };
    }
    if (!settings.profile.name) {
        console.error('Agent name is required in profile');
        return {
            success: false,
            error: 'Agent name is required in profile'
        };
    }
    const connectionPolicy = validateConnectionSettings(settings);
    if (!connectionPolicy.ok) {
        console.error(`[createAgent:${settings.profile.name}] ${connectionPolicy.error}`);
        return { success: false, error: connectionPolicy.error };
    }
    settings = JSON.parse(JSON.stringify(settings));
    settings.port = Number(settings.port);
    let agent_name = settings.profile.name;
    const agentIndex = agent_count++;
    const viewer_port = 3000 + agentIndex;
    const agentConnection = registerAgent(settings, viewer_port);
    let load_memory = settings.load_memory || false;
    let init_message = settings.init_message || null;

    try {
        try {
            const server = await getServer(settings.host, settings.port, settings.minecraft_version);
            settings.host = server.host;
            settings.port = server.port;
            settings.minecraft_version = server.version;
        } catch (error) {
            const message = error?.message || String(error);
            // A failed ping can be transient, but an explicit protocol/version
            // rejection is deterministic and should not launch a child that is
            // guaranteed to fail again.
            if (/unsupported|version is incorrect/i.test(message)) {
                throw new Error(`[createAgent:${agent_name}] Minecraft preflight rejected: ${message}`);
            }
            if (settings.minecraft_version === 'auto') settings.minecraft_version = null;
            console.warn(`[createAgent:${agent_name}] preflight unavailable for ${settings.host}:${settings.port}; connecting with Mineflayer negotiation instead: ${message}`);
        }

        const agentProcess = new AgentProcess(
            agent_name,
            mindserver_port,
            settings.reconnect,
            (lifecycle, attempt) => setAgentLifecycle(agent_name, lifecycle, attempt),
            { logoutAgent, agentToken: agentConnection.controlToken }
        );
        agentProcess.start(load_memory, init_message, agentIndex);
        agent_processes[settings.profile.name] = agentProcess;
    } catch (error) {
        console.error(`Error creating agent ${agent_name}:`, error);
        destroyAgent(agent_name);
        return {
            success: false,
            error: error.message
        };
    }
    return {
        success: true,
        error: null
    };
}

export function getAgentProcess(agentName) {
    return agent_processes[agentName];
}

export function startAgent(agentName) {
    if (agent_processes[agentName]) {
        agent_processes[agentName].forceRestart();
    }
    else {
        console.error(`Cannot start agent ${agentName}; not found`);
    }
}

export function stopAgent(agentName) {
    if (agent_processes[agentName]) {
        agent_processes[agentName].stop();
    }
}

export function destroyAgent(agentName) {
    if (agent_processes[agentName]) {
        agent_processes[agentName].stop();
        delete agent_processes[agentName];
    }
}

export function shutdown() {
    console.log('Shutting down');
    for (let agentName in agent_processes) {
        agent_processes[agentName].stop();
    }
    setTimeout(() => {
        process.exit(0);
    }, 2000);
}
