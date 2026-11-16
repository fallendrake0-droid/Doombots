const AUTH_MODES = new Set(['offline', 'microsoft']);

/** Validate only local connection configuration; credentials remain Mineflayer-owned. */
export function validateConnectionSettings(settings = {}) {
    const host = String(settings.host || '').trim();
    const port = Number(settings.port);
    if (!host || host.length > 255 || /[\u0000-\u001f\s]/.test(host)) {
        return { ok: false, error: 'Minecraft host must be a compact hostname or IP address.' };
    }
    if (!Number.isInteger(port) || (port !== -1 && (port < 1 || port > 65535))) {
        return { ok: false, error: 'Minecraft port must be -1 for LAN discovery or an integer from 1 to 65535.' };
    }
    if (!AUTH_MODES.has(settings.auth)) {
        return { ok: false, error: 'Minecraft auth must be offline or microsoft.' };
    }
    if (settings.minecraft_version != null && typeof settings.minecraft_version !== 'string') {
        return { ok: false, error: 'Minecraft version must be auto or a version string.' };
    }
    return { ok: true };
}

export { AUTH_MODES };
