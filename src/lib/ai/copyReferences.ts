export type CopyReference = {
  id: string;
  category: string;
  post_type: string;
  caption: string;
  products: string[];
  related_examples: string[];
  source_post_url: string | null;
  source_photo_url: string | null;
};

const categoryMap: Record<string, string> = {
  PA: 'audio', TV: 'home_cinema', MO: 'mobile', DI: 'photography',
  EC: 'retail_and_brand', INZONE: 'gaming'
};

function terms(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/α/g, 'a');
  const result = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  for (const part of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let i = 0; i < part.length - 1; i++) result.add(part.slice(i, i + 2));
  }
  return result;
}

const formats: [RegExp, string[]][] = [
  [/trade.?in|舊換新/i, ['trade_in']],
  [/workshop|課程|操作班|攝影班|工作坊/i, ['workshop']],
  [/recap|重溫|回顧|圓滿|花絮/i, ['event_recap']],
  [/pre.?order|預售|預訂/i, ['preorder']],
  [/giveaway|有獎|比賽|作品招募/i, ['competition']],
  [/offer|promotion|discount|優惠|折扣|快閃/i, ['promotion', 'member_promotion']],
  [/launch|推出|登場|發售/i, ['product_launch']],
  [/teaser|預告|敬請期待/i, ['teaser']],
  [/比較|挑選|comparison|guide/i, ['comparison_guide']],
  [/firmware|update|更新/i, ['software_update']],
  [/搬遷|休業|notice/i, ['service_notice']]
];

/** Rank the current brief, never the whole multi-post email. Avoid near-identical examples. */
export function selectCopyReferences(
  library: CopyReference[],
  input: { title: string; notes?: string | null; category?: string[] },
  limit = 3
): CopyReference[] {
  const query = `${input.title}\n${input.notes ?? ''}`;
  const queryTerms = terms(query);
  const categories = new Set((input.category ?? []).map(c => categoryMap[c]).filter(Boolean));
  if (/xperia/i.test(query)) categories.add('mobile');
  if (/bravia|家庭影院/i.test(query)) categories.add('home_cinema');
  if (/inzone|playstation|ps5/i.test(query)) categories.add('gaming');
  if (/wh-|wf-|耳機|linkbuds/i.test(query)) categories.add('audio');
  if (/相機|鏡頭|攝影|alpha|\bsel\d/i.test(query)) categories.add('photography');
  const desiredTypes = formats.find(([pattern]) => pattern.test(query))?.[1] ?? [];
  const ranked = library.map(reference => {
    const referenceTerms = terms(reference.caption);
    let score = categories.has(reference.category) ? 10 : 0;
    if (desiredTypes.includes(reference.post_type)) score += 18;
    for (const term of queryTerms) {
      if (referenceTerms.has(term)) score += /\d/.test(term) ? 3 : 1;
    }
    return { reference, score };
  }).sort((a, b) => b.score - a.score || a.reference.id.localeCompare(b.reference.id));
  const selected: CopyReference[] = [];
  for (const { reference } of ranked) {
    if (selected.some(r => r.id === reference.id || r.related_examples.includes(reference.id) || reference.related_examples.includes(r.id))) continue;
    selected.push(reference);
    if (selected.length >= limit) break;
  }
  return selected;
}
