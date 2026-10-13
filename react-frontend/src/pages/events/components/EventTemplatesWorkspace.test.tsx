// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventTemplatesApi,
  type EventTemplate,
  type EventTemplateCapturePreview,
  type EventTemplateMaterializationPreview,
} from '@/lib/event-templates-api';
import { renderEventRoute } from '@/test/events-test-harness';
import { EventTemplatesWorkspace } from './EventTemplatesWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantPath: (path: string) => `/test${path}` }) }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'manage.templates.safety_title': 'Templates copy configuration only',
    'manage.templates.use_template': 'Use template',
    'manage.templates.audit': 'Audit history',
    'manage.templates.audit_title': 'Template audit history',
    'manage.templates.audit_load_more': 'Load more history',
    'manage.templates.audit_actions.captured': 'Template captured',
    'manage.templates.audit_actions.revised': 'Template revised',
    'manage.templates.version_value': 'Version {{version}}',
    'manage.templates.capture_from_event': 'Save {{title}} as a template',
    'manage.templates.capture.review_title': 'Review template capture',
    'manage.templates.capture.safe_title': 'Safe to capture',
    'manage.templates.capture.safe_description': 'Only approved fields will be copied.',
    'manage.templates.capture.snapshot_title': 'Template title',
    'manage.templates.capture.confirm': 'Save template',
    'manage.templates.never_copied.people': 'People, registrations and waitlists',
    'manage.templates.never_copied.tickets': 'Tickets, entitlements and transactions',
    'manage.templates.materialize.title': 'Use {{title}}',
    'manage.templates.materialize.draft_only_title': 'This always creates a draft',
    'manage.templates.fields.title': 'Event title',
    'manage.templates.materialize.start_label': 'Start',
    'manage.templates.materialize.end_label': 'End',
    'manage.templates.materialize.review': 'Review draft',
    'manage.templates.materialize.review_title': 'Review draft',
    'manage.templates.materialize.ready_title': 'Ready to create a draft',
    'manage.templates.checks.event_template_check_federation_none': 'Federation is disabled for the new draft',
    'manage.templates.materialize.create_draft': 'Create draft',
  };
  return {
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        let value = labels[key] ?? key;
        Object.entries(values ?? {}).forEach(([name, replacement]) => {
          value = value.replace(`{{${name}}}`, String(replacement));
        });
        if (key === 'manage.templates.use_count') return `${String(values?.count ?? 0)} uses`;
        return value;
      },
      i18n: { language: 'en' },
    }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

function templateFixture(): EventTemplate {
  return {
    id: 4,
    public_id: '123e4567-e89b-12d3-a456-426614174000',
    status: 'active',
    current_version: 1,
    source_event: { id: 9, title: 'Source event', updated_at: '2026-07-01T10:00:00Z' },
    version: {
      id: 10,
      number: 1,
      schema_version: 1,
      configuration: {
        title: 'Reusable event',
        description: 'A safe reusable description.',
        category_id: null,
        group_id: null,
        location: 'Community hall',
        latitude: null,
        longitude: null,
        max_attendees: 30,
        is_online: false,
        allow_remote_attendance: false,
        timezone: 'UTC',
        all_day: false,
        federated_visibility: 'none',
      },
      snapshot: {
        hash: 'a'.repeat(64),
        source_lifecycle_version: 1,
        source_calendar_sequence: 1,
        source_updated_at: '2026-07-01T10:00:00Z',
        immutable: true,
      },
      copied_fields: ['title', 'description', 'location', 'timezone'],
      skipped_fields: ['related.registrations', 'related.private_answers', 'related.tickets'],
      captured_at: '2026-07-01T10:00:00Z',
    },
    usage: { materialization_count: 2, audit_entry_count: 3 },
    archive: { reason: null, archived_at: null },
    capabilities: {
      view: true,
      revise: true,
      archive: true,
      materialize: true,
      view_audit: true,
    },
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
  };
}

function capturePreviewFixture(): EventTemplateCapturePreview {
  const template = templateFixture();
  return {
    kind: 'capture',
    schema_version: 1,
    source_event_id: 9,
    source_lifecycle_version: 1,
    source_calendar_sequence: 1,
    configuration: template.version.configuration,
    snapshot_hash: 'a'.repeat(64),
    copied_fields: template.version.copied_fields,
    skipped_fields: template.version.skipped_fields,
    checklist: [
      { code: 'event_template_check_allowlist_exact', passed: true },
      { code: 'event_template_check_private_records_skipped', passed: true },
    ],
  };
}

function materializationPreviewFixture(): EventTemplateMaterializationPreview {
  const template = templateFixture();
  return {
    kind: 'materialization',
    template_id: template.id,
    template_version_id: template.version.id,
    template_version: 1,
    source_event_id: template.source_event.id,
    schema_version: 1,
    template_snapshot_hash: 'a'.repeat(64),
    effective_snapshot_hash: 'b'.repeat(64),
    configuration: { ...template.version.configuration, title: 'Fresh draft' },
    schedule: {
      start_at: '2030-08-01T10:00:00Z',
      end_at: '2030-08-01T12:00:00Z',
      timezone: 'UTC',
      all_day: false,
    },
    copied_fields: template.version.copied_fields,
    skipped_fields: template.version.skipped_fields,
    override_fields: ['title'],
    checklist: [
      { code: 'event_template_check_allowlist_exact', passed: true },
      { code: 'event_template_check_federation_none', passed: true },
      { code: 'event_template_check_canonical_writer', passed: true },
    ],
    will_create: {
      publication_status: 'draft',
      operational_status: 'scheduled',
      recurring: false,
      publish: false,
      submit_for_review: false,
      register: false,
      notify: false,
      federate: false,
    },
  };
}

