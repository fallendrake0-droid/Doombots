// Small, dependency-free combat math helpers. They deliberately use only ordinary
// client-side state; no packets are forged or modified to influence combat.

export function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

export function finiteVector(vector) {
    if (!vector || !isFiniteNumber(vector.x) || !isFiniteNumber(vector.y) || !isFiniteNumber(vector.z)) {
        return { x: 0, y: 0, z: 0 };
    }
    return vector;
}

export function horizontalDistance(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    return Math.hypot(dx, dz);
}

export function distance(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    return Math.hypot(dx, dy, dz);
}

export function yawTo(from, to) {
    return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/**
 * Predict a target position using its observed Mineflayer velocity. Velocity is
 * clamped so malformed protocol data cannot produce an unreachable aim point.
 */
export function leadTarget(position, velocity, ticks, maxSpeed = 1.5) {
    const safeVelocity = finiteVector(velocity);
    const speed = Math.hypot(safeVelocity.x, safeVelocity.y, safeVelocity.z);
    const scale = speed > maxSpeed ? maxSpeed / speed : 1;
    return {
        x: position.x + safeVelocity.x * ticks * scale,
        y: position.y + safeVelocity.y * ticks * scale,
        z: position.z + safeVelocity.z * ticks * scale
    };
}

/**
 * Solve a low-arc ballistic shot and lead a moving target. The constants match
 * a fully charged bow closely enough for a server-compatible fallback aim; a
 * caller should still use Mineflayer's normal activateItem/deactivateItem API.
 */
export function planBowShot(origin, target, targetVelocity = { x: 0, y: 0, z: 0 }, options = {}) {
    const speed = options.speed ?? 3.0; // blocks per game tick for a charged bow
    const gravity = options.gravity ?? 0.05;
    const maxLeadTicks = options.maxLeadTicks ?? 24;
    const aimHeight = options.aimHeight ?? 0.9;

    if (!isFiniteNumber(speed) || !isFiniteNumber(gravity) || speed <= 0 || gravity <= 0) {
        return null;
    }

    let predicted = {
        x: target.x,
        y: target.y + aimHeight,
        z: target.z
    };
    let solution = null;

    // Two iterations are enough to account for ordinary player/mob movement
    // without turning ranged combat into a costly per-tick calculation.
    for (let i = 0; i < 2; i++) {
        const dx = predicted.x - origin.x;
        const dz = predicted.z - origin.z;
        const horizontal = Math.hypot(dx, dz);
        const vertical = predicted.y - origin.y;
        if (horizontal < 0.05) return null;

        const speedSquared = speed * speed;
        const discriminant = speedSquared * speedSquared - gravity * (gravity * horizontal * horizontal + 2 * vertical * speedSquared);
        if (!isFiniteNumber(discriminant) || discriminant < 0) return null;

        // The lower angle is less likely to collide with a ceiling and has a
        // shorter flight time, which makes it more reliable in survival worlds.
        const angle = Math.atan((speedSquared - Math.sqrt(discriminant)) / (gravity * horizontal));
        const horizontalVelocity = speed * Math.cos(angle);
        if (!isFiniteNumber(angle) || horizontalVelocity <= 0) return null;

        const flightTicks = Math.min(maxLeadTicks, Math.max(1, horizontal / horizontalVelocity));
        solution = {
            yaw: yawTo(origin, predicted),
            pitch: -angle,
            flightTicks,
            target: predicted
        };
        predicted = leadTarget({ x: target.x, y: target.y + aimHeight, z: target.z }, targetVelocity, flightTicks);
    }

    return solution;
}

export function withinReach(origin, target, reach) {
    return distance(origin, target) <= reach;
}
