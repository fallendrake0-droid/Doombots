const MINECRAFT_PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;

/** Build one safe server-plugin teleport request; never accept or force teleport. */
export function buildTpaRequest(playerName) {
    const target = String(playerName || '').trim();
    if (!MINECRAFT_PLAYER_NAME.test(target)) {
        return { ok: false, error: 'Player name must be 3–16 letters, numbers, or underscores.' };
    }
    return { ok: true, target, command: `/tpa ${target}` };
}
