/**
 * Per-host minimum-spacing limiter. Ensures successive `wait()` calls are
 * separated by at least `minDelayMs`, regardless of how many concurrent
 * workers are calling it. Used to honor robots.txt `Crawl-delay` and keep
 * us polite on cheap shared hosts.
 */
export class RateLimiter {
  private nextSlotMs = 0;

  constructor(private readonly minDelayMs: number) {}

  async wait(): Promise<void> {
    if (this.minDelayMs <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotMs);
    this.nextSlotMs = slot + this.minDelayMs;
    const sleep = slot - now;
    if (sleep > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleep));
    }
  }
}
