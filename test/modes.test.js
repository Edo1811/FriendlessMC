import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vec3 from 'vec3';
import { ModeManager, FOCUS_IDLE_MS, FOCUS_CHECK_IN_MS, FOCUS_ANSWER_MS } from '../bot/modes.js';
import { createState } from '../bot/state.js';
import { ChatLog } from '../bot/chat.js';

function setup({ players = ['Edo'], near = false } = {}) {
  const bot = new EventEmitter();
  bot.username = 'Claude';
  bot.entity = { position: vec3(0, 64, 0) };
  bot.said = [];
  bot.chat = (m) => bot.said.push(m);
  bot.pathfinder = { setGoal() {} };
  bot.players = { Claude: { username: 'Claude', entity: bot.entity } };
  for (const p of players) {
    bot.players[p] = { username: p, entity: { position: vec3(near ? 2 : 50, 64, 0) } };
  }
  const config = { ops: ['Edo'], idleThinkMinutes: 5 };
  const wakes = [];
  const brain = { busy: false, lastThought: Date.now(), wake: (r) => wakes.push(r) };
  const ctx = { bot, config, state: createState(config), chat: new ChatLog(), brain };
  const modes = new ModeManager(ctx);
  ctx.modes = modes;
  return { ctx, modes, wakes, bot };
}

test('asleep with nobody online, wakes when a player is there', () => {
  const empty = setup({ players: [] });
  empty.modes.tick();
  assert.equal(empty.ctx.state.mode, 'asleep');

  const s = setup();
  s.modes.tick();
  assert.equal(s.ctx.state.mode, 'normal');
  assert.match(s.wakes[0], /Edo online/);
});

test('everyone leaving resets focus and op mode', () => {
  const { ctx, modes, bot } = setup();
  modes.tick();
  modes.startFocus('Edo');
  ctx.state.opMode = { enabled: true, by: 'Edo' };
  delete bot.players.Edo;
  modes.tick();
  assert.equal(ctx.state.mode, 'asleep');
  assert.equal(ctx.state.focus, null);
  assert.equal(ctx.state.opMode.enabled, false);
});

test('focus ends when the op leaves', () => {
  const { ctx, modes, bot, wakes } = setup({ players: ['Edo', 'Luca'] });
  modes.tick();
  modes.startFocus('Edo');
  delete bot.players.Edo;
  modes.tick();
  assert.equal(ctx.state.mode, 'normal');
  assert.match(wakes.at(-1), /Edo left/);
});

test('focus ends after 3 minutes with nobody near or talking', () => {
  const { ctx, modes } = setup();
  modes.tick();
  modes.startFocus('Edo');
  const t0 = ctx.state.focus.lastActivity;
  modes.tick(t0 + FOCUS_IDLE_MS - 1000);
  assert.equal(ctx.state.mode, 'focus');
  modes.tick(t0 + FOCUS_IDLE_MS + 1000);
  assert.equal(ctx.state.mode, 'normal');
});

test('focus asks "still going?" after 30 min and ends without an answer', () => {
  const { ctx, modes, bot } = setup({ near: true });
  modes.tick();
  modes.startFocus('Edo');
  const t0 = ctx.state.focus.startedAt;
  modes.tick(t0 + FOCUS_CHECK_IN_MS + 1);
  assert.equal(bot.said.at(-1), 'Edo, still going?');
  modes.tick(t0 + FOCUS_CHECK_IN_MS + FOCUS_ANSWER_MS + 10);
  assert.equal(ctx.state.focus, null);
});

test('answering "still going?" keeps focus', () => {
  const { ctx, modes } = setup({ near: true });
  modes.tick();
  modes.startFocus('Edo');
  const t0 = Date.now();
  modes.tick(t0 + FOCUS_CHECK_IN_MS + 1);
  ctx.chat.add('Edo', 'yeah');
  ctx.chat.lines.at(-1).time = t0 + FOCUS_CHECK_IN_MS + 5;
  modes.tick(t0 + FOCUS_CHECK_IN_MS + 10);
  assert.equal(ctx.state.mode, 'focus');
  assert.equal(ctx.state.focus.stillGoingAskedAt, null);
});
