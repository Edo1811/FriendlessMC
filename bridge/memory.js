import fs from 'node:fs';
import { MEMORY_FILE } from '../lib/config.js';

const MAX_BYTES = 64 * 1024;

export function readMemory(file = MEMORY_FILE) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function write(file, content) {
  if (Buffer.byteLength(content) > MAX_BYTES) {
    throw new Error('Memory is full (64 KB). Tidy it up with memory_update before adding more.');
  }
  fs.writeFileSync(file, content);
}

export function remember(note, file = MEMORY_FILE) {
  const date = new Date().toISOString().slice(0, 10);
  const current = readMemory(file);
  const line = `- (${date}) ${note.replace(/\s*\n\s*/g, ' ').trim()}\n`;
  write(file, current + (current && !current.endsWith('\n') ? '\n' : '') + line);
}

// Replaces one exact piece of text. Used for correcting or updating what Claude remembers.
export function update(oldText, newText, file = MEMORY_FILE) {
  const current = readMemory(file);
  const count = current.split(oldText).length - 1;
  if (count === 0) throw new Error('That text is not in memory.');
  if (count > 1) throw new Error('That text appears more than once; include more of it.');
  write(file, current.replace(oldText, newText));
}

// Removes every line containing `text`. Only ops may ask for this (checked by the caller).
export function forget(text, file = MEMORY_FILE) {
  const lines = readMemory(file).split('\n');
  const kept = lines.filter((l) => !l.toLowerCase().includes(text.toLowerCase()));
  const removed = lines.length - kept.length;
  write(file, kept.join('\n'));
  return removed;
}
