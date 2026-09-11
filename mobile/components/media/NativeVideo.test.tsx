// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';
const mockPlayer = { duration: 100, timeUpdateEventInterval: 0 };
const mockUseVideoPlayer = jest.fn();
const mockEvents: Record<string, (event?: unknown) => void> = {};
jest.mock('expo-video', () => ({
  useVideoPlayer: (...args: unknown[]) => mockUseVideoPlayer(...args),
  VideoView: 'VideoView',
}));
jest.mock('expo', () => ({
  useEventListener: (_player: unknown, name: string, listener: (event?: unknown) => void) => { mockEvents[name] = listener; },
}));
import NativeVideo from './NativeVideo';

it('uses a hook-owned player and forwards seconds and completion without autoplay', () => {
  mockUseVideoPlayer.mockImplementation((_source, setup) => { setup(mockPlayer); return mockPlayer; });
  const progress = jest.fn();
  const ui = render(<NativeVideo testID="video" source={{ uri: 'https://example.test/lesson.mp4' }} onProgress={progress} />);
  expect(mockUseVideoPlayer).toHaveBeenCalledWith({ uri: 'https://example.test/lesson.mp4' }, expect.any(Function));
  expect(ui.getByTestId('video').props.nativeControls).toBe(true);
  expect(ui.getByTestId('video').props.contentFit).toBe('contain');
  expect(mockPlayer.timeUpdateEventInterval).toBe(0.5);
  mockEvents.timeUpdate({ currentTime: 25 });
  expect(progress).toHaveBeenLastCalledWith({ currentTime: 25, duration: 100 });
  mockEvents.playToEnd();
  expect(progress).toHaveBeenLastCalledWith({ currentTime: 100, duration: 100, finished: true });
});
