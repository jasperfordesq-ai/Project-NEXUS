// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { BackToTop } from './BackToTop';

// Mock framer-motion
vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      return ({
        children,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        ...props
      }: Record<string, unknown>) => {
        const Tag = typeof tag === 'string' ? tag : 'div';
        return <Tag {...props}>{children}</Tag>;
      };
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock HeroUI Button
vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual('@/components/ui');
  return {
    ...actual,
    Button: ({
      children,
      'aria-label': ariaLabel,
      onPress,
      isIconOnly: _isIconOnly,
      size: _size,
      ...props
    }: Record<string, unknown>) => (
      <button aria-label={ariaLabel} onClick={onPress} {...props}>
        {children}
      </button>
    ),
  };
});

describe('BackToTop', () => {
  it('renders without crashing', () => {
    const { container } = render(<BackToTop />);
    expect(container).toBeInTheDocument();
  });

  it('is initially hidden (scrollY = 0)', () => {
    render(<BackToTop />);
    // Button should not be visible since scrollY < 400
    expect(screen.queryByLabelText('Scroll to top')).not.toBeInTheDocument();
  });

  it('positions the scroll button above the floating report button', () => {
    render(<BackToTop />);

    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    fireEvent.scroll(window);

    const button = screen.getByLabelText('Scroll to top');
    const wrapper = button.closest('.fixed');

    expect(wrapper?.className).toContain(
      'bottom-[calc(var(--safe-area-bottom)+8.75rem+var(--miniplayer-offset,0rem))]'
    );
    expect(wrapper?.className).toContain(
      'lg:bottom-[calc(6rem+var(--miniplayer-offset,0rem))]'
    );
  });
});
