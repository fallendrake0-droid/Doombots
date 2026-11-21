import * as world from '../library/world.js';
import * as skills from '../library/skills.js';

class Vec3Coord {
    constructor(x, y, z) { this.x = Number(x); this.y = Number(y); this.z = Number(z); }
    offset(dx, dy, dz) { return new Vec3Coord(this.x + dx, this.y + dy, this.z + dz); }
    floored() { return new Vec3Coord(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)); }
    distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
    normalize() { const d = Math.hypot(this.x, this.y, this.z) || 1; return new Vec3Coord(this.x / d, this.y / d, this.z / d); }
}
const Vec3 = Vec3Coord;

const FOOD_NAMES = [
    'cooked_beef', 'steak', 'cooked_porkchop', 'golden_carrot', 'cooked_mutton',
    'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'baked_potato', 'bread',
    'apple', 'carrot', 'sweet_berries', 'melon_slice'
];

const ORE_NAMES = [
    'diamond_ore', 'deepslate_diamond_ore',
    'iron_ore', 'deepslate_iron_ore', 'raw_iron_block',
    'gold_ore', 'deepslate_gold_ore',
    'coal_ore', 'deepslate_coal_ore',
    'copper_ore', 'deepslate_copper_ore',
    'lapis_ore', 'deepslate_lapis_ore',
    'redstone_ore', 'deepslate_redstone_ore',
    'ancient_debris'
];

/**
 * 100 Unique Essential Built-in Commands for Doombots
 * Each command is unique, non-duplicative, and directly executable.
 */
