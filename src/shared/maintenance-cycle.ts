import type { ConfigDocumentStore } from './config-repository';
import { BACKGROUND_REFRESH_MS } from './background-refresh';

/** Durable cadence shared by host wake-ups; a page read is never a wake-up. */
export class MaintenanceCycle {
  private flight?: Promise<number>;
  constructor(
    private readonly store: ConfigDocumentStore,
    private readonly now: () => number = Date.now
  ) {}

  runDue(action: () => Promise<unknown>, active: () => boolean = () => true): Promise<number> {
    if (this.flight) return this.flight;
    const work = (async () => {
      const content = await this.store.read('maintenance-cycle');
      let attemptedAt: number | undefined;
      if (content) {
        try {
          const saved = JSON.parse(content);
          if (
            saved.schema === 1 &&
            Number.isSafeInteger(saved.attemptedAt) &&
            saved.attemptedAt >= 0
          )
            attemptedAt = saved.attemptedAt;
        } catch {
          /* An invalid receipt cannot indefinitely suppress maintenance. */
        }
      }
      const current = this.now();
      if (!active()) return current + BACKGROUND_REFRESH_MS;
      if (
        attemptedAt !== undefined &&
        attemptedAt <= current &&
        current - attemptedAt < BACKGROUND_REFRESH_MS
      )
        return attemptedAt + BACKGROUND_REFRESH_MS;
      // Commit before network work so relaunching after failure cannot repeatedly hammer providers.
      // New configuration initialization uses its own dependency scope, never this cadence receipt.
      await this.store.write(
        'maintenance-cycle',
        JSON.stringify({ schema: 1, attemptedAt: current })
      );
      if (!active()) return current + BACKGROUND_REFRESH_MS;
      await action();
      return current + BACKGROUND_REFRESH_MS;
    })();
    const flight = work.finally(() => {
      if (this.flight === flight) this.flight = undefined;
    });
    this.flight = flight;
    return flight;
  }
}
