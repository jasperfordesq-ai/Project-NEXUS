// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for RecommendedShiftsTab
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test/test-utils";
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

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: { shifts: [] } }),
  },
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

vi.mock("@/contexts", () => ({
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => `/hour-timebank${path}`,
  }),
}));

import { RecommendedShiftsTab } from "./RecommendedShiftsTab";
import { api } from "@/lib/api";

const mockRecommendedShift = {
  shift: {
    id: 5,
    start_time: "2026-03-20T09:00:00Z",
    end_time: "2026-03-20T13:00:00Z",
    capacity: 10,
    required_skills: ["Cooking", "Customer Service"],
  },
  opportunity: {
    id: 3,
    title: "Soup Kitchen Volunteer",
    location: "Galway",
    skills_needed: "Cooking, Customer Service",
  },
  organization: {
    name: "Community Kitchen",
    logo_url: null,
  },
  match_score: 82,
  match_reasons: ["Matches your Cooking skill", "Near your location"],
};

describe("RecommendedShiftsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { shifts: [] } });
    render(<RecommendedShiftsTab />);
    expect(screen.getByText("Recommended for You")).toBeInTheDocument();
  });

  it("shows empty state when there are no recommendations", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { shifts: [] } });
    render(<RecommendedShiftsTab />);
    await waitFor(() => {
      expect(screen.getByText("No recommendations yet")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Add skills to your profile to get personalized shift recommendations/),
    ).toBeInTheDocument();
  });

  it("renders shift cards with opportunity title, org name, and match score", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { shifts: [mockRecommendedShift] },
    });
    render(<RecommendedShiftsTab />);
    await waitFor(() => {
      expect(screen.getByText("Soup Kitchen Volunteer")).toBeInTheDocument();
    });
    expect(screen.getByText("Community Kitchen")).toBeInTheDocument();
    expect(screen.getByText(/82% match/)).toBeInTheDocument();
    expect(screen.getByText("Galway")).toBeInTheDocument();
  });

  it("renders match reasons as chips", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { shifts: [mockRecommendedShift] },
    });
    render(<RecommendedShiftsTab />);
    await waitFor(() => {
      expect(screen.getByText("Matches your Cooking skill")).toBeInTheDocument();
    });
    expect(screen.getByText("Near your location")).toBeInTheDocument();
  });

  it("fetches from the correct endpoint with limit parameter", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { shifts: [] } });
    render(<RecommendedShiftsTab />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/v2/volunteering/recommended-shifts?limit=10");
    });
  });

  it("shows error state when API fails", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });
    render(<RecommendedShiftsTab />);
    await waitFor(() => {
      expect(screen.getByText("Failed to load recommendations")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Try Again/i })).toBeInTheDocument();
  });
});
