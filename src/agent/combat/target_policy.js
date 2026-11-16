export function entityIsUsable(entity) {
    return entity && entity.position &&
        Number.isFinite(entity.position.x) &&
        Number.isFinite(entity.position.y) &&
        Number.isFinite(entity.position.z) &&
        entity.isValid !== false;
}

export function isExcludedPlayer(entity, ownNames = [], teammateNames = []) {
    if (!entity || entity.type !== 'player') return false;
    const name = entity.username || entity.name;
    return typeof name === 'string' && [...ownNames, ...teammateNames].includes(name);
}

/** A player needs explicit policy permission; mobs must be supplied as hostile. */
export function isEligibleTarget(entity, { allowPlayers = false, excludedPlayer = false, hostile = false } = {}) {
    if (!entityIsUsable(entity)) return false;
    if (entity.type === 'player') return allowPlayers && !excludedPlayer;
    return hostile === true;
}
