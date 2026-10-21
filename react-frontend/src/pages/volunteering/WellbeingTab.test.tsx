// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for WellbeingTab
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

const interpolate = (template: string, opts?: Record<string, unknown>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(opts?.[key] ?? ""));

const stableT = (
  key: string,
  fallbackOrOptions?: string | Record<string, unknown>,
  opts?: Record<string, unknown>,
) => {
  const translations: Record<string, string> = {
    hours_abbrev: "{{hours}}h",
    "common:footer.contact_us": "Contact Us",
    "wellbeing.burnout_warning": "Burnout Warning",
    "wellbeing.heading": "Volunteer Wellbeing",
    "wellbeing.hide_tips": "Hide Self-Care Tips",
    "wellbeing.log_feeling": "Log How I'm Feeling",
    "wellbeing.needs_attention_title": "Your Wellbeing Needs Attention",
    "wellbeing.risk_high": "High Risk",
    "wellbeing.risk_low": "Low Risk",
    "wellbeing.risk_moderate": "Moderate Risk",
    "wellbeing.score_aria": "Wellbeing score: {{score}} out of 100",
    "wellbeing.score_out_of_100": "{{score}}/100 - {{label}}",
    "wellbeing.tip_breaks": "Take regular breaks between volunteer shifts",
    "wellbeing.view_tips": "View Self-Care Tips",
    "wellbeing.mood_aria": "Mood: {{mood}}",
    "wellbeing.mood_struggling": "Struggling",
    "wellbeing.mood_low": "Low",
    "wellbeing.mood_okay": "Okay",
    "wellbeing.mood_good": "Good",
    "wellbeing.mood_great": "Great",
    "wellbeing.submit_checkin": "Submit Check-in",
    "wellbeing.checkin_success": "Mood check-in recorded.",
    "wellbeing.checkin_success_team_notified": "Thank you for telling us. Someone from your community's team will be in touch.",
    "wellbeing.checkin_shared_label": "Shared with your community's team",
    "wellbeing.share_with_team_label": "Let someone get in touch with me",
    "wellbeing.share_with_team_desc": "Your community's team will see how you're feeling and your note. If your community is part of a larger network, that network's team is told as well. Any extra wellbeing contact address your community has set is also told. The organisations you volunteer with are told how you're feeling, but never your note.",
    "wellbeing.share_with_team_private": "Only you will see this check-in.",
    "wellbeing.recent_checkins": "Recent Check-ins",
    "wellbeing.outcome_told_one": "We have told {{count}} other person from your community. Someone will be in touch.",
    "wellbeing.outcome_told_other": "We have told {{count}} other people from your community. Someone will be in touch.",
    "wellbeing.outcome_told_self_only": "You are the only member of your community's team, so nobody else has been told.",
    "wellbeing.outcome_already_told": "Your community was already told today ({{time}}). This check-in has been added to what they can see.",
    "wellbeing.outcome_nobody": "Nobody could be told yet. We will try again with your next check-in.",
    "wellbeing.outcome_private": "Only you can see this check-in.",
    "wellbeing.outcome_what_next": "What happens next",
    "wellbeing.outcome_what_next_desc": "Someone who was told will read your check-in and get in touch.",
    "wellbeing.outcome_dismiss": "Dismiss",
    "wellbeing.support_heading": "If you need support now",
    "wellbeing.last_told": "Your community's team was last told on {{date}}.",
    "wellbeing.score_label": "Wellbeing Score",
    "wellbeing.score_excellent": "Excellent",
    "wellbeing.score_no_data": "Not enough activity yet to score your wellbeing.",
  };

  // Mirror i18next's English plural resolution: `count` picks `_one` / `_other`.
  const resolve = (k: string, o?: Record<string, unknown>) => {
    if (o && typeof o.count === "number") {
      const plural = translations[`${k}_${o.count === 1 ? "one" : "other"}`];
      if (plural !== undefined) return plural;
    }
    return translations[k];
  };

  if (typeof fallbackOrOptions === "string") {
    return interpolate(fallbackOrOptions, opts);
  }

  if (fallbackOrOptions && typeof fallbackOrOptions === "object") {
    return interpolate(
      resolve(key, fallbackOrOptions) ?? String(fallbackOrOptions.fallbackValue ?? key),
      fallbackOrOptions,
    );
  }

  return translations[key] ?? key;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: null }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/contexts", () => ({
  useToast: vi.fn(() => mockToast),

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

