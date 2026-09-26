// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@/test/test-utils';

vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }),
}));

import { HelpBody, helpBodyToPlainText, parseHelpBody } from './HelpBody';

const BODY = [
  'You send hours from your **Wallet**.',
  '',
  '## Before you start',
  '',
  '1. Open [your wallet](/wallet).',
  '2. Press **Send Credits**.',
  '3. Choose the member.',
  '',
  '- Hours never expire.',
  '- You can see every payment.',
  '',
  '> Check the amount before you press **Send**.',
  '',
  'Read [the rules](https://example.com) first.',
].join('\n');

describe('parseHelpBody', () => {
  it('groups lines into paragraphs, headings, steps, bullets and tips', () => {
    expect(parseHelpBody(BODY).map((block) => [block.kind, block.lines.length])).toEqual([
      ['text', 1],
      ['heading', 1],
      ['step', 3],
      ['bullet', 2],
      ['tip', 1],
      ['text', 1],
    ]);
  });

  it('treats a list written straight after a sentence as its own block', () => {
    expect(parseHelpBody('You can:\n- give\n- receive').map((b) => b.kind)).toEqual(['text', 'bullet']);
  });

  it('accepts Windows line endings', () => {
    expect(parseHelpBody('One\r\n\r\nTwo')).toHaveLength(2);
  });
});

describe('HelpBody', () => {
  it('renders steps as an ordered list and bullets as a list', () => {
    render(<HelpBody body={BODY} />);
    const lists = screen.getAllByRole('list');
    expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(3);
    expect(within(lists[1]).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Before you start' })).toBeInTheDocument();
  });

  it('links internal paths through the community path and bolds labels', () => {
    render(<HelpBody body={BODY} />);
    expect(screen.getByRole('link', { name: 'your wallet' })).toHaveAttribute('href', '/test/wallet');
    expect(screen.getByText('Send Credits').tagName).toBe('STRONG');
  });

  it('never renders an external link', () => {
    render(<HelpBody body={BODY} />);
    expect(screen.queryByRole('link', { name: 'the rules' })).not.toBeInTheDocument();
    expect(screen.getByText(/the rules/)).toBeInTheDocument();
  });

  it('shows tips as a note', () => {
    render(<HelpBody body={BODY} />);
    expect(screen.getByRole('note')).toHaveTextContent('Check the amount before you press Send.');
  });

  it('never interprets HTML in translated text', () => {
    render(<HelpBody body={'<img src=x onerror="alert(1)"> **safe**'} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img/)).toBeInTheDocument();
  });
});

describe('helpBodyToPlainText', () => {
  it('drops the formatting marks', () => {
    expect(helpBodyToPlainText('1. Open [your wallet](/wallet).\n2. Press **Send**.')).toBe('Open your wallet. Press Send.');
  });
});
