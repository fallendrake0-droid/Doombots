const POSITION_PACKETS = new Set(['position', 'position_look']);

/**
 * Normalise known protocol shapes and rate-limit only movement packets. The
 * guard intentionally does not touch combat or rotation-only packets, so it
 * cannot be used as an anti-cheat bypass and does not degrade legitimate aim.
 */
export function applyPacketGuard(bot, logger = console) {
    const client = bot?._client;
    if (!client) return () => {};

    const normaliseVelocity = packet => {
        const velocity = packet?.velocity;
        if (!velocity || typeof velocity !== 'object') return;
        if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y) || !Number.isFinite(velocity.z)) return;
        if (packet.velocityX == null) packet.velocityX = velocity.x;
        if (packet.velocityY == null) packet.velocityY = velocity.y;
        if (packet.velocityZ == null) packet.velocityZ = velocity.z;
    };

    // Mineflayer 4.33 reads flat velocity aliases. If an upstream protocol
    // adapter emits the documented vector as `velocity`, add only those missing
    // aliases; native flat packets remain unchanged.
    client.prependListener('entity_velocity', normaliseVelocity);
    client.prependListener('spawn_entity', normaliseVelocity);

    const originalWrite = client.write.bind(client);
    let lastMovementAt = 0;
    let pendingMovement = null;
    let movementTimer = null;
    const minIntervalMs = 50;

    client.write = function guardedWrite(name, data) {
        if (!POSITION_PACKETS.has(name)) return originalWrite(name, data);
        const elapsed = Date.now() - lastMovementAt;
        if (elapsed >= minIntervalMs && !movementTimer) {
            lastMovementAt = Date.now();
            return originalWrite(name, data);
        }

        // Always retain the latest state. The old implementation kept the first
        // packet in a burst, which could send stale coordinates after movement.
        pendingMovement = { name, data };
        if (!movementTimer) {
            movementTimer = setTimeout(() => {
                movementTimer = null;
                const next = pendingMovement;
                pendingMovement = null;
                if (!next) return;
                lastMovementAt = Date.now();
                try {
                    originalWrite(next.name, next.data);
                } catch (error) {
                    logger.warn?.(`[packet-guard] movement flush failed: ${error.message}`);
                }
            }, Math.max(1, minIntervalMs - elapsed));
        }
        return undefined;
    };

    const cleanup = () => {
        if (movementTimer) clearTimeout(movementTimer);
        movementTimer = null;
        pendingMovement = null;
        client.removeListener('entity_velocity', normaliseVelocity);
        client.removeListener('spawn_entity', normaliseVelocity);
        if (client.write !== originalWrite) client.write = originalWrite;
    };
    bot.once('end', cleanup);
    return cleanup;
}
