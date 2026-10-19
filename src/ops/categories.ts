import { VintedClient } from '../client/session.js';
import { getCategories } from '../client/endpoints.js';
import type { Country, CategoryHit } from '../client/types.js';

/** Attach a breadcrumb ("Electronics > Laptops") to every category. */
function withPaths(cats: CategoryHit[]): CategoryHit[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c: CategoryHit): string => {
    const parts: string[] = [];
    const seen = new Set<number>();
    for (let cur: CategoryHit | undefined = c; cur && !seen.has(cur.id); cur = cur.parentId === undefined ? undefined : byId.get(cur.parentId)) {
      seen.add(cur.id);
      parts.unshift(cur.title);
    }
    return parts.join(' > ');
  };
  return cats.map((c) => ({ ...c, path: pathOf(c) }));
}

export async function opCategories(
  client: VintedClient,
  args: { country?: Country; query?: string },
): Promise<CategoryHit[]> {
  const cats = withPaths(await getCategories(client, args.country ?? 'fr'));
  if (args.query) {
    const q = args.query.toLowerCase();
    return cats.filter((c) => c.title.toLowerCase().includes(q));
  }
  return cats;
}

export interface CategoryMatch { id: number; title: string; path: string }

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Find categories by name. Accepts a plain title ("Laptops") or a breadcrumb
 * ("Electronics > Laptops", "electronics/laptops") to disambiguate titles that
 * appear more than once in the tree. Exact title matches win; a partial match
 * is only used when there is no exact one.
 */
export function findCategories(cats: CategoryHit[], name: string): CategoryMatch[] {
  const segments = name.split(/[>/]/).map(norm).filter(Boolean);
  if (!segments.length) return [];
  const target = segments[segments.length - 1];
  const ancestors = segments.slice(0, -1);

  const all = withPaths(cats);
  const pool = (match: (title: string) => boolean) =>
    all.filter((c) => {
      if (!match(norm(c.title))) return false;
      const chain = (c.path ?? c.title).split(' > ').map(norm);
      chain.pop(); // drop the category itself
      return ancestors.every((a) => chain.includes(a));
    });

  let hits = pool((t) => t === target);
  if (!hits.length) hits = pool((t) => t.includes(target));
  return hits.map((c) => ({ id: c.id, title: c.title, path: c.path ?? c.title }));
}

/**
 * Resolve one category name to its ID. Throws when nothing matches or the name
 * is ambiguous: silently picking one would search the wrong category.
 */
export async function resolveCategoryId(
  client: VintedClient,
  name: string,
  country: Country = 'fr',
): Promise<CategoryMatch> {
  const hits = findCategories(await getCategories(client, country), name);
  if (hits.length === 1) return hits[0];
  if (!hits.length) {
    throw new Error(`Could not find category "${name}". Use get_categories (query: "...") to browse the tree.`);
  }
  const shown = hits.slice(0, 8).map((h) => `${h.path} (id ${h.id})`).join('; ');
  throw new Error(
    `Category "${name}" is ambiguous (${hits.length} matches: ${shown}${hits.length > 8 ? '; …' : ''}). ` +
    `Use a fuller path like "Electronics > Laptops", or pass categoryId.`,
  );
}
