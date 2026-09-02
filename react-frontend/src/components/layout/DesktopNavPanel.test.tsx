// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for DesktopNavPanel component.
 *
 * Mocking strategy:
 * - Mock the ENTIRE @/components/ui barrel with JSX stubs.
 *   Every HeroUI component in the barrel uses React Aria hooks that register
 *   open handles (PointerEvent listeners, MutationObservers, focus traps) in
 *   JSDOM, preventing the vitest fork worker from exiting — indefinite hang.
 *   Replacing the barrel with plain HTML stubs eliminates all React Aria code.
 * - Mock factories use only JSX (react/jsx-runtime automatic transform).
 *   JSX compiles to _jsx() from 'react/jsx-runtime', NOT React.createElement,
 *   so the factories do NOT reference the top-level React import binding and
 *   are safe to use inside hoisted vi.mock calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

// ── contexts ──────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ── react-router-dom (real module + useLocation override) ─────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: () => ({ pathname: '/test', search: '', hash: '', state: null, key: 'default' }),
  };
});

// ── motion shim ───────────────────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  // Proxy: each motion.xxx becomes a plain <div data-motion-tag="xxx">
  motion: new Proxy({}, {
    get: (_t, prop) => {
      const tag = typeof prop === 'string' ? prop : 'div';
      function MotionEl({ children, variants: _v, initial: _i, animate: _a, exit: _e,
        transition: _tr, whileHover: _wh, whileTap: _wt, whileInView: _wiv,
        layout: _l, viewport: _vp, layoutId: _lid, ...rest }:
        Record<string, unknown>) {
        return <div data-motion-tag={tag} {...rest}>{children as React.ReactNode}</div>;
      }
      MotionEl.displayName = `motion.${tag}`;
      return MotionEl;
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MotionConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

// ── react-i18next stub ────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── helpers / api ─────────────────────────────────────────────────────────────
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | undefined) => url ?? '/default-avatar.png',
  resolveAssetUrl: (url: string | null | undefined) => url ?? null,
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(' '),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  tokenManager: { getAccessToken: vi.fn(() => 'mock-token') },
  API_BASE: 'http://localhost:8090/api',
}));

// ── CRITICAL: stub the ENTIRE @/components/ui barrel ─────────────────────────
//
// Every HeroUI component in this barrel uses React Aria hooks that register
// open handles (PointerEvent listeners, MutationObservers, focus traps) in
// JSDOM. These prevent the vitest fork worker from exiting after all tests
// finish, causing an indefinite hang.
//
// The stub only needs to cover:
//   - Button / ButtonGroup: DesktopNavPanel renders the trigger and each nav item
//   - Popover / PopoverTrigger / PopoverContent / PopoverDialog / PopoverHeading /
//     PopoverArrow: DesktopNavPanel wraps its panel content in a Popover
//   - ScrollShadow: DesktopNavPanel wraps the item list in ScrollShadow
//   - ToastProvider (via @/contexts/ToastContext) imports Button — covered above
//
// All other exports are stubbed as no-ops so the barrel import doesn't crash.
// JSX inside vi.mock factories is safe: it uses react/jsx-runtime, NOT
// the top-level React binding, so there's no initialization-order issue.

