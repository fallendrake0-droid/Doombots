import '../utils/version_patch.js';
import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import * as skills from './library/skills.js';

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);
        
        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }
        
        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        try {
            this.bot = initBot(this.name);
        } catch (err) {
            const errStr = String(err?.message || err);
            if (errStr.includes('Do not have data') || errStr.includes('1.21.11') || errStr.includes('missing-data')) {
                log(this.name, `[LoginGuard] Handled Minecraft 1.21.11 protocol alias without missing-data error (bridging to Java 1.21.4 for ViaVersion/ViaBackwards/Geyser)...`);
                settings.minecraft_version = '1.21.4';
                this.bot = initBot(this.name);
            } else {
                throw err;
            }
        }
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { type, msg } = handleDisconnection(this.name, reason);
            try { this.history.save(); } catch {}
            const exitCode = (type === 'throttled' || String(reason).toLowerCase().includes('throttled')) ? 4 : 1;
            setTimeout(() => process.exit(exitCode), 500);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            const errStr = String(err?.message || err);
            if (errStr.includes('EPIPE') || errStr.includes('ECONNRESET')) {
                // Remote socket was closed; handled gracefully without crash
                return;
            }
            if (errStr.includes('Do not have data') || errStr.includes('1.21.11') || errStr.includes('missing-data')) {
                log(this.name, `[LoginGuard] Handled Minecraft 1.21.11 version mismatch without missing-data error. Reconnecting with compatible Java protocol 1.21.4 for ViaVersion/ViaBackwards/Geyser...`);
                settings.minecraft_version = '1.21.4';
                return;
            }
            if (
                errStr.includes('Duplicate') || 
                errStr.includes('ECONNREFUSED') || 
                errStr.includes('ENOTFOUND') || 
                errStr.includes('ETIMEDOUT') || 
                errStr.includes('EHOSTUNREACH') || 
                errStr.includes('EADDRNOTAVAIL')
            ) {
                 onDisconnect('Error', err);
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${errStr}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in! Establishing session...');
            serverProxy.login();
        });

        // Auto-authenticate on servers running AuthMe, nLogin, or LoginSecurity
        const handleAuthPrompt = (raw) => {
            if (!raw) return;
            const msg = typeof raw === 'string' ? raw : (raw.toString ? raw.toString() : JSON.stringify(raw));
            const lower = msg.toLowerCase();
            if (
                lower.includes('/register') || 
                lower.includes('/login') || 
                lower.includes('register <password>') || 
                lower.includes('login <password>') || 
                lower.includes('use /register') || 
                lower.includes('use /login') ||
                lower.includes('/reg ') ||
                lower.includes('/l ') ||
                lower.includes('please register') ||
                lower.includes('please login')
            ) {
                const pass = settings.server_password || 'DoombotPass123';
                if (lower.includes('register') || lower.includes('/reg ') || lower.includes('please register')) {
                    console.log(`[LoginGuard] Server requested registration. Auto-registering...`);
                    setTimeout(() => {
                        try { this.bot.chat(`/register ${pass} ${pass}`); } catch {}
                    }, 250);
                } else if (lower.includes('login') || lower.includes('/l ') || lower.includes('please login')) {
                    console.log(`[LoginGuard] Server requested login. Auto-authenticating...`);
                    setTimeout(() => {
                        try { this.bot.chat(`/login ${pass}`); } catch {}
                    }, 250);
                }
            }
        };

        this.bot.on('messagestr', handleAuthPrompt);
        this.bot.on('title', handleAuthPrompt);
        this.bot.on('actionBar', handleAuthPrompt);
        this.bot._client.on('systemChat', (packet) => {
            try { handleAuthPrompt(packet?.formattedMessage || packet?.message); } catch {}
        });
        this.bot._client.on('playerChat', (packet) => {
            try { handleAuthPrompt(packet?.formattedMessage || packet?.message); } catch {}
        });

		const spawnTimeoutDuration = settings.spawn_timeout || 90;
        const spawnTimeout = setTimeout(() => {
            const msg = `[LoginGuard] Bot has not spawned after ${spawnTimeoutDuration} seconds. (Server may be loading chunks or generating terrain).`;
            log(this.name, msg);
            try { this.history.save(); } catch {}
            setTimeout(() => process.exit(1), 500);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                serverProxy.login();

                // Set skin for profile after spawning (requires Fabric Tailor on server)
                try {
                    if (this.prompter.profile.skin)
                        this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
                } catch {}

                await addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                console.log(`${this.name} spawned.`);
                this.clearBotLogs();
              
                this._setupEventHandlers(save_data, init_message);
                this.startEvents();
              
                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                // Anti-Idle Keepalive: Periodically sends subtle micro-look packet to prevent Aternos "you have been idle for too long!" kick
                if (this._antiIdleTimer) clearInterval(this._antiIdleTimer);
                this._antiIdleTimer = setInterval(() => {
                    if (this.bot?.entity && !this.bot.interrupt_code) {
                        try {
                            const curYaw = this.bot.entity.yaw || 0;
                            const curPitch = this.bot.entity.pitch || 0;
                            this.bot.look(curYaw + (Math.random() * 0.002 - 0.001), curPitch, true).catch(() => {});
                        } catch {}
                    }
                }, 25000);

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (error) {
                console.error('Error in spawn event:', error);
                process.exit(0);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

		this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);
        
        this.bot.on('chat', (username, message) => {
            // Never respond to messages originating from other bots to avoid infinite chat loops
            if (convoManager.isOtherAgent(username) || username === this.name) return;

            // Filter out automated server plugins and system announcements (SimpleTpa, Server, Console, etc.) to prevent LLM rate limits
            const uLower = String(username || '').toLowerCase();
            const automatedSenders = ['simpletpa', 'server', 'console', 'announcer', 'broadcast', 'automessage', 'system'];
            if (automatedSenders.includes(uLower)) {
                return;
            }

            // Check if message is specifically directed to another bot (e.g. "Doombot2: mine wood")
            const rawAgents = serverProxy.getAgents() || [];
            const otherBotNames = rawAgents
                .map(a => (typeof a === 'string' ? a : a?.name))
                .filter(Boolean)
                .filter(n => n !== this.name);
            const isForAnotherBot = otherBotNames.some(botName => {
                const lower = String(message || '').toLowerCase().trim();
                const target = String(botName).toLowerCase();
                return lower.startsWith(target + ':') || lower.startsWith(target + ',');
            });
            if (isForAnotherBot) return;

            // Strip own bot name prefix if present (e.g. "Doombot: mine logs" -> "mine logs")
            let cleanMsg = message.trim();
            const ownPrefixRegex = new RegExp(`^${this.name}[:,-]?\\s*`, 'i');
            cleanMsg = cleanMsg.replace(ownPrefixRegex, '');
            // Strip squad prefixes ("all:", "bots:", "squad:") so one chat commands all bots
            cleanMsg = cleanMsg.replace(/^(all|bots|squad)[:,-]?\s*/i, '');

            respondFunc(username, cleanMsg);
        });

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 16, // Start eating earlier so bot never starves or loses sprinting ability
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish"],
            useOffhand: true,
            checkOnItemPickup: true
        };
        try { this.bot.autoEat.enable(); } catch {}

        // Auto equip best armor & shield immediately on spawn
        setTimeout(async () => {
            try { await skills.autoEquipBest(this.bot); } catch {}
        }, 1200);

        // Auto equip best armor whenever inventory slots update
        let equipTimeout = null;
        this.bot.inventory?.on('updateSlot', () => {
            if (equipTimeout) clearTimeout(equipTimeout);
            equipTimeout = setTimeout(async () => {
                try {
                    if (this.bot?.entity?.position && !this.actions.executing) {
                        await skills.autoEquipBest(this.bot);
                    }
                } catch {}
            }, 1000);
        });

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message && !settings.minimize_tokens && !settings.fast_mode) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am " + this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        try { this.bot.stopDigging(); } catch {}
        try { this.bot.collectBlock?.cancelTask?.(() => {}); } catch {}
        try { this.bot.pathfinder?.stop(); } catch {}
        try { this.bot.pvp?.stop(); } catch {}
        try { this.bot.clearControlStates(); } catch {}
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    getSquadIndex() {
        const nameMatch = (this.name || '').match(/\d+$/);
        return nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;
    }

    isMultiGoalPrompt(lower) {
        if (!lower) return false;
        if (/\b(doombot\d*|bot\d*)\s*[:,-]?\s*[a-z]+/i.test(lower)) return true;
        const andClauses = lower.split(/\s+and\s+/);
        if (andClauses.length >= 2) {
            const actionKeywords = ['log', 'wood', 'food', 'bread', 'crop', 'stone', 'cobblestone', 'iron', 'coal', 'defend', 'guard', 'hunt', 'build', 'craft', 'follow', 'bridge', 'orbryx'];
            const firstHasAction = actionKeywords.some(k => andClauses[0].includes(k));
            const secondHasAction = actionKeywords.some(k => andClauses[1].includes(k));
            if (firstHasAction && secondHasAction) return true;
        }
        return false;
    }

    parseMultiGoals(message) {
        if (!message || typeof message !== 'string') return [];
        const trimmed = message.trim();

        // Check for explicit bot names: e.g. "Doombot mine logs, Doombot2 craft weapons"
        const botPattern = /\b(doombot\d*|bot\d*)\s*[:,-]?\s*([^,;]+)/gi;
        const explicitMatches = [...trimmed.matchAll(botPattern)];
        if (explicitMatches.length >= 2) {
            return explicitMatches.map(m => ({
                targetBot: m[1].toLowerCase(),
                task: m[2].trim()
            }));
        }

        const lower = trimmed.toLowerCase();
        const goalKeywords = [
            { regex: /\b(?:(?:get|mine|chop|gather|harvest)\s+)?(?:logs?|wood|trees?)\b/i, task: 'mine logs 384' },
            { regex: /\b(?:(?:get|gather|collect)\s+)?apples?\b/i, task: 'collect apples' },
            { regex: /\b(?:(?:get|gather|hunt|farm)\s+)?(?:food|bread|meat|crops?)\b/i, task: 'farm crops' },
            { regex: /\b(?:(?:mine|gather)\s+)?(?:stone|cobblestone|rocks?)\b/i, task: 'mine cobblestone 64' },
            { regex: /\b(?:(?:mine|gather)\s+)?(?:dirt|soil|earth)\b/i, task: 'mine dirt 64' },
            { regex: /\b(?:(?:mine|gather)\s+)?sand\b/i, task: 'mine sand 64' },
            { regex: /\b(?:(?:mine|gather)\s+)?gravel\b/i, task: 'mine gravel 64' },
            { regex: /\b(?:(?:mine|gather)\s+)?andesite\b/i, task: 'mine andesite 64' },
            { regex: /\b(?:(?:mine|gather)\s+)?(?:iron|coal|diamonds?|copper|gold)\b/i, task: 'mine iron' },
            { regex: /\b(?:defend|guard|protect)(?:\s+(?:us|the\s+area|perimeter))?\b/i, task: 'defend the area' },
            { regex: /\b(?:follow|escort|protect)\s+orbryx\b/i, task: 'defend orbryx' },
            { regex: /\b(?:build|construct)(?:\s+a)?\s+(?:shelter|house|base|wall)\b/i, task: 'build a dirt shelter' }
        ];

        const detected = [];
        for (const gk of goalKeywords) {
            if (gk.regex.test(lower)) {
                detected.push(gk.task);
            }
        }

        if (detected.length >= 2) {
            return detected;
        }

        if (lower.includes(' and ') || lower.includes(';') || (lower.includes(',') && !lower.startsWith('!'))) {
            const parts = lower.split(/\s*(?:and|;|,)\s*/i).map(p => p.trim()).filter(p => p.length > 2);
            const actionVerbs = ['get', 'mine', 'chop', 'gather', 'farm', 'defend', 'guard', 'hunt', 'build', 'craft', 'follow', 'escort', 'bridge'];
            const validParts = parts.filter(p => actionVerbs.some(v => p.startsWith(v)));
            if (validParts.length >= 2) {
                return validParts;
            }
        }

        return [];
    }

    async handleMultiGoalSquadTask(source, message) {
        const goals = this.parseMultiGoals(message);
        if (!goals || goals.length === 0) return false;

        const myName = (this.name || '').toLowerCase();
        const myIndex = this.getSquadIndex();

        let assignedTask = null;

        if (typeof goals[0] === 'object' && goals[0].targetBot) {
            const myAssignment = goals.find(g => g.targetBot === myName || (myName === 'doombot' && g.targetBot === 'bot1') || (myName === `doombot${myIndex + 1}` && g.targetBot === `bot${myIndex + 1}`));
            if (myAssignment) {
                assignedTask = myAssignment.task;
            } else {
                assignedTask = goals[myIndex % goals.length].task;
            }
        } else {
            assignedTask = goals[myIndex % goals.length];
        }

        if (assignedTask) {
            console.log(`[SquadDelegation] ${this.name} (index ${myIndex}) assigned sub-task: "${assignedTask}" from multi-goal request: "${message}"`);
            this.routeResponse(source, `[Squad Role] ${this.name} assigned task: "${assignedTask}"`);
            const handledFast = await this.handleFastShortcut(source, assignedTask);
            if (!handledFast) {
                await this.handleMessage(source, assignedTask);
            }
            return true;
        }

        return false;
    }

    parseGatheringIntent(raw) {
        if (!raw || typeof raw !== 'string') return null;
        const lower = raw.toLowerCase().trim();

        // Check direct pattern: "[material] X stacks" e.g. "stone 3 stacks", "dirt 2 stacks"
        const directStacks = lower.match(/^([a-zA-Z0-9_\s]+?)\s+(\d+)\s+stacks?$/i);
        if (directStacks && !/^(stay|follow|defend|guard|bridge)/i.test(directStacks[1])) {
            const stacks = parseInt(directStacks[2], 10);
            return { rawMat: directStacks[1].trim(), count: stacks * 64, stacks };
        }

        // Check if message has a gather/mine action verb
        const gatherAction = /^(?:mine|get|gather|collect|dig|harvest|chop)\b/i.test(lower);
        if (!gatherAction) return null;

        // Check for stacks: "mine 3 stacks of stone", "get 2 stacks sand", "collect 1 stack of apples"
        const stacksMatch = lower.match(/(\d+)\s+stacks?(?:\s+of)?\s+([a-zA-Z0-9_\s]+)/i);
        // Check for count: "mine 128 stone", "get 50 dirt", "mine 20 iron"
        const countMatch = lower.match(/^(?:mine|get|gather|collect|dig|harvest|chop)\s+(\d+)\s+([a-zA-Z0-9_\s]+)/i);
        // General: "mine stone", "collect apples", "mine andesite", "gather sand"
        const generalMatch = lower.match(/^(?:mine|get|gather|collect|dig|harvest|chop)\s+([a-zA-Z0-9_\s]+)/i);

        let count = 64; // default 1 stack
        let rawMat = '';

        if (stacksMatch) {
            const stacks = parseInt(stacksMatch[1], 10);
            count = stacks * 64;
            rawMat = stacksMatch[2].trim();
        } else if (countMatch) {
            count = parseInt(countMatch[1], 10);
            rawMat = countMatch[2].trim();
        } else if (generalMatch) {
            rawMat = generalMatch[1].trim();
            const endStacks = rawMat.match(/^([a-zA-Z0-9_\s]+?)\s+(\d+)\s+stacks?$/i);
            if (endStacks) {
                rawMat = endStacks[1].trim();
                count = parseInt(endStacks[2], 10) * 64;
            }
        } else {
            return null;
        }

        // Clean material name
        rawMat = rawMat.replace(/^of\s+/i, '').replace(/\s+(?:please|pls)$/i, '').trim();

        // If rawMat is empty or a non-material verb, skip
        if (!rawMat || /^(?:me|orbryx|here|area|perimeter|shelter|house)$/i.test(rawMat)) return null;

        return { rawMat, count, stacks: Math.max(1, Math.round(count / 64)) };
    }

    resolveMaterialIntent(rawMat) {
        const m = String(rawMat || '').toLowerCase().replace(/[\s\-]+/g, '_').replace(/^raw_/, '').trim();
        if (m === 'apple' || m === 'apples' || m === 'red_apple' || m === 'red_apples') {
            return { category: 'apple', target: 'apple' };
        }
        if (m === 'wood' || m === 'log' || m === 'logs' || m === 'tree' || m === 'trees' || m.endsWith('_log') || m.endsWith('_wood')) {
            return { category: 'logs', target: 'oak_log' };
        }
        if (m === 'stone' || m === 'cobblestone' || m === 'cobble' || m === 'rocks') {
            return { category: 'material', target: 'cobblestone' };
        }
        if (m === 'dirt' || m === 'grass' || m === 'soil' || m === 'earth') {
            return { category: 'material', target: 'dirt' };
        }
        if (m === 'sand' || m === 'red_sand') {
            return { category: 'material', target: 'sand' };
        }
        if (m === 'gravel' || m === 'flint') {
            return { category: 'material', target: 'gravel' };
        }
        if (m === 'andesite') return { category: 'material', target: 'andesite' };
        if (m === 'diorite') return { category: 'material', target: 'diorite' };
        if (m === 'granite') return { category: 'material', target: 'granite' };
        if (m === 'tuff') return { category: 'material', target: 'tuff' };
        if (m === 'calcite') return { category: 'material', target: 'calcite' };
        if (m === 'dripstone') return { category: 'material', target: 'dripstone_block' };
        if (m === 'deepslate' || m === 'cobbled_deepslate') return { category: 'material', target: 'deepslate' };
        if (m === 'basalt' || m === 'blackstone') return { category: 'material', target: 'basalt' };
        if (m === 'obsidian') return { category: 'material', target: 'obsidian' };
        if (m === 'clay') return { category: 'material', target: 'clay' };
        if (m === 'sandstone') return { category: 'material', target: 'sandstone' };
        if (m === 'netherrack') return { category: 'material', target: 'netherrack' };
        if (m === 'end_stone' || m === 'endstone') return { category: 'material', target: 'end_stone' };

        // Ores
        if (m === 'iron' || m === 'iron_ore') return { category: 'material', target: 'iron_ore' };
        if (m === 'coal' || m === 'coal_ore') return { category: 'material', target: 'coal_ore' };
        if (m === 'copper' || m === 'copper_ore') return { category: 'material', target: 'copper_ore' };
        if (m === 'gold' || m === 'gold_ore') return { category: 'material', target: 'gold_ore' };
        if (m === 'diamond' || m === 'diamonds' || m === 'diamond_ore') return { category: 'material', target: 'diamond_ore' };
        if (m === 'redstone' || m === 'redstone_ore') return { category: 'material', target: 'redstone_ore' };
        if (m === 'lapis' || m === 'lapis_lazuli' || m === 'lapis_ore') return { category: 'material', target: 'lapis_ore' };
        if (m === 'emerald' || m === 'emeralds' || m === 'emerald_ore') return { category: 'material', target: 'emerald_ore' };
        if (m === 'quartz' || m === 'nether_quartz') return { category: 'material', target: 'nether_quartz_ore' };
        if (m === 'ancient_debris' || m === 'debris' || m === 'netherite') return { category: 'material', target: 'ancient_debris' };
        if (m === 'ores' || m === 'ore') return { category: 'material', target: 'iron_ore' };

        return { category: 'material', target: m };
    }

    async handleFastShortcut(source, raw) {
        if (!raw || typeof raw !== 'string') return false;
        const lower = raw.toLowerCase().trim();

        // Direct Minecraft slash commands (e.g. "/tpa orbryx", "do /tpa orbryx", "/home", "/spawn", "/gamemode")
        const slashMatch = raw.match(/^(?:do\s+)?(\/[a-zA-Z0-9_\-]+(?:\s+.*)?)$/i);
        if (slashMatch) {
            const slashCmd = slashMatch[1].trim();
            console.log(`[FastCommand] ${this.name} executing direct slash command: ${slashCmd}`);
            this.bot.chat(slashCmd);
            this.routeResponse(source, `Executed: ${slashCmd}`);
            return true;
        }

        // Quick natural language intent shortcuts to avoid slow CPU LLM inference timeouts
        if (/^(stop|halt|freeze|cancel)$/i.test(lower)) {
            await executeCommand(this, '!stop');
            this.routeResponse(source, 'Stopped all actions.');
            return true;
        }
        if (/^(stay|stay still|wait here)$/i.test(lower)) {
            await executeCommand(this, '!stay(-1)');
            this.routeResponse(source, 'Staying at current position.');
            return true;
        }
        if (/^(follow me|follow\s+([a-zA-Z0-9_]+))$/i.test(lower)) {
            const targetMatch = lower.match(/^follow\s+([a-zA-Z0-9_]+)$/i);
            const target = (targetMatch && targetMatch[1] !== 'me') ? targetMatch[1] : (source === 'ADMIN' ? 'orbryx' : source);
            await executeCommand(this, `!squadFollow("${target}")`);
            this.routeResponse(source, `Holding squad escort formation around ${target}.`);
            return true;
        }

        // Universal Squad Gathering Intent (Apples, Logs, Stone, Dirt, Ores, Sand, Andesite, Gravel, etc.)
        const gatheringIntent = this.parseGatheringIntent(raw);
        if (gatheringIntent) {
            const { rawMat, count, stacks } = gatheringIntent;
            const resolved = this.resolveMaterialIntent(rawMat);

            if (resolved.category === 'apple') {
                console.log(`[FastCommand] ${this.name} executing squadCollectApples(${count})`);
                await executeCommand(this, `!squadCollectApples(${count})`);
                this.routeResponse(source, `Collecting apples in squad formation (${count} apples / ${stacks} stacks).`);
                return true;
            }

            if (resolved.category === 'logs') {
                console.log(`[FastCommand] ${this.name} executing squadMineLogs(${count})`);
                await executeCommand(this, `!squadMineLogs(${count})`);
                this.routeResponse(source, `Splitting up in squad teamwork to mine logs (${count} logs / ${stacks} stacks).`);
                return true;
            }

            console.log(`[FastCommand] ${this.name} executing squadGather("${resolved.target}", ${count})`);
            await executeCommand(this, `!squadGather("${resolved.target}", ${count})`);
            this.routeResponse(source, `Executing squad teamwork mining for ${resolved.target} (${count} blocks / ${stacks} stacks).`);
            return true;
        }

        if (/^(boat\s+to|sail\s+to)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i.test(lower)) {
            const m = lower.match(/(?:boat|sail)\s+to\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i);
            if (m) {
                const x = parseFloat(m[1]), y = parseFloat(m[2]), z = parseFloat(m[3]);
                await executeCommand(this, `!boatTo(${x}, ${y}, ${z})`);
                this.routeResponse(source, `Boating to (${x}, ${y}, ${z}).`);
                return true;
            }
        }
        if (/^(auto\s*equip|equip\s+best|wear\s+armor|best\s+gear)/i.test(lower)) {
            await executeCommand(this, '!autoEquip');
            this.routeResponse(source, 'Equipped best armor, shield, and weapons.');
            return true;
        }
        if (/^defend\s+orbryx/i.test(lower)) {
            await executeCommand(this, '!squadFollow("orbryx")');
            await executeCommand(this, '!squadDefend(24)');
            this.routeResponse(source, 'Forming defensive perimeter to protect ally orbryx.');
            return true;
        }
        if (/^(farm\s+crops?|harvest\s+crops?|farm)/i.test(lower)) {
            await executeCommand(this, '!squadFarmCrops');
            this.routeResponse(source, 'Harvesting and replanting farm crops in squad sectors.');
            return true;
        }
        if (/^(guard(\s+area|\s+perimeter)?|defend(\s+(the\s+area|us|me))?)/i.test(lower)) {
            await executeCommand(this, '!squadDefend(24)');
            this.routeResponse(source, 'Forming 360-degree squad defense perimeter.');
            return true;
        }
        if (/^bridge(\s+(north|south|east|west))?(\s+(\d+))?/i.test(lower)) {
            const bMatch = lower.match(/^bridge(?:\s+(north|south|east|west))?(?:\s+(\d+))?/i);
            const dir = bMatch && bMatch[1] ? bMatch[1].toLowerCase() : 'north';
            const dist = bMatch && bMatch[2] ? parseInt(bMatch[2], 10) : 10;
            await executeCommand(this, `!bridge("${dir}", ${dist})`);
            this.routeResponse(source, `Safe bridging ${dir} for ${dist} blocks.`);
            return true;
        }
        if (/^(give|supply)\s+(food|bread|apples?|meat|armor|gear|wood|logs?)\s+to\s+orbryx/i.test(lower)) {
            const supplyMatch = lower.match(/^(?:give|supply)\s+(food|bread|apples?|meat|armor|gear|wood|logs?)\s+to\s+orbryx/i);
            const itemCategory = supplyMatch ? supplyMatch[1].toLowerCase() : 'food';
            const targetPlayer = 'orbryx';
            const botInv = this.bot.inventory.items();
            let foundItem = null;
            if (itemCategory.includes('apple')) {
                foundItem = botInv.find(i => i.name === 'apple');
            } else if (itemCategory.includes('food') || itemCategory.includes('bread') || itemCategory.includes('meat')) {
                const foods = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'apple', 'baked_potato', 'carrot'];
                foundItem = botInv.find(i => foods.includes(i.name)) || botInv.find(i => i.name.includes('cooked') || i.name.includes('bread') || i.name.includes('apple'));
            } else if (itemCategory.includes('armor') || itemCategory.includes('gear')) {
                foundItem = botInv.find(i => i.name.includes('helmet') || i.name.includes('chestplate') || i.name.includes('leggings') || i.name.includes('boots') || i.name.includes('sword'));
            } else if (itemCategory.includes('wood') || itemCategory.includes('log')) {
                foundItem = botInv.find(i => i.name.includes('log') || i.name.includes('planks'));
            }
            if (foundItem) {
                await executeCommand(this, `!givePlayer("${targetPlayer}", "${foundItem.name}", ${Math.min(foundItem.count, 16)})`);
                this.routeResponse(source, `Supplied ${foundItem.count} ${foundItem.name} to ally ${targetPlayer}.`);
            } else {
                this.routeResponse(source, `No ${itemCategory} available in inventory to supply to ${targetPlayer}.`);
            }
            return true;
        }
        if (/^build\s+/i.test(lower)) {
            const requested = lower.replace(/^build\s+(a\s+|an\s+)?/i, '').trim();
            try {
                const { getSchematicsCatalog } = await import('./npc/construction/schematics_library.js');
                const catalog = getSchematicsCatalog();
                const matched = catalog.find(c => c.id === requested || c.name.toLowerCase() === requested || requested.includes(c.id) || c.name.toLowerCase().includes(requested));
                if (matched) {
                    this.routeResponse(source, `Initiating squad construction for ${matched.name}...`);
                    this.npc.data.curr_goal = { name: matched.id, quantity: 1 };
                    await this.npc.executeGoal();
                    return true;
                }
            } catch (e) {}
        }
        if (/^defend(\s+(the\s+area|us|me))?/i.test(lower)) {
            this.bot.modes.setOn('hunting', true);
            this.bot.modes.setOn('self_defense', true);
            await executeCommand(this, '!huntAll("zombie", 32)');
            this.routeResponse(source, 'Defending area against hostiles.');
            return true;
        }
        if (/^craft\s+([a-zA-Z0-9_]+)/i.test(lower)) {
            const itemMatch = lower.match(/^craft\s+([a-zA-Z0-9_]+)/i);
            const item = itemMatch ? itemMatch[1] : 'wooden_pickaxe';
            await executeCommand(this, `!craftRecipe("${item}", 1)`);
            this.routeResponse(source, `Crafting ${item}.`);
            return true;
        }
        if (/^build\s+(a\s+)?(dirt\s+)?(shelter|house|base)/i.test(lower)) {
            await executeCommand(this, '!build("dirt", 3, 3, 2)');
            this.routeResponse(source, 'Building basic shelter.');
            return true;
        }

        // Natural plain English mapping for essential commands (e.g. "eat" -> "!eat", "drop all" -> "!dropAll")
        const normalizedBare = '!' + lower.replace(/\s+([a-z])/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9_!]/g, '');
        if (commandExists(normalizedBare)) {
            console.log(`[FastCommand] ${this.name} matched bare command: ${normalizedBare}`);
            let execute_res = await executeCommand(this, normalizedBare);
            if (execute_res) this.routeResponse(source, execute_res);
            return true;
        }

        return false;
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);

        if (!self_prompt && !from_other_bot) { // from user, check for fast commands or forced commands
            const raw = message.trim();
            const lower = raw.toLowerCase();

            // Check for multi-goal squad task delegation (e.g. "get logs and food", "mine wood and defend", "Doombot mine cobblestone, Doombot2 farm crops")
            if (this.isMultiGoalPrompt(lower)) {
                const multiGoalHandled = await this.handleMultiGoalSquadTask(source, raw);
                if (multiGoalHandled) return true;
            }

            // Check fast shortcut
            const fastHandled = await this.handleFastShortcut(source, raw);
            if (fastHandled) return true;

            const user_command_name = containsCommand(message);
            if (user_command_name) {
                if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
                let execute_res = await executeCommand(this, message);
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        const timeStr = new Date().toISOString().replace('T', ' ').substring(11, 19);
        console.log(`\x1b[36m[${timeStr}] [${this.name}]\x1b[0m 📨 Message from \x1b[33m${source}\x1b[0m: "${message}"`);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = '';
            try {
                res = await this.prompter.promptConvo(history);
            } catch (err) {
                console.error(`[AI: ${this.name}] Prompt error:`, err?.message || err);
                this.routeResponse(source, "I encountered an error connecting to my AI model. Please try again.");
                break;
            }

            if (!res || typeof res !== 'string' || res.trim().length === 0) {
                console.warn(`[Bot: ${this.name}] Empty AI response, ending response loop.`);
                break; // empty response ends loop
            }

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                let execute_res = await executeCommand(this, res);

                console.log(`\x1b[36m[${new Date().toISOString().substring(11, 19)}] [${this.name}]\x1b[0m ⚡ Executed: \x1b[32m${command_name}\x1b[0m ➔ ${execute_res || 'Done'}`);
                used_command = true;

                if (execute_res)
                    this.history.add('system', execute_res);
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');
        if (message.length > 240) {
            message = message.substring(0, 240);
        }

        // Debounce in-game chat to prevent "Kicked for spamming" on strict servers
        const now = Date.now();
        if (this._lastChatTime && now - this._lastChatTime < 600) {
            await new Promise(r => setTimeout(r, 600 - (now - this._lastChatTime)));
        }
        this._lastChatTime = Date.now();

        if (settings.only_chat_with && settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) {this.bot.chat(message);}
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        // Anti-AFK keepalive: subtle micro-rotation every 45s when idle so server does not kick for inactivity
        const afkInterval = setInterval(() => {
            if (this._disconnectHandled || !this.bot || !this.bot.entity) {
                clearInterval(afkInterval);
                return;
            }
            if (this.isIdle()) {
                try {
                    const yaw = this.bot.entity.yaw + (Math.random() * 0.2 - 0.1);
                    const pitch = Math.max(-0.5, Math.min(0.5, this.bot.entity.pitch + (Math.random() * 0.1 - 0.05)));
                    this.bot.look(yaw, pitch, true).catch(() => {});
                } catch {}
            }
        }, 45000);

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;

                // Immediate counter-attack: retaliate against attacking zombies/hostile mobs
                if (this.bot.modes?.isOn('self_defense') && !this.actions.currentActionLabel?.includes('self_defense')) {
                    const attacker = world.getNearestEntityWhere(this.bot, entity => mc.isHostile(entity), 10);
                    if (attacker) {
                        this.actions.runAction('mode:self_defense', async () => {
                            await skills.defendSelf(this.bot, 12);
                        });
                    }
                }
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            this.actions.cancelResume();
            this.actions.stop();
            try { this.bot.clearControlStates(); } catch {}
            try { this.bot.pathfinder?.stop(); } catch {}
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            const firstWord = String(message || '').split(/\s+/)[0];
            if (jsonMsg?.translate?.startsWith('death') && firstWord === this.name) {
                console.log(`[DeathRecovery] ${this.name} died: ${message}`);
                try {
                    const death_pos = this.bot.entity?.position;
                    if (death_pos) {
                        this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                    }
                } catch {}
                this.actions.stop();
                try { this.bot.clearControlStates(); } catch {}
                try { this.bot.pathfinder?.stop(); } catch {}
                // Auto equip best available gear upon respawn without burning LLM rate limits
                this.bot.once('spawn', async () => {
                    await new Promise(r => setTimeout(r, 1200));
                    try {
                        const { autoEquipBest } = await import('./library/skills.js');
                        await autoEquipBest(this.bot);
                    } catch {}
                });
            }
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this.actions.resumeAction();
                }
            }, 1000);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        if (this._antiIdleTimer) {
            clearInterval(this._antiIdleTimer);
            this._antiIdleTimer = null;
        }
        try { this.history.add('system', msg); } catch {}
        try {
            if (this.bot && this.bot._client && this.bot._client.socket && !this.bot._client.socket.destroyed) {
                this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
            }
        } catch {}
        try { this.history.save(); } catch {}
        setTimeout(() => process.exit(code), 200);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
