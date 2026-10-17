import { humansOnline, abortCurrentAction } from './state.js';

export const FOCUS_IDLE_MS = 3 * 60_000;
export const FOCUS_CHECK_IN_MS = 30 * 60_000;
export const FOCUS_ANSWER_MS = 60_000;
const NEAR_DISTANCE = 8;
const TICK_MS = 5000;

// Asleep (nobody online) -> Normal (event-driven) -> Focus (think after every action).
export class ModeManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.interval);
  }

  tick(now = Date.now()) {
    const { bot, state, brain, config } = this.ctx;
    if (!bot?.entity) return;
    const humans = humansOnline(bot);

    if (!humans.length) {
      if (state.mode !== 'asleep') this.goToSleep();
      return;
    }
    if (state.mode === 'asleep') {
      state.mode = 'normal';
      brain.wake(`woke up: ${humans.join(', ')} online`);
    }

    if (state.focus) this.checkFocus(humans, now);

    const idleMs = config.idleThinkMinutes * 60_000;
    if (state.mode === 'normal' && !brain.busy && now - brain.lastThought > idleMs) {
      brain.wake(`nothing happened for ${config.idleThinkMinutes} minutes`);
    }
  }

  checkFocus(humans, now) {
    const { bot, state, chat } = this.ctx;
    const focus = state.focus;

    if (!humans.includes(focus.by)) return this.endFocus(`${focus.by} left the game`);

    const someoneNear = Object.values(bot.players).some(
      (p) => p.username !== bot.username && p.entity && p.entity.position.distanceTo(bot.entity.position) <= NEAR_DISTANCE,
    );
    if (someoneNear) focus.lastActivity = now;
    if (now - focus.lastActivity > FOCUS_IDLE_MS) return this.endFocus('nobody talked to me or was near me for 3 minutes');

    if (!focus.stillGoingAskedAt && now - focus.startedAt > FOCUS_CHECK_IN_MS) {
      bot.chat(`${focus.by}, still going?`);
      focus.stillGoingAskedAt = now;
      return;
    }
    if (focus.stillGoingAskedAt) {
      if (chat.spokeSince(focus.by, focus.stillGoingAskedAt)) {
        focus.startedAt = now;
        focus.stillGoingAskedAt = null;
      } else if (now - focus.stillGoingAskedAt > FOCUS_ANSWER_MS) {
        return this.endFocus(`${focus.by} didn't answer "still going?"`);
      }
    }
  }

  // Called by events when someone talks to Claude.
  noteActivity() {
    const { state } = this.ctx;
    if (state.focus) state.focus.lastActivity = Date.now();
  }

  startFocus(by) {
    const { state } = this.ctx;
    const now = Date.now();
    state.focus = { by, startedAt: now, lastActivity: now, stillGoingAskedAt: null };
    state.mode = 'focus';
  }

  endFocus(reason, { wake = true } = {}) {
    const { state, brain } = this.ctx;
    if (!state.focus) return;
    state.focus = null;
    if (state.mode === 'focus') state.mode = 'normal';
    if (wake) brain.wake(`focus mode ended: ${reason}`);
  }

  goToSleep() {
    const { state, bot } = this.ctx;
    state.mode = 'asleep';
    state.focus = null;
    state.opMode = { enabled: false, by: null };
    abortCurrentAction(state, 'everyone left');
    bot.pathfinder?.setGoal(null);
  }
}
