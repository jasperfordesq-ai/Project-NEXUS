// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import {
  getKbArticle,
  getKbArticles,
  getResources,
  getResourceCategories,
  searchKbArticles,
  searchKbArticlePage,
  submitKbFeedback,
} from './resources';

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

describe('resources API', () => {
  it('reads the saved feedback and totals after the write receipt', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { message: 'Saved' } });
    const article = { id: 7, title: 'Guide', my_feedback: false, helpful_yes: 2, helpful_no: 3 };
    (api.get as jest.Mock).mockResolvedValue({ data: article });
    expect(await submitKbFeedback(7, false)).toEqual(article);
    expect(api.post).toHaveBeenCalledWith('/api/v2/kb/7/feedback', { is_helpful: false });
    expect(api.get).toHaveBeenCalledWith('/api/v2/kb/7');
    expect((api.post as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((api.get as jest.Mock).mock.invocationCallOrder[0]);
  });

  it('does not read or claim success after a rejected feedback write', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(new Error('Write refused'));
    await expect(submitKbFeedback(7, true)).rejects.toThrow('Write refused');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('surfaces a failed confirmation read instead of inventing saved totals', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { message: 'Saved' } });
    (api.get as jest.Mock).mockRejectedValueOnce(new Error('Read failed'));
    await expect(submitKbFeedback(7, true)).rejects.toThrow('Read failed');
  });
  it('carries Knowledge search term and cursor with collection metadata', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ id: 23, title: 'Later match' }], meta: { cursor: 'next', has_more: true } });
    const page = await searchKbArticlePage('  credits  ', 'previous');
    expect(api.get).toHaveBeenCalledWith('/api/v2/kb/search', { q: 'credits', per_page: '20', cursor: 'previous' });
    expect(page).toEqual({ items: [{ id: 23, title: 'Later match' }], cursor: 'next', hasMore: true });
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads resources with search and category filters', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ id: 1, title: 'Guide', description: 'Read this', file_url: 'https://example.test/guide.pdf' }],
      meta: { next_cursor: 'next', has_more: true },
    });

    const result = await getResources({ search: 'guide', categoryId: 5, cursor: 'abc', perPage: 10 });

    expect(api.get).toHaveBeenCalledWith('/api/v2/resources', {
      per_page: '10',
      search: 'guide',
      category_id: '5',
      cursor: 'abc',
    });
    expect(result.items).toHaveLength(1);
    expect(result.cursor).toBe('next');
    expect(result.hasMore).toBe(true);
  });

  it('loads resource categories', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ id: 2, name: 'Forms', resource_count: 3 }] });

    const result = await getResourceCategories();

    expect(api.get).toHaveBeenCalledWith('/api/v2/resources/categories');
    expect(result[0].name).toBe('Forms');
  });

  it('loads and searches knowledge base articles', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 7, title: 'Getting started', slug: 'getting-started' }] })
      .mockResolvedValueOnce({ data: [{ id: 8, title: 'Search result', slug: 'result' }] });

    const list = await getKbArticles();
    const search = await searchKbArticles('time credits');

    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/kb', { per_page: '100' });
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/kb/search', { q: 'time credits', limit: '20' });
    expect(list.items[0].title).toBe('Getting started');
    expect(search[0].title).toBe('Search result');
  });

  it('loads a knowledge base article detail', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { id: 7, title: 'Getting started', content: '<p>Hello</p>' } });

    const result = await getKbArticle(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/kb/7');
    expect(result.title).toBe('Getting started');
  });
  it('requests a saved resource by exact id without browse filters', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ id: 999, title: 'Saved file' }] });
    const page = await getResources({ resourceId: 999, perPage: 1 });
    expect(api.get).toHaveBeenCalledWith('/api/v2/resources', { per_page: '1', resource_id: '999' });
    expect(page.items[0].id).toBe(999);
  });
  it('forwards the knowledge browse cursor and returns next-page metadata', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ id: 101, title: 'Older article' }], meta: { cursor: 'next-page', has_more: true } });
    const page = await getKbArticles('previous-page');
    expect(api.get).toHaveBeenCalledWith('/api/v2/kb', { per_page: '100', cursor: 'previous-page' });
    expect(page).toEqual({ items: [{ id: 101, title: 'Older article' }], cursor: 'next-page', hasMore: true });
  });
});