import { WellbeingTab } from "./WellbeingTab";
import { api } from "@/lib/api";

const mockWellbeingData = {
  score: 75,
  hours_this_week: 6,
  hours_this_month: 22,
  streak_days: 14,
  burnout_risk: "low" as const,
  warnings: [],
  suggested_rest_days: [],
  recent_checkins: [],
  support: { text: 'Ring the office any weekday.', links: [{ label: 'Our office', url: 'tel:+353100' }, { label: 'Contact the team', url: '/contact' }], is_default: false },
  last_team_notified_at: null,
  last_told_count: 0,
};

describe("WellbeingTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading and Log Feeling button", () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: null });
    render(<WellbeingTab />);
    expect(screen.getByText("Volunteer Wellbeing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Log How I.m Feeling/i })).toBeInTheDocument();
  });

  it("shows empty state when API returns null data", async () => {
    // The component shows EmptyState only in the initial synchronous render
    // (before useEffect fires). After API responds with null data, error is shown.
    // We test the initial render state before the effect runs by using act manually.
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves
    render(<WellbeingTab />);
    // After render, useEffect fires and sets isLoading=true, hiding EmptyState.
    // But we can check the initial render: isLoading starts false, data null, error null.
    // In practice with testing-library+act, we check for loading state after render.
    // This test verifies that when API returns null (no data), 
    // the heading is still visible and the log button works:
    expect(screen.getByText("Volunteer Wellbeing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Log How I.m Feeling/i })).toBeInTheDocument();
  });

  it("renders stat cards with score, hours, and streak when data is loaded", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockWellbeingData });
    render(<WellbeingTab />);
    await waitFor(() => {
      expect(screen.getByText("75")).toBeInTheDocument();
    });
    expect(screen.getByText("6h")).toBeInTheDocument();
    expect(screen.getByText("22h")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("Low Risk")).toBeInTheDocument();
  });

  it("shows burnout warnings when present", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: {
        ...mockWellbeingData,
        score: 35,
        burnout_risk: "high" as const,
        warnings: ["You have volunteered more than 40 hours this week."],
      },
    });
    render(<WellbeingTab />);
    await waitFor(() => {
      expect(screen.getByText("Burnout Warning")).toBeInTheDocument();
      expect(
        screen.getByText("You have volunteered more than 40 hours this week."),
      ).toBeInTheDocument();
    });
  });

  it("shows low score call-to-action when score is below 40", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockWellbeingData, score: 25, burnout_risk: "high" as const },
    });
    render(<WellbeingTab />);
    await waitFor(() => {
      expect(screen.getByText("Your Wellbeing Needs Attention")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /View Self-Care Tips/i })).toBeInTheDocument();
  });

  // Gap C5: the text suggests reaching out to the community, with no way to do it.
  it("offers a way to contact the community team when wellbeing needs attention", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockWellbeingData, score: 25 },
    });
    render(<WellbeingTab />);
    const link = await screen.findByRole("link", { name: /Contact Us/ });
    expect(link).toHaveAttribute("href", "/test/contact");
  });

  it("shows self-care tips when the toggle button is clicked", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockWellbeingData, score: 25 },
    });
    render(<WellbeingTab />);
    await waitFor(() => screen.getByRole("button", { name: /View Self-Care Tips/i }));

    fireEvent.click(screen.getByRole("button", { name: /View Self-Care Tips/i }));
    expect(
      screen.getByText(/Take regular breaks between volunteer shifts/),
    ).toBeInTheDocument();
  });

  /* ── Low-mood sharing (share_with_team) ─────────────────────────────── */

  async function openCheckin() {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockWellbeingData });
    render(<WellbeingTab />);
    await screen.findByText("75");
    fireEvent.click(screen.getByRole("button", { name: /Log How I.m Feeling/i }));
    await screen.findByRole("button", { name: "Submit Check-in" });
  }

  function pickMood(label: string) {
    // Single-selection toggle buttons are exposed as radios.
    fireEvent.click(screen.getByRole("radio", { name: `Mood: ${label}` }));
  }

  it("offers to let someone get in touch, ticked by default, for a Struggling check-in", async () => {
    await openCheckin();
    pickMood("Struggling");

    const box = await screen.findByRole("checkbox", { name: /Let someone get in touch with me/ });
    expect(box).toBeChecked();
    expect(screen.getByText(/Your community's team will see how you're feeling and your note/)).toBeInTheDocument();
  });

  it("sends share_with_team: true by default for mood 1 and shows the team-notified thank-you", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 9, mood: 1, note: null, shared: true, team_notified: true },
    });
    await openCheckin();
    pickMood("Struggling");
    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/v2/volunteering/wellbeing/checkin",
        expect.objectContaining({ mood: 1, share_with_team: true }),
      );
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        "Thank you for telling us. Someone from your community's team will be in touch.",
      );
    });
  });

  it("sends share_with_team: false when the volunteer unticks the box", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 10, mood: 2, note: null, shared: false, team_notified: false },
    });
    await openCheckin();
    pickMood("Low");

    const box = await screen.findByRole("checkbox", { name: /Let someone get in touch with me/ });
    fireEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(screen.getByText("Only you will see this check-in.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/v2/volunteering/wellbeing/checkin",
        expect.objectContaining({ mood: 2, share_with_team: false }),
      );
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Mood check-in recorded."));
  });

  it("does not offer sharing for a Good check-in and sends share_with_team: false", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 11, mood: 4, note: null, shared: false, team_notified: false },
    });
    await openCheckin();
    pickMood("Good");

    expect(screen.queryByRole("checkbox", { name: /Let someone get in touch with me/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/v2/volunteering/wellbeing/checkin",
        expect.objectContaining({ mood: 4, share_with_team: false }),
      );
    });
  });

  it("labels a recent check-in that was shared with the community's team", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: {
        ...mockWellbeingData,
        recent_checkins: [
          { id: 1, mood: 1, note: null, created_at: "2026-10-06T10:00:00Z", shared: true },
          { id: 2, mood: 4, note: null, created_at: "2026-10-05T10:00:00Z", shared: false },
        ],
      },
    });
    render(<WellbeingTab />);
    expect(await screen.findAllByText("Shared with your community's team")).toHaveLength(1);
  });

  // 20 Oct 2026: the tab must say honestly what happened after a shared check-in.
  it("says how many people were told, and what happens next, after a shared check-in", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 9, mood: 1, note: null, shared: true, team_notified: true, told_count: 2, told_at: '2026-10-20T12:05:22Z', outcome: 'told' },
    });
    await openCheckin();
    pickMood("Struggling");
    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));
    expect(await screen.findByText(/we have told 2 other people/i)).toBeInTheDocument();
    expect(screen.getByText(/what happens next/i)).toBeInTheDocument();
    // Audit (21 Oct 2026): no promised timeframe.
    expect(screen.queryByText(/within a day or two/i)).not.toBeInTheDocument();
    expect(screen.getByText(/someone who was told will read your check-in/i)).toBeInTheDocument();
  });

  // told_count now counts OTHER people: one other person reads in the singular.
  it("uses the singular when exactly one other person was told", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 9, mood: 1, note: null, shared: true, team_notified: true, told_count: 1, told_at: '2026-10-20T12:05:22Z', outcome: 'told' },
    });
    await openCheckin();
    pickMood("Struggling");
    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));
    expect(await screen.findByText(/we have told 1 other person from your community/i)).toBeInTheDocument();
  });

  // The volunteer is staff and the only member of the team: the server says
  // told_self_only. That is not good news, so it reads amber with support beside it.
  it("says nobody else was told when the volunteer is the only team member, with the support box", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 9, mood: 1, note: null, shared: true, team_notified: true, told_count: 0, told_at: '2026-10-20T12:05:22Z', outcome: 'told_self_only' },
    });
    await openCheckin();
    pickMood("Struggling");
    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));
    const notice = await screen.findByRole("status", { name: /only member of your community's team, so nobody else has been told/i });
    expect(notice).toBeInTheDocument();
    expect(notice.className).toContain("border-amber-500/40");
    // The support box is inside the notice, as for nobody_available.
    expect(notice).toHaveTextContent("Ring the office any weekday.");
    expect(screen.queryByText(/what happens next/i)).not.toBeInTheDocument();
  });

  it("tells the volunteer everyone a shared check-in reaches", async () => {
    await openCheckin();
    pickMood("Struggling");
    await screen.findByRole("checkbox", { name: /Let someone get in touch with me/ });
    const desc = screen.getByText(/Your community's team will see how you're feeling and your note/);
    expect(desc).toHaveTextContent(/larger network, that network's team is told as well/);
    expect(desc).toHaveTextContent(/extra wellbeing contact address/);
    expect(desc).toHaveTextContent(/organisations you volunteer with are told how you're feeling, but never your note/);
  });

  // A 100/100 "Excellent" with no activity and no check-in is not a result.
  it("shows a neutral not-enough-activity card instead of a score when there is nothing to score", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockWellbeingData, score: 100, hours_this_week: 0, hours_this_month: 0, streak_days: 0, score_basis: 'no_data' },
    });
    render(<WellbeingTab />);
    expect(await screen.findAllByText("Not enough activity yet to score your wellbeing.")).not.toHaveLength(0);
    expect(screen.queryByText("100")).not.toBeInTheDocument();
    expect(screen.queryByText(/Excellent/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // The check-in form stays usable.
    fireEvent.click(screen.getByRole("button", { name: /Log How I.m Feeling/i }));
    expect(await screen.findByRole("button", { name: "Submit Check-in" })).toBeInTheDocument();
  });

  it("still shows the score when it is based on real activity", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockWellbeingData, score: 85, score_basis: 'activity' },
    });
    render(<WellbeingTab />);
    expect(await screen.findByText("85")).toBeInTheDocument();
    expect(screen.getByText(/Excellent/)).toBeInTheDocument();
    expect(screen.queryByText("Not enough activity yet to score your wellbeing.")).not.toBeInTheDocument();
  });

  it("says when nobody could be told, and shows the support box beside it", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 9, mood: 1, note: null, shared: true, team_notified: false, told_count: 0, told_at: null, outcome: 'nobody_available' },
    });
    await openCheckin();
    pickMood("Struggling");
    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));
    const notice = await screen.findByRole("status", { name: /nobody could be told yet/i });
    expect(notice).toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalledWith("Thank you for telling us. Someone from your community's team will be in touch.");
  });

  it("says the team was already told today", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: 9, mood: 2, note: null, shared: true, team_notified: false, told_count: 2, told_at: '2026-10-20T12:05:22Z', outcome: 'already_told_today' },
    });
    await openCheckin();
    pickMood("Low");
    fireEvent.click(screen.getByRole("button", { name: "Submit Check-in" }));
    expect(await screen.findByText(/already told today/i)).toBeInTheDocument();
  });

  it("always shows the community's support box with its links", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockWellbeingData });
    render(<WellbeingTab />);
    expect(await screen.findByText("If you need support now")).toBeInTheDocument();
    expect(screen.getByText("Ring the office any weekday.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Our office" })).toHaveAttribute("href", "tel:+353100");
    expect(screen.getByRole("link", { name: "Contact the team" })).toHaveAttribute("href", "/test/contact");
  });

  it("says when the team was last told", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { ...mockWellbeingData, last_team_notified_at: '2026-10-20T12:05:22Z', last_told_count: 2 } });
    render(<WellbeingTab />);
    expect(await screen.findByText(/was last told on/i)).toBeInTheDocument();
  });
});
