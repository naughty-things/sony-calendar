// Copy drafter — wire scaffold ready; real template to be provided by Sam later.
// Uses MiniMax (MiniMax-M3) via the Anthropic-compatible API.
// Until the template is supplied, returns a friendly empty-state message so the
// UI can still expose the feature without lying about output.

import { getMinimax, MINIMAX_CHAT_MODEL } from './client';

export async function draftCopy(input: {
  title: string;
  platform: string[] | string;
  notes?: string | null;
  template?: string | null; // user-supplied template
}): Promise<string> {
  const platformLabel = Array.isArray(input.platform) ? input.platform.join(' + ') : input.platform;
  if (!input.template || input.template.trim().length === 0) {
    return `[Copy template not set yet]\n\nTitle: ${input.title}\nPlatform: ${platformLabel}\nNotes: ${input.notes ?? '—'}\n\nPaste your template into the AI settings to enable auto-drafting.`;
  }
  const minimax = getMinimax();
  const msg = await minimax.messages.create({
    model: MINIMAX_CHAT_MODEL,
    max_tokens: 1024,
    system: `You are a SONY social copywriter. Follow the user's template exactly.\n\nTEMPLATE:\n${input.template}`,
    messages: [
      {
        role: 'user',
        content: `Title: ${input.title}\nPlatform: ${platformLabel}\nNotes: ${input.notes ?? '—'}`
      }
    ]
  });
  return msg.content
    .map((b: any) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}
