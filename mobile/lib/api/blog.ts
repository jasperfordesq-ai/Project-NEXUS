// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface BlogCategory {
  id: number;
  name: string;
  color: string;
}

export interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  content?: string | null;
  featured_image: string | null;
  category: BlogCategory | null;
  published_at: string;
  reading_time: number;
}

export interface BlogListResponse {
  data: BlogPost[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

/**
 * GET /api/v2/blog
 * Retrieve a cursor-paginated list of blog posts with optional full-text search.
 */
export function getBlogPosts(
  cursor: string | null,
  search?: string,
): Promise<BlogListResponse> {
  return api.get<BlogListResponse>(`${API_V2}/blog`, {
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {}),
  });
}

/**
 * GET /api/v2/blog/:slug
 * Retrieve a single blog post by its slug.
 */
export function getBlogPost(slug: string): Promise<{ data: BlogPost }> {
  return api.get<{ data: BlogPost }>(`${API_V2}/blog/${slug}`);
}
