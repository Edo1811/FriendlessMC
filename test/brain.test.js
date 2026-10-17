import { test } from 'node:test';
import assert from 'node:assert/strict';
import vec3 from 'vec3';
import { Brain } from '../bridge/brain.js';
import { AsyncQueue } from '../bridge/asyncQueue.js';
import { ChatLog } from '../bot/chat.js';
import { createState } from '../bot/state.js';

function fakeBot() {
  const entity = { position: vec3(0, 64, 0) };
  return {
    username: 'Claude',
    entity,
    health: 20,
    food: 20,
    time: { timeOfDay: 3000 },
    isRaining: false,
    heldItem: null,
    game: { dimension: 'overworld' },
    inventory: { items: () => [] },
    players: { Claude: { username: 'Claude', entity }, Edo: { username: 'Edo' } },
    entities: {},
    blockAt: () => ({ name: 'grass_block' }),
  };
}

function setup() {
  const config = { ops: ['Edo'] };
  const ctx = { config, bot: fakeBot(), state: createState(config), chat: new ChatLog() };
  ctx.state.mode = 'normal';
  const brain = new Brain(ctx, () => {});
  brain.queue = new AsyncQueue();
  const pushed = () => brain.queue.items.map((m) => m.message.content);
  return { ctx, brain, pushed };
}

test('a wake becomes one turn with event, chat and status', () => {
  const { ctx, brain, pushed } = setup();
  ctx.chat.add('Edo', 'hi claude');
  brain.wake('Edo chatted', 'chat');
  brain.wake('a zombie is close (4m)');
  brain.think();
  assert.equal(pushed().length, 1);
  assert.match(pushed()[0], /\[What happened\] Edo chatted; a zombie is close/);
  assert.match(pushed()[0], /<Edo> hi claude/);
  assert.match(pushed()[0], /\[Status\]\nPosition: 0 64 0/);
  assert.equal(brain.busy, true);
});

test('no new turn while busy, and chat already seen does not wake again', () => {
  const { ctx, brain, pushed } = setup();
  brain.wake('Edo joined');
  brain.think();
  ctx.chat.add('Edo', 'build a house');
  brain.wake('Edo chatted', 'chat');
  brain.think();
  assert.equal(pushed().length, 1, 'busy: nothing pushed');

  // the chat reached Claude through a tool result during the turn
  ctx.chat.takeUnread();
  brain.busy = false;
  brain.think();
  assert.equal(pushed().length, 1, 'chat-only wake with nothing unread is skipped');
});

test('asleep: wakes are dropped', () => {
  const { ctx, brain, pushed } = setup();
  ctx.state.mode = 'asleep';
  brain.wake('something');
  brain.think();
  assert.equal(pushed().length, 0);
});

test('focus mode gets a turn even without an event', () => {
  const { ctx, brain, pushed } = setup();
  ctx.state.mode = 'focus';
  ctx.state.focus = { by: 'Edo' };
  brain.think();
  assert.match(pushed()[0], /focus mode: your move/);
});
