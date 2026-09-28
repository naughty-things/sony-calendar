export type DraftRequest = {
  title: string;
  platform: string[] | string;
  notes?: string | null;
  postId?: string;
  category?: string[];
  publishDate?: string | null;
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

  if (input.postId != null && (typeof input.postId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.postId))) return null;
  if (input.category != null && (!Array.isArray(input.category) || input.category.length > 10 || !input.category.every(c => typeof c === 'string' && c.length <= 40))) return null;
  if (input.publishDate != null && (typeof input.publishDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.publishDate))) return null;
  return {
    ...(input.postId ? { postId: input.postId as string } : {}),
    ...(input.category ? { category: input.category as string[] } : {}),
    ...(input.publishDate ? { publishDate: input.publishDate as string } : {}),
    title, platform, notes: (input.notes as string | null | undefined) ?? null };
}
