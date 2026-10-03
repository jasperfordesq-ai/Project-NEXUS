// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'fs';
import path from 'path';

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiResponseError } from '@/lib/api/client';
import { submitSupportRequest } from '@/lib/api/support';
import HelpSupportRoute from './help-support';

let mockSearchParams: Record<string, string> = {};
const mockLaunchImageLibraryAsync = jest.fn();
const mockPrepareImageForUpload = jest.fn();
let mockAuth = { isAuthenticated: true, isLoading: false };
const mockGuard = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn(), isFocused: () => true }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

// The resize/convert itself is covered by lib/media/prepareImageForUpload.test.ts.
jest.mock('@/lib/media/prepareImageForUpload', () => ({
  prepareImageForUpload: (...args: unknown[]) => mockPrepareImageForUpload(...args),
}));

jest.mock('@/lib/api/support', () => ({
  ...jest.requireActual('@/lib/api/support'),
  submitSupportRequest: jest.fn(),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: (options: unknown) => mockGuard(options),
}));

jest.mock('@/lib/supportDiagnostics', () => ({
  ...jest.requireActual('@/lib/supportDiagnostics'),
  getSupportDiagnostics: () => ({
    client: 'native_app',
    platform: 'android',
    os_version: '34',
    app_version: '1.8.1',
    language: 'en',
  }),
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text testID="top-bar-title">{title}</Text>;
  };
});

const mockSubmit = submitSupportRequest as jest.MockedFunction<typeof submitSupportRequest>;

const RECEIPT = {
  id: 41,
  reference: 'NXR-261003-K7Q2ZP',
  request_type: 'broken' as const,
  status: 'open',
  impact: 'blocked',
  summary: 'Wallet will not open',
};

function photo(n: number, extra: Record<string, unknown> = {}) {
  return { uri: `file:///picked/photo-${n}.jpg`, width: 1080, height: 2400, mimeType: 'image/jpeg', fileSize: 400_000, ...extra };
}

/** The member picks these from the photo library. */
function picks(...assets: ReturnType<typeof photo>[]) {
  mockLaunchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets });
}

async function addScreenshots(view: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.press(view.getByTestId('help-support-screenshots-add'));
  });
}

function lastGuard(): { isDirty: boolean; hasSaved: boolean; isSaving: boolean } {
  return mockGuard.mock.calls[mockGuard.mock.calls.length - 1][0];
}

async function fill(view: ReturnType<typeof render>, summary: string, description: string, summaryLabel = 'Short summary', descriptionLabel = 'What happened?') {
  fireEvent.changeText(view.getByLabelText(summaryLabel), summary);
  fireEvent.changeText(view.getByLabelText(descriptionLabel), description);
}

async function send(view: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.press(view.getByTestId('help-support-submit'));
  });
}

