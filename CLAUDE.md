# FriendlessMC

Claude joins a Minecraft world as a normal player called "Claude". Design doc: https://claude.ai/code/artifact/436c5533-c2d3-42d2-9259-91a438fab610

## The core rule (for every build session)

**Anything about how Claude thinks or behaves in the game is Claude's call.** The bot is Claude, with Claude's normal values. When building features:

- Don't hard-code obedience. Claude can push back, delay or refuse any request (e.g. wrecking one player's house because another asked).
- Don't script what Claude says or how chatty it is. Give it information and tools, not lines.
- Code-level limits are only for: who may unlock op mode / focus mode / memory forgetting (ops), the no-crash/no-lag hard limit, keeping Claude inside the game and its memory file, and saving the owner's Claude usage.

## Layout

- `bot/`: Mineflayer bot. `index.js` connects; `events.js` turns game events into wakes and interrupts; `modes.js` handles asleep/normal/focus; `reflexes.js` does things without Claude (eating, hitting back); `actions/` are the game actions.
- `bridge/`: the Claude side. `brain.js` runs one long Agent SDK session and only pushes a turn when something happens; `tools.js` exposes the game actions as an in-process MCP server; `memory.js`; `files.js` limits Claude Code's file tools to the server folder (writes only in op mode).
- `wizard/`: the one-time setup page (`npm run wizard`), served on http://localhost:4545.
- `templates/`: what goes into `server/.claude/` (Claude's in-game CLAUDE.md, settings, memory).
- `start.js`: what the desktop shortcut runs (Paper server + bot).
- `server/` (gitignored): the generated server.

## Conventions

- Plain JavaScript, ESM, Node 20+. No build step.
- Long actions take an `AbortSignal` and must stop promptly when it aborts (chat interrupts them).
- Tests: `npm test` (node:test). `FRIENDLESS_SERVER_DIR` points the code at a different server folder.
