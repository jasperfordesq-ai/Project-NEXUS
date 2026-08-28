// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoist mock data ───────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// ── Mock api ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── Contexts ──────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Member' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// No '@/components/seo/PageMeta' mock: MunicipalSurveyPage.tsx:24 imports PageMeta
// from the '@/components/seo' BARREL, which src/test/setup.ts already stubs
// globally — so a direct-path override here was dead weight.
//
// No '@/components/ui' barrel mock either. Every primitive this page uses is
// imported by direct path (Button, Checkbox, GlassCard, Radio, Spinner, Textarea —
// MunicipalSurveyPage.tsx:18-23), and Vitest keys mocks per specifier, so the old
// keyed `importOriginal`-spread factory overrode nothing: the real components were
// already rendering and its `data-testid="glass-card"` never existed in the DOM.
// The real GlassCard puts the CLASS `glass-card` on its root (GlassCard.tsx:47),
// which is what the retargeted assertions below look for when they need the card
// element at all.

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeSurvey = (overrides = {}) => ({
  id: 1,
  title: 'Community Feedback Survey',
  description: 'Please share your thoughts.',
  status: 'active' as const,
  is_anonymous: false,
  ends_at: null,
  response_count: 5,
  ...overrides,
});

const makeSurveyWithQuestions = (overrides = {}) => ({
  ...makeSurvey(),
  questions: [
    {
      id: 10,
      question_text: 'How satisfied are you?',
      question_type: 'single_choice' as const,
      options: JSON.stringify(['Very satisfied', 'Satisfied', 'Neutral']),
      is_required: 1,
      sort_order: 1,
    },
    {
      id: 11,
      question_text: 'Any other comments?',
      question_type: 'open_text' as const,
      options: null,
      is_required: 0,
      sort_order: 2,
    },
  ],
  ...overrides,
});

const listResponse = (surveys: ReturnType<typeof makeSurvey>[]) => ({
  success: true,
  data: surveys,
});

