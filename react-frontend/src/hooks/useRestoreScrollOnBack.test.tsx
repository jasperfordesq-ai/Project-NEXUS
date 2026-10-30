// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression (AWID pilot, Oct 2026): opening a post from the feed and pressing
 * Back dropped the member at the top of the feed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useRestoreScrollOnBack } from './useRestoreScrollOnBack';

function Feed({ ready }: { ready: boolean }) {
  useRestoreScrollOnBack('test-feed', ready, ready ? 5 : 0);
  return <div>feed</div>;
}

let navigateRef: ReturnType<typeof useNavigate> | null = null;
function Nav() {
  navigateRef = useNavigate();
  return null;
}

function renderApp(ready = true) {
  return render(
    <MemoryRouter initialEntries={['/feed']}>
      <Nav />
      <Routes>
        <Route path="/feed" element={<Feed ready={ready} />} />
        <Route path="/post/:id" element={<div>post</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useRestoreScrollOnBack', () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns to the saved position when the member presses Back', () => {
    renderApp();
    Object.defineProperty(window, 'scrollY', { value: 1200, configurable: true });

    act(() => navigateRef!('/post/7'));
    scrollTo.mockClear();
    act(() => navigateRef!(-1));

    expect(scrollTo).toHaveBeenCalledWith(0, 1200);
  });

  it('does not restore when the member arrives by a new link (not Back)', () => {
    renderApp();
    Object.defineProperty(window, 'scrollY', { value: 1200, configurable: true });

    act(() => navigateRef!('/post/7'));
    scrollTo.mockClear();
    act(() => navigateRef!('/feed'));

    expect(scrollTo).not.toHaveBeenCalledWith(0, 1200);
  });

  it('waits until the content has loaded before restoring', () => {
    sessionStorage.setItem('test-feed', JSON.stringify({ search: '', y: 900 }));
    const { rerender } = render(
      <MemoryRouter initialEntries={['/feed']}>
        <Feed ready={false} />
      </MemoryRouter>,
    );
    expect(scrollTo).not.toHaveBeenCalledWith(0, 900);

    rerender(
      <MemoryRouter initialEntries={['/feed']}>
        <Feed ready />
      </MemoryRouter>,
    );
    expect(scrollTo).toHaveBeenCalledWith(0, 900);
  });
});
