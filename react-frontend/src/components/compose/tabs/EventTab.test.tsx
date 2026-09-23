// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import { renderEventComponent } from '@/test/events-test-harness';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    showToast: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (path: string) => `/test${path}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks')>()),
  usePageTitle: vi.fn(),
}));

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: vi.fn(() => false) }));

vi.mock('@/components/compose/ComposeSubmitContext', () => ({
  useComposeSubmit: () => ({
    registration: null,
    register: vi.fn(),
    unregister: vi.fn(),
  }),
}));

vi.mock('@/components/compose/shared/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button type="button" aria-label="Add emoji" onClick={() => onSelect('😊')}>
      Emoji
    </button>
  ),
}));

vi.mock('@/components/compose/shared/CharacterCount', () => ({
  CharacterCount: ({ current, max }: { current: number; max: number }) => (
    <output aria-label="Description character count">{current}/{max}</output>
  ),
}));

vi.mock('@/components/compose/shared/AiAssistButton', () => ({
  AiAssistButton: () => <button type="button">AI Assist</button>,
}));

vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui')>()),
  DatePicker: (await import('@/test/events-test-harness')).EventDateOrTimeInputStub,
  TimeInput: (await import('@/test/events-test-harness')).EventDateOrTimeInputStub,
}));

import { EventTab } from './EventTab';

const defaultProps = {
  onSuccess: vi.fn(),
  onClose: vi.fn(),
  groupId: null as number | null,
  templateData: undefined as { title: string; content: string } | undefined,
};

describe('EventTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockApi.post.mockResolvedValue({ success: true, data: { id: 99 } });
  });

  it('renders an accessible title input', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('textbox', { name: 'Event Title' })).toBeInTheDocument();
  });

  it('does not restore a draft saved by another member or community (F-109)', () => {
    localStorage.setItem('compose-draft-event', JSON.stringify({ title: 'Unscoped draft', description: '' }));
    localStorage.setItem('compose-draft-event:t2:u7', JSON.stringify({ title: 'Other member', description: '' }));
    localStorage.setItem('compose-draft-event:t3:u1', JSON.stringify({ title: 'Other community', description: '' }));

    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('textbox', { name: 'Event Title' })).toHaveValue('');
  });

  it("restores this member's own draft in this community (F-109)", () => {
    localStorage.setItem('compose-draft-event:t2:u1', JSON.stringify({ title: 'My own draft', description: '' }));

    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('textbox', { name: 'Event Title' })).toHaveValue('My own draft');
  });

  it('renders an accessible description textarea', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
  });

  it('renders the initial character count', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('status', { name: 'Description character count' }))
      .toHaveTextContent('0/3000');
  });

  it('renders an accessible emoji action', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeInTheDocument();
  });

  it('renders the AI assist action', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'AI Assist' })).toBeInTheDocument();
  });

  it('renders an accessible location input', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('textbox', { name: 'Location' })).toBeInTheDocument();
  });

  it('renders the desktop Cancel action', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onClose when Cancel is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderEventComponent(<EventTab {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables Create Event until both a title and start date are present', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Create Event' })).toBeDisabled();
  });

  it('does not call the create endpoint for an invalid empty draft', () => {
    renderEventComponent(<EventTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Create Event' })).toBeDisabled();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('applies template data to the title and description fields', async () => {
    renderEventComponent(
      <EventTab
        {...defaultProps}
        templateData={{
          title: 'Community Litter Pick',
          content: 'Join us to clean the park.',
        }}
      />,
    );

    expect(await screen.findByDisplayValue('Community Litter Pick')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Join us to clean the park.')).toBeInTheDocument();
  });
});
