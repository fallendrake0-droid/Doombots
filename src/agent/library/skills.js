import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import settings from "../../../settings.js";

const blockPlaceDelay = settings.block_place_delay == null ? 0 : settings.block_place_delay;
const useDelay = blockPlaceDelay > 0;

export function log(bot, message) {
    bot.output += message + '\n';
}

export function isAlly(bot, playerOrName) {
    if (!playerOrName) return false;
    const name = typeof playerOrName === 'string'
        ? playerOrName
        : (playerOrName.username || playerOrName.name || '');
    if (!name) return false;
    const lower = name.toLowerCase();
    if (lower === 'orbryx') return true;
    const alliesList = (bot?.settings?.allies || settings.allies || []).map(a => a.toLowerCase());
    return alliesList.includes(lower);
}

export function getEnchantmentWeight(item) {
    if (!item) return 0;
    let score = 0;
    try {
        const enchs = item.ench || (item.nbt?.value?.Enchantments?.value?.value) || (item.nbt?.value?.ench?.value?.value) || [];
        if (Array.isArray(enchs)) {
            for (const e of enchs) {
                const id = (e.id?.value || e.id || '').toString().toLowerCase();
                const lvl = Number(e.lvl?.value || e.lvl || 1);
                if (id.includes('sharpness')) score += lvl * 1.5;
                else if (id.includes('fire_aspect')) score += lvl * 1.2;
                else if (id.includes('smite') || id.includes('bane')) score += lvl * 1.0;
                else if (id.includes('knockback')) score += lvl * 0.8;
                else if (id.includes('protection')) score += lvl * 2.0;
                else if (id.includes('thorns')) score += lvl * 1.5;
                else if (id.includes('feather_falling')) score += lvl * 1.5;
                else if (id.includes('unbreaking')) score += lvl * 0.5;
                else if (id.includes('mending')) score += 2.0;
                else score += lvl * 0.5;
            }
        }
        if (Array.isArray(item.enchantments)) {
            for (const e of item.enchantments) {
                const name = (e.name || '').toLowerCase();
                const lvl = Number(e.lvl || 1);
                if (name.includes('sharpness')) score += lvl * 1.5;
                else if (name.includes('protection')) score += lvl * 2.0;
                else score += lvl * 1.0;
            }
        }
    } catch {}
    return score;
}

export function scoreWeapon(item) {
    if (!item) return 0;
    const baseDamage = WEAPON_DAMAGE[item.name] || (item.name.includes('sword') ? 4 : (item.name.includes('axe') && !item.name.includes('pickaxe') ? 3.5 : 1));
    const enchBonus = getEnchantmentWeight(item);
    return baseDamage + enchBonus;
}

export function scoreArmor(item) {
    if (!item) return 0;
    let baseTier = 0;
    for (const [mat, tier] of Object.entries(ARMOR_TIERS)) {
        if (item.name.startsWith(mat)) {
            baseTier = tier;
            break;
        }
    }
    const enchBonus = getEnchantmentWeight(item);
    return (baseTier * 5) + enchBonus;
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

const WEAPON_DAMAGE = {
    'netherite_axe': 10, 'diamond_axe': 9, 'iron_axe': 9, 'stone_axe': 9, 'golden_axe': 7, 'wooden_axe': 7,
    'netherite_sword': 8, 'diamond_sword': 7, 'iron_sword': 6, 'stone_sword': 5, 'golden_sword': 4, 'wooden_sword': 4,
    'netherite_pickaxe': 6, 'diamond_pickaxe': 5, 'iron_pickaxe': 4, 'stone_pickaxe': 3, 'golden_pickaxe': 2, 'wooden_pickaxe': 2,
    'netherite_shovel': 6.5, 'diamond_shovel': 5.5, 'iron_shovel': 4.5, 'stone_shovel': 3.5, 'golden_shovel': 2.5, 'wooden_shovel': 2.5
};

const ARMOR_TIERS = {
    netherite: 6,
    diamond: 5,
    iron: 4,
    chainmail: 3,
    golden: 2,
    leather: 1
};

export async function autoEquipBest(bot) {
    if (!bot?.inventory) return;
    try {
        if (bot.armorManager && typeof bot.armorManager.equipAll === 'function') {
            await bot.armorManager.equipAll();
        }
    } catch {}

    const items = bot.inventory.items();
    const getArmorTier = (name) => {
        for (const [mat, tier] of Object.entries(ARMOR_TIERS)) {
            if (name.startsWith(mat)) return tier;
        }
        return 0;
    };

    // Auto-equip off-hand: Totem of Undying > Shield
    const offHandCurrent = bot.inventory?.slots?.[45];
    const totem = items.find(i => i.name === 'totem_of_undying');
    const shield = items.find(i => i.name === 'shield');
    if (totem && (!offHandCurrent || offHandCurrent.name !== 'totem_of_undying')) {
        try { await bot.equip(totem, 'off-hand'); } catch {}
    } else if (shield && (!offHandCurrent || (offHandCurrent.name !== 'totem_of_undying' && offHandCurrent.name !== 'shield'))) {
        try { await bot.equip(shield, 'off-hand'); } catch {}
    }

    // Auto-equip armor pieces by slot if better tier exists
    const armorSlots = [
        { type: 'helmet', dest: 'head', slotId: 5 },
        { type: 'chestplate', dest: 'torso', slotId: 6 },
        { type: 'leggings', dest: 'legs', slotId: 7 },
        { type: 'boots', dest: 'feet', slotId: 8 }
    ];

    for (const slot of armorSlots) {
        const curItem = bot.inventory.slots[slot.slotId];
        const curScore = curItem ? scoreArmor(curItem) : 0;
        let bestItem = null;
        let bestScore = curScore;

        for (const item of items) {
            if (item.name.endsWith('_' + slot.type)) {
                const score = scoreArmor(item);
                if (score > bestScore) {
                    bestScore = score;
                    bestItem = item;
                }
            }
        }

        if (bestItem) {
            try { await bot.equip(bestItem, slot.dest); } catch {}
        }
    }
}

export async function equipBestToolFor(bot, blockName) {
    if (!bot?.inventory || !blockName) return;
    try {
        if (bot.tool && typeof bot.tool.equipForBlock === 'function') {
            const fakeBlock = { name: blockName, canHarvest: () => true };
            await bot.tool.equipForBlock(fakeBlock);
            return;
        }
    } catch {}

    const items = bot.inventory.items();
    let bestTool = null;
    let maxScore = -1;
    const isWood = blockName.includes('log') || blockName.includes('wood') || blockName.includes('plank') || blockName.includes('stem');
    const isStone = blockName.includes('stone') || blockName.includes('ore') || blockName.includes('deepslate') || 
                    blockName.includes('cobble') || blockName.includes('andesite') || blockName.includes('diorite') || 
                    blockName.includes('granite') || blockName.includes('tuff') || blockName.includes('calcite') || 
                    blockName.includes('basalt') || blockName.includes('blackstone') || blockName.includes('obsidian') || 
                    blockName.includes('sandstone') || blockName.includes('netherrack') || blockName.includes('end_stone') || 
                    blockName.includes('dripstone') || blockName.includes('prismarine') || blockName.includes('terracotta') ||
                    blockName.includes('brick');
    const isDirt = blockName.includes('dirt') || blockName.includes('grass') || blockName.includes('sand') || 
                   blockName.includes('gravel') || blockName.includes('clay') || blockName.includes('mud') || 
                   blockName.includes('soil') || blockName.includes('podzol') || blockName.includes('mycelium');
    const isLeaves = blockName.includes('leaves');

    const targetSuffix = isWood ? '_axe' : (isStone ? '_pickaxe' : (isDirt ? '_shovel' : (isLeaves ? '_shears' : '')));
    if (!targetSuffix) return;

    for (const item of items) {
        if (item.name.endsWith(targetSuffix) || (isLeaves && item.name === 'shears')) {
            let score = 0;
            for (const [mat, tier] of Object.entries(ARMOR_TIERS)) {
                if (item.name.startsWith(mat)) {
                    score = tier * 10;
                    break;
                }
            }
            if (typeof getEnchantmentWeight === 'function') {
                score += getEnchantmentWeight(item);
            }
            if (score > maxScore) {
                maxScore = score;
                bestTool = item;
            }
        }
    }
    if (bestTool) {
        try { await bot.equip(bestTool, 'hand'); } catch {}
    }
}

export function configureMovements(bot, movements, destructive = false) {
    movements.canDig = destructive;
    movements.dontMineUnderFallingBlock = true;
    movements.dontCreateFlow = true;
    movements.maxDropDown = 3; // ZERO fall damage (3 blocks or less)
    movements.allowParkour = false; // No risky parkour jumps over chasms/cliffs
    movements.allow1by1towers = destructive;
    movements.allowSprinting = true;
    movements.liquidCost = 1;

    // Hazard blocks to strictly avoid
    const blocks = bot.registry?.blocksByName || {};
    const avoid = movements.blocksToAvoid;
    if (blocks.lava) avoid.add(blocks.lava.id);
    if (blocks.fire) avoid.add(blocks.fire.id);
    if (blocks.magma_block) avoid.add(blocks.magma_block.id);
    if (blocks.cactus) avoid.add(blocks.cactus.id);
    if (blocks.sweet_berry_bush) avoid.add(blocks.sweet_berry_bush.id);
    if (blocks.wither_rose) avoid.add(blocks.wither_rose.id);
    if (blocks.campfire) avoid.add(blocks.campfire.id);
    if (blocks.soul_campfire) avoid.add(blocks.soul_campfire.id);

    return movements;
}

export async function equipHighestAttack(bot) {
    if (!bot?.inventory) return;
    const items = bot.inventory.items();
    let bestItem = null;
    let maxScore = 1;
    for (const item of items) {
        const score = scoreWeapon(item);
        if (score > maxScore) {
            maxScore = score;
            bestItem = item;
        }
    }
    if (bestItem) {
        try {
            await bot.equip(bestItem, 'hand');
        } catch {}
    }
}

export async function craftRecipe(bot, itemName, num=1) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to craft.
     * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick");
     **/
    let placedTable = false;

    if (mc.getItemCraftingRecipes(itemName).length == 0) {
        log(bot, `${itemName} is either not an item, or it does not have a crafting recipe!`);
        return false;
    }

    // get recipes that don't require a crafting table
    let recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, null); 
    let craftingTable = null;
    const craftingTableRange = 16;
    placeTable: if (!recipes || recipes.length === 0) {
        recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, true);
        if(!recipes || recipes.length === 0) break placeTable; //Don't bother going to the table if we don't have the required resources.

        // Look for crafting table
        craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
        if (craftingTable === null){

            // Try to place crafting table
            let hasTable = world.getInventoryCounts(bot)['crafting_table'] > 0;
            if (hasTable) {
                let pos = world.getNearestFreeSpace(bot, 1, 6);
                await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
                craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
                if (craftingTable) {
                    recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
                    placedTable = true;
                }
            }
            else {
                log(bot, `Crafting ${itemName} requires a crafting table.`)
                return false;
            }
        }
        else {
            recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
        }
    }
    if (!recipes || recipes.length === 0) {
        log(bot, `You do not have the resources to craft a ${itemName}. It requires: ${Object.entries(mc.getItemCraftingRecipes(itemName)[0][0]).map(([key, value]) => `${key}: ${value}`).join(', ')}.`);
        if (placedTable) {
            await collectBlock(bot, 'crafting_table', 1);
        }
        return false;
    }
    
    if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 4) {
        await goToNearestBlock(bot, 'crafting_table', 4, craftingTableRange);
    }

    const recipe = recipes[0];
    console.log('crafting...');
    //Check that the agent has sufficient items to use the recipe `num` times.
    const inventory = world.getInventoryCounts(bot); //Items in the agents inventory
    const requiredIngredients = mc.ingredientsFromPrismarineRecipe(recipe); //Items required to use the recipe once.
    const craftLimit = mc.calculateLimitingResource(inventory, requiredIngredients);
    
    await bot.craft(recipe, Math.min(craftLimit.num, num), craftingTable);
    if(craftLimit.num<num) log(bot, `Not enough ${craftLimit.limitingResource} to craft ${num}, crafted ${craftLimit.num}. You now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    else log(bot, `Successfully crafted ${itemName}, you now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    if (placedTable) {
        await collectBlock(bot, 'crafting_table', 1);
    }

    //Equip any armor the bot may have crafted.
    //There is probablly a more efficient method than checking the entire inventory but this is all mineflayer-armor-manager provides. :P
    bot.armorManager.equipAll(); 

    return true;
}

export async function wait(bot, milliseconds) {
    /**
     * Waits for the given number of milliseconds.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} milliseconds, the number of milliseconds to wait.
     * @returns {Promise<boolean>} true if the wait was successful, false otherwise.
     * @example
     * await skills.wait(bot, 1000);
     **/
    // setTimeout is disabled to prevent unawaited code, so this is a safe alternative that enables interrupts
    let timeLeft = milliseconds;
    let startTime = Date.now();
    
    while (timeLeft > 0) {
        if (bot.interrupt_code) return false;
        
        let waitTime = Math.min(2000, timeLeft);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        let elapsed = Date.now() - startTime;
        timeLeft = milliseconds - elapsed;
    }
    return true;
}

export async function smeltItem(bot, itemName, num=1) {
    /**
     * Puts 1 coal in furnace and smelts the given item name, waits until the furnace runs out of fuel or input items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to smelt. Ores must contain "raw" like raw_iron.
     * @param {number} num, the number of items to smelt. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was smelted, false otherwise. Fail
     * @example
     * await skills.smeltItem(bot, "raw_iron");
     * await skills.smeltItem(bot, "beef");
     **/

    if (!mc.isSmeltable(itemName)) {
        log(bot, `Cannot smelt ${itemName}. Hint: make sure you are smelting the 'raw' item.`);
        return false;
    }

    let placedFurnace = false;
    let furnaceBlock = undefined;
    const furnaceRange = 16;
    furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
    if (!furnaceBlock){
        // Try to place furnace
        let hasFurnace = world.getInventoryCounts(bot)['furnace'] > 0;
        if (hasFurnace) {
            let pos = world.getNearestFreeSpace(bot, 1, furnaceRange);
            await placeBlock(bot, 'furnace', pos.x, pos.y, pos.z);
            furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
            placedFurnace = true;
        }
    }
    if (!furnaceBlock){
        log(bot, `There is no furnace nearby and you have no furnace.`)
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, furnaceRange);
    }
    bot.modes.pause('unstuck');
    await bot.lookAt(furnaceBlock.position);

    console.log('smelting...');
    const furnace = await bot.openFurnace(furnaceBlock);
    // check if the furnace is already smelting something
    let input_item = furnace.inputItem();
    if (input_item && input_item.type !== mc.getItemId(itemName) && input_item.count > 0) {
        // TODO: check if furnace is currently burning fuel. furnace.fuel is always null, I think there is a bug.
        // This only checks if the furnace has an input item, but it may not be smelting it and should be cleared.
        log(bot, `The furnace is currently smelting ${mc.getItemName(input_item.type)}.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }
    // check if the bot has enough items to smelt
    let inv_counts = world.getInventoryCounts(bot);
    if (!inv_counts[itemName] || inv_counts[itemName] < num) {
        log(bot, `You do not have enough ${itemName} to smelt.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }

    // fuel the furnace
    if (!furnace.fuelItem()) {
        let fuel = mc.getSmeltingFuel(bot);
        if (!fuel) {
            log(bot, `You have no fuel to smelt ${itemName}, you need coal, charcoal, or wood.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        log(bot, `Using ${fuel.name} as fuel.`);

        const put_fuel = Math.ceil(num / mc.getFuelSmeltOutput(fuel.name));

        if (fuel.count < put_fuel) {
            log(bot, `You don't have enough ${fuel.name} to smelt ${num} ${itemName}; you need ${put_fuel}.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        await furnace.putFuel(fuel.type, null, put_fuel);
        log(bot, `Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`);
        console.log(`Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`)
    }
    // put the items in the furnace
    await furnace.putInput(mc.getItemId(itemName), null, num);
    // wait for the items to smelt
    let total = 0;
    let smelted_item = null;
    await new Promise(resolve => setTimeout(resolve, 200));
    let last_collected = Date.now();
    while (total < num) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (furnace.outputItem()) {
            smelted_item = await furnace.takeOutput();
            if (smelted_item) {
                total += smelted_item.count;
                last_collected = Date.now();
            }
        }
        if (Date.now() - last_collected > 11000) {
            break; // if nothing has been collected in 11 seconds, stop
        }
        if (bot.interrupt_code) {
            break;
        }
    }
    // take all remaining in input/fuel slots
    if (furnace.inputItem()) {
        await furnace.takeInput();
    }
    if (furnace.fuelItem()) {
        await furnace.takeFuel();
    }

    await bot.closeWindow(furnace);

    if (placedFurnace) {
        await collectBlock(bot, 'furnace', 1);
    }
    if (total === 0) {
        log(bot, `Failed to smelt ${itemName}.`);
        return false;
    }
    if (total < num) {
        log(bot, `Only smelted ${total} ${mc.getItemName(smelted_item.type)}.`);
        return false;
    }
    log(bot, `Successfully smelted ${itemName}, got ${total} ${mc.getItemName(smelted_item.type)}.`);
    return true;
}

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
     * @example
     * await skills.clearNearestFurnace(bot);
     **/
    let furnaceBlock = world.getNearestBlock(bot, 'furnace', 32);
    if (!furnaceBlock) {
        log(bot, `No furnace nearby to clear.`);
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, 32);
    }

    console.log('clearing furnace...');
    const furnace = await bot.openFurnace(furnaceBlock);
    console.log('opened furnace...')
    // take the items out of the furnace
    let smelted_item, intput_item, fuel_item;
    if (furnace.outputItem())
        smelted_item = await furnace.takeOutput();
    if (furnace.inputItem())
        intput_item = await furnace.takeInput();
    if (furnace.fuelItem())
        fuel_item = await furnace.takeFuel();
    console.log(smelted_item, intput_item, fuel_item)
    let smelted_name = smelted_item ? `${smelted_item.count} ${smelted_item.name}` : `0 smelted items`;
    let input_name = intput_item ? `${intput_item.count} ${intput_item.name}` : `0 input items`;
    let fuel_name = fuel_item ? `${fuel_item.count} ${fuel_item.name}` : `0 fuel items`;
    log(bot, `Cleared furnace, received ${smelted_name}, ${input_name}, and ${fuel_name}.`);
    return true;

}


