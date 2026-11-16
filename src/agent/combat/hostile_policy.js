// Mineflayer uses `type: mob` for both passive and hostile entities on some
// protocol versions. Keep an explicit conservative list so cows, villagers,
// and other passive entities are never combat targets by default.
export const HOSTILE_ENTITY_NAMES = new Set([
    'blaze', 'bogged', 'breeze', 'cave_spider', 'creeper', 'drowned',
    'elder_guardian', 'enderman', 'endermite', 'evoker', 'ghast', 'guardian',
    'hoglin', 'husk', 'magma_cube', 'phantom', 'piglin_brute', 'pillager',
    'ravager', 'shulker', 'silverfish', 'skeleton', 'slime', 'spider', 'stray',
    'vex', 'vindicator', 'warden', 'witch', 'wither', 'wither_skeleton',
    'zoglin', 'zombie', 'zombie_villager'
]);

export function isHostileEntity(entity) {
    if (!entity || entity.type === 'player') return false;
    if (entity.mobType === 'hostile' || entity.category === 'hostile' || entity.type === 'hostile') return true;
    return HOSTILE_ENTITY_NAMES.has(String(entity.name || '').toLowerCase());
}
