import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineUuid } from '../lib/offlineUuid.js';
import { compareVersions, buildVersionChoices } from '../lib/versions.js';

test('offline UUID matches what offline-mode servers use', () => {
  assert.equal(offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
});

test('version compare handles 1.21.x and the new 26.x scheme', () => {
  assert.ok(compareVersions('1.21.11', '1.21.4') > 0);
  assert.ok(compareVersions('26.1', '1.21.11') > 0);
  assert.equal(compareVersions('1.21', '1.21.0'), 0);
  assert.ok(compareVersions('1.20.6', '1.21') < 0);
});

test('version chooser: intersection, same selected, newer warned, older greyed', () => {
  const paper = ['1.20.6', '1.21.4', '1.21.5', '1.21.11', '26.1', '26.2', '26.1-rc-1'];
  const mineflayer = ['1.20.6', '1.21.4', '1.21.11', '26.1'];
  const choices = buildVersionChoices(paper, mineflayer, '1.21.4');
  assert.deepEqual(choices.map((c) => c.version), ['26.1', '1.21.11', '1.21.4', '1.20.6']);
  const byVersion = Object.fromEntries(choices.map((c) => [c.version, c]));
  assert.equal(byVersion['1.21.4'].selected, true);
  assert.equal(byVersion['1.21.11'].relation, 'newer');
  assert.equal(byVersion['1.21.11'].allowed, true);
  assert.equal(byVersion['1.20.6'].allowed, false);
});