// ── Popover ───────────────────────────────────────────────────────────────────
// DesktopNavPanel imports Popover/PopoverTrigger/PopoverContent/PopoverHeading from
// '@/components/ui/Popover', not from the barrel, so stubbing them on the barrel alone left them
// dead and the real React Aria Popover loaded — exactly the open-handle hang the header comment
// above warns about. Defined once here and registered on BOTH specifiers, so the closure-level
// isOpen is shared rather than duplicated per module.
const popoverStub = vi.hoisted(() => {
  // The real Popover ALWAYS renders children (trigger + content); only PopoverContent is
  // conditionally shown when isOpen=true. A closure-level object shares isOpen without
  // React.createContext, which cannot be called inside a hoisted factory.
  const popoverState = { isOpen: false };

  function Popover({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) {
    popoverState.isOpen = isOpen ?? false;
    return <>{children}</>;
  }
  function PopoverTrigger({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  }
  function PopoverContent({ children, className }: { children?: React.ReactNode; className?: string }) {
    return popoverState.isOpen
      ? <div className={className} data-testid="popover-content">{children}</div>
      : null;
  }
  function PopoverDialog({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  }
  function PopoverHeading({ children }: { children?: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function PopoverArrow() { return null; }

  return { Popover, PopoverTrigger, PopoverContent, PopoverDialog, PopoverHeading, PopoverArrow };
});

vi.mock('@/components/ui/Popover', () => popoverStub);

vi.mock('@/components/ui', () => {
  // ── Button ──────────────────────────────────────────────────────────────────
  function Button({ children, onPress, className, variant: _v, size: _s, color: _c,
    isDisabled, disabled, endContent, startContent, isIconOnly: _io,
    fullWidth: _fw, type, ...rest }:
    { children?: React.ReactNode; onPress?: () => void; className?: string;
      variant?: string; size?: string; color?: string; isDisabled?: boolean;
      disabled?: boolean; endContent?: React.ReactNode; startContent?: React.ReactNode;
      isIconOnly?: boolean; fullWidth?: boolean; type?: string;
      [k: string]: unknown }) {
    return (
      <button className={className} onClick={onPress}
        disabled={isDisabled ?? disabled}
        type={(type as 'button' | 'submit' | 'reset') ?? 'button'}
        {...rest}>
        {startContent}{children}{endContent}
      </button>
    );
  }
  function ButtonGroup({ children, className }: { children?: React.ReactNode; className?: string }) {
    return <div className={className}>{children}</div>;
  }

  // ── Popover ─────────────────────────────────────────────────────────────────
  // Defined once in the hoisted popoverStub above and spread into the return below, so the
  // barrel and '@/components/ui/Popover' hand back the same components sharing one isOpen.

  // ── ScrollShadow ─────────────────────────────────────────────────────────────
  function ScrollShadow({ children, className }: { children?: React.ReactNode; className?: string }) {
    return <div className={className}>{children}</div>;
  }

  // ── Card family ──────────────────────────────────────────────────────────────
  function Card({ children, className }: { children?: React.ReactNode; className?: string }) {
    return <div className={className}>{children}</div>;
  }
  function CardHeader({ children }: { children?: React.ReactNode }) { return <div>{children}</div>; }
  function CardBody({ children }: { children?: React.ReactNode }) { return <div>{children}</div>; }
  function CardFooter({ children }: { children?: React.ReactNode }) { return <div>{children}</div>; }

  // ── Misc stubs ────────────────────────────────────────────────────────────────
  const passthrough = ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    <div className={className}>{children}</div>;
  const noop = () => null;

  return {
    Button, ButtonGroup,
    ...popoverStub,
    ScrollShadow,
    Card, CardHeader, CardBody, CardFooter,
    // Commonly-referenced stubs — add more if a test error says "X is not a function"
    Modal: passthrough, ModalContent: passthrough, ModalHeader: passthrough,
    ModalBody: passthrough, ModalFooter: passthrough,
    Drawer: passthrough, DrawerContent: passthrough, DrawerHeader: passthrough,
    DrawerBody: passthrough, DrawerFooter: passthrough,
    Dropdown: passthrough, DropdownTrigger: passthrough, DropdownMenu: passthrough,
    DropdownItem: passthrough, DropdownSection: passthrough,
    Tabs: passthrough, Tab: passthrough,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Spinner: noop, Skeleton: noop, Badge: noop, Chip: passthrough,
    Avatar: noop, AvatarGroup: passthrough,
    Input: passthrough, TextField: passthrough, Textarea: passthrough, TextArea: passthrough,
    Checkbox: passthrough, CheckboxGroup: passthrough,
    Radio: passthrough, RadioGroup: passthrough,
    Select: passthrough, SelectItem: passthrough, SelectSection: passthrough,
    Autocomplete: passthrough, AutocompleteItem: passthrough,
    Progress: passthrough, Meter: passthrough, MeterOutput: noop, MeterTrack: passthrough,
    MeterFill: passthrough,
    Pagination: noop,
    Table: passthrough, TableHeader: passthrough, TableColumn: passthrough,
    TableBody: passthrough, TableRow: passthrough, TableCell: passthrough,
    Link: ({ children, href, className }: { children?: React.ReactNode; href?: string; className?: string }) =>
      <a href={href} className={className}>{children}</a>,
    Breadcrumbs: passthrough,
    Separator: () => <hr />,
    Alert: passthrough, AlertDialog: passthrough,
    CloseButton: ({ onPress, ...rest }: { onPress?: () => void; [k: string]: unknown }) =>
      <button onClick={onPress} {...rest} />,
    ToggleButton: passthrough, ToggleButtonGroup: passthrough,
    Switch: passthrough, Slider: passthrough,
    TagGroup: passthrough, Tag: passthrough,
    Kbd: passthrough,
    Surface: passthrough,
    Typography: passthrough,
    GlassCard: passthrough,
    GlassInput: passthrough,
    BottomSheet: passthrough,
    BackToTop: noop,
    ImagePlaceholder: noop,
    DynamicIcon: noop,
    ConfettiCelebration: noop,
    Code: passthrough,
    Snippet: passthrough,
    TimeInput: passthrough,
    DatePicker: passthrough,
    DateField: passthrough,
    DateRangePicker: passthrough,
    Calendar: passthrough,
    RangeCalendar: passthrough,
    ColorPicker: passthrough,
    ColorSwatchPicker: passthrough,
    InputOTP: passthrough,
    InputGroup: passthrough,
    NumberField: passthrough,
    SearchField: passthrough,
    FieldError: noop,
    Label: passthrough,
    Description: passthrough,
    Form: passthrough,
    Fieldset: passthrough, FieldsetLegend: passthrough, FieldGroup: passthrough,
    FieldsetActions: passthrough,
    AlgorithmLabel: noop,
    ModuleStageBadge: noop,
    Accordion: passthrough,
    AccordionItem: passthrough,
    // Provider hooks
    ConfirmDialogProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useConfirm: () => vi.fn(),
    // ICON_MAP and other non-component exports
    ICON_MAP: {},
    ICON_NAMES: [],
    useAlgorithmInfo: () => null,
  };
});

// ── component under test ──────────────────────────────────────────────────────
import { DesktopNavPanel, type DesktopNavPanelSection } from './DesktopNavPanel';

// ── stable fixtures ───────────────────────────────────────────────────────────
const StubIcon = (() => <svg aria-hidden="true" />) as unknown as LucideIcon;

const LEFT_SECTIONS: DesktopNavPanelSection[] = [
  {
    key: 'community',
    title: 'Community',
    items: [
      { label: 'Feed', href: '/test/feed', icon: StubIcon },
      { label: 'Members', href: '/test/members', icon: StubIcon, desc: 'Browse members' },
    ],
  },
  {
    key: 'events',
    title: 'Events',
    items: [
      { label: 'Events', href: '/test/events', icon: StubIcon },
    ],
  },
];

const RIGHT_SECTIONS: DesktopNavPanelSection[] = [
  {
    key: 'more',
    title: 'More',
    items: [
      { label: 'Blog', href: '/test/blog', icon: StubIcon },
    ],
  },
];

// IMPORTANT: rightSections MUST always be passed as a stable reference.
// The component has `rightSections = []` as a default parameter, which creates
// a NEW array on every render. The useMemo dep on that new reference causes
// allSections to recompute, triggering useEffect, which calls setState, causing
// an infinite render loop that crashes the V8 fork worker.
const EMPTY_SECTIONS: DesktopNavPanelSection[] = [];

const defaultProps = {
  ariaLabel: 'Community navigation',
  isActive: false,
  isOpen: false,
  leftSections: LEFT_SECTIONS,
  rightSections: EMPTY_SECTIONS,  // stable reference — prevents infinite loop
  onNavigate: vi.fn(),
  onOpenChange: vi.fn(),
  triggerIcon: StubIcon,
  triggerLabel: 'Community',
};

describe('DesktopNavPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the trigger button with the label', () => {
    render(<DesktopNavPanel {...defaultProps} />);
    const btns = screen.getAllByRole('button');
    const trigger = btns.find(b => b.textContent?.includes('Community'));
    expect(trigger).toBeInTheDocument();
  });

  it('applies active styling when isActive=true', () => {
    render(<DesktopNavPanel {...defaultProps} isActive />);
    const btns = screen.getAllByRole('button');
    const trigger = btns.find(b => b.textContent?.includes('Community'));
    expect(trigger?.className).toMatch(/bg-theme-active/);
  });

  it('does not render nav items when panel is closed', () => {
    render(<DesktopNavPanel {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Feed')).not.toBeInTheDocument();
  });

  it('renders nav items when panel is open', async () => {
    render(<DesktopNavPanel {...defaultProps} isOpen />);
    await waitFor(() => {
      expect(screen.getByText('Feed')).toBeInTheDocument();
    });
    expect(screen.getByText('Members')).toBeInTheDocument();
    // 'Events' appears as both a section title and a nav item label
    expect(screen.getAllByText('Events').length).toBeGreaterThan(0);
  });

  it('renders section titles when panel is open', async () => {
    render(<DesktopNavPanel {...defaultProps} isOpen />);
    // Wait for the panel content to appear
    await waitFor(() => {
      expect(screen.getByText('Feed')).toBeInTheDocument();
    });
    // 'Community' appears as both the trigger label and a section heading
    const communityEls = screen.getAllByText('Community');
    expect(communityEls.length).toBeGreaterThan(0);
    // 'Events' appears as both a section title and an item label
    expect(screen.getAllByText('Events').length).toBeGreaterThan(0);
  });

  it('renders item descriptions when provided', async () => {
    render(<DesktopNavPanel {...defaultProps} isOpen />);
    await waitFor(() => {
      expect(screen.getByText('Browse members')).toBeInTheDocument();
    });
  });

  it('renders right column items when rightSections provided and open', async () => {
    render(
      <DesktopNavPanel
        {...defaultProps}
        isOpen
        rightSections={RIGHT_SECTIONS}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Blog')).toBeInTheDocument();
    });
  });

  it('calls onNavigate when a nav item button is clicked', async () => {
    const onNavigate = vi.fn();
    render(
      <DesktopNavPanel
        {...defaultProps}
        isOpen
        onNavigate={onNavigate}
      />,
    );
    await waitFor(() => expect(screen.getByText('Feed')).toBeInTheDocument());
    const feedBtn = screen.getByText('Feed').closest('button');
    expect(feedBtn).not.toBeNull();
    act(() => { fireEvent.click(feedBtn!); });
    expect(onNavigate).toHaveBeenCalledWith('/test/feed');
  });

  it('renders nav items as clickable buttons', async () => {
    render(<DesktopNavPanel {...defaultProps} isOpen />);
    await waitFor(() => expect(screen.getByText('Feed')).toBeInTheDocument());
    const feedBtn = screen.getByText('Feed').closest('button');
    expect(feedBtn).toBeInTheDocument();
  });

  it('renders collapsible section with aria-expanded attribute', async () => {
    const collapsibleSections: DesktopNavPanelSection[] = [
      {
        key: 'coll-section',
        title: 'Toggle Me',
        collapsible: true,
        defaultExpanded: true,
        items: [{ label: 'Hidden Item', href: '/test/hidden', icon: StubIcon }],
      },
    ];
    render(
      <DesktopNavPanel
        {...defaultProps}
        isOpen
        leftSections={collapsibleSections}
        rightSections={EMPTY_SECTIONS}
      />,
    );
    await waitFor(() => expect(screen.getByText('Hidden Item')).toBeInTheDocument());
    const toggleBtn = screen.getByRole('button', { name: /toggle me/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded');
  });

  it('collapses section when toggle button is clicked', async () => {
    const collapsibleSections: DesktopNavPanelSection[] = [
      {
        key: 'coll2',
        title: 'Collapse Test',
        collapsible: true,
        defaultExpanded: true,
        items: [{ label: 'Collapsible Item', href: '/test/coll', icon: StubIcon }],
      },
    ];
    render(
      <DesktopNavPanel
        {...defaultProps}
        isOpen
        leftSections={collapsibleSections}
        rightSections={EMPTY_SECTIONS}
      />,
    );
    await waitFor(() => expect(screen.getByText('Collapsible Item')).toBeInTheDocument());
    const toggleBtn = screen.getByRole('button', { name: /collapse test/i });
    act(() => { fireEvent.click(toggleBtn); });
    await waitFor(() => {
      expect(screen.queryByText('Collapsible Item')).not.toBeInTheDocument();
    });
  });

  it('calls onOpenChange(false) when Escape is pressed inside the nav', async () => {
    const onOpenChange = vi.fn();
    render(
      <DesktopNavPanel
        {...defaultProps}
        isOpen
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() => expect(screen.getByText('Feed')).toBeInTheDocument());
    const nav = document.querySelector('nav[aria-label="Community navigation"]');
    expect(nav).not.toBeNull();
    fireEvent.keyDown(nav!, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
