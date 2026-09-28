import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectCopyReferences } from '../src/lib/ai/copyReferences.ts';
import { parseDraftOutput, groundDraftLinks } from '../src/lib/ai/draftOutput.ts';
import { validateDraftRequest } from '../src/lib/ai/draftRequest.ts';
const library = JSON.parse(readFileSync(new URL('../data/copywriting/sony-hk-facebook-2026-09-28.json', import.meta.url), 'utf8')).posts;
test('retrieves three photography workshop references without related variants', () => {
 const refs = selectCopyReferences(library, { title: 'Alpha 攝影工作坊', category: ['DI'], notes: '介紹攝影課程及報名' });
 assert.equal(refs.length, 3);
 assert.ok(refs.every(r => r.category === 'photography' && r.post_type === 'workshop'));
 assert.ok(refs.every(r => refs.every(other => !r.related_examples.includes(other.id))));
});
test('retrieves audio references for a headphone launch', () => {
 const refs = selectCopyReferences(library, { title: 'WH 耳機新品登場', category: ['PA'] });
 assert.equal(refs[0].category, 'audio');
});
test('rejects empty or malformed generated copy and accepts structured output', () => {
 assert.throws(() => parseDraftOutput('{"draft":"", "warnings":[]}'));
 assert.throws(() => parseDraftOutput('unstructured copy'));
 assert.deepEqual(parseDraftOutput('```json\n{"draft":"草稿", "warnings":[]}\n```'), { draft: '草稿', warnings: [] });
});
test('keeps supplied URLs while replacing borrowed reference URLs', () => {
 const out = groundDraftLinks({ draft: '立即報名 https://sony.hk/current\n舊連結 https://sony.hk/expired', warnings: [] }, '報名 https://sony.hk/current\n活動資料');
 assert.ok(out.draft.includes('https://sony.hk/current'));
 assert.ok(!out.draft.includes('https://sony.hk/expired'));
 assert.equal(out.warnings.length, 1);
});
test('validates source post and category input', () => {
 assert.equal(validateDraftRequest({ title:'Test', platform:['FB'], postId:'invalid' }), null);
 const input = { title:'Test', platform:['FB'], postId:'12345678-1234-1234-1234-123456789012', category:['DI'], publishDate:'2026-09-28' };
 assert.equal(validateDraftRequest(input)?.postId, input.postId);
});
