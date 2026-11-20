import settings from '../settings.js';

export async function addBrowserViewer(bot, count_id = 0) {
    const isEnabled = settings.render_bot_view !== false || process.env.RENDER_BOT_VIEW === 'true';
    if (!isEnabled) return;

    try {
        const mod = await import('prismarine-viewer');
        let mineflayerViewer = mod.mineflayer;
        if (!mineflayerViewer && mod.default) {
            mineflayerViewer = mod.default.mineflayer || (typeof mod.default === 'function' ? mod.default : null);
        }

        if (typeof mineflayerViewer === 'function') {
            const port = 3000 + (count_id || 0);
            const viewDistance = settings.view_distance || (settings.low_memory_mode ? 4 : 6);
            mineflayerViewer(bot, {
                port,
                firstPerson: Boolean(settings.viewer_first_person),
                viewDistance
            });
            console.log(`\x1b[36m[Viewer]\x1b[0m 🌐 3D World View active for \x1b[1m\x1b[32m${bot.username}\x1b[0m at \x1b[4m\x1b[34mhttp://localhost:${port}\x1b[0m`);
        }
    } catch (err) {
        console.warn(`[Viewer] Could not start 3D World View for ${bot.username}:`, err?.message || err);
        console.warn(`[Viewer] To enable 3D world view, ensure 'prismarine-viewer' is installed: npm install prismarine-viewer`);
    }
}