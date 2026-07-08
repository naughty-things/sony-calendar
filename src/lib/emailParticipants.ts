type MentionedPeople = {
  mentioned_internal?: string[] | null;
  mentioned_client?: string[] | null;
};

function getEmailSide(email: string | null | undefined): 'internal' | 'client' | null {
  if (!email) return null;
  const domain = email.split('@')[1] || '';
  if (domain === 'naughtythings.com.hk' || domain.endsWith('.naughtythings.com.hk')) {
    return 'internal';
  }
  if (domain.includes('sony')) {
    return 'client';
  }
  return null;
}

function normalizeNames(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const name = value.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractForwardedFromEmails(body: string | null | undefined): string[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/).slice(0, 120);
  const out: string[] = [];
  for (const line of lines) {
    if (!/^\s*(from|寄件者)\s*[:：]/i.test(line)) continue;
    const match = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig);
    if (match) out.push(...match.map(x => x.toLowerCase()));
  }
  return normalizeNames(out);
}

export function inferEffectiveFrom(from: string | null | undefined, body?: string | null): string | null {
  const outer = extractEmailAddress(from);
  const forwarded = extractForwardedFromEmails(body);

  if (getEmailSide(outer) === 'internal') {
    const forwardedClient = forwarded.find(email => getEmailSide(email) === 'client');
    if (forwardedClient) return forwardedClient;
  }

  return outer || forwarded[0] || null;
}

export function getSenderSide(from: string | null | undefined, body?: string | null): 'internal' | 'client' | null {
  return getEmailSide(inferEffectiveFrom(from, body));
}

export function normalizeMentionedPeople(
  input: MentionedPeople,
  from: string | null | undefined,
  body?: string | null
) {
  const internal = normalizeNames(input.mentioned_internal || []);
  const client = normalizeNames(input.mentioned_client || []);
  const all = normalizeNames([...internal, ...client]);
  const senderSide = getSenderSide(from, body);

  if (senderSide === 'internal') {
    return {
      mentioned_internal: all,
      mentioned_client: []
    };
  }

  if (senderSide === 'client') {
    return {
      mentioned_internal: [],
      mentioned_client: all
    };
  }

  return {
    mentioned_internal: internal.filter(name => !client.some(c => c.toLowerCase() === name.toLowerCase())),
    mentioned_client: client
  };
}
