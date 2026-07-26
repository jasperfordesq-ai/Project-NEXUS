// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GroupSignUpTab
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
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("@/contexts", () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: "Test" },
    isAuthenticated: true,
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
}));

// GroupSignUpTab imports its Modal parts from '@/components/ui/Modal' and useDisclosure from
// '@/components/ui/useDisclosure', not through the barrel, so this factory was dead for both and
// the real HeroUI Modal plus the real useDisclosure were what rendered. The factory is a full
// replacement, so the same one is registered on every specifier the component imports; the extra
// exports a direct path does not use are harmless. useDisclosureStub below keeps real open/close
// state, so activating it preserves the flows these tests drive. Declared as a hoisted function so
// the vi.mock calls below can reference it.
function groupSignUpUiMock() {
  function useDisclosureStub(defaultOpen = false) {
    const [isOpen, setIsOpen] = React.useState(defaultOpen);
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false),
      onOpenChange: (open?: boolean) =>
        setIsOpen((prev) => (typeof open === "boolean" ? open : !prev)),
      onToggle: () => setIsOpen((prev) => !prev),
    };
  }

  const Box = ({ children, label, title, description }: Record<string, unknown>) => (
    <div>
      {label as React.ReactNode}
      {title as React.ReactNode}
      {description as React.ReactNode}
      {typeof children === "function" ? (children as (arg: unknown) => React.ReactNode)(vi.fn()) : children as React.ReactNode}
    </div>
  );
  const Button = ({ children, onPress, onClick, isDisabled, disabled }: Record<string, unknown>) => (
    <button type="button" disabled={Boolean(isDisabled ?? disabled)} onClick={(onPress ?? onClick) as (() => void) | undefined}>
      {children as React.ReactNode}
    </button>
  );
  const Input = ({ placeholder, value, onValueChange, onChange, label }: Record<string, unknown>) => (
    <label>
      {label as React.ReactNode}
      <input
        placeholder={placeholder as string | undefined}
        value={(value as string | undefined) ?? ""}
        onChange={(event) => {
          if (typeof onValueChange === "function") onValueChange(event.target.value);
          if (typeof onChange === "function") onChange(event);
        }}
      />
    </label>
  );
  const Select = ({ children, label }: Record<string, unknown>) => <label>{label as React.ReactNode}<select>{children as React.ReactNode}</select></label>;
  const SelectItem = ({ children }: { children?: React.ReactNode }) => <option>{children}</option>;
  const Modal = ({ isOpen, children }: Record<string, unknown>) => isOpen === false ? null : <div>{children as React.ReactNode}</div>;

  return {
    useDisclosure: useDisclosureStub,
    GlassCard: Box,
    Button,
    Chip: Box,
    Input,
    Select,
    SelectItem,
    Textarea: Input,
    Modal,
    ModalContent: Box,
    ModalHeader: Box,
    ModalBody: Box,
    ModalFooter: Box,
    Avatar: Box,
    AvatarGroup: Box,
    CardRowsSkeleton: () => <div role="status" />,
    // The real '@/components/ui/Skeletons' module (imported by the component)
    // re-imports Skeleton from this barrel, so the mock must provide it.
    Skeleton: () => <div role="status" />,
  };
}

vi.mock("@/components/ui", groupSignUpUiMock);
vi.mock("@/components/ui/Modal", groupSignUpUiMock);
vi.mock("@/components/ui/useDisclosure", groupSignUpUiMock);

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

import { GroupSignUpTab } from "./GroupSignUpTab";
import { api } from "@/lib/api";

const mockReservation = {
  id: 1,
  group_name: "The Green Team",
  status: "confirmed" as const,
  is_leader: true,
  shift: {
    id: 10,
    start_time: "2026-03-22T09:00:00Z",
    end_time: "2026-03-22T13:00:00Z",
  },
  opportunity: {
    id: 3,
    title: "Park Clean-up Day",
    location: "Phoenix Park",
  },
  organization: {
    id: 7,
    name: "Green Dublin",
    logo_url: null,
  },
  members: [
    { id: 1, name: "Alice Ryan", avatar_url: null, status: "confirmed" as const },
    { id: 2, name: "Bob Lee", avatar_url: null, status: "pending" as const },
  ],
  max_members: 10,
  created_at: "2026-03-01T10:00:00Z",
};

