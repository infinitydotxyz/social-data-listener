import { Article } from './models';

/**
 * Returns the news articles up until a specific match is found.
 * See `utils.test.ts` for details.
 */
export function deduplicate(articles: Article[], options: { slug: string }) {
  const index = articles.findIndex((item) => item.slug === options.slug);
  return index != -1 ? articles.slice(0, index) : articles;
}
