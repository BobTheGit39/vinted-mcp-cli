import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCategories, resolveCategoryId, opCategories } from '../dist/ops/categories.js';
import { callTool } from '../dist/dispatch.js';
import { catalogEntry, catalogHtml } from './helpers/catalog-html.mjs';

// IDs are made up; only the tree shape matters.
const TREE = [
  {
    id: 10, title: 'Electronics', catalogs: [
      { id: 11, title: 'Computers', catalogs: [
        { id: 12, title: 'Laptops' },
        { id: 13, title: 'Accessories' },
      ] },
      { id: 14, title: 'Phones', catalogs: [{ id: 15, title: 'Accessories' }] },
    ],
  },
  {
    id: 20, title: 'Women', catalogs: [
      { id: 21, title: 'Bags', catalogs: [{ id: 22, title: 'Laptop bags' }] },
    ],
  },
];

function makeClient() {
  const calls = [];
  return {
    calls,
    async apiGet(country, path) {
      calls.push({ kind: 'api', country, path });
      if (path.startsWith('/api/v2/catalog/initializers')) return { dtos: { catalogs: TREE } };
      throw new Error(`unmocked: ${path}`);
    },
    async pageGet(country, path, parse) {
      calls.push({ kind: 'page', country, path });
      return parse(catalogHtml([catalogEntry({ id: 1 })]));
    },
  };
}

test('opCategories adds a breadcrumb path to every category', async () => {
  const all = await opCategories(makeClient(), {});
  assert.equal(all.find((c) => c.id === 12).path, 'Electronics > Computers > Laptops');
  assert.equal(all.find((c) => c.id === 10).path, 'Electronics');
});

test('resolveCategoryId finds laptops by plain name (case-insensitive)', async () => {
  const m = await resolveCategoryId(makeClient(), 'laptops');
  assert.equal(m.id, 12);
  assert.equal(m.path, 'Electronics > Computers > Laptops');
});

test('exact title beats a partial match ("Laptops" is not "Laptop bags")', async () => {
  const hits = findCategories(
    [{ id: 12, title: 'Laptops' }, { id: 22, title: 'Laptop bags' }], 'laptop');
  assert.deepEqual(hits.map((h) => h.id), [12, 22]); // no exact title -> partial fallback finds both
  const exact = findCategories(
    [{ id: 12, title: 'Laptops' }, { id: 22, title: 'Laptops bags' }], 'Laptops');
  assert.deepEqual(exact.map((h) => h.id), [12]);
});

test('breadcrumbs disambiguate repeated titles, with ">" or "/"', async () => {
  const c = makeClient();
  assert.equal((await resolveCategoryId(c, 'Electronics > Computers > Accessories')).id, 13);
  assert.equal((await resolveCategoryId(c, 'phones/accessories')).id, 15);
  assert.equal((await resolveCategoryId(c, 'Electronics > Laptops')).id, 12); // intermediate level may be skipped
});

test('ambiguous name throws and lists the candidates instead of guessing', async () => {
  await assert.rejects(
    resolveCategoryId(makeClient(), 'Accessories'),
    (e) => /ambiguous/.test(e.message) && /id 13/.test(e.message) && /id 15/.test(e.message),
  );
});

test('unknown category throws', async () => {
  await assert.rejects(resolveCategoryId(makeClient(), 'Submarines'), /Could not find category "Submarines"/);
  await assert.rejects(resolveCategoryId(makeClient(), 'Clothing > Laptops'), /Could not find category/);
});

test('search_items resolves `category` to catalog[] and never sends the name', async () => {
  const c = makeClient();
  await callTool(c, 'search_items', { query: 'macbook', category: 'Electronics > Laptops', condition: ['not_fully_functional'] });
  const page = c.calls.find((x) => x.kind === 'page');
  const q = new URLSearchParams(page.path.split('?')[1]);
  assert.deepEqual(q.getAll('catalog[]'), ['12']);
  assert.deepEqual(q.getAll('status_ids[]'), ['7']);
  assert.equal(q.has('category'), false);
});

test('an explicit categoryId wins over `category` and skips the lookup', async () => {
  const c = makeClient();
  await callTool(c, 'search_items', { query: 'x', category: 'Laptops', categoryId: 99 });
  assert.deepEqual(new URLSearchParams(c.calls.find((x) => x.kind === 'page').path.split('?')[1]).getAll('catalog[]'), ['99']);
  assert.equal(c.calls.some((x) => x.kind === 'api'), false);
});

test('unresolvable or non-string `category` fails the search instead of running unfiltered', async () => {
  const c = makeClient();
  await assert.rejects(callTool(c, 'search_items', { query: 'x', category: 'Submarines' }), /Could not find category/);
  await assert.rejects(callTool(c, 'search_items', { query: 'x', category: ['Laptops'] }), /category must be a string/);
  assert.equal(c.calls.some((x) => x.kind === 'page'), false);
});
