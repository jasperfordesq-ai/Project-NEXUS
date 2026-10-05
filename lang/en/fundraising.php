<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'That fundraising campaign could not be found.',
    'organisation_locked' => 'This campaign has already received gifts, so the organisation it raises money for can no longer be changed.',
    'organisation_not_eligible' => 'Only approved organisations can run fundraising campaigns.',
    'not_your_campaign' => 'You can only manage campaigns for your own organisation.',
    'handover_not_found' => 'That hand-over could not be found.',
    'handover_amount_positive' => 'Enter an amount greater than zero.',
    'handover_exceeds_held' => 'That is more than this campaign still holds (:held).',
    'handover_method_invalid' => 'Choose how the money was passed on.',
    'handover_reference_required' => 'Enter a payment reference so the transfer can be traced.',
    'handover_date_invalid' => 'Enter the date the money was passed on. It cannot be in the future.',
    'handover_campaign_has_no_organisation' => 'This campaign is for the whole community, so there is no organisation to hand money over to.',
    'handover_already_closed' => 'This hand-over has already been confirmed or cancelled.',
    'paused_by_community' => 'A community administrator paused this campaign, so only they can start it again.',
    'cancel_reason_required' => 'Give a reason for cancelling this hand-over.',
    'email' => [
        'handover_subject' => ':community has passed on :amount for :campaign',
        'handover_title' => 'Money passed on to :organisation',
        'handover_body' => ':community has recorded passing on :amount raised by the campaign ":campaign", on :date (reference :reference). Please check it has arrived and confirm it on your organisation dashboard.',
        'handover_cta' => 'Confirm receipt',
        'handover_bell' => ':community passed on :amount for :campaign. Please confirm it has arrived.',
    ],
];
