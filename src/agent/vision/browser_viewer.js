import settings from '../settings.js';

let isInstalling = false;

export async function addBrowserViewer(bot, count_id = 0) {
    const isEnabled = settings.render_bot_view !== false || process.env.RENDER_BOT_VIEW === 'true';
    if (!isEnabled) return;

    let mod = null;
    try {
        mod = await import('prismarine-viewer');
    } catch (err) {
        if (!isInstalling && (err?.code === 'ERR_MODULE_NOT_FOUND' || String(err?.message || err).includes('Cannot find package'))) {
            isInstalling = true;
            console.log(`\x1b[36m[Viewer]\x1b[0m 📦 Installing 'prismarine-viewer' for 3D World View (pure JS, no compile required)...`);
            try {
                const { execSync } = await import('child_process');
                execSync('npm install prismarine-viewer --no-save', { stdio: 'inherit' });
                mod = await import('prismarine-viewer');
                console.log(`\x1b[32m[Viewer]\x1b[0m ✔ 'prismarine-viewer' installed successfully!`);
            } catch (installErr) {
                console.warn(`[Viewer] Auto-install failed:`, installErr?.message || installErr);
            }
            isInstalling = false;
        }
    }

    if (mod) {
        let mineflayerViewer = mod.mineflayer;
        if (!mineflayerViewer && mod.default) {
            mineflayerViewer = mod.default.mineflayer || (typeof mod.default === 'function' ? mod.default : null);
        }

        if (typeof mineflayerViewer === 'function') {
            const port = 3000 + (count_id || 0);
            const viewDistance = settings.view_distance || (settings.low_memory_mode ? 4 : 6);
            try {
                mineflayerViewer(bot, {
                    port,
                    firstPerson: Boolean(settings.viewer_first_person),
                    viewDistance
                });
                console.log(`\x1b[36m[Viewer]\x1b[0m 🌐 3D World View active for \x1b[1m\x1b[32m${bot.username}\x1b[0m at \x1b[4m\x1b[34mhttp://localhost:${port}\x1b[0m`);
            } catch (vErr) {
                console.warn(`[Viewer] Failed to start viewer on port ${port}:`, vErr?.message || vErr);
            }
        }
    } else {
        console.warn(`[Viewer] To enable 3D world view, run: npm install prismarine-viewer`);
    }
}