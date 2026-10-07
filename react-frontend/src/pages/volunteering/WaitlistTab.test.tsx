// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for WaitlistTab
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@/test/test-utils";
import React from "react";
vi.mock("@/lib/motion", () => ({
  motion: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => {
      return ({ children, ref, ...props }: Record<string, unknown> & { ref?: React.Ref<HTMLElement> }) => {
        const motionPropNames = ["variants","initial","animate","exit","transition","whileHover","whileTap","whileInView","layout","layoutId","viewport"];
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          if (!motionPropNames.includes(k)) clean[k] = v;
        }
        const tag = typeof prop === "string" ? prop : "div";
        return React.createElement(tag, { ...clean, ref }, children);
      };
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  useAnimation: () => ({ start: () => Promise.resolve() }),
  useInView: () => true,
  useMotionValue: (initial: number) => ({ get: () => initial, set: () => {} }),
  useTransform: () => ({ get: () => 0 }),
  useSpring: () => ({ get: () => 0 }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "waitlist.heading": "My Waitlists",
        applications_empty_cta: "Browse opportunities",
        "waitlist.refresh": "Refresh",
        "waitlist.load_error": "Unable to load your waitlist entries. Please try again.",
        "waitlist.try_again": "Try again",
        "waitlist.no_entries_title": "No waitlist entries",
        "waitlist.no_entries_desc": "You are not currently waiting for any shifts.",
        "waitlist.position": "Position {{position}}",
        "waitlist.spots": "{{count}} spots",
        "waitlist.joined": "Joined",
        "waitlist.leave": "Leave",
        "waitlist.leave_confirm": "Are you sure you want to leave this waitlist?",
        cancel: "Cancel",
      };
      const template = translations[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(opts?.[k] ?? ""));
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("@/contexts", () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

// Extend the shared UI mock with a Modal/ModalContent that honours `isOpen`
// and the render-prop `children` API. The generic stub renders children
// eagerly and does NOT invoke function children, so the render-prop modal body
// (the leave-confirmation text + footer buttons) never appears under it. These
// targeted overrides model the real HeroUI behaviour so the confirmation flow
// can be exercised.
vi.mock("@/components/ui", async () => {
  const { uiMock } = await import("@/test/uiMock");
  return new Proxy(uiMock, {
    get(target, prop: string | symbol) {
      if (prop === "Modal") {
        return ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
          isOpen ? <div data-testid="modal">{children}</div> : null;
      }
      if (prop === "ModalContent") {
        return ({ children }: { children: React.ReactNode | ((onClose: () => void) => React.ReactNode) }) => (
          <div>{typeof children === "function" ? children(() => {}) : children}</div>
        );
      }
      return Reflect.get(target, prop);
    },
  });
});

vi.mock("@/components/feedback", () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action}
    </div>
  ),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { WaitlistTab } from "./WaitlistTab";
import { api } from "@/lib/api";

const mockEntry = {
  id: 1,
  position: 2,
  shift: {
    id: 10,
    start_time: "2026-03-15T10:00:00Z",
    end_time: "2026-03-15T14:00:00Z",
    capacity: 5,
  },
  opportunity: {
    id: 3,
    title: "Community Kitchen Helper",
    location: "Cork City",
  },
  organization: {
    id: 7,
    name: "Food For All",
    logo_url: null,
  },
  joined_at: "2026-03-08T09:00:00Z",
};

describe("WaitlistTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading", () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<WaitlistTab />);
    expect(screen.getByText("My Waitlists")).toBeInTheDocument();
  });

  // Gap C6: the empty state explains how to join a waitlist; it now links to where.
  it("links an empty waitlist to the opportunities", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<WaitlistTab />);
    const link = await screen.findByRole("link", { name: /Browse opportunities/ });
    expect(link).toHaveAttribute("href", "/test/volunteering");
  });

  it("shows empty state when there are no waitlist entries", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<WaitlistTab />);
    await waitFor(() => {
      expect(screen.getByText("No waitlist entries")).toBeInTheDocument();
    });
  });

  it("renders waitlist entry card with opportunity title, org name, and position chip", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockEntry] });
    render(<WaitlistTab />);
    await waitFor(() => {
      expect(screen.getByText("Community Kitchen Helper")).toBeInTheDocument();
    });
    expect(screen.getByText("Food For All")).toBeInTheDocument();
    expect(screen.getByText("Position 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave/i })).toBeInTheDocument();
  });

  it("opens confirmation modal when Leave button is pressed", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockEntry] });
    render(<WaitlistTab />);
    await waitFor(() => screen.getByRole("button", { name: /Leave/i }));

    fireEvent.click(screen.getByRole("button", { name: /Leave/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Are you sure you want to leave this waitlist/),
      ).toBeInTheDocument();
    });
  });

  it("calls DELETE endpoint when leave is confirmed", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockEntry] });
    vi.mocked(api.delete).mockResolvedValue({ success: true });
    render(<WaitlistTab />);
    await waitFor(() => screen.getByRole("button", { name: /Leave/i }));

    // Open the confirmation modal
    fireEvent.click(screen.getByRole("button", { name: /Leave/i }));
    await waitFor(() => screen.getByText(/Are you sure you want to leave this waitlist/));

    // Confirm via the danger Leave button in the modal footer
    const leaveButtons = screen.getAllByRole("button", { name: /Leave/i });
    fireEvent.click(leaveButtons[leaveButtons.length - 1]);
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/v2/volunteering/shifts/10/waitlist");
    });
  });

  it("shows error state when API fails", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });
    render(<WaitlistTab />);
    await waitFor(() => {
      expect(
        screen.getByText("Unable to load your waitlist entries. Please try again."),
      ).toBeInTheDocument();
    });
  });
});
