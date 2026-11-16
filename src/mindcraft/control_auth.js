import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Ephemeral control-channel credential for one locally spawned bot worker. */
export function createControlToken() {
    return randomBytes(24).toString('hex');
}

/** Constant-time comparison avoids exposing partial token matches in logs/timing. */
export function validControlToken(expected, supplied) {
    if (typeof expected !== 'string' || typeof supplied !== 'string') return false;
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}
