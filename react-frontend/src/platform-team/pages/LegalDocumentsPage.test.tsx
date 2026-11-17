// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'names' in options) return `${key}|${String(options.names)}`;
      if (options && 'asked' in options) return `${key}|${String(options.count)}/${String(options.asked)}`;
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      if (options && 'version' in options) return `${key}|${String(options.version)}|${String(options.date)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import {
  LegalDocumentsPage,
  type LegalDocument,
  type LegalDocuments,
  type LegalDocumentsRow,
} from './LegalDocumentsPage';

const doc = (over: Partial<LegalDocument>): LegalDocument => ({
  type: 'terms',
  exists: true,
  published: true,
  version_number: '2.1',
  published_at: '2026-10-01T09:00:00+00:00',
  requires_acceptance: true,
  members_asked: 40,
  members_not_accepted: 6,
  ...over,
});

const missing = (type: string): LegalDocument => ({
  type,
  exists: false,
  published: false,
  version_number: null,
  published_at: null,
  requires_acceptance: null,
  members_asked: null,
  members_not_accepted: null,
});

const row = (over: Partial<LegalDocumentsRow>): LegalDocumentsRow => ({
  id: 2,
  name: 'Alpha Timebank',
  slug: 'alpha',
  is_active: true,
  no_privacy_notice: false,
  documents: [
    doc({}),
    doc({ type: 'privacy', members_not_accepted: 10 }),
    doc({ type: 'cookies', requires_acceptance: false, members_asked: null, members_not_accepted: null }),
  ],
  ...over,
});

const reply = (over: Partial<LegalDocuments> = {}): LegalDocuments => ({
  unavailable: [],
  totals: { communities: 3, no_privacy_notice: 2 },
  communities: [
    row({}),
    row({
      id: 3,
      name: 'Beta Exchange',
      slug: 'beta',
      no_privacy_notice: true,
      documents: [doc({ members_asked: 12, members_not_accepted: 0 }), missing('privacy')],
    }),
    row({
      id: 4,
      name: 'Gamma Circle',
      slug: 'gamma',
      is_active: false,
      no_privacy_notice: true,
      documents: [
        doc({ published: false, version_number: null, published_at: null, members_asked: null, members_not_accepted: null }),
        missing('privacy'),
      ],
    }),
  ],
  ...over,
});

const card = (name: string): HTMLElement => {
  const list = screen.getByTestId('legal-documents-list');
  const found = within(list)
    .getAllByRole('listitem')
    .find((item) => item.querySelector('h2')?.textContent === name);
  if (!found) throw new Error(`no card for ${name}`);
  return found;
};

const docLine = (communityName: string, type: string): HTMLElement =>
  within(card(communityName)).getByTestId(`legal-document-${type}`);

describe('LegalDocumentsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: reply() });
  });

  it('asks the platform team request and draws a card per community', async () => {
    render(<LegalDocumentsPage />);

    const list = await screen.findByTestId('legal-documents-list');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/legal-documents');
    // One card per community (each card holds its own list of documents).
    expect(list.children).toHaveLength(3);
    expect(card('Gamma Circle')).toHaveTextContent('legal_documents.not_active');
  });

  it('names each document and says whether it is published, in words', async () => {
    render(<LegalDocumentsPage />);
    await screen.findByTestId('legal-documents-list');

    const terms = docLine('Alpha Timebank', 'terms');
    expect(terms).toHaveTextContent('legal_documents.type.terms');
    expect(terms).toHaveTextContent('legal_documents.status.published');
    expect(terms).toHaveTextContent('legal_documents.version|2.1|');
    expect(docLine('Alpha Timebank', 'cookies')).toHaveTextContent('legal_documents.type.cookies');
    expect(docLine('Beta Exchange', 'privacy')).toHaveTextContent('legal_documents.status.missing');
    expect(docLine('Gamma Circle', 'terms')).toHaveTextContent('legal_documents.status.not_published');
  });

  it('says beside Terms that they are added automatically', async () => {
    render(<LegalDocumentsPage />);
    await screen.findByTestId('legal-documents-list');

    expect(docLine('Alpha Timebank', 'terms')).toHaveTextContent('legal_documents.terms_seeded');
    expect(docLine('Alpha Timebank', 'privacy')).not.toHaveTextContent('legal_documents.terms_seeded');
  });

  it('says how many members have not accepted, only where members must accept', async () => {
    render(<LegalDocumentsPage />);
    await screen.findByTestId('legal-documents-list');

    expect(docLine('Alpha Timebank', 'terms')).toHaveTextContent('legal_documents.members_not_accepted|6/40');
    expect(docLine('Alpha Timebank', 'privacy')).toHaveTextContent('legal_documents.members_not_accepted|10/40');
    expect(docLine('Alpha Timebank', 'cookies')).toHaveTextContent('legal_documents.no_acceptance_needed');
    expect(docLine('Beta Exchange', 'terms')).toHaveTextContent('legal_documents.all_accepted|12');
    expect(docLine('Gamma Circle', 'terms')).not.toHaveTextContent('legal_documents.members_not_accepted');
  });

  // The count itself is written by the wording ({{count, number}}); the other
  // number in the sentence comes already written in the reader's style.
  it('writes the number of members asked with a thousands separator', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: reply({ communities: [row({ documents: [doc({ members_asked: 12345, members_not_accepted: 321 })] })] }),
    });
    render(<LegalDocumentsPage />);
    await screen.findByTestId('legal-documents-list');

    expect(docLine('Alpha Timebank', 'terms')).toHaveTextContent('legal_documents.members_not_accepted|321/12,345');
  });

  it('names the communities without a published privacy notice', async () => {
    render(<LegalDocumentsPage />);

    const summary = await screen.findByTestId('legal-documents-privacy');
    expect(summary).toHaveTextContent('legal_documents.no_privacy_count|2');
    expect(summary).toHaveTextContent('legal_documents.no_privacy_names|');
    expect(summary).toHaveTextContent('Beta Exchange');
    expect(summary).toHaveTextContent('Gamma Circle');
    expect(summary).not.toHaveTextContent('Alpha Timebank');
    expect(card('Beta Exchange')).toHaveTextContent('legal_documents.no_privacy_flag');
    expect(card('Alpha Timebank')).not.toHaveTextContent('legal_documents.no_privacy_flag');
  });

  it('says when every community has a privacy notice', async () => {
    const data = reply({ totals: { communities: 1, no_privacy_notice: 0 }, communities: [row({})] });
    apiGet.mockResolvedValue({ success: true, data });
    render(<LegalDocumentsPage />);

    expect(await screen.findByText('legal_documents.all_have_privacy')).toBeInTheDocument();
  });

  it('shows a figure that could not be read as not available, never as zero', async () => {
    const data = reply({ unavailable: ['members'] });
    data.communities = data.communities.map((c) => ({
      ...c,
      documents: (c.documents ?? []).map((d) =>
        d.published && d.requires_acceptance ? { ...d, members_asked: null, members_not_accepted: null } : d,
      ),
    }));
    apiGet.mockResolvedValue({ success: true, data });
    render(<LegalDocumentsPage />);

    expect(await screen.findByText('legal_documents.unavailable_note')).toBeInTheDocument();
    const terms = docLine('Alpha Timebank', 'terms');
    expect(terms).toHaveTextContent('legal_documents.members_not_available');
    expect(terms).not.toHaveTextContent('legal_documents.all_accepted');
  });

  it('shows documents that could not be read as not available', async () => {
    const data = reply({ unavailable: ['documents'], totals: { communities: 3, no_privacy_notice: null } });
    data.communities = data.communities.map((c) => ({ ...c, documents: null, no_privacy_notice: null }));
    apiGet.mockResolvedValue({ success: true, data });
    render(<LegalDocumentsPage />);

    await screen.findByTestId('legal-documents-list');
    expect(card('Alpha Timebank')).toHaveTextContent('legal_documents.not_available');
    expect(screen.getByTestId('legal-documents-privacy')).toHaveTextContent('legal_documents.privacy_unknown');
  });

  it('names no member: counts only', async () => {
    render(<LegalDocumentsPage />);
    await screen.findByTestId('legal-documents-list');

    expect(screen.getByText('legal_documents.counts_only')).toBeInTheDocument();
  });

  it('shows the error card when the reply cannot be loaded, and tries again', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<LegalDocumentsPage />);

    const retry = await screen.findByRole('button', { name: 'couldnt_load_retry' });
    expect(screen.queryByTestId('legal-documents-list')).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('legal-documents-list')).toBeInTheDocument();
  });

  it('shows the error card for a reply without a list', async () => {
    apiGet.mockResolvedValue({ success: true, data: { totals: {} } });
    render(<LegalDocumentsPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByTestId('legal-documents-list')).not.toBeInTheDocument();
    expect(screen.getByText('legal_documents.load_error_title')).toBeInTheDocument();
  });

  // The server keeps these figures for a short while. The first look uses the
  // kept ones; "Check again" asks for them to be worked out again.
  it('works the figures out again only when "Check again" is pressed, and says when they are from', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...reply(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<LegalDocumentsPage />);

    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/legal-documents');
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/legal-documents?refresh=1'));
  });

  it('says nothing about when the figures are from when the server does not say', async () => {
    render(<LegalDocumentsPage />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'home.refresh' });
    expect(screen.queryByText(/^shared\.figures_from/)).not.toBeInTheDocument();
  });

  it('keeps the figures on screen and says so when checking again is refused', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...reply(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<LegalDocumentsPage />);
    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();

    apiGet.mockResolvedValue({ success: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many requests' });
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));

    expect(await screen.findByText('translations.recount_refused')).toBeInTheDocument();
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument();
    expect(screen.getByText(/^shared\.figures_from/)).toBeInTheDocument();
  });
});