export async function attackNearest(bot, mobType, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} mobType, the type of mob to attack.
     * @param {boolean} kill, whether or not to continue attacking until the mob is dead. Defaults to true.
     * @returns {Promise<boolean>} true if the mob was attacked, false if the mob type was not found.
     * @example
     * await skills.attackNearest(bot, "zombie", true);
     **/
    bot.modes.pause('cowardice');
    if (mobType === 'drowned' || mobType === 'cod' || mobType === 'salmon' || mobType === 'tropical_fish' || mobType === 'squid')
        bot.modes.pause('self_preservation'); // so it can go underwater. TODO: have an drowning mode so we don't turn off all self_preservation
    const mob = world.getNearbyEntities(bot, 24).find(entity => entity.name === mobType);
    if (mob) {
        return await attackEntity(bot, mob, kill);
    }
    log(bot, 'Could not find any '+mobType+' to attack.');
    return false;
}

export async function attackEntity(bot, entity, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to attack.
     * @returns {Promise<boolean>} true if the entity was attacked, false if interrupted
     * @example
     * await skills.attackEntity(bot, entity);
     **/

    if (!entity) return false;
    if (isAlly(bot, entity)) {
        log(bot, `Will not attack ${entity.username || entity.name}: target is a designated ally.`);
        return false;
    }

    let pos = entity.position;
    await autoEquipBest(bot);
    await equipHighestAttack(bot);

    if (!kill) {
        if (bot.entity.position.distanceTo(pos) > 5) {
            console.log('moving to mob...');
            await goToPosition(bot, pos.x, pos.y, pos.z);
        }
        console.log('attacking mob...');
        await bot.attack(entity);
        return true;
    }
    else {
        try {
            if (bot.pvp && typeof bot.pvp.attack === 'function') {
                bot.pvp.attack(entity);
            }
        } catch {}

        let strafeDir = Math.random() < 0.5 ? 'left' : 'right';
        let lastStrafeSwitch = Date.now();
        let isShieldRaised = false;
        const hasShield = bot.inventory.slots[45]?.name === 'shield' || bot.heldItem?.name === 'shield';

        while (world.getNearbyEntities(bot, 24).includes(entity) && (entity.health == null || entity.health > 0)) {
            if (bot.interrupt_code) {
                try { bot.pvp?.stop(); } catch {}
                if (isShieldRaised) { try { bot.deactivateItem(); } catch {} }
                bot.clearControlStates();
                return false;
            }

            const dist = bot.entity.position.distanceTo(entity.position);

            // Shield defense against projectiles / archers or incoming hits
            const isRanged = entity.name === 'skeleton' || entity.name === 'pillager' || entity.name === 'drowned';
            if (hasShield && (isRanged || dist > 4) && dist < 16) {
                if (!isShieldRaised) {
                    try {
                        await bot.lookAt(entity.position.offset(0, (entity.height || 1.8) * 0.8, 0), true);
                        bot.activateItem(true);
                        isShieldRaised = true;
                    } catch {}
                }
            } else if (isShieldRaised) {
                try { bot.deactivateItem(); } catch {}
                isShieldRaised = false;
            }

            // Close-range PVP: Strafe and Crit timing
            if (dist <= 3.8) {
                // Strafe circle movement
                if (Date.now() - lastStrafeSwitch > 800) {
                    strafeDir = strafeDir === 'left' ? 'right' : 'left';
                    lastStrafeSwitch = Date.now();
                }
                bot.setControlState(strafeDir, true);
                bot.setControlState(strafeDir === 'left' ? 'right' : 'left', false);

                // Crit jump apex hit
                if (bot.entity.onGround && Math.random() < 0.7) {
                    bot.setControlState('jump', true);
                    setTimeout(() => bot.setControlState('jump', false), 120);
                    await new Promise(r => setTimeout(r, 220));
                }

                try {
                    await bot.lookAt(entity.position.offset(0, (entity.height || 1.8) * 0.75, 0), true);
                    if (isShieldRaised) {
                        bot.deactivateItem();
                        isShieldRaised = false;
                    }
                    bot.attack(entity);
                } catch {}
            }

            await new Promise(resolve => setTimeout(resolve, 350));
        }

        try { bot.pvp?.stop(); } catch {}
        if (isShieldRaised) { try { bot.deactivateItem(); } catch {} }
        bot.clearControlStates();

        log(bot, `Successfully defeated ${entity.name || 'target'}.`);
        await pickupNearbyItems(bot);
        return true;
    }
}

export async function defendSelf(bot, range=12) {
    /**
     * Defend yourself from all nearby hostile mobs until there are no more.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, the range to look for mobs. Defaults to 12.
     * @returns {Promise<boolean>} true if the bot found any enemies and has killed them, false if no entities were found.
     * @example
     * await skills.defendSelf(bot);
     * **/
    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_preservation');
    let attacked = false;

    try {
        // Equip best armor, off-hand shield, and top weapon
        await autoEquipBest(bot);
        await equipHighestAttack(bot);

        const isAlive = (e) => e && e.isValid && (e.health === undefined || e.health > 0);
        let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity) && isAlive(entity), range);

        while (enemy && isAlive(enemy) && !bot.interrupt_code) {
            await equipHighestAttack(bot);
            attacked = true;

            const dist = bot.entity.position.distanceTo(enemy.position);

            // Creeper survival tactic: Hit then back up immediately to prevent detonation
            if (enemy.name === 'creeper') {
                if (dist <= 3.8) {
                    try {
                        await bot.lookAt(enemy.position.offset(0, (enemy.height || 1.8) * 0.75, 0), true);
                        bot.attack(enemy);
                    } catch {}
                    // Sprint backward 4 blocks to reset creeper fuse
                    try {
                        bot.setControlState('back', true);
                        bot.setControlState('sprint', true);
                        setTimeout(() => bot.clearControlStates(), 450);
                    } catch {}
                } else if (dist <= 5.5) {
                    // Raise shield if in off-hand
                    try { bot.activateItem(true); } catch {}
                }
            } else {
                // Close-range melee attack for other hostiles (zombies, skeletons, spiders)
                if (dist <= 3.8) {
                    try {
                        await bot.lookAt(enemy.position.offset(0, (enemy.height || 1.8) * 0.75, 0), true);
                        bot.attack(enemy);
                    } catch {}
                }
            }

            // Low health survival safeguard: block with shield & eat
            if (bot.health < 6) {
                try { bot.activateItem(true); } catch {}
                if (bot.autoEat && typeof bot.autoEat.eat === 'function') {
                    try { await bot.autoEat.eat(true); } catch {}
                }
            }

            // Engage PVP pathfinding towards enemy
            try {
                bot.pvp.attack(enemy);
            } catch {}

            await new Promise(resolve => setTimeout(resolve, 250));

            // Re-check for nearest active hostile mob
            enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity) && isAlive(entity), range);
        }
    } finally {
        try { bot.pvp?.stop(); } catch {}
        bot.modes.unpause('self_defense');
        bot.modes.unpause('cowardice');
        bot.modes.unpause('self_preservation');
    }

    if (attacked) {
        log(bot, `Successfully defended self.`);
        try { await pickupNearbyItems(bot); } catch {}
    } else {
        log(bot, `No enemies nearby to defend self from.`);
    }
    return attacked;
}



export async function collectBlock(bot, blockType, num=1, exclude=null) {
    /**
     * Collect one of the given block type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to collect.
     * @param {number} num, the number of blocks to collect. Defaults to 1.
     * @param {list} exclude, a list of positions to exclude from the search. Defaults to null.
     * @returns {Promise<boolean>} true if the block was collected, false if the block type was not found.
     * @example
     * await skills.collectBlock(bot, "oak_log");
     **/
    if (num < 1) {
        log(bot, `Invalid number of blocks to collect: ${num}.`);
        return false;
    }
    if (!bot?.entity?.position) {
        log(bot, `Bot is not spawned in the world yet.`);
        return false;
    }
    bot.modes?.pause('unstuck');
    try {
        let blocktypes = [blockType];
        if (blockType.includes('log') || blockType === 'wood' || blockType === 'trees') {
            blocktypes = [
                'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
                'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log',
                'stripped_oak_log', 'stripped_birch_log', 'stripped_spruce_log',
                'oak_wood', 'birch_wood', 'spruce_wood', 'jungle_wood'
            ];
        }
        if (blockType === 'coal' || blockType === 'diamond' || blockType === 'emerald' || blockType === 'iron' || blockType === 'gold' || blockType === 'lapis_lazuli' || blockType === 'redstone')
            blocktypes.push(blockType+'_ore');
        if (blockType.endsWith('ore'))
            blocktypes.push('deepslate_'+blockType);
        if (blockType === 'dirt')
            blocktypes.push('grass_block');
        if (blockType === 'cobblestone')
            blocktypes.push('stone');
        const isLiquid = blockType === 'lava' || blockType === 'water';

        let collected = 0;

        const movements = configureMovements(bot, new pf.Movements(bot), true);

        // Blocks to ignore safety for, usually next to lava/water
        const unsafeBlocks = ['obsidian'];

        for (let i=0; i<num; i++) {
            let blocks = world.getNearestBlocksWhere(bot, block => {
                if (!blocktypes.includes(block.name)) {
                    return false;
                }
                if (exclude) {
                    for (let position of exclude) {
                        if (block.position.x === position.x && block.position.y === position.y && block.position.z === position.z) {
                            return false;
                        }
                    }
                }
                if (isLiquid) {
                    // collect only source blocks
                    return block.metadata === 0;
                }
                
                return movements.safeToBreak(block) || unsafeBlocks.includes(block.name);
            }, 64, 1);

            if (blocks.length === 0) {
                if (collected === 0)
                    log(bot, `No ${blockType} nearby to collect.`);
                else
                    log(bot, `No more ${blockType} nearby to collect.`);
                break;
            }
            const block = blocks[0];
            try { await bot.tool?.equipForBlock?.(block); } catch {}
            await equipBestToolFor(bot, block.name);
            if (isLiquid) {
                const bucket = bot.inventory.findInventoryItem('bucket');
                if (!bucket) {
                    log(bot, `Don't have bucket to harvest ${blockType}.`);
                    return false;
                }
                await bot.equip(bucket, 'hand');
            }
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                log(bot, `Don't have right tools to harvest ${blockType}.`);
                return false;
            }
            try {
                let success = false;
                if (isLiquid) {
                    success = await useToolOnBlock(bot, 'bucket', block);
                }
                else if (mc.mustCollectManually(blockType)) {
                    await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
                    try {
                        await bot.dig(block);
                        await pickupNearbyItems(bot);
                        success = true;
                    } catch (digErr) {
                        if (digErr?.message?.includes('Digging aborted')) {
                            log(bot, `Digging of ${blockType} was interrupted.`);
                            success = false;
                        } else {
                            throw digErr;
                        }
                    }
                }
                else {
                    const collectPromise = bot.collectBlock.collect(block);
                    // Prevent unhandled rejection if race timeout or interrupt rejects first
                    collectPromise.catch(() => {});
                    const timeoutPromise = new Promise((_, reject) => {
                        const timer = setTimeout(() => {
                            try { bot.collectBlock?.cancelTask?.(() => {}); } catch {}
                            try { bot.pathfinder?.stop(); } catch {}
                            try { bot.stopDigging?.(); } catch {}
                            reject(new Error('Collect block timed out'));
                        }, 25000);
                        const pollInterrupt = setInterval(() => {
                            if (bot.interrupt_code) {
                                clearTimeout(timer);
                                clearInterval(pollInterrupt);
                                try { bot.collectBlock?.cancelTask?.(() => {}); } catch {}
                                try { bot.pathfinder?.stop(); } catch {}
                                try { bot.stopDigging?.(); } catch {}
                                reject(new Error('Interrupted'));
                            }
                        }, 200);
                        collectPromise.finally(() => {
                            clearTimeout(timer);
                            clearInterval(pollInterrupt);
                        });
                    });
                    try {
                        await Promise.race([collectPromise, timeoutPromise]);
                        success = true;
                    } catch (raceErr) {
                        try { bot.collectBlock?.cancelTask?.(() => {}); } catch {}
                        try { bot.pathfinder?.stop(); } catch {}
                        throw raceErr;
                    }
                }
                if (success)
                    collected++;
                await autoLight(bot);
            }
            catch (err) {
                if (err.name === 'NoChests') {
                    log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                    break;
                }
                else if (err.message && (err.message.includes('Interrupted') || err.message.includes('Digging aborted'))) {
                    log(bot, `Collection of ${blockType} was interrupted.`);
                    break;
                }
                else {
                    log(bot, `Failed to collect ${blockType}: ${err}.`);
                    continue;
                }
            }
            
            if (bot.interrupt_code)
                break;  
        }
        log(bot, `Collected ${collected} ${blockType}.`);
        return collected > 0;
    } finally {
        bot.modes?.unpause('unstuck');
    }
}

export async function pickupNearbyItems(bot, distance = 24, priorityItem = null) {
    /**
     * Pick up nearby items within radius, prioritizing specific items (e.g. apples, ores) if specified.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, search radius (default: 24).
     * @param {string} priorityItem, optional item name to prioritize first (e.g. 'apple').
     * @returns {Promise<boolean>} true if items were picked up.
     */
    if (!bot?.entity?.position) return false;

    // Do not pick up items during active combat / PVP!
    if (bot.pvp?.target) return false;
    const nearbyEnemy = world.getNearestEntityWhere(bot, e => (mc.isHostile(e) || (!isAlly(bot, e) && mc.isPlayer(e))), 7);
    if (nearbyEnemy && bot.modes?.isOn('self_defense')) {
        return false;
    }

    const getNearbyItems = (bot, maxDist) => {
        if (!bot?.entity?.position) return [];
        const items = [];
        for (const id in bot.entities) {
            const e = bot.entities[id];
            if (!e || e.name !== 'item' || !e.position) continue;
            const d = bot.entity.position.distanceTo(e.position);
            if (d > maxDist) continue;
            const dropped = typeof e.getDroppedItem === 'function' ? e.getDroppedItem() : null;
            const itemName = dropped?.name || null;
            items.push({ entity: e, distance: d, name: itemName });
        }
        items.sort((a, b) => {
            if (priorityItem) {
                const aMatch = a.name === priorityItem ? 0 : 1;
                const bMatch = b.name === priorityItem ? 0 : 1;
                if (aMatch !== bMatch) return aMatch - bMatch;
            }
            return a.distance - b.distance;
        });
        return items.map(i => i.entity);
    };

    let items = getNearbyItems(bot, distance);
    let pickedUp = 0;
    let cycles = 0;

    while (items.length > 0 && cycles < 30 && !bot.interrupt_code) {
        const targetItem = items[0];
        if (!targetItem || !targetItem.position) break;

        const movements = configureMovements(bot, new pf.Movements(bot), false);
        bot.pathfinder.setMovements(movements);

        try {
            await goToGoal(bot, new pf.goals.GoalNear(targetItem.position.x, targetItem.position.y, targetItem.position.z, 1));
        } catch {}

        await new Promise(resolve => setTimeout(resolve, 150));
        pickedUp++;
        cycles++;

        items = getNearbyItems(bot, distance);
    }

    if (pickedUp > 0) {
        log(bot, `Picked up nearby items (${pickedUp} collection steps).`);
    }
    return true;
}


