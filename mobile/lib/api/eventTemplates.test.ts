// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/react-native';
import { api } from '@/lib/api/client';
import {
  captureEventTemplate,
  getEventTemplateHistory,
  getEventTemplates,
  materializeEventTemplate,
  previewEventTemplateCapture,
} from './eventTemplates';

function templateFixture() {
  return {
    id: 4,
    status: 'active',
    current_version: 1,
    source_event: { id: 9, title: 'Source event' },
    version: {
      number: 1,
      configuration: {
        title: 'Reusable event',
        description: 'Reusable description',
        location: 'Community hall',
        max_attendees: 30,
        timezone: 'UTC',
        all_day: false,
        is_online: false,
        allow_remote_attendance: false,
      },
      snapshot: { immutable: true },
      copied_fields: ['title'],
      skipped_fields: ['related.registrations'],
    },
    usage: { materialization_count: 2, audit_entry_count: 3 },
    capabilities: { materialize: true, view_audit: true },
  };
}

function capturePreviewFixture() {
  return {
    kind: 'capture',
    schema_version: 1,
    source_event_id: 9,
    source_lifecycle_version: 3,
    source_calendar_sequence: 0,
    configuration: templateFixture().version.configuration,
    snapshot_hash: 'a1b2c3',
    copied_fields: ['title', 'description', 'timezone'],
    skipped_fields: ['start_time', 'related.registrations'],
    checklist: [
      { code: 'event_template_check_source_manage', passed: true },
      { code: 'event_template_check_allowlist_exact', passed: true },
    ],
  };
}

describe('mobile event templates API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads only active templates through a cursor-safe envelope', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [templateFixture()],
      meta: { per_page: 20, next_cursor: null, has_more: false },
    });

    const response = await getEventTemplates();

    expect(response.data[0]?.version.snapshot.immutable).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/api/v2/event-templates', {
      status: 'active',
      per_page: '20',
    });
  });

  it('requests the next opaque template cursor without reinterpreting it', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [templateFixture()],
      meta: { per_page: 20, next_cursor: null, has_more: false },
    });

    await getEventTemplates('opaque-template-cursor');

    expect(api.get).toHaveBeenCalledWith('/api/v2/event-templates', {
      status: 'active',
      per_page: '20',
      cursor: 'opaque-template-cursor',
    });
  });

  it('loads privacy-filtered immutable template history through an opaque cursor', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{
        id: 18,
        action: 'materialized',
        template_version: 1,
        source_event_id: 9,
        materialized_event_id: 21,
        evidence: { federation_normalized: true },
        created_at: '2026-07-11T10:00:00+00:00',
        immutable: true,
      }],
      meta: { per_page: 50, next_cursor: null, has_more: false },
    });

    const response = await getEventTemplateHistory(4, 'opaque-audit-cursor');

    expect(response.data[0]).toEqual(expect.objectContaining({
      action: 'materialized',
      immutable: true,
      materialized_event_id: 21,
    }));
    expect(api.get).toHaveBeenCalledWith('/api/v2/event-templates/4/history', {
      per_page: '50',
      cursor: 'opaque-audit-cursor',
    });
  });

  it('materializes with a header idempotency key and verifies fresh-draft facts', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        created_event: {
          id: 21,
          title: 'Fresh draft',
          publication_status: 'draft',
          operational_status: 'scheduled',
        },
        changed: true,
        idempotent_replay: false,
        workflow: {
          fresh_draft: true,
          published: false,
          registrations_copied: false,
          notifications_sent: false,
          federated: false,
        },
      },
    });
    const input = {
      template_version: 1,
      start_time: '2030-08-01T10:00',
      end_time: '2030-08-01T12:00',
      overrides: { title: 'Fresh draft' },
    };

    const result = await materializeEventTemplate(4, input, 'mobile-materialize-key');

    expect(result.workflow.fresh_draft).toBe(true);
    expect(result.workflow.registrations_copied).toBe(false);
    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/event-templates/4/materializations',
      input,
      { headers: { 'Idempotency-Key': 'mobile-materialize-key' } },
    );
  });

  it('fails closed and reports only issue paths when the contract drifts', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ ...templateFixture(), current_version: 0 }],
      meta: { per_page: 20, next_cursor: null, has_more: false },
    });

    await expect(getEventTemplates()).rejects.toHaveProperty('code', 'EVENTS_CONTRACT_DRIFT');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Event templates contract drift',
      expect.objectContaining({
        extra: { issues: expect.any(Array) },
      }),
    );
  });

  it('previews a capture without writing anything and keeps the capture kind honest', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: capturePreviewFixture() });

    const preview = await previewEventTemplateCapture(9);

    expect(preview.kind).toBe('capture');
    expect(preview.copied_fields).toEqual(['title', 'description', 'timezone']);
    expect(preview.checklist[0]).toEqual({ code: 'event_template_check_source_manage', passed: true });
    expect(api.post).toHaveBeenCalledWith('/api/v2/events/9/template-preview', {});
  });

  it('captures with one idempotency key in both the header and the body', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { template: templateFixture(), changed: true, idempotent_replay: false },
    });

    const result = await captureEventTemplate(9, 'mobile-capture-key');

    expect(result.changed).toBe(true);
    expect(result.template.source_event.id).toBe(9);
    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/events/9/templates',
      { idempotency_key: 'mobile-capture-key' },
      { headers: { 'Idempotency-Key': 'mobile-capture-key' } },
    );
  });

  it('reports an idempotent capture replay instead of claiming a second template', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { template: templateFixture(), changed: false, idempotent_replay: true },
    });

    const result = await captureEventTemplate(9, 'mobile-capture-key');

    expect(result.changed).toBe(false);
    expect(result.idempotent_replay).toBe(true);
  });

  it('fails closed when a capture preview answers with the materialization contract', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { ...capturePreviewFixture(), kind: 'materialization' },
    });

    await expect(previewEventTemplateCapture(9)).rejects.toHaveProperty('code', 'EVENTS_CONTRACT_DRIFT');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Event templates contract drift',
      expect.objectContaining({
        tags: expect.objectContaining({ endpoint: '/api/v2/events/{id}/template-preview' }),
      }),
    );
  });

  it('fails closed when a capture answers without a persisted template', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { changed: true, idempotent_replay: false },
    });

    await expect(captureEventTemplate(9, 'mobile-capture-key'))
      .rejects.toHaveProperty('code', 'EVENTS_CONTRACT_DRIFT');
  });
});
