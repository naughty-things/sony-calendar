export const DESIGNERS = ['Leo', 'Jessica'] as const;
export const INTERNAL_PICS = ['Sam', 'Cheri', 'Irvin', 'Raymond'] as const;

export function normalizeAllowedName(
  value: string | null | undefined,
  allowed: readonly string[]
): string {
  if (!value?.trim()) return '';
  const tokens = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return allowed.find(name => tokens.includes(name.toLowerCase())) ?? '';
}

export function normalizeDesigner(value: string | null | undefined): string {
  return normalizeAllowedName(value, DESIGNERS);
}

export function normalizeInternalPic(value: string | null | undefined): string {
  return normalizeAllowedName(value, INTERNAL_PICS);
}

/**
 * Prefer an explicit valid assignment from the brief. When the model omits
 * it, deterministically use the internal teammate who forwarded the email.
 */
export function resolveInternalPic(
  explicitValue: string | null | undefined,
  envelopeFrom: string | null | undefined
): string | null {
  return normalizeInternalPic(explicitValue) || normalizeInternalPic(envelopeFrom) || null;
}
