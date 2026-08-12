// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { SourceRepositoryLink, PROJECT_NEXUS_REPO_URL } from './SourceRepositoryLink';

vi.mock('@/contexts', () => createMockContexts());

describe('SourceRepositoryLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a link element', () => {
    render(<SourceRepositoryLink />);
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('links to the correct GitHub repository URL', () => {
    render(<SourceRepositoryLink />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', PROJECT_NEXUS_REPO_URL);
  });

  it('exports the canonical repo URL constant', () => {
    expect(PROJECT_NEXUS_REPO_URL).toBe('https://github.com/jasperfordesq-ai/Project-NEXUS');
  });

  it('has an aria-label for accessibility', () => {
    render(<SourceRepositoryLink />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-label');
    expect(link.getAttribute('aria-label')).not.toBe('');
  });

  it('opens in a new tab (isExternal renders target=_blank or rel)', () => {
    render(<SourceRepositoryLink />);
    const link = screen.getByRole('link');
    // HeroUI Link with isExternal adds target="_blank" and rel="noopener noreferrer"
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders the GitHub icon', () => {
    const { container } = render(<SourceRepositoryLink />);
    // Lucide icons render as <svg> elements
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('renders the ExternalLink icon in addition to the GitHub icon', () => {
    const { container } = render(<SourceRepositoryLink />);
    // Expect at least 2 SVG icons: Github + ExternalLink
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  describe('default (non-compact, non-inverse) mode', () => {
    it('applies min-w class for full-width mode', () => {
      const { container } = render(<SourceRepositoryLink />);
      const link = container.querySelector('a');
      expect(link?.className).toContain('min-w-[13rem]');
    });

    it('applies non-inverse border/bg classes', () => {
      const { container } = render(<SourceRepositoryLink />);
      const link = container.querySelector('a');
      expect(link?.className).toContain('border-theme-default');
    });
  });

  describe('compact mode', () => {
    it('applies min-w-0 instead of full-width class', () => {
      const { container } = render(<SourceRepositoryLink compact />);
      const link = container.querySelector('a');
      expect(link?.className).toContain('min-w-0');
      expect(link?.className).not.toContain('min-w-[13rem]');
    });
  });

  describe('inverse mode', () => {
    it('applies inverse border classes', () => {
      const { container } = render(<SourceRepositoryLink inverse />);
      const link = container.querySelector('a');
      expect(link?.className).toContain('border-white/20');
    });

    it('does not apply non-inverse border classes', () => {
      const { container } = render(<SourceRepositoryLink inverse />);
      const link = container.querySelector('a');
      expect(link?.className).not.toContain('border-theme-default');
    });
  });

  it('forwards extra className to the link element', () => {
    const { container } = render(<SourceRepositoryLink className="my-extra-class" />);
    const link = container.querySelector('a');
    expect(link?.className).toContain('my-extra-class');
  });
});
