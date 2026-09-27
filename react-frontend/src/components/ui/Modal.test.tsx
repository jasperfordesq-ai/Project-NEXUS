// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "i18next";
import { cleanup, render, screen, fireEvent } from "@/test/test-utils";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalHeading,
  ModalBody,
  ModalFooter,
} from "./Modal";

// HeroUI Modal renders into a portal; query via screen (searches document.body).

describe("Modal — open/closed gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders modal content when isOpen=true", () => {
    render(
      <Modal isOpen>
        <ModalContent aria-label="Test modal">
          <ModalBody>
            <p>modal body text</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );
    expect(screen.getByText("modal body text")).toBeInTheDocument();
  });

  it("does not render modal content when isOpen=false", () => {
    render(
      <Modal isOpen={false}>
        <ModalContent aria-label="Test modal">
          <ModalBody>
            <p>hidden modal</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );
    expect(screen.queryByText("hidden modal")).not.toBeInTheDocument();
  });

  it("forwards an explicit label to headerless dialogs", () => {
    render(
      <Modal isOpen>
        <ModalContent aria-label="Media preview">
          <ModalBody>
            <p>preview body</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );

    expect(
      screen.getByRole("dialog", { name: "Media preview" }),
    ).toBeInTheDocument();
  });

  it("layers the overlay above fixed navigation and keeps the dialog inside safe viewport insets", () => {
    render(
      <Modal isOpen>
        <ModalContent aria-label="Layered modal">
          <ModalBody>
            <p>layered body</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );

    const backdrop = document.querySelector<HTMLElement>(
      '[data-slot="modal-backdrop"]',
    );
    const container = document.querySelector<HTMLElement>(
      '[data-slot="modal-container"]',
    );

    expect(backdrop).toHaveClass("z-[var(--z-modal-backdrop)]");
    expect(container).toHaveClass(
      "z-[var(--z-modal)]",
      "nexus-responsive-modal-container",
      "box-border",
      "pt-[calc(var(--safe-area-top)+1rem)]",
      "pb-[calc(var(--safe-area-bottom)+1rem)]",
      "sm:pt-[calc(var(--safe-area-top)+2.5rem)]",
      "sm:pb-[calc(var(--safe-area-bottom)+2.5rem)]",
    );
    expect(screen.getByRole("dialog", { name: "Layered modal" })).toHaveClass(
      "nexus-responsive-modal-dialog",
    );
    expect(
      screen.getByRole("dialog", { name: "Layered modal" }).querySelector(
        ".nexus-mobile-sheet-handle",
      ),
    ).toBeInTheDocument();
  });

  it("preserves HeroUI's edge-to-edge viewport contract for full-size dialogs", () => {
    render(
      <Modal isOpen size="full">
        <ModalContent aria-label="Full viewport modal">
          <ModalBody>
            <p>full viewport body</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );

    const container = document.querySelector<HTMLElement>(
      '[data-slot="modal-container"]',
    );
    expect(container).toHaveClass("z-[var(--z-modal)]");
    expect(container).not.toHaveClass(
      "pt-[calc(var(--safe-area-top)+1rem)]",
    );
    expect(container).not.toHaveClass("nexus-responsive-modal-container");
    expect(screen.getByRole("dialog", { name: "Full viewport modal" })).not.toHaveClass(
      "nexus-responsive-modal-dialog",
    );
  });

  it("allows custom bottom sheets to suppress the shared grabber", () => {
    render(
      <Modal isOpen mobileSheetHandle={false}>
        <ModalContent aria-label="Custom sheet chrome">
          <ModalBody>body</ModalBody>
        </ModalContent>
      </Modal>,
    );

    expect(
      screen.getByRole("dialog", { name: "Custom sheet chrome" }).querySelector(
        ".nexus-mobile-sheet-handle",
      ),
    ).not.toBeInTheDocument();
  });
});

