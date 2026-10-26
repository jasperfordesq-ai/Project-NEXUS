// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Clubs (Verein): a member's invitations and dues, and an organiser's dues
 * overview and member import (React `me/verein-invitations`, `me/verein-dues`,
 * `clubs/:id/admin/dues`, `clubs/:id/admin/import`).
 *
 * Paying dues by card (Stripe's hosted page, 26 Oct 2026) is pinned in
 * tests/card-payments-hosted-checkout.test.js. Here: the member sees what is owed,
 * and the old PaymentIntent endpoint (`/pay` on the API) is never called.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { routeGatesForPath } = require('../src/middleware/tenant-feature-gates');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class extends Error {},
    getMyVereinInvitations: jest.fn(),
    respondToVereinInvitation: jest.fn(),
    getMyVereinDues: jest.fn(),
    getVereinDuesFeeConfig: jest.fn(),
    setVereinDuesFeeConfig: jest.fn(),
    listVereinDues: jest.fn(),
    listVereinOverdueDues: jest.fn(),
    generateVereinDues: jest.fn(),
    remindVereinDues: jest.fn(),
    waiveVereinDues: jest.fn(),
    previewVereinMemberImport: jest.fn(),
    importVereinMembers: jest.fn()
  };
});

const api = require('../src/lib/api');
const vereinAdminRoutes = require('../src/routes/verein');
const vereinInvitationRoutes = require('../src/routes/verein-invitations');
const vereinMyDuesRoutes = require('../src/routes/verein-my-dues');
const { parseMultipartForm } = require('../src/middleware/multipart');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const invitesApp = () => createApp('/me/verein-invitations', [vereinInvitationRoutes]);
const duesApp = () => createApp('/me/verein-dues', [vereinMyDuesRoutes]);
const adminApp = () => createApp('/clubs', [vereinAdminRoutes], { before: [parseMultipartForm({ maxFileSize: 1024 * 1024 })] });

describe('club pages are gated like React', () => {
  it.each([
    '/me/verein-invitations', '/me/verein-dues', '/clubs/7/admin/dues', '/clubs/7/admin/import'
  ])('%s needs caring_community', (pathname) => {
    expect(routeGatesForPath(pathname).map((gate) => gate.featureKey)).toContain('caring_community');
  });

  it('leaves the public clubs directory ungated', () => {
    expect(routeGatesForPath('/clubs').map((gate) => gate.featureKey)).not.toContain('caring_community');
  });
});

describe('a member’s club invitations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists invitations and offers accept and decline only while pending', async () => {
    api.getMyVereinInvitations.mockResolvedValue({
      data: [
        { id: 3, status: 'sent', target_name: 'Choir', inviter_name: 'Alex', source_name: 'Band', message: 'Join us' },
        { id: 4, status: 'accepted', target_name: 'Chess Club' }
      ]
    });

    const res = await request(invitesApp()).get(`${PREFIX}/me/verein-invitations`);

    expect(res.text).toContain('Choir');
    expect(res.text).toContain('Join us');
    expect(res.text).toContain(`action="${PREFIX}/me/verein-invitations/3/respond"`);
    expect(res.text).not.toContain(`action="${PREFIX}/me/verein-invitations/4/respond"`);
  });

  it('accepts an invitation and says so', async () => {
    api.respondToVereinInvitation.mockResolvedValue({ data: { id: 3, status: 'accepted' } });
    const res = await request(invitesApp()).post(`${PREFIX}/me/verein-invitations/3/respond`).type('form').send({ action: 'accept' });
    expect(api.respondToVereinInvitation).toHaveBeenCalledWith('test-token', 3, 'accept');
    expect(res.headers.location).toBe(`${PREFIX}/me/verein-invitations?status=accepted`);
  });

  it('refuses an unknown answer before the API', async () => {
    const res = await request(invitesApp()).post(`${PREFIX}/me/verein-invitations/3/respond`).type('form').send({ action: 'delete' });
    expect(api.respondToVereinInvitation).not.toHaveBeenCalled();
    expect(res.headers.location).toBe(`${PREFIX}/me/verein-invitations?status=failed`);
  });
});

