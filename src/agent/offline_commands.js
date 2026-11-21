import * as world from './library/world.js';
import * as skills from './library/skills.js';
import * as mc from '../utils/mcdata.js';
import { executeCommand, commandExists } from './commands/index.js';

/**
 * Comprehensive Offline Command Engine for Doombots.
 * Enables 100% full bot squad control without requiring any AI model, API key, or Ollama instance.
 */
export async function handleOfflineCommand(agent, source, raw) {
    if (!raw || typeof raw !== 'string') return false;
    const clean = typeof agent.cleanUserInput === 'function' ? agent.cleanUserInput(raw) : raw.trim();
    const lower = (clean || raw).toLowerCase().trim();
    const bot = agent.bot;

    // -------------------------------------------------------------
    // 1. HELP & CHEATSHEET
    // -------------------------------------------------------------
    if (/^(?:help|commands|cmd|cmds|offline\s+help|\?)$/i.test(lower)) {
        agent.routeResponse(
            source,
            `[Offline Commands] Categories: mine, farm, craft, smelt, build, defend, follow, inv, status, sleep, fish, /back, /tpa orbryx, !stop. Type any command or '!help [topic]' for details!`
        );
        return true;
    }

    // -------------------------------------------------------------
    // MINECRAFT IN-GAME TAB SUGGEST & AUTOCOMPLETE
    // -------------------------------------------------------------
    if (/^(?:tab|suggest|complete|autocomplete)(?:\s+(.*))?$/i.test(lower)) {
        const queryMatch = lower.match(/^(?:tab|suggest|complete|autocomplete)(?:\s+(.*))?$/i);
        const q = (queryMatch && queryMatch[1]) ? queryMatch[1].trim().toLowerCase() : '';
        const commandPool = [
            'mine diamonds', 'mine 2 stacks of diamonds', 'mine stack of diamond',
            'dig to diamond level', 'max ore scan', 'mine 3 stacks of stone',
            'mine 2 stacks of wood', 'mine stack of iron', 'mine stack of gold',
            'collect apples', 'squad mine diamonds', 'squad mine stone',
            'squad mine wood', 'squad mine ores', '/tpa orbryx', '/back',
            'follow orbryx', 'defend the area', 'auto equip', 'craft wooden_pickaxe',
            'build dirt shelter', 'inv', 'status', 'eat', 'sleep', 'stop', 'stay'
        ];
        const matches = q ? commandPool.filter(c => c.includes(q)) : commandPool.slice(0, 6);
        const top = matches.length > 0 ? matches.slice(0, 6) : commandPool.slice(0, 6);
        agent.routeResponse(
            source,
            `[Tab Suggestions] ${top.map((c, i) => `${i + 1}. ${c}`).join(' • ')} (Say any command to execute!)`
        );
        return true;
    }

    // -------------------------------------------------------------
    // 2. INVENTORY & EQUIPMENT INSPECTION
    // -------------------------------------------------------------
    if (/^(?:inv|inventory|items|what\s+do\s+you\s+have|check\s+inventory|show\s+inventory|my\s+items)$/i.test(lower)) {
        const counts = world.getInventoryCounts(bot);
        const countEntries = Object.entries(counts);
        const totalStacks = bot.inventory?.items ? bot.inventory.items().length : 0;
        const helmet = bot.inventory?.slots?.[5]?.name || 'none';
        const chest = bot.inventory?.slots?.[6]?.name || 'none';
        const legs = bot.inventory?.slots?.[7]?.name || 'none';
        const boots = bot.inventory?.slots?.[8]?.name || 'none';
        const mainHand = bot.heldItem?.name || 'empty';
        const offHand = bot.inventory?.slots?.[45]?.name || 'empty';

        if (countEntries.length === 0) {
            agent.routeResponse(source, `[${agent.name} Inv] Empty (0/36 slots). Hand: ${mainHand}, Off-hand: ${offHand}.`);
        } else {
            const itemList = countEntries.slice(0, 10).map(([k, v]) => `${v} ${k}`).join(', ');
            const extra = countEntries.length > 10 ? ` (+${countEntries.length - 10} more)` : '';
            agent.routeResponse(
                source,
                `[${agent.name} Inv] (${totalStacks}/36 slots): ${itemList}${extra}. Armor: ${helmet}, ${chest}, ${legs}, ${boots}. Hand: ${mainHand}, Off-hand: ${offHand}.`
            );
        }
        return true;
    }

    // -------------------------------------------------------------
    // 3. HEALTH, VITALS & STATUS
    // -------------------------------------------------------------
    if (/^(?:status|health|hp|vitals|stats|info)$/i.test(lower)) {
        const hp = Math.round(bot.health || 20);
        const food = Math.round(bot.food || 20);
        const armor = Math.round(bot.armor || 0);
        const pos = bot.entity?.position;
        const posStr = pos ? `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}` : 'unknown';
        const act = agent.actions?.currentActionLabel || agent.actions?.currentAction?.name || 'Idle';
        agent.routeResponse(
            source,
            `[${agent.name} Status] HP: ${hp}/20, Hunger: ${food}/20, Armor: ${armor}/20. Pos: (${posStr}). State: ${act}.`
        );
        return true;
    }

    // -------------------------------------------------------------
    // 4. TIME, WEATHER & LOCATION
    // -------------------------------------------------------------
    if (/^(?:time|what\s+time\s+is\s+it)$/i.test(lower)) {
        const timeOfDay = bot.time?.timeOfDay || 0;
        let label = 'Day';
        if (timeOfDay >= 12000 && timeOfDay < 13000) label = 'Sunset';
        else if (timeOfDay >= 13000 && timeOfDay < 23000) label = 'Night';
        else if (timeOfDay >= 23000) label = 'Sunrise';
        else if (timeOfDay >= 6000 && timeOfDay < 12000) label = 'Noon';
        agent.routeResponse(source, `Current Time: ${label} (ticks: ${timeOfDay}).`);
        return true;
    }

    if (/^(?:weather|is\s+it\s+raining)$/i.test(lower)) {
        const isRain = bot.isRaining;
        const isThunder = bot.thunderState > 0;
        const wStr = isThunder ? 'Thunderstorm ⚡' : isRain ? 'Raining 🌧️' : 'Clear ☀️';
        agent.routeResponse(source, `Current Weather: ${wStr}.`);
        return true;
    }

    if (/^(?:coords|coordinates|location|where\s+are\s+you)$/i.test(lower)) {
        const p = bot.entity?.position;
        if (p) {
            agent.routeResponse(source, `Coordinates: X=${p.x.toFixed(1)}, Y=${p.y.toFixed(1)}, Z=${p.z.toFixed(1)}.`);
        } else {
            agent.routeResponse(source, 'Position is currently unknown.');
        }
        return true;
    }

    if (/^(?:ping|pong)$/i.test(lower)) {
        agent.routeResponse(source, `Pong! Latency: 0ms (Offline Command Engine Active).`);
        return true;
    }

    // -------------------------------------------------------------
    // 5. HOME WAYPOINTS
    // -------------------------------------------------------------
    if (/^(?:set\s+home|mark\s+home)$/i.test(lower)) {
        const p = bot.entity?.position;
        if (p) {
            if (agent.memory_bank && typeof agent.memory_bank.rememberPlace === 'function') {
                agent.memory_bank.rememberPlace('home', p.x, p.y, p.z);
            } else {
                agent.home_coords = { x: p.x, y: p.y, z: p.z };
            }
            agent.routeResponse(source, `Home waypoint set at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}).`);
        }
        return true;
    }

    if (/^(?:go\s+home|return\s+home)$/i.test(lower)) {
        const h = (agent.memory_bank && typeof agent.memory_bank.recallPlace === 'function')
            ? agent.memory_bank.recallPlace('home')
            : agent.home_coords;
        if (h) {
            agent.routeResponse(source, `Navigating back to home (${h.x.toFixed(1)}, ${h.y.toFixed(1)}, ${h.z.toFixed(1)})...`);
            try {
                await skills.goToPosition(bot, h.x, h.y, h.z, 2);
                agent.routeResponse(source, 'Arrived at home waypoint.');
            } catch (err) {
                agent.routeResponse(source, `Navigation error: ${err?.message || err}`);
            }
        } else {
            agent.routeResponse(source, 'No home waypoint has been set yet. Type "set home" first.');
        }
        return true;
    }

    // -------------------------------------------------------------
    // 6. SURVIVAL & EMERGENCY
    // -------------------------------------------------------------
    if (/^(?:eat|feed|eat\s+food|heal)$/i.test(lower)) {
        if (bot.autoEat && typeof bot.autoEat.eat === 'function') {
            try {
                await bot.autoEat.eat(true);
                agent.routeResponse(source, 'Consumed food to restore hunger and health.');
            } catch {
                agent.routeResponse(source, 'No suitable food found in inventory.');
            }
        }
        return true;
    }

    if (/^(?:sleep|go\s+to\s+sleep|sleep\s+in\s+bed|bed)$/i.test(lower)) {
        const res = await executeCommand(agent, '!sleepInBed');
        agent.routeResponse(source, res || 'Sleeping in nearest bed.');
        return true;
    }

    if (/^(?:wake\s+up|get\s+out\s+of\s+bed)$/i.test(lower)) {
        const res = await executeCommand(agent, '!wakeUp');
        agent.routeResponse(source, res || 'Awoken from bed.');
        return true;
    }

    if (/^(?:cure\s+poison|drink\s+milk)$/i.test(lower)) {
        const res = await executeCommand(agent, '!curePoison');
        agent.routeResponse(source, res || 'Drinking milk bucket to cure poison.');
        return true;
    }

    if (/^(?:extinguish|put\s+out\s+fire|extinguish\s+self)$/i.test(lower)) {
        const res = await executeCommand(agent, '!extinguishSelf');
        agent.routeResponse(source, res || 'Extinguishing fire.');
        return true;
    }

    if (/^(?:swim\s+up|surface|get\s+out\s+of\s+water)$/i.test(lower)) {
        const res = await executeCommand(agent, '!swimUp');
        agent.routeResponse(source, res || 'Swimming to water surface.');
        return true;
    }

    if (/^(?:climb\s+ladder|go\s+up\s+ladder)$/i.test(lower)) {
        const res = await executeCommand(agent, '!climbLadder');
        agent.routeResponse(source, res || 'Climbing ladder.');
        return true;
    }

    // -------------------------------------------------------------
    // 7. FARMING, CROPS & ANIMALS
    // -------------------------------------------------------------
    if (/^(?:fish|go\s+fishing|catch\s+fish|start\s+fishing)$/i.test(lower)) {
        agent.routeResponse(source, 'Starting offline fishing session...');
        const res = await executeCommand(agent, '!fish');
        agent.routeResponse(source, res || 'Finished fishing session.');
        return true;
    }

    if (/^(?:till\s+soil|till\s+dirt|till\s+ground|hoe\s+ground)$/i.test(lower)) {
        const res = await executeCommand(agent, '!tillSoil');
        agent.routeResponse(source, res || 'Tilled farmland soil.');
        return true;
    }

    if (/^(?:plant\s+seeds|plant\s+crops|sow\s+seeds|plant\s+wheat)$/i.test(lower)) {
        const res = await executeCommand(agent, '!plantSeeds');
        agent.routeResponse(source, res || 'Planted crop seeds.');
        return true;
    }

    if (/^(?:bonemeal\s+crops?|fertilize\s+crops?|grow\s+crops?)$/i.test(lower)) {
        const res = await executeCommand(agent, '!bonemealCrop');
        agent.routeResponse(source, res || 'Applied bonemeal to accelerate crop growth.');
        return true;
    }

    if (/^(?:shear\s+sheep|get\s+wool|shear)$/i.test(lower)) {
        const res = await executeCommand(agent, '!shearSheep');
        agent.routeResponse(source, res || 'Sheared nearby sheep.');
        return true;
    }

    if (/^(?:milk\s+cow|get\s+milk)$/i.test(lower)) {
        const res = await executeCommand(agent, '!milkCow');
        agent.routeResponse(source, res || 'Milked cow with bucket.');
        return true;
    }

    if (/^(?:feed\s+animals?|breed\s+cows?|breed\s+sheep|breed\s+animals?)$/i.test(lower)) {
        const res = await executeCommand(agent, '!feedAnimal');
        agent.routeResponse(source, res || 'Fed and bred nearby animals.');
        return true;
    }

    if (/^(?:lead\s+animal|lure\s+animal)$/i.test(lower)) {
        const res = await executeCommand(agent, '!leadAnimal');
        agent.routeResponse(source, res || 'Leading animal with food.');
        return true;
    }

    if (/^(?:harvest\s+honey|get\s+honey|beehive)$/i.test(lower)) {
        const res = await executeCommand(agent, '!harvestHoney');
        agent.routeResponse(source, res || 'Harvested honey from beehive.');
        return true;
    }

    // -------------------------------------------------------------
    // 8. MINING & EXCAVATION (Zero-AI Offline Squad Teamwork)
    // -------------------------------------------------------------
    const offlineMiningIntent = typeof agent.parseGatheringIntent === 'function' ? agent.parseGatheringIntent(raw) : null;
    if (offlineMiningIntent) {
        const { rawMat, count, stacks } = offlineMiningIntent;
        const resolved = typeof agent.resolveMaterialIntent === 'function'
            ? agent.resolveMaterialIntent(rawMat)
            : { category: 'material', target: rawMat };

        if (resolved.target === 'diamond_ore' || /diamond/i.test(resolved.target)) {
            agent.routeResponse(source, `💎 Commencing diamond expedition: descending to Y=-58 with hazard protection and squad roles (${count} diamonds / ${stacks} stacks)...`);
            const res = await executeCommand(agent, `!mineDiamonds(${count})`);
            agent.routeResponse(source, res || 'Completed diamond mining pass.');
            return true;
        }

        if (resolved.category === 'apple') {
            agent.routeResponse(source, `🍎 Collecting apples in squad formation (${count} apples / ${stacks} stacks)...`);
            const res = await executeCommand(agent, `!squadCollectApples(${count})`);
            agent.routeResponse(source, res || 'Completed apple collection pass.');
            return true;
        }

        if (resolved.category === 'logs') {
            agent.routeResponse(source, `🪵 Squad logging timber and collecting apples (${count} logs / ${stacks} stacks, no sapling replanting)...`);
            const res = await executeCommand(agent, `!squadMineWood(${count})`);
            agent.routeResponse(source, res || 'Squad timber logging completed.');
            return true;
        }

        if (resolved.category === 'food') {
            agent.routeResponse(source, `🌾 Harvesting and farming crops in squad sectors...`);
            const res = await executeCommand(agent, '!squadFarmCrops');
            agent.routeResponse(source, res || 'Harvested and farmed crops.');
            return true;
        }

        if (resolved.target === 'cobblestone' || resolved.target === 'stone') {
            agent.routeResponse(source, `⛏️ Squad quarrying stone with guard & torch teamwork (${count} blocks / ${stacks} stacks)...`);
            const res = await executeCommand(agent, `!squadMineStone(${count})`);
            agent.routeResponse(source, res || 'Squad stone quarrying completed.');
            return true;
        }

        if (resolved.target.endsWith('_ore') || resolved.target === 'ancient_debris') {
            agent.routeResponse(source, `⛏️ Squad extracting ${resolved.target.replace(/_/g, ' ')} veins with max 64m scanning (${count} ores / ${stacks} stacks)...`);
            const res = await executeCommand(agent, `!squadMineOres("${resolved.target}", ${count})`);
            agent.routeResponse(source, res || 'Squad ore mining completed.');
            return true;
        }

        agent.routeResponse(source, `⛏️ Executing squad teamwork mining for ${resolved.target} (${count} blocks / ${stacks} stacks)...`);
        const res = await executeCommand(agent, `!squadGather("${resolved.target}", ${count})`);
        agent.routeResponse(source, res || `Completed mining pass for ${resolved.target}.`);
        return true;
    }

    if (/^(?:mine\s+diamonds?|diamond\s+mine|dig\s+diamonds?|squad\s+mine\s+diamonds?)$/i.test(lower)) {
        agent.routeResponse(source, '💎 Commencing diamond expedition: descending to Y=-58 with hazard protection and squad roles...');
        const res = await executeCommand(agent, '!mineDiamonds(64)');
        agent.routeResponse(source, res || 'Completed diamond mining pass.');
        return true;
    }

    if (/^(?:dig\s+(?:down\s+)?to\s+diamond(?:\s+level|\s+y\s+level)?|descend\s+to\s+diamonds?)$/i.test(lower)) {
        agent.routeResponse(source, '⛏️ Carving safe staircase down to optimal diamond Y level (-58)...');
        const res = await executeCommand(agent, '!digToDiamondLevel');
        agent.routeResponse(source, res || 'Arrived at diamond level.');
        return true;
    }

    if (/^(?:max\s+ore\s+scan|scan\s+ores\s+64|deep\s+ore\s+scan|scan\s+for\s+diamonds)$/i.test(lower)) {
        const res = await executeCommand(agent, '!maxOreScan(64)');
        agent.routeResponse(source, res || 'Max ore scan completed.');
        return true;
    }

    if (/^(?:squad\s+mine\s+stone|team\s+mine\s+stone)$/i.test(lower)) {
        agent.routeResponse(source, '⛏️ Squad quarrying stone with guard & torch teamwork...');
        const res = await executeCommand(agent, '!squadMineStone(64)');
        agent.routeResponse(source, res || 'Squad stone quarrying completed.');
        return true;
    }

    if (/^(?:squad\s+mine\s+wood|team\s+mine\s+wood|squad\s+gather\s+wood)$/i.test(lower)) {
        agent.routeResponse(source, '🪵 Squad logging timber and collecting apples (no sapling replanting)...');
        const res = await executeCommand(agent, '!squadMineWood(64)');
        agent.routeResponse(source, res || 'Squad timber logging completed.');
        return true;
    }

    if (/^(?:squad\s+mine\s+ores?|team\s+mine\s+ores?)$/i.test(lower)) {
        agent.routeResponse(source, '⛏️ Squad extracting ore veins with max 64m scanning...');
        const res = await executeCommand(agent, '!squadMineOres("iron_ore", 64)');
        agent.routeResponse(source, res || 'Squad ore mining completed.');
        return true;
    }

    if (/^(?:strip\s+mine|dig\s+tunnel|tunnel\s+forward|mine\s+tunnel)$/i.test(lower)) {
        agent.routeResponse(source, 'Digging 1x2 strip mine tunnel with torches...');
        const res = await executeCommand(agent, '!stripMine(12)');
        agent.routeResponse(source, res || 'Strip mining tunnel completed.');
        return true;
    }

    if (/^(?:staircase\s+down|dig\s+stairs\s+down|dig\s+down)$/i.test(lower)) {
        agent.routeResponse(source, 'Digging safe staircase downward...');
        const res = await executeCommand(agent, '!staircaseDown');
        agent.routeResponse(source, res || 'Staircase excavation completed.');
        return true;
    }

    if (/^(?:quarry|dig\s+quarry|dig\s+pit)$/i.test(lower)) {
        agent.routeResponse(source, 'Excavating stone quarry pit...');
        const res = await executeCommand(agent, '!quarry');
        agent.routeResponse(source, res || 'Quarry pit excavation completed.');
        return true;
    }

    if (/^(?:find\s+ores|search\s+for\s+ores|locate\s+ores|scan\s+ores)$/i.test(lower)) {
        const res = await executeCommand(agent, '!findOres');
        agent.routeResponse(source, res || 'Finished scanning for nearby ores.');
        return true;
    }

    if (/^(?:mine\s+vein|dig\s+vein)$/i.test(lower)) {
        const res = await executeCommand(agent, '!mineVein("iron_ore")');
        agent.routeResponse(source, res || 'Mined ore vein.');
        return true;
    }

    if (/^(?:mine\s+obsidian|dig\s+obsidian)$/i.test(lower)) {
        const res = await executeCommand(agent, '!mineObsidian');
        agent.routeResponse(source, res || 'Obsidian mining completed.');
        return true;
    }

    if (/^(?:mine\s+spelunking|cave\s+mining|spelunking)$/i.test(lower)) {
        const res = await executeCommand(agent, '!mineSpelunking');
        agent.routeResponse(source, res || 'Spelunking ore extraction completed.');
        return true;
    }

    // -------------------------------------------------------------
    // 9. BUILDING & STRUCTURE
    // -------------------------------------------------------------
    if (/^(?:build\s+wall|make\s+wall)$/i.test(lower)) {
        const res = await executeCommand(agent, '!buildWall');
        agent.routeResponse(source, res || 'Built defensive cobblestone wall.');
        return true;
    }

    if (/^(?:build\s+floor|make\s+floor)$/i.test(lower)) {
        const res = await executeCommand(agent, '!buildFloor');
        agent.routeResponse(source, res || 'Constructed cobblestone foundation floor.');
        return true;
    }

    if (/^(?:build\s+box|make\s+box|build\s+cube)$/i.test(lower)) {
        const res = await executeCommand(agent, '!buildBox');
        agent.routeResponse(source, res || 'Built survival cube.');
        return true;
    }

    if (/^(?:place\s+door|install\s+door)$/i.test(lower)) {
        const res = await executeCommand(agent, '!placeDoor');
        agent.routeResponse(source, res || 'Placed door.');
        return true;
    }

    if (/^(?:build\s+lookout|build\s+watchtower|build\s+tower)$/i.test(lower)) {
        const res = await executeCommand(agent, '!buildLookout');
        agent.routeResponse(source, res || 'Constructed elevated watchtower lookout.');
        return true;
    }

    if (/^(?:fill\s+holes?|level\s+ground)$/i.test(lower)) {
        const res = await executeCommand(agent, '!fillHoles');
        agent.routeResponse(source, res || 'Filled terrain holes and leveled ground.');
        return true;
    }

    if (/^(?:bridge\s+chasm|bridge\s+gap|bridge\s+across)$/i.test(lower)) {
        const res = await executeCommand(agent, '!bridgeChasm');
        agent.routeResponse(source, res || 'Bridged chasm gap safely.');
        return true;
    }

    if (/^(?:seal\s+lava|block\s+lava)$/i.test(lower)) {
        const res = await executeCommand(agent, '!sealLava');
        agent.routeResponse(source, res || 'Sealed hazardous lava pocket.');
        return true;
    }

    if (/^(?:clear\s+water|drain\s+water)$/i.test(lower)) {
        const res = await executeCommand(agent, '!clearWater');
        agent.routeResponse(source, res || 'Cleared water pocket.');
        return true;
    }

    if (/^(?:clear\s+foliage|cut\s+tall\s+grass|clear\s+weeds)$/i.test(lower)) {
        const res = await executeCommand(agent, '!clearFoliage');
        agent.routeResponse(source, res || 'Cleared surrounding tall grass and weeds.');
        return true;
    }

    // -------------------------------------------------------------
    // 10. COMBAT, MOB HUNTING & TACTICS
    // -------------------------------------------------------------
    if (/^(?:hunt\s+hostiles|hunt\s+monsters|clear\s+monsters)$/i.test(lower)) {
        const res = await executeCommand(agent, '!huntHostiles');
        agent.routeResponse(source, res || 'Hunting nearby hostile monsters.');
        return true;
    }

    if (/^(?:shoot\s+target|use\s+bow|fire\s+bow)$/i.test(lower)) {
        const res = await executeCommand(agent, '!shootTarget');
        agent.routeResponse(source, res || 'Fired bow at hostile target.');
        return true;
    }

    if (/^(?:snipe\s+mob|snipe\s+target)$/i.test(lower)) {
        const res = await executeCommand(agent, '!snipeMob');
        agent.routeResponse(source, res || 'Sniped distant hostile with bow.');
        return true;
    }

    if (/^(?:shield\s+bash|bash\s+enemy)$/i.test(lower)) {
        const res = await executeCommand(agent, '!shieldBash');
        agent.routeResponse(source, res || 'Executed shield bash and sword counter.');
        return true;
    }

    if (/^(?:strike\s+and\s+retreat|hit\s+and\s+run)$/i.test(lower)) {
        const res = await executeCommand(agent, '!strikeAndRetreat');
        agent.routeResponse(source, res || 'Executed hit-and-run tactic.');
        return true;
    }

    if (/^(?:critical\s+attack|jump\s+crit)$/i.test(lower)) {
        const res = await executeCommand(agent, '!criticalAttack');
        agent.routeResponse(source, res || 'Executed critical jump attack.');
        return true;
    }

    if (/^(?:flee\s+threat|run\s+away|flee)$/i.test(lower)) {
        const res = await executeCommand(agent, '!fleeThreat');
        agent.routeResponse(source, res || 'Retreating safely from immediate threat.');
        return true;
    }

    if (/^(?:guard\s+location|guard\s+here|hold\s+ground)$/i.test(lower)) {
        const res = await executeCommand(agent, '!guardLocation');
        agent.routeResponse(source, res || 'Guarding position against hostiles.');
        return true;
    }

    if (/^toggle\s+pvp$/i.test(lower)) {
        const res = await executeCommand(agent, '!togglePvp');
        agent.routeResponse(source, res || 'Toggled PVP combat readiness.');
        return true;
    }

    // -------------------------------------------------------------
    // 11. INVENTORY, STORAGE & CHESTS
    // -------------------------------------------------------------
    if (/^(?:sort\s+inventory|organize\s+inventory|clean\s+inventory)$/i.test(lower)) {
        const res = await executeCommand(agent, '!sortInventory');
        agent.routeResponse(source, res || 'Organized inventory and hotbar.');
        return true;
    }

    if (/^(?:deposit\s+all|deposit\s+items|put\s+in\s+chest|store\s+items)$/i.test(lower)) {
        const res = await executeCommand(agent, '!depositAll');
        agent.routeResponse(source, res || 'Deposited gathered items into nearest chest.');
        return true;
    }

    if (/^(?:dump\s+trash|throw\s+junk|throw\s+trash)$/i.test(lower)) {
        const res = await executeCommand(agent, '!dumpTrash');
        agent.routeResponse(source, res || 'Discarded junk items from inventory.');
        return true;
    }

    if (/^(?:take\s+food\s+from\s+chest|withdraw\s+food)$/i.test(lower)) {
        const res = await executeCommand(agent, '!takeFoodFromChest');
        agent.routeResponse(source, res || 'Retrieved food rations from chest.');
        return true;
    }

    if (/^(?:take\s+ores\s+from\s+chest|withdraw\s+ores)$/i.test(lower)) {
        const res = await executeCommand(agent, '!takeOresFromChest');
        agent.routeResponse(source, res || 'Retrieved raw ores from chest.');
        return true;
    }

    if (/^(?:fuel\s+furnace|put\s+coal\s+in\s+furnace)$/i.test(lower)) {
        const res = await executeCommand(agent, '!fuelFurnace');
        agent.routeResponse(source, res || 'Fueled furnace with coal/wood.');
        return true;
    }

    if (/^(?:collect\s+nearby\s+drops|pickup|pickup\s+items|vacuum)$/i.test(lower)) {
        const res = await executeCommand(agent, '!collectNearbyDrops');
        agent.routeResponse(source, res || 'Swept area and collected dropped items.');
        return true;
    }

    if (/^(?:repair\s+item|repair\s+tool)$/i.test(lower)) {
        const res = await executeCommand(agent, '!repairItem');
        agent.routeResponse(source, res || 'Repaired damaged tools in crafting grid.');
        return true;
    }

    // -------------------------------------------------------------
    // 12. SQUAD TEAMWORK & ROLES
    // -------------------------------------------------------------
    if (/^(?:regroup|regroup\s+squad|assemble|group\s+up)$/i.test(lower)) {
        const res = await executeCommand(agent, '!regroupSquad');
        agent.routeResponse(source, res || 'Squad regrouped at leader position.');
        return true;
    }

    if (/^(?:squad\s+formation|formation|wedge|line\s+up)$/i.test(lower)) {
        const res = await executeCommand(agent, '!squadFormation');
        agent.routeResponse(source, res || 'Adopted tactical squad formation.');
        return true;
    }

    if (/^assign\s+miner$/i.test(lower)) {
        const res = await executeCommand(agent, '!assignMiner');
        agent.routeResponse(source, res || 'Role assigned: ⛏️ SQUAD MINER.');
        return true;
    }

    if (/^assign\s+builder$/i.test(lower)) {
        const res = await executeCommand(agent, '!assignBuilder');
        agent.routeResponse(source, res || 'Role assigned: 🪵 SQUAD BUILDER.');
        return true;
    }

    if (/^assign\s+guard$/i.test(lower)) {
        const res = await executeCommand(agent, '!assignGuard');
        agent.routeResponse(source, res || 'Role assigned: 🛡️ SQUAD SENTINEL GUARD.');
        return true;
    }

    if (/^assign\s+farmer$/i.test(lower)) {
        const res = await executeCommand(agent, '!assignFarmer');
        agent.routeResponse(source, res || 'Role assigned: 🌾 SQUAD HARVESTER.');
        return true;
    }

    if (/^(?:share\s+food|feed\s+squad)$/i.test(lower)) {
        const res = await executeCommand(agent, '!shareFood');
        agent.routeResponse(source, res || 'Shared food rations with low-hunger teammates.');
        return true;
    }

    if (/^(?:distribute\s+supplies|share\s+gear)$/i.test(lower)) {
        const res = await executeCommand(agent, '!distributeSupplies');
        agent.routeResponse(source, res || 'Distributed surplus tools and armor.');
        return true;
    }

    if (/^(?:sync\s+coordinates|where\s+is\s+squad|squad\s+coords)$/i.test(lower)) {
        const res = await executeCommand(agent, '!syncCoordinates');
        agent.routeResponse(source, res || 'Synced coordinates with squad mates.');
        return true;
    }

    if (/^(?:assist\s+teammate|help\s+teammate|back\s+up)$/i.test(lower)) {
        const res = await executeCommand(agent, '!assistTeammate');
        agent.routeResponse(source, res || 'Rushing to assist teammate under attack.');
        return true;
    }

    // -------------------------------------------------------------
    // 13. ENVIRONMENT & REDSTONE
    // -------------------------------------------------------------
    if (/^(?:torch\s+perimeter|light\s+perimeter|light\s+up\s+area)$/i.test(lower)) {
        const res = await executeCommand(agent, '!torchPerimeter');
        agent.routeResponse(source, res || 'Illuminated perimeter with torches.');
        return true;
    }

    if (/^(?:check\s+light\s+level|light\s+level|is\s+it\s+dark)$/i.test(lower)) {
        const res = await executeCommand(agent, '!checkLightLevel');
        agent.routeResponse(source, res || 'Checked block light level.');
        return true;
    }

    if (/^(?:find\s+cave|locate\s+cave|where\s+is\s+cave)$/i.test(lower)) {
        const res = await executeCommand(agent, '!findCave');
        agent.routeResponse(source, res || 'Scanning for nearby cave openings.');
        return true;
    }

    if (/^open\s+door$/i.test(lower)) {
        const res = await executeCommand(agent, '!openDoor');
        agent.routeResponse(source, res || 'Opened door.');
        return true;
    }

    if (/^close\s+door$/i.test(lower)) {
        const res = await executeCommand(agent, '!closeDoor');
        agent.routeResponse(source, res || 'Closed door.');
        return true;
    }

    if (/^(?:pull\s+lever|flip\s+lever)$/i.test(lower)) {
        const res = await executeCommand(agent, '!pullLever');
        agent.routeResponse(source, res || 'Toggled redstone lever.');
        return true;
    }

    if (/^(?:press\s+button|push\s+button)$/i.test(lower)) {
        const res = await executeCommand(agent, '!pressButton');
        agent.routeResponse(source, res || 'Pressed stone button.');
        return true;
    }

    if (/^ring\s+bell$/i.test(lower)) {
        const res = await executeCommand(agent, '!ringBell');
        agent.routeResponse(source, res || 'Rang village bell.');
        return true;
    }

    if (/^(?:inspect\s+block|look\s+at\s+block)$/i.test(lower)) {
        const res = await executeCommand(agent, '!inspectBlock');
        agent.routeResponse(source, res || 'Inspected targeted block.');
        return true;
    }

    // -------------------------------------------------------------
    // 14. NAVIGATION & GESTURES
    // -------------------------------------------------------------
    if (/^(?:lead\s+way|guide\s+me)$/i.test(lower)) {
        const res = await executeCommand(agent, '!leadWay');
        agent.routeResponse(source, res || 'Leading the way forward.');
        return true;
    }

    if (/^(?:wander|explore)$/i.test(lower)) {
        const res = await executeCommand(agent, '!wander');
        agent.routeResponse(source, res || 'Exploring surrounding territory.');
        return true;
    }

    if (/^patrol$/i.test(lower)) {
        const res = await executeCommand(agent, '!patrol');
        agent.routeResponse(source, res || 'Patrolling local perimeter.');
        return true;
    }

    if (/^(?:stop\s+movement|halt\s+movement)$/i.test(lower)) {
        const res = await executeCommand(agent, '!stopMovement');
        agent.routeResponse(source, res || 'Halted navigation movement.');
        return true;
    }

    if (/^(?:dance|spin)$/i.test(lower)) {
        try {
            for (let i = 0; i < 4; i++) {
                await bot.look(bot.entity.yaw + Math.PI / 2, 0, true);
                await new Promise(r => setTimeout(r, 100));
            }
            bot.setControlState('sneak', true);
            setTimeout(() => bot.setControlState('sneak', false), 400);
            agent.routeResponse(source, '💃 Spun and danced!');
        } catch {}
        return true;
    }

    if (/^look\s+(north|south|east|west|up|down)$/i.test(lower)) {
        const dir = lower.match(/^look\s+(north|south|east|west|up|down)$/i)[1].toLowerCase();
        let yaw = bot.entity.yaw;
        let pitch = 0;
        if (dir === 'north') yaw = Math.PI;
        else if (dir === 'south') yaw = 0;
        else if (dir === 'east') yaw = -Math.PI / 2;
        else if (dir === 'west') yaw = Math.PI / 2;
        else if (dir === 'up') pitch = Math.PI / 3;
        else if (dir === 'down') pitch = -Math.PI / 3;
        try {
            await bot.look(yaw, pitch, true);
            agent.routeResponse(source, `Looking ${dir}.`);
        } catch {}
        return true;
    }

    return false;
}
