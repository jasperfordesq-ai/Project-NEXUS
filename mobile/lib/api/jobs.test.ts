// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `lib/api/jobs.ts` was the only one of 46 API modules with no test, and it is
 * one of the larger ones (473 lines, 31 exported calls).
 *
 * Two behaviours in it are worth pinning above the rest.
 *
 * 1. **Optional query parameters must be omitted, not sent empty.** Several
 *    listing calls build a query object conditionally. Sending `status=` or
 *    `cursor=undefined` changes what the API returns, and the mistake is
 *    invisible locally because Laravel tends to ignore a blank filter.
 *
 * 2. **The offer and interview calls swallow errors and return a boolean.**
 *    🔴 That is deliberate and it WORKS here, which is the opposite of the
 *    equivalent rule on the web side. `react-frontend`'s `api.ts` never throws,
 *    so a `catch` there is dead code — but `mobile/lib/api/client.ts` throws
 *    `ApiResponseError` on any non-2xx, network failure, timeout, or
 *    unrecoverable 401. So these catches genuinely convert a failure into
 *    `false`, and the tests below assert exactly that. Delete them and a
 *    member who failed to accept a job offer would be told it worked.
 */

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiResponseError';
    }
  },
  registerUnauthorizedCallback: jest.fn(),
}));

jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', TENANT_SLUG: 'tenant_slug' },
  TIMEOUTS: { API_REQUEST: 15_000, API_JOB_APPLY: 45_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api, ApiResponseError } from '@/lib/api/client';
import {
  acceptInterview,
  acceptOffer,
  applyToJob,
  createJob,
  createJobAlert,
  declineInterview,
  deleteJobAlert,
  generateJobDescription,
  getJobAlerts,
  getJobAnalytics,
  getJobApplicationHistory,
  getJobApplications,
  getJobDetail,
  getJobPredictions,
  getJobs,
  getMatchPercentage,
  getMyApplications,
  getMyInterviews,
  getMyOffers,
  getMyPostings,
  getRecommendedJobs,
  getSavedProfile,
  pauseJobAlert,
  rejectOffer,
  resumeJobAlert,
  saveJob,
  unsaveJob,
  updateJob,
  updateJobApplication,
  updateJobStatus,
  withdrawJobApplication,
} from './jobs';

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;
const mockPut = api.put as jest.Mock;
const mockDelete = api.delete as jest.Mock;

describe('jobs listing and detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: [] });
  });

  it('omits every optional filter when none is supplied', async () => {
    await getJobs({});

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs', {});
  });

  it('passes only the filters that were actually set', async () => {
    await getJobs({ search: 'garden', type: 'volunteer', commitment: 'weekly', cursor: 'c1' });

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs', {
      cursor: 'c1',
      search: 'garden',
      type: 'volunteer',
      commitment: 'weekly',
    });
  });

  it('drops a null cursor and an empty search rather than sending them blank', async () => {
    // `search=` is a different request from no search: it can turn a full listing
    // into an empty result set depending on how the filter is applied.
    await getJobs({ cursor: null, search: '', type: undefined });

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs', {});
  });

  it('requests a single vacancy by id', async () => {
    await getJobDetail(42);

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/42');
  });

  it('requests the recommendation feed on its own endpoint', async () => {
    await getRecommendedJobs();

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/recommended');
  });

  it('reads owner-only analytics and predictions from per-job endpoints', async () => {
    await getJobAnalytics(42);
    await getJobPredictions(42);

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/42/analytics');
    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/42/predictions');
  });

  it('reads the match percentage for a vacancy', async () => {
    await getMatchPercentage(42);

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/42/match');
  });
});

