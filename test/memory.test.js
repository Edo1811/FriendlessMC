import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as memory from '../bridge/memory.js';
import { ChatLog } from '../bot/chat.js';

test('memory: remember, update, forget', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'memory.md');
  fs.writeFileSync(file, '# Claude\'s memory\n');
  memory.remember('Edo built a castle at 100 70 -20', file);
  memory.remember('Promised Luca a diamond pickaxe', file);
  assert.match(memory.readMemory(file), /castle at 100 70 -20/);

  memory.update('100 70 -20', '120 70 -20', file);
  assert.match(memory.readMemory(file), /castle at 120 70 -20/);
  assert.throws(() => memory.update('not there', 'x', file));

  assert.equal(memory.forget('luca', file), 1);
  assert.doesNotMatch(memory.readMemory(file), /Luca/);
  assert.match(memory.readMemory(file), /castle/);
});

test('chat log hands out unread lines once', () => {
  const chat = new ChatLog();
  chat.add('Edo', 'hi claude');
  chat.add('Luca', 'yo', { whisper: true });
  assert.equal(chat.hasUnread(), true);
  assert.equal(ChatLog.format(chat.takeUnread()), '<Edo> hi claude\nLuca (whispered to you): yo');
  assert.equal(chat.hasUnread(), false);
  assert.equal(chat.takeUnread().length, 0);
  assert.equal(chat.spokeSince('Edo', Date.now() - 1000), true);
  assert.equal(chat.spokeSince('Nobody', 0), false);
});
