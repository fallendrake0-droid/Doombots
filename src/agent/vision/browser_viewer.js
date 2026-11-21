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
            const primaryOnly = settings.viewer_primary_only !== false && process.env.VIEWER_ALL !== 'true';
            if (primaryOnly && count_id > 0) {
                return; // Primary bot (Doombot, port 3000) streams 3D view for the whole squad
            }
            const port = 3000 + (count_id || 0);
            const viewDistance = settings.view_distance || 3;
            const isFirstPerson = Boolean(settings.viewer_first_person);
            const viewType = isFirstPerson ? '3D First-Person View' : '2D Mario Side-View';
            try {
                mineflayerViewer(bot, {
                    port,
                    firstPerson: isFirstPerson,
                    viewDistance
                });
                console.log(`\x1b[36m[Viewer]\x1b[0m 🎮 ${viewType} active for \x1b[1m\x1b[32m${bot.username}\x1b[0m at \x1b[4m\x1b[34mhttp://localhost:${port}\x1b[0m`);
            } catch (vErr) {
                console.warn(`[Viewer] Failed to start viewer on port ${port}:`, vErr?.message || vErr);
            }
        }
    } else {
        console.warn(`[Viewer] To enable 3D world view, run: npm install prismarine-viewer`);
    }
}