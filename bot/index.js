import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import collectBlockPkg from 'mineflayer-collectblock';
import pvpPkg from 'mineflayer-pvp';
import { loader as autoEat } from 'mineflayer-auto-eat';
import { loadConfig } from '../lib/config.js';
import { createState, stopBackground } from './state.js';
import { ChatLog } from './chat.js';
import { ModeManager } from './modes.js';
import { attachEvents } from './events.js';
import { attachReflexes } from './reflexes.js';
import { applyCompatPatches } from './compat.js';
import { Brain } from '../bridge/brain.js';
import { Vision } from './vision/index.js';

const { pathfinder, Movements } = pathfinderPkg;
const RECONNECT_MS = 10_000;

const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args);

const config = loadConfig();

// ctx outlives a single connection: the brain, memory of chat and modes survive reconnects.
const ctx = {
  config,
  bot: null,
  state: createState(config),
  chat: new ChatLog(),
};
ctx.brain = new Brain(ctx, log);
ctx.vision = config.screenshots
  ? new Vision(() => ctx.bot, {
    port: config.screenshotPort,
    viewDistance: config.screenshotViewDistance,
    browserPath: config.browserPath,
    log,
  })
  : null;
ctx.modes = new ModeManager(ctx);

function connect() {
  log(`[bot] Connecting to ${config.host}:${config.port} as ${config.botName}...`);
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.botName,
    auth: 'offline',
    version: config.mcVersion ?? undefined,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlockPkg.plugin);
  bot.loadPlugin(pvpPkg.plugin);
  bot.loadPlugin(autoEat);

  let detachEvents = null;

  bot.once('spawn', () => {
    log('[bot] Spawned in the world.');
    applyCompatPatches(bot);
    const movements = new Movements(bot);
    movements.allow1by1towers = true;
    movements.canDig = true;
    movements.allowParkour = true;
    movements.allowSprinting = true;
    movements.canOpenDoors = true;
    bot.pathfinder.setMovements(movements);

    ctx.bot = bot;
    attachReflexes(ctx);
    detachEvents = attachEvents(ctx);
  });

  bot.on('kicked', (reason) => log('[bot] Kicked:', typeof reason === 'string' ? reason : JSON.stringify(reason)));
  bot.on('error', (err) => log('[bot] Error:', err.message));
  bot.on('end', (reason) => {
    log(`[bot] Disconnected (${reason}). Reconnecting in ${RECONNECT_MS / 1000}s...`);
    detachEvents?.();
    if (ctx.bot === bot) ctx.bot = null;
    ctx.state.action?.controller.abort(new Error('disconnected'));
    stopBackground(ctx.state);
    ctx.state.mode = 'asleep';
    setTimeout(connect, RECONNECT_MS);
  });
}

ctx.brain.start();
ctx.modes.start();
connect();

process.on('SIGINT', async () => {
  ctx.brain.stop();
  await ctx.vision?.stop();
  ctx.bot?.quit();
  process.exit(0);
});
