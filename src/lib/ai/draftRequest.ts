export type DraftRequest = {
  title: string;
  platform: string[] | string;
  notes?: string | null;
};

export function validateDraftRequest(value: unknown): DraftRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.title !== 'string') return null;
  const title = input.title.trim();
  if (!title || title.length > 300) return null;

  let platform: string[] | string;
  if (typeof input.platform === 'string') {
    if (input.platform.length > 100) return null;
    platform = input.platform;
  } else if (
    Array.isArray(input.platform) &&
    input.platform.length <= 10 &&
    input.platform.every(item => typeof item === 'string' && item.length <= 40)
  ) {
    platform = input.platform;
  } else {
    return null;
  }

  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 5_000)) {
    return null;
  }

  return { title, platform, notes: (input.notes as string | null | undefined) ?? null };
}
