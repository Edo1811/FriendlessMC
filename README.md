# FriendlessMC

Claude joins your Minecraft world as a normal player: orange skin, walks, climbs, mines, builds, fights, right-clicks things, uses chests and furnaces, trades, fishes, flies with an elytra, takes screenshots to actually see your builds, and chats. Talk to it in game chat. It has its own opinions and can say no. Ops can unlock **op mode**, where Claude uses admin commands for big jobs.

Everything runs on one Windows PC, LAN only.

## Setup (once)

1. Install:
   - [Java 21+](https://adoptium.net) (Java 25 recommended)
   - [Node.js 20+](https://nodejs.org)
   - Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Download this repo, open a terminal in its folder and run:
   ```
   npm install
   npm run wizard
   ```
3. The wizard opens in your browser and walks you through: checking Java/Node/Claude Code → picking a world (it gets **copied**) → choosing the version → your name and the ops → accepting the Minecraft EULA → building the server → signing in to Claude → creating the **Start Claude server** desktop shortcut.

## Playing

Double-click **Start Claude server**. The server starts, then Claude joins. Open Minecraft (same version as the server), go to Multiplayer and join the PC (`localhost` on the PC itself, or its LAN IP from other computers).

Things to try:
- "claude come here", "claude can you get me 10 logs", "claude what do you think of my house"
- Ops: "claude follow me, I'll show you around" (focus mode, end it with "aight that's all")
- Ops: "claude unlock op mode" then "fill the lake with dirt", "go creative and fly over here", "turn pvp off in the server settings"

Type in the server window to use the server console (`stop` shuts everything down).

## How it uses your Claude plan

Claude only thinks when something happens: someone chats, it takes damage, a mob comes close, someone joins/leaves, or every 5 minutes when it's quiet. When nobody is online it sleeps. Focus mode thinks after every action, so it uses more. Settings live in `server/friendless.json` (`model`, `effort`, `idleThinkMinutes`, `screenshots`). For faster answers, try `"model": "claude-sonnet-5-5"`.

Screenshots are rendered in a hidden Microsoft Edge window (built into Windows), only while Claude is taking them.

## Files

- `server/` is the generated server, including `server/.claude/` with Claude's in-game rules (`CLAUDE.md`), its private memory (`memory.md`) and its permissions.
- Backups of `server/world` are up to you.

## Known risks

- Offline mode: anyone on your Wi-Fi can join using an op's name (or "Claude") and unlock op mode.
- Claude takes a few seconds per decision, so fighting and fast stuff is handled by the bot's own code.
