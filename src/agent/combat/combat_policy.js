export const WEAPON_DAMAGE = {
    netherite_sword: 8,
    diamond_sword: 7,
    iron_sword: 6,
    stone_sword: 5,
    golden_sword: 4,
    wooden_sword: 4,
    netherite_axe: 10,
    diamond_axe: 9,
    iron_axe: 9,
    stone_axe: 9,
    golden_axe: 7,
    wooden_axe: 7,
    trident: 9
};

export const WEAPON_SPEED = {
    netherite_sword: 1.6,
    diamond_sword: 1.6,
    iron_sword: 1.6,
    stone_sword: 1.6,
    golden_sword: 1.6,
    wooden_sword: 1.6,
    netherite_axe: 1.0,
    diamond_axe: 1.0,
    iron_axe: 0.9,
    stone_axe: 0.8,
    golden_axe: 1.0,
    wooden_axe: 0.8,
    trident: 1.1
};

export function chooseMeleeWeapon(items = []) {
    return items
        .filter(item => WEAPON_DAMAGE[item?.name] != null)
        .sort((a, b) => WEAPON_DAMAGE[b.name] - WEAPON_DAMAGE[a.name])[0] || null;
}

export function attackDelayMs(weapon) {
    const speed = WEAPON_SPEED[weapon?.name] || 1.6;
    return Math.ceil((1000 / speed) * 1.05);
}

/** Select a bounded next operation; entity/physics actions happen elsewhere. */
export function chooseCombatOperation({
    hasTarget,
    health = 20,
    retreatHealth,
    targetDistance,
    attackRange,
    hasBow,
    ranged = {}
}) {
    if (!hasTarget) return 'idle';
    if (health <= retreatHealth) return 'retreat';
    if (targetDistance <= attackRange) return 'melee';
    if (hasBow && ranged.enabled && targetDistance >= ranged.min_range && targetDistance <= ranged.max_range) return 'ranged';
    return 'follow';
}
