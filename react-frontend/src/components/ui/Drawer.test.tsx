// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18n from 'i18next';
import { cleanup, render, screen, fireEvent } from '@/test/test-utils';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerHeading,
  DrawerBody,
  DrawerFooter,
} from './Drawer';

// Drawer wraps HeroUIDrawer which renders into a portal.
// We query via screen (searches document.body incl. portals).

describe('Drawer — open/closed gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when isOpen=true', () => {
    render(
      <Drawer isOpen>
        <DrawerContent aria-label="Open drawer example">
          <DrawerBody><p>drawer body</p></DrawerBody>
        </DrawerContent>
      </Drawer>
    );
    expect(screen.getByText('drawer body')).toBeInTheDocument();
  });

  it('does not render drawer dialog when isOpen=false', () => {
    render(
      <Drawer isOpen={false}>
        <DrawerContent aria-label="Drawer title example">
          <DrawerBody><p>hidden content</p></DrawerBody>
        </DrawerContent>
      </Drawer>
    );
    expect(screen.queryByText('hidden content')).not.toBeInTheDocument();
  });
});

describe('Drawer — compound sections', () => {
  it('renders DrawerHeader children', () => {
    render(
      <Drawer isOpen>
        <DrawerContent>
          <DrawerHeader><DrawerHeading>Drawer Title</DrawerHeading></DrawerHeader>
          <DrawerBody><p>body</p></DrawerBody>
        </DrawerContent>
      </Drawer>
    );
    const dialog = screen.getByRole('dialog', { name: 'Drawer Title' });
    expect(dialog.querySelector('[data-slot="drawer-header"]')).not.toBeNull();
    expect(dialog.querySelector('[data-slot="drawer-heading"]')).toHaveTextContent('Drawer Title');
  });

  it('renders DrawerBody children', () => {
    render(
      <Drawer isOpen>
        <DrawerContent aria-label="Drawer footer example">
          <DrawerBody><span>Body content</span></DrawerBody>
        </DrawerContent>
      </Drawer>
    );
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('renders DrawerFooter children', () => {
    render(
      <Drawer isOpen>
        <DrawerContent aria-label="Render property drawer example">
          <DrawerBody><p>body</p></DrawerBody>
          <DrawerFooter><button>Confirm action</button></DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
    // Use a unique name that won't collide with the built-in CloseTrigger button
    expect(screen.getByRole('button', { name: /confirm action/i })).toBeInTheDocument();
  });
});

describe('Drawer — render prop children', () => {
  it('passes close function to render-prop children', () => {
    const onClose = vi.fn();
    render(
      <Drawer isOpen onClose={onClose} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DrawerContent aria-label="Render property drawer example">
          {(close) => (
            <DrawerBody>
              <button onClick={close}>Close via prop</button>
            </DrawerBody>
          )}
        </DrawerContent>
      </Drawer>
    );
    expect(screen.getByRole('button', { name: /close via prop/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close via prop/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Drawer — onClose / onOpenChange', () => {
  it('renders at least one button (built-in close trigger) when isOpen=true', () => {
    const onClose = vi.fn();
    render(
      <Drawer isOpen onClose={onClose}>
        <DrawerContent aria-label="Test drawer">
          <DrawerHeader><span>Title</span></DrawerHeader>
          <DrawerBody><p>content</p></DrawerBody>
        </DrawerContent>
      </Drawer>
    );
    // HeroUI renders a CloseTrigger button inside the dialog
    const allButtons = screen.queryAllByRole('button');
    expect(allButtons.length).toBeGreaterThan(0);
  });
});

describe('Drawer — localized close trigger', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('uses the active locale for the built-in close trigger label', async () => {
    i18n.addResource('fr', 'common', 'accessibility.close', 'Fermer');
    await i18n.changeLanguage('fr');

    render(
      <Drawer isOpen>
        <DrawerContent aria-label="Exemple de tiroir">
          <DrawerBody><p>Contenu</p></DrawerBody>
        </DrawerContent>
      </Drawer>,
    );

    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });

  it('allows a translated context-specific close label override', () => {
    render(
      <Drawer isOpen closeLabel="Close notifications">
        <DrawerContent aria-label="Notifications">
          <DrawerBody><p>Notification list</p></DrawerBody>
        </DrawerContent>
      </Drawer>,
    );

    expect(screen.getByRole('button', { name: 'Close notifications' })).toBeInTheDocument();
  });
});

describe('Drawer responsive mobile placement', () => {
  it('converts a side drawer into a handled bottom sheet on phones', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      render(
        <Drawer isOpen placement="right">
          <DrawerContent aria-label="Responsive drawer">
            <DrawerBody>Mobile content</DrawerBody>
          </DrawerContent>
        </Drawer>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Responsive drawer' });
      expect(dialog).toHaveAttribute('data-placement', 'bottom');
      expect(dialog).toHaveClass('nexus-responsive-side-drawer-sheet');
      expect(dialog.querySelector('[data-slot="drawer-handle"]')).not.toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