export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.x);
     **/
    if (x == null || y == null || z == null) throw new Error('Invalid position to break block at.');
    if (!bot?.entity?.position) return false;
    let block = bot.blockAt(Vec3(x, y, z));
    if (block.name !== 'air' && block.name !== 'water' && block.name !== 'lava') {
        if (bot.modes.isOn('cheat')) {
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' air';
            bot.chat(msg);
            log(bot, `Used /setblock to break block at ${x}, ${y}, ${z}.`);
            return true;
        }

        if (bot.entity.position.distanceTo(block.position) > 4.5) {
            let pos = block.position;
            let movements = new pf.Movements(bot);
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            bot.pathfinder.setMovements(movements);
            await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        }
        if (bot.game.gameMode !== 'creative') {
            try {
                if (bot.tool && typeof bot.tool.equipForBlock === 'function') {
                    await bot.tool.equipForBlock(block);
                } else {
                    await equipBestToolFor(bot, block.name);
                }
            } catch {
                await equipBestToolFor(bot, block.name);
            }
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        try {
            await bot.dig(block, true);
            log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
        } catch (digErr) {
            if (digErr?.message?.includes('Digging aborted')) {
                log(bot, `Digging of ${block.name} was stopped.`);
                return false;
            }
            throw digErr;
        }
    }
    else {
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }
    return true;
}


export async function placeBlock(bot, blockType, x, y, z, placeOn='bottom', dontCheat=false) {
    /**
     * Place the given block type at the given position. It will build off from any adjacent blocks. Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place, which can be a block or item name.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on. Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'. Defaults to bottom. Will place on first available side if not possible.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally. Defaults to false.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.x);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.x, 'side');
     **/
    const target_dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    if (blockType === 'air') {
        log(bot, `Placing air (removing block) at ${target_dest}.`);
        return await breakBlockAt(bot, x, y, z);
    }

    if (bot.modes.isOn('cheat') && !dontCheat) {
        if (bot.restrict_to_inventory) {
            let block = bot.inventory.findInventoryItem(blockType);
            if (!block) {
                log(bot, `Cannot place ${blockType}, you are restricted to your current inventory.`);
                return false;
            }
        }

        // invert the facing direction
        let face = placeOn === 'north' ? 'south' : placeOn === 'south' ? 'north' : placeOn === 'east' ? 'west' : 'east';
        if (blockType.includes('torch') && placeOn !== 'bottom') {
            // insert wall_ before torch
            blockType = blockType.replace('torch', 'wall_torch');
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            }
            else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            }
            else {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }
        if (blockType.includes('stairs')) {
            blockType += `[facing=${face}]`;
        }
        if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
        let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' ' + blockType;
        bot.chat(msg);
        if (blockType.includes('door')) {
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y+1) + ' ' + Math.floor(z) + ' ' + blockType + '[half=upper]');
        }
        if (blockType.includes('bed')) {
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z-1) + ' ' + blockType + '[part=head]');
        }
        log(bot, `Used /setblock to place ${blockType} at ${target_dest}.`);
        return true;
    }

    let item_name = blockType;
    if (item_name == "redstone_wire")
        item_name = "redstone";
    else if (item_name === 'water') {
        item_name = 'water_bucket';
    }
    else if (item_name === 'lava') {
        item_name = 'lava_bucket';
    }
    let block_item = bot.inventory.findInventoryItem(item_name);
    if (!block_item && bot.game.gameMode === 'creative' && !bot.restrict_to_inventory) {
        await bot.creative.setInventorySlot(36, mc.makeItem(item_name, 1)); // 36 is first hotbar slot
        block_item = bot.inventory.findInventoryItem(item_name);
    }
    if (!block_item) {
        log(bot, `Don't have any ${item_name} to place.`);
        return false;
    }

    const targetBlock = bot.blockAt(target_dest);
    if (targetBlock.name === blockType || (targetBlock.name === 'grass_block' && blockType === 'dirt')) {
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    const empty_blocks = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern'];
    if (!empty_blocks.includes(targetBlock.name)) {
        log(bot, `${targetBlock.name} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // wait for block to break
    }
    // get the buildoffblock and facevec based on whichever adjacent block is not empty
    let buildOffBlock = null;
    let faceVec = null;
    const dir_map = {
        'top': Vec3(0, 1, 0),
        'bottom': Vec3(0, -1, 0),
        'north': Vec3(0, 0, -1),
        'south': Vec3(0, 0, 1),
        'east': Vec3(1, 0, 0),
        'west': Vec3(-1, 0, 0),
    }
    let dirs = [];
    if (placeOn === 'side') {
        dirs.push(dir_map['north'], dir_map['south'], dir_map['east'], dir_map['west']);
    }
    else if (dir_map[placeOn] !== undefined) {
        dirs.push(dir_map[placeOn]);
    }
    else {
        dirs.push(dir_map['bottom']);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }
    dirs.push(...Object.values(dir_map).filter(d => !dirs.includes(d)));

    for (let d of dirs) {
        const block = bot.blockAt(target_dest.plus(d));
        if (!empty_blocks.includes(block.name)) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            break;
        }
    }
    if (!buildOffBlock) {
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const pos_above = pos.plus(Vec3(0,1,0));
    const dont_move_for = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail', 'detector_rail', 
        'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket', 'string'];
    if (!dont_move_for.includes(item_name) && (pos.distanceTo(targetBlock.position) < 1.1 || pos_above.distanceTo(targetBlock.position) < 1.1)) {
        // too close
        let goal = new pf.goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        let inverted_goal = new pf.goals.GoalInvert(goal);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(inverted_goal);
    }
    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        // too far
        let pos = targetBlock.position;
        let movements = new pf.Movements(bot);
        bot.pathfinder.setMovements(movements);
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        if (item_name.includes('bucket')) {
            await useToolOnBlock(bot, item_name, buildOffBlock);
        }
        else {
            await bot.equip(block_item, 'hand');
            await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5));
            await bot.placeBlock(buildOffBlock, faceVec);
            log(bot, `Placed ${blockType} at ${target_dest}.`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return true;
        }
    } catch (err) {
        log(bot, `Failed to place ${blockType} at ${target_dest}.`);
        return false;
    }
}

export async function equip(bot, itemName) {
    /**
     * Equip the given item to the proper body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe");
     **/
    if (itemName === 'hand') {
        await bot.unequip('hand');
        log(bot, `Unequipped hand.`);
        return true;
    }
    let item = bot.inventory.slots.find(slot => slot && slot.name === itemName);
    if (!item) {
        if (bot.game.gameMode === "creative") {
            await bot.creative.setInventorySlot(36, mc.makeItem(itemName, 1));
            item = bot.inventory.findInventoryItem(itemName);
        }
        else {
            log(bot, `You do not have any ${itemName} to equip.`);
            return false;
        }
    }
    if (itemName.includes('leggings')) {
        await bot.equip(item, 'legs');
    }
    else if (itemName.includes('boots')) {
        await bot.equip(item, 'feet');
    }
    else if (itemName.includes('helmet')) {
        await bot.equip(item, 'head');
    }
    else if (itemName.includes('chestplate') || itemName.includes('elytra')) {
        await bot.equip(item, 'torso');
    }
    else if (itemName.includes('shield')) {
        await bot.equip(item, 'off-hand');
    }
    else {
        await bot.equip(item, 'hand');
    }
    log(bot, `Equipped ${itemName}.`);
    return true;
}

export async function discard(bot, itemName, num=-1) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    let discarded = 0;
    while (true) {
        let item = bot.inventory.findInventoryItem(itemName);
        if (!item) {
            break;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, null, to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Discarded ${discarded} ${itemName}.`);
    return true;
}

export async function putInChest(bot, itemName, num=-1) {
    /**
     * Put the given item in the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to put in the chest.
     * @param {number} num, the number of items to put in the chest. Defaults to -1, which puts all items.
     * @returns {Promise<boolean>} true if the item was put in the chest, false otherwise.
     * @example
     * await skills.putInChest(bot, "oak_log");
     **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    let item = bot.inventory.findInventoryItem(itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to put in the chest.`);
        return false;
    }
    let to_put = num === -1 ? item.count : Math.min(num, item.count);
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    await chestContainer.deposit(item.type, null, to_put);
    await chestContainer.close();
    log(bot, `Successfully put ${to_put} ${itemName} in the chest.`);
    return true;
}

export async function takeFromChest(bot, itemName, num=-1) {
    /**
     * Take the given item from the nearest chest, potentially from multiple slots.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to take from the chest.
     * @param {number} num, the number of items to take from the chest. Defaults to -1, which takes all items.
     * @returns {Promise<boolean>} true if the item was taken from the chest, false otherwise.
     * @example
     * await skills.takeFromChest(bot, "oak_log");
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    
    // Find all matching items in the chest
    let matchingItems = chestContainer.containerItems().filter(item => item.name === itemName);
    if (matchingItems.length === 0) {
        log(bot, `Could not find any ${itemName} in the chest.`);
        await chestContainer.close();
        return false;
    }
    
    let totalAvailable = matchingItems.reduce((sum, item) => sum + item.count, 0);
    let remaining = num === -1 ? totalAvailable : Math.min(num, totalAvailable);
    let totalTaken = 0;
    
    // Take items from each slot until we've taken enough or run out
    for (const item of matchingItems) {
        if (remaining <= 0) break;
        
        let toTakeFromSlot = Math.min(remaining, item.count);
        await chestContainer.withdraw(item.type, null, toTakeFromSlot);
        
        totalTaken += toTakeFromSlot;
        remaining -= toTakeFromSlot;
    }
    
    await chestContainer.close();
    log(bot, `Successfully took ${totalTaken} ${itemName} from the chest.`);
    return totalTaken > 0;
}

export async function viewChest(bot) {
    /**
     * View the contents of the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the chest was viewed, false otherwise.
     * @example
     * await skills.viewChest(bot);
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    let items = chestContainer.containerItems();
    if (items.length === 0) {
        log(bot, `The chest is empty.`);
    }
    else {
        log(bot, `The chest contains:`);
        for (let item of items) {
            log(bot, `${item.count} ${item.name}`);
        }
    }
    await chestContainer.close();
    return true;
}

export async function consume(bot, itemName="") {
    /**
     * Eat/drink the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to eat/drink.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    let item, name;
    if (itemName) {
        item = bot.inventory.findInventoryItem(itemName);
        name = itemName;
    }
    if (!item) {
        log(bot, `You do not have any ${name} to eat.`);
        return false;
    }
    await bot.equip(item, 'hand');
    await bot.consume();
    log(bot, `Consumed ${item.name}.`);
    return true;
}


export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    if (bot.username === username) {
        log(bot, `You cannot give items to yourself.`);
        return false;
    }
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }
    await goToPlayer(bot, username, 3);
    // if we are 2 below the player
    log(bot, bot.entity.position.y, player.position.y);
    if (bot.entity.position.y < player.position.y - 1) {
        await goToPlayer(bot, username, 1);
    }
    // if we are too close, make some distance
    if (bot.entity.position.distanceTo(player.position) < 2) {
        let too_close = true;
        let start_moving_away = Date.now();
        await moveAwayFromEntity(bot, player, 2);
        while (too_close && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            too_close = bot.entity.position.distanceTo(player.position) < 5;
            if (too_close) {
                await moveAwayFromEntity(bot, player, 5);
            }
            if (Date.now() - start_moving_away > 3000) {
                break;
            }
        }
        if (too_close) {
            log(bot, `Failed to give ${itemType} to ${username}, too close.`);
            return false;
        }
    }

    await bot.lookAt(player.position);
    if (await discard(bot, itemType, num)) {
        let given = false;
        bot.once('playerCollect', (collector, collected) => {
            console.log(collected.name);
            if (collector.username === username) {
                log(bot, `${username} received ${itemType}.`);
                given = true;
            }
        });
        let start = Date.now();
        while (!given && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (given) {
                return true;
            }
            if (Date.now() - start > 3000) {
                break;
            }
        }
    }
    log(bot, `Failed to give ${itemType} to ${username}, it was never received.`);
    return false;
}

export async function goToGoal(bot, goal) {
    /**
     * Navigate to the given goal. Use doors and attempt minimally destructive movements.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {pf.goals.Goal} goal, the goal to navigate to.
     **/

    const nonDestructiveMovements = configureMovements(bot, new pf.Movements(bot), false);
    const dontBreakBlocks = ['glass', 'glass_pane'];
    for (let block of dontBreakBlocks) {
        nonDestructiveMovements.blocksCantBreak.add(mc.getBlockId(block));
    }
    nonDestructiveMovements.placeCost = 2;
    nonDestructiveMovements.digCost = 10;

    const destructiveMovements = configureMovements(bot, new pf.Movements(bot), true);

    let final_movements = destructiveMovements;

    const pathfind_timeout = 1000;
    if (await bot.pathfinder.getPathTo(nonDestructiveMovements, goal, pathfind_timeout).status === 'success') {
        final_movements = nonDestructiveMovements;
        log(bot, `Found non-destructive path.`);
    }
    else if (await bot.pathfinder.getPathTo(destructiveMovements, goal, pathfind_timeout).status === 'success') {
        log(bot, `Found destructive path.`);
    }
    else {
        log(bot, `Path not found, but attempting to navigate anyway using destructive movements.`);
    }

    const doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setMovements(final_movements);
    try {
        await bot.pathfinder.goto(goal);
        if (doorCheckInterval) clearInterval(doorCheckInterval);
        return true;
    } catch (err) {
        if (doorCheckInterval) clearInterval(doorCheckInterval);
        if (err.name === 'PathStopped' || err.name === 'GoalChanged' || err.name === 'Timeout' || (err.message && err.message.includes('Took to long'))) {
            log(bot, `Path navigation finished: ${err.message || err.name}`);
            return false;
        }
        throw err;
    }
}

let _doorInterval = null;
function startDoorInterval(bot) {
    /**
     * Start helper interval that opens nearby doors if the bot is stuck.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {number} the interval id.
     **/
    if (_doorInterval) {
        clearInterval(_doorInterval);
    }
    if (!bot?.entity?.position) return null;
    let prev_pos = bot.entity.position.clone();
    let prev_check = Date.now();
    let stuck_time = 0;


    const doorCheckInterval = setInterval(() => {
        if (!bot?.entity?.position) return;
        const now = Date.now();
        if (bot.entity.position.distanceTo(prev_pos) >= 0.1) {
            stuck_time = 0;
        } else {
            stuck_time += now - prev_check;
        }
        
        if (stuck_time > 1200) {
            // shuffle positions so we're not always opening the same door
            const positions = [
                bot.entity.position.clone(),
                bot.entity.position.offset(0, 0, 1),
                bot.entity.position.offset(0, 0, -1), 
                bot.entity.position.offset(1, 0, 0),
                bot.entity.position.offset(-1, 0, 0),
            ]
            let elevated_positions = positions.map(position => position.offset(0, 1, 0));
            positions.push(...elevated_positions);
            positions.push(bot.entity.position.offset(0, 2, 0)); // above head
            positions.push(bot.entity.position.offset(0, -1, 0)); // below feet
            
            let currentIndex = positions.length;
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;
                [positions[currentIndex], positions[randomIndex]] = [
                positions[randomIndex], positions[currentIndex]];
            }
            
            for (let position of positions) {
                let block = bot.blockAt(position);
                if (block && block.name &&
                    !block.name.includes('iron') &&
                    (block.name.includes('door') ||
                     block.name.includes('fence_gate') ||
                     block.name.includes('trapdoor'))) 
                {
                    bot.activateBlock(block);
                    break;
                }
            }
            stuck_time = 0;
        }
        prev_pos = bot.entity.position.clone();
        prev_check = now;
    }, 200);
    _doorInterval = doorCheckInterval;
    return doorCheckInterval;
}

