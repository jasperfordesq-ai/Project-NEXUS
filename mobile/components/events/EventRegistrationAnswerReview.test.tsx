// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import Review from './EventRegistrationAnswerReview';
import { reviewOrganizerRegistrationAnswers as read } from '@/lib/api/eventRegistration';
jest.mock('@/lib/api/eventRegistration', () => ({ reviewOrganizerRegistrationAnswers: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const props = { tenantId: 2, userId: 3, eventId: 4, submissionId: 5, revision: 1, permitted: true, sensitive: true, active: true, onClose: jest.fn() };
const answer = { question_id: 1, value: false, purged: false, classification: 'internal' as const };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(read).mockResolvedValue({ data: { answers: { consent: answer } } }); });
function evidence(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('submissions.purpose'), 'Prepare venue');
  fireEvent.changeText(view.getByLabelText('submissions.correlation'), 'case-1');
}
it('requires evidence before explicit access, defaults sensitive off and displays false as No', async () => {
  const view = render(<Review {...props} />);
  fireEvent.press(view.getByText('submissions.open_answers')); expect(read).not.toHaveBeenCalled();
  evidence(view);
  await act(async () => { fireEvent.press(view.getByText('submissions.open_answers')); });
  expect(read).toHaveBeenCalledWith(4, 5, { purpose: 'Prepare venue', correlation_id: 'case-1', include_sensitive: false });
  expect(view.getAllByText('common:no')).toHaveLength(2);
  expect(view.getByText('classifications.internal')).toBeTruthy();
});
it('clears displayed answers when evidence changes and closes explicitly', async () => {
  jest.mocked(read).mockResolvedValue({ data: { answers: { note: { ...answer, value: 'Private test answer' } } } });
  const view = render(<Review {...props} />); evidence(view);
  await act(async () => { fireEvent.press(view.getByText('submissions.open_answers')); });
  expect(view.getByText('Private test answer')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('submissions.purpose'), 'Different purpose');
  expect(view.queryByText('Private test answer')).toBeNull();
  fireEvent.press(view.getByText('common:close')); expect(props.onClose).toHaveBeenCalledTimes(1);
});
it('distinguishes purged and unavailable answers without printing object contents', async () => {
  jest.mocked(read).mockResolvedValue({ data: { answers: {
    purged: { ...answer, value: 'must not show', purged: true }, unknown: { ...answer, value: { secret: 'must not show' } },
  } } });
  const view = render(<Review {...props} />); evidence(view);
  await act(async () => { fireEvent.press(view.getByText('submissions.open_answers')); });
  expect(view.getByText('submissions.purged')).toBeTruthy(); expect(view.getByText('submissions.unavailable_answer')).toBeTruthy();
  expect(view.queryByText(/must not show/)).toBeNull();
});
it('shows an honest empty result and hides the sensitive option without permission', async () => {
  jest.mocked(read).mockResolvedValue({ data: { answers: {} } });
  const view = render(<Review {...props} sensitive={false} />); evidence(view);
  expect(view.queryByText('submissions.include_sensitive')).toBeNull();
  await act(async () => { fireEvent.press(view.getByText('submissions.open_answers')); });
  expect(view.getByText('submissions.no_readable_answers')).toBeTruthy();
});
it('hides answers and clears evidence across backgrounding', async () => {
  const view = render(<Review {...props} />); evidence(view);
  await act(async () => { fireEvent.press(view.getByText('submissions.open_answers')); });
  view.rerender(<Review {...props} active={false} />); expect(view.queryByText('submissions.review_title')).toBeNull();
  view.rerender(<Review {...props} />); expect(view.getByLabelText('submissions.purpose').props.value).toBe('');
  expect(read).toHaveBeenCalledTimes(1);
});

it('reveals a laid-out answer failure without issuing another audited read', async () => {
  jest.mocked(read).mockRejectedValueOnce(new Error('network')); const onErrorLayout = jest.fn();
  const view = render(<Review {...props} onErrorLayout={onErrorLayout} />); evidence(view);
  await act(async () => { fireEvent.press(view.getByText('submissions.open_answers')); });
  const error = view.getByText('messages.review_error');
  fireEvent(error, 'layout', { nativeEvent: { layout: { x: 0, y: 1300, width: 320, height: 120 } } });
  expect(onErrorLayout).toHaveBeenCalledTimes(1); expect(error.props.accessibilityLiveRegion).toBe('polite');
  expect(read).toHaveBeenCalledTimes(1);
});