describe('a member’s dues', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows what is owed, with a Pay now button for the owed row', async () => {
    api.getMyVereinDues.mockResolvedValue({
      data: { items: [{ id: 8, organization_name: 'Choir', membership_year: 2026, amount_cents: 5000, currency: 'CHF', status: 'overdue', due_date: '2026-03-01' }] }
    });

    const res = await request(duesApp()).get(`${PREFIX}/me/verein-dues`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Choir');
    expect(res.text).toMatch(/CHF\s?50\.00/);
    expect(res.text).toContain(t('govuk_alpha_organisations.verein.dues.status.overdue'));
    expect(res.text).toContain('verein-payment-note');
    expect(res.text).toContain(`action="${PREFIX}/me/verein-dues/8/pay"`);
    expect(res.text).toContain(t('govuk_alpha_organisations.verein.dues.pay_now'));
    expect(res.text).not.toContain('payment_unavailable');
  });

  it('shows no payment note when nothing is owed', async () => {
    api.getMyVereinDues.mockResolvedValue({ data: { items: [{ id: 8, organization_name: 'Choir', membership_year: 2026, amount_cents: 5000, currency: 'CHF', status: 'paid', paid_at: '2026-02-01' }] } });
    const res = await request(duesApp()).get(`${PREFIX}/me/verein-dues`);
    expect(res.text).not.toContain('verein-payment-note');
  });
});

describe('an organiser’s dues overview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getVereinDuesFeeConfig.mockResolvedValue({ data: { fee_config: { fee_amount_cents: 6000, currency: 'EUR', billing_cycle: 'annual', grace_period_days: 30, late_fee_cents: null, is_active: true } } });
    api.listVereinDues.mockResolvedValue({ data: { items: [{ id: 11, first_name: 'Robin', last_name: 'Member', email: 'r@example.org', amount_cents: 6000, currency: 'EUR', status: 'pending', reminder_count: 1 }] } });
    api.listVereinOverdueDues.mockResolvedValue({ data: { items: [{ id: 12 }, { id: 13 }] } });
  });

  it('shows the members, the overdue count, fee settings and per-row actions', async () => {
    const res = await request(adminApp()).get(`${PREFIX}/clubs/7/admin/dues?year=2026`);

    expect(res.status).toBe(200);
    expect(api.listVereinDues).toHaveBeenCalledWith('test-token', 7, { year: '2026' });
    expect(res.text).toContain('Robin Member');
    expect(res.text).toContain(t('govuk_alpha_organisations.verein.dues.admin_overdue_count', { count: 2 }));
    expect(res.text).toContain(`action="${PREFIX}/clubs/7/admin/dues/11/remind"`);
    expect(res.text).toContain(`${PREFIX}/clubs/7/admin/dues/11/waive`);
    expect(res.text).toContain('value="60"');
  });

  it('refuses a member who does not run this club with a 403', async () => {
    api.getVereinDuesFeeConfig.mockRejectedValue(new api.ApiError('no', 403));
    const res = await request(adminApp()).get(`${PREFIX}/clubs/7/admin/dues`);
    expect(res.status).toBe(403);
  });

  it('saves the fee configuration in cents', async () => {
    api.setVereinDuesFeeConfig.mockResolvedValue({ data: {} });
    const res = await request(adminApp()).post(`${PREFIX}/clubs/7/admin/dues/fee-config`).type('form')
      .send({ fee_amount: '45.50', currency: 'CHF', billing_cycle: 'annual', grace_period_days: '14', late_fee: '', is_active: '1' });
    expect(api.setVereinDuesFeeConfig).toHaveBeenCalledWith('test-token', 7, {
      fee_amount_cents: 4550, currency: 'CHF', billing_cycle: 'annual', grace_period_days: 14, late_fee_cents: null, is_active: true
    });
    expect(res.headers.location).toBe(`${PREFIX}/clubs/7/admin/dues?status=config-saved`);
  });

  it('reminds every overdue member, best effort, and reports the count', async () => {
    api.remindVereinDues.mockResolvedValueOnce({}).mockRejectedValueOnce(new api.ApiError('x', 422));
    const res = await request(adminApp()).post(`${PREFIX}/clubs/7/admin/dues/remind-overdue`).type('form').send({});
    expect(api.remindVereinDues).toHaveBeenCalledTimes(2);
    expect(res.headers.location).toBe(`${PREFIX}/clubs/7/admin/dues?status=bulk-reminded&count=1`);
  });

  it('asks for a reason before waiving, then waives', async () => {
    const empty = await request(adminApp()).post(`${PREFIX}/clubs/7/admin/dues/11/waive`).type('form').send({ reason: ' ' });
    expect(api.waiveVereinDues).not.toHaveBeenCalled();
    expect(empty.headers.location).toBe(`${PREFIX}/clubs/7/admin/dues/11/waive?error=reason`);

    api.waiveVereinDues.mockResolvedValue({ data: { status: 'waived' } });
    const done = await request(adminApp()).post(`${PREFIX}/clubs/7/admin/dues/11/waive`).type('form').send({ reason: 'Hardship' });
    expect(api.waiveVereinDues).toHaveBeenCalledWith('test-token', 7, 11, 'Hardship');
    expect(done.headers.location).toBe(`${PREFIX}/clubs/7/admin/dues?status=waived`);
  });
});

