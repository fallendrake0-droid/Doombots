import { execSync } from 'child_process';
import { existsSync, readdirSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export function applyViewer2dPatch() {
    try {
        const pubJs = './node_modules/prismarine-viewer/public/index.js';
        const pubHtml = './node_modules/prismarine-viewer/public/index.html';
        if (existsSync(pubJs)) {
            let code = readFileSync(pubJs, 'utf8');
            const oldTarget = 'if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1)';
            const newTarget = 'if(t.y>0&&(window._is3d?(s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1)):(h&&(h.target.set(t.x,t.y+1.5,t.z),u.camera.position.set(t.x,t.y+1.5,t.z+16),h.update(),s=!1))))';
            if (code.includes(oldTarget)) {
                code = code.replace(oldTarget, newTarget);
                writeFileSync(pubJs, code, 'utf8');
                console.log('[postinstall] Applied 2D Mario Side-View camera controller to prismarine-viewer.');
            }
        }
        if (existsSync(pubHtml)) {
            let html = readFileSync(pubHtml, 'utf8');
            if (!html.includes('toggleCameraMode')) {
                html = html.replace('<body>', `<body>\n    <script>\n      window._is3d = false;\n      function toggleCameraMode() {\n        window._is3d = !window._is3d;\n        const btn = document.getElementById('modeBtn');\n        if (btn) btn.textContent = window._is3d ? '🌐 3D Orbit Cam' : '🎮 2D Mario Side-View';\n      }\n    </script>\n    <div style="position:fixed;top:10px;left:10px;z-index:99999;display:flex;gap:8px;align-items:center;">\n      <button id="modeBtn" onclick="toggleCameraMode()" style="background:rgba(15,23,42,0.85);color:#38bdf8;border:1px solid #38bdf8;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;backdrop-filter:blur(4px);box-shadow:0 2px 8px rgba(0,0,0,0.5);">🎮 2D Mario Side-View</button>\n      <span style="background:rgba(15,23,42,0.75);color:#94a3b8;padding:4px 8px;border-radius:4px;font-size:11px;font-family:sans-serif;">Side-Scroller Camera Following Bot</span>\n    </div>`);
                writeFileSync(pubHtml, html, 'utf8');
                console.log('[postinstall] Injected 2D Mario mode UI controls into prismarine-viewer.');
            }
        }
    } catch (e) {
        // ignore
    }
}

export function applyBotSkin() {
    try {
        const skinSource = './skins/red_knight.png';
        if (!existsSync(skinSource)) return;
        const baseDir = './node_modules/prismarine-viewer/public/textures';
        if (!existsSync(baseDir)) return;
        const findAndReplace = (dir) => {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    findAndReplace(fullPath);
                } else if (entry.name === 'steve.png' || entry.name === 'alex.png') {
                    copyFileSync(skinSource, fullPath);
                }
            }
        };
        findAndReplace(baseDir);
        console.log('[postinstall] Applied Red Knight skin to all prismarine-viewer textures.');
    } catch {
        // ignore
    }
}

// Apply patches safely - skip patches for optional/uninstalled packages (like prismarine-viewer)
try {
    const patchPackageCmd = existsSync('./node_modules/.bin/patch-package')
        ? './node_modules/.bin/patch-package'
        : 'npx patch-package';

    const patchesDir = './patches';
    if (!existsSync(patchesDir)) {
        process.exit(0);
    }

    const tempPatchDir = './.patches-temp';
    if (existsSync(tempPatchDir)) rmSync(tempPatchDir, { recursive: true, force: true });
    mkdirSync(tempPatchDir, { recursive: true });

    let count = 0;
    const patchFiles = readdirSync(patchesDir);
    for (const file of patchFiles) {
        if (!file.endsWith('.patch')) continue;
        const pkgName = file.split('+')[0];
        if (existsSync(path.join('./node_modules', pkgName))) {
            copyFileSync(path.join(patchesDir, file), path.join(tempPatchDir, file));
            count++;
        } else {
            console.log(`[postinstall] Skipping patch for uninstalled package: ${pkgName}`);
        }
    }

    if (count > 0) {
        execSync(`${patchPackageCmd} --patch-dir ${tempPatchDir}`, { stdio: 'inherit' });
    }
    rmSync(tempPatchDir, { recursive: true, force: true });

    applyViewer2dPatch();
    applyBotSkin();
} catch (err) {
    console.warn('[postinstall] patch-package warning (skipped missing optional packages or mismatch):', err?.message || err);
    applyViewer2dPatch();
    applyBotSkin();
}
