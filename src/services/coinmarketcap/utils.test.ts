import { Article } from './models';
import { deduplicate } from './utils';

test('should deduplicte news articles', () => {
  const base: Article = {
    assets: [],
    createdAt: '',
    meta: {
      content: '',
      createdAt: '',
      language: '',
      maxChar: 0,
      releasedAt: '',
      sourceName: '',
      sourceUrl: '',
      status: '',
      subtitle: '',
      title: '',
      type: '',
      updatedAt: '',
      visibility: true
    },
    slug: 'a'
  };

  const articlesInDb: Article[] = [
    // Assuming the first item was added the latest
    { ...base, slug: 'old-1' },
    { ...base, slug: 'old-2' },
    { ...base, slug: 'old-3' }
  ];

  const articlesFromApi: Article[] = [
    // Assuming the first items are fresh from the API (and thus not stored in our db)
    { ...base, slug: 'new-1' },
    { ...base, slug: 'new-2' },
    { ...base, slug: 'old-1' },
    { ...base, slug: 'old-2' },
    { ...base, slug: 'old-3' }
  ];

  const newArticles = deduplicate(articlesFromApi, { slug: articlesInDb[0].slug });

  const expectedSlugs = ['new-1', 'new-2'];

  expect(newArticles.map((item) => item.slug)).toStrictEqual(expectedSlugs);
});
