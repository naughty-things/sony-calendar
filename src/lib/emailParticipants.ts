type MentionedPeople = {
  mentioned_internal?: string[] | null;
  mentioned_client?: string[] | null;
};

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

export function getSenderSide(from: string | null | undefined): 'internal' | 'client' | null {
  const email = extractEmailAddress(from);
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

export function normalizeMentionedPeople(input: MentionedPeople, from: string | null | undefined) {
  const internal = normalizeNames(input.mentioned_internal || []);
  const client = normalizeNames(input.mentioned_client || []);
  const all = normalizeNames([...internal, ...client]);
  const senderSide = getSenderSide(from);

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
