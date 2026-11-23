// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

import { createMockContexts } from '@/test/mock-contexts';
import { render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/contexts', () => createMockContexts());

const FULL_ARTICLE = vi.hoisted(() => ({
  title: 'Legal Documents Hub',
  summary: 'Manage your tenant legal documents from this screen.',
  steps: [
    { label: 'Create a document', detail: 'Use the + button to add a new document.' },
    { label: 'Publish the document', detail: 'Set status to published when ready.' },
  ],
  tips: ['Keep your terms up to date.', 'Always review before publishing.'],
  caution: 'Deleting a document is permanent and cannot be undone.',
  relatedPaths: [
    { label: 'Privacy Policy', path: '/admin/privacy' },
    { label: 'Settings', path: '/admin/settings' },
  ],
}));

const MINIMAL_ARTICLE = vi.hoisted(() => ({
  title: 'Simple Article',
  summary: 'Just a summary, nothing else.',
}));

import { AdminHelpDrawer } from './AdminHelpDrawer';

function isHiddenByModal(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    if (current.inert || current.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function ControlledAdminHelpDrawer() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>Open help</button>
      <button type="button" data-testid="background-action">Background action</button>
      <AdminHelpDrawer
        article={FULL_ARTICLE}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </div>
  );
}

describe('AdminHelpDrawer — official modal drawer contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the HeroUI anatomy and exposes a translated accessible name', () => {
    render(<AdminHelpDrawer article={FULL_ARTICLE} isOpen onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Help: Legal Documents Hub' });
    expect(dialog).toHaveAttribute('data-slot', 'drawer-dialog');
    expect(dialog.querySelector('[data-slot="drawer-heading"]')).toHaveTextContent(
      'Legal Documents Hub',
    );
    expect(dialog.closest('[data-slot="drawer-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="drawer-backdrop"]')).not.toBeNull();
  });

  it('does not leave an off-screen dialog or backdrop in the DOM when closed', () => {
    render(<AdminHelpDrawer article={FULL_ARTICLE} isOpen={false} onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-backdrop"]')).toBeNull();
  });

  it('renders article title, summary, steps, tips, caution, and related links', () => {
    render(<AdminHelpDrawer article={FULL_ARTICLE} isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Legal Documents Hub')).toBeInTheDocument();
    expect(screen.getByText('Manage your tenant legal documents from this screen.')).toBeInTheDocument();
    expect(screen.getByText('Create a document')).toBeInTheDocument();
    expect(screen.getByText('Use the + button to add a new document.')).toBeInTheDocument();
    expect(screen.getByText('Keep your terms up to date.')).toBeInTheDocument();
    expect(screen.getByText('Deleting a document is permanent and cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  // The article is already in the reader's language (PageHeader reads it from
  // the admin_help locale file). Until 23 Nov 2026 every line was passed
  // through the translator again as if it were a key: nothing matched, so in
  // development each line read "[missing] admin_help:…" and on the live site
  // each line was reported as a missing translation.
  it('shows the article text as it is, and asks the translator for none of it', async () => {
    const i18n = (await import('i18next')).default;
    const missing = vi.fn();
    i18n.on('missingKey', missing);

    try {
      render(
        <AdminHelpDrawer
          isOpen
          onClose={vi.fn()}
          article={{
            title: 'Billing control',
            summary: 'A plan counts active members: those who signed in. In the last 90 days.',
            steps: [{ label: 'Record a payment', detail: 'Press “Record a payment”. Choose one month on.' }],
            tips: ['admin_help:not a key'],
            caution: 'Once it is on: communities can be paused.',
            relatedPaths: [{ label: 'Automatic checks', path: '/platform-team/billing/automatic-checks' }],
          }}
        />,
      );

      expect(screen.getByText('Billing control')).toBeInTheDocument();
      expect(screen.getByText('A plan counts active members: those who signed in. In the last 90 days.')).toBeInTheDocument();
      expect(screen.getByText('Press “Record a payment”. Choose one month on.')).toBeInTheDocument();
      expect(screen.getByText('admin_help:not a key')).toBeInTheDocument();
      expect(screen.getByText('Once it is on: communities can be paused.')).toBeInTheDocument();
      expect(screen.getByText('Automatic checks')).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('[missing]');
      expect(missing).not.toHaveBeenCalled();
    } finally {
      i18n.off('missingKey', missing);
    }
  });

  it('renders a minimal article without optional sections', () => {
    render(<AdminHelpDrawer article={MINIMAL_ARTICLE} isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Simple Article')).toBeInTheDocument();
    expect(screen.getByText('Just a summary, nothing else.')).toBeInTheDocument();
    expect(screen.queryByText(/how to use/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tips/i)).not.toBeInTheDocument();
  });

  it('dismisses with the translated close trigger', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminHelpDrawer article={FULL_ARTICLE} isOpen onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close help panel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses through the official backdrop contract', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminHelpDrawer article={FULL_ARTICLE} isOpen onClose={onClose} />);

    const backdrop = document.querySelector<HTMLElement>('[data-slot="drawer-backdrop"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when a related page is chosen', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminHelpDrawer article={FULL_ARTICLE} isOpen onClose={onClose} />);

    // With the community's name in the address, as every link in the app has.
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/test/admin/settings');
    await user.click(screen.getByRole('link', { name: 'Settings' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('contains focus, inerts the page, locks scroll, and restores the opener after Escape', async () => {
    const user = userEvent.setup();
    render(<ControlledAdminHelpDrawer />);

    const trigger = screen.getByRole('button', { name: 'Open help' });
    const backgroundAction = screen.getByTestId('background-action');
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Help: Legal Documents Hub' });
    const closeButton = screen.getByRole('button', { name: 'Close help panel' });
    await waitFor(() => expect(dialog).toHaveFocus());

    expect(isHiddenByModal(backgroundAction)).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');

    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    expect(backgroundAction).not.toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.documentElement.style.overflow).not.toBe('hidden');
    expect(isHiddenByModal(backgroundAction)).toBe(false);
  });
});
