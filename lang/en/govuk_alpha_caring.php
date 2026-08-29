<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community — caregiver links, accessible frontend.
 *
 * 🔴 Wording rules that are not stylistic here.
 *
 * A caregiver link is consent-gated authority over another person's care. The
 * copy must never tell anyone the relationship is established before it is:
 * creating a request produces a PENDING record, the care recipient must agree,
 * and staff must separately verify that agreement. The React copy for the same
 * journey was changed away from "Care receiver linked successfully" for exactly
 * this reason, and these strings must not reintroduce it.
 *
 * Read by web-uk through scripts/sync-laravel-locales.php, which globs
 * lang/{locale}/govuk_alpha*.php. Every key added here must exist in all eleven
 * locales, TRANSLATED — the parity gate compares key sets only, so copying the
 * English value across satisfies it while leaving the string untranslated.
 */

return [
    'shared' => [
        'service_name' => 'Caring Community',
        'back_to_caring' => 'Back to Caring Community',
        'back_to_caregiver' => 'Back to your caring relationships',
        'success_title' => 'Success',
        'error_title' => 'There is a problem',
        'unknown_member' => 'Unknown member',
        'optional' => '(optional)',
    ],

    'hub' => [
        'title' => 'Caring Community',
        'caption' => 'Care and support',
        'intro' => 'Arrange regular care for another member, or answer a request from someone who has asked to care for you.',
        'caregiver_card_title' => 'Your caring relationships',
        'caregiver_card_description' => 'See relationships you have asked for, answer requests about you, and use the tools an approved relationship unlocks.',
        'become_title' => 'Become a caregiver',
        'become_description' => 'Ask to provide regular care for another member of this community. Nothing takes effect until they agree and staff have checked.',
    ],

    'caregiver' => [
        'title' => 'Your caring relationships',
        'caption' => 'Caring Community',
        'intro' => 'Relationships you have asked for, and their current stage.',
        'none' => 'You have not asked to care for anyone yet.',
        'become_button' => 'Ask to care for someone',

        'incoming_title' => 'Requests about you',
        'incoming_intro' => 'These members have asked to care for you. Agree only if you understand and accept what it means.',
        'incoming_explanation' => 'If you agree, staff will then check the request before the relationship begins. Agreeing does not start it on its own.',
        'incoming_none' => 'Nobody has asked to care for you.',
        'confirm_button' => 'I agree to this relationship',
        'reject_button' => 'I do not agree',

        'status_heading' => 'Stage',
        'status_pending_recipient' => 'Waiting for the other member to agree',
        'status_pending_staff' => 'Waiting for a staff safeguarding check',
        'status_active' => 'Approved and active',
        'status_rejected' => 'Not approved',
        'status_inactive' => 'Ended',

        'relationship_heading' => 'Relationship',
        'relationship_family' => 'Family',
        'relationship_friend' => 'Friend',
        'relationship_neighbour' => 'Neighbour',
        'relationship_professional' => 'Professional carer',

        'started_heading' => 'Care started',
        'reason_heading' => 'Reason given',
        'pending_no_tools' => 'While a request is waiting, it gives you no access to this member\'s care details.',
        'active_tools_title' => 'What this relationship lets you do',
        'request_on_behalf_link' => 'Ask for help on behalf of this member',
    ],

    'link' => [
        'title' => 'Ask to care for someone',
        'caption' => 'Caring Community',
        'intro' => 'Ask to provide regular care for another member of this community.',
        'consent_warning' => 'The member you name will be asked whether they agree. Staff will then check the request. The relationship does not begin, and gives you nothing, until both have happened.',
        'search_label' => 'Find the member you want to care for',
        'search_hint' => 'Enter part of their name, then choose them from the results.',
        'search_button' => 'Search',
        'results_title' => 'Choose a member',
        'results_none' => 'No members matched that name. Try a different spelling.',
        'choose_button' => 'Choose',
        'chosen_label' => 'Member you have chosen',
        'change_button' => 'Change',
        'relationship_label' => 'Your relationship to them',
        'start_date_label' => 'Date the care started or will start',
        'start_date_hint' => 'For example, 27 3 2026',
        'notes_label' => 'Anything staff should know',
        'notes_hint' => 'Optional. This is shown to the staff member who checks the request.',
        'submit_button' => 'Send request',
        'error_no_member' => 'Choose the member you want to care for',
        'error_no_relationship' => 'Select your relationship to them',
        'error_no_start_date' => 'Enter the date the care started or will start',
        'error_bad_start_date' => 'Enter a real date, for example 27 3 2026',
        'error_search_too_short' => 'Enter at least two characters to search',
    ],

    'on_behalf' => [
        'title' => 'Ask for help on behalf of someone',
        'intro' => 'Ask the community for practical help for the member you care for. The request is recorded in their name, and shows that you made it.',
        'for_member' => 'This request is for',
        'title_label' => 'What help is needed',
        'title_hint' => 'For example, a lift to a hospital appointment.',
        'description_label' => 'More detail',
        'when_label' => 'When it is needed',
        'contact_label' => 'How helpers should get in touch',
        'contact_phone' => 'By phone',
        'contact_message' => 'By message',
        'contact_either' => 'Either is fine',
        'submit_button' => 'Send request',
        'error_no_title' => 'Enter what help is needed',
        'error_not_active' => 'You can only ask for help on behalf of a member whose relationship has been approved',
    ],

    'review' => [
        'title' => 'Caregiver requests to check',
        'caption' => 'Caring Community',
        'intro' => 'Check the care recipient has agreed, and record how you verified it, before approving a caring relationship.',
        'none' => 'No caregiver requests are waiting to be checked.',
        'requested_by' => 'Requested by',
        'requested_for' => 'To care for',
        'requested_on' => 'Requested on',
        'recipient_agreed' => 'The member has agreed',
        'recipient_not_agreed' => 'The member has not agreed yet',
        'blocked_until_agreed' => 'You cannot approve this request until the member has agreed to it.',
        'evidence_label' => 'How you verified their consent',
        'evidence_hint' => 'For example, a telephone call on 27 March 2026 with the member themselves.',
        'attestation_label' => 'I confirm I verified this member\'s consent myself',
        'approve_button' => 'Approve relationship',
        'reject_label' => 'Why you are refusing this request',
        'reject_hint' => 'This is recorded and shown to the member who asked.',
        'reject_button' => 'Refuse request',
        'decided_approved' => 'Approved',
        'decided_rejected' => 'Refused',
        'error_no_evidence' => 'Enter how you verified their consent',
        'error_no_attestation' => 'Confirm that you verified this member\'s consent yourself',
        'error_no_reason' => 'Enter why you are refusing this request',
    ],

    'status' => [
        'link_requested' => 'Your request has been sent. It is waiting for the other member to agree, and then for a staff check.',
        'link_failed' => 'Your request could not be sent.',
        'link_duplicate' => 'You already have a request or an approved relationship with that member.',
        'incoming_confirmed' => 'You have agreed. Staff will now check the request before the relationship begins.',
        'incoming_rejected' => 'You have refused. No relationship has been created.',
        'incoming_failed' => 'Your answer could not be saved.',
        'review_approved' => 'The caring relationship has been approved.',
        'review_rejected' => 'The request has been refused.',
        'review_not_agreed' => 'That request cannot be approved because the member has not agreed to it.',
        'review_failed' => 'That decision could not be saved.',
        'review_not_found' => 'That request could not be found in this community.',
        'on_behalf_sent' => 'The request for help has been sent.',
        'on_behalf_failed' => 'The request for help could not be sent.',
    ],
];
