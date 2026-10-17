import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOpCommand, createOpLimiter } from '../bot/actions/op.js';

const ok = (cmd) => assert.equal(checkOpCommand(cmd, createOpLimiter()), null, cmd);
const refused = (cmd) => assert.notEqual(checkOpCommand(cmd, createOpLimiter()), null, cmd);

test('normal op-mode commands pass', () => {
  ok('fill 0 60 0 20 64 20 stone');
  ok('/tp Claude 100 70 100');
  ok('weather clear');
  ok('time set day');
  ok('give Edo diamond 5');
  ok('summon cow ~ ~ ~');
  ok('gamerule randomTickSpeed 3');
});

test('commands outside the list are refused', () => {
  refused('op Steve');
  refused('kill @e');
  refused('execute run fill 0 0 0 1 1 1 air');
  refused('stop');
});

test('crash and lag ingredients are refused', () => {
  refused('give Edo written_book[written_book_content={pages:["a"]}]');
  refused('give Edo command_block');
  refused('summon zombie ~ ~ ~ {Passengers:[{id:zombie}]}');
  refused('gamerule randomTickSpeed 5000');
  refused(`setblock 0 0 0 oak_sign{${'x'.repeat(300)}}`);
  refused(`say ${'a'.repeat(300)}`);
});

test('summons are rate limited', () => {
  const limiter = createOpLimiter();
  for (let i = 0; i < 10; i++) assert.equal(checkOpCommand('summon pig', limiter, 1000 + i), null);
  assert.notEqual(checkOpCommand('summon pig', limiter, 2000), null);
  assert.equal(checkOpCommand('summon pig', limiter, 70_000), null);
});
