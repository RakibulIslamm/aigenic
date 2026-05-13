/**
 * Per-host minimum-spacing limiter. Ensures successive `wait()` calls are
 * separated by at least `minDelayMs` (with a small random jitter), regardless
 * of how many concurrent workers are calling it. Used to honor robots.txt
 * `Crawl-delay` and to look less robotic to bot-mitigation edges.
 */
export class RateLimiter {
  private nextSlotMs = 0;
  private readonly jitterMs: number;

  constructor(private readonly minDelayMs: number) {
    // Up to ±33% jitter, capped at 100ms either way.
    this.jitterMs = Math.min(100, Math.round(minDelayMs / 3));
  }

  async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    if (this.minDelayMs <= 0) return;
    const now = Date.now();
    const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0;
    const slot = Math.max(now, this.nextSlotMs);
    this.nextSlotMs = slot + this.minDelayMs + jitter;
    const sleep = slot - now;
    if (sleep <= 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, sleep);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