describe('an organiser’s member import', () => {
  beforeEach(() => jest.clearAllMocks());
  const CSV = 'email,first_name,last_name,phone,role\nalice@example.org,Alice,Smith,,member\n';
  const preview = {
    organization: { id: 7, name: 'Choir' },
    summary: { total_rows: 1, ready_to_create: 1, ready_to_link: 0, duplicates: 0, invalid: 0 },
    items: [{ row: 2, email: 'alice@example.org', first_name: 'Alice', last_name: 'Smith', role: 'member', action: 'create', errors: [] }]
  };

  it('previews an uploaded CSV file (no JavaScript), then imports that same CSV once', async () => {
    api.previewVereinMemberImport.mockResolvedValue({ data: preview });
    api.importVereinMembers.mockResolvedValue({ data: { created: 1, linked: 0, skipped: 0, members: [{ email: 'alice@example.org', created: true, temporary_password: 'Tmp-123456' }] } });
    const file = path.join(os.tmpdir(), `verein-import-${process.pid}.csv`);
    fs.writeFileSync(file, CSV);
    const agent = request.agent(adminApp());

    const shown = await agent.post(`${PREFIX}/clubs/7/admin/import/preview`).attach('csv_file', file);
    fs.unlinkSync(file);
    expect(shown.status).toBe(200);
    expect(api.previewVereinMemberImport).toHaveBeenCalledWith('test-token', 7, CSV);
    expect(shown.text).toContain('alice@example.org');
    expect(shown.text).toContain(`action="${PREFIX}/clubs/7/admin/import"`);

    const imported = await agent.post(`${PREFIX}/clubs/7/admin/import`).type('form').send({});
    expect(api.importVereinMembers).toHaveBeenCalledWith('test-token', 7, CSV);
    expect(imported.text).toContain('Tmp-123456');
    expect(imported.headers['cache-control']).toBe('no-store');

    const again = await agent.post(`${PREFIX}/clubs/7/admin/import`).type('form').send({});
    expect(again.headers.location).toBe(`${PREFIX}/clubs/7/admin/import`);
    expect(api.importVereinMembers).toHaveBeenCalledTimes(1);
  });

  it('does not offer Import while any row is invalid', async () => {
    api.previewVereinMemberImport.mockResolvedValue({ data: { ...preview, summary: { ...preview.summary, invalid: 1 } } });
    const res = await request(adminApp()).post(`${PREFIX}/clubs/7/admin/import/preview`).type('form').send({ csv: CSV });
    expect(res.text).toContain(t('govuk_alpha_organisations.verein.import.errors.has_invalid_summary'));
    expect(res.text).not.toContain(`action="${PREFIX}/clubs/7/admin/import"`);
  });

  it('asks for a CSV when nothing was uploaded or pasted', async () => {
    const res = await request(adminApp()).post(`${PREFIX}/clubs/7/admin/import/preview`).type('form').send({ csv: '  ' });
    expect(res.status).toBe(422);
    expect(api.previewVereinMemberImport).not.toHaveBeenCalled();
  });
});