describe('job application lists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: [] });
  });

  it('sends no query at all when no cursor or status is given', async () => {
    // An empty `status=` is not the same request as no status.
    await getMyApplications({});

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/my-applications', {});
  });

  it('sends only the filters actually provided', async () => {
    await getMyApplications({ status: 'pending', cursor: 'abc' });

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/my-applications', {
      status: 'pending',
      cursor: 'abc',
    });
  });

  it('treats an explicitly null cursor as absent rather than sending "null"', async () => {
    await getMyApplications({ cursor: null });

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/my-applications', {});
  });

  it('lists the vacancies the member has posted from a separate endpoint', async () => {
    await getMyPostings({});

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/my-postings', {});
  });

  it('reads the applications for a vacancy the member owns', async () => {
    await getJobApplications(42);

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/42/applications');
  });

  it('reads one application history by APPLICATION id, not by job id', async () => {
    // The path lives under /jobs/applications/, so passing a job id here would
    // silently return another member's history or nothing at all.
    await getJobApplicationHistory(900);

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/applications/900/history');
  });
});

describe('acting on a vacancy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ success: true, message: 'ok' });
    mockPut.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue(undefined);
  });

  /**
   * 🔴 The timeout is load-bearing, not a tuning preference.
   *
   * The endpoint sends TWO emails inside the request — a confirmation to the applicant and
   * an alert to the employer — before it answers, and was measured at 9.5s against the
   * ordinary 15s mutation timeout on 2026-08-23. The application row is written in the
   * first second, so a timeout does not undo it: the member is told their application
   * failed while the employer already has it, and applying again is refused as a duplicate.
   */
  it('submits an application with the covering message and its own longer timeout', async () => {
    await applyToJob(42, 'I would like to help.');

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v2/jobs/42/apply',
      { message: 'I would like to help.' },
      { timeout: 45_000 },
    );
  });

  it('saves and unsaves through the same path with different verbs', async () => {
    await saveJob(42);
    await unsaveJob(42);

    expect(mockPost).toHaveBeenCalledWith('/api/v2/jobs/42/save');
    expect(mockDelete).toHaveBeenCalledWith('/api/v2/jobs/42/save');
  });

  it('creates and updates a vacancy on the collection and item paths', async () => {
    mockPost.mockResolvedValue({ data: { id: 1 } });

    await createJob({ title: 'Gardener' } as never);
    await updateJob(42, { title: 'Head Gardener' } as never);

    expect(mockPost).toHaveBeenCalledWith('/api/v2/jobs', { title: 'Gardener' });
    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/42', { title: 'Head Gardener' });
  });

  it('changes a vacancy status through a dedicated payload', async () => {
    await updateJobStatus(42, 'filled');

    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/42', { status: 'filled' });
  });

  it('withdraws an application by setting its status, not by deleting it', async () => {
    // A withdrawal has to stay on the record for the employer; a DELETE would
    // lose it.
    await withdrawJobApplication(900);

    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/applications/900', { status: 'withdrawn' });
  });

  it('updates an application with the employer decision payload', async () => {
    await updateJobApplication(900, { status: 'shortlisted' });

    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/applications/900', { status: 'shortlisted' });
  });

  it('asks the API to draft a description rather than composing one locally', async () => {
    mockPost.mockResolvedValue({ data: { description: 'draft' } });

    await generateJobDescription({ title: 'Gardener' } as never);

    expect(mockPost).toHaveBeenCalledWith('/api/v2/jobs/generate-description', { title: 'Gardener' });
  });
});

describe('job alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: [] });
    mockPost.mockResolvedValue({ data: { id: 1, message: 'created' } });
    mockPut.mockResolvedValue({ data: { message: 'ok' } });
    mockDelete.mockResolvedValue(undefined);
  });

  it('creates, lists and deletes an alert on the alerts endpoints', async () => {
    await getJobAlerts();
    await createJobAlert({ keywords: 'garden' } as never);
    await deleteJobAlert(5);

    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/alerts');
    expect(mockPost).toHaveBeenCalledWith('/api/v2/jobs/alerts', { keywords: 'garden' });
    expect(mockDelete).toHaveBeenCalledWith('/api/v2/jobs/alerts/5');
  });

  it('pauses and resumes via unsubscribe/resubscribe, NOT pause/resume', async () => {
    // 🔴 The function names and the endpoint names disagree: `pauseJobAlert` calls
    // `/unsubscribe` and `resumeJobAlert` calls `/resubscribe`. Written from the
    // function name alone you would reach for `/pause`, get a 404, and conclude
    // the feature was missing. Pinned here so a rename has to change both.
    await pauseJobAlert(5);
    await resumeJobAlert(5);

    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/alerts/5/unsubscribe');
    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/alerts/5/resubscribe');
  });
});

