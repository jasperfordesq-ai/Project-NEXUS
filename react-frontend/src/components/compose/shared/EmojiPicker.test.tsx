// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for EmojiPicker component
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { EmojiPicker } from './EmojiPicker';
import { EMOJI_CATEGORIES } from '@/data/emoji-data';

// Mock react-i18next — return the key as the translation value
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Return human-readable labels for category keys used in tests
      const labels: Record<string, string> = {
        'compose.emoji_search': 'Search emoji',
        'compose.emoji_smileys': 'Smileys',
        'compose.emoji_people': 'People',
        'compose.emoji_animals': 'Animals',
        'compose.emoji_food': 'Food',
        'compose.emoji_travel': 'Travel',
        'compose.emoji_activities': 'Activities',
        'compose.emoji_objects': 'Objects',
        'compose.emoji_symbols': 'Symbols',
      };
      return labels[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Mock scrollIntoView which is not available in jsdom
Element.prototype.scrollIntoView = vi.fn();

describe('EmojiPicker', () => {
  let onSelect: Mock<(emoji: string) => void>;

  beforeEach(() => {
    onSelect = vi.fn<(emoji: string) => void>();
  });

  it('renders trigger button with Smile icon', () => {
    render(<EmojiPicker onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: 'Search emoji' });
    expect(button).toBeInTheDocument();
  });

  it('opens popover on click', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    const trigger = screen.getByRole('button', { name: 'Search emoji' });
    await user.click(trigger);

    // The search input should appear inside the popover
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search emoji' })).toBeInTheDocument();
    });
  });

  it('shows all 8 emoji categories when open', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'Search emoji' }));

    await waitFor(() => {
      // Each category has a tab button with an aria-label matching its label
      for (const cat of EMOJI_CATEGORIES) {
        const labelMap: Record<string, string> = {
          'compose.emoji_smileys': 'Smileys',
          'compose.emoji_people': 'People',
          'compose.emoji_animals': 'Animals',
          'compose.emoji_food': 'Food',
          'compose.emoji_travel': 'Travel',
          'compose.emoji_activities': 'Activities',
          'compose.emoji_objects': 'Objects',
          'compose.emoji_symbols': 'Symbols',
        };
        const label = labelMap[cat.label] ?? cat.label;
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      }
    });
  });

  it('calls onSelect when emoji is clicked', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // Open the picker
    await user.click(screen.getByRole('button', { name: 'Search emoji' }));

    // Wait for popover to be visible
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search emoji' })).toBeInTheDocument();
    });

    // Click the first emoji from the first category (smileys)
    const firstEmoji = EMOJI_CATEGORIES[0].emojis[0]; // '😀'
    const emojiButton = screen.getByRole('button', { name: firstEmoji });
    await user.click(emojiButton);

    expect(onSelect).toHaveBeenCalledWith(firstEmoji);
  });

  it('filters emoji by search text', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // Open picker
    await user.click(screen.getByRole('button', { name: 'Search emoji' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search emoji' })).toBeInTheDocument();
    });

    // Type a keyword to filter
    const searchInput = screen.getByRole('textbox', { name: 'Search emoji' });
    await user.type(searchInput, 'laugh');

    // '😂' has keyword 'laugh', should be visible
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '😂' })).toBeInTheDocument();
    });

    // '🍕' (pizza) should not be visible
    expect(screen.queryByRole('button', { name: '🍕' })).not.toBeInTheDocument();
  });

  it('filters emoji by keyword search (e.g., "love" finds hearts)', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // Open picker
    await user.click(screen.getByRole('button', { name: 'Search emoji' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search emoji' })).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('textbox', { name: 'Search emoji' });
    await user.type(searchInput, 'love');

    // Hearts and love-related emoji should be visible
    await waitFor(() => {
      // '😍' has keyword 'love'
      expect(screen.getByRole('button', { name: '😍' })).toBeInTheDocument();
      // '❤️' has keyword 'love'
      expect(screen.getByRole('button', { name: '❤️' })).toBeInTheDocument();
    });
  });

  it('has aria-pressed on active category button', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // Open picker
    await user.click(screen.getByRole('button', { name: 'Search emoji' }));

    await waitFor(() => {
      // First category (Smileys) should be active by default
      const smileysButton = screen.getByRole('button', { name: 'Smileys' });
      expect(smileysButton).toHaveAttribute('aria-pressed', 'true');
    });

    // Other categories should have aria-pressed="false"
    const animalsButton = screen.getByRole('button', { name: 'Animals' });
    expect(animalsButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes active category when a category button is clicked', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // Open picker
    await user.click(screen.getByRole('button', { name: 'Search emoji' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Smileys' })).toBeInTheDocument();
    });

    // Click Animals category
    await user.click(screen.getByRole('button', { name: 'Animals' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Animals' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Smileys' })).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('closes popover after emoji selection', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // Open picker
    await user.click(screen.getByRole('button', { name: 'Search emoji' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search emoji' })).toBeInTheDocument();
    });

    // Click an emoji
    const firstEmoji = EMOJI_CATEGORIES[0].emojis[0];
    await user.click(screen.getByRole('button', { name: firstEmoji }));

    // Search input should disappear (popover closed)
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Search emoji' })).not.toBeInTheDocument();
    });
  });
});
