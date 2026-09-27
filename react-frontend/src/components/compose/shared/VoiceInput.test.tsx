// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VoiceInput component
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { VoiceInput } from './VoiceInput';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'compose.voice_start': 'Start voice input',
        'compose.voice_stop': 'Stop voice input',
      };
      return labels[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Helper to create a mock SpeechRecognition constructor
function createMockSpeechRecognition() {
  const mockInstance = {
    continuous: false,
    interimResults: false,
    lang: '',
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onresult: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onend: null as (() => void) | null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  const MockCtor = vi.fn(function MockSpeechRecognition() { return mockInstance; });
  return { MockCtor, mockInstance };
}

describe('VoiceInput', () => {
  let onTranscript: Mock<(text: string) => void>;
  let originalSpeechRecognition: unknown;
  let originalWebkitSpeechRecognition: unknown;

  beforeEach(() => {
    onTranscript = vi.fn<(text: string) => void>();
    // Save originals
    originalSpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition;
    originalWebkitSpeechRecognition = (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  afterEach(() => {
    // Restore originals
    (window as unknown as Record<string, unknown>).SpeechRecognition = originalSpeechRecognition;
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = originalWebkitSpeechRecognition;
  });

  it('returns null when SpeechRecognition is not available', () => {
    // Ensure neither API is available
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    render(<VoiceInput onTranscript={onTranscript} />);
    // Component returns null, so no button should be rendered.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // VoiceInput's own status region wraps the mic button; with the component
    // returning null no such region exists. (The ambient ToastProvider also
    // renders empty status regions, so scope to one containing a button.)
    const statusWithButton = screen
      .queryAllByRole('status')
      .find((el) => el.querySelector('button'));
    expect(statusWithButton).toBeUndefined();
  });

  it('renders microphone button when SpeechRecognition is available', () => {
    const { MockCtor } = createMockSpeechRecognition();
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockCtor;

    render(<VoiceInput onTranscript={onTranscript} />);
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument();
  });

  it('renders microphone button when webkitSpeechRecognition is available', () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    const { MockCtor } = createMockSpeechRecognition();
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = MockCtor;

    render(<VoiceInput onTranscript={onTranscript} />);
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument();
  });

  it('has aria-live region wrapping the button', () => {
    const { MockCtor } = createMockSpeechRecognition();
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockCtor;

    render(<VoiceInput onTranscript={onTranscript} />);
    // Scope to VoiceInput's status region (the one wrapping the mic button) —
    // the ambient ToastProvider renders its own status regions too.
    const statusRegion = screen
      .getAllByRole('status')
      .find((el) => el.querySelector('button'));
    expect(statusRegion).toBeDefined();
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
  });

  it('starts listening when button is clicked', async () => {
    const user = userEvent.setup();
    const { MockCtor, mockInstance } = createMockSpeechRecognition();
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockCtor;

    render(<VoiceInput onTranscript={onTranscript} />);

    await user.click(screen.getByRole('button', { name: 'Start voice input' }));

    expect(MockCtor).toHaveBeenCalled();
    expect(mockInstance.start).toHaveBeenCalled();
  });

  it('renders disabled button when isDisabled prop is true', () => {
    const { MockCtor } = createMockSpeechRecognition();
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockCtor;

    render(<VoiceInput onTranscript={onTranscript} isDisabled />);
    const button = screen.getByRole('button', { name: 'Start voice input' });
    expect(button).toBeDisabled();
  });
});
