// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

import { motion, useReducedMotion } from './index';

describe('motion proxy', () => {
  it('does not create motion components for symbol metadata probes', () => {
    expect(() => Object.prototype.toString.call(motion)).not.toThrow();
  });
});

describe('useReducedMotion — the member\'s own setting counts too', () => {
  function Probe() {
    return <span data-testid="reduced">{String(useReducedMotion())}</span>;
  }

  afterEach(() => {
    document.documentElement.removeAttribute('data-reduced-motion');
  });

  it('is true when the member switched reduced motion on in the app', () => {
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    render(<Probe />);
    expect(screen.getByTestId('reduced').textContent).toBe('true');
  });

  it('follows the setting when it changes while the page is open', async () => {
    render(<Probe />);
    expect(screen.getByTestId('reduced').textContent).toBe('false');
    await act(async () => {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('reduced').textContent).toBe('true'));
  });
});

describe('"appear when scrolled to" sections', () => {
  const RealObserver = globalThis.IntersectionObserver;

  afterEach(() => {
    document.documentElement.removeAttribute('data-reduced-motion');
    globalThis.IntersectionObserver = RealObserver;
  });

  function useSilentObserver() {
    // An observer that never reports the section as on screen, like a section
    // far below the fold that has not been scrolled to yet.
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver;
  }

  function Section() {
    return (
      <motion.div data-testid="section" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
        Trending
      </motion.div>
    );
  }

  it('wait off screen until scrolled to, for most members', () => {
    useSilentObserver();
    render(<Section />);
    expect(screen.getByTestId('section').style.opacity).toBe('0');
  });

  it('are simply there for anyone who asked for less movement', () => {
    useSilentObserver();
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    render(<Section />);
    expect(screen.getByTestId('section').style.opacity).toBe('1');
  });
});

describe('the hover lift on cards', () => {
  it('is left out for anyone who asked for less movement', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.resolve(__dirname, '../../styles/glass.css'), 'utf8');
    expect(css).toMatch(/\.glass-card-hover:hover \{[^}]*transform: translateY\(-2px\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.glass-card-hover:hover \{\s*transform: none/);
    expect(css).toMatch(/html\[data-reduced-motion="true"\] \.glass-card-hover:hover \{\s*transform: none/);
  });
});
