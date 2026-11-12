// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Drift guard: the live preview beside the group form must look like the real
 * card on the groups page (GroupCard in pages/groups/GroupsPage). Both are
 * rendered from the same group and the parts that carry meaning are compared,
 * so a change to one that is not made to the other fails here (audit of the
 * live previews, 12 Nov 2026).
 *
 * Not compared, because the preview does not show it yet: the group's type
 * chip (the real card shows it; the group form lets a type be chosen).
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts/TenantContext', () => ({ useTenant: createMockContexts().useTenant }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { GroupCard } from '@/pages/groups/GroupsPage';
import { GroupPreviewCard } from './GroupPreviewCard';

type Group = ComponentProps<typeof GroupCard>['group'];

const sortedClasses = (element: Element | null): string[] =>
  (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();

function renderBoth(group: Group) {
  render(
    <>
      <div data-testid="real">
        <GroupCard group={group} />
      </div>
      <GroupPreviewCard
        id={group.id}
        name={group.name}
        description={group.description}
        visibility={group.visibility}
        coverSrc={group.cover_image_url ?? null}
        pictureSrc={group.image_url ?? null}
        memberCount={group.member_count ?? group.members_count}
      />
    </>,
  );
  return { real: screen.getByTestId('real'), preview: screen.getByTestId('group-preview') };
}

const group: Group = {
  id: 42,
  name: 'Riverside walkers',
  description: 'A gentle walk every Sunday.',
  visibility: 'private',
  member_count: 12,
  members_count: 12,
  cover_image_url: null,
  image_url: null,
  created_at: '2026-11-01T10:00:00Z',
};

describe('GroupPreviewCard and the real GroupCard stay alike', () => {
  it('show the same name', () => {
    const { real } = renderBoth(group);
    expect(screen.getByTestId('group-preview-name').textContent).toBe(real.querySelector('h3')?.textContent);
  });

  it('give a group with no picture the same coloured cover, in the same colour and texture', () => {
    renderBoth(group);
    const realCover = screen.getByTestId('group-cover');
    const previewCover = screen.getByTestId('group-preview-cover');
    expect(previewCover.getAttribute('data-colour')).toBe(realCover.getAttribute('data-colour'));
    expect(previewCover.innerHTML).toBe(realCover.innerHTML);
  });

  it.each([
    ['private', 'lucide-lock'],
    ['public', 'lucide-globe'],
  ] as const)('mark a %s group with the same badge', (visibility, icon) => {
    const { real, preview } = renderBoth({ ...group, visibility });
    const realBadge = real.querySelector('span.end-3.top-3');
    const previewBadge = preview.querySelector('span.end-3.top-3');
    expect(realBadge?.querySelector(`.${icon}`)).not.toBeNull();
    expect(previewBadge?.querySelector(`.${icon}`)).not.toBeNull();
    expect(sortedClasses(previewBadge)).toEqual(sortedClasses(realBadge));
  });

  it('use the same badge style over a photo', () => {
    const { real, preview } = renderBoth({ ...group, cover_image_url: '/uploads/groups/walk.jpg' });
    expect(sortedClasses(preview.querySelector('span.end-3.top-3'))).toEqual(
      sortedClasses(real.querySelector('span.end-3.top-3')),
    );
  });

  it('show the same number of members', () => {
    const { real } = renderBoth(group);
    const realCount = real.querySelector('svg.lucide-users.w-4')?.parentElement?.textContent?.trim();
    const previewCount = screen.getByTestId('group-preview-members').querySelector('[aria-hidden="true"]:not(svg)')?.textContent;
    expect(realCount).toBe('12');
    expect(previewCount).toBe(realCount);
  });
});