describe('Help & support form', () => {
  beforeEach(() => {
    mockSearchParams = {};
    mockAuth = { isAuthenticated: true, isLoading: false };
    jest.clearAllMocks();
    // Default: the picked image needs nothing doing to it.
    mockPrepareImageForUpload.mockImplementation(async (asset: unknown) => asset);
  });

  it('asks what kind of help is needed before showing any fields', () => {
    const view = render(<HelpSupportRoute />);

    expect(view.getByTestId('top-bar-title').props.children).toBe('Help & support');
    expect(view.getByText('How can we help?')).toBeTruthy();
    expect(view.getByText('What do you need help with?')).toBeTruthy();
    for (const label of ['Something isn’t working', 'How do I…?', 'Account or sign-in problem', 'Suggest an improvement']) {
      expect(view.getByLabelText(label)).toBeTruthy();
    }
    expect(view.queryByTestId('help-support-form')).toBeNull();
    expect(view.queryByTestId('help-support-submit')).toBeNull();
  });

  it('marks the chosen type for a screen reader and words the fields for it', () => {
    const view = render(<HelpSupportRoute />);

    fireEvent.press(view.getByTestId('help-support-type-how_to'));

    expect(view.getByTestId('help-support-type-how_to').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    expect(view.getByTestId('help-support-type-broken').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    expect(view.getByLabelText('Your question in a few words')).toBeTruthy();
    expect(view.getByLabelText('Tell us a bit more')).toBeTruthy();
  });

  it('asks how badly it affects them, and offers diagnostics, only for "Something isn’t working"', () => {
    const view = render(<HelpSupportRoute />);

    fireEvent.press(view.getByTestId('help-support-type-suggestion'));
    expect(view.queryByText('How much is this affecting you?')).toBeNull();
    expect(view.queryByTestId('help-support-diagnostics')).toBeNull();

    fireEvent.press(view.getByTestId('help-support-type-broken'));
    expect(view.getByText('How much is this affecting you?')).toBeTruthy();
    expect(view.getByText('I can’t continue')).toBeTruthy();
    expect(view.getByTestId('help-support-diagnostics')).toBeTruthy();
    // The member sees exactly what will be sent before agreeing to it.
    expect(view.getByTestId('help-support-diagnostics-detail').props.children).toBe(
      'Only these are sent: Android (API 34), app version 1.8.1, language en. Nothing that identifies you or your phone.',
    );
  });

  it('opens on "Something isn’t working" when the crash screen sends the member here', () => {
    mockSearchParams = { type: 'broken' };
    const view = render(<HelpSupportRoute />);

    expect(view.getByTestId('help-support-form')).toBeTruthy();
    expect(view.getByText('How much is this affecting you?')).toBeTruthy();
  });

  it('ignores a type it does not know rather than guessing', () => {
    mockSearchParams = { type: 'billing' };
    const view = render(<HelpSupportRoute />);

    expect(view.queryByTestId('help-support-form')).toBeNull();
  });

  it('refuses a request the server would refuse, and says which field is short', async () => {
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-broken'));
    await fill(view, 'ab', 'too short');

    await send(view);

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(view.getByText('Write a summary of at least 3 characters.')).toBeTruthy();
    expect(view.getByText('Tell us a little more: at least 10 characters.')).toBeTruthy();
  });

  it('sends a broken report with its impact and diagnostics, then shows the reference and the receipt email', async () => {
    mockSubmit.mockResolvedValue(RECEIPT);
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-broken'));
    await fill(view, '  Wallet will not open ', '  The wallet screen closes as soon as I open it.  ');
    fireEvent.press(view.getByText('I can’t continue'));

    expect(lastGuard().isDirty).toBe(true);
    await send(view);

    expect(mockSubmit).toHaveBeenCalledWith({
      requestType: 'broken',
      summary: 'Wallet will not open',
      description: 'The wallet screen closes as soon as I open it.',
      impact: 'blocked',
      diagnostics: { client: 'native_app', platform: 'android', os_version: '34', app_version: '1.8.1', language: 'en' },
    });
    // No screenshot, so nothing that would turn the request into multipart.
    expect(mockSubmit.mock.calls[0][0]).not.toHaveProperty('screenshots');
    expect(view.getByTestId('help-support-sent')).toBeTruthy();
    expect(view.getByText('Request sent')).toBeTruthy();
    expect(view.getByTestId('help-support-reference').props.children).toBe('NXR-261003-K7Q2ZP');
    expect(view.getByText(/We have emailed you a receipt/)).toBeTruthy();
    expect(view.queryByTestId('help-support-form')).toBeNull();
    // Sent work is not unsaved work: leaving must not ask.
    expect(lastGuard().hasSaved).toBe(true);
  });

  it('sends no diagnostics when the member unticks the box', async () => {
    mockSubmit.mockResolvedValue(RECEIPT);
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-broken'));
    await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
    fireEvent.press(view.getByTestId('help-support-diagnostics'));
    expect(view.queryByTestId('help-support-diagnostics-detail')).toBeNull();

    await send(view);

    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ diagnostics: null, impact: 'minor' }));
  });

  it('sends a question without an impact or diagnostics', async () => {
    mockSubmit.mockResolvedValue({ ...RECEIPT, request_type: 'how_to' });
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-how_to'));
    await fill(view, 'Sending hours', 'How do I send hours to a neighbour?', 'Your question in a few words', 'Tell us a bit more');

    await send(view);

    const payload = mockSubmit.mock.calls[0][0];
    expect(payload.requestType).toBe('how_to');
    expect(payload).not.toHaveProperty('impact');
    expect(payload.diagnostics).toBeNull();
  });

  it('sends once when Send is pressed twice in the same frame', async () => {
    let resolve: (value: typeof RECEIPT) => void = () => undefined;
    mockSubmit.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-suggestion'));
    await fill(view, 'Dark mode', 'A dark mode switch on the home screen.', 'Your idea in a few words', 'Tell us a bit more about your idea');

    await act(async () => {
      fireEvent.press(view.getByTestId('help-support-submit'));
      fireEvent.press(view.getByTestId('help-support-submit'));
    });
    await act(async () => { resolve(RECEIPT); });

    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('explains the daily limit kindly, and does not invite a retry that cannot work', async () => {
    mockSubmit.mockRejectedValue(
      new ApiResponseError(429, 'You have sent 5 reports in the last 24 hours.', undefined, 'SUPPORT_REPORT_DAILY_LIMIT'),
    );
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-account'));
    await fill(view, 'Cannot sign in', 'My sign-in code never arrives.', 'What’s wrong, in a few words', 'Tell us a bit more');

    await send(view);

    expect(view.getByTestId('help-support-failure-dailyLimit')).toBeTruthy();
    expect(view.getByText('You have reached today’s limit')).toBeTruthy();
    expect(view.getByText(/Please try again tomorrow, or reply to the receipt email/)).toBeTruthy();
    expect(view.getByTestId('help-support-submit').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    // What they typed is kept, so nothing is lost while they wait.
    expect(view.getByLabelText('What’s wrong, in a few words').props.value).toBe('Cannot sign in');
  });

  it('tells the per-minute throttle apart from the daily limit', async () => {
    mockSubmit.mockRejectedValue(new ApiResponseError(429, 'Too Many Attempts.'));
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-suggestion'));
    await fill(view, 'Dark mode', 'A dark mode switch on the home screen.', 'Your idea in a few words', 'Tell us a bit more about your idea');

    await send(view);

    expect(view.getByTestId('help-support-failure-tooFast')).toBeTruthy();
    expect(view.getByText('Please wait a moment')).toBeTruthy();
  });

  it('says the connection failed, keeps what was typed, and lets the member try again', async () => {
    mockSubmit
      .mockRejectedValueOnce(new ApiResponseError(0, 'Network error'))
      .mockResolvedValueOnce(RECEIPT);
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-broken'));
    await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');

    await send(view);

    expect(view.getByTestId('help-support-failure-network')).toBeTruthy();
    expect(view.getByText(/Check your connection and try again/)).toBeTruthy();
    expect(view.getByLabelText('Short summary').props.value).toBe('Wallet will not open');
    expect(lastGuard().isDirty).toBe(true);

    await send(view);
    expect(view.getByTestId('help-support-sent')).toBeTruthy();
  });

  it('puts the server’s validation message on the field it blamed', async () => {
    mockSubmit.mockRejectedValue(
      new ApiResponseError(422, 'Please describe the problem in a little more detail.', undefined, 'VALIDATION_FAILED', 'description'),
    );
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-broken'));
    await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');

    await send(view);

    await waitFor(() => {
      expect(view.getAllByText('Please describe the problem in a little more detail.').length).toBeGreaterThan(0);
    });
    expect(view.getByTestId('help-support-failure-other')).toBeTruthy();
  });

  it('lets the member send another request after a success', async () => {
    mockSubmit.mockResolvedValue(RECEIPT);
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-broken'));
    await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
    await send(view);

    fireEvent.press(view.getByTestId('help-support-send-another'));

    expect(view.queryByTestId('help-support-sent')).toBeNull();
    expect(view.queryByTestId('help-support-form')).toBeNull();
    expect(view.getByText('What do you need help with?')).toBeTruthy();
  });

  it('closes from the receipt with Done', async () => {
    const { router } = require('expo-router');
    mockSubmit.mockResolvedValue(RECEIPT);
    const view = render(<HelpSupportRoute />);
    fireEvent.press(view.getByTestId('help-support-type-broken'));
    await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
    await send(view);

    fireEvent.press(view.getByTestId('help-support-done'));

    expect(router.back).toHaveBeenCalled();
  });

  it('asks a signed-out visitor to sign in instead of showing a form that cannot send', () => {
    mockAuth = { isAuthenticated: false, isLoading: false };
    const view = render(<HelpSupportRoute />);

    expect(view.getByTestId('help-support-sign-in')).toBeTruthy();
    expect(view.queryByText('What do you need help with?')).toBeNull();
  });

  it('never hands the member to a browser', () => {
    const source = fs.readFileSync(path.join(__dirname, 'help-support.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/expo-linking/);
    expect(code).not.toMatch(/openURL/);
    expect(code).not.toMatch(/buildWebUrl/);
    expect(code).not.toMatch(/https?:\/\//);
  });

  describe('screenshots', () => {
    it('offers screenshots for every kind of request, with nothing attached to begin with', () => {
      const view = render(<HelpSupportRoute />);

      for (const type of ['broken', 'how_to', 'account', 'suggestion']) {
        fireEvent.press(view.getByTestId(`help-support-type-${type}`));
        expect(view.getByText('Screenshots (optional)')).toBeTruthy();
        expect(view.getByLabelText('Add a screenshot')).toBeTruthy();
      }
      expect(view.queryByTestId('help-support-screenshot-0')).toBeNull();
    });

    it('opens the photo library for several pictures, without asking permission, and shrinks and converts each', async () => {
      picks(photo(1), photo(2));
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));

      await addScreenshots(view);

      expect(mockLaunchImageLibraryAsync).toHaveBeenCalledWith(
        expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3 }),
      );
      expect(mockPrepareImageForUpload).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'file:///picked/photo-1.jpg' }),
        { maxEdge: 2048, convertUnsupportedFormats: true },
      );
      expect(view.getByLabelText('Screenshot 1')).toBeTruthy();
      expect(view.getByLabelText('Screenshot 2')).toBeTruthy();
      expect(view.getByLabelText('Remove screenshot 1')).toBeTruthy();
      expect(view.getByText(/anyone else’s private details/)).toBeTruthy();
      // A screenshot alone is work the member would lose by leaving.
      expect(lastGuard().isDirty).toBe(true);
    });

    it('sends the attached screenshots with the request', async () => {
      // A HEIC the helper converted: the screen must send the converted file and its type.
      mockPrepareImageForUpload.mockImplementationOnce(async () => ({ uri: 'file:///cache/converted.jpg', mimeType: 'image/jpeg' }));
      picks(photo(1, { uri: 'file:///picked/IMG_0001.HEIC', mimeType: 'image/heic' }));
      mockSubmit.mockResolvedValue(RECEIPT);
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));
      await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
      await addScreenshots(view);

      await send(view);

      expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
        screenshots: [{ uri: 'file:///cache/converted.jpg', name: 'screenshot-1.jpg', mimeType: 'image/jpeg' }],
      }));
      expect(view.getByTestId('help-support-sent')).toBeTruthy();
    });

    it('caps a request at three screenshots and says why the rest were left out', async () => {
      // Not every Android photo picker honours selectionLimit.
      picks(photo(1), photo(2), photo(3), photo(4));
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-suggestion'));

      await addScreenshots(view);

      expect(view.getByTestId('help-support-screenshot-2')).toBeTruthy();
      expect(view.queryByTestId('help-support-screenshot-3')).toBeNull();
      expect(view.getByText('You can attach up to 3 screenshots, so only the first ones were added.')).toBeTruthy();
      // Full: the add button gives way to an explanation.
      expect(view.queryByTestId('help-support-screenshots-add')).toBeNull();
      expect(view.getByTestId('help-support-screenshots-full')).toBeTruthy();
    });

    it('asks the picker only for the slots that are left', async () => {
      picks(photo(1), photo(2));
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-how_to'));
      await addScreenshots(view);

      picks(photo(3));
      await addScreenshots(view);

      expect(mockLaunchImageLibraryAsync).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 1 }));
      expect(view.getByTestId('help-support-screenshot-2')).toBeTruthy();
    });

    it('removes a screenshot, and sends only the ones that are left', async () => {
      picks(photo(1), photo(2));
      mockSubmit.mockResolvedValue(RECEIPT);
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));
      await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
      await addScreenshots(view);

      fireEvent.press(view.getByLabelText('Remove screenshot 1'));

      expect(view.queryByTestId('help-support-screenshot-1')).toBeNull();
      expect(view.getByTestId('help-support-screenshot-0')).toBeTruthy();
      await send(view);
      const sent = mockSubmit.mock.calls[0][0].screenshots ?? [];
      expect(sent.map((shot) => shot.uri)).toEqual(['file:///picked/photo-2.jpg']);
    });

    it('sends plain JSON again once every screenshot is removed', async () => {
      picks(photo(1));
      mockSubmit.mockResolvedValue(RECEIPT);
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));
      await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
      await addScreenshots(view);
      fireEvent.press(view.getByLabelText('Remove screenshot 1'));

      await send(view);

      expect(mockSubmit.mock.calls[0][0]).not.toHaveProperty('screenshots');
    });

    it('refuses a picture over 10 MB, and one that could not be converted, with a reason', async () => {
      // The second asset stands for a failed conversion: the helper hands back the original HEIC.
      picks(photo(1, { fileSize: 11 * 1024 * 1024 }), photo(2, { uri: 'file:///picked/IMG_2.HEIC', mimeType: 'image/heic' }));
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));

      await addScreenshots(view);

      expect(view.queryByTestId('help-support-screenshot-0')).toBeNull();
      expect(view.getByText('A picture larger than 10 MB was not added.')).toBeTruthy();
      expect(view.getByText(/could not be prepared for sending/)).toBeTruthy();
    });

    it('puts the server’s refusal of a screenshot beside the screenshots', async () => {
      picks(photo(1));
      mockSubmit.mockRejectedValue(
        new ApiResponseError(422, 'That screenshot could not be read as an image.', undefined, 'VALIDATION_FAILED', 'screenshots.0'),
      );
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));
      await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
      await addScreenshots(view);

      await send(view);

      expect(view.getByTestId('help-support-screenshots-notice')).toBeTruthy();
      expect(view.getAllByText('That screenshot could not be read as an image.').length).toBeGreaterThan(0);
    });

    it('does nothing when the member closes the picker without choosing', async () => {
      mockLaunchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));

      await addScreenshots(view);

      expect(view.queryByTestId('help-support-screenshot-0')).toBeNull();
      expect(view.queryByTestId('help-support-screenshots-notice')).toBeNull();
    });

    it('starts the next request without the last one’s screenshots', async () => {
      picks(photo(1));
      mockSubmit.mockResolvedValue(RECEIPT);
      const view = render(<HelpSupportRoute />);
      fireEvent.press(view.getByTestId('help-support-type-broken'));
      await fill(view, 'Wallet will not open', 'The wallet screen closes as soon as I open it.');
      await addScreenshots(view);
      await send(view);

      fireEvent.press(view.getByTestId('help-support-send-another'));
      fireEvent.press(view.getByTestId('help-support-type-broken'));

      expect(view.queryByTestId('help-support-screenshot-0')).toBeNull();
    });
  });
});
