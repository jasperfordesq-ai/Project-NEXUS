// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface Club {
  id: number;
  name: string;
  description?: string | null;
  logo_url?: string | null;
  website?: string | null;
  meeting_schedule?: string | null;
  member_count: number;
  created_at?: string | null;
}

export interface ClubsPage {
  items: Club[];
  page: number;
  total: number;
  hasMore: boolean;
}

export async function getClubs(options: { search?: string; page?: number } = {}): Promise<ClubsPage> {
  const page = options.page ?? 1;
  const params: Record<string, string> = { page: String(page), per_page: '20' };
  if (options.search?.trim()) params.search = options.search.trim();
  const response = await api.get<{ data?: Club[]; meta?: { current_page?: number; total?: number; has_more?: boolean } }>(`${API_V2}/clubs`, params);
  const items = response.data ?? [];
  return {
    items,
    page: Number(response.meta?.current_page ?? page),
    total: Number(response.meta?.total ?? items.length),
    hasMore: Boolean(response.meta?.has_more),
  };
}
