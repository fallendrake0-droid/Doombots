import settings from '../settings.js';

/**
 * Browser rendering is optional in DoomBots. Do not load Prismarine Viewer (and
 * its native graphics dependency chain) into every headless worker.
 */
export async function addBrowserViewer(bot, countId) {
    if (!settings.render_bot_view) return false;
    try {
        const { default: prismarineViewer } = await import('prismarine-viewer');
        prismarineViewer.mineflayer(bot, { port: 3000 + countId, firstPerson: true });
        return true;
    } catch (error) {
        console.warn(`[viewer] Disabled: optional rendering dependency is unavailable (${error.message}).`);
        return false;
    }
}