describe("GroupSignUpTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading", () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GroupSignUpTab />);
    expect(screen.getByText("Group Sign-ups")).toBeInTheDocument();
  });

  it("shows empty state when there are no group reservations", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GroupSignUpTab />);
    await waitFor(() => {
      expect(screen.getByText("No group sign-ups")).toBeInTheDocument();
    });
  });

  it("renders reservation card with group name, status, opportunity, and member list", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockReservation] });
    render(<GroupSignUpTab />);
    await waitFor(() => {
      expect(screen.getByText("The Green Team")).toBeInTheDocument();
    });
    expect(screen.getByText("Park Clean-up Day")).toBeInTheDocument();
    expect(screen.getByText("Green Dublin")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.getByText("Alice Ryan")).toBeInTheDocument();
    expect(screen.getByText("Bob Lee")).toBeInTheDocument();
  });

  it("shows Add Member button for leaders of non-cancelled reservations", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockReservation] });
    render(<GroupSignUpTab />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add Member/i })).toBeInTheDocument();
    });
  });

  it("opens Add Member modal when Add Member button is clicked", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockReservation] });
    render(<GroupSignUpTab />);
    await waitFor(() => screen.getAllByRole("button", { name: /Add Member/i }));

    // The generic Modal stub renders its content eagerly (it ignores isOpen),
    // so both the per-reservation trigger and the modal's submit button carry
    // the "Add Member" label. Click the first (the trigger) and assert the
    // modal content is present.
    fireEvent.click(screen.getAllByRole("button", { name: /Add Member/i })[0]);
    await waitFor(() => {
      expect(screen.getByText("Add Group Member")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Search members by name…")).toBeInTheDocument();
    });
  });

  it("adds the member selected from search suggestions by user id", async () => {
    // Real contract: /v2/users (member directory) returns id+name, never email.
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith("/v2/users")) {
        return { success: true, data: [{ id: 44, name: "Charlie Example" }] };
      }
      return { success: true, data: [mockReservation] };
    });

    render(<GroupSignUpTab />);
    await waitFor(() => screen.getAllByRole("button", { name: /Add Member/i }));

    // Click the trigger (first "Add Member" button — see note above re: the
    // eager Modal stub).
    fireEvent.click(screen.getAllByRole("button", { name: /Add Member/i })[0]);
    fireEvent.change(screen.getByPlaceholderText("Search members by name…"), {
      target: { value: "Charlie" },
    });

    // Debounced search fires, then the suggestion must be selected to enable Add
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/v2/users?q=Charlie&limit=5");
    });
    fireEvent.click(await screen.findByRole("button", { name: "Charlie Example" }));

    const addButtons = screen.getAllByRole("button", { name: /Add Member/i });
    fireEvent.click(addButtons[addButtons.length - 1]);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/v2/volunteering/group-reservations/1/members", { user_id: 44 });
    });
  });

  it("does not show Add Member button for non-leaders", async () => {
    const nonLeaderReservation = { ...mockReservation, is_leader: false };
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [nonLeaderReservation] });
    render(<GroupSignUpTab />);
    await waitFor(() => {
      expect(screen.getByText("The Green Team")).toBeInTheDocument();
    });
    // The eager Modal stub always renders its (disabled) "Add Member" submit
    // button, so we can't assert zero buttons. The per-reservation trigger is
    // the only ENABLED "Add Member" control, and it is gated on is_leader — so
    // for a non-leader there must be no enabled "Add Member" button.
    const enabledAddButtons = screen
      .queryAllByRole("button", { name: /Add Member/i })
      .filter((btn) => !(btn as HTMLButtonElement).disabled);
    expect(enabledAddButtons).toHaveLength(0);
  });
});
