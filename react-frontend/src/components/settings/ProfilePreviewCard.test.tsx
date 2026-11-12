// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { ProfilePreviewCard, type ProfilePreviewCardProps } from './ProfilePreviewCard';

const base: ProfilePreviewCardProps = {
  firstName: '', organisationName: '', profileType: 'individual', tagline: '', bio: '', location: '', avatar: null,
};

describe('ProfilePreviewCard — how other members see you, as you edit', () => {
  // It sits inside the "Profile information" section (an h2), so its own
  // heading is the next level down; a second h2 broke the outline (audit of
  // warmth phase 5, 12 Nov 2026).
  it('is headed one level below the profile section it sits in', () => {
    render(<ProfilePreviewCard {...base} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(screen.getByTestId('profile-preview')).toHaveAttribute('aria-labelledby', heading.id);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('shows the first name, tagline, bio and place as they are typed', () => {
    render(
      <ProfilePreviewCard
        {...base}
        firstName="Maeve"
        tagline="Keen gardener"
        bio="I love growing vegetables and sharing seedlings."
        location="Riverside"
      />,
    );
    const preview = screen.getByTestId('profile-preview');
    expect(screen.getByTestId('profile-preview-name')).toHaveTextContent('Maeve');
    expect(preview).toHaveTextContent('Keen gardener');
    expect(preview).toHaveTextContent('I love growing vegetables and sharing seedlings.');
    expect(preview).toHaveTextContent('Riverside');
  });

  // Other members never see a surname (the platform's surname rule), so the
  // preview is given the first name only and says so.
  it('never shows a surname, and tells the member that others see their first name only', () => {
    render(<ProfilePreviewCard {...base} firstName="Maeve" />);
    expect(screen.getByTestId('profile-preview-name').textContent).toBe('Maeve');
    expect(screen.getByTestId('profile-preview-first-name-note').textContent).not.toBe('');
  });

  it("shows an organisation's name for an organisation profile, without the first-name note", () => {
    render(<ProfilePreviewCard {...base} profileType="organisation" firstName="Maeve" organisationName="Riverside Growers" />);
    expect(screen.getByTestId('profile-preview-name')).toHaveTextContent('Riverside Growers');
    expect(screen.queryByTestId('profile-preview-first-name-note')).toBeNull();
  });

  it('invites a name and a few words before anything is typed, in a quieter colour', () => {
    render(<ProfilePreviewCard {...base} />);
    expect(screen.getByTestId('profile-preview-name').className).toContain('text-theme-subtle');
    expect(screen.getByTestId('profile-preview-name').textContent).not.toBe('');
    expect(screen.getByTestId('profile-preview-bio-placeholder').textContent).not.toBe('');
  });

  it('shows the bio as plain words, never as markup', () => {
    render(<ProfilePreviewCard {...base} firstName="Maeve" bio="<p>Hello <strong>neighbours</strong></p>" />);
    const preview = screen.getByTestId('profile-preview');
    expect(preview).toHaveTextContent('Hello neighbours');
    expect(preview.querySelector('strong')).toBeNull();
    expect(preview.textContent).not.toContain('<strong>');
  });

  it('nudges for a photo until there is one', () => {
    const { rerender } = render(<ProfilePreviewCard {...base} firstName="Maeve" />);
    expect(screen.getByTestId('profile-preview-photo-nudge')).toBeInTheDocument();
    rerender(<ProfilePreviewCard {...base} firstName="Maeve" avatar="/uploads/avatars/maeve.jpg" />);
    expect(screen.queryByTestId('profile-preview-photo-nudge')).toBeNull();
  });

  it('is a picture of a card, not a card: nothing in it can be clicked', () => {
    render(<ProfilePreviewCard {...base} firstName="Maeve" bio="Hello" />);
    const preview = screen.getByTestId('profile-preview');
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.querySelector('button')).toBeNull();
  });
});
