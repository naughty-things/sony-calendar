import { z } from 'zod';

const outputSchema = z.object({
  draft: z.string().trim().min(1).max(16000),
  warnings: z.array(z.string().trim().min(1).max(500)).max(12)
});

export function parseDraftOutput(text: string) {
  const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return outputSchema.parse(JSON.parse(json));
}

/** Historical reference URLs must never become a new post's destination. */
export function groundDraftLinks(result: { draft: string; warnings: string[] }, factualInput: string) {
  const allowed = new Set(factualInput.match(/https?:\/\/[^\s<>"）)]+/g) ?? []);
  let removed = false;
  const draft = result.draft.replace(/https?:\/\/[^\s<>"）)]+/g, url => {
    if (allowed.has(url)) return url;
    removed = true;
    return '[連結待確認]';
  });
  return { draft, warnings: [...result.warnings, ...(removed ? ['未有提供的連結已移除，請確認今次帖文的正確連結。'] : [])] };
}
