/**
 * One error type for every provider, so the server actions can turn a failure
 * into a sentence without knowing which of five APIs produced it.
 *
 * The `message` on this error is written for the site owner and is safe to
 * render: adapters are responsible for not folding a raw provider body into it
 * (those can echo the token back, and Namecheap's in particular includes the
 * API key in some error text).
 */

export type DnsErrorCode =
  /** The form values don't fit this provider's credential shape. */
  | 'invalid_credentials'
  /** The provider rejected the credentials. */
  | 'unauthorized'
  /** Authenticated, but the token lacks the permission for this call. */
  | 'forbidden'
  /** Zone or record isn't there. */
  | 'not_found'
  /** A record we can't safely replace already occupies the name. */
  | 'conflict'
  /** Provider rate limit. */
  | 'rate_limited'
  /** Network failure, timeout, or an unparseable response. */
  | 'unavailable'
  /** The provider can't do what we need (e.g. DNS isn't hosted there). */
  | 'unsupported';

export class DnsProviderError extends Error {
  constructor(
    readonly code: DnsErrorCode,
    message: string,
    /** Form field this belongs to, when the cause is one bad input. */
    readonly field?: string,
  ) {
    super(message);
    this.name = 'DnsProviderError';
  }
}

/**
 * Maps an HTTP status onto the closest error code. Adapters override it when
 * the provider says something more specific — several return 200 with an error
 * body, which is exactly why this is a helper and not a rule.
 */
export function codeForStatus(status: number): DnsErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

/** Turns any thrown value into a user-facing message. */
export function describeDnsError(err: unknown): string {
  if (err instanceof DnsProviderError) return err.message;
  if (err instanceof Error && err.name === 'TimeoutError') {
    return 'Your DNS provider took too long to respond. Try again in a moment.';
  }
  return 'Could not reach your DNS provider. Try again in a moment.';
}
