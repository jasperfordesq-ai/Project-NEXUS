// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ShiftSwapsTab
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
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, _opts?: object) => {
      const translations: Record<string, string> = {
        "swaps.accept": "Accept",
        "swaps.all": "All",
        "swaps.heading": "Shift Swaps",
        "swaps.no_swaps_title": "No swap requests",
        "swaps.received": "Received",
        "swaps.reject": "Reject",
        "swaps.sent": "Sent",
        "swaps.your_shift": "Your Shift",
        "swaps.their_shift": "Their Shift",
        "swaps.proposed_shift": "Proposed Shift",
      };
      if (typeof fallbackOrOptions === "string") return fallbackOrOptions;
      return translations[key] ?? key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: { swaps: [] } }),
    put: vi.fn().mockResolvedValue({ success: true }),
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

vi.mock("@/components/ui", async () => (await import("@/test/uiMock")).uiMock);

vi.mock("@/components/feedback", () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { ShiftSwapsTab } from "./ShiftSwapsTab";
import { api } from "@/lib/api";

const makeSwap = (
  direction: "sent" | "received" = "received",
  status: "pending" | "accepted" | "rejected" = "pending",
) => ({
  id: 1,
  status,
  direction,
  requester: { id: 2, name: "Alice Ryan", avatar_url: null },
  recipient: { id: 3, name: "Bob Lee", avatar_url: null },
  original_shift: {
    id: 10,
    start_time: "2026-03-15T10:00:00Z",
    end_time: "2026-03-15T14:00:00Z",
    opportunity_title: "Food Bank Shift A",
    organization_name: "Food For All",
  },
  proposed_shift: {
    id: 11,
    start_time: "2026-03-16T10:00:00Z",
    end_time: "2026-03-16T14:00:00Z",
    opportunity_title: "Food Bank Shift B",
    organization_name: "Food For All",
  },
  message: "Can we swap please?",
  created_at: "2026-03-08T08:00:00Z",
});

describe("ShiftSwapsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading and view filter buttons", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { swaps: [] } });
    render(<ShiftSwapsTab />);
    expect(screen.getByText("Shift Swaps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sent \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Received \(0\)/i })).toBeInTheDocument();
  });

  it("shows empty state when there are no swaps", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { swaps: [] } });
    render(<ShiftSwapsTab />);
    await waitFor(() => {
      expect(screen.getByText("No swap requests")).toBeInTheDocument();
    });
  });

  it("renders a received pending swap with accept and reject buttons", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { swaps: [makeSwap("received", "pending")] },
    });
    render(<ShiftSwapsTab />);
    await waitFor(() => {
      expect(screen.getByText("Food Bank Shift A")).toBeInTheDocument();
    });
    expect(screen.getByText("Food Bank Shift B")).toBeInTheDocument();
    expect(screen.getByText(/Can we swap please/, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject/i })).toBeInTheDocument();
  });

  it("hides accept/reject buttons for sent swaps", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { swaps: [makeSwap("sent", "pending")] },
    });
    render(<ShiftSwapsTab />);
    await waitFor(() => {
      expect(screen.getByText("Food Bank Shift A")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reject/i })).not.toBeInTheDocument();
  });

  it("calls PUT with accept action when Accept is clicked", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { swaps: [makeSwap("received", "pending")] },
    });
    vi.mocked(api.put).mockResolvedValue({ success: true });
    render(<ShiftSwapsTab />);
    await waitFor(() => screen.getByRole("button", { name: /Accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /Accept/i }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/v2/volunteering/swaps/1", { action: "accept" });
    });
  });

  it("filters to only sent swaps when Sent filter is clicked", async () => {
    const sentSwap = makeSwap("sent", "accepted");
    const receivedSwap = { ...makeSwap("received", "pending"), id: 2 };
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { swaps: [sentSwap, receivedSwap] },
    });
    render(<ShiftSwapsTab />);
    await waitFor(() => {
      // Both swaps visible initially
      expect(screen.getAllByText("Food Bank Shift A")).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: /Sent \(1\)/i }));
    expect(screen.getAllByText("Food Bank Shift A")).toHaveLength(1);
  });
  /**
   * The payload is requester-relative: `original_shift` is always the requester's own
   * shift, `proposed_shift` always the one they are asking for. This card labelled
   * `original_shift` "Your Shift" unconditionally, so on a RECEIVED request — the only
   * kind carrying Accept and Reject — it named the other person's shift as the reader's
   * own and their own as the proposal. Found by walking the mobile app on 2026-08-23,
   * which had the identical fault.
   */
  it("names the recipient's own shift under Your Shift on a received swap", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { swaps: [makeSwap("received", "pending")] },
    });
    render(<ShiftSwapsTab />);

    await waitFor(() => {
      // Received: the reader is the recipient, so their shift is `proposed_shift`.
      expect(screen.getByTestId("swap-own-title-1")).toHaveTextContent("Food Bank Shift B");
    });
    expect(screen.getByTestId("swap-other-title-1")).toHaveTextContent("Food Bank Shift A");
    expect(screen.getByTestId("swap-other-label-1")).toHaveTextContent("Their Shift");
  });

  it("names the requester's own shift under Your Shift on a sent swap", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { swaps: [makeSwap("sent", "pending")] },
    });
    render(<ShiftSwapsTab />);

    await waitFor(() => {
      // Sent: the reader is the requester, so their shift is `original_shift`.
      expect(screen.getByTestId("swap-own-title-1")).toHaveTextContent("Food Bank Shift A");
    });
    expect(screen.getByTestId("swap-other-title-1")).toHaveTextContent("Food Bank Shift B");
    expect(screen.getByTestId("swap-other-label-1")).toHaveTextContent("Proposed Shift");
  });
});
