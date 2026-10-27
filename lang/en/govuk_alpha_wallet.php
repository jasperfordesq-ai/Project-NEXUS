<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'manage' => [
        'title' => 'Manage your credits',
        'caption' => 'Time credits',
        'description' => 'See your pending credits at a glance, send credits to a member, or donate to the community fund.',
        'back_to_wallet' => 'Back to your wallet',
    ],

    'balance' => [
        'heading' => 'Your balance',
        'label' => 'Available balance',
        'pending_badge_in' => '{0} No pending credits|{1} Pending in: :count hour|[2,*] Pending in: :count hours',
        'no_pending' => 'No pending credits',
    ],

    'stats' => [
        'heading' => 'Summary',
        'earned' => 'Earned',
        'spent' => 'Spent',
        'pending' => 'Pending',
        'earned_value' => '+:value hours',
        'spent_value' => '-:value hours',
        'pending_value' => ':value hours',

        'pending_in' => 'Pending — incoming',

        'pending_out' => 'Pending — outgoing',
        'pending_hint' => 'Incoming and outgoing credits that have not yet completed.',
    ],

    'hours_value' => ':value hours',
    'member_since' => 'Member since :date',

    'transfer' => [
        'heading' => 'Send credits to a member',
        'description' => 'Search for a member by name, then choose how many hours to send.',
        'prefill_notice' => 'A recipient has been pre-selected from your link. Check the details before sending.',
        'search_label' => 'Search for a member',
        'search_hint' => 'Type a name and select Search.',
        'search_button' => 'Search',
        'search_empty' => 'No members matched your search.',
        'recipient_heading' => 'Matching members',
        'amount_label' => 'Amount in hours',
        'amount_hint' => 'For example, 1 or 2.5. You can send up to :max hours.',
        'note_label' => 'Add a note (optional)',
        'note_hint' => 'The recipient will see this with the transfer.',
        'send_button' => 'Send credits to :name',
    ],

    'donate' => [
        'heading' => 'Donate credits',
        'description' => 'Give some of your time credits to the community fund, or directly to another member.',
        'credits_not_money' => 'This donates your time credits to a shared community pool. It is not a money donation.',
        'warning' => 'Donations move credits one way and cannot be undone.',
        'target_legend' => 'Who would you like to donate to?',
        'target_fund' => 'The community fund',
        'target_fund_hint' => 'A shared pool any member can draw on.',
        'target_member' => 'A specific member',
        'target_member_hint' => 'Search for the member below before donating.',
        'fund_balance_label' => 'Community fund balance',
        'fund_donated_label' => 'Total donated by members',
        'recipient_required' => 'Search for and select a member to donate to first.',
        'amount_label' => 'Amount in hours',
        'amount_hint' => 'Whole hours only, up to 1000.',
        'message_label' => 'Add a message (optional)',
        'message_hint' => 'A short note to go with your donation.',
        'button_fund' => 'Donate to the community fund',
        'button_member' => 'Donate to :name',
    ],

    'states' => [
        'success_title' => 'Success',
        'error_title' => 'There is a problem',
        'warning' => 'Warning',
        'transfer_sent' => 'Your credits have been sent.',
        'donate_sent' => 'Thank you. Your donation has been made.',
    ],

    'errors' => [
        'invalid' => 'Enter a valid amount and recipient.',
        'insufficient' => 'You do not have enough credits for that.',
        'not_found' => 'That member could not be found.',
        'self' => 'You cannot send credits to yourself.',
        'inactive' => 'That member cannot receive credits right now.',
        'too_large' => 'That amount is too large.',
        'decimals' => 'Donations must be whole hours.',
        'failed' => 'Something went wrong. Please try again.',
    ],

    'footer' => [
        'wallet_link' => 'View your full wallet and transaction history',
    ],

    'nav' => [
        'manage' => 'Manage your credits',
    ],
    'regional_points' => [
        'title' => 'Regional Points',
        'default_symbol' => 'pts',
        'subtitle' => 'A regional currency you can earn and spend with neighbours and local merchants.',
        'balance' => 'Balance',
        'lifetime_earned' => 'Lifetime earned',
        'lifetime_spent' => 'Lifetime spent',
        'unavailable' => [
            'title' => 'Regional points are not enabled here',
            'description' => 'This community has not turned on the regional points programme yet.',
        ],
        'transfer' => [
            'title' => 'Send points to another member',
            'amount' => 'Amount',
            'message' => 'Message (optional)',
            'submit' => 'Send transfer',
            'success' => 'Transfer sent',
            'errors' => [
                'invalid_amount' => 'Enter a positive amount',
                'choose_recipient' => 'Choose a member to send points to',
            ],
            'recipient_label' => 'Who are you sending points to?',
            'recipient_hint' => 'Type at least 2 letters to search',
            'recipient_no_results' => 'No members found',
            'change_recipient' => 'Change',
            'confirm_title' => 'Send :points :symbol to :name?',
            'confirm_body' => 'Check this is the right person. You cannot undo a transfer once it is sent.',
            'confirm_button' => 'Yes, send points',
            'cancel' => 'Cancel',
            'choose' => 'Choose',
            'results_title' => 'Members found',
            'chosen_label' => 'Sending to',
        ],
        'history' => [
            'types' => [
                'earned_for_hours' => 'Earned for hours',
                'transfer_in' => 'Transfer received',
                'transfer_out' => 'Transfer sent',
                'admin_issue' => 'Issued by admin',
                'admin_adjustment' => 'Admin adjustment',
                'redemption' => 'Redemption',
                'reversal' => 'Reversal',
            ],
            'title' => 'Recent activity',
            'empty' => 'No transactions yet.',
            'date' => 'Date',
            'type' => 'Type',
            'description' => 'Description',
            'amount' => 'Amount',
            'balance_after' => 'Balance',
            'table_aria' => 'Regional points activity',
        ],
        'errors' => [
            'load_failed' => 'Failed to load regional points',
            'transfer_failed' => 'Transfer failed',
        ],
    ],
];
