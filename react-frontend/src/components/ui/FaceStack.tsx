// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { resolveAvatarUrl } from '@/lib/helpers';

export interface FaceStackPerson {
  id: number | string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar?: string | null;
  avatar_url?: string | null;
}

interface FaceStackProps {
  /** People the viewer can already see on this page; nothing more is fetched. */
  people: ReadonlyArray<FaceStackPerson>;
  /** How many faces to show at most. */
  max?: number;
  /** 'xs' 20px, 'sm' 24px, 'md' 32px. */
  size?: 'xs' | 'sm' | 'md';
  /**
   * The words a screen reader hears instead of the row of faces, e.g. "Going:
   * Maeve and Tom". Left out, the faces are decoration and are hidden — use
   * that only where the same people are named in text beside them.
   */
  label?: string;
  'data-testid'?: string;
  className?: string;
}

const SIZE = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
} as const;

function displayName(person: FaceStackPerson): string {
  return person.name?.trim() || [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
}

/**
 * A few overlapping faces: the people going to an event, a group's members,
 * the newest members (warmth plan P8/P10). One shared look, so a row of faces
 * means "people" everywhere — each face is the member's photo, or their own
 * coloured initials. Ringed in the surface colour so faces separate cleanly on
 * light and dark cards.
 */
export function FaceStack({ people, max = 3, size = 'sm', label, className = '', 'data-testid': testId }: FaceStackProps) {
  const shown = people.slice(0, max);
  if (shown.length === 0) return null;

  return (
    <span
      className={`flex shrink-0 -space-x-1.5 ${className}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {shown.map((person) => (
        <Avatar
          key={person.id}
          data-testid={testId}
          src={resolveAvatarUrl(person.avatar_url || person.avatar)}
          name={displayName(person)}
          size="sm"
          className={`${SIZE[size]} ring-2 ring-[var(--surface-solid)]`}
        />
      ))}
    </span>
  );
}

export default FaceStack;
