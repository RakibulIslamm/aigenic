import { describe, expect, it } from 'vitest';
import { signAwsRequest } from '@/lib/dns/sigv4';

/**
 * AWS Signature V4, as Route 53 needs it.
 *
 * Hand-rolled signing fails in ways that all look the same from the outside —
 * every mistake surfaces as `SignatureDoesNotMatch`, with no hint which of the
 * six canonical-request lines was wrong. These tests pin the parts that are
 * easy to get subtly wrong and impossible to debug from the error.
 */

const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const now = new Date('2026-07-27T12:00:00.000Z');

function sign(request: Parameters<typeof signAwsRequest>[0]['request']) {
  return signAwsRequest({
    request,
    credentials,
    region: 'us-east-1',
    service: 'route53',
    now,
  });
}

describe('signAwsRequest', () => {
  it('builds the documented Authorization header shape', () => {
    const signed = sign({
      method: 'GET',
      host: 'route53.amazonaws.com',
      path: '/2013-04-01/hostedzone',
      query: { maxitems: '1' },
    });

    expect(signed.headers['x-amz-date']).toBe('20260727T120000Z');
    expect(signed.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260727\/us-east-1\/route53\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('signs content-type only when there is a body to send', () => {
    const get = sign({
      method: 'GET',
      host: 'route53.amazonaws.com',
      path: '/2013-04-01/hostedzone',
    });
    const post = sign({
      method: 'POST',
      host: 'route53.amazonaws.com',
      path: '/2013-04-01/hostedzone/Z1/rrset/',
      body: '<x/>',
      contentType: 'application/xml',
    });

    expect(get.headers.Authorization).toContain('SignedHeaders=host;x-amz-date,');
    expect(post.headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-date,',
    );
    expect(post.headers['content-type']).toBe('application/xml');
  });

  it('signs the security token when temporary credentials are used', () => {
    const signed = signAwsRequest({
      request: {
        method: 'GET',
        host: 'route53.amazonaws.com',
        path: '/2013-04-01/hostedzone',
      },
      credentials: { ...credentials, sessionToken: 'session-token' },
      region: 'us-east-1',
      service: 'route53',
      now,
    });
    // Omitting it from SignedHeaders while sending it is a guaranteed 403.
    expect(signed.headers.Authorization).toContain(
      'SignedHeaders=host;x-amz-date;x-amz-security-token,',
    );
    expect(signed.headers['x-amz-security-token']).toBe('session-token');
  });

  it('keeps the trailing slash Route 53 requires on the rrset path', () => {
    // The canonical URI must match the requested path byte for byte.
    const signed = sign({
      method: 'POST',
      host: 'route53.amazonaws.com',
      path: '/2013-04-01/hostedzone/Z1/rrset/',
      body: '<x/>',
      contentType: 'application/xml',
    });
    expect(signed.url).toBe(
      'https://route53.amazonaws.com/2013-04-01/hostedzone/Z1/rrset/',
    );
  });

  it('sorts and encodes the query string', () => {
    const signed = sign({
      method: 'GET',
      host: 'route53.amazonaws.com',
      path: '/2013-04-01/hostedzone/Z1/rrset',
      query: { type: 'A', name: 'crawl.example.com.', maxitems: '1' },
    });
    expect(signed.url).toBe(
      'https://route53.amazonaws.com/2013-04-01/hostedzone/Z1/rrset' +
        '?maxitems=1&name=crawl.example.com.&type=A',
    );
  });

  it('is deterministic for the same request and changes with the payload', () => {
    const base = {
      method: 'POST' as const,
      host: 'route53.amazonaws.com',
      path: '/2013-04-01/hostedzone/Z1/rrset/',
      contentType: 'application/xml',
    };
    const a = sign({ ...base, body: '<a/>' });
    const b = sign({ ...base, body: '<a/>' });
    const c = sign({ ...base, body: '<b/>' });

    expect(a.headers.Authorization).toBe(b.headers.Authorization);
    // The payload hash is part of the canonical request — if it weren't,
    // a signed request body could be swapped in flight.
    expect(a.headers.Authorization).not.toBe(c.headers.Authorization);
  });
});
