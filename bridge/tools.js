import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isOp } from '../lib/config.js';
import { ChatLog } from '../bot/chat.js';
import { humansOnline, abortCurrentAction, stopBackground } from '../bot/state.js';
import * as perception from '../bot/actions/perception.js';
import * as movement from '../bot/actions/movement.js';
import * as gathering from '../bot/actions/gathering.js';
import * as building from '../bot/actions/building.js';
import * as combat from '../bot/actions/combat.js';
import * as items from '../bot/actions/items.js';
import * as controls from '../bot/actions/controls.js';
import * as interact from '../bot/actions/interact.js';
import { lookAround } from '../bot/actions/surroundings.js';
import * as vision from '../bot/vision/views.js';
import { checkOpCommand, createOpLimiter, runCommand } from '../bot/actions/op.js';
import { sleep, fmtPos, compass } from '../bot/actions/util.js';
import * as memory from './memory.js';

export const SERVER_NAME = 'minecraft';

const REQUEST_WINDOW_MS = 5 * 60_000;

// ctx: { bot, state, chat, modes, config } — `bot` changes on reconnect, so always read it at call time.
export function createGameServer(ctx) {
  const opLimiter = createOpLimiter();

  const text = (s) => ({ content: [{ type: 'text', text: s }] });

  // Every result carries chat Claude hasn't seen yet, so it reacts within one action.
  const withChat = (s) => {
    const unread = ctx.chat.takeUnread();
    return unread.length ? `${s}\n\n[New chat]\n${ChatLog.format(unread)}` : s;
  };

  const reply = (s) => text(withChat(s));

  const requireBot = () => {
    if (!ctx.bot?.entity) throw new Error("I'm not connected to the server right now.");
    return ctx.bot;
  };

  // Ops are trusted by name. They must also have actually said something recently,
  // so Claude can't be talked into "Edo told me to" by someone else.
  const checkRequester = (name, what) => {
    if (!isOp(ctx.config, name)) return `${name} is not an op, so they can't ${what}.`;
    if (!ctx.chat.spokeSince(name, Date.now() - REQUEST_WINDOW_MS)) {
      return `${name} hasn't said anything in chat recently, so this can't be their request.`;
    }
    return null;
  };

  // Wraps a long game action: one at a time, interruptible by chat. Most actions take over
  // movement, so they end a background activity like following, unless keepBackground is set.
  // Every action also takes an optional `say`, said in chat as it starts: talking and acting
  // in one call saves a whole model round-trip.
  const action = (name, fn, { keepBackground = false } = {}) => {
    const handler = async ({ say, ...args }) => {
      try {
        const bot = requireBot();
        if (ctx.state.action) {
          return reply(`Already doing "${ctx.state.action.name}". Wait for it or call stop first.`);
        }
        if (say) bot.chat(say);
        if (!keepBackground) stopBackground(ctx.state);
        const controller = new AbortController();
        ctx.state.action = { name, controller };
        try {
          return reply(await fn(bot, args, controller.signal));
        } catch (err) {
          if (controller.signal.aborted) return reply(`Interrupted: ${controller.signal.reason?.message ?? 'stopped'}.`);
          return reply(`Failed: ${err.message}`);
        } finally {
          ctx.state.action = null;
        }
      } catch (err) {
        return reply(`Failed: ${err.message}`);
      }
    };
    handler.isAction = true;
    return handler;
  };

  // Wraps a quick tool that doesn't need the action slot.
  const quick = (fn) => async (args) => {
    try {
      return reply(await fn(args));
    } catch (err) {
      return reply(`Failed: ${err.message}`);
    }
  };

  const coord = z.number().int();
  const requestedBy = z.string().describe('Exact username of the player who asked for this');

  const tools = [
    // ---- talking & senses ----
    tool('say', 'Say something in public chat. This is the only way players hear you.', {
      message: z.string().min(1).max(256),
    }, quick(({ message }) => {
      requireBot().chat(message);
      return 'Said it.';
    })),

    tool('whisper', 'Send a private message to one player.', {
      player: z.string(),
      message: z.string().min(1).max(200),
    }, quick(({ player, message }) => {
      requireBot().whisper(player, message);
      return `Whispered to ${player}.`;
    })),

    tool('status', 'Your position, health, food, inventory, nearby players and mobs, and current mode.', {},
      quick(() => perception.status(requireBot(), ctx.state))),

    tool('find_blocks', 'Find the nearest blocks of a type (e.g. "oak_log", "iron_ore", "log", "chest").', {
      block: z.string(),
      max_distance: z.number().int().min(1).max(128).optional(),
      count: z.number().int().min(1).max(30).optional(),
    }, quick(({ block, max_distance, count }) =>
      perception.findBlocks(requireBot(), { block, maxDistance: max_distance, count }))),

    tool('block_at', 'What block is at these coordinates.', { x: coord, y: coord, z: coord },
      quick((args) => perception.blockAt(requireBot(), args))),

    // ---- seeing ----
    tool('look_around', 'Cheap text overview of the area: biome, sky or underground, what is in each direction (terrain, trees, water, hills), notable blocks like chests/beds/portals/farms, and the text on nearby signs.', {
      range: z.number().int().min(8).max(64).optional(),
    }, quick(({ range }) => lookAround(requireBot(), { range }))),

    tool('screenshot', 'See the world: renders what you would see from your eyes and shows you the picture. Costs about 800 tokens (panorama: 4 pictures, about 1500), so use it when a picture is worth it, like when someone shows you a build. Takes a few seconds. Blocks newer than 1.21.4 look like a stand-in block, mobs/players are simple shapes.', {
      panorama: z.boolean().optional().describe('North, east, south and west in one go'),
      player: z.string().optional().describe('Look toward this player'),
      yaw: z.number().optional().describe('F3 degrees: 0 south, 90 west, 180 north, 270 east. Default: where you face'),
      pitch: z.number().min(-90).max(90).optional().describe('F3 degrees, 90 = straight down'),
    }, async ({ panorama, player, yaw, pitch }) => {
      try {
        const bot = requireBot();
        if (!ctx.vision) return reply('Screenshots are turned off.');
        const views = vision.screenshotViews(bot, { panorama, player, yaw, pitch });
        const size = panorama ? { width: 640, height: 360 } : { width: 960, height: 540 };
        const shots = await ctx.vision.capture(views, size);
        const where = `from ${fmtPos(bot.entity.position)}`;
        return {
          content: [
            { type: 'text', text: withChat(`Screenshot${shots.length > 1 ? 's' : ''} ${where}: ${shots.map((s) => s.label).join(', ')}.`) },
            ...shots.flatMap((s) => [
              { type: 'text', text: s.label },
              { type: 'image', data: s.data, mimeType: 'image/jpeg' },
            ]),
          ],
        };
      } catch (err) {
        return reply(`Couldn't take a screenshot: ${err.message}`);
      }
    }),

    tool('wait', 'Wait and watch for a few seconds. Ends early if someone talks to you.', {
      seconds: z.number().min(1).max(30),
    }, action('wait', async (_bot, { seconds }, signal) => {
      await sleep(seconds * 1000, signal);
      return `Waited ${seconds}s.`;
    }, { keepBackground: true })),

    // ---- moving ----
    tool('go_to', 'Walk to coordinates.', { x: coord, y: coord, z: coord, range: z.number().int().min(0).max(10).optional() },
      action('go_to', (bot, a, s) => movement.goTo(bot, a, s))),

    tool('go_to_player', 'Walk up to a player.', { player: z.string(), distance: z.number().int().min(1).max(10).optional() },
      action('go_to_player', (bot, a, s) => movement.goToPlayer(bot, a, s))),

    tool('follow', 'Start following a player. It keeps going in the background while you chat and think, until you call stop, start another movement action, or it ends by itself (they leave, you get stuck); then you get told why.', {
      player: z.string(),
      distance: z.number().int().min(1).max(10).optional(),
    }, quick(({ player, distance }) => {
      const bot = requireBot();
      stopBackground(ctx.state);
      const follow = movement.startFollow(bot, { player, distance }, (reason) => {
        if (ctx.state.background === follow) ctx.state.background = null;
        ctx.brain?.wake(`you stopped following: ${reason}`);
      });
      if (follow.error) return follow.error;
      ctx.state.background = follow;
      return `Now ${follow.name}. You can keep chatting; it continues until you stop it.`;
    })),

    tool('stop', 'Stop moving/fighting/digging/flying right now.', {}, quick(() => {
      const bot = requireBot();
      abortCurrentAction(ctx.state, 'stop was called');
      stopBackground(ctx.state);
      bot.pathfinder.setGoal(null);
      bot.pvp.stop();
      bot.stopDigging();
      bot.clearControlStates();
      return 'Stopped.';
    })),

    // ---- raw controls (anything a player can do with keys and mouse) ----
    tool('control', 'Hold movement keys like a player, e.g. ["forward","jump"] for 600ms to hop up a block, or ["sneak"] to crouch. Optional yaw (F3 degrees: 0 south, 90 west, 180 north, 270 east) to face first.', {
      keys: z.array(z.enum(controls.CONTROL_KEYS)).min(1),
      ms: z.number().int().min(50).max(10_000).optional(),
      yaw: z.number().optional(),
    }, action('control', (bot, a, s) => controls.control(bot, a, s))),

    tool('look', 'Turn your head: at a player, at a block (x y z), or to yaw/pitch in F3 degrees (pitch 90 = down). Tells you what block you are looking at.', {
      player: z.string().optional(),
      x: coord.optional(), y: coord.optional(), z: coord.optional(),
      yaw: z.number().optional(), pitch: z.number().min(-90).max(90).optional(),
    }, quick((a) => controls.look(requireBot(), a))),

    tool('hit', 'Left click once: hit an entity (player name or mob type) within reach, or just swing if no target.', {
      target: z.string().optional(),
    }, quick((a) => controls.hit(requireBot(), a))),

    // ---- right click ----
    tool('use_item', 'Right click with the held item: eat, drink, throw pearls/snowballs, use buckets, shield... hold_ms keeps it pressed (about 1000 to fully draw a bow).', {
      offhand: z.boolean().optional(),
      hold_ms: z.number().int().min(0).max(5000).optional(),
    }, action('use_item', (bot, { offhand, hold_ms }, s) => interact.useItem(bot, { offhand, holdMs: hold_ms }, s),
      { keepBackground: true })),

    tool('use_block', 'Walk up to a block and right click it: doors, trapdoors, gates, levers, buttons, note blocks, beds, bells...', {
      x: coord, y: coord, z: coord,
    }, action('use_block', (bot, a, s) => interact.useBlock(bot, a, s))),

    tool('use_entity', 'Walk up to an entity and right click it with the held item: breed, feed, shear, name tag, leash, milk...', {
      target: z.string().describe('Player name or mob type like "cow"'),
    }, action('use_entity', (bot, a, s) => interact.useEntity(bot, a, s))),

    tool('mount', 'Get on a boat, minecart, horse, pig, strider...', { target: z.string() },
      action('mount', (bot, a, s) => interact.mount(bot, a, s))),

    tool('dismount', 'Get off whatever you are riding.', {}, quick(() => interact.dismount(requireBot()))),

    // ---- flying ----
    tool('elytra_fly', 'Fly with an elytra toward coordinates (uses firework rockets if you have them). Start from somewhere high.', {
      x: coord, y: coord, z: coord,
    }, action('elytra_fly', (bot, a, s) => controls.elytraFly(bot, a, s))),

    tool('fly_to', 'Creative/spectator only: fly straight to coordinates.', { x: coord, y: coord, z: coord },
      action('fly_to', (bot, a, s) => controls.flyTo(bot, a, s))),

    tool('stop_flying', 'Creative only: stop flying and drop down.', {}, quick(() => controls.stopFlying(requireBot()))),

    // ---- world ----
    tool('mine', 'Find, mine and pick up blocks of a type, e.g. 10 "oak_log" (or just "log" for any).', {
      block: z.string(),
      count: z.number().int().min(1).max(64).optional(),
      max_distance: z.number().int().min(4).max(96).optional(),
    }, action('mine', (bot, { block, count, max_distance }, s) =>
      gathering.mine(bot, { block, count, maxDistance: max_distance }, s))),

    tool('dig', 'Break the block at these coordinates.', { x: coord, y: coord, z: coord },
      action('dig', (bot, a, s) => building.dig(bot, a, s))),

    tool('place_blocks', 'Place blocks from your inventory, in order (max 64 per call). Each needs a solid neighbour.', {
      blocks: z.array(z.object({ item: z.string(), x: coord, y: coord, z: coord })).min(1).max(64),
    }, action('place_blocks', (bot, a, s) => building.placeBlocks(bot, a, s))),

    tool('attack', 'Fight a mob type (e.g. "zombie") or a player by name until it dies, or 60s pass.', {
      target: z.string(),
    }, action('attack', (bot, a, s) => combat.attack(bot, a, s))),

    // ---- items ----
    tool('equip', 'Hold or wear an item.', {
      item: z.string(),
      slot: z.enum(['hand', 'off-hand', 'head', 'torso', 'legs', 'feet']).optional(),
    }, quick((a) => items.equip(requireBot(), a))),

    tool('craft', 'Craft an item (walks to a nearby crafting table if needed).', {
      item: z.string(),
      count: z.number().int().min(1).max(64).optional(),
    }, action('craft', (bot, a, s) => items.craft(bot, a, s))),

    tool('give', 'Walk to a player and throw them items.', {
      player: z.string(), item: z.string(), count: z.number().int().min(1).max(2304).optional(),
    }, action('give', (bot, a, s) => items.give(bot, a, s))),

    tool('drop', 'Drop items on the ground.', { item: z.string(), count: z.number().int().min(1).optional() },
      quick((a) => items.drop(requireBot(), a))),

    tool('eat', 'Eat some food now.', {}, quick(() => items.eat(requireBot()))),

    tool('sleep_in_bed', 'Go to the nearest bed and sleep.', {},
      action('sleep_in_bed', (bot, a, s) => items.sleepInBed(bot, a, s))),

    // ---- storage, stations, villagers ----
    tool('container', 'Chests, barrels, shulker boxes, ender chests, hoppers, dispensers. action "look" lists what is inside; "take"/"put" move items (all of that item if no count).', {
      x: coord, y: coord, z: coord,
      action: z.enum(['look', 'take', 'put']),
      item: z.string().optional(),
      count: z.number().int().min(1).optional(),
    }, action('container', (bot, a, s) => interact.container(bot, a, s))),

    tool('furnace', 'Furnace, smoker or blast furnace. "load" puts input and/or fuel in, "collect" takes the result, "check" shows what is inside.', {
      x: coord, y: coord, z: coord,
      action: z.enum(['load', 'collect', 'check']),
      input: z.string().optional(),
      fuel: z.string().optional(),
      count: z.number().int().min(1).max(64).optional(),
    }, action('furnace', (bot, a, s) => interact.furnace(bot, a, s))),

    tool('trade', 'Villager trading. Without trade_index it lists the nearest villager\'s trades; with it, trades that many times.', {
      target: z.string().optional().describe('"villager" (default) or "wandering_trader"'),
      trade_index: z.number().int().min(0).optional(),
      times: z.number().int().min(1).max(64).optional(),
    }, action('trade', (bot, { target, trade_index, times }, s) =>
      interact.trade(bot, { target, tradeIndex: trade_index, times }, s))),

    tool('fish', 'Fish with a fishing rod until something bites (or max_seconds).', {
      max_seconds: z.number().int().min(5).max(120).optional(),
    }, action('fish', (bot, { max_seconds }, s) => interact.fish(bot, { maxSeconds: max_seconds }, s))),

    // ---- modes ----
    tool('start_focus', 'Start focus mode: you keep thinking after every action instead of waiting for events. Only an op can ask for it; you can say no.', {
      requested_by: requestedBy,
    }, quick(({ requested_by }) => {
      const problem = checkRequester(requested_by, 'start focus mode');
      if (problem) return problem;
      if (!humansOnline(requireBot()).includes(requested_by)) return `${requested_by} isn't online.`;
      ctx.modes.startFocus(requested_by);
      return `Focus mode on for ${requested_by}. It ends when they say they're done, they leave, or 3 minutes pass with nobody around.`;
    })),

    tool('end_focus', 'End focus mode (when they say "that\'s all", or you decide it\'s over).', {
      reason: z.string(),
    }, quick(({ reason }) => {
      if (!ctx.state.focus) return 'Focus mode is not on.';
      ctx.modes.endFocus(reason, { wake: false });
      return 'Focus mode off.';
    })),

    tool('set_op_mode', 'Turn op mode on or off. Only an op can unlock it; anyone can ask you to turn it off.', {
      enabled: z.boolean(),
      requested_by: requestedBy,
    }, quick(({ enabled, requested_by }) => {
      if (!enabled) {
        ctx.state.opMode = { enabled: false, by: null };
        return 'Op mode off.';
      }
      const problem = checkRequester(requested_by, 'unlock op mode');
      if (problem) return problem;
      ctx.state.opMode = { enabled: true, by: requested_by };
      return `Op mode on (unlocked by ${requested_by}). Announce every op action.`;
    })),

    tool('where_is', 'Op mode only: find any online player anywhere, even far out of sight (asks the server).', {
      player: z.string(),
    }, quick(async ({ player }) => {
      const bot = requireBot();
      if (!ctx.state.opMode.enabled) return 'Finding players out of sight needs op mode.';
      const name = Object.keys(bot.players).find((p) => p.toLowerCase() === player.toLowerCase());
      if (!name) return `${player} isn't online.`;
      const pos = await runCommand(bot, `data get entity ${name} Pos`);
      const dim = await runCommand(bot, `data get entity ${name} Dimension`);
      const nums = pos.match(/-?\d+(\.\d+)?(?=d)/g);
      const dimension = dim.match(/"?minecraft:([a-z_]+)"?/)?.[1];
      if (!nums || nums.length < 3) return `The server said: ${pos}`;
      const [x, y, z] = nums.map((n) => Math.floor(Number(n)));
      const here = bot.entity.position;
      const dist = Math.hypot(x - here.x, z - here.z).toFixed(0);
      return `${name} is at ${x} ${y} ${z}${dimension ? ` in ${dimension}` : ''}, ${dist} blocks ${compass(here, { x, z })} of you.`;
    })),

    tool('op_command', `Run any server command (op mode only), e.g. /fill /setblock /clone /tp /summon /give /effect /enchant /time /weather /gamerule, /gamemode for yourself. Commands that take over the server (op, ban, kick, stop, whitelist, reload...) are off-limits. The announcement is posted in chat first as "using op powers: <announcement>".`, {
      command: z.string().describe('Without the leading slash, e.g. "fill 10 64 10 20 64 20 stone"'),
      announcement: z.string().min(3).max(120).describe('Short plain description, e.g. "filling the lake"'),
    }, quick(async ({ command, announcement }) => {
      const bot = requireBot();
      if (!ctx.state.opMode.enabled) return 'Op mode is off. An op has to unlock it first.';
      const problem = checkOpCommand(command, opLimiter, Date.now(), bot.username);
      if (problem) return `Refused: ${problem}`;
      bot.chat(`using op powers: ${announcement}`);
      return `Server said: ${await runCommand(bot, command)}`;
    })),

    // ---- memory ----
    tool('memory_read', 'Read your private long-term memory file.', {}, quick(() => memory.readMemory() || '(empty)')),

    tool('memory_remember', 'Add a note to your private memory (players, builds, places, promises, opinions).', {
      note: z.string().min(3).max(500),
    }, quick(({ note }) => {
      memory.remember(note);
      return 'Remembered.';
    })),

    tool('memory_update', 'Change one exact piece of text in your memory, e.g. to correct or update a note.', {
      old_text: z.string().min(1),
      new_text: z.string().min(1),
    }, quick(({ old_text, new_text }) => {
      memory.update(old_text, new_text);
      return 'Updated.';
    })),

    tool('memory_forget', 'Remove every memory line containing some text. Only when an op asks.', {
      text: z.string().min(3),
      requested_by: requestedBy,
    }, quick(({ text: t, requested_by }) => {
      const problem = checkRequester(requested_by, 'make you forget things');
      if (problem) return problem;
      return `Forgot ${memory.forget(t)} line(s).`;
    })),
  ];

  for (const t of tools) {
    if (t.handler.isAction) {
      t.inputSchema = { ...t.inputSchema, say: z.string().min(1).max(256).optional().describe('Say this in chat as you start') };
    }
  }

  const server = createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools, alwaysLoad: true });
  const toolNames = tools.map((t) => `mcp__${SERVER_NAME}__${t.name}`);
  return { server, toolNames };
}
