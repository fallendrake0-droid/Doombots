export function isSolidLandingBlock(block) {
    if (!block || !block.name) return false;
    return !['air', 'cave_air', 'void_air', 'water', 'lava', 'fire', 'soul_fire', 'tall_grass', 'short_grass'].includes(block.name);
}

export function shouldHandleSurvivalState({ inLavaOrFire, health = 20, emergencyHealthThreshold, healthPotionThreshold, falling, drowning = false }) {
    return inLavaOrFire || health <= emergencyHealthThreshold || health <= healthPotionThreshold || falling || drowning;
}

/** Guard a normal clutch interaction: do not attempt it while too far away. */
export function canAttemptClutch({
    onGround,
    verticalVelocity,
    cooldownElapsed,
    landingDrop,
    minFallBlocks,
    landingDistance,
    maxInteractionDistance = 4.65
}) {
    return !onGround &&
        Number.isFinite(verticalVelocity) && verticalVelocity <= -0.28 &&
        cooldownElapsed &&
        Number.isFinite(landingDrop) && landingDrop >= minFallBlocks &&
        Number.isFinite(landingDistance) && landingDistance <= maxInteractionDistance;
}
