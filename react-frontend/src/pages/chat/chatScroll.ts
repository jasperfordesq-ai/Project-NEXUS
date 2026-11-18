// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Scrolling rules for the AI Assistant conversation.
 *
 * 🔴 Only the conversation's own list may scroll. Never use `scrollIntoView`
 * here: it scrolls every scrollable ancestor, the page included. Until
 * 18 Nov 2026 the page called `scrollIntoView` on a marker after the last
 * message, which lined the END of the conversation up with the TOP of the
 * screen, so after every answer the page jumped down to the typing box and the
 * footer, and the answer itself was above the screen. The Messages thread hit
 * the same bug (see `ConversationPage.scrollToBottom`).
 */

/** Gap left above a question when it is brought to the top of the list. */
export const QUESTION_TOP_GAP_PX = 12;

/** How far from the bottom the reader can be and still count as "at the latest". */
export const NEAR_BOTTOM_PX = 120;

type ScrollBox = Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>;

/** The largest scrollTop the list can take. */
export function maxScrollTop(container: ScrollBox): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

/** Pixels between the visible part of the list and its end. */
export function distanceFromBottom(container: ScrollBox): number {
  return Math.max(0, maxScrollTop(container) - container.scrollTop);
}

/**
 * Where to scroll when an answer has arrived, so it is read from its first line.
 *
 * The question that produced it goes to the top of the list. When the question
 * and the answer fit on screen together, that position is past the end of the
 * list, so the clamp leaves the list resting at the bottom with the earlier
 * conversation visible above — no needless jump.
 *
 * @param questionOffsetTop the question's top edge measured from the top of the
 *   list's scrollable content (not from the screen).
 */
export function answerScrollTarget(container: ScrollBox, questionOffsetTop: number): number {
  const target = Math.max(0, questionOffsetTop - QUESTION_TOP_GAP_PX);
  return Math.min(target, maxScrollTop(container));
}

/**
 * Top edge of `element` inside `container`'s scrollable content, whatever
 * elements sit between them. Uses the on-screen boxes plus the list's current
 * scroll position, so it does not depend on `offsetParent`.
 */
export function offsetWithin(container: HTMLElement, element: HTMLElement): number {
  const containerTop = container.getBoundingClientRect().top;
  const elementTop = element.getBoundingClientRect().top;
  return elementTop - containerTop + container.scrollTop;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Scroll the list (only the list) to `top`. */
export function scrollListTo(container: HTMLElement, top: number, smooth = true): void {
  const behavior: ScrollBehavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top, behavior });
  } else {
    container.scrollTop = top;
  }
}

/** Scroll the list (only the list) to its end. */
export function scrollListToBottom(container: HTMLElement, smooth = true): void {
  scrollListTo(container, maxScrollTop(container), smooth);
}

/** Bring a question to the top of the list so the answer below it is read from the start. */
export function scrollToAnswer(container: HTMLElement, question: HTMLElement, smooth = true): void {
  scrollListTo(container, answerScrollTarget(container, offsetWithin(container, question)), smooth);
}
