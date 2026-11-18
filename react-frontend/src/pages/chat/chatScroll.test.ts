// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import {
  QUESTION_TOP_GAP_PX,
  answerScrollTarget,
  distanceFromBottom,
  maxScrollTop,
  scrollListTo,
  scrollToAnswer,
} from './chatScroll';
import { MIN_CHAT_HEIGHT_PX, bottomGapFor, fillHeight } from './useChatFillHeight';

const box = (scrollHeight: number, clientHeight: number, scrollTop = 0) => ({ scrollHeight, clientHeight, scrollTop });

describe('chat scrolling rules', () => {
  it('knows how far the list can scroll and how far from the end it is', () => {
    expect(maxScrollTop(box(1000, 400))).toBe(600);
    expect(maxScrollTop(box(300, 400))).toBe(0);
    expect(distanceFromBottom(box(1000, 400, 100))).toBe(500);
    expect(distanceFromBottom(box(1000, 400, 600))).toBe(0);
  });

  it('brings the question of a long answer to the top of the list', () => {
    // Question at 900px, long answer below it: the list can scroll to 1600.
    expect(answerScrollTarget(box(2000, 400), 900)).toBe(900 - QUESTION_TOP_GAP_PX);
  });

  it('rests at the bottom when the question and a short answer fit on screen', () => {
    // Question at 900px but only 200px of content below: max scroll is 700.
    expect(answerScrollTarget(box(1100, 400), 900)).toBe(700);
  });

  it('never asks for a negative position', () => {
    expect(answerScrollTarget(box(2000, 400), 4)).toBe(0);
  });

  it('scrolls the list element itself, never the window', () => {
    const list = document.createElement('div');
    const listScroll = vi.fn();
    list.scrollTo = listScroll as unknown as typeof list.scrollTo;
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;

    scrollListTo(list, 120);
    const question = document.createElement('div');
    list.appendChild(question);
    scrollToAnswer(list, question);

    expect(listScroll).toHaveBeenCalledTimes(2);
    expect(listScroll.mock.calls[0]?.[0]).toMatchObject({ top: 120 });
    expect(windowScroll).not.toHaveBeenCalled();
    expect(intoView).not.toHaveBeenCalled();
    windowScroll.mockRestore();
  });

  it('falls back to setting scrollTop where scrollTo is missing', () => {
    const list = document.createElement('div');
    Object.defineProperty(list, 'scrollTo', { value: undefined });
    scrollListTo(list, 75, false);
    expect(list.scrollTop).toBe(75);
  });
});

describe('chat fills the screen', () => {
  it('ends at the bottom of the screen, less a small gap', () => {
    // A computer: 860px screen, chat starting 200px down the page.
    expect(fillHeight(860, 1366, 200, 0)).toBe(860 - 200 - bottomGapFor(1366));
    // A phone: smaller gap.
    expect(bottomGapFor(390)).toBeLessThan(bottomGapFor(1366));
    expect(fillHeight(844, 390, 120, 0)).toBe(844 - 120 - bottomGapFor(390));
  });

  it('gives up the keyboard height on iOS', () => {
    expect(fillHeight(844, 390, 120, 300)).toBe(844 - 120 - bottomGapFor(390) - 300);
  });

  it('never gets too small to use', () => {
    expect(fillHeight(400, 390, 300, 200)).toBe(MIN_CHAT_HEIGHT_PX);
  });
});