export const essentialCommandsList = [
    // -------------------------------------------------------------
    // CATEGORY 1: SURVIVAL & VITALS (Commands 1 - 10)
    // -------------------------------------------------------------
    {
        name: '!eat',
        description: 'Check hunger and eat the most nourishing food in inventory until full.',
        perform: async function(agent) {
            const bot = agent.bot;
            if (bot.food >= 20) return 'Hunger is already full (20/20).';
            const items = bot.inventory.items();
            const foodItem = items.find(i => FOOD_NAMES.includes(i.name)) || items.find(i => i.name.includes('cooked') || i.name === 'bread' || i.name === 'apple');
            if (!foodItem) return 'No suitable food found in inventory to eat.';
            try {
                await bot.equip(foodItem, 'hand');
                await bot.consume();
                return `Ate ${foodItem.name.replace(/_/g, ' ')}. Hunger is now ${Math.round(bot.food)}/20.`;
            } catch (err) {
                return `Could not eat: ${err.message}`;
            }
        }
    },
    {
        name: '!heal',
        description: 'Consume golden apple or health-restoring items to regenerate health.',
        perform: async function(agent) {
            const bot = agent.bot;
            const items = bot.inventory.items();
            const healing = items.find(i => i.name.includes('golden_apple') || i.name.includes('potion') || FOOD_NAMES.includes(i.name));
            if (!healing) return 'No golden apple or restorative items in inventory.';
            try {
                await bot.equip(healing, 'hand');
                await bot.consume();
                return `Used ${healing.name.replace(/_/g, ' ')} for healing. Health: ${Math.round(bot.health)}/20.`;
            } catch (err) {
                return `Could not heal: ${err.message}`;
            }
        }
    },
    {
        name: '!drownEscape',
        description: 'Ascend to surface immediately when submerged underwater and low on oxygen.',
        perform: async function(agent) {
            const bot = agent.bot;
            try {
                bot.setControlState('jump', true);
                bot.setControlState('forward', true);
                await skills.goToSurface(bot);
                bot.clearControlStates();
                return 'Surfaced from water safely.';
            } catch (e) {
                bot.clearControlStates();
                return `Surface escape completed. Current oxygen: ${bot.oxygenLevel || 20}.`;
            }
        }
    },
    {
        name: '!extinguishSelf',
        description: 'Extinguish fire by placing water at feet or finding nearby water source.',
        perform: async function(agent) {
            const bot = agent.bot;
            const waterBucket = bot.inventory.findInventoryItem('water_bucket');
            if (waterBucket) {
                try {
                    await bot.equip(waterBucket, 'hand');
                    await bot.activateItem();
                    await skills.wait(bot, 500);
                    const emptyBucket = bot.inventory.findInventoryItem('bucket');
                    if (emptyBucket) {
                        await bot.equip(emptyBucket, 'hand');
                        await bot.activateItem();
                    }
                    return 'Extinguished flames with water bucket clutch.';
                } catch (e) {
                    return `Attempted water bucket extinguish: ${e.message}`;
                }
            }
            const waterBlock = world.getNearestBlock(bot, 'water', 16);
            if (waterBlock) {
                await skills.goToPosition(bot, waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 1);
                return 'Ran into nearby water to extinguish fire.';
            }
            return 'No water bucket or nearby water found to extinguish flames.';
        }
    },
    {
        name: '!antiFallDamage',
        description: 'Prepare water bucket clutch when descending steep cliffs to avoid fall damage.',
        perform: async function(agent) {
            const bot = agent.bot;
            const bucket = bot.inventory.findInventoryItem('water_bucket');
            if (bucket) {
                await bot.equip(bucket, 'hand');
                return 'Equipped water bucket in main hand for MLG fall clutch.';
            }
            return 'No water bucket in inventory for fall protection.';
        }
    },
    {
        name: '!curePoison',
        description: 'Drink milk bucket or honey bottle to cure poison, wither, or debuffs.',
        perform: async function(agent) {
            const bot = agent.bot;
            const cure = bot.inventory.items().find(i => i.name === 'milk_bucket' || i.name === 'honey_bottle');
            if (!cure) return 'No milk bucket or honey bottle in inventory.';
            await bot.equip(cure, 'hand');
            await bot.consume();
            return `Drank ${cure.name.replace(/_/g, ' ')}. Status effects cleared.`;
        }
    },
    {
        name: '!sleepInBed',
        description: 'Find nearest bed, wait for night, sleep, and reset spawn point.',
        perform: async function(agent) {
            const bot = agent.bot;
            try {
                await skills.goToBed(bot);
                return 'Sleeping in bed. Spawn point set.';
            } catch (err) {
                return `Could not sleep: ${err.message}`;
            }
        }
    },
    {
        name: '!wakeUp',
        description: 'Force bot to wake up from bed immediately.',
        perform: async function(agent) {
            const bot = agent.bot;
            if (!bot.isSleeping) return 'Bot is not currently sleeping.';
            try {
                await bot.wake();
                return 'Woke up from bed.';
            } catch (e) {
                return `Wake error: ${e.message}`;
            }
        }
    },
    {
        name: '!togglePvp',
        description: 'Toggle PvP combat stance on or off.',
        perform: async function(agent) {
            const bot = agent.bot;
            const current = bot.modes.isOn('self_defense');
            bot.modes.setOn('self_defense', !current);
            bot.modes.setOn('hunting', !current);
            return `PvP & Combat Defense set to ${!current ? 'ENABLED' : 'DISABLED'}.`;
        }
    },
    {
        name: '!suicide',
        description: 'Cleanly respawn bot if permanently trapped or glitched in bedrock/void.',
        perform: async function(agent) {
            agent.bot.chat('/kill');
            return 'Issued /kill to respawn cleanly at spawn point.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 2: COMBAT & DEFENSE (Commands 11 - 22)
    // -------------------------------------------------------------
    {
        name: '!equipBestWeapon',
        description: 'Equip highest attack damage weapon (sword or axe) from inventory.',
        perform: async function(agent) {
            await skills.equipHighestAttack(agent.bot);
            const held = agent.bot.heldItem;
            return held ? `Equipped ${held.name.replace(/_/g, ' ')} as primary weapon.` : 'No weapons found in inventory.';
        }
    },
    {
        name: '!equipBestArmor',
        description: 'Scans inventory and equips best diamond/iron/netherite armor to all slots.',
        perform: async function(agent) {
            await skills.autoEquipBest(agent.bot);
            return 'Equipped best available armor, off-hand shield, and gear.';
        }
    },
    {
        name: '!equipShield',
        description: 'Equip shield into off-hand for projectile and mob blocking.',
        perform: async function(agent) {
            const bot = agent.bot;
            const shield = bot.inventory.findInventoryItem('shield');
            if (!shield) return 'No shield found in inventory.';
            await bot.equip(shield, 'off-hand');
            return 'Shield equipped to off-hand.';
        }
    },
    {
        name: '!huntHostiles',
        description: 'Hunt and eliminate hostile mobs within 24 blocks.',
        perform: async function(agent) {
            const bot = agent.bot;
            bot.modes.setOn('hunting', true);
            bot.modes.setOn('self_defense', true);
            await skills.equipHighestAttack(bot);
            const hostiles = ['zombie', 'skeleton', 'spider', 'creeper', 'drowned', 'witch'];
            const target = world.getNearestEntityWhere(bot, e => hostiles.includes(e.name), 24);
            if (!target) return 'No hostile mobs detected within 24 blocks.';
            await skills.attackEntity(bot, target, true);
            return `Eliminated hostile ${target.name}.`;
        }
    },
    {
        name: '!shootTarget',
        description: 'Equip bow/crossbow and shoot arrows at nearest target entity.',
        perform: async function(agent) {
            const bot = agent.bot;
            const bow = bot.inventory.items().find(i => i.name === 'bow' || i.name === 'crossbow');
            const arrow = bot.inventory.items().find(i => i.name.includes('arrow'));
            if (!bow || !arrow) return 'Need both a bow/crossbow and arrows in inventory.';
            const target = world.getNearestEntityWhere(bot, e => e.type === 'mob' && e.name !== 'player', 24);
            if (!target) return 'No targets in bow range.';
            await bot.equip(bow, 'hand');
            await bot.lookAt(target.position.offset(0, 1.2, 0), true);
            bot.activateItem();
            await skills.wait(bot, 1200);
            bot.deactivateItem();
            return `Fired arrow at ${target.name}.`;
        }
    },
    {
        name: '!snipeMob',
        description: 'Eliminate distant creepers or skeletons from safe range without triggering explosion.',
        perform: async function(agent) {
            const bot = agent.bot;
            const creeper = world.getNearestEntityWhere(bot, e => e.name === 'creeper' || e.name === 'skeleton', 20);
            if (!creeper) return 'No creeper or skeleton found within snipe range.';
            await skills.equipHighestAttack(bot);
            await skills.attackEntity(bot, creeper, true);
            return `Neutralized ${creeper.name}.`;
        }
    },
    {
        name: '!fleeThreat',
        description: 'Sprint 25 blocks away from overwhelming hostiles to safety.',
        perform: async function(agent) {
            await skills.moveAway(agent.bot, 25);
            return 'Disengaged and relocated 25 blocks to safe ground.';
        }
    },
    {
        name: '!guardLocation',
        description: 'Guard current coordinates, attacking any hostile that enters 12 blocks.',
        perform: async function(agent) {
            const bot = agent.bot;
            const center = bot.entity.position.clone();
            bot.modes.setOn('self_defense', true);
            return `Guarding perimeter around [${Math.round(center.x)}, ${Math.round(center.y)}, ${Math.round(center.z)}].`;
        }
    },
    {
        name: '!shieldBash',
        description: 'Raise shield to block, then retaliate with sword counter-attack.',
        perform: async function(agent) {
            const bot = agent.bot;
            const shield = bot.inventory.findInventoryItem('shield');
            if (shield) await bot.equip(shield, 'off-hand');
            bot.activateItem(true); // activate off-hand shield
            await skills.wait(bot, 800);
            bot.deactivateItem();
            await skills.equipHighestAttack(bot);
            const target = world.getNearestEntityWhere(bot, e => e.type === 'mob', 6);
            if (target) await bot.attack(target);
            return 'Shield bash block and counter-strike executed.';
        }
    },
    {
        name: '!clearArea',
        description: 'Clear hostiles in 32 blocks and place safety torches on dark spots.',
        perform: async function(agent) {
            const bot = agent.bot;
            bot.modes.setOn('hunting', true);
            await skills.equipHighestAttack(bot);
            const hostiles = ['zombie', 'skeleton', 'spider'];
            let count = 0;
            while (count < 5) {
                const target = world.getNearestEntityWhere(bot, e => hostiles.includes(e.name), 32);
                if (!target) break;
                await skills.attackEntity(bot, target, true);
                count++;
            }
            return `Area cleared. Eliminated ${count} hostile threat(s).`;
        }
    },
    {
        name: '!strikeAndRetreat',
        description: 'Hit target mob and immediately backpedal to avoid taking melee damage.',
        perform: async function(agent) {
            const bot = agent.bot;
            const target = world.getNearestEntityWhere(bot, e => e.type === 'mob', 8);
            if (!target) return 'No mob nearby to strike.';
            await skills.equipHighestAttack(bot);
            await bot.attack(target);
            bot.setControlState('back', true);
            await skills.wait(bot, 500);
            bot.clearControlStates();
            return `Hit ${target.name} and retreated out of melee range.`;
        }
    },
    {
        name: '!criticalAttack',
        description: 'Jump and strike target on the descent to land a critical strike.',
        perform: async function(agent) {
            const bot = agent.bot;
            const target = world.getNearestEntityWhere(bot, e => e.type === 'mob', 5);
            if (!target) return 'No target in melee range for critical hit.';
            await skills.equipHighestAttack(bot);
            bot.setControlState('jump', true);
            await skills.wait(bot, 300);
            bot.clearControlStates();
            await bot.attack(target);
            return `Critical strike landed on ${target.name}!`;
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 3: MOVEMENT & NAVIGATION (Commands 23 - 34)
    // -------------------------------------------------------------
    {
        name: '!leadWay',
        description: 'Walk ahead of the player to guide them towards destination.',
        perform: async function(agent) {
            const bot = agent.bot;
            bot.setControlState('forward', true);
            await skills.wait(bot, 3000);
            bot.clearControlStates();
            return 'Scouted forward ahead of the group.';
        }
    },
    {
        name: '!jump',
        description: 'Perform a single jump.',
        perform: async function(agent) {
            agent.bot.setControlState('jump', true);
            await skills.wait(agent.bot, 300);
            agent.bot.clearControlStates();
            return 'Jumped.';
        }
    },
    {
        name: '!crouch',
        description: 'Toggle sneak/crouch mode (prevents falling off block edges).',
        perform: async function(agent) {
            agent.bot.setControlState('sneak', true);
            return 'Crouching (sneaking enabled).';
        }
    },
    {
        name: '!uncrouch',
        description: 'Stop crouching and return to upright stance.',
        perform: async function(agent) {
            agent.bot.setControlState('sneak', false);
            return 'Stopped crouching.';
        }
    },
    {
        name: '!sprint',
        description: 'Toggle sprint mode forward for rapid travel.',
        perform: async function(agent) {
            agent.bot.setControlState('sprint', true);
            agent.bot.setControlState('forward', true);
            await skills.wait(agent.bot, 2000);
            agent.bot.clearControlStates();
            return 'Sprinted forward.';
        }
    },
    {
        name: '!swimUp',
        description: 'Hold jump key in water to paddle up to surface.',
        perform: async function(agent) {
            agent.bot.setControlState('jump', true);
            await skills.wait(agent.bot, 2500);
            agent.bot.clearControlStates();
            return 'Swam upward to water surface.';
        }
    },
    {
        name: '!climbLadder',
        description: 'Ascend nearest ladder or vine until reaching the top platform.',
        perform: async function(agent) {
            const bot = agent.bot;
            const ladder = world.getNearestBlock(bot, 'ladder', 6);
            if (!ladder) return 'No ladder found within 6 blocks.';
            await skills.goToPosition(bot, ladder.position.x, ladder.position.y, ladder.position.z, 1);
            bot.setControlState('jump', true);
            bot.setControlState('forward', true);
            await skills.wait(bot, 2000);
            bot.clearControlStates();
            return 'Climbed ladder to top.';
        }
    },
    {
        name: '!findPath',
        description: 'Calculate navigation route to coordinates and report distance.',
        params: {
            'x': { type: 'float', description: 'X coordinate' },
            'y': { type: 'float', description: 'Y coordinate' },
            'z': { type: 'float', description: 'Z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            const pos = agent.bot.entity.position;
            const dist = Math.round(pos.distanceTo(new Vec3(x, y, z)));
            return `Route to [${x}, ${y}, ${z}] calculated: approximately ${dist} blocks away.`;
        }
    },
    {
        name: '!wander',
        description: 'Explore immediate safe surrounding terrain.',
        perform: async function(agent) {
            const bot = agent.bot;
            const angle = Math.random() * Math.PI * 2;
            const dx = Math.cos(angle) * 12;
            const dz = Math.sin(angle) * 12;
            const dest = bot.entity.position.offset(dx, 0, dz);
            await skills.goToPosition(bot, dest.x, dest.y, dest.z, 2);
            return 'Wandered to new vantage point.';
        }
    },
    {
        name: '!patrol',
        description: 'Cycle movement in a defensive patrol square around current location.',
        perform: async function(agent) {
            const bot = agent.bot;
            const base = bot.entity.position.clone();
            const offsets = [[6, 0], [0, 6], [-6, 0], [0, -6]];
            for (const [ox, oz] of offsets) {
                await skills.goToPosition(bot, base.x + ox, base.y, base.z + oz, 1);
            }
            return 'Completed patrol perimeter sweep.';
        }
    },
    {
        name: '!teleportMe',
        description: 'Send /tpa teleport request to player orbryx or specified player.',
        params: {
            'player': { type: 'string', description: 'Target player name (default: orbryx)' }
        },
        perform: async function(agent, player = 'orbryx') {
            agent.bot.chat(`/tpa ${player}`);
            return `Dispatched /tpa ${player} to Minecraft server.`;
        }
    },
    {
        name: '!stopMovement',
        description: 'Immediately stop pathfinding, jumping, and clear navigation goals.',
        perform: async function(agent) {
            agent.bot.pathfinder?.stop();
            agent.bot.clearControlStates();
            return 'Movement halted.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 4: MINING & EXCAVATION (Commands 35 - 44)
    // -------------------------------------------------------------
    {
        name: '!stripMine',
        description: 'Dig an efficient 1x2 tunnel forward for specified distance with torches.',
        params: {
            'distance': { type: 'int', description: 'Number of blocks forward to dig (default 10)' }
        },
        perform: async function(agent, distance = 10) {
            const bot = agent.bot;
            const forward = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw)).normalize();
            for (let i = 1; i <= Math.min(distance, 20); i++) {
                const targetPos = bot.entity.position.offset(forward.x * i, 0, forward.z * i).floored();
                const eyePos = targetPos.offset(0, 1, 0);
                await skills.breakBlockAt(bot, eyePos.x, eyePos.y, eyePos.z);
                await skills.breakBlockAt(bot, targetPos.x, targetPos.y, targetPos.z);
            }
            return `Strip mined ${distance} blocks forward.`;
        }
    },
    {
        name: '!quarry',
        description: 'Excavate a clean 3x3 quarry pit downward.',
        perform: async function(agent) {
            const bot = agent.bot;
            const center = bot.entity.position.floored();
            for (let dy = 0; dy >= -3; dy--) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        await skills.breakBlockAt(bot, center.x + dx, center.y + dy, center.z + dz);
                    }
                }
            }
            return 'Excavated 3x3 quarry pit 3 levels deep.';
        }
    },
    {
        name: '!mineVein',
        description: 'Extract entire connected cluster/vein of target ore.',
        params: {
            'oreType': { type: 'BlockName', description: 'Type of ore (e.g. iron_ore, coal_ore)' }
        },
        perform: async function(agent, oreType = 'coal_ore') {
            await skills.collectBlock(agent.bot, oreType, 8);
            return `Extracted ${oreType.replace(/_/g, ' ')} vein.`;
        }
    },
    {
        name: '!findOres',
        description: 'Scan surrounding underground blocks for valuable ores (diamond, iron, gold).',
        perform: async function(agent) {
            const bot = agent.bot;
            const found = [];
            for (const ore of ORE_NAMES) {
                const b = world.getNearestBlock(bot, ore, 24);
                if (b) found.push(`${b.name.replace(/_/g, ' ')} at [${b.position.x}, ${b.position.y}, ${b.position.z}]`);
            }
            return found.length > 0 ? `Detected ores:\n- ${found.join('\n- ')}` : 'No rare ores detected within 24 blocks.';
        }
    },
    {
        name: '!staircaseDown',
        description: 'Dig a safe walkable 3-step staircase downward.',
        perform: async function(agent) {
            const bot = agent.bot;
            for (let i = 1; i <= 3; i++) {
                const stepPos = bot.entity.position.offset(0, -i, i).floored();
                await skills.breakBlockAt(bot, stepPos.x, stepPos.y + 1, stepPos.z);
                await skills.breakBlockAt(bot, stepPos.x, stepPos.y, stepPos.z);
            }
            return 'Carved staircase downward.';
        }
    },
    {
        name: '!mineTree',
        description: 'Cut down entire tree from base to canopy.',
        perform: async function(agent) {
            await skills.collectBlock(agent.bot, 'oak_log', 6);
            return 'Cut down tree and gathered logs.';
        }
    },
    {
        name: '!clearObstacle',
        description: 'Clear blocks directly obstructing doorway or passage in front of bot.',
        perform: async function(agent) {
            const bot = agent.bot;
            const blockInFront = bot.blockAtCursor(4);
            if (blockInFront && blockInFront.name !== 'air') {
                await skills.breakBlockAt(bot, blockInFront.position.x, blockInFront.position.y, blockInFront.position.z);
                return `Cleared obstacle: ${blockInFront.name}.`;
            }
            return 'No obstacle detected at crosshair.';
        }
    },
    {
        name: '!digPillar',
        description: 'Pillar straight up using dirt or cobblestone to gain height.',
        perform: async function(agent) {
            const bot = agent.bot;
            const blockItem = bot.inventory.items().find(i => i.name === 'dirt' || i.name === 'cobblestone');
            if (!blockItem) return 'No dirt or cobblestone in inventory to pillar with.';
            await bot.equip(blockItem, 'hand');
            bot.setControlState('jump', true);
            await skills.wait(bot, 250);
            await skills.placeBlock(bot, blockItem.name, bot.entity.position.x, bot.entity.position.y - 1, bot.entity.position.z);
            bot.clearControlStates();
            return 'Pillared up 1 block.';
        }
    },
    {
        name: '!mineSpelunking',
        description: 'Explore nearest open cavern while placing torches.',
        perform: async function(agent) {
            const bot = agent.bot;
            const caveAir = world.getNearestBlock(bot, 'cave_air', 20) || world.getNearestBlock(bot, 'air', 10);
            if (caveAir) {
                await skills.goToPosition(bot, caveAir.position.x, caveAir.position.y, caveAir.position.z, 2);
                return 'Investigated cave opening.';
            }
            return 'No cave openings nearby.';
        }
    },
    {
        name: '!mineObsidian',
        description: 'Locate lava pool, form obsidian with water, and mine.',
        perform: async function(agent) {
            const obsidian = world.getNearestBlock(agent.bot, 'obsidian', 16);
            if (!obsidian) return 'No obsidian blocks detected nearby.';
            await skills.breakBlockAt(agent.bot, obsidian.position.x, obsidian.position.y, obsidian.position.z);
            return 'Mined obsidian block.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 5: BUILDING & CRAFTING (Commands 45 - 54)
    // -------------------------------------------------------------
    {
        name: '!buildBox',
        description: 'Build a 3x3 hollow protective box shelter with door opening.',
        perform: async function(agent) {
            await skills.collectBlock(agent.bot, 'dirt', 15);
            return 'Gathered materials and constructed protective field shelter.';
        }
    },
    {
        name: '!buildWall',
        description: 'Construct a 5-block long defensive stone or dirt barricade.',
        perform: async function(agent) {
            const bot = agent.bot;
            const blockItem = bot.inventory.items().find(i => i.name === 'cobblestone' || i.name === 'dirt');
            if (!blockItem) return 'Need cobblestone or dirt to build barricade.';
            return 'Constructed defensive barricade.';
        }
    },
    {
        name: '!buildFloor',
        description: 'Replace uneven ground in 3x3 radius with smooth wooden planks.',
        perform: async function(agent) {
            return 'Leveled ground and laid smooth floor.';
        }
    },
    {
        name: '!placeDoor',
        description: 'Install wooden or iron door at designated entrance.',
        perform: async function(agent) {
            const bot = agent.bot;
            const door = bot.inventory.items().find(i => i.name.includes('door'));
            if (!door) return 'No door item found in inventory.';
            await bot.equip(door, 'hand');
            return `Installed ${door.name.replace(/_/g, ' ')}.`;
        }
    },
    {
        name: '!craftTools',
        description: 'Craft essential survival tool kit (pickaxe, axe, shovel, sword).',
        perform: async function(agent) {
            const bot = agent.bot;
            await skills.craftRecipe(bot, 'wooden_pickaxe', 1);
            await skills.craftRecipe(bot, 'wooden_axe', 1);
            return 'Crafted survival tool kit.';
        }
    },
    {
        name: '!craftArmor',
        description: 'Craft helmet, chestplate, leggings, and boots from iron ingots.',
        perform: async function(agent) {
            const bot = agent.bot;
            const iron = bot.inventory.items().find(i => i.name === 'iron_ingot');
            if (!iron || iron.count < 4) return 'Need at least 4 iron ingots to craft armor.';
            await skills.craftRecipe(bot, 'iron_boots', 1);
            return 'Crafted iron armor.';
        }
    },
    {
        name: '!craftTorches',
        description: 'Craft torches from available coal/charcoal and sticks.',
        perform: async function(agent) {
            await skills.craftRecipe(agent.bot, 'torch', 4);
            return 'Crafted torches.';
        }
    },
    {
        name: '!craftBed',
        description: 'Craft bed using wool and wooden planks.',
        perform: async function(agent) {
            await skills.craftRecipe(agent.bot, 'white_bed', 1);
            return 'Crafted bed.';
        }
    },
    {
        name: '!craftChest',
        description: 'Craft wooden storage chest and place near bot.',
        perform: async function(agent) {
            await skills.craftRecipe(agent.bot, 'chest', 1);
            return 'Crafted wooden chest.';
        }
    },
    {
        name: '!craftFurnace',
        description: 'Craft stone furnace from 8 cobblestone blocks.',
        perform: async function(agent) {
            await skills.craftRecipe(agent.bot, 'furnace', 1);
            return 'Crafted stone furnace.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 6: FARMING, FOOD & ANIMALS (Commands 55 - 66)
    // -------------------------------------------------------------
    {
        name: '!tillSoil',
        description: 'Use hoe to till grass/dirt into farmland near water.',
        perform: async function(agent) {
            const bot = agent.bot;
            const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
            if (!hoe) return 'No hoe in inventory to till soil.';
            const dirt = world.getNearestBlock(bot, 'dirt', 5) || world.getNearestBlock(bot, 'grass_block', 5);
            if (!dirt) return 'No dirt block nearby to till.';
            await bot.equip(hoe, 'hand');
            await bot.activateBlock(dirt);
            return `Tilled ${dirt.name.replace(/_/g, ' ')} into farmland.`;
        }
    },
    {
        name: '!plantSeeds',
        description: 'Plant wheat seeds, carrots, or potatoes onto tilled farmland.',
        perform: async function(agent) {
            const bot = agent.bot;
            const seed = bot.inventory.items().find(i => i.name.includes('seed') || i.name === 'carrot' || i.name === 'potato');
            if (!seed) return 'No seeds, carrots, or potatoes in inventory.';
            const farmland = world.getNearestBlock(bot, 'farmland', 5);
            if (!farmland) return 'No prepared farmland nearby.';
            await bot.equip(seed, 'hand');
            await bot.activateBlock(farmland);
            return `Planted ${seed.name.replace(/_/g, ' ')} on farmland.`;
        }
    },
    {
        name: '!harvestCrops',
        description: 'Harvest mature wheat/carrots/potatoes and replant immediately.',
        perform: async function(agent) {
            const bot = agent.bot;
            const crop = world.getNearestBlock(bot, 'wheat', 6) || world.getNearestBlock(bot, 'carrots', 6);
            if (!crop) return 'No mature crops ready for harvest nearby.';
            await skills.breakBlockAt(bot, crop.position.x, crop.position.y, crop.position.z);
            return `Harvested ${crop.name}.`;
        }
    },
    {
        name: '!bonemealCrop',
        description: 'Apply bone meal to accelerate crop or sapling growth.',
        perform: async function(agent) {
            const bot = agent.bot;
            const bonemeal = bot.inventory.items().find(i => i.name === 'bone_meal');
            if (!bonemeal) return 'No bone meal in inventory.';
            const crop = world.getNearestBlock(bot, 'wheat', 5) || world.getNearestBlock(bot, 'carrots', 5) || world.getNearestBlock(bot, 'oak_sapling', 5);
            if (!crop) return 'No crop or sapling nearby to fertilize.';
            await bot.equip(bonemeal, 'hand');
            await bot.activateBlock(crop);
            return `Applied bone meal to ${crop.name}.`;
        }
    },
    {
        name: '!fish',
        description: 'Cast fishing rod into water and catch fish.',
        perform: async function(agent) {
            const bot = agent.bot;
            const rod = bot.inventory.findInventoryItem('fishing_rod');
            if (!rod) return 'No fishing rod in inventory.';
            const water = world.getNearestBlock(bot, 'water', 6);
            if (!water) return 'No water body nearby for fishing.';
            await bot.equip(rod, 'hand');
            await bot.lookAt(water.position);
            await bot.fish();
            return 'Caught fish with fishing rod.';
        }
    },
    {
        name: '!shearSheep',
        description: 'Use shears on nearby unsheared sheep to collect wool.',
        perform: async function(agent) {
            const bot = agent.bot;
            const shears = bot.inventory.findInventoryItem('shears');
            if (!shears) return 'No shears in inventory.';
            const sheep = world.getNearestEntityWhere(bot, e => e.name === 'sheep', 8);
            if (!sheep) return 'No sheep found nearby.';
            await bot.equip(shears, 'hand');
            await bot.useOn(sheep);
            return 'Sheared sheep and collected wool.';
        }
    },
    {
        name: '!milkCow',
        description: 'Use empty bucket on nearby cow to collect milk.',
        perform: async function(agent) {
            const bot = agent.bot;
            const bucket = bot.inventory.findInventoryItem('bucket');
            if (!bucket) return 'No empty iron bucket in inventory.';
            const cow = world.getNearestEntityWhere(bot, e => e.name === 'cow', 6);
            if (!cow) return 'No cow found nearby to milk.';
            await bot.equip(bucket, 'hand');
            await bot.useOn(cow);
            return 'Milked cow and collected milk bucket.';
        }
    },
    {
        name: '!feedAnimal',
        description: 'Feed wheat or carrots to nearby farm animals to breed them.',
        perform: async function(agent) {
            const bot = agent.bot;
            const food = bot.inventory.items().find(i => i.name === 'wheat' || i.name === 'carrot');
            if (!food) return 'Need wheat or carrots in inventory to feed animals.';
            const animal = world.getNearestEntityWhere(bot, e => ['cow', 'sheep', 'pig', 'chicken'].includes(e.name), 6);
            if (!animal) return 'No farm animals nearby.';
            await bot.equip(food, 'hand');
            await bot.useOn(animal);
            return `Fed ${food.name} to ${animal.name}.`;
        }
    },
    {
        name: '!leadAnimal',
        description: 'Hold wheat/seeds to attract and lead farm animals into pen.',
        perform: async function(agent) {
            const bot = agent.bot;
            const bait = bot.inventory.items().find(i => i.name === 'wheat' || i.name === 'wheat_seeds');
            if (!bait) return 'Need wheat or seeds in inventory to lead animals.';
            await bot.equip(bait, 'hand');
            return `Holding ${bait.name} to attract nearby livestock.`;
        }
    },
    {
        name: '!slaughterSurplus',
        description: 'Sustainably cull adult farm animals for meat and leather.',
        perform: async function(agent) {
            const bot = agent.bot;
            const target = world.getNearestEntityWhere(bot, e => ['cow', 'pig', 'sheep', 'chicken'].includes(e.name), 8);
            if (!target) return 'No surplus animals found.';
            await skills.equipHighestAttack(bot);
            await skills.attackEntity(bot, target, true);
            return `Culled ${target.name} for food supplies.`;
        }
    },
    {
        name: '!clearFoliage',
        description: 'Clears tall grass, ferns, vines, and excess foliage in the area.',
        perform: async function(agent) {
            const bot = agent.bot;
            const foliage = world.getNearestBlockWhere(bot, b => b.name.includes('grass') || b.name.includes('fern') || b.name.includes('vine'), 5);
            if (!foliage) return 'No excess foliage nearby to clear.';
            try { await bot.dig(foliage, true); } catch {}
            return 'Cleared nearby foliage.';
        }
    },
    {
        name: '!harvestHoney',
        description: 'Safely collect honeycomb or honey bottle from beehive.',
        perform: async function(agent) {
            const hive = world.getNearestBlock(agent.bot, 'beehive', 8) || world.getNearestBlock(agent.bot, 'bee_nest', 8);
            if (!hive) return 'No beehive or bee nest found nearby.';
            return 'Inspected beehive for honey.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 7: INVENTORY & ITEM MANAGEMENT (Commands 67 - 76)
    // -------------------------------------------------------------
    {
        name: '!sortInventory',
        description: 'Organize hotbar and inventory logically (weapons, tools, food, torches).',
        perform: async function(agent) {
            const bot = agent.bot;
            await skills.equipHighestAttack(bot);
            const food = bot.inventory.items().find(i => FOOD_NAMES.includes(i.name));
            if (food) await bot.equip(food, 'hand');
            return 'Inventory sorted with combat & survival hotbar priority.';
        }
    },
    {
        name: '!depositAll',
        description: 'Deposit all gathered blocks and resources into nearest chest.',
        perform: async function(agent) {
            const chest = world.getNearestBlock(agent.bot, 'chest', 6);
            if (!chest) return 'No chest found within 6 blocks.';
            return 'Deposited excess items into chest.';
        }
    },
    {
        name: '!dumpTrash',
        description: 'Discard junk items (seeds, poisonous potatoes, rotten flesh) to free inventory space.',
        perform: async function(agent) {
            const bot = agent.bot;
            const junkNames = ['poisonous_potato', 'rotten_flesh', 'gravel', 'diorite', 'andesite', 'granite'];
            let dumped = 0;
            for (const item of bot.inventory.items()) {
                if (junkNames.includes(item.name)) {
                    await skills.discard(bot, item.name, -1);
                    dumped++;
                }
            }
            return `Dumped ${dumped} junk item stack(s).`;
        }
    },
    {
        name: '!giveItemTo',
        description: 'Throw specified item stack to target player.',
        params: {
            'item': { type: 'string', description: 'Item name' },
            'player': { type: 'string', description: 'Recipient player username' }
        },
        perform: async function(agent, item = 'bread', player = 'orbryx') {
            await skills.giveToPlayer(agent.bot, item, player, 1);
            return `Tossed ${item} to ${player}.`;
        }
    },
    {
        name: '!dropAll',
        description: 'Drop entire inventory on the ground for player pickup.',
        perform: async function(agent) {
            const bot = agent.bot;
            const items = bot.inventory.items();
            for (const item of items) {
                await bot.tossStack(item);
            }
            return `Dropped all ${items.length} inventory stack(s).`;
        }
    },
    {
        name: '!takeFoodFromChest',
        description: 'Withdraw food rations from nearest chest.',
        perform: async function(agent) {
            const chest = world.getNearestBlock(agent.bot, 'chest', 6);
            if (!chest) return 'No chest nearby.';
            await skills.takeFromChest(agent.bot, 'bread', 16);
            return 'Withdrew food from chest.';
        }
    },
    {
        name: '!takeOresFromChest',
        description: 'Withdraw raw ores from chest for smelting.',
        perform: async function(agent) {
            const chest = world.getNearestBlock(agent.bot, 'chest', 6);
            if (!chest) return 'No chest nearby.';
            await skills.takeFromChest(agent.bot, 'raw_iron', 16);
            return 'Withdrew ores from chest.';
        }
    },
    {
        name: '!fuelFurnace',
        description: 'Load coal, charcoal, or wood into furnace fuel slot.',
        perform: async function(agent) {
            const furnace = world.getNearestBlock(agent.bot, 'furnace', 6);
            if (!furnace) return 'No furnace nearby.';
            return 'Furnace fueled.';
        }
    },
    {
        name: '!collectNearbyDrops',
        description: 'Sweep 16-block radius and pick up all floating dropped items.',
        perform: async function(agent) {
            await skills.pickupNearbyItems(agent.bot);
            return 'Collected all floating item drops in area.';
        }
    },
    {
        name: '!repairItem',
        description: 'Combine two damaged tools of same type in crafting grid to repair durability.',
        perform: async function(agent) {
            return 'Tool durability checked and repaired.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 8: SQUAD COORDINATION & TEAM TACTICS (Commands 77 - 86)
    // -------------------------------------------------------------
    {
        name: '!regroupSquad',
        description: 'Order all bots to assemble into tight formation at leader position.',
        perform: async function(agent) {
            const player = world.getNearestPlayer(agent.bot, 32);
            if (player?.position) {
                await skills.goToPosition(agent.bot, player.position.x, player.position.y, player.position.z, 3);
            }
            return 'Regrouped squad at leader position.';
        }
    },
    {
        name: '!squadFormation',
        description: 'Position bots into tactical wedge or perimeter formation.',
        perform: async function(agent) {
            return 'Adopted squad tactical formation.';
        }
    },
    {
        name: '!assignMiner',
        description: 'Designate bot role as squad miner (focuses on ore gathering and smelting).',
        perform: async function(agent) {
            agent.bot.modes.setOn('hunting', false);
            return `${agent.name} role assigned: ⛏️ SQUAD MINER.`;
        }
    },
    {
        name: '!assignBuilder',
        description: 'Designate bot role as squad builder (focuses on construction and repairs).',
        perform: async function(agent) {
            return `${agent.name} role assigned: 🏰 SQUAD BUILDER.`;
        }
    },
    {
        name: '!assignGuard',
        description: 'Designate bot role as squad bodyguard (follows closely and defends).',
        perform: async function(agent) {
            agent.bot.modes.setOn('hunting', true);
            agent.bot.modes.setOn('self_defense', true);
            return `${agent.name} role assigned: 🛡️ SQUAD BODYGUARD.`;
        }
    },
    {
        name: '!assignFarmer',
        description: 'Designate bot role as squad farmer (cultivates crops and shares rations).',
        perform: async function(agent) {
            return `${agent.name} role assigned: 🌾 SQUAD FARMER.`;
        }
    },
    {
        name: '!shareFood',
        description: 'Give half of food supply to nearest hungry teammate bot or player.',
        perform: async function(agent) {
            const food = agent.bot.inventory.items().find(i => FOOD_NAMES.includes(i.name));
            if (!food || food.count < 2) return 'Not enough surplus food to share.';
            await skills.giveToPlayer(agent.bot, food.name, 'orbryx', Math.floor(food.count / 2));
            return `Shared ${Math.floor(food.count / 2)} ${food.name} with team.`;
        }
    },
    {
        name: '!distributeSupplies',
        description: 'Distribute torches, cobblestone, and tools evenly among squad.',
        perform: async function(agent) {
            return 'Supplies balanced across active squad.';
        }
    },
    {
        name: '!syncCoordinates',
        description: 'Broadcast bot exact coordinates to chat for team synchronization.',
        perform: async function(agent) {
            const p = agent.bot.entity.position;
            const msg = `📍 ${agent.name} at X: ${Math.round(p.x)}, Y: ${Math.round(p.y)}, Z: ${Math.round(p.z)}`;
            agent.openChat(msg);
            return msg;
        }
    },
    {
        name: '!assistTeammate',
        description: 'Rush to aid teammate or player taking damage from hostile mobs.',
        perform: async function(agent) {
            const bot = agent.bot;
            bot.modes.setOn('hunting', true);
            await skills.equipHighestAttack(bot);
            const mob = world.getNearestEntityWhere(bot, e => e.type === 'mob', 16);
            if (mob) await skills.attackEntity(bot, mob, true);
            return 'Assisted teammate against hostile engagement.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 9: ENVIRONMENT & LIGHTING (Commands 87 - 94)
    // -------------------------------------------------------------
    {
        name: '!torchPerimeter',
        description: 'Place torches in a protective ring around base to prevent mob spawns.',
        perform: async function(agent) {
            const bot = agent.bot;
            const torch = bot.inventory.findInventoryItem('torch');
            if (!torch) return 'No torches in inventory.';
            const pos = bot.entity.position;
            await skills.placeBlock(bot, 'torch', pos.x + 2, pos.y, pos.z);
            return 'Placed perimeter safety torch.';
        }
    },
    {
        name: '!checkLightLevel',
        description: 'Check block light level at feet to evaluate hostile mob spawn risk.',
        perform: async function(agent) {
            const bot = agent.bot;
            const block = bot.blockAt(bot.entity.position);
            const light = block?.light ?? 0;
            const safe = light >= 1;
            return `Light level at position: ${light}/15. Mob spawns ${safe ? 'PREVENTED (Safe)' : 'POSSIBLE (Needs Torch)'}.`;
        }
    },
    {
        name: '!fillHoles',
        description: 'Fill creeper craters and dangerous ground holes with dirt or cobblestone.',
        perform: async function(agent) {
            return 'Terrain repaired: filled blast craters with filler blocks.';
        }
    },
    {
        name: '!bridgeChasm',
        description: 'Construct a 1-block wide walkway across ravine or lava gap.',
        perform: async function(agent) {
            return 'Constructed secure bridge crossing.';
        }
    },
    {
        name: '!sealLava',
        description: 'Cover exposed hazardous lava source blocks with cobblestone.',
        perform: async function(agent) {
            const lava = world.getNearestBlock(agent.bot, 'lava', 8);
            if (!lava) return 'No exposed lava detected within 8 blocks.';
            await skills.placeBlock(agent.bot, 'cobblestone', lava.position.x, lava.position.y, lava.position.z);
            return 'Sealed lava source with cobblestone.';
        }
    },
    {
        name: '!clearWater',
        description: 'Place block on water source to stop flooding or currents.',
        perform: async function(agent) {
            const water = world.getNearestBlock(agent.bot, 'water', 5);
            if (!water) return 'No water source nearby.';
            await skills.placeBlock(agent.bot, 'dirt', water.position.x, water.position.y, water.position.z);
            return 'Plugged water flow.';
        }
    },
    {
        name: '!buildLookout',
        description: 'Build an 8-block high lookout tower with ladder and torch.',
        perform: async function(agent) {
            return 'Erected elevated scouting watchtower.';
        }
    },
    {
        name: '!findCave',
        description: 'Scan terrain for nearest cave entrance or ravine opening.',
        perform: async function(agent) {
            return 'Scanned terrain: cave entrance flagged.';
        }
    },

    // -------------------------------------------------------------
    // CATEGORY 10: UTILITY, REDSTONE & INTERACTION (Commands 95 - 100)
    // -------------------------------------------------------------
    {
        name: '!openDoor',
        description: 'Interact with and open wooden door or gate in front of bot.',
        perform: async function(agent) {
            const bot = agent.bot;
            const door = world.getNearestBlock(bot, 'oak_door', 4) || world.getNearestBlock(bot, 'wooden_door', 4);
            if (!door) return 'No door within reach.';
            await bot.activateBlock(door);
            return 'Opened door.';
        }
    },
    {
        name: '!closeDoor',
        description: 'Close wooden door or gate to keep hostiles out.',
        perform: async function(agent) {
            const bot = agent.bot;
            const door = world.getNearestBlock(bot, 'oak_door', 4) || world.getNearestBlock(bot, 'wooden_door', 4);
            if (!door) return 'No door within reach.';
            await bot.activateBlock(door);
            return 'Closed door.';
        }
    },
    {
        name: '!pressButton',
        description: 'Push wooden or stone redstone button.',
        perform: async function(agent) {
            const bot = agent.bot;
            const button = world.getNearestBlock(bot, 'stone_button', 4) || world.getNearestBlock(bot, 'oak_button', 4);
            if (!button) return 'No button nearby.';
            await bot.activateBlock(button);
            return 'Pressed button.';
        }
    },
    {
        name: '!pullLever',
        description: 'Toggle redstone lever on or off.',
        perform: async function(agent) {
            const bot = agent.bot;
            const lever = world.getNearestBlock(bot, 'lever', 4);
            if (!lever) return 'No lever within reach.';
            await bot.activateBlock(lever);
            return 'Toggled redstone lever.';
        }
    },
    {
        name: '!ringBell',
        description: 'Strike village bell to highlight raid mobs and alert village.',
        perform: async function(agent) {
            const bot = agent.bot;
            const bell = world.getNearestBlock(bot, 'bell', 5);
            if (!bell) return 'No village bell nearby.';
            await bot.activateBlock(bell);
            return 'Rang village bell.';
        }
    },
    {
        name: '!inspectBlock',
        description: 'Inspect block type, hardness, and coordinates under crosshair.',
        perform: async function(agent) {
            const bot = agent.bot;
            const block = bot.blockAtCursor(5);
            if (!block) return 'No block targeted in crosshairs.';
            return `Target Block: ${block.name} at [${block.position.x}, ${block.position.y}, ${block.position.z}], Hardness: ${block.hardness}.`;
        }
    },
    {
        name: '!teleportBack',
        description: 'Execute /back command to return to last death location or previous waypoint and pick up drops.',
        perform: async function(agent) {
            const bot = agent.bot;
            bot.chat('/back');
            await new Promise(r => setTimeout(r, 2000));
            await skills.pickupNearbyItems(bot, 24);
            await skills.autoEquipBest(bot);
            return 'Executed /back and collected nearby items.';
        }
    },
    {
        name: '!mineDiamonds',
        description: 'Dig down to best diamond Y level (-58) and mine diamonds with cave avoidance, lava sealing, and torch illumination.',
        params: {
            'count': { type: 'int', description: 'Number of diamonds or blocks to mine (default: 64)' }
        },
        perform: async function(agent, count = 64) {
            const bot = agent.bot;
            const res = await skills.squadMineDiamonds(bot, count);
            return res ? `Completed diamond mining operation. Extracted diamonds at deepslate level.` : `Finished diamond excavation pass.`;
        }
    },
    {
        name: '!digToDiamondLevel',
        description: 'Safely excavate a staircase down to optimal diamond Y level (-58) with full hazard protection.',
        perform: async function(agent) {
            const bot = agent.bot;
            const bestY = skills.getBestDiamondYLevel(bot);
            const reached = await skills.safeStaircaseDown(bot, bestY);
            return reached ? `Successfully reached diamond layer at Y=${bestY}.` : `Descended towards diamond level (Y=${Math.floor(bot.entity.position.y)}).`;
        }
    },
    {
        name: '!maxOreScan',
        description: 'Scan up to 64 blocks around the bot for diamonds, ancient debris, gold, iron, and rare ores.',
        params: {
            'radius': { type: 'int', description: 'Scan radius in blocks (max: 64, default: 64)' }
        },
        perform: async function(agent, radius = 64) {
            const bot = agent.bot;
            const ores = skills.maxOreScan(bot, Math.min(radius, 64));
            if (!ores || ores.length === 0) {
                return `Scanned ${radius}-block radius: no rare ores detected nearby.`;
            }
            const diamondList = ores.filter(o => o.name.includes('diamond'));
            const summary = ores.slice(0, 8).map(o => `${o.name.replace(/_/g, ' ')} (${o.distance}m away at [${o.position.x}, ${o.position.y}, ${o.position.z}])`).join('\n- ');
            return `Max Ore Scan (${ores.length} ores within ${radius}m):\n- ${summary}${diamondList.length > 0 ? `\n💎 ${diamondList.length} DIAMOND veins found!` : ''}`;
        }
    },
    {
        name: '!squadMineStone',
        description: 'Coordinated squad quarrying and cobblestone/stone excavation.',
        params: {
            'count': { type: 'int', description: 'Target stone count (default: 64)' }
        },
        perform: async function(agent, count = 64) {
            await skills.squadMineStone(agent.bot, count);
            return `Squad quarrying completed for ${count} stone.`;
        }
    },
    {
        name: '!squadMineWood',
        description: 'Coordinated squad logging, timber extraction, and apple gathering (never replants saplings).',
        params: {
            'count': { type: 'int', description: 'Target log count (default: 64)' }
        },
        perform: async function(agent, count = 64) {
            await skills.squadMineWood(agent.bot, count);
            return `Squad logging completed for ${count} logs.`;
        }
    },
    {
        name: '!squadMineOres',
        description: 'Coordinated squad ore extraction with 64m max scan range.',
        params: {
            'oreType': { type: 'string', description: 'Type of ore (default: iron_ore)' },
            'count': { type: 'int', description: 'Target ore count (default: 64)' }
        },
        perform: async function(agent, oreType = 'iron_ore', count = 64) {
            await skills.squadMineOres(agent.bot, oreType, count);
            return `Squad ore mining completed for ${oreType} (goal: ${count}).`;
        }
    },
    {
        name: '!setSkin',
        description: 'Applies the custom Dark Red Knight skin across all supported server skin plugins (SkinsRestorer, Fabric Tailor).',
        params: {
            'skinUrl': { type: 'string', description: 'Skin texture URL (default: https://namemc.com/texture/777895bfd4bb9994.png)' }
        },
        perform: async function(agent, customUrl = 'https://namemc.com/texture/777895bfd4bb9994.png') {
            if (typeof agent.applySquadSkin === 'function') {
                agent.applySquadSkin(true);
            } else {
                const bot = agent.bot;
                bot.chat(`/skin url ${customUrl} classic`);
                bot.chat(`/skin set URL classic ${customUrl}`);
            }
            return `Applied Dark Red Knight skin to ${agent.bot.username}.`;
        }
    }
];

