// Screenshots: prismarine-viewer draws the world from the bot's own chunk data in a hidden
// browser (Microsoft Edge on Windows, already installed), and Playwright takes the picture.
// The browser only runs while screenshots are being taken, then closes after a minute.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createStateTranslator, translateChunkJson } from './translate.js';

const require = createRequire(import.meta.url);
const express = require('express');
const { Server } = require('socket.io');
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView');
const { getVersion } = require('prismarine-viewer/viewer/lib/version');

const PUBLIC = path.join(path.dirname(require.resolve('prismarine-viewer/package.json')), 'public');
const BROWSER_ARGS = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SETTLE_MS = 800;
const FIRST_LOAD_MAX_MS = 20_000;
const RENDER_MS = 250;

// Runs in the page before the viewer: counts 3D objects added to the scene, so we can tell
// when the world has finished being built (chunk meshes are made in background workers).
const TRACK_MESHES = `(() => {
  let three;
  window.__meshes = 0;
  window.__lastMeshAt = Date.now();
  Object.defineProperty(window, 'THREE', {
    configurable: true,
    get: () => three,
    set: (v) => {
      three = v;
      const add = v.Object3D.prototype.add;
      v.Object3D.prototype.add = function (...objects) {
        if (objects.some((o) => o && o.isMesh)) {
          window.__meshes = (window.__meshes || 0) + 1;
          window.__lastMeshAt = Date.now();
        }
        return add.apply(this, objects);
      };
    },
  });
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Vision {
  constructor(getBot, { port = 3007, viewDistance = 6, idleCloseMs = 60_000, browserPath = null, log = console.log } = {}) {
    this.getBot = getBot;
    this.port = port;
    this.viewDistance = viewDistance;
    this.idleCloseMs = idleCloseMs;
    this.browserPath = browserPath ?? process.env.FRIENDLESS_BROWSER ?? null;
    this.log = log;
    this.server = null;
    this.browser = null;
    this.page = null;
    this.session = null; // { bot, socket, worldView, lastChunkAt }
    this.idleTimer = null;
    this.queue = Promise.resolve();
  }

  async startServer() {
    if (this.server) return;
    const app = express();
    app.use(express.static(PUBLIC));
    const server = http.createServer(app);
    const io = new Server(server);
    io.on('connection', (socket) => this.onConnection(socket));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      // only this PC can open it
      server.listen(this.port, '127.0.0.1', resolve);
    });
    this.server = { http: server, io };
  }

  onConnection(socket) {
    const bot = this.getBot();
    if (!bot?.entity) return socket.disconnect();
    this.session?.socket.disconnect();

    const rendererVersion = getVersion(bot.version) ?? bot.version;
    const translate = createStateTranslator(bot.version, rendererVersion);
    const session = { bot, socket, lastChunkAt: Date.now() };

    // WorldView streams chunks/blocks/entities; this emitter translates them for the renderer
    const emitter = {
      emit: (event, data) => {
        if (event === 'loadChunk') {
          session.lastChunkAt = Date.now();
          data = { ...data, chunk: translateChunkJson(data.chunk, translate) };
        } else if (event === 'blockUpdate') {
          data = { ...data, stateId: translate(data.stateId) };
        }
        socket.emit(event, data);
      },
      on: (event, fn) => socket.on(event, fn),
    };

    socket.emit('version', rendererVersion);
    socket.emit('position', { pos: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch, addMesh: false });
    session.worldView = new WorldView(bot.world, this.viewDistance, bot.entity.position, emitter);
    session.worldView.init(bot.entity.position);
    session.worldView.listenToBot(bot);
    socket.on('disconnect', () => {
      session.worldView.removeListenersFromBot(bot);
      if (this.session === session) this.session = null;
    });
    this.session = session;
  }

  async launchBrowser() {
    const { chromium } = await import('playwright-core');
    const attempts = this.browserPath
      ? [{ executablePath: this.browserPath }]
      : [{ channel: 'msedge' }, { channel: 'chrome' }];
    let lastError;
    for (const options of attempts) {
      try {
        return await chromium.launch({ headless: true, args: BROWSER_ARGS, ...options });
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`No browser for screenshots (tried Edge and Chrome): ${lastError?.message.split('\n')[0]}`);
  }

  // Opens the hidden page (once) and waits for the world around the bot to arrive.
  async ensurePage(width, height) {
    await this.startServer();
    const bot = this.getBot();
    if (!this.browser) this.browser = await this.launchBrowser();
    const stale = !this.page || this.page.isClosed() || !this.session || this.session.bot !== bot;
    if (stale) {
      await this.page?.close().catch(() => {});
      this.page = await this.browser.newPage({ viewport: { width, height } });
      await this.page.addInitScript(TRACK_MESHES);
      await this.page.goto(`http://127.0.0.1:${this.port}/`);
      await this.waitForChunks(FIRST_LOAD_MAX_MS, 1500);
    } else {
      await this.page.setViewportSize({ width, height });
      await this.session.worldView.updatePosition(bot.entity.position);
      await this.waitForChunks(8000, 0);
    }
  }

  // Waits until chunks stopped arriving and the page stopped adding meshes for a moment.
  async waitForChunks(maxMs, minMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(150);
      if (!this.session || Date.now() - start < minMs) continue;
      if (Date.now() - this.session.lastChunkAt < SETTLE_MS) continue;
      const { meshes, sinceMesh } = await this.page
        .evaluate(() => ({ meshes: window.__meshes || 0, sinceMesh: Date.now() - window.__lastMeshAt }))
        .catch(() => ({ meshes: 0, sinceMesh: 0 }));
      if (meshes > 0 && sinceMesh >= SETTLE_MS) return;
    }
  }

  // Moves the camera, then waits for a few real frames: in software rendering a frame can
  // take a while, and the camera only moves on the next frames.
  async shoot(yaw, pitch) {
    const bot = this.getBot();
    this.session.socket.emit('position', { pos: bot.entity.position, yaw, pitch, addMesh: false });
    await sleep(RENDER_MS);
    await this.page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const tick = () => (++frames >= 3 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }));
    const buf = await this.page.screenshot({ type: 'jpeg', quality: 70 });
    return buf.toString('base64');
  }

  scheduleClose() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.closeBrowser(), this.idleCloseMs);
  }

  async closeBrowser() {
    clearTimeout(this.idleTimer);
    this.session?.socket.disconnect();
    this.session = null;
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    await browser?.close().catch(() => {});
  }

  // Screenshots run one at a time.
  run(fn) {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => {});
    return result;
  }

  // views: [{ label, yaw, pitch }] in mineflayer angles. Returns [{ label, data }] (base64 jpeg).
  capture(views, size) {
    return this.run(async () => {
      const bot = this.getBot();
      if (!bot?.entity) throw new Error("I'm not in the world right now.");
      try {
        await this.ensurePage(size.width, size.height);
        const shots = [];
        for (const v of views) shots.push({ label: v.label, data: await this.shoot(v.yaw, v.pitch) });
        return shots;
      } finally {
        this.scheduleClose();
      }
    });
  }

  async stop() {
    await this.closeBrowser();
    this.server?.io.close();
    this.server?.http.close();
    this.server = null;
  }
}
