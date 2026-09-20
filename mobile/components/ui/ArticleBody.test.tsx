// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ArticleBody from './ArticleBody';

const mockOpen = jest.fn();
jest.mock('./useOpenExternalUrl', () => ({ useOpenExternalUrl: () => mockOpen }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#333', info: '#06f', surface: '#eee' }) }));

describe('ArticleBody native rendering', () => {
  beforeEach(() => mockOpen.mockClear());
  it('keeps non-ASCII text and HTML entity decoding after dependency import narrowing', () => {
    const screen = render(<ArticleBody content={'<p>Gaeilge: cúnamh &euro; &copy; &#x1F600; &lt;care&gt;</p>'}
      contentType="html" baseUrl="https://example.test/" />);
    expect(screen.getByText('Gaeilge: cúnamh € © 😀 <care>')).toBeTruthy();
  });
  it('preserves headings, separate paragraphs, entities and relative links', () => {
    const screen = render(<ArticleBody content={'<h2>Getting started</h2><p>Time &amp; care</p><p>Second paragraph</p><a href="help">Read more</a>'}
      contentType="html" baseUrl="https://example.test/community/kb/7" />);
    expect(screen.getByText('Getting started')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Getting started' })).toBeTruthy();
    expect(screen.getByText('Time & care')).toBeTruthy();
    expect(screen.getByText('Second paragraph')).toBeTruthy();
    fireEvent.press(screen.getByText('Read more'));
    expect(screen.getByRole('link', { name: 'Read more' })).toBeTruthy();
    expect(mockOpen).toHaveBeenCalledWith('https://example.test/community/kb/help', { allowSchemes: ['mailto:', 'tel:'] });
  });
  it('renders Markdown structure and keeps plain text literal', () => {
    const screen = render(<ArticleBody content={'## Help\n\nFirst paragraph\n\n- Apples\n- Pears'} contentType="markdown" baseUrl="https://example.test/" />);
    expect(screen.getByText('Help')).toBeTruthy();
    expect(screen.getByText('Apples')).toBeTruthy();
    expect(screen.getByText('Pears')).toBeTruthy();
    screen.rerender(<ArticleBody content={'<p>Literal &amp;</p>\nNext line'} contentType="plain" baseUrl="https://example.test/" />);
    expect(screen.getByText('<p>Literal &amp;</p>\nNext line', { exact: true })).toBeTruthy();
  });
  it('omits executable and form elements from article presentation', () => {
    const screen = render(<ArticleBody content={'<p>Readable</p><script>Script body</script><style>Style body</style><iframe>Frame body</iframe><form>Form body</form>'}
      contentType="html" baseUrl="https://example.test/" />);
    expect(screen.getByText('Readable')).toBeTruthy();
    for (const text of ['Script body', 'Style body', 'Frame body', 'Form body']) expect(screen.queryByText(text)).toBeNull();
  });
});
