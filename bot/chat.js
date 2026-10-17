// Keeps every chat line with an id, so the bridge can hand Claude only what it hasn't seen.
export class ChatLog {
  constructor(limit = 300) {
    this.limit = limit;
    this.lines = [];
    this.nextId = 1;
    this.readUpTo = 0;
  }

  add(user, text, { whisper = false, system = false } = {}) {
    const line = { id: this.nextId++, time: Date.now(), user, text, whisper, system };
    this.lines.push(line);
    if (this.lines.length > this.limit) this.lines.shift();
    return line;
  }

  // Returns lines Claude hasn't seen yet and marks them as seen.
  takeUnread() {
    const unread = this.lines.filter((l) => l.id > this.readUpTo);
    if (unread.length) this.readUpTo = unread[unread.length - 1].id;
    return unread;
  }

  hasUnread() {
    return this.lines.some((l) => l.id > this.readUpTo);
  }

  // Did this player say anything since `since` (ms timestamp)?
  spokeSince(user, since) {
    return this.lines.some((l) => l.user === user && l.time >= since);
  }

  static format(lines) {
    return lines
      .map((l) => {
        if (l.system) return `[server] ${l.text}`;
        return l.whisper ? `${l.user} (whispered to you): ${l.text}` : `<${l.user}> ${l.text}`;
      })
      .join('\n');
  }
}

export function mentionsBot(text, botName) {
  return text.toLowerCase().includes(botName.toLowerCase());
}
