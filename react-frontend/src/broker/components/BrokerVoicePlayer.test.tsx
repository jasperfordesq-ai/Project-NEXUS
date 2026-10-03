// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';

const { mockDownload } = vi.hoisted(() => ({ mockDownload: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { download: mockDownload }, default: { download: mockDownload } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { BrokerVoicePlayer } from './BrokerVoicePlayer';

describe('BrokerVoicePlayer', () => {
  beforeEach(() => {
    mockDownload.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:recording');
    URL.revokeObjectURL = vi.fn();
  });

  it('fetches the recording only when the broker presses Play, then shows the player', async () => {
    mockDownload.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
    const { container } = render(<BrokerVoicePlayer copyId={12} messageId={34} />);

    // Opening the page must not count as listening (every fetch is audit-logged).
    expect(mockDownload).not.toHaveBeenCalled();
    expect(screen.getByText('Each time you play a recording, it is logged.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));

    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    expect(mockDownload).toHaveBeenCalledWith('/v2/admin/broker/messages/12/voice/34');
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe('blob:recording');
    expect(audio).toHaveAttribute('aria-label', 'Voice message recording');
  });

  it('says so when the recording cannot be loaded, and lets the broker try again', async () => {
    mockDownload.mockRejectedValue(new Error('404'));
    render(<BrokerVoicePlayer copyId={12} messageId={34} />);

    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The recording could not be loaded.');
    expect(screen.getByRole('button', { name: 'Play recording' })).toBeInTheDocument();
  });
});
