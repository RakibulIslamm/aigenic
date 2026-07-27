import 'server-only';
import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, just enough of it for Route 53.
 *
 * Pulling in `@aws-sdk/client-route-53` for three API calls would add a large
 * dependency tree to a Next.js server bundle for what is, in the end, a
 * documented HMAC chain. This implements the parts Route 53 actually
 * exercises and deliberately not the rest: no chunked payloads, no
 * `UNSIGNED-PAYLOAD` (an S3-only concept), no pre-signed URLs.
 *
 * Two rules cause almost every signature mismatch, so they're worth stating:
 * the canonical path must be **byte-identical to the path requested** — Route
 * 53's `…/rrset/` keeps its trailing slash — and every header named in
 * `SignedHeaders` must be sent, with values trimmed, sorted by lowercased
 * name.
 *
 * Docs: https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface SigV4Request {
  method: string;
  host: string;
  /** Absolute path, already in the form it will be requested. */
  path: string;
  /** Query parameters, unencoded. Encoding and ordering happen here. */
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

export function signAwsRequest(params: {
  request: SigV4Request;
  credentials: SigV4Credentials;
  region: string;
  service: string;
  /** Injectable so the signing math is testable without freezing the clock. */
  now?: Date;
}): SignedRequest {
  const { request, credentials, region, service } = params;
  const now = params.now ?? new Date();

  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalQuery = canonicalQueryString(request.query ?? {});
  const payload = request.body ?? '';
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host: request.host,
    'x-amz-date': amzDate,
  };
  if (request.contentType) headers['content-type'] = request.contentType;
  if (credentials.sessionToken) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${(headers[name] ?? '').trim()}\n`)
    .join('');
  const signedHeaders = sortedHeaderNames.join(';');

  const canonicalRequest = [
    request.method.toUpperCase(),
    request.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(
    credentials.secretAccessKey,
    dateStamp,
    region,
    service,
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const url = `https://${request.host}${request.path}${canonicalQuery ? `?${canonicalQuery}` : ''}`;

  return {
    url,
    headers: {
      ...headers,
      Authorization:
        `${ALGORITHM} Credential=${credentials.accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/**
 * Keys and values encoded individually, then sorted by the *encoded* key —
 * sorting before encoding gives a different order for anything above ASCII and
 * produces a signature AWS won't accept.
 */
function canonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** `encodeURIComponent` leaves `!'()*` alone; AWS expects them percent-encoded. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
