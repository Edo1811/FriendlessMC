import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isOp } from '../lib/config.js';
import { ChatLog } from '../bot/chat.js';
import { humansOnline, abortCurrentAction } from '../bot/state.js';
import * as perception from '../bot/actions/perception.js';
import * as movement from '../bot/actions/movement.js';
import * as gathering from '../bot/actions/gathering.js';
import * as building from '../bot/actions/building.js';
import * as combat from '../bot/actions/combat.js';
import * as items from '../bot/actions/items.js';
import { checkOpCommand, createOpLimiter, runCommand } from '../bot/actions/op.js';
import { sleep } from '../bot/actions/util.js';
import * as memory from './memory.js';
import { queueFileEdit } from './fileEdits.js';

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

  // Wraps a long game action: one at a time, interruptible by chat.
  const action = (name, fn) => async (args) => {
    try {
      const bot = requireBot();
      if (ctx.state.action) {
        return reply(`Already doing "${ctx.state.action.name}". Wait for it or call stop first.`);
      }
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

    tool('wait', 'Wait and watch for a few seconds. Ends early if someone talks to you.', {
      seconds: z.number().min(1).max(30),
    }, action('wait', async (_bot, { seconds }, signal) => {
      await sleep(seconds * 1000, signal);
      return `Waited ${seconds}s.`;
    })),

    // ---- moving ----
    tool('go_to', 'Walk to coordinates.', { x: coord, y: coord, z: coord, range: z.number().int().min(0).max(10).optional() },
      action('go_to', (bot, a, s) => movement.goTo(bot, a, s))),

    tool('go_to_player', 'Walk up to a player.', { player: z.string(), distance: z.number().int().min(1).max(10).optional() },
      action('go_to_player', (bot, a, s) => movement.goToPlayer(bot, a, s))),

    tool('follow', 'Follow a player for a while. Stops when interrupted, when they vanish, or after max_seconds.', {
      player: z.string(),
      distance: z.number().int().min(1).max(10).optional(),
      max_seconds: z.number().int().min(5).max(600).optional(),
    }, action('follow', (bot, { player, distance, max_seconds }, s) =>
      movement.follow(bot, { player, distance, maxSeconds: max_seconds }, s))),

    tool('look_at_player', 'Turn to look at a player.', { player: z.string() },
      quick((a) => movement.lookAtPlayer(requireBot(), a))),

    tool('jump', 'Jump once.', {}, action('jump', (bot, a, s) => movement.jump(bot, a, s))),

    tool('stop', 'Stop moving/fighting/digging right now.', {}, quick(() => {
      const bot = requireBot();
      abortCurrentAction(ctx.state, 'stop was called');
      bot.pathfinder.setGoal(null);
      bot.pvp.stop();
      bot.stopDigging();
      return 'Stopped.';
    })),

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

    tool('op_command', `Run an admin command (op mode only): /fill /setblock /clone /tp /summon /give /time /weather /gamerule. The announcement is posted in chat first as "using op powers: <announcement>".`, {
      command: z.string().describe('Without the leading slash, e.g. "fill 10 64 10 20 64 20 stone"'),
      announcement: z.string().min(3).max(120).describe('Short plain description, e.g. "filling the lake"'),
    }, quick(async ({ command, announcement }) => {
      const bot = requireBot();
      if (!ctx.state.opMode.enabled) return 'Op mode is off. An op has to unlock it first.';
      const problem = checkOpCommand(command, opLimiter);
      if (problem) return `Refused: ${problem}`;
      bot.chat(`using op powers: ${announcement}`);
      return `Server said: ${await runCommand(bot, command)}`;
    })),

    tool('request_file_edit', 'Op mode only, rare: queue a change to server files that commands cannot do. It is applied the next time the server restarts.', {
      description: z.string().min(10).max(1000),
      requested_by: requestedBy,
    }, quick(({ description, requested_by }) => {
      if (!ctx.state.opMode.enabled) return 'Op mode is off.';
      const problem = checkRequester(requested_by, 'request file edits');
      if (problem) return problem;
      const n = queueFileEdit(description, requested_by);
      return `Queued (${n} pending). It happens the next time the server is stopped and started again.`;
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

  const server = createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools, alwaysLoad: true });
  const toolNames = tools.map((t) => `mcp__${SERVER_NAME}__${t.name}`);
  return { server, toolNames };
}
