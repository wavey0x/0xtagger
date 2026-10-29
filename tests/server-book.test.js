import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerBook } from '../extension/stores/server.js';

test('a hosted browser keeps the subpath and sends no invented bearer credential', async () => {
  const requests = [];
  let denied = false;
  const book = createServerBook({ url: 'https://electro.example/0xtagger',
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return new Response(JSON.stringify(denied ? { detail: 'Not allowed' } : { records: [] }), { status: denied ? 401 : 200 });
    },
  });
  assert.deepEqual((await book.load()).records, []);
  assert.equal(requests[0].url, 'https://electro.example/0xtagger/tags');
  assert.equal(requests[0].headers.Authorization, undefined);
  denied = true;
  await assert.rejects(book.load(), /Tailscale identity/);
});

test('server confirmations include an explicitly requested description', async () => {
  const address = '0x' + 'ab'.repeat(20);
  const draft = { address, scope: 'global', tags: ['Wallet'], version: 'before', description: 'Intended' };
  let description = 'Wrong';
  const sent = [];
  const book = createServerBook({ url: 'https://example.com', fetch: async (url, options) => {
    sent.push(JSON.parse(options.body));
    const record = { ...draft, version: 'after', description };
    return new Response(JSON.stringify(url.endsWith('/global/' + address) ? { record } : { records: [record] }));
  } });
  await assert.rejects(book.put(draft), /different record/);
  await assert.rejects(book.putMany([draft]), /different record/);
  description = 'Intended';
  assert.equal((await book.put(draft)).description, description);
  const { description: omitted, ...tagsOnly } = draft;
  await book.put(tagsOnly);
  assert.equal('description' in sent.at(-1), false);
  await book.put({ ...draft, description: '' }).then(() => assert.fail('clearing must be confirmed'), error => assert.match(error.message, /different record/));
});
