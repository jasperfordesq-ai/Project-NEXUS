// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for EmergencyAlertsTab
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

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    put: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("@/components/ui", async () => (await import("@/test/uiMock")).uiMock);

vi.mock("@/components/feedback", () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => {
    return React.createElement(
      "div", { "data-testid": "empty-state" },
      React.createElement("div", null, title),
      description ? React.createElement("div", null, description) : null,
    );
  },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { EmergencyAlertsTab } from "./EmergencyAlertsTab";
import { api } from "@/lib/api";

const makeAlert = (overrides = {}) => ({
  id: 1,
  priority: "urgent" as const,
  message: "We urgently need a volunteer for this shift.",
  my_response: "pending" as const,
  required_skills: ["First Aid", "Driving"],
  shift: {
    id: 10,
    start_time: "2026-03-10T09:00:00Z",
    end_time: "2026-03-10T13:00:00Z",
  },
  opportunity: { title: "Food Bank Morning", location: "Dublin City" },
  organization: { name: "Helping Hands" },
  coordinator: { name: "Jane Smith" },
  expires_at: "2026-03-09T23:59:00Z",
  created_at: "2026-03-08T08:00:00Z",
  ...overrides,
});

describe("EmergencyAlertsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves the title to the page's section header", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<EmergencyAlertsTab />);
    expect(screen.queryByText("Emergency Alerts")).not.toBeInTheDocument();
  });

  it("shows empty state when there are no alerts", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<EmergencyAlertsTab />);
    await waitFor(() => {
      expect(screen.getByText("No emergency alerts")).toBeInTheDocument();
    });
  });

  it("renders alert card with opportunity title, priority chip, and accept/decline buttons", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { alerts: [makeAlert()] },
    });
    render(<EmergencyAlertsTab />);
    await waitFor(() => {
      expect(screen.getByText("Food Bank Morning")).toBeInTheDocument();
    });
    expect(screen.getByText("URGENT")).toBeInTheDocument();
    expect(screen.getByText("We urgently need a volunteer for this shift.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Decline/i })).toBeInTheDocument();
  });

  it("shows Accepted chip and hides action buttons when already responded", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { alerts: [makeAlert({ my_response: "accepted" })] },
    });
    render(<EmergencyAlertsTab />);
    await waitFor(() => {
      expect(screen.getByText("Accepted")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Decline/i })).not.toBeInTheDocument();
  });

  it("calls PUT endpoint when Accept button is pressed", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { alerts: [makeAlert()] },
    });
    vi.mocked(api.put).mockResolvedValue({ success: true });
    render(<EmergencyAlertsTab />);
    await waitFor(() => screen.getByRole("button", { name: /Accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /Accept/i }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        "/v2/volunteering/emergency-alerts/1",
        { response: "accepted" },
      );
    });
  });

  it("shows error state and Try Again button when API fails", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });
    render(<EmergencyAlertsTab />);
    await waitFor(() => {
      expect(screen.getByText("Failed to load alerts")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Try Again/i })).toBeInTheDocument();
  });
});