describe('EventTemplatesWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(eventTemplatesApi, 'list').mockResolvedValue({
      success: true,
      data: [templateFixture()],
      meta: { per_page: 20, next_cursor: null, has_more: false },
    });
  });

  it('renders the policy-filtered template library with safety and audit controls', async () => {
    renderEventRoute(
      <EventTemplatesWorkspace sourceEventId={9} sourceEventTitle="Source event" />,
      { path: '/events/9/templates', route: '/events/9/templates' },
    );

    expect(await screen.findByRole('heading', { name: 'Reusable event' })).toBeInTheDocument();
    expect(screen.getByText('Templates copy configuration only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use template' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Audit history' })).toBeEnabled();
    expect(screen.getByText('2 uses')).toBeInTheDocument();
  });

  it('loads every page of immutable template audit history on demand', async () => {
    const history = vi.spyOn(eventTemplatesApi, 'history')
      .mockResolvedValueOnce({
        success: true,
        data: [{
          id: 31,
          action: 'captured',
          template_version: 1,
          source_event_id: 9,
          materialized_event_id: null,
          evidence: {},
          created_at: '2026-07-01T10:00:00Z',
          immutable: true,
        }],
        meta: { per_page: 50, next_cursor: '31', has_more: true },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [{
          id: 30,
          action: 'revised',
          template_version: 2,
          source_event_id: 9,
          materialized_event_id: null,
          evidence: {},
          created_at: '2026-07-02T10:00:00Z',
          immutable: true,
        }],
        meta: { per_page: 50, next_cursor: null, has_more: false },
      });
    const user = userEvent.setup();
    renderEventRoute(
      <EventTemplatesWorkspace sourceEventId={9} sourceEventTitle="Source event" />,
      { path: '/events/9/templates', route: '/events/9/templates' },
    );

    await user.click(await screen.findByRole('button', { name: 'Audit history' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Template captured')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Load more history' }));
    expect(await within(dialog).findByText('Template revised')).toBeInTheDocument();
    expect(history).toHaveBeenNthCalledWith(1, 4);
    expect(history).toHaveBeenNthCalledWith(2, 4, '31');
    expect(within(dialog).queryByRole('button', { name: 'Load more history' })).not.toBeInTheDocument();
  });

  it('requires a server preview before capturing a reusable template', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventTemplatesApi, 'previewCapture').mockResolvedValue({
      success: true,
      data: capturePreviewFixture(),
    });
    const capture = vi.spyOn(eventTemplatesApi, 'capture').mockResolvedValue({
      success: true,
      data: { template: templateFixture(), changed: true, idempotent_replay: false },
    });
    renderEventRoute(
      <EventTemplatesWorkspace sourceEventId={9} sourceEventTitle="Source event" />,
      { path: '/events/9/templates', route: '/events/9/templates' },
    );

    await user.click(await screen.findByRole('button', { name: 'Save Source event as a template' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('People, registrations and waitlists')).toBeInTheDocument();
    expect(within(dialog).getByText('Tickets, entitlements and transactions')).toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(capture).toHaveBeenCalledWith(9, expect.any(String)));
  });

  it('creates only after the server confirms the fresh-draft checklist', async () => {
    const user = userEvent.setup();
    const onDraftCreated = vi.fn();
    vi.spyOn(eventTemplatesApi, 'previewMaterialization').mockResolvedValue({
      success: true,
      data: materializationPreviewFixture(),
    });
    const materialize = vi.spyOn(eventTemplatesApi, 'materialize').mockResolvedValue({
      success: true,
      data: {
        created_event: {
          id: 21,
          title: 'Fresh draft',
          publication_status: 'draft',
          operational_status: 'scheduled',
          edit_path: '/events/21/edit',
        },
        provenance: {
          id: 7,
          template_id: 4,
          template_version: 1,
          source_event_id: 9,
          schema_version: 1,
          schedule: {
            start_at: '2030-08-01T10:00:00Z',
            end_at: '2030-08-01T12:00:00Z',
            timezone: 'UTC',
            all_day: false,
          },
          override_fields: ['title'],
          federation_normalized: true,
          created_at: '2026-07-01T10:00:00Z',
          immutable: true,
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
    renderEventRoute(
      <EventTemplatesWorkspace
        sourceEventId={9}
        sourceEventTitle="Source event"
        onDraftCreated={onDraftCreated}
      />,
      { path: '/events/9/templates', route: '/events/9/templates' },
    );

    await user.click(await screen.findByRole('button', { name: 'Use template' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox', { name: 'Event title' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Event title' }), 'Fresh draft');
    fireEvent.change(within(dialog).getByLabelText('Start'), { target: { value: '2030-08-01T10:00' } });
    fireEvent.change(within(dialog).getByLabelText('End'), { target: { value: '2030-08-01T12:00' } });
    await user.click(within(dialog).getByRole('button', { name: 'Review draft' }));

    expect(await within(dialog).findByText('Ready to create a draft')).toBeInTheDocument();
    expect(within(dialog).getByText('Federation is disabled for the new draft')).toBeInTheDocument();
    expect(materialize).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(materialize).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        template_version: 1,
        start_time: '2030-08-01T10:00',
        end_time: '2030-08-01T12:00',
        overrides: expect.objectContaining({ title: 'Fresh draft' }),
      }),
      expect.any(String),
    ));
    expect(onDraftCreated).toHaveBeenCalledWith('/events/21/edit');
  });
});
