import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItemRef } from '../dist/ops/get-item.js';

test('parseItemRef from URL detects country', () => {
  assert.deepEqual(parseItemRef({ url: 'https://www.vinted.fr/items/12345-nike-tee' }), { id: 12345, country: 'fr' });
  assert.deepEqual(parseItemRef({ url: 'https://www.vinted.co.uk/items/777-foo' }), { id: 777, country: 'uk' });
  assert.deepEqual(parseItemRef({ url: 'https://www.vinted.de/items/9-bar' }), { id: 9, country: 'de' });
});

test('parseItemRef from id uses default fr', () => {
  assert.deepEqual(parseItemRef({ itemId: 42 }), { id: 42, country: 'fr' });
  assert.deepEqual(parseItemRef({ itemId: 42, country: 'pl' }), { id: 42, country: 'pl' });
});

test('parseItemRef rejects empty input', () => {
  assert.throws(() => parseItemRef({}), /itemId or url/);
});

test('parseItemRef rejects bogus URL', () => {
  assert.throws(() => parseItemRef({ url: 'https://example.com/items/1' }), /Invalid Vinted URL/);
});

import { getItem, describeUnreadableItemPage } from '../dist/client/endpoints.js';

const htmlClient = (status, body) => ({
  async apiGet() { throw new Error('404'); },
  async fetchHtml() { return { status, body }; },
});

test('HTML fallback exposes schema.org availability', async () => {
  const ld = { '@type': 'Product', name: 'Laptop', offers: { price: 200, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } };
  const body = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const item = await getItem(htmlClient(200, body), 1, 'pt');
  assert.equal(item.availability, 'InStock');
});

test('a page without product data explains itself instead of a bare "no JSON-LD"', async () => {
  const body = '<html><head><title> Item  unavailable </title></head><body>{\\"item\\":{\\"is_closed\\":true,\\"item_closing_action\\":\\"sold\\",\\"is_reserved\\":false}}</body></html>';
  await assert.rejects(getItem(htmlClient(200, body), 2, 'pt'), (e) => {
    assert.match(e.message, /no JSON-LD on page/);
    assert.match(e.message, /HTTP 200/);
    assert.match(e.message, /title "Item unavailable"/);
    assert.match(e.message, /is_closed=true/);
    assert.match(e.message, /item_closing_action=sold/);
    assert.match(e.message, /is_reserved=false/);
    return true;
  });
});

test('describeUnreadableItemPage copes with a bare page and caps the signals it reports', () => {
  assert.equal(describeUnreadableItemPage(200, '<html></html>'), 'HTTP 200');
  const many = Array.from({ length: 20 }, (_, i) => `"sold_${i}":true`).join(',');
  assert.equal(describeUnreadableItemPage(200, many).split('sold_').length - 1, 8);
});
