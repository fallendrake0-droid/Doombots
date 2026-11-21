import { 
    getPosition,
    getBiomeName,
    getNearbyPlayerNames,
    getInventoryCounts,
    getNearbyEntityTypes,
    getBlockAtPosition,
    getFirstBlockAboveHead
} from "./world.js";
import convoManager from '../conversation.js';
import settings from '../settings.js';

export function getFullState(agent) {
    const bot = agent.bot;

    const pos = getPosition(bot) || { x: 0, y: 0, z: 0 };
    const position = {
        x: Number((pos.x || 0).toFixed(2)),
        y: Number((pos.y || 0).toFixed(2)),
        z: Number((pos.z || 0).toFixed(2))
    };

    let weather = 'Clear';
    if (bot.thunderState && bot.thunderState > 0) weather = 'Thunderstorm';
    else if (bot.rainState && bot.rainState > 0) weather = 'Rain';

    let timeLabel = 'Day';
    if (bot.time?.timeOfDay !== undefined) {
        if (bot.time.timeOfDay < 6000) timeLabel = 'Morning';
        else if (bot.time.timeOfDay < 12000) timeLabel = 'Afternoon';
        else timeLabel = 'Night';
    }

    const below = getBlockAtPosition(bot, 0, -1, 0)?.name || 'air';
    const legs = getBlockAtPosition(bot, 0, 0, 0)?.name || 'air';
    const head = getBlockAtPosition(bot, 0, 1, 0)?.name || 'air';

    let players = getNearbyPlayerNames(bot);
    let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
    players = players.filter(p => !bots.includes(p));

    const allServerPlayers = [];
    if (bot.players) {
        for (const [uname, pData] of Object.entries(bot.players)) {
            if (bots.includes(uname) || uname === agent.name) continue;
            let dist = null;
            let inRange = false;
            if (pData?.entity?.position && pos) {
                dist = Math.round(pos.distanceTo(pData.entity.position));
                inRange = true;
            }
            allServerPlayers.push({
                username: uname,
                ping: pData?.ping || 0,
                gamemode: pData?.gamemode || 0,
                distance: dist,
                inView: inRange,
                isAlly: uname.toLowerCase() === 'orbryx' || (settings.allies || []).map(a => a.toLowerCase()).includes(uname.toLowerCase())
            });
        }
    }

    const helmet = bot.inventory.slots[5];
    const chestplate = bot.inventory.slots[6];
    const leggings = bot.inventory.slots[7];
    const boots = bot.inventory.slots[8];

    // Richer activity than a bare "Idle": a bot counts as idle (no action executing) even while
    // chatting, deciding its next move, or stopped. Surface those so the dashboard is meaningful.
    let activity;
    if (!agent.isIdle()) {
        activity = { current: agent.actions.currentActionLabel || 'Acting', kind: 'acting' };
    } else if (convoManager.inConversation()) {
        const who = convoManager.activeConversation?.name;
        activity = { current: who ? `Chatting with ${who}` : 'Chatting', kind: 'chatting' };
    } else if (agent.self_prompter.isStopped()) {
        activity = { current: 'Stopped', kind: 'stopped' };   // self-prompter OFF: won't act on its own
    } else if (agent.self_prompter.isPaused()) {
        activity = { current: 'Chatting', kind: 'chatting' };
    } else if (agent.self_prompter.isActive()) {
        activity = { current: 'Thinking', kind: 'thinking' }; // self-prompting between actions
    } else {
        activity = { current: 'Idle', kind: 'idle' };
    }

    const state = {
        name: agent.name,
        gameplay: {
            position,
            dimension: bot.game?.dimension || 'overworld',
            gamemode: bot.game?.gameMode || 'survival',
            health: Math.round(bot.health || 20),
            hunger: Math.round(bot.food || 20),
            biome: getBiomeName(bot),
            weather,
            timeOfDay: bot.time?.timeOfDay || 0,
            timeLabel
        },
        action: {
            current: activity.current,
            kind: activity.kind,
            isIdle: agent.isIdle()
        },
        surroundings: {
            below,
            legs,
            head,
            firstBlockAboveHead: getFirstBlockAboveHead(bot, null, 32)
        },
        inventory: {
            counts: getInventoryCounts(bot),
            stacksUsed: bot.inventory?.items ? bot.inventory.items().length : 0,
            totalSlots: bot.inventory?.slots ? bot.inventory.slots.length : 36,
            items: bot.inventory?.items ? bot.inventory.items().map(it => ({
                name: it.name,
                count: it.count,
                slot: it.slot,
                displayName: it.displayName || it.name.replace(/_/g, ' ')
            })) : [],
            equipment: {
                helmet: helmet ? helmet.name : null,
                chestplate: chestplate ? chestplate.name : null,
                leggings: leggings ? leggings.name : null,
                boots: boots ? boots.name : null,
                mainHand: bot.heldItem ? bot.heldItem.name : null
            }
        },
        nearby: {
            humanPlayers: players,
            allServerPlayers: allServerPlayers,
            botPlayers: bots,
            entityTypes: getNearbyEntityTypes(bot).filter(t => t !== 'player' && t !== 'item'),
        },
        modes: {
            summary: bot.modes?.getMiniDocs ? bot.modes.getMiniDocs() : ''
        }
    };

    return state;
}