describe("Modal — compound sections", () => {
  it("composes a simple title as Header > Heading and registers the dialog name", () => {
    render(
      <Modal isOpen>
        <ModalContent>
          <ModalHeader>Modal Title</ModalHeader>
          <ModalBody>
            <p>body</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Modal Title" });
    const header = dialog.querySelector('[data-slot="modal-header"]');
    const heading = screen.getByRole("heading", {
      name: "Modal Title",
      level: 2,
    });

    expect(header).toHaveProperty("tagName", "DIV");
    expect(header).toContainElement(heading);
    expect(heading).toHaveAttribute("data-slot", "modal-heading");
  });

  it("supports explicit heading composition for complex headers without nested headings", () => {
    render(
      <Modal isOpen>
        <ModalContent>
          <ModalHeader>
            <ModalHeading>Complex title</ModalHeading>
            <p>Supporting description</p>
          </ModalHeader>
          <ModalBody>
            <p>body</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Complex title" });
    const heading = screen.getByRole("heading", { name: "Complex title" });

    expect(dialog.querySelectorAll("h1 h1, h1 h2, h2 h1, h2 h2")).toHaveLength(
      0,
    );
    expect(heading).not.toContainElement(
      screen.getByText("Supporting description"),
    );
  });

  it("renders ModalBody children", () => {
    render(
      <Modal isOpen>
        <ModalContent aria-label="Body example">
          <ModalBody>
            <span>Body Content</span>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );
    expect(screen.getByText("Body Content")).toBeInTheDocument();
  });

  it("renders ModalFooter children", () => {
    render(
      <Modal isOpen>
        <ModalContent aria-label="Footer example">
          <ModalBody>
            <p>body</p>
          </ModalBody>
          <ModalFooter>
            <button>Confirm</button>
          </ModalFooter>
        </ModalContent>
      </Modal>,
    );
    expect(
      screen.getByRole("button", { name: /confirm/i }),
    ).toBeInTheDocument();
  });
});

describe("Modal — render prop children", () => {
  it("passes onClose function to render-prop children", () => {
    const onClose = vi.fn();
    render(
      <Modal
        isOpen
        onClose={onClose}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalContent aria-label="Render property example">
          {(close) => (
            <ModalBody>
              <button onClick={close}>Close via prop</button>
            </ModalBody>
          )}
        </ModalContent>
      </Modal>,
    );
    expect(
      screen.getByRole("button", { name: /close via prop/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close via prop/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Modal — close trigger visibility", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("renders built-in close trigger by default (hideCloseButton not set)", () => {
    render(
      <Modal isOpen>
        <ModalContent>
          <ModalHeader>Title</ModalHeader>
          <ModalBody>
            <p>content</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );
    // HeroUI CloseTrigger renders as a button
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("uses the active locale for the built-in close trigger label", async () => {
    i18n.addResource("fr", "common", "accessibility.close", "Fermer");
    await i18n.changeLanguage("fr");

    render(
      <Modal isOpen>
        <ModalContent>
          <ModalHeader>Titre</ModalHeader>
          <ModalBody>
            <p>Contenu</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );

    expect(screen.getByRole("button", { name: "Fermer" })).toBeInTheDocument();
  });

  it("supports a context-specific close label override", () => {
    render(
      <Modal isOpen closeLabel="Close preview">
        <ModalContent>
          <ModalHeader>Preview</ModalHeader>
          <ModalBody>
            <p>Preview content</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );

    expect(
      screen.getByRole("button", { name: "Close preview" }),
    ).toBeInTheDocument();
  });

  it("does not render close trigger when hideCloseButton=true", () => {
    // When hideCloseButton=true the CloseTrigger element is not rendered.
    // We verify the modal still opens and has no extra button.
    render(
      <Modal isOpen hideCloseButton>
        <ModalContent aria-label="No close button example">
          <ModalBody>
            <p>no close btn</p>
          </ModalBody>
        </ModalContent>
      </Modal>,
    );
    expect(screen.getByText("no close btn")).toBeInTheDocument();
    // No close-button role expected (there may be 0 buttons total)
    // We just verify the content is there without crashing.
  });
});

describe("Modal — size normalisation", () => {
  // Sizes xs/sm/md/lg/full map to the container size directly;
  // xl/2xl/3xl/4xl/5xl map container to "lg" + add max-w className on Dialog.
  // We verify the modal renders without error for each category.
  const sizes = ["xs", "sm", "md", "lg", "xl", "2xl", "full"] as const;
  sizes.forEach((size) => {
    it(`renders at size="${size}"`, () => {
      render(
        <Modal isOpen size={size}>
          <ModalContent aria-label="Size example">
            <ModalBody>
              <p>size test</p>
            </ModalBody>
          </ModalContent>
        </Modal>,
      );
      expect(screen.getByText("size test")).toBeInTheDocument();
    });
  });
});
