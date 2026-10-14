<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Registration data can only be reviewed for removal after the event has ended. Choose a date after the event\'s end.',
        'settings_required' => 'Save this event\'s registration settings first. They set how long registration data is kept.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'That send time has already passed. Choose a time in the future, or send the message now.',
        'post_event_too_early' => 'A message for after the event can only be sent once the event has ended. Choose a time after the event\'s end.',
        'audience_empty' => 'Nobody would receive this message. Choose an audience that includes at least one person.',
        'channel_empty' => 'Choose at least one way to send this message.',
        'body_invalid' => 'Write a message of no more than :max characters.',
        'version_conflict' => 'This message was changed somewhere else after the page loaded. Refresh the page, check it and try again.',
        'transition_invalid' => 'This message has already moved on: it may be sending or already sent. Refresh the page to see where it is.',
        'cancel_after_send_forbidden' => 'Sending has already started, so this message can no longer be cancelled.',
        'idempotency_conflict' => 'This looks like a repeat of an earlier attempt with different details. Refresh the page and check whether the message is already there.',
        'authorization_denied' => 'You are not allowed to send messages for this event. Ask the event organiser to add you to the event team.',
    ],
];