describe('interviews and offers — failures must not read as success', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the interview list, and an empty list when the payload is not an array', async () => {
    mockGet.mockResolvedValue({ data: [{ id: 1 }] });
    await expect(getMyInterviews()).resolves.toEqual([{ id: 1 }]);

    // A PHP empty collection can serialise as `{}` rather than `[]`; that must
    // degrade to "no interviews", not crash a `.map()` in the screen.
    mockGet.mockResolvedValue({ data: {} });
    await expect(getMyInterviews()).resolves.toEqual([]);

    mockGet.mockResolvedValue(null);
    await expect(getMyInterviews()).resolves.toEqual([]);
  });

  it('returns the offer list, and an empty list when the payload is not an array', async () => {
    mockGet.mockResolvedValue({ data: [{ id: 2 }] });
    await expect(getMyOffers()).resolves.toEqual([{ id: 2 }]);

    mockGet.mockResolvedValue({ data: 'unexpected' });
    await expect(getMyOffers()).resolves.toEqual([]);
  });

  it('reports true only when the accept actually succeeded', async () => {
    mockPut.mockResolvedValue(undefined);

    await expect(acceptInterview(11)).resolves.toBe(true);
    await expect(acceptOffer(22)).resolves.toBe(true);

    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/interviews/11/accept');
    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/offers/22/accept');
  });

  it('reports FALSE when the request fails, because the client throws', async () => {
    // This is the assertion that keeps the catch blocks honest. The mobile client
    // throws ApiResponseError on a non-2xx; if these functions ever stopped
    // catching it, an unhandled rejection would reach the screen — and if the
    // catch were removed in the belief it was dead code, a failed accept would
    // be reported to the member as done.
    mockPut.mockRejectedValue(new ApiResponseError(422, 'Offer already withdrawn'));

    await expect(acceptInterview(11)).resolves.toBe(false);
    await expect(declineInterview(11)).resolves.toBe(false);
    await expect(acceptOffer(22)).resolves.toBe(false);
    await expect(rejectOffer(22)).resolves.toBe(false);
  });

  it('declines and rejects on their own endpoints when they succeed', async () => {
    mockPut.mockResolvedValue(undefined);

    await expect(declineInterview(11)).resolves.toBe(true);
    await expect(rejectOffer(22)).resolves.toBe(true);

    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/interviews/11/decline');
    expect(mockPut).toHaveBeenCalledWith('/api/v2/jobs/offers/22/reject');
  });
});

describe('saved application profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the stored CV and covering text', async () => {
    mockGet.mockResolvedValue({ profile: { cv_filename: 'cv.pdf', cover_text: 'Hello' } });

    await expect(getSavedProfile()).resolves.toEqual({ cv_filename: 'cv.pdf', cover_text: 'Hello' });
    expect(mockGet).toHaveBeenCalledWith('/api/v2/jobs/saved-profile');
  });

  it('returns null when no profile has been saved', async () => {
    mockGet.mockResolvedValue({});

    await expect(getSavedProfile()).resolves.toBeNull();
  });

  it('returns null rather than throwing when the profile cannot be fetched', async () => {
    // A member with no saved profile and a member who is offline must both land
    // on the same empty form rather than an error screen.
    mockGet.mockRejectedValue(new ApiResponseError(500, 'Server error'));

    await expect(getSavedProfile()).resolves.toBeNull();
  });
});
