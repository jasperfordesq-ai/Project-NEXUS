// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CreateOpportunityPage
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
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "volunteering.create_opportunity_title": "Post Volunteer Opportunity",
        "volunteering.create_opportunity_subtitle": "Create a new volunteering opportunity for your organisation",
        "volunteering.heading": "Volunteering",
        "volunteering.no_approved_orgs_title": "No Approved Organisation",
        "volunteering.no_approved_orgs_description": "You need an approved organisation to post volunteer opportunities.",
        "volunteering.register_org_link": "Register an Organisation",
        "volunteering.form_cancel": "Cancel",
        "volunteering.form_title_label": "Title",
        "volunteering.form_title_placeholder": "Opportunity title",
        "volunteering.form_desc_label": "Description",
        "volunteering.form_desc_placeholder": "Describe the opportunity and requirements",
        "volunteering.form_submit": "Publish Opportunity",
        "volunteering.form_submit_opportunity": "Publish Opportunity",
        "volunteering.form_location_label": "Location",
        "volunteering.form_skills_label": "Skills Required",
        "volunteering.form_capacity_label": "Capacity",
        "volunteering.form_start_date": "Start Date",
        "volunteering.form_end_date": "End Date",
        "volunteering.form_remote": "Remote / Online",
        "volunteering.form_category": "Category",
        "volunteering.form_org_label": "Organisation",
      };
      if (typeof fallback === "string") return translations[key] ?? translations[`volunteering.${key}`] ?? fallback;
      return translations[key] ?? translations[`volunteering.${key}`] ?? key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true, data: { id: 99 } }),
  },
}));

vi.mock("@/contexts", () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: "Test Tenant", slug: "test" },
    tenantPath: (p: string) => "/test" + p,
    hasFeature: vi.fn(() => true),
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
}));

vi.mock("@/hooks", () => ({
  usePageTitle: vi.fn(),
}));

// No '@/components/ui' barrel mock: CreateOpportunityPage imports every primitive
// by direct path (Autocomplete, Button, DatePicker, GlassCard, Input, ListBox,
// Switch, Textarea), so the barrel override never applied and the real components
// were already rendering. The real Input/Textarea/Button render here.

vi.mock("@/components/navigation", () => ({
  Breadcrumbs: ({ items }: { items: { label: string; href?: string }[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

vi.mock("@/components/feedback", () => ({
  LoadingScreen: ({ message }: { message: string }) => (
    <div data-testid="loading-screen">{message}</div>
  ),
}));

// 🔴 DIRECT path, not the '@/components/location' barrel: the page imports
// PlaceAutocompleteInput from '@/components/location/PlaceAutocompleteInput'
// (CreateOpportunityPage.tsx:34), and Vitest keys mocks per specifier — so the old
// barrel override was dead and the real component loaded, calling `useTenant` from
// '@/contexts/TenantContext' (PlaceAutocompleteInput.tsx:39) and throwing
// "useTenant must be used within a TenantProvider". A stub is still the right call
// here (rather than mocking TenantContext and rendering the real component): the
// real input drives Google Places / Nominatim network lookups this test has no
// business owning.
vi.mock("@/components/location/PlaceAutocompleteInput", () => ({
  PlaceAutocompleteInput: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="place-autocomplete"
    />
  ),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { CreateOpportunityPage } from "./CreateOpportunityPage";
import { api } from "@/lib/api";

const mockApprovedOrg = {
  id: 1,
  name: "Helping Hands",
  status: "approved",
  member_role: "owner",
};

describe("CreateOpportunityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading screen while organisations are being fetched", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<CreateOpportunityPage />);
    expect(screen.getByTestId("loading-screen")).toBeInTheDocument();
  });

  it("shows no-approved-orgs message when user has no approved organisations", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<CreateOpportunityPage />);
    await waitFor(() => {
      expect(screen.queryByTestId("loading-screen")).not.toBeInTheDocument();
    });
    expect(screen.getByText("No Approved Organisation")).toBeInTheDocument();
    expect(
      screen.getByText("You need an approved organisation to post volunteer opportunities."),
    ).toBeInTheDocument();
    // The real `Button as={Link}` renders a router <a>, so the CTA is role="link"
    // (only the dead uiMock stub produced a <button> carrying an href). Assert the
    // destination too, not merely that the control exists.
    expect(screen.getByRole("link", { name: /Register.*Organisation/i })).toHaveAttribute(
      "href",
      "/test/organisations/register",
    );
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/test/volunteering");
  });

  it("renders the form when user has an approved organisation", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockApprovedOrg] });
    render(<CreateOpportunityPage />);
    await waitFor(() => {
      expect(screen.queryByTestId("loading-screen")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("Post Volunteer Opportunity").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("Helping Hands")).toBeInTheDocument();
  });

  it("does not call POST when form is submitted with no title", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockApprovedOrg] });
    render(<CreateOpportunityPage />);
    await waitFor(() => {
      expect(screen.getAllByText("Post Volunteer Opportunity").length).toBeGreaterThan(0);
    });

    const submitBtn = screen.getByRole("button", { name: /Publish Opportunity|Submit|Save/i });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  it("calls POST with correct payload after valid form submission", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockApprovedOrg] });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 42 } });
    render(<CreateOpportunityPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Helping Hands")).toBeInTheDocument());

    // Target the real Input/Textarea by placeholder — the labels are floating and
    // several fields share label text shapes, so placeholder is the stable handle.
    fireEvent.change(screen.getByPlaceholderText("Opportunity title"), {
      target: { value: "Help at the food bank" },
    });
    fireEvent.change(screen.getByPlaceholderText("Describe the opportunity and requirements"), {
      target: { value: "Help sort donations and prepare food parcels for local families." },
    });

    // Submit the <form> directly (as Enter would) to exercise handleSubmit without
    // depending on the submit button's own click path.
    const submitBtn = screen.getByRole("button", { name: /Publish Opportunity|Submit|Save/i });
    const form = submitBtn.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/v2/volunteering/opportunities",
        expect.objectContaining({ organization_id: 1 }),
      );
    });
  });

  it("does not create the opportunity twice on a rapid double-submit", async () => {
    // Regression: the form submits on Enter (bypassing the disabled button) and had
    // no synchronous re-entry guard, so a double-Enter / fast double-click fired
    // api.post twice and created two opportunities. A submittingRef now blocks the
    // second in-flight submit.
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockApprovedOrg] });
    let posted = false;
    vi.mocked(api.post).mockImplementation(
      () => new Promise(() => { posted = true; }), // stays in flight
    );
    render(<CreateOpportunityPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Helping Hands")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Opportunity title"), {
      target: { value: "Help at the food bank" },
    });
    fireEvent.change(screen.getByPlaceholderText("Describe the opportunity and requirements"), {
      target: { value: "Help sort donations and prepare food parcels for local families." },
    });

    const form = (screen.getByRole("button", { name: /Publish Opportunity|Submit|Save/i }).closest("form")) as HTMLFormElement;
    // Two rapid submits straight at the form (as Enter would), bypassing the button.
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(posted).toBe(true); // sanity: the first submit actually fired
  });

  it("fetches organisations from the correct endpoint on mount", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<CreateOpportunityPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/v2/volunteering/my-organisations");
    });
  });
});