export async function goToPosition(bot, x, y, z, min_distance=2) {
    /**
     * Navigate to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to navigate to. If null, the bot's current x coordinate will be used.
     * @param {number} y, the y coordinate to navigate to. If null, the bot's current y coordinate will be used.
     * @param {number} z, the z coordinate to navigate to. If null, the bot's current z coordinate will be used.
     * @param {number} distance, the distance to keep from the position. Defaults to 2.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * let position = world.world.getNearestBlock(bot, "oak_log", 64).position;
     * await skills.goToPosition(bot, position.x, position.y, position.x + 20);
     **/
    if (x == null || y == null || z == null) {
        log(bot, `Missing coordinates, given x:${x} y:${y} z:${z}`);
        return false;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
        log(bot, `Teleported to ${x}, ${y}, ${z}.`);
        return true;
    }
    
    const checkDigProgress = () => {
        if (bot.targetDigBlock) {
            const targetBlock = bot.targetDigBlock;
            const itemId = bot.heldItem ? bot.heldItem.type : null;
            if (!targetBlock.canHarvest(itemId)) {
                log(bot, `Pathfinding stopped: Cannot break ${targetBlock.name} with current tools.`);
                bot.pathfinder.stop();
                bot.stopDigging();
            }
        }
    };
    
    const progressInterval = setInterval(checkDigProgress, 1000);
    
    try {
        await goToGoal(bot, new pf.goals.GoalNear(x, y, z, min_distance));
        clearInterval(progressInterval);
        const distance = bot.entity.position.distanceTo(new Vec3(x, y, z));
        if (distance <= min_distance+1) {
            log(bot, `You have reached at ${x}, ${y}, ${z}.`);
            return true;
        }
        else {
            log(bot, `Unable to reach ${x}, ${y}, ${z}, you are ${Math.round(distance)} blocks away.`);
            return false;
        }
    } catch (err) {
        log(bot, `Pathfinding stopped: ${err.message}.`);
        clearInterval(progressInterval);
        return false;
    }
}

export async function goToNearestBlock(bot, blockType,  min_distance=2, range=64) {
    /**
     * Navigate to the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to navigate to.
     * @param {number} min_distance, the distance to keep from the block. Defaults to 2.
     * @param {number} range, the range to look for the block. Defaults to 64.
     * @returns {Promise<boolean>} true if the block was reached, false otherwise.
     * @example
     * await skills.goToNearestBlock(bot, "oak_log", 64, 2);
     * **/
    const MAX_RANGE = 512;
    if (range > MAX_RANGE) {
        log(bot, `Maximum search range capped at ${MAX_RANGE}. `);
        range = MAX_RANGE;
    }
    let block = null;
    if (blockType === 'water' || blockType === 'lava') {
        let blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType && block.metadata === 0, range, 1);
        if (blocks.length === 0) {
            log(bot, `Could not find any source ${blockType} in ${range} blocks, looking for uncollectable flowing instead...`);
            blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType, range, 1);
        }
        block = blocks[0];
    }
    else {
        block = world.getNearestBlock(bot, blockType, range);
    }
    if (!block) {
        log(bot, `Could not find any ${blockType} in ${range} blocks.`);
        return false;
    }
    log(bot, `Found ${blockType} at ${block.position}. Navigating...`);
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, min_distance);
    return true;
}

export async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
    /**
     * Navigate to the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to navigate to.
     * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
     * @param {number} range, the range to look for the entity. Defaults to 64.
     * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
    if (!entity) {
        log(bot, `Could not find any ${entityType} in ${range} blocks.`);
        return false;
    }
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance} blocks away.`);
    await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, min_distance);
    return true;
}

export function getPlayer(bot, username) {
    if (!username || !bot.players) return null;
    if (bot.players[username]) return bot.players[username];
    const target = username.toLowerCase();
    for (const [name, p] of Object.entries(bot.players)) {
        if (name.toLowerCase() === target) return p;
    }
    return null;
}

export async function goToPlayer(bot, username, distance=3) {
    /**
     * Navigate to the given player.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to navigate to.
     * @param {number} distance, the goal distance to the player.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.goToPlayer(bot, "player");
     **/
    if (bot.username === username) {
        log(bot, `You are already at ${username}.`);
        return true;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + username);
        log(bot, `Teleported to ${username}.`);
        return true;
    }

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    const playerObj = getPlayer(bot, username);
    const player = playerObj?.entity;
    if (!player) {
        log(bot, `Player ${username} is not in visual range.`);
        return false;
    }

    distance = Math.max(distance, 0.5);
    const goal = new pf.goals.GoalFollow(player, distance);

    await goToGoal(bot, goal, true);

    log(bot, `You have reached ${username}.`);
    return true;
}


export async function followPlayer(bot, username, distance=4) {
    /**
     * Follow the given player endlessly. Will not return until the code is manually stopped.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to follow.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.followPlayer(bot, "player");
     **/
    const playerObj = getPlayer(bot, username);
    const player = playerObj?.entity;
    if (!player) {
        log(bot, `Could not find player ${username} nearby.`);
        return false;
    }

    const move = new pf.Movements(bot);
    move.digCost = 10;
    bot.pathfinder.setMovements(move);
    let doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
    log(bot, `You are now actively following player ${username}.`);


    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, 500));
        // in cheat mode, if the distance is too far, teleport to the player
        const distance_from_player = bot.entity.position.distanceTo(player.position);

        const teleport_distance = 100;
        const ignore_modes_distance = 30; 
        const nearby_distance = distance + 2;

        if (distance_from_player > teleport_distance && bot.modes.isOn('cheat')) {
            // teleport with cheat mode
            await goToPlayer(bot, username);
        }
        else if (distance_from_player > ignore_modes_distance) {
            // these modes slow down the bot, and we want to catch up
            bot.modes.pause('item_collecting');
            bot.modes.pause('hunting');
            bot.modes.pause('torch_placing');
        }
        else if (distance_from_player <= ignore_modes_distance) {
            bot.modes.unpause('item_collecting');
            bot.modes.unpause('hunting');
            bot.modes.unpause('torch_placing');
        }

        if (distance_from_player <= nearby_distance) {
            clearInterval(doorCheckInterval);
            doorCheckInterval = null;
            bot.modes.pause('unstuck');
            bot.modes.pause('elbow_room');
        }
        else {
            if (!doorCheckInterval) {
                doorCheckInterval = startDoorInterval(bot);
            }
            bot.modes.unpause('unstuck');
            bot.modes.unpause('elbow_room');
        }
    }
    clearInterval(doorCheckInterval);
    return true;
}


export async function moveAway(bot, distance) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    const pos = bot.entity.position;
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));

    if (bot.modes.isOn('cheat')) {
        const move = new pf.Movements(bot);
        const path = await bot.pathfinder.getPathTo(move, inverted_goal, 10000);
        let last_move = path.path[path.path.length-1];
        if (last_move) {
            let x = Math.floor(last_move.x);
            let y = Math.floor(last_move.y);
            let z = Math.floor(last_move.z);
            bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
            return true;
        }
    }

    await goToGoal(bot, inverted_goal);
    let new_pos = bot.entity.position;
    log(bot, `Moved away from ${pos.floored()} to ${new_pos.floored()}.`);
    return true;
}

export async function moveAwayFromEntity(bot, entity, distance=16) {
    /**
     * Move away from the given entity.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to move away from.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     **/
    let goal = new pf.goals.GoalFollow(entity, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));
    await bot.pathfinder.goto(inverted_goal);
    return true;
}

export async function avoidEnemies(bot, distance=16) {
    /**
     * Move a given distance away from all nearby enemy mobs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.avoidEnemies(bot, 8);
     **/
    bot.modes.pause('self_preservation'); // prevents damage-on-low-health from interrupting the bot
    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
    while (enemy) {
        const follow = new pf.goals.GoalFollow(enemy, distance+1); // move a little further away
        const inverted_goal = new pf.goals.GoalInvert(follow);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        bot.pathfinder.setGoal(inverted_goal, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
        if (bot.interrupt_code) {
            break;
        }
        if (enemy && bot.entity.position.distanceTo(enemy.position) < 3) {
            await attackEntity(bot, enemy, false);
        }
    }
    bot.pathfinder.stop();
    log(bot, `Moved ${distance} away from enemies.`);
    return true;
}

export async function stay(bot, seconds=30) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} seconds, the number of seconds to stay. Defaults to 30. -1 for indefinite.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    bot.modes.pause('unstuck');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    let start = Date.now();
    while (!bot.interrupt_code && (seconds === -1 || Date.now() - start < seconds*1000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `Stayed for ${(Date.now() - start)/1000} seconds.`);
    return true;
}

export async function useDoor(bot, door_pos=null) {
    /**
     * Use the door at the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Vec3} door_pos, the position of the door to use. If null, the nearest door will be used.
     * @returns {Promise<boolean>} true if the door was used, false otherwise.
     * @example
     * let door = world.getNearestBlock(bot, "oak_door", 16).position;
     * await skills.useDoor(bot, door);
     **/
    if (!door_pos) {
        for (let door_type of ['oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door',
                               'mangrove_door', 'cherry_door', 'bamboo_door', 'crimson_door', 'warped_door']) {
            door_pos = world.getNearestBlock(bot, door_type, 16).position;
            if (door_pos) break;
        }
    } else {
        door_pos = Vec3(door_pos.x, door_pos.y, door_pos.z);
    }
    if (!door_pos) {
        log(bot, `Could not find a door to use.`);
        return false;
    }

    bot.pathfinder.setGoal(new pf.goals.GoalNear(door_pos.x, door_pos.y, door_pos.z, 1));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    while (bot.pathfinder.isMoving()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    let door_block = bot.blockAt(door_pos);
    await bot.lookAt(door_pos);
    if (!door_block._properties.open)
        await bot.activateBlock(door_block);
    
    bot.setControlState("forward", true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    bot.setControlState("forward", false);
    await bot.activateBlock(door_block);

    log(bot, `Used door at ${door_pos}.`);
    return true;
}

export async function goToBed(bot) {
    /**
     * Sleep in the nearest bed.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bed was found, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    const beds = bot.findBlocks({
        matching: (block) => {
            return block.name.includes('bed');
        },
        maxDistance: 32,
        count: 1
    });
    if (beds.length === 0) {
        log(bot, `Could not find a bed to sleep in.`);
        return false;
    }
    let loc = beds[0];
    await goToPosition(bot, loc.x, loc.y, loc.z);
    const bed = bot.blockAt(loc);
    await bot.sleep(bed);
    log(bot, `You are in bed.`);
    bot.modes.pause('unstuck');
    while (bot.isSleeping) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `You have woken up.`);
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.tillAndSow(bot, position.x, position.y - 1, position.x, "wheat");
     **/
    let pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    let block = bot.blockAt(pos);
    log(bot, `Planting ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);

    if (bot.modes.isOn('cheat')) {
        let to_remove = ['_seed', '_seeds'];
        for (let remove of to_remove) {
            if (seedType.endsWith(remove)) {
                seedType = seedType.replace(remove, '');
            }
        }
        placeBlock(bot, 'farmland', x, y, z);
        placeBlock(bot, seedType, x, y+1, z);
        return true;
    }

    if (block.name !== 'grass_block' && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass_block or dirt.`);
        return false;
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (above.name !== 'air') {
        if (block.name === 'farmland') {
            log(bot, `Land is already farmed with ${above.name}.`);
            return true;
        }
        let broken = await breakBlockAt(bot, x, y+1, z);
        if (!broken) {
            log(bot, `Cannot cannot break above block to till.`);
            return false;
        }
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    if (block.name !== 'farmland') {
        let hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        let to_equip = hoe?.name || 'diamond_hoe';
        if (!await equip(bot, to_equip)) {
            log(bot, `Cannot till, no hoes.`);
            return false;
        }
        await bot.activateBlock(block);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let equipped_seeds = await equip(bot, seedType);
        if (!equipped_seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }

        await bot.activateBlock(block);
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    await bot.activateBlock(block);
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

/**
 * Helper function to find and navigate to a villager for trading
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager
 * @returns {Promise<Object|null>} the villager entity if found and reachable, null otherwise
 */
async function findAndGoToVillager(bot, id) {
    id = id+"";
    const entity = bot.entities[id];
    
    if (!entity) {
        log(bot, `Cannot find villager with id ${id}`);
        let entities = world.getNearbyEntities(bot, 16);
        let villager_list = "Available villagers:\n";
        for (let entity of entities) {
            if (entity.name === 'villager') {
                if (entity.metadata && entity.metadata[16] === 1) {
                    villager_list += `${entity.id}: baby villager\n`;
                } else {
                    const profession = world.getVillagerProfession(entity);
                    villager_list += `${entity.id}: ${profession}\n`;
                }
            }
        }
        if (villager_list === "Available villagers:\n") {
            log(bot, "No villagers found nearby.");
            return null;
        }
        log(bot, villager_list);
        return null;
    }
    
    if (entity.entityType !== bot.registry.entitiesByName.villager.id) {
        log(bot, 'Entity is not a villager');
        return null;
    }
    
    if (entity.metadata && entity.metadata[16] === 1) {
        log(bot, 'This is either a baby villager or a villager with no job - neither can trade');
        return null;
    }
    
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 4) {
        log(bot, `Villager is ${distance.toFixed(1)} blocks away, moving closer...`);
        try {
            bot.modes.pause('unstuck');
            const goal = new pf.goals.GoalFollow(entity, 2);
            await goToGoal(bot, goal);
            
            
            log(bot, 'Successfully reached villager');
        } catch (err) {
            log(bot, 'Failed to reach villager - pathfinding error or villager moved');
            console.log(err);
            return null;
        } finally {
            bot.modes.unpause('unstuck');
        }
    }
    
    return entity;
}

/**
 * Show available trades for a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to show trades for
 * @returns {Promise<boolean>} true if trades were shown successfully, false otherwise
 * @example
 * await skills.showVillagerTrades(bot, "123");
 */
export async function showVillagerTrades(bot, id) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        log(bot, `Villager has ${villager.trades.length} available trades:`);
        stringifyTrades(bot, villager.trades).forEach((trade, i) => {
            const tradeInfo = `${i + 1}: ${trade}`;
            console.log(tradeInfo);
            log(bot, tradeInfo);
        });
        
        villager.close();
        return true;
    } catch (err) {
        log(bot, 'Failed to open villager trading interface - they might be sleeping, a baby, or jobless');
        console.log('Villager trading error:', err.message);
        return false;
    }
}

/**
 * Trade with a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to trade with
 * @param {number} index - the index (1-based) of the trade to execute
 * @param {number} count - how many times to execute the trade (optional)
 * @returns {Promise<boolean>} true if trade was successful, false otherwise
 * @example
 * await skills.tradeWithVillager(bot, "123", "1", "2");
 */
export async function tradeWithVillager(bot, id, index, count) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        const tradeIndex = parseInt(index) - 1; // Convert to 0-based index
        const trade = villager.trades[tradeIndex];
        
        if (!trade) {
            log(bot, `Trade ${index} not found. This villager has ${villager.trades.length} trades available.`);
            villager.close();
            return false;
        }
        
        if (trade.disabled) {
            log(bot, `Trade ${index} is currently disabled`);
            villager.close();
            return false;
        }

        const item_2 = trade.inputItem2 ? stringifyItem(bot, trade.inputItem2)+' ' : '';
        log(bot, `Trading ${stringifyItem(bot, trade.inputItem1)} ${item_2}for ${stringifyItem(bot, trade.outputItem)}...`);
        
        const maxPossibleTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
        const requestedCount = count;
        const actualCount = Math.min(requestedCount, maxPossibleTrades);
        
        if (actualCount <= 0) {
            log(bot, `Trade ${index} has been used to its maximum limit`);
            villager.close();
            return false;
        }
        
        if (!hasResources(villager.slots, trade, actualCount)) {
            log(bot, `Don't have enough resources to execute trade ${index} ${actualCount} time(s)`);
            villager.close();
            return false;
        }
        
        log(bot, `Executing trade ${index} ${actualCount} time(s)...`);
        
        try {
            await bot.trade(villager, tradeIndex, actualCount);
            log(bot, `Successfully traded ${actualCount} time(s)`);
            villager.close();
            return true;
        } catch (tradeErr) {
            log(bot, 'An error occurred while trying to execute the trade');
            console.log('Trade execution error:', tradeErr.message);
            villager.close();
            return false;
        }
    } catch (err) {
        log(bot, 'Failed to open villager trading interface');
        console.log('Villager interface error:', err.message);
        return false;
    }
}

