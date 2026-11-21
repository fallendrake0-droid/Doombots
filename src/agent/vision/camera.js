import THREE from 'three';
import fs from 'fs/promises';
import { Vec3 } from 'vec3';
import { EventEmitter } from 'events';

import worker_threads from 'worker_threads';
globalThis.Worker = worker_threads.Worker;

let Viewer = null;
let WorldView = null;
let getBufferFromStream = null;
try {
    const viewerMod = await import('prismarine-viewer/viewer/lib/viewer.js').catch(() => null);
    Viewer = viewerMod?.Viewer || null;
    const worldViewMod = await import('prismarine-viewer/viewer/lib/worldView.js').catch(() => null);
    WorldView = worldViewMod?.WorldView || null;
    const utilsMod = await import('prismarine-viewer/viewer/lib/simpleUtils.js').catch(() => null);
    getBufferFromStream = utilsMod?.getBufferFromStream || null;
} catch {
    // optional canvas dependencies not installed
}

let createCanvas = null;
try {
    const canvasMod = await import('node-canvas-webgl/lib/index.js').catch(() => null);
    createCanvas = canvasMod?.createCanvas || null;
} catch {
    createCanvas = null;
}

export class Camera extends EventEmitter {
    constructor (bot, fp) {
        super();
        if (!createCanvas || !Viewer || !WorldView) {
            throw new Error("Optional headless canvas dependencies ('node-canvas-webgl' or 'canvas') are not installed. Headless bot camera is disabled.");
        }
        this.bot = bot;
        this.fp = fp;
        this.viewDistance = 12;
        this.width = 800;
        this.height = 512;
        this.canvas = createCanvas(this.width, this.height);
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas });
        this.viewer = new Viewer(this.renderer);
        this._init().then(() => {
            this.emit('ready');
        });
    }
  
    async _init () {
        const botPos = this.bot.entity.position;
        const center = new Vec3(botPos.x, botPos.y+this.bot.entity.height, botPos.z);
        this.viewer.setVersion(this.bot.version);
        // Load world
        const worldView = new WorldView(this.bot.world, this.viewDistance, center);
        this.viewer.listen(worldView);
        worldView.listenToBot(this.bot);
        await worldView.init(center);
        this.worldView = worldView;
    }
  
    async capture() {
        const center = new Vec3(this.bot.entity.position.x, this.bot.entity.position.y+this.bot.entity.height, this.bot.entity.position.z);
        this.viewer.camera.position.set(center.x, center.y, center.z);
        await this.worldView.updatePosition(center);
        this.viewer.setFirstPersonCamera(this.bot.entity.position, this.bot.entity.yaw, this.bot.entity.pitch);
        this.viewer.update();
        this.renderer.render(this.viewer.scene, this.viewer.camera);

        const imageStream = this.canvas.createJPEGStream({
            bufsize: 4096,
            quality: 100,
            progressive: false
        });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot_${timestamp}`;

        const buf = await getBufferFromStream(imageStream);
        await this._ensureScreenshotDirectory();
        await fs.writeFile(`${this.fp}/${filename}.jpg`, buf);
        console.log('saved', filename);
        return filename;
    }

    async _ensureScreenshotDirectory() {
        let stats;
        try {
            stats = await fs.stat(this.fp);
        } catch (e) {
            if (!stats?.isDirectory()) {
                await fs.mkdir(this.fp);
            }
        }
    }
}
  