const detailResponse = (survey: ReturnType<typeof makeSurveyWithQuestions>) => ({
  success: true,
  data: survey,
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('MunicipalSurveyPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(listResponse([]));
  });

  it('shows loading spinner while surveys fetch', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no surveys', async () => {
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    // The empty card is a real GlassCard (class `glass-card`) carrying the
    // municipality_survey.json `empty` copy — assert the copy, not just a card.
    const empty = await screen.findByText('No surveys available at this time');
    expect(empty.closest('.glass-card')).not.toBeNull();
  });

  it('renders survey cards when surveys are returned', async () => {
    mockApi.get.mockResolvedValue(listResponse([makeSurvey()]));
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => {
      expect(screen.getByText('Community Feedback Survey')).toBeInTheDocument();
    });
  });

  it('renders survey description', async () => {
    mockApi.get.mockResolvedValue(listResponse([makeSurvey()]));
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => {
      expect(screen.getByText('Please share your thoughts.')).toBeInTheDocument();
    });
  });

  it('renders Take Survey button for authenticated users', async () => {
    mockApi.get.mockResolvedValue(listResponse([makeSurvey()]));
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    // municipality_survey.json take_survey = "Take survey" — one per survey card.
    const btn = await screen.findByRole('button', { name: 'Take survey' });
    expect(btn).toBeEnabled();
  });

  it('shows error alert when API fails', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'Server error' });
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  it('shows error alert when API throws', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  it('opens survey form when Take Survey is clicked', async () => {
    mockApi.get
      .mockResolvedValueOnce(listResponse([makeSurvey()]))
      .mockResolvedValue(detailResponse(makeSurveyWithQuestions()));

    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => screen.getByText('Community Feedback Survey'));

    fireEvent.click(screen.getByRole('button', { name: 'Take survey' }));

    await waitFor(() => {
      expect(screen.getByText('How satisfied are you?')).toBeInTheDocument();
    });
    // The list view is replaced by the form: its Submit/Back controls are present.
    expect(screen.getByRole('button', { name: 'Submit responses' })).toBeInTheDocument();
  });

  it('renders single_choice question with radio options in form', async () => {
    mockApi.get
      .mockResolvedValueOnce(listResponse([makeSurvey()]))
      .mockResolvedValue(detailResponse(makeSurveyWithQuestions()));

    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => screen.getByText('Community Feedback Survey'));

    fireEvent.click(screen.getByRole('button', { name: 'Take survey' }));

    await waitFor(() => {
      expect(screen.getByText('Very satisfied')).toBeInTheDocument();
    });
    expect(screen.getByText('Satisfied')).toBeInTheDocument();
    // The real HeroUI RadioGroup exposes role="radiogroup" with one role="radio"
    // per parsed option (['Very satisfied', 'Satisfied', 'Neutral']).
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual([
      'Very satisfied',
      'Satisfied',
      'Neutral',
    ]);
  });

  it('renders open_text question with textarea', async () => {
    mockApi.get
      .mockResolvedValueOnce(listResponse([makeSurvey()]))
      .mockResolvedValue(detailResponse(makeSurveyWithQuestions()));

    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => screen.getByText('Community Feedback Survey'));

    fireEvent.click(screen.getByRole('button', { name: 'Take survey' }));

    // The open_text question renders a real Textarea labelled by its question text.
    const textarea = await screen.findByRole('textbox', { name: 'Any other comments?' });
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('calls POST api when submit is clicked (with optional-only questions)', async () => {
    // Use a survey with only optional questions so validation passes without answering
    const surveyNoRequired = {
      ...makeSurveyWithQuestions(),
      questions: [
        {
          id: 11,
          question_text: 'Any other comments?',
          question_type: 'open_text' as const,
          options: null,
          is_required: 0,
          sort_order: 1,
        },
      ],
    };

    mockApi.get
      .mockResolvedValueOnce(listResponse([makeSurvey()]))
      .mockResolvedValueOnce(detailResponse(surveyNoRequired))
      .mockResolvedValue(listResponse([makeSurvey({ response_count: 6 })]));

    mockApi.post.mockResolvedValue({ success: true });

    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => screen.getByText('Community Feedback Survey'));

    fireEvent.click(screen.getByRole('button', { name: 'Take survey' }));

    await waitFor(() => screen.getByText('Any other comments?'));

    fireEvent.click(screen.getByRole('button', { name: 'Submit responses' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/caring-community/surveys/1/respond',
        expect.objectContaining({ answers: expect.any(Object) })
      );
    });
    // Validation passed, so no required-question error was raised.
    expect(screen.queryByText('Please answer all required questions.')).not.toBeInTheDocument();
  });

  it('does not call POST when required question is unanswered', async () => {
    mockApi.get
      .mockResolvedValueOnce(listResponse([makeSurvey()]))
      .mockResolvedValue(detailResponse(makeSurveyWithQuestions()));

    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => screen.getByText('Community Feedback Survey'));

    fireEvent.click(screen.getByRole('button', { name: 'Take survey' }));

    await waitFor(() => screen.getByText('How satisfied are you?'));

    // Click submit without answering the required single_choice question. Using
    // getByRole (not a `.find()` + `if (btn)`) matters: if the control were missing,
    // the old form silently clicked nothing and `not.toHaveBeenCalled()` passed.
    fireEvent.click(screen.getByRole('button', { name: 'Submit responses' }));

    // Validation fires synchronously — the error surfaces and api.post is not called.
    expect(screen.getByRole('alert')).toHaveTextContent('Please answer all required questions.');
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('shows already responded state when server returns already response', async () => {
    mockApi.get
      .mockResolvedValueOnce(listResponse([makeSurvey()]))
      .mockResolvedValue(detailResponse(makeSurveyWithQuestions({
        questions: [{
          id: 10,
          question_text: 'Any feedback?',
          question_type: 'open_text' as const,
          options: null,
          is_required: 0,
          sort_order: 1,
        }],
      })));

    mockApi.post.mockResolvedValue({ success: false, error: 'You have already responded' });

    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => screen.getByText('Community Feedback Survey'));

    fireEvent.click(screen.getByRole('button', { name: 'Take survey' }));

    await waitFor(() => screen.getByText('Any feedback?'));

    fireEvent.click(screen.getByRole('button', { name: 'Submit responses' }));

    // The already-responded card replaces the form: assert its own copy
    // (municipality_survey.json already_responded). A Back button alone proves
    // nothing — the form view has one too.
    expect(await screen.findByText('You have already participated in this survey.')).toBeInTheDocument();
    expect(screen.queryByText('Any feedback?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Surveys' })).toBeInTheDocument();
  });

  it('renders closes_on date when ends_at is set', async () => {
    mockApi.get.mockResolvedValue(
      listResponse([makeSurvey({ ends_at: '2025-12-31T00:00:00Z' })])
    );
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    // municipality_survey.json closes_on = "Closes: {{date}}", with the date run
    // through Intl.DateTimeFormat(…, { year, month: 'short', day }). The day can
    // shift by one depending on the runner's timezone, so match the shape and year
    // rather than pinning an exact day.
    // The day/month ORDER also depends on the community's region ("Dec 31, 2025"
    // for a US region, "31 Dec 2025" for an Irish/UK one), so accept either shape
    // rather than pinning a locale.
    const closes = await screen.findByText(
      /^Closes: (?:[A-Z][a-z]{2,4} \d{1,2}, 2025|\d{1,2} [A-Z][a-z]{2,4} 2025)$/
    );
    expect(closes.closest('.glass-card')).not.toBeNull();
    // Sanity: the surrounding card is the survey card, not some other card.
    expect(screen.getByText('Community Feedback Survey')).toBeInTheDocument();
  });

  it('omits the closes_on line when ends_at is null', async () => {
    mockApi.get.mockResolvedValue(listResponse([makeSurvey({ ends_at: null })]));
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    // Positive precondition first, so the absence assertion cannot pass vacuously.
    expect(await screen.findByText('Community Feedback Survey')).toBeInTheDocument();
    expect(screen.queryByText(/^Closes:/)).not.toBeInTheDocument();
  });

  it('handles wrapped data format (data.data)', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { data: [makeSurvey({ title: 'Wrapped Survey' })] },
    });
    const { default: MunicipalSurveyPage } = await import('./MunicipalSurveyPage');
    render(<MunicipalSurveyPage />);

    await waitFor(() => {
      expect(screen.getByText('Wrapped Survey')).toBeInTheDocument();
    });
  });
});
