import '../utils/version_patch.js';
import { Agent } from '../agent/agent.js';
import { serverProxy } from '../agent/mindserver_proxy.js';
import yargs from 'yargs';

const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node init_agent.js -n <agent_name> -p <port> -l <load_memory> -m <init_message> -c <count_id>');
    process.exit(1);
}

const argv = yargs(args)
    .option('name', {
        alias: 'n',
        type: 'string',
        description: 'name of agent'
    })
    .option('load_memory', {
        alias: 'l',
        type: 'boolean',
        description: 'load agent memory from file on startup'
    })
    .option('init_message', {
        alias: 'm',
        type: 'string',
        description: 'automatically prompt the agent on startup'
    })
    .option('count_id', {
        alias: 'c',
        type: 'number',
        default: 0,
        description: 'identifying count for multi-agent scenarios',
    })
    .option('port', {
        alias: 'p',
        type: 'number',
        description: 'port of mindserver'
    })
    .argv;

// Guard against unhandled socket write EPIPE or ECONNRESET when Minecraft server closes connection
process.on('uncaughtException', (err) => {
    const code = err?.code || '';
    const msg = String(err?.message || err);
    if (code === 'EPIPE' || code === 'ECONNRESET' || msg.includes('write EPIPE') || msg.includes('ECONNRESET')) {
        // Socket closed by remote Minecraft server; exit cleanly so supervisor can restart on backoff
        process.exit(1);
    }
    console.error('Unhandled agent exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason);
    if (msg.includes('EPIPE') || msg.includes('ECONNRESET')) {
        process.exit(1);
    }
    console.error('Unhandled rejection:', reason);
});

(async () => {
    try {
        console.log('Connecting to MindServer');
        await serverProxy.connect(argv.name, argv.port);
        console.log('Starting agent');
        const agent = new Agent();
        serverProxy.setAgent(agent);
        await agent.start(argv.load_memory, argv.init_message, argv.count_id);
    } catch (error) {
        console.error('Failed to start agent process:');
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
