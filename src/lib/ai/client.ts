// Shared MiniMax (MiniMax) client.
// We use the Anthropic SDK pointed at MiniMax's Anthropic-compatible endpoint
// (https://api.minimax.io/anthropic). The MiniMax provider config in
// /Users/naughty/.openclaw/openclaw.json is set up the same way.
//
// We tested this key against api.minimaxi.com/v1 (OpenAI-compat) — rejected.
// The Anthropic-compat endpoint at api.minimax.io/anthropic works.

import Anthropic from '@anthropic-ai/sdk';

export const MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic';
export const MINIMAX_CHAT_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M3';

let _client: Anthropic | null = null;

export function getMinimax(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not set');
  }
  _client = new Anthropic({
    apiKey,
    baseURL: MINIMAX_BASE_URL
  });
  return _client;
}