function hasResources(window, trade, count) {
    const first = enough(trade.inputItem1, count);
    const second = !trade.inputItem2 || enough(trade.inputItem2, count);
    return first && second;

    function enough(item, count) {
        let c = 0;
        window.forEach((element) => {
            if (element && element.type === item.type && element.metadata === item.metadata) {
                c += element.count;
            }
        });
        return c >= item.count * count;
    }
}

function stringifyTrades(bot, trades) {
    return trades.map((trade) => {
        let text = stringifyItem(bot, trade.inputItem1);
        if (trade.inputItem2) text += ` & ${stringifyItem(bot, trade.inputItem2)}`;
        if (trade.disabled) text += ' x '; else text += ' » ';
        text += stringifyItem(bot, trade.outputItem);
        return `(${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${text}`;
    });
}

function stringifyItem(bot, item) {
    if (!item) return 'nothing';
    let text = `${item.count} ${item.displayName}`;
    if (item.nbt && item.nbt.value) {
        const ench = item.nbt.value.ench;
        const StoredEnchantments = item.nbt.value.StoredEnchantments;
        const Potion = item.nbt.value.Potion;
        const display = item.nbt.value.display;

        if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown type'}`;
        if (display) text += ` named ${display.value.Name.value}`;
        if (ench || StoredEnchantments) {
            text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
                const lvl = e.lvl.value;
                const id = e.id.value;
                return bot.registry.enchantments[id].displayName + ' ' + lvl;
            }).join(' ')}`;
        }
    }
    return text;
}

export async function digDown(bot, distance = 10) {
    /**
     * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {int} distance, distance to dig down.
     * @returns {Promise<boolean>} true if successfully dug all the way down.
     * @example
     * await skills.digDown(bot, 10);
     **/

    let start_block_pos = bot.blockAt(bot.entity.position).position;
    for (let i = 1; i <= distance; i++) {
        const targetBlock = bot.blockAt(start_block_pos.offset(0, -i, 0));
        let belowBlock = bot.blockAt(start_block_pos.offset(0, -i-1, 0));

        if (!targetBlock || !belowBlock) {
            log(bot, `Dug down ${i-1} blocks, but reached the end of the world.`);
            return true;
        }

        // Check for lava, water
        if (targetBlock.name === 'lava' || targetBlock.name === 'water' || 
            belowBlock.name === 'lava' || belowBlock.name === 'water') {
            log(bot, `Dug down ${i-1} blocks, but reached ${belowBlock ? belowBlock.name : '(lava/water)'}`)
            return false;
        }

        const MAX_FALL_BLOCKS = 2;
        let num_fall_blocks = 0;
        for (let j = 0; j <= MAX_FALL_BLOCKS; j++) {
            if (!belowBlock || (belowBlock.name !== 'air' && belowBlock.name !== 'cave_air')) {
                break;
            }
            num_fall_blocks++;
            belowBlock = bot.blockAt(belowBlock.position.offset(0, -1, 0));
        }
        if (num_fall_blocks > MAX_FALL_BLOCKS) {
            log(bot, `Dug down ${i-1} blocks, but reached a drop below the next block.`);
            return false;
        }

        if (targetBlock.name === 'air' || targetBlock.name === 'cave_air') {
            log(bot, 'Skipping air block');
            console.log(targetBlock.position);
            continue;
        }

        let dug = await breakBlockAt(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
        if (!dug) {
            log(bot, 'Failed to dig block at position:' + targetBlock.position);
            return false;
        }
    }
    log(bot, `Dug down ${distance} blocks.`);
    return true;
}

export async function goToSurface(bot) {
    /**
     * Navigate to the surface (highest non-air block at current x,z).
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the surface was reached, false otherwise.
     **/
    const pos = bot.entity.position;
    for (let y = 360; y > -64; y--) { // probably not the best way to find the surface but it works
        const block = bot.blockAt(new Vec3(pos.x, y, pos.z));
        if (!block || block.name === 'air' || block.name === 'cave_air') {
            continue;
        }
        await goToPosition(bot, block.position.x, block.position.y + 1, block.position.z, 0); // this will probably work most of the time but a custom mining and towering up implementation could be added if needed
        log(bot, `Going to the surface at y=${y+1}.`);``
        return true;
    }
    return false;
}

export async function useToolOn(bot, toolName, targetName) {
    /**
     * Equip a tool and use it on the nearest target.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {string} targetName - entity type, block type, or "nothing" for no target
     * @returns {Promise<boolean>} true if action succeeded
     */
    if (!bot.inventory.slots.find(slot => slot && slot.name === toolName) && !bot.game.gameMode === 'creative') {
        log(bot, `You do not have any ${toolName} to use.`);
        return false;
    }

    targetName = targetName.toLowerCase();
    if (targetName === 'nothing') {
        const equipped = await equip(bot, toolName);
        if (!equipped) {
            return false;
        }
        await bot.activateItem();
        log(bot, `Used ${toolName}.`);
    } else if (world.isEntityType(targetName)) {
        const entity = world.getNearestEntityWhere(bot, e => e.name === targetName, 64);
        if (!entity) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z);
        if (toolName === 'hand') {
            await bot.unequip('hand');
        }
        else {
            const equipped = await equip(bot, toolName);
            if (!equipped) return false;
        }
        await bot.useOn(entity);
        log(bot, `Used ${toolName} on ${targetName}.`);
    } else {
        let block = null;
        if (targetName === 'water' || targetName === 'lava') {
            // we want to get liquid source blocks, not flowing blocks
            // so search for blocks with metadata 0 (not flowing)
            let blocks = world.getNearestBlocksWhere(bot, block => block.name === targetName && block.metadata === 0, 64, 1);
            if (blocks.length === 0) {
                log(bot, `Could not find any source ${targetName}.`);
                return false;
            }
            block = blocks[0];
        }
        else {
            block = world.getNearestBlock(bot, targetName, 64);
        }
        if (!block) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        return await useToolOnBlock(bot, toolName, block);
    }

    return true;
 }

 export async function useToolOnBlock(bot, toolName, block) {
    /**
     * Use a tool on a specific block.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {Block} block - the block reference to use the tool on.
     * @returns {Promise<boolean>} true if action succeeded
     */

    const distance = toolName === 'water_bucket' && block.name !== 'lava' ? 1.5 : 2;
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, distance);
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

    // if block in view is closer than the target block, it is in our way. try to move closer
    const viewBlocked = () => {
        const blockInView = bot.blockAtCursor(5);
        const headPos = bot.entity.position.offset(0, bot.entity.height, 0);
        return blockInView && 
            !blockInView.position.equals(block.position) && 
            blockInView.position.distanceTo(headPos) < block.position.distanceTo(headPos);
    }
    const blockInView = bot.blockAtCursor(5);
    if (viewBlocked()) {
        log(bot, `Block ${blockInView.name} is in the way, moving closer...`);
        // choose random block next to target block, go to it
        const nearbyPos = block.position.offset(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        await goToPosition(bot, nearbyPos.x, nearbyPos.y, nearbyPos.z, 1);
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        if (viewBlocked()) {
            const blockInView = bot.blockAtCursor(5);
            log(bot, `Block ${blockInView.name} is in the way, not using ${toolName}.`);
            return false;
        }
    }

    const equipped = await equip(bot, toolName);

    if (!equipped) {
        log(bot, `Could not equip ${toolName}.`);
        return false;
    }
    if (toolName.includes('bucket')) {
        await bot.activateItem();
    }
    else {
        await bot.activateBlock(block);
    }
    log(bot, `Used ${toolName} on ${block.name}.`);
    return true;
 }

export async function squadMineLogs(bot, targetNum = 384) {
    /**
     * Coordinate with squadmates to split up across radial sectors and mine trees until gathering targetNum logs (default 384 = 6 stacks).
     * @param {MinecraftBot} bot - Reference to the bot.
     * @param {number} targetNum - Number of logs to mine (default: 384).
     * @returns {Promise<boolean>} True if logs were mined, false otherwise.
     */
    if (!bot?.entity?.position) {
        log(bot, 'Bot is not fully spawned yet.');
        return false;
    }

    log(bot, `Starting squad tree mining mission (Goal: ${targetNum} logs / ${Math.round(targetNum / 64)} stacks)...`);

    // 1. Auto equip best armor & axe
    await autoEquipBest(bot);
    await equipBestToolFor(bot, 'oak_log');

    // 2. Determine squad index to split up geographically (Doombot=0, Doombot2=1, Doombot3=2, Doombot4=3, Doombot5=4)
    const nameMatch = bot.username.match(/\d+$/);
    const botIndex = nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;
    const totalSectors = 5;

    // Disperse squad radially (each bot heads in a unique 72-degree direction)
    const angle = (botIndex * 2 * Math.PI) / totalSectors;
    const dispersionDist = 28 + (botIndex * 8);
    const startPos = bot.entity.position.clone();
    const sectorAnchor = startPos.offset(
        Math.cos(angle) * dispersionDist,
        0,
        Math.sin(angle) * dispersionDist
    );

    log(bot, `Splitting up! Heading to designated forest sector ${botIndex + 1}/${totalSectors} (angle: ${Math.round(angle * 180 / Math.PI)}°)...`);
    try {
        await goToPosition(bot, sectorAnchor.x, sectorAnchor.y, sectorAnchor.z, 4);
    } catch {}

    // Sentinel Guard Role (Bot 5): Actively patrols perimeter and protects lumberjacks from hostiles
    if (botIndex === 4) {
        log(bot, `[SquadTeamwork] ${bot.username} taking position as Combat Sentinel: guarding lumberjacks against hostiles.`);
        let guardCycles = 0;
        while (guardCycles < 40 && !bot.interrupt_code) {
            const threat = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 22);
            if (threat) {
                await squadMutualProtection(bot, threat, 24);
            }
            await new Promise(r => setTimeout(r, 1000));
            guardCycles++;
        }
        return true;
    }

    const ALL_LOG_TYPES = [
        'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
        'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log',
        'stripped_oak_log', 'stripped_birch_log', 'stripped_spruce_log',
        'oak_wood', 'birch_wood', 'spruce_wood', 'jungle_wood'
    ];

    const getLogCount = () => {
        return bot.inventory.items()
            .filter(i => i.name.endsWith('_log') || i.name.endsWith('_wood'))
            .reduce((sum, i) => sum + i.count, 0);
    };

    const initialLogs = getLogCount();
    let currentLogs = initialLogs;
    let treesFelled = 0;
    const minedPositions = new Set();

    while (currentLogs < (initialLogs + targetNum) && !bot.interrupt_code) {
        // Survival check: Eat if hungry
        if (bot.food !== undefined && bot.food < 16 && bot.autoEat && typeof bot.autoEat.eat === 'function') {
            try { await bot.autoEat.eat(true); } catch {}
        }

        // Squad Mutual Protection check: Defend if hostiles nearby
        const hostile = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 16);
        if (hostile) {
            log(bot, `Defending against ${hostile.name} while logging.`);
            await squadMutualProtection(bot, hostile, 20);
            await autoEquipBest(bot);
            await equipBestToolFor(bot, 'oak_log');
        }

        // Find nearest tree log that hasn't been mined yet
        let logs = world.getNearestBlocksWhere(bot, block => {
            if (!ALL_LOG_TYPES.includes(block.name)) return false;
            const key = `${block.position.x},${block.position.y},${block.position.z}`;
            return !minedPositions.has(key);
        }, 48, 10);

        if (!logs || logs.length === 0) {
            // Step further outward into assigned sector to find fresh trees
            const nextAnchor = bot.entity.position.offset(
                Math.cos(angle) * 20,
                0,
                Math.sin(angle) * 20
            );
            log(bot, `Searching further in sector for more trees...`);
            try {
                await goToPosition(bot, nextAnchor.x, nextAnchor.y, nextAnchor.z, 3);
            } catch {}
            // Second attempt
            logs = world.getNearestBlocksWhere(bot, block => {
                if (!ALL_LOG_TYPES.includes(block.name)) return false;
                const key = `${block.position.x},${block.position.y},${block.position.z}`;
                return !minedPositions.has(key);
            }, 64, 10);
        }

        if (!logs || logs.length === 0) {
            log(bot, `No more reachable trees found in sector.`);
            break;
        }

        // Target tree base
        const treeLog = logs[0];
        try {
            await goToPosition(bot, treeLog.position.x, treeLog.position.y, treeLog.position.z, 2);
        } catch {}

        // Mine all connected trunk logs from bottom to top
        let trunkY = treeLog.position.y;
        while (trunkY <= treeLog.position.y + 7 && !bot.interrupt_code) {
            const blockAtTrunk = bot.blockAt(new Vec3(treeLog.position.x, trunkY, treeLog.position.z));
            if (!blockAtTrunk || !ALL_LOG_TYPES.includes(blockAtTrunk.name)) break;

            const posKey = `${blockAtTrunk.position.x},${blockAtTrunk.position.y},${blockAtTrunk.position.z}`;
            minedPositions.add(posKey);

            await equipBestToolFor(bot, blockAtTrunk.name);
            try {
                await bot.dig(blockAtTrunk, true);
            } catch (digErr) {
                if (digErr?.message?.includes('Digging aborted')) break;
            }
            trunkY++;
        }

        // Also check directly adjacent logs (for thick / branching trees)
        const nearbyBranches = world.getNearestBlocksWhere(bot, b => {
            if (!ALL_LOG_TYPES.includes(b.name)) return false;
            return bot.entity.position.distanceTo(b.position) <= 4.2;
        }, 5, 6);

        for (const branch of nearbyBranches) {
            if (bot.interrupt_code) break;
            const branchKey = `${branch.position.x},${branch.position.y},${branch.position.z}`;
            if (minedPositions.has(branchKey)) continue;
            minedPositions.add(branchKey);
            await equipBestToolFor(bot, branch.name);
            try { await bot.dig(branch, true); } catch {}
        }

        treesFelled++;
        // Also shake down reachable oak leaves to drop apples
        if (treeLog.name.includes('oak')) {
            const nearbyLeaves = world.getNearestBlocksWhere(bot, b => (b.name === 'oak_leaves' || b.name === 'dark_oak_leaves') && bot.entity.position.distanceTo(b.position) <= 4.2, 4, 6);
            for (const leaf of nearbyLeaves) {
                if (bot.interrupt_code) break;
                try { await bot.dig(leaf, true); } catch {}
            }
        }
        // Collect all dropped logs and vacuum dropped apples
        try { 
            await pickupNearbyItems(bot, 28, 'apple');
            await pickupNearbyItems(bot, 28); 
        } catch {}

        currentLogs = getLogCount();
        if (treesFelled % 2 === 0) {
            log(bot, `Progress: ${currentLogs} logs gathered (${Math.round(currentLogs / 64)} stacks).`);
        }

        // Check if inventory has free space
        if (bot.inventory.emptySlotCount() <= 0) {
            log(bot, `Inventory is full! Gathered ${currentLogs} logs.`);
            break;
        }
    }

    log(bot, `Mission complete! Gathered ${currentLogs - initialLogs} new logs (Total: ${currentLogs} logs / ${Math.round(currentLogs / 64)} stacks, ${treesFelled} trees felled).`);
    return currentLogs > initialLogs;
}

export async function boatTo(bot, x, y, z) {
    /**
     * Navigate across water using a boat to target coordinates.
     * @param {MinecraftBot} bot - Reference to the bot.
     * @param {number} x - Target x coordinate.
     * @param {number} y - Target y coordinate.
     * @param {number} z - Target z coordinate.
     * @returns {Promise<boolean>} True if destination was reached.
     */
    if (!bot?.entity?.position) return false;
    const dest = new Vec3(x, y, z);
    log(bot, `Navigating via boat to (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})...`);

    // Check if already in a boat
    if (bot.vehicle && bot.vehicle.name?.includes('boat')) {
        log(bot, `Already mounted in boat, steering toward destination...`);
    } else {
        // Check for nearby empty boat entity
        const nearbyBoat = bot.nearestEntity(e => e && e.name?.includes('boat') && bot.entity.position.distanceTo(e.position) <= 8);
        if (nearbyBoat) {
            try {
                await goToPosition(bot, nearbyBoat.position.x, nearbyBoat.position.y, nearbyBoat.position.z, 2);
                await bot.mount(nearbyBoat);
            } catch (err) {
                log(bot, `Could not mount nearby boat: ${err.message || err}`);
            }
        } else {
            // Check if bot has a boat in inventory
            const boatItem = bot.inventory.items().find(i => i.name.endsWith('_boat'));
            if (boatItem) {
                // Find adjacent water block
                const waterBlock = world.getNearestBlock(bot, 'water', 4);
                if (waterBlock) {
                    try {
                        await bot.equip(boatItem, 'hand');
                        await bot.placeEntity(waterBlock, new Vec3(0, 1, 0));
                        await new Promise(r => setTimeout(r, 600));
                        const placedBoat = bot.nearestEntity(e => e && e.name?.includes('boat') && bot.entity.position.distanceTo(e.position) <= 5);
                        if (placedBoat) {
                            await bot.mount(placedBoat);
                        }
                    } catch {}
                }
            }
        }
    }

    // If mounted, row forward towards destination
    if (bot.vehicle && bot.vehicle.name?.includes('boat')) {
        const startTime = Date.now();
        const maxRowTime = 45000; // 45 seconds max
        while (Date.now() - startTime < maxRowTime && !bot.interrupt_code) {
            const currentDist = bot.entity.position.distanceTo(dest);
            if (currentDist <= 4) break;

            // Check if stuck against land
            const blockInFront = bot.blockAt(bot.entity.position.offset(
                -Math.sin(bot.entity.yaw) * 2,
                0,
                Math.cos(bot.entity.yaw) * 2
            ));
            if (blockInFront && blockInFront.name !== 'water' && blockInFront.name !== 'air') {
                break;
            }

            try {
                await bot.lookAt(new Vec3(dest.x, bot.entity.position.y, dest.z), true);
                bot.setControlState('forward', true);
                bot.setControlState('sprint', true);
            } catch {}

            await new Promise(r => setTimeout(r, 400));
        }

        try {
            bot.clearControlStates();
            await bot.dismount();
        } catch {}
    }

    // Final leg: walk right up to destination coordinates safely
    return await goToPosition(bot, x, y, z, 2);
}

export async function squadMutualProtection(bot, enemy = null, radius = 24) {
    /**
     * Coordinated squad mutual defense:
     * - Auto-equips best armor, off-hand shield, and top weapon.
     * - Rallies on the nearest threat targeting any squadmate or ally.
     * - Shields low-health allies.
     */
    if (!bot?.entity?.position) return false;
    await autoEquipBest(bot);
    await equipHighestAttack(bot);

    const isAlive = (e) => e && e.isValid && (e.health == null || e.health > 0);
    let target = enemy && isAlive(enemy) ? enemy : null;

    if (!target) {
        target = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && isAlive(e) && !isAlly(bot, e), radius);
    }

    if (!target) return true;

    log(bot, `[SquadCombat] Rallying with squad to eliminate ${target.name || 'hostile'}!`);
    return await attackEntity(bot, target, true);
}

export function resolveMaterialBlock(raw) {
    const m = String(raw || '').toLowerCase().replace(/[\s-]+/g, '_').replace(/^raw_/, '').trim();

    // Earth & soils
    if (m === 'dirt' || m === 'grass' || m === 'grass_block' || m === 'soil' || m === 'earth') {
        return { blocks: ['dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'mud'], tool: 'shovel' };
    }
    if (m === 'mud' || m === 'packed_mud') {
        return { blocks: ['mud', 'packed_mud', 'mud_bricks'], tool: 'shovel' };
    }
    if (m === 'clay' || m === 'clay_ball' || m === 'clay_balls') {
        return { blocks: ['clay'], tool: 'shovel' };
    }
    if (m === 'soul_sand' || m === 'soul_soil') {
        return { blocks: ['soul_sand', 'soul_soil'], tool: 'shovel' };
    }

    // Sand & Gravel & Flint
    if (m === 'sand' || m === 'red_sand') {
        return { blocks: ['sand', 'red_sand'], tool: 'shovel' };
    }
    if (m === 'gravel' || m === 'flint') {
        return { blocks: ['gravel'], tool: 'shovel' };
    }

    // Common Stone & Cobblestone
    if (m === 'stone' || m === 'cobblestone' || m === 'cobble' || m === 'rocks') {
        return { blocks: ['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate'], tool: 'pickaxe' };
    }
    if (m === 'deepslate' || m === 'cobbled_deepslate') {
        return { blocks: ['deepslate', 'cobbled_deepslate'], tool: 'pickaxe' };
    }

    // Mineral Stones
    if (m === 'andesite' || m === 'polished_andesite') {
        return { blocks: ['andesite', 'polished_andesite'], tool: 'pickaxe' };
    }
    if (m === 'diorite' || m === 'polished_diorite') {
        return { blocks: ['diorite', 'polished_diorite'], tool: 'pickaxe' };
    }
    if (m === 'granite' || m === 'polished_granite') {
        return { blocks: ['granite', 'polished_granite'], tool: 'pickaxe' };
    }
    if (m === 'tuff') {
        return { blocks: ['tuff', 'deepslate'], tool: 'pickaxe' };
    }
    if (m === 'calcite') {
        return { blocks: ['calcite'], tool: 'pickaxe' };
    }
    if (m === 'dripstone' || m === 'dripstone_block' || m === 'pointed_dripstone') {
        return { blocks: ['dripstone_block', 'pointed_dripstone'], tool: 'pickaxe' };
    }
    if (m === 'basalt' || m === 'blackstone' || m === 'smooth_basalt') {
        return { blocks: ['basalt', 'blackstone', 'smooth_basalt'], tool: 'pickaxe' };
    }
    if (m === 'obsidian' || m === 'crying_obsidian') {
        return { blocks: ['obsidian', 'crying_obsidian'], tool: 'pickaxe' };
    }
    if (m === 'sandstone' || m === 'red_sandstone') {
        return { blocks: ['sandstone', 'red_sandstone'], tool: 'pickaxe' };
    }
    if (m === 'netherrack') {
        return { blocks: ['netherrack'], tool: 'pickaxe' };
    }
    if (m === 'end_stone' || m === 'endstone') {
        return { blocks: ['end_stone'], tool: 'pickaxe' };
    }

    // Ores
    if (m === 'iron' || m === 'iron_ore') {
        return { blocks: ['iron_ore', 'deepslate_iron_ore'], tool: 'pickaxe' };
    }
    if (m === 'coal' || m === 'coal_ore') {
        return { blocks: ['coal_ore', 'deepslate_coal_ore'], tool: 'pickaxe' };
    }
    if (m === 'copper' || m === 'copper_ore') {
        return { blocks: ['copper_ore', 'deepslate_copper_ore'], tool: 'pickaxe' };
    }
    if (m === 'gold' || m === 'gold_ore') {
        return { blocks: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'], tool: 'pickaxe' };
    }
    if (m === 'diamond' || m === 'diamonds' || m === 'diamond_ore') {
        return { blocks: ['diamond_ore', 'deepslate_diamond_ore'], tool: 'pickaxe' };
    }
    if (m === 'redstone' || m === 'redstone_ore') {
        return { blocks: ['redstone_ore', 'deepslate_redstone_ore'], tool: 'pickaxe' };
    }
    if (m === 'lapis' || m === 'lapis_ore' || m === 'lapis_lazuli') {
        return { blocks: ['lapis_ore', 'deepslate_lapis_ore'], tool: 'pickaxe' };
    }
    if (m === 'emerald' || m === 'emeralds' || m === 'emerald_ore') {
        return { blocks: ['emerald_ore', 'deepslate_emerald_ore'], tool: 'pickaxe' };
    }
    if (m === 'quartz' || m === 'nether_quartz' || m === 'nether_quartz_ore') {
        return { blocks: ['nether_quartz_ore'], tool: 'pickaxe' };
    }
    if (m === 'ancient_debris' || m === 'debris' || m === 'netherite') {
        return { blocks: ['ancient_debris'], tool: 'pickaxe' };
    }
    if (m === 'ores' || m === 'ore') {
        return {
            blocks: [
                'iron_ore', 'deepslate_iron_ore',
                'coal_ore', 'deepslate_coal_ore',
                'copper_ore', 'deepslate_copper_ore',
                'gold_ore', 'deepslate_gold_ore',
                'diamond_ore', 'deepslate_diamond_ore',
                'redstone_ore', 'deepslate_redstone_ore',
                'lapis_ore', 'deepslate_lapis_ore'
            ],
            tool: 'pickaxe'
        };
    }

    return { blocks: [m], tool: 'pickaxe' };
}

export async function squadCollectApples(bot, targetNum = 64) {
    /**
     * Coordinated squad apple harvesting:
     * - Sweeps for fallen apple drops across oak/dark oak forests.
     * - Disperses miners to break oak leaves overhead/around trees to accelerate apple drops.
     * - Sentinel guard (Bot 5) protects against hostiles.
     * - Continues until targetNum apples are collected in inventory.
     */
    if (!bot?.entity?.position) return false;
    log(bot, `Starting squad apple collection mission (Target: ${targetNum} apples / ${Math.round(targetNum / 64)} stacks)...`);

    await autoEquipBest(bot);

    const nameMatch = bot.username.match(/\d+$/);
    const botIndex = nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;

    // Sentinel Guard Role (Bot 5): Protect gatherers from mobs
    if (botIndex === 4) {
        log(bot, `[SquadCombat] ${bot.username} taking position as Combat Sentinel: protecting apple collectors.`);
        let guardCycles = 0;
        while (guardCycles < 30 && !bot.interrupt_code) {
            const threat = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 22);
            if (threat) {
                await squadMutualProtection(bot, threat, 24);
            }
            await new Promise(r => setTimeout(r, 1000));
            guardCycles++;
        }
        return true;
    }

    const getAppleCount = () => {
        return bot.inventory.items()
            .filter(i => i.name === 'apple')
            .reduce((sum, i) => sum + i.count, 0);
    };

    const initialApples = getAppleCount();
    let currentApples = initialApples;

    // 1. Vacuum any dropped apples on the ground
    await pickupNearbyItems(bot, 32, 'apple');
    currentApples = getAppleCount();
    if (currentApples >= initialApples + targetNum) {
        log(bot, `Mission accomplished! Gathered ${currentApples} apples.`);
        return true;
    }

    // Disperse squad to different oak trees/leaves
    const angle = (botIndex * 2 * Math.PI) / 4;
    const dispersionDist = 12 + (botIndex * 6);
    const anchor = bot.entity.position.offset(
        Math.cos(angle) * dispersionDist,
        0,
        Math.sin(angle) * dispersionDist
    );
    try { await goToPosition(bot, anchor.x, anchor.y, anchor.z, 3); } catch {}

    const brokenLeaves = new Set();
    let cycles = 0;

    while (currentApples < (initialApples + targetNum) && cycles < 40 && !bot.interrupt_code) {
        cycles++;

        // Survival check: Eat if hungry
        if (bot.food !== undefined && bot.food < 16 && bot.autoEat && typeof bot.autoEat.eat === 'function') {
            try { await bot.autoEat.eat(true); } catch {}
        }

        // Mutual defense
        const hostile = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 16);
        if (hostile) {
            await squadMutualProtection(bot, hostile, 20);
        }

        // 1. Vacuum any dropped apples
        await pickupNearbyItems(bot, 28, 'apple');
        currentApples = getAppleCount();
        if (currentApples >= initialApples + targetNum) break;

        // 2. Find oak leaves to break (oak_leaves and dark_oak_leaves drop apples)
        const oakLeaves = world.getNearestBlocksWhere(bot, b => {
            if (b.name !== 'oak_leaves' && b.name !== 'dark_oak_leaves') return false;
            const key = `${b.position.x},${b.position.y},${b.position.z}`;
            return !brokenLeaves.has(key);
        }, 32, 20);

        if (!oakLeaves || oakLeaves.length === 0) {
            log(bot, `Searching further for oak trees with leaves...`);
            const nextAnchor = bot.entity.position.offset(
                Math.cos(angle) * 16,
                0,
                Math.sin(angle) * 16
            );
            try { await goToPosition(bot, nextAnchor.x, nextAnchor.y, nextAnchor.z, 3); } catch {}
            continue;
        }

        for (let i = 0; i < oakLeaves.length && !bot.interrupt_code; i++) {
            // Partition leaves across the 4 gatherers
            if ((i % 4) !== (botIndex % 4)) continue;

            const leaf = oakLeaves[i];
            const key = `${leaf.position.x},${leaf.position.y},${leaf.position.z}`;
            brokenLeaves.add(key);

            try {
                if (bot.entity.position.distanceTo(leaf.position) > 4) {
                    await goToPosition(bot, leaf.position.x, leaf.position.y, leaf.position.z, 2.5);
                }
                await bot.dig(leaf, true);
            } catch {}

            // Sweep for apple drops after breaking leaves
            if (i % 3 === 0) {
                await pickupNearbyItems(bot, 24, 'apple');
                currentApples = getAppleCount();
                if (currentApples >= initialApples + targetNum) break;
            }
        }
    }

    await pickupNearbyItems(bot, 32, 'apple');
    currentApples = getAppleCount();
    log(bot, `Squad apple collection finished. Total apples: ${currentApples} (${Math.round(currentApples / 64)} stacks).`);
    return currentApples > initialApples;
}

export async function squadGatherMaterial(bot, materialName, targetNum = 64) {
    /**
     * Universal squad gathering/mining:
     * - Supports stone, dirt, ores (iron, coal, copper, gold, diamond, redstone, lapis, emerald, quartz, debris),
     *   sand, andesite, gravel, diorite, granite, tuff, obsidian, clay, apples, logs, and any mining block.
     * - Coordinated teamwork:
     *   - Bot 5 (Sentinel Guard): Keeps watch and attacks any hostiles that threaten miners.
     *   - Bot 4 (Logistics & Torcher): Auto-lights dark caves/quarries with torches, vacuums dropped items.
     *   - Bots 1-3 (Miners): Mine distinct blocks partitioned by coordinate hash modulo.
     * - Safe pathfinding with zero fall damage, auto-tool selection, auto-eat, and auto-pickup of drops!
     */
    if (!bot?.entity?.position) return false;

    const lowerMat = String(materialName || '').toLowerCase().trim();

    // Check if apple collection
    if (lowerMat === 'apple' || lowerMat === 'apples' || lowerMat === 'red_apple') {
        return await squadCollectApples(bot, targetNum);
    }

    // Check if log/timber collection
    if (lowerMat === 'wood' || lowerMat === 'log' || lowerMat === 'logs' || lowerMat === 'tree' || lowerMat === 'trees') {
        return await squadMineLogs(bot, targetNum);
    }

    // Check if diamond mining -> special underground diamond expedition to Y=-58 with hazard protection!
    if (lowerMat.includes('diamond')) {
        return await squadMineDiamonds(bot, targetNum);
    }

    // Resolve material definition (blocks, tool type)
    const matDef = resolveMaterialBlock(lowerMat);
    const targetBlocks = matDef.blocks;

    const nameMatch = bot.username.match(/\d+$/);
    const botIndex = nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;

    log(bot, `[SquadGather] ${bot.username} starting coordinated gathering for ${targetBlocks[0]} (Goal: ${targetNum} blocks / ${Math.round(targetNum / 64)} stacks, Role: ${botIndex === 4 ? 'Sentinel Guard' : (botIndex === 3 ? 'Logistics & Torcher' : 'Vein Miner')})...`);

    await autoEquipBest(bot);
    await equipBestToolFor(bot, targetBlocks[0]);

    // Sentinel Guard Role (Bot 5): Actively patrols perimeter and defends miners
    if (botIndex === 4) {
        log(bot, `[SquadTeamwork] ${bot.username} active as Combat Sentinel: protecting squad miners from hostiles.`);
        let guardCycles = 0;
        while (guardCycles < 40 && !bot.interrupt_code) {
            const threat = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 22);
            if (threat) {
                await squadMutualProtection(bot, threat, 24);
            }
            await new Promise(r => setTimeout(r, 1000));
            guardCycles++;
        }
        return true;
    }

    // Disperse miners radially so they don't dig in the exact same spot
    const angle = (botIndex * 2 * Math.PI) / 4;
    const dispersionDist = 8 + (botIndex * 4);
    const startPos = bot.entity.position.clone();
    const sectorAnchor = startPos.offset(
        Math.cos(angle) * dispersionDist,
        0,
        Math.sin(angle) * dispersionDist
    );
    try {
        await goToPosition(bot, sectorAnchor.x, sectorAnchor.y, sectorAnchor.z, 3);
    } catch {}

    const minedPositions = new Set();
    let mined = 0;
    let searchRadius = 32;
    let attempts = 0;

    while (mined < targetNum && attempts < 30 && !bot.interrupt_code) {
        attempts++;

        // Survival check: Eat if hungry
        if (bot.food !== undefined && bot.food < 16 && bot.autoEat && typeof bot.autoEat.eat === 'function') {
            try { await bot.autoEat.eat(true); } catch {}
        }

        // Mutual defense: defend if hostile mob approaches
        const hostile = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 14);
        if (hostile) {
            log(bot, `Pausing mining to defend against ${hostile.name}.`);
            await squadMutualProtection(bot, hostile, 18);
            await autoEquipBest(bot);
            await equipBestToolFor(bot, targetBlocks[0]);
        }

        // Find matching blocks in the world
        let blocks = world.getNearestBlocksWhere(bot, b => {
            if (!targetBlocks.includes(b.name)) return false;
            const key = `${b.position.x},${b.position.y},${b.position.z}`;
            if (minedPositions.has(key)) return false;

            // Safe mining check: don't dig block directly beneath bot's feet if dangerous
            if (b.position.x === Math.floor(bot.entity.position.x) &&
                b.position.z === Math.floor(bot.entity.position.z) &&
                b.position.y <= Math.floor(bot.entity.position.y)) {
                return false;
            }
            return true;
        }, searchRadius, 30);

        if (!blocks || blocks.length === 0) {
            // Search further out in assigned sector
            const nextAnchor = bot.entity.position.offset(
                Math.cos(angle) * 16,
                0,
                Math.sin(angle) * 16
            );
            try { await goToPosition(bot, nextAnchor.x, nextAnchor.y, nextAnchor.z, 3); } catch {}
            searchRadius = Math.min(searchRadius + 16, 64);
            continue;
        }

        for (let i = 0; i < blocks.length && mined < targetNum && !bot.interrupt_code; i++) {
            const block = blocks[i];
            const posKey = `${block.position.x},${block.position.y},${block.position.z}`;
            if (minedPositions.has(posKey)) continue;

            // Partition blocks across miners when multiple blocks are available
            if (blocks.length > 3) {
                const coordHash = Math.abs(block.position.x ^ block.position.z ^ block.position.y);
                if ((coordHash % 3) !== (botIndex % 3)) continue;
            }

            minedPositions.add(posKey);

            try {
                // Navigate safely to within mining reach (2.5 blocks)
                const dist = bot.entity.position.distanceTo(block.position);
                if (dist > 3.8) {
                    await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2.5);
                }

                await equipBestToolFor(bot, block.name);
                await bot.dig(block, true);
                mined++;

                // Logistics / Torching
                if (botIndex === 3 && mined % 6 === 0) {
                    await autoLight(bot);
                }

                // Vacuum drops every 4 blocks
                if (mined % 4 === 0) {
                    await pickupNearbyItems(bot, 24);
                }
            } catch (digErr) {
                if (digErr?.message?.includes('Digging aborted')) break;
            }
        }

        await pickupNearbyItems(bot, 24);
    }

    await pickupNearbyItems(bot, 28);
    log(bot, `[SquadGather] Gathered ${mined} ${targetBlocks[0]} (${Math.round(mined / 64)} stacks).`);
    return mined > 0;
}

export async function squadFarmCrops(bot) {
    /**
     * Teamwork farming: bots partition crop plots by coordinate parity so they don't crowd or re-dig the same plants.
     */
    if (!bot?.entity?.position) return false;
    await autoEquipBest(bot);

    const nameMatch = bot.username.match(/\d+$/);
    const botIndex = nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;

    const matureCrops = world.getNearestBlocksWhere(bot, block => {
        const name = block.name;
        if (name === 'wheat' && block.metadata === 7) return true;
        if (name === 'carrots' && block.metadata === 7) return true;
        if (name === 'potatoes' && block.metadata === 7) return true;
        if (name === 'beetroots' && block.metadata === 3) return true;
        return false;
    }, 24, 25);

    if (!matureCrops || matureCrops.length === 0) {
        log(bot, '[SquadFarm] No fully mature crops found nearby.');
        return false;
    }

    let harvested = 0;
    for (let i = 0; i < matureCrops.length && !bot.interrupt_code; i++) {
        const crop = matureCrops[i];
        // Coordinate hash modulo squad size: distinct plot for each bot
        const plotHash = Math.abs(crop.position.x + crop.position.z);
        if ((plotHash % 5) !== botIndex) continue;

        try {
            await goToPosition(bot, crop.position.x, crop.position.y, crop.position.z, 2);
            await bot.dig(crop, true);
            harvested++;
            await pickupNearbyItems(bot);

            // Replant crop seed on farmland
            const seedMap = {
                wheat: 'wheat_seeds',
                carrots: 'carrot',
                potatoes: 'potato',
                beetroots: 'beetroot_seeds'
            };
            const seedName = seedMap[crop.name];
            if (seedName) {
                const seedItem = bot.inventory.items().find(it => it.name === seedName);
                if (seedItem) {
                    await bot.equip(seedItem, 'hand');
                    const farmland = bot.blockAt(crop.position.offset(0, -1, 0));
                    if (farmland && farmland.name === 'farmland') {
                        await bot.placeBlock(farmland, new Vec3(0, 1, 0));
                    }
                }
            }
        } catch {}
    }

    await pickupNearbyItems(bot);
    log(bot, `[SquadFarm] Harvested and replanted ${harvested} mature crops.`);
    return harvested > 0;
}

export async function squadFollowPlayer(bot, targetName = 'orbryx') {
    /**
     * Teamwork tactical formation escort: bots surround target player in a protective perimeter
     * (vanguard, flankers, rearguard, scout) without colliding or pushing.
     */
    if (!bot?.entity?.position) return false;
    await autoEquipBest(bot);

    const nameMatch = bot.username.match(/\d+$/);
    const botIndex = nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;

    const target = bot.players[targetName]?.entity;
    if (!target) {
        log(bot, `Cannot find player ${targetName} nearby to escort.`);
        return false;
    }

    // Tactical formation offsets:
    // 0: Vanguard Right (+2.5, +2.5)
    // 1: Rearguard Left (-2.5, -2.5)
    // 2: Flank Left (-3.0, +1.0)
    // 3: Flank Right (+3.0, -1.0)
    // 4: Scout (+1.0, +4.0)
    const offsets = [
        { dx: 2.5, dz: 2.5, role: 'Vanguard Right' },
        { dx: -2.5, dz: -2.5, role: 'Rearguard Left' },
        { dx: -3.0, dz: 1.0, role: 'Flank Left' },
        { dx: 3.0, dz: -1.0, role: 'Flank Right' },
        { dx: 1.0, dz: 4.0, role: 'Point Scout' }
    ];

    const slot = offsets[botIndex % offsets.length];
    const dest = target.position.offset(slot.dx, 0, slot.dz);

    log(bot, `[SquadEscort] Holding formation as ${slot.role} protecting ${targetName}...`);
    return await goToPosition(bot, dest.x, dest.y, dest.z, 2);
}

export async function squadDefend(bot, radius = 24) {
    /**
     * Teamwork area defense: bots form a 360-degree security perimeter and assist each other against hostiles.
     */
    if (!bot?.entity?.position) return false;
    await autoEquipBest(bot);
    await equipHighestAttack(bot);

    const nameMatch = bot.username.match(/\d+$/);
    const botIndex = nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;

    // Disperse into perimeter patrol sector
    const angle = (botIndex * 2 * Math.PI) / 5;
    const patrolOffset = new Vec3(Math.cos(angle) * (radius * 0.6), 0, Math.sin(angle) * (radius * 0.6));
    const patrolSpot = bot.entity.position.plus(patrolOffset);

    try {
        await goToPosition(bot, patrolSpot.x, patrolSpot.y, patrolSpot.z, 2);
    } catch {}

    // Patrol loop
    let cycles = 0;
    while (cycles < 15 && !bot.interrupt_code) {
        const hostile = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), radius);
        if (hostile) {
            await squadMutualProtection(bot, hostile, radius);
        }
        await new Promise(r => setTimeout(r, 1200));
        cycles++;
    }

    return true;
}

// -------------------------------------------------------------
// UNDERGROUND DIAMOND MINING, CAVE AVOIDANCE & HAZARD SAFETY
// -------------------------------------------------------------

export function getBestDiamondYLevel(bot) {
    /**
     * Determines optimal diamond mining elevation:
     * In modern Minecraft (1.18 - 1.21.x / 1.26.x), world floor is Y = -64 and diamond density peaks at Y = -58.
     * In legacy Minecraft (<1.18), bedrock is at Y = 0 and best diamond layer is Y = 11.
     */
    const minY = bot?.game?.minY ?? -64;
    if (minY < 0 || (bot?.entity?.position && bot.entity.position.y < 0)) {
        return -58;
    }
    return 11;
}

export function detectLavaNear(bot, pos, radius = 2) {
    /**
     * Scans surrounding cubic area for lava or flowing lava.
     */
    if (!bot?.blockAt || !pos) return [];
    const lavaBlocks = [];
    const minX = Math.floor(pos.x - radius);
    const maxX = Math.floor(pos.x + radius);
    const minY = Math.floor(pos.y - radius);
    const maxY = Math.floor(pos.y + radius);
    const minZ = Math.floor(pos.z - radius);
    const maxZ = Math.floor(pos.z + radius);

    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            for (let z = minZ; z <= maxZ; z++) {
                const b = bot.blockAt(new Vec3(x, y, z));
                if (b && (b.name === 'lava' || b.name === 'flowing_lava')) {
                    lavaBlocks.push(b);
                }
            }
        }
    }
    return lavaBlocks;
}

export async function sealLavaBreach(bot, lavaBlock) {
    /**
     * Safely plugs or seals an exposed lava block with cobblestone/deepslate to eliminate hazard.
     */
    if (!bot?.inventory || !lavaBlock) return false;
    const solidBlockNames = [
        'cobblestone', 'cobbled_deepslate', 'deepslate', 'stone', 'dirt',
        'andesite', 'granite', 'diorite', 'netherrack', 'sandstone'
    ];
    let plugItem = bot.inventory.items().find(it => solidBlockNames.includes(it.name));
    if (!plugItem) {
        plugItem = bot.inventory.items().find(it => it.name.includes('stone') || it.name.includes('plank'));
    }
    if (!plugItem) return false;

    log(bot, `[HazardControl] ⚠️ Lava detected at [${lavaBlock.position.x}, ${lavaBlock.position.y}, ${lavaBlock.position.z}]. Sealing breach with ${plugItem.name}...`);
    try {
        await placeBlock(bot, plugItem.name, lavaBlock.position.x, lavaBlock.position.y, lavaBlock.position.z, 'bottom', true);
        return true;
    } catch {
        const neighbors = [
            lavaBlock.position.offset(0, 1, 0),
            lavaBlock.position.offset(1, 0, 0),
            lavaBlock.position.offset(-1, 0, 0),
            lavaBlock.position.offset(0, 0, 1),
            lavaBlock.position.offset(0, 0, -1)
        ];
        for (const n of neighbors) {
            try {
                await placeBlock(bot, plugItem.name, n.x, n.y, n.z, 'bottom', true);
                return true;
            } catch {}
        }
    }
    return false;
}

export function isCaveAhead(bot, fromPos, forwardVec) {
    /**
     * Inspects 2-4 blocks ahead in mining direction for open cave cavities or deep pitfall drops.
     * Returns true if open cave air or dangerous void is detected.
     */
    if (!bot?.blockAt || !fromPos || !forwardVec) return false;
    let airCount = 0;
    for (let step = 1; step <= 4; step++) {
        const checkEye = fromPos.offset(forwardVec.x * step, 1, forwardVec.z * step).floored();
        const checkFeet = fromPos.offset(forwardVec.x * step, 0, forwardVec.z * step).floored();
        const checkFloor = fromPos.offset(forwardVec.x * step, -1, forwardVec.z * step).floored();

        const eyeBlock = bot.blockAt(checkEye);
        const feetBlock = bot.blockAt(checkFeet);
        const floorBlock = bot.blockAt(checkFloor);

        if (eyeBlock && (eyeBlock.name === 'air' || eyeBlock.name === 'cave_air')) airCount++;
        if (feetBlock && (feetBlock.name === 'air' || feetBlock.name === 'cave_air')) airCount++;
        if (floorBlock && (floorBlock.name === 'air' || floorBlock.name === 'cave_air' || floorBlock.name.includes('lava') || floorBlock.name.includes('water'))) {
            return true; // Pitfall drop or liquid pit
        }
    }
    return airCount >= 3;
}

export async function sealCaveOpening(bot, pos, forwardVec) {
    /**
     * Walls off a cave opening with solid blocks to keep our mining corridor completely sealed and safe.
     */
    log(bot, `[HazardControl] 🛡️ Cave cavity detected ahead. Sealing opening to avoid cave mobs and hazards...`);
    const solidBlockNames = ['cobblestone', 'cobbled_deepslate', 'deepslate', 'stone', 'dirt'];
    const plugItem = bot.inventory.items().find(it => solidBlockNames.includes(it.name));
    if (!plugItem) return false;

    const wallPos1 = pos.offset(forwardVec.x, 0, forwardVec.z).floored();
    const wallPos2 = pos.offset(forwardVec.x, 1, forwardVec.z).floored();

    try { await placeBlock(bot, plugItem.name, wallPos1.x, wallPos1.y, wallPos1.z, 'bottom', true); } catch {}
    try { await placeBlock(bot, plugItem.name, wallPos2.x, wallPos2.y, wallPos2.z, 'bottom', true); } catch {}
    return true;
}

export async function handleGravelAbove(bot, targetPos) {
    /**
     * Checks for falling blocks (gravel, sand) above the target digging position.
     * Places a torch beneath or clears with shovel to eliminate suffocation danger.
     */
    if (!bot?.blockAt || !targetPos) return false;
    for (let dy = 1; dy <= 4; dy++) {
        const above = bot.blockAt(targetPos.offset(0, dy, 0));
        if (above && (above.name === 'gravel' || above.name === 'sand' || above.name.includes('gravel') || above.name.includes('sand'))) {
            log(bot, `[HazardControl] ⚠️ Falling block (${above.name}) detected above at Y=${above.position.y}. Clearing safely...`);
            const torchItem = bot.inventory.items().find(it => it.name === 'torch');
            if (torchItem) {
                try {
                    await placeBlock(bot, 'torch', targetPos.x, targetPos.y, targetPos.z, 'bottom', true);
                    await new Promise(r => setTimeout(r, 600));
                    await pickupNearbyItems(bot, 6);
                    return true;
                } catch {}
            }
            await equipBestToolFor(bot, above.name);
            try {
                await bot.dig(above, true);
                await pickupNearbyItems(bot, 6);
            } catch {}
        }
    }
    return false;
}

export function maxOreScan(bot, maxRadius = 64) {
    /**
     * Max-range ore scanner: inspects full 64-block radius for diamond and rare ores.
     */
    if (!bot?.entity?.position) return [];
    const valuableOres = [
        'diamond_ore', 'deepslate_diamond_ore',
        'ancient_debris',
        'iron_ore', 'deepslate_iron_ore',
        'gold_ore', 'deepslate_gold_ore',
        'copper_ore', 'deepslate_copper_ore',
        'coal_ore', 'deepslate_coal_ore',
        'redstone_ore', 'deepslate_redstone_ore',
        'lapis_ore', 'deepslate_lapis_ore',
        'emerald_ore', 'deepslate_emerald_ore',
        'nether_quartz_ore'
    ];

    const found = world.getNearestBlocksWhere(
        bot,
        b => valuableOres.includes(b.name),
        maxRadius,
        50
    );

    return found.map(b => ({
        name: b.name,
        position: b.position,
        distance: Math.round(bot.entity.position.distanceTo(b.position))
    }));
}

export async function mineFullVein(bot, startBlock, maxBlocks = 16) {
    /**
     * Mines entire contiguous vein of ores using Breadth-First Search (BFS).
     */
    if (!bot?.blockAt || !startBlock) return 0;
    const targetName = startBlock.name;
    const isDeepslate = targetName.startsWith('deepslate_');
    const baseName = targetName.replace('deepslate_', '');
    const validNames = [targetName, isDeepslate ? baseName : `deepslate_${baseName}`];

    log(bot, `[VeinMiner] 💎 Extracting contiguous ${validNames[0].replace(/_/g, ' ')} vein...`);
    await equipBestToolFor(bot, targetName);

    const queue = [startBlock.position.clone()];
    const visited = new Set();
    visited.add(`${startBlock.position.x},${startBlock.position.y},${startBlock.position.z}`);
    let minedCount = 0;

    while (queue.length > 0 && minedCount < maxBlocks && !bot.interrupt_code) {
        const curPos = queue.shift();
        const block = bot.blockAt(curPos);
        if (!block || !validNames.includes(block.name)) continue;

        try {
            const dist = bot.entity.position.distanceTo(block.position);
            if (dist > 4.2) {
                await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2.5);
            }
            await equipBestToolFor(bot, block.name);
            await bot.dig(block, true);
            minedCount++;
            await pickupNearbyItems(bot, 6);

            const neighbors = [
                curPos.offset(1, 0, 0), curPos.offset(-1, 0, 0),
                curPos.offset(0, 1, 0), curPos.offset(0, -1, 0),
                curPos.offset(0, 0, 1), curPos.offset(0, 0, -1)
            ];
            for (const n of neighbors) {
                const key = `${n.x},${n.y},${n.z}`;
                if (!visited.has(key)) {
                    visited.add(key);
                    const nBlock = bot.blockAt(n);
                    if (nBlock && validNames.includes(nBlock.name)) {
                        queue.push(n);
                    }
                }
            }
        } catch (err) {
            if (err?.message?.includes('Digging aborted')) break;
        }
    }
    await pickupNearbyItems(bot, 10);
    return minedCount;
}

export async function safeStaircaseDown(bot, targetY = -58) {
    /**
     * Safely carves a walkable descending staircase to target Y level:
     * - Never digs straight down or straight up.
     * - Checks for lava ahead/below and caps breaches with cobblestone.
     * - Detects caves ahead and branches 90 degrees away to keep tunnel sealed.
     * - Handles falling gravel/sand with torch placement.
     * - Places torches every 6 steps for full illumination.
     */
    if (!bot?.entity?.position) return false;
    await autoEquipBest(bot);
    await equipBestToolFor(bot, 'deepslate');

    const destY = targetY;
    log(bot, `[Staircase] ⛏️ Starting safe descent from Y=${Math.floor(bot.entity.position.y)} to optimal diamond level Y=${destY}...`);

    let currentHeading = new Vec3(1, 0, 0); // Start digging +X
    let steps = 0;
    const maxSteps = 160;

    while (bot.entity.position.y > destY && steps < maxSteps && !bot.interrupt_code) {
        steps++;

        // Mutual defense: defend against nearby hostiles
        const hostile = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 12);
        if (hostile) {
            log(bot, `[Staircase] Pausing to defend against ${hostile.name}...`);
            await squadMutualProtection(bot, hostile, 16);
            await autoEquipBest(bot);
            await equipBestToolFor(bot, 'deepslate');
        }

        // Eat if hungry
        if (bot.food !== undefined && bot.food < 16 && bot.autoEat && typeof bot.autoEat.eat === 'function') {
            try { await bot.autoEat.eat(true); } catch {}
        }

        const currentPos = bot.entity.position.floored();

        // 1. Cave avoidance: check if cave opens ahead
        if (isCaveAhead(bot, currentPos, currentHeading)) {
            log(bot, `[Staircase] ⚠️ Cave detected ahead in heading (${currentHeading.x}, ${currentHeading.z}). Turning 90 degrees to bypass cave...`);
            await sealCaveOpening(bot, currentPos, currentHeading);
            // Rotate heading 90 degrees (X -> Z -> -X -> -Z)
            currentHeading = new Vec3(-currentHeading.z, 0, currentHeading.x);
            continue;
        }

        // 2. Lava hazard detection
        const targetStep = currentPos.offset(currentHeading.x, -1, currentHeading.z);
        const lavas = detectLavaNear(bot, targetStep, 2);
        if (lavas.length > 0) {
            log(bot, `[Staircase] ⚠️ Lava detected near step. Sealing breach and turning...`);
            for (const lava of lavas) {
                await sealLavaBreach(bot, lava);
            }
            currentHeading = new Vec3(-currentHeading.z, 0, currentHeading.x);
            continue;
        }

        // 3. Falling gravel check above target
        const eyeStep = currentPos.offset(currentHeading.x, 1, currentHeading.z);
        await handleGravelAbove(bot, eyeStep);

        // 4. Dig 3 blocks for safe step: eye level, foot level, and next floor step
        const footStep = currentPos.offset(currentHeading.x, 0, currentHeading.z);
        const floorStep = currentPos.offset(currentHeading.x, -1, currentHeading.z);

        try {
            await breakBlockAt(bot, eyeStep.x, eyeStep.y, eyeStep.z);
            await breakBlockAt(bot, footStep.x, footStep.y, footStep.z);
            // Verify step floor is solid: if air/liquid, place solid block to walk on
            const floorBlock = bot.blockAt(floorStep);
            if (floorBlock && (floorBlock.name === 'air' || floorBlock.name === 'cave_air' || floorBlock.name.includes('lava') || floorBlock.name.includes('water'))) {
                const plugItem = bot.inventory.items().find(it => ['cobblestone', 'deepslate', 'dirt', 'stone'].includes(it.name));
                if (plugItem) {
                    await placeBlock(bot, plugItem.name, floorStep.x, floorStep.y, floorStep.z, 'bottom', true);
                }
            } else {
                await breakBlockAt(bot, floorStep.x, floorStep.y, floorStep.z);
            }

            // Move onto the new step
            await goToPosition(bot, footStep.x + 0.5, footStep.y, footStep.z + 0.5, 1);

            // Light with torches every 6 steps
            if (steps % 6 === 0) {
                await autoLight(bot);
            }

            // Vacuum items every 4 steps
            if (steps % 4 === 0) {
                await pickupNearbyItems(bot, 6);
            }
        } catch (stepErr) {
            log(bot, `[Staircase] Obstacle at step, adjusting heading: ${stepErr?.message || stepErr}`);
            currentHeading = new Vec3(-currentHeading.z, 0, currentHeading.x);
        }
    }

    await pickupNearbyItems(bot, 12);
    log(bot, `[Staircase] 🏁 Reached destination Y=${Math.floor(bot.entity.position.y)} (target diamond level).`);
    return bot.entity.position.y <= (destY + 2);
}

export async function diamondStripMine(bot, maxDiamonds = 64, tunnelLength = 60) {
    /**
     * Diamond strip-mining operation at optimal diamond Y level:
     * - First safely descends to Y = -58 if not already at diamond level.
     * - Mines efficient 1x2 tunnel forward.
     * - Scans 64-block range for diamonds and rare ores; extracts full veins when discovered.
     * - Avoids caves: seals opening and branches into solid deepslate.
     * - Places torches every 6 blocks to prevent mob spawns.
     */
    if (!bot?.entity?.position) return 0;
    const bestY = getBestDiamondYLevel(bot);

    // If above diamond layer, descend first
    if (bot.entity.position.y > (bestY + 3)) {
        log(bot, `[DiamondMine] Current Y=${Math.floor(bot.entity.position.y)}. Excavating safe staircase down to Y=${bestY}...`);
        await safeStaircaseDown(bot, bestY);
    }

    log(bot, `[DiamondMine] 💎 Commencing diamond strip mining at Y=${Math.floor(bot.entity.position.y)} (Goal: ${maxDiamonds} diamonds)...`);
    await autoEquipBest(bot);
    await equipBestToolFor(bot, 'deepslate_diamond_ore');

    let heading = new Vec3(1, 0, 0); // Mining direction
    let diamondsMined = 0;
    let distanceMined = 0;

    while (diamondsMined < maxDiamonds && distanceMined < tunnelLength && !bot.interrupt_code) {
        distanceMined++;

        // Mutual defense: defend if hostile mob approaches
        const hostile = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 14);
        if (hostile) {
            log(bot, `[DiamondMine] Pausing mining to defend against ${hostile.name}...`);
            await squadMutualProtection(bot, hostile, 18);
            await autoEquipBest(bot);
            await equipBestToolFor(bot, 'deepslate_diamond_ore');
        }

        // Survival check: Eat if hungry
        if (bot.food !== undefined && bot.food < 16 && bot.autoEat && typeof bot.autoEat.eat === 'function') {
            try { await bot.autoEat.eat(true); } catch {}
        }

        const curPos = bot.entity.position.floored();

        // 1. Cave avoidance: check if open cave ahead
        if (isCaveAhead(bot, curPos, heading)) {
            log(bot, `[DiamondMine] 🛡️ Cave ahead! Sealing opening and branching 90 degrees into solid rock...`);
            await sealCaveOpening(bot, curPos, heading);
            heading = new Vec3(-heading.z, 0, heading.x);
            continue;
        }

        // 2. Lava hazard check
        const stepPos = curPos.offset(heading.x, 0, heading.z);
        const lavas = detectLavaNear(bot, stepPos, 2);
        if (lavas.length > 0) {
            log(bot, `[DiamondMine] ⚠️ Lava pocket encountered. Sealing and branching...`);
            for (const l of lavas) {
                await sealLavaBreach(bot, l);
            }
            heading = new Vec3(-heading.z, 0, heading.x);
            continue;
        }

        // 3. Falling gravel check above
        const eyePos = curPos.offset(heading.x, 1, heading.z);
        await handleGravelAbove(bot, eyePos);

        // 4. Dig 1x2 tunnel forward
        try {
            await breakBlockAt(bot, eyePos.x, eyePos.y, eyePos.z);
            await breakBlockAt(bot, stepPos.x, stepPos.y, stepPos.z);

            // Step forward into mined tunnel
            await goToPosition(bot, stepPos.x + 0.5, stepPos.y, stepPos.z + 0.5, 1);

            // Light tunnel with torches every 6 blocks
            if (distanceMined % 6 === 0) {
                await autoLight(bot);
            }

            // Max-range 64-block ore scan every 3 blocks
            if (distanceMined % 3 === 0) {
                const oresFound = maxOreScan(bot, 64);
                const nearbyDiamonds = oresFound.filter(o => o.name.includes('diamond'));
                if (nearbyDiamonds.length > 0) {
                    const closest = nearbyDiamonds[0];
                    log(bot, `[DiamondMine] 💎 Diamond vein located ${closest.distance} blocks away at [${closest.position.x}, ${closest.position.y}, ${closest.position.z}]! Extracting...`);
                    const block = bot.blockAt(closest.position);
                    if (block) {
                        const count = await mineFullVein(bot, block);
                        diamondsMined += count;
                    }
                }
            }

            // Check adjacent wall/floor/ceiling blocks directly bordering tunnel
            const adjacentOffsets = [
                new Vec3(0, 2, 0), new Vec3(0, -1, 0),
                new Vec3(-heading.z, 0, heading.x), new Vec3(heading.z, 0, -heading.x),
                new Vec3(-heading.z, 1, heading.x), new Vec3(heading.z, 1, -heading.x)
            ];
            for (const off of adjacentOffsets) {
                const adjBlock = bot.blockAt(curPos.offset(off.x, off.y, off.z));
                if (adjBlock && (adjBlock.name.includes('diamond') || adjBlock.name.includes('iron') || adjBlock.name.includes('gold'))) {
                    const count = await mineFullVein(bot, adjBlock);
                    if (adjBlock.name.includes('diamond')) diamondsMined += count;
                }
            }

            // Vacuum items periodically
            if (distanceMined % 4 === 0) {
                await pickupNearbyItems(bot, 8);
            }
        } catch (digErr) {
            log(bot, `[DiamondMine] Obstacle encountered: ${digErr?.message || digErr}. Adjusting heading.`);
            heading = new Vec3(-heading.z, 0, heading.x);
        }
    }

    await pickupNearbyItems(bot, 16);
    log(bot, `[DiamondMine] 🏁 Completed diamond expedition. Total diamonds collected: ${diamondsMined}.`);
    return diamondsMined;
}

export async function squadMineDiamonds(bot, targetNum = 64) {
    /**
     * Master collaborative squad diamond mining:
     * - Multi-bot specialized teamwork:
     *   - Bot 0 (Lead Miner): Digs safe staircase to Y=-58, tunnels forward, extracts diamond veins.
     *   - Bot 1 (Branch Miner): Digs parallel branch tunnels 3 blocks apart to maximize vein discovery.
     *   - Bot 2 (Torch Bearer): Stays 3 blocks behind miners, monitors light level, places wall torches.
     *   - Bot 3 (Sentry Guard): Equips shield & sword, watches rear/flanks, slays zombies/skeletons/creepers.
     *   - Bot 4 (Logistics Hauler): Vacuums all drops, monitors teammates' food/durability, passes supplies.
     * - If solo (1 bot): Automatically executes all duties safely!
     */
    if (!bot?.entity?.position) return false;
    await autoEquipBest(bot);

    const nameMatch = bot.username.match(/\d+$/);
    const botIndex = nameMatch ? (parseInt(nameMatch[0], 10) - 1) : 0;
    const bestY = getBestDiamondYLevel(bot);

    const roles = [
        '⛏️ Lead Diamond Miner',
        '⛏️ Branch Shaft Miner',
        '🕯️ Torch Bearer & Illuminator',
        '🛡️ Sentry Combat Guard',
        '🎒 Logistics Hauler & Collector'
    ];
    const role = roles[botIndex % roles.length];
    log(bot, `[SquadDiamonds] ${bot.username} joining diamond expedition (Role: ${role}, Goal: ${targetNum} diamonds / ${Math.round(targetNum / 64)} stacks, Depth: Y=${bestY})...`);

    // Guard Role (Bot 3): Station at mine entrance/rear and defend miners from hostiles
    if (botIndex === 3) {
        log(bot, `[SquadTeamwork] ${bot.username} active as Underground Sentry Guard: watching flanks with shield and sword.`);
        await equipHighestAttack(bot);
        let guardCycles = 0;
        while (guardCycles < 50 && !bot.interrupt_code) {
            const threat = world.getNearestEntityWhere(bot, e => mc.isHostile(e) && !isAlly(bot, e), 18);
            if (threat) {
                await squadMutualProtection(bot, threat, 22);
            }
            await new Promise(r => setTimeout(r, 1000));
            guardCycles++;
        }
        return true;
    }

    // Torch Bearer Role (Bot 2): Follows miners, checks light level, places torches
    if (botIndex === 2) {
        log(bot, `[SquadTeamwork] ${bot.username} active as Torch Bearer: illuminating corridors so mobs cannot spawn.`);
        let lightCycles = 0;
        while (lightCycles < 40 && !bot.interrupt_code) {
            await autoLight(bot);
            await pickupNearbyItems(bot, 16);
            await new Promise(r => setTimeout(r, 1500));
            lightCycles++;
        }
        return true;
    }

    // Logistics Hauler Role (Bot 4): Follows and vacuums drops
    if (botIndex === 4) {
        log(bot, `[SquadTeamwork] ${bot.username} active as Logistics Hauler: vacuuming dropped ores and blocks.`);
        let haulCycles = 0;
        while (haulCycles < 40 && !bot.interrupt_code) {
            await pickupNearbyItems(bot, 24);
            await new Promise(r => setTimeout(r, 1200));
            haulCycles++;
        }
        return true;
    }

    // Miners (Bot 0 & 1):
    return (await diamondStripMine(bot, targetNum, 80)) > 0;
}

export async function squadMineStone(bot, targetNum = 64) {
    /**
     * Teamwork quarrying and stone mining:
     * - Miners excavate cobblestone/deepslate.
     * - Torch Bearer keeps quarry lit.
     * - Guard protects against monsters.
     */
    if (!bot?.entity?.position) return false;
    return await squadGatherMaterial(bot, 'cobblestone', targetNum);
}

export async function squadMineWood(bot, targetNum = 64) {
    /**
     * Teamwork forestry: chops trees, gathers logs, collects dropped apples.
     * Per standing instructions, strictly avoids replanting saplings!
     */
    if (!bot?.entity?.position) return false;
    return await squadMineLogs(bot, targetNum);
}

export async function squadMineOres(bot, oreType = 'iron_ore', targetNum = 64) {
    /**
     * Teamwork ore mining with max 64-block ore scanning and full vein extraction.
     */
    if (!bot?.entity?.position) return false;
    const lower = String(oreType || '').toLowerCase();
    if (lower.includes('diamond')) {
        return await squadMineDiamonds(bot, targetNum);
    }
    return await squadGatherMaterial(bot, oreType, targetNum);
}


