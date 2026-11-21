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
function formatDiagnostic(err, type = 'Exception') {
    const time = new Date().toISOString().replace('T', ' ').substring(11, 19);
    const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const code = err?.code || 'N/A';
    const msg = err?.message || String(err);
    console.error(`\n\x1b[41m\x1b[37m [DIAGNOSTIC ERROR] \x1b[0m \x1b[33m[${time}]\x1b[0m \x1b[36m[${argv.name || 'Agent'}]\x1b[0m Type: \x1b[1m${type}\x1b[0m`);
    console.error(`  \x1b[31m✖ Message:\x1b[0m ${msg}`);
    console.error(`  \x1b[34mℹ Code:\x1b[0m    ${code}  |  \x1b[34mRAM Usage:\x1b[0m ${mem}MB`);
    if (err?.stack) {
        console.error(`  \x1b[35m📍 Stack:\x1b[0m\n${err.stack.split('\n').slice(0, 5).map(l => '    ' + l).join('\n')}`);
    }
    console.error(``);
}

process.on('uncaughtException', (err) => {
    const code = err?.code || '';
    const msg = String(err?.message || err);
    if (code === 'EPIPE' || code === 'ECONNRESET' || msg.includes('write EPIPE') || msg.includes('ECONNRESET')) {
        // Socket closed by remote Minecraft server; exit cleanly so supervisor can restart on backoff
        process.exit(1);
    }
    formatDiagnostic(err, 'Uncaught Exception');
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason);
    if (msg.includes('EPIPE') || msg.includes('ECONNRESET')) {
        process.exit(1);
    }
    // Filter out known transient pathfinder and digging aborts that occur on action switches or unstuck
    const transientErrors = [
        'Digging aborted',
        'Took to long to decide path to goal',
        'Path was stopped before it could be completed',
        'No path to the goal',
        'GoalChanged',
        'The goal was changed before it could be completed',
        'Goal was changed',
        'Collect block timed out'
    ];
    if (transientErrors.some(t => msg.includes(t)) || reason?.name === 'GoalChanged' || reason?.name === 'PathStopped') {
        return;
    }
    formatDiagnostic(reason, 'Unhandled Rejection');
});

(async () => {
    try {
        console.log(`\x1b[34m[${argv.name}]\x1b[0m Connecting to MindServer...`);
        await serverProxy.connect(argv.name, argv.port);
        console.log(`\x1b[32m[${argv.name}]\x1b[0m MindServer connected. Starting agent runtime...`);
        const agent = new Agent();
        serverProxy.setAgent(agent);
        await agent.start(argv.load_memory, argv.init_message, argv.count_id);
    } catch (error) {
        formatDiagnostic(error, 'Startup Failure');
        process.exit(1);
    }
})();
