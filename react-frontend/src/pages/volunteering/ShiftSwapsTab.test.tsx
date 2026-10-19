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
        tab_applications: "My Applications",
        "swaps.received": "Received",
        "swaps.reject": "Reject",
        "swaps.sent": "Sent",
        "swaps.your_shift": "Your Shift",
        "swaps.their_shift": "Their Shift",
        "swaps.proposed_shift": "Proposed Shift",
        "swaps.shift_you_gave_up": "Shift You Gave Up",
        "swaps.shift_you_now_have": "Shift You Now Have",
        "swaps.to": "To:",
        "swaps.to_unnamed": "To: the volunteer on that shift (named once they agree)",
        "swaps.cancel": "Cancel",
        "swaps.accept_failed": "Failed to accept swap request.",
        "swaps.status_expired": "Expired",
        "swaps.status_admin_pending": "Pending Admin Review",
        load_more: "Load more",
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
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// One shared toast so a test can read what the tab told the member.
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/contexts", () => ({
  useToast: vi.fn(() => toastMock),

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

import { ShiftSwapsTab } from "./ShiftSwapsTab";
import { api } from "@/lib/api";

const makeSwap = (
  direction: "sent" | "received" = "received",
  status: "pending" | "accepted" | "rejected" | "admin_pending" | "admin_approved" | "expired" = "pending",
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

  // Gap C6: "open Applications and choose one of your confirmed shifts" — linked.
  it("links an empty swaps list to My Applications, where a swap is asked for", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<ShiftSwapsTab />);
    const link = await screen.findByRole("link", { name: /My Applications/ });
    expect(link).toHaveAttribute("href", "/test/volunteering?tab=applications");
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

  it("keeps the recipient anonymous on a sent request until they agree", async () => {
    const pending = { ...makeSwap("sent", "pending"), recipient: { id: null, name: null, avatar_url: null } };
    const accepted = { ...makeSwap("sent", "accepted"), id: 2 };
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { swaps: [pending, accepted] } });
    render(<ShiftSwapsTab />);

    await waitFor(() => screen.getByTestId("swap-recipient-1"));
    expect(screen.getByTestId("swap-recipient-1")).toHaveTextContent("To: the volunteer on that shift (named once they agree)");
    expect(screen.getByTestId("swap-recipient-2")).toHaveTextContent("To: Bob Lee");
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

  /*
    Found walking the swaps journey on 19 Oct 2026: the server lets a requester withdraw
    a request while an admin is still deciding on it (and the accessible site offered
    that), but this tab hid Cancel the moment the other volunteer agreed.
  */
  it("still offers Cancel on a sent request that is waiting for an admin", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [makeSwap("sent", "admin_pending")] });
    render(<ShiftSwapsTab />);

    const cancel = await screen.findByTestId("swap-cancel-1");
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/v2/volunteering/swaps/1");
    });
  });

  /*
    Once a swap has gone through, "Your shift" / "Their shift" describe the assignment
    BEFORE the swap: the shift under "Your shift" is the one the reader no longer has.
    Found walking the swaps journey on 19 Oct 2026. A completed card says which shift
    the reader gave up and which they now hold, whichever way the request went.
  */
  it("relabels both shifts once a swap has been accepted", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [makeSwap("sent", "accepted")] });
    render(<ShiftSwapsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("swap-own-label-1")).toHaveTextContent("Shift You Gave Up");
    });
    // The requester gave up `original_shift` and now holds `proposed_shift`.
    expect(screen.getByTestId("swap-own-title-1")).toHaveTextContent("Food Bank Shift A");
    expect(screen.getByTestId("swap-other-label-1")).toHaveTextContent("Shift You Now Have");
    expect(screen.getByTestId("swap-other-title-1")).toHaveTextContent("Food Bank Shift B");
    expect(screen.queryByText("Your Shift")).not.toBeInTheDocument();
  });

  it("relabels both shifts once an admin has approved a received swap", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [makeSwap("received", "admin_approved")] });
    render(<ShiftSwapsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("swap-own-label-1")).toHaveTextContent("Shift You Gave Up");
    });
    // The recipient gave up `proposed_shift` and now holds `original_shift`.
    expect(screen.getByTestId("swap-own-title-1")).toHaveTextContent("Food Bank Shift B");
    expect(screen.getByTestId("swap-other-label-1")).toHaveTextContent("Shift You Now Have");
    expect(screen.getByTestId("swap-other-title-1")).toHaveTextContent("Food Bank Shift A");
    expect(screen.queryByText("Their Shift")).not.toBeInTheDocument();
  });

  it("shows an expired request without any buttons", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [makeSwap("received", "expired")] });
    render(<ShiftSwapsTab />);

    await screen.findByText("Expired");
    expect(screen.queryByRole("button", { name: /Accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reject/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("swap-cancel-1")).not.toBeInTheDocument();
  });

  /*
    A refused Accept used to say only "Failed to accept swap request", whatever the
    server's reason (the shift has started, the other volunteer has left it, the request
    has expired). The reason is shown and the list reloaded, so the card tells the truth.
  */
  it("shows the server's reason when an accept is refused, then reloads the list", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [makeSwap("received", "pending")] })
      .mockResolvedValueOnce({ success: true, data: [makeSwap("received", "expired")] });
    vi.mocked(api.put).mockResolvedValue({
      success: false,
      errors: [{ code: "DECISION_CONFLICT", message: "This swap request has expired: a shift has started, or one of you is no longer on the shift it names." }],
    });
    render(<ShiftSwapsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /Accept/i }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("This swap request has expired"));
    });
    await screen.findByText("Expired");
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  /*
    The server pages twenty at a time and says in `meta` whether more exist; this tab read
    one page and stopped, so a member's older requests were unreachable.
  */
  it("loads the next page of requests on demand", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [makeSwap("sent", "accepted")], meta: { cursor: "MjA=", has_more: true, per_page: 20 } })
      .mockResolvedValueOnce({ success: true, data: [{ ...makeSwap("received", "rejected"), id: 2 }], meta: { cursor: null, has_more: false, per_page: 20 } });
    render(<ShiftSwapsTab />);

    const more = await screen.findByTestId("swaps-load-more");
    fireEvent.click(more);

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith("/v2/volunteering/swaps?cursor=MjA%3D");
    });
    await waitFor(() => {
      expect(screen.getAllByText("Food Bank Shift A")).toHaveLength(2);
    });
    expect(screen.queryByTestId("swaps-load-more")).not.toBeInTheDocument();
  });
});
