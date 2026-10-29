<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Event tickets',
    'intro' => 'Review available ticket types, claim free places and manage your own confirmed free tickets.',
    'load_error' => 'The event ticket catalogue could not be loaded.',
    'validation_error' => 'Check the ticket details and try again.',
    'allocate_error' => 'The free ticket could not be allocated. Check your registration, eligibility and the remaining allocation.',
    'cancel_error' => 'The free ticket could not be cancelled. Refresh the catalogue and try again.',
    'allocated' => 'Your free ticket has been allocated.',
    'cancelled' => 'Your free ticket has been cancelled and returned to the allocation.',
    'back_to_event' => 'Back to event',
    'back_to_tickets' => 'Back to event tickets',
    'gateway_disabled' => 'Paid and time-credit checkout is not available. This page never charges money or time credits and does not change your wallet.',
    'my_tickets' => 'My tickets',
    'no_tickets' => 'You do not have a ticket for this event.',
    'ticket_fallback' => 'Event ticket',
    'units' => 'Quantity',
    'status_label' => 'Status',
    'status' => [
        'confirmed' => 'Confirmed',
        'cancelled' => 'Cancelled',
    ],
    'cancel_ticket' => 'Cancel ticket',
    'time_credit_cancel_disabled' => 'Time-credit ticket cancellation is not available in this free-only workflow. No wallet action has been taken.',
    'catalogue' => 'Available tickets',
    'catalogue_empty' => 'No ticket types are available for this event.',
    'kind' => [
        'free' => 'Free',
        'time_credit' => 'Time credits',
    ],
    'remaining' => 'Remaining allocation',
    'member_limit' => 'Limit per member',
    'time_credit_disabled' => 'This type costs :credits time credits, but checkout is disabled until the approved wallet gateway is connected. No credits will be debited.',
    'units_to_claim' => 'Number of free tickets',
    'reconcile' => 'Run reconciliation',
    'reconciliation_clear' => 'Ticket inventory and ledger records reconcile.',
    'reconciliation_warnings' => '{1} :count reconciliation warning|[2,*] :count reconciliation warnings',
    'reconciliation_error' => 'Ticket reconciliation could not be completed.',
    'units_hint' => 'You can claim up to :count in this allocation.',
    'claim_free' => 'Claim free ticket',
    'registration_required' => 'You need a confirmed event registration before you can claim a free ticket.',
    'not_eligible' => 'You do not currently meet this ticket type’s eligibility rules.',
    'sales_closed' => 'This ticket type is not currently open for allocation.',
    'sold_out' => 'No free tickets remain for you in this allocation.',
    'cancel_title' => 'Cancel this free ticket?',
    'cancel_intro' => 'Tell the organiser why you are cancelling. The quantity will be returned to the free allocation.',
    'cancel_free_only' => 'This action cancels a free entitlement only. It does not issue a refund or change any wallet balance.',
    'reason_label' => 'Reason for cancellation',
    'reason_hint' => 'Do not include private or sensitive information. Maximum 500 characters.',
    'confirm_cancel' => 'Cancel free ticket',
];
