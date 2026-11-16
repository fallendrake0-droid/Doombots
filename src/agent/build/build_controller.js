import * as skills from '../library/skills.js';
import { createBuildPlan } from './build_plan.js';

export { createBuildPlan } from './build_plan.js';

/** Build a bounded, inventory-backed structure through normal placeBlock calls. */
export async function buildStructure(bot, structure, material, size = 5) {
    const origin = bot.entity.position.offset(-Math.floor(size / 2), -1, -Math.floor(size / 2));
    const plan = createBuildPlan(structure, origin, size);
    const available = bot.inventory.items().filter(item => item.name === material).reduce((sum, item) => sum + item.count, 0);
    if (bot.game.gameMode !== 'creative' && available < plan.length) {
        throw new Error(`Need ${plan.length} ${material}; only ${available} available.`);
    }

    let placed = 0;
    let failed = 0;
    for (const position of plan) {
        if (bot.interrupt_code) break;
        const current = bot.blockAt(position);
        if (current?.name === material) {
            placed++;
            continue;
        }
        if (await skills.placeBlock(bot, material, position.x, position.y, position.z, 'bottom', true)) placed++;
        else failed++;
    }
    return { placed, failed, planned: plan.length, interrupted: bot.interrupt_code };
}
