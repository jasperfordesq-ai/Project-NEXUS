// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { describeActivity } from './activityDescription';
import type { ActivityLogEntry } from '../../api/types';

const t = (key: string, options?: Record<string, unknown>) => {
  const params = options ? Object.entries(options).filter(([k]) => k !== 'defaultValue') : [];
  return params.length ? `${key} ${params.map(([k, v]) => `${k}=${String(v)}`).join(' ')}` : key;
};

const base: ActivityLogEntry = { id: 1, user_id: 1, user_name: 'A', action: 'x', description: null, created_at: '2026-01-01' };

describe('describeActivity', () => {
  it('localises a structured row from its code and parameters', () => {
    const text = describeActivity({ ...base, description_code: 'blog_post_created', description_params: { id: 4, title: 'Hi' } }, t);
    expect(text).toBe('system.activity_details.blog_post_created id=4 title=Hi');
  });

  it('translates status parameters before interpolating them', () => {
    const text = describeActivity(
      { ...base, description_code: 'blog_post_status_changed', description_params: { id: 4, old_status: 'draft', new_status: 'published' } },
      t,
    );
    expect(text).toContain('old_status=system.activity_status.draft');
    expect(text).toContain('new_status=system.activity_status.published');
  });

  it('names an unknown code rather than showing nothing', () => {
    expect(describeActivity({ ...base, description_code: 'something_new' }, t)).toBe('system.activity_details.unknown code=something_new');
  });

  it('keeps the server prose for historical rows and a dash when there is none', () => {
    expect(describeActivity({ ...base, description: 'approved a member' }, t)).toBe('approved a member');
    expect(describeActivity(base, t)).toBe('—');
  });
});
