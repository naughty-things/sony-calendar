import { timingSafeEqual } from 'node:crypto';

type PollRequest = Pick<Request, 'headers' | 'url'>;

export type PollAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; error: string };

function secretEquals(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isLoopback(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function authorizePollRequest(
  req: PollRequest,
  env: { NODE_ENV?: string; POLL_SECRET?: string } = process.env
): PollAuthorization {
  const expected = env.POLL_SECRET?.trim();
  if (!expected) {
    if (env.NODE_ENV !== 'production' && isLoopback(req.url)) return { ok: true };
    return { ok: false, status: 503, error: 'poll endpoint is not configured' };
  }

  const authorization = req.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const supplied = bearer || req.headers.get('x-poll-secret')?.trim();
  if (!supplied || !secretEquals(expected, supplied)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return { ok: true };
}
