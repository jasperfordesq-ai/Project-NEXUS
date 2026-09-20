// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React, { useState } from 'react';
import * as Native from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'heroui-native';

function Draft() {
  const [value, setValue] = useState('');
  return <Native.View>
    <Text testID="scaled-label">Discussion</Text>
    <Native.TextInput testID="draft-input" value={value} onChangeText={setValue} />
  </Native.View>;
}

afterEach(() => jest.restoreAllMocks());

it('remeasures existing text on each scale change without remounting the draft input', () => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions');
  dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 1 });
  const view = render(<Draft />);
  const input = view.getByTestId('draft-input');
  const originalLabel = view.getByTestId('scaled-label');
  fireEvent.changeText(input, 'Keep my discussion');
  dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
  view.rerender(<Draft />);
  const enlargedLabel = view.getByTestId('scaled-label');
  expect(dimensions).toHaveBeenCalled();
  expect(enlargedLabel).not.toBe(originalLabel);
  expect(view.getByTestId('draft-input')).toBe(input);
  expect(input.props.value).toBe('Keep my discussion');
  dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 1 });
  view.rerender(<Draft />);
  expect(view.getByTestId('scaled-label')).not.toBe(enlargedLabel);
  expect(view.getByTestId('draft-input')).toBe(input);
  expect(input.props.value).toBe('Keep my discussion');
});



