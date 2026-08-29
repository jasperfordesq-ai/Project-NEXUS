<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    // =========================================================================
    // FederationController — cross-tenant notifications
    // =========================================================================
    'federation' => [
        'new_message' => 'New federated message from :sender (:tenant): :subject',
    ],

    // =========================================================================
    // GroupNotificationService
    // =========================================================================
    'group_join_request'        => ':name has requested to join ":group"',
    'group_join_request_review' => 'Review request',
    'group_joined'              => 'You have been accepted into ":group"',
    'group_joined_visit'        => 'Visit group',
    'group_join_rejected'       => 'Your request to join ":group" was not approved',
    'group_browse_others'       => 'Browse other groups',
    'group_new_member'          => ':name joined your group ":group"',
    'group_new_discussion'      => ':author started a new discussion ":title" in ":group"',
    'group_view_discussion'     => 'View discussion',
    'group_new_announcement'    => ':author posted an announcement ":title" in ":group"',
    'group_view_announcement'   => 'View announcement',

    // =========================================================================
    // SocialNotificationService
    // =========================================================================
    'liked_your_content'         => ':name liked your :content_type',
    'commented_on_your_content'  => ':name commented on your :content_type: ":comment"',
    'replied_to_your_comment'    => ':name replied to your comment: ":comment"',
    'shared_your_content'        => ':name shared your :content_type',
    'content_getting_attention'  => 'Your :content_type is getting attention!',
    'content_reaching_more'      => 'Your content is reaching more people!',

    // Social email subjects
    'email_new_like_title'       => 'New Like on Your :content_type',
    'email_new_comment_title'    => 'New Comment on Your :content_type',
    'email_new_comment_reply_title' => 'New Reply to Your Comment',
    'email_subject_with_community' => ':title - :community',
    'email_new_comment_reply_subject' => ':title - :community',
    'email_shared_title'         => 'Your :content_type Was Shared',
    'email_liked_subtitle'       => ':name liked your :content_type',
    'email_commented_subtitle'   => ':name commented on your :content_type',
    'email_replied_to_comment_subtitle' => ':name replied to your comment on a :content_type',
    'email_shared_subtitle'      => ':name shared your :content_type with their network',
    'email_view_content'         => 'View :content_type',
    'email_view_comment'         => 'View Comment',
    'email_view_reply'           => 'View Reply',

    // =========================================================================
    // IdeationChallengeService
    // =========================================================================
    'ideation_idea_submitted'           => ':name submitted an idea ":title" to your challenge ":challenge"',
    'ideation_idea_voted'               => ':name voted on your idea ":title"',
    'ideation_idea_commented'           => ':name commented on your idea: ":comment"',
    'ideation_idea_status_changed'      => 'Your idea ":title" has been marked as :status',
    'ideation_status_shortlisted'       => 'shortlisted',
    'ideation_status_winner'            => 'a winner',
    'ideation_status_withdrawn'         => 'withdrawn',

    // Ideation email subjects & labels
    'ideation_email_idea_submitted_title'    => 'New Idea Submitted',
    'ideation_email_idea_submitted_subtitle' => ':name submitted an idea to your challenge ":challenge"',
    'ideation_email_idea_voted_title'        => 'New Vote on Your Idea',
    'ideation_email_idea_voted_subtitle'     => ':name voted on your idea',
    'ideation_email_idea_commented_title'    => 'New Comment on Your Idea',
    'ideation_email_idea_commented_subtitle' => ':name commented on your idea',
    'ideation_email_idea_won_title'          => 'Your Idea Won!',
    'ideation_email_idea_status_title'       => 'Idea Status Update',
    'ideation_email_idea_status_subtitle'    => 'Your idea has been marked as :status',
    'ideation_email_view_challenge'          => 'View Challenge',
    'ideation_email_view_idea'               => 'View Idea',

    // Content type labels
    'content_type_post'          => 'post',
    'content_type_listing'       => 'listing',
    'content_type_event'         => 'event',
    'content_type_goal'          => 'goal',
    'content_type_poll'          => 'poll',
    'content_type_resource'      => 'resource',
    'content_type_volunteering'  => 'volunteering opportunity',
    'content_type_volunteering_opportunity' => 'volunteering opportunity',
    'content_type_volunteer'     => 'volunteering opportunity',
    'content_type_review'        => 'review',
    'content_type_blog'          => 'blog post',
    'content_type_blog_post'     => 'blog post',
    'content_type_challenge'     => 'challenge',
    'content_type_ideation_challenge' => 'challenge',
    'content_type_job'           => 'job',
    'content_type_discussion'    => 'discussion',
    'content_type_comment'       => 'comment',
    'content_type_default'       => 'content',

    // =========================================================================
    // JobExpiryNotificationService
    // =========================================================================
    'job_expiring_soon'          => 'Your job ":title" expires in :days day(s). Renew it to keep it visible.',
    'job_expiry_email_heading'   => 'Your job listing is expiring soon',
    'job_expiry_email_body'      => 'Your job <strong>":title"</strong> expires on <strong>:deadline</strong> (:days day(s) from now).',
    'job_expiry_email_cta'       => 'Renew it to keep attracting candidates:',
    'job_expiry_email_button'    => 'View & Renew Job',
    'job_expiry_email_footer'    => "You're receiving this because you posted a job on Project NEXUS.",
    'job_expiry_email_subject'   => 'Your job ":title" is expiring soon',

    // =========================================================================
    // EventNotificationService
    // =========================================================================
    'event_cancelled'            => 'The event ":title" has been cancelled.',
    'event_cancelled_reason'     => 'Reason: :reason',
    'event_updated'              => 'The event ":title" has been updated (:changes)',
    'event_rsvp_going'           => ':name is going to your event: :title',
    'event_rsvp_interested'      => ':name is interested in your event: :title',
    'event_reminder_24h'         => 'Reminder: ":title" is tomorrow — :when:location',
    'event_reminder_1h'          => 'Starting soon: ":title" begins in 1 hour — :when:location',
    'event_reminder_location_online' => '(Online)',
    'event_reminder_location_at' => 'at :location',
    'event_reminder_subject_7d'  => 'Reminder: ":title" is in 7 days',
    'event_reminder_subject_24h' => 'Reminder: ":title" is tomorrow',
    'event_reminder_subject_1h'  => 'Starting soon: ":title" begins in 1 hour',
    'event_update_subject'       => 'Update: ":title"',

    // Event email headings
    'event_email_new_rsvp'       => 'New RSVP!',
    'event_email_cancelled'      => 'Event Cancelled',
    'event_email_updated'        => 'Event Updated',
    'event_email_tomorrow'       => 'Event Tomorrow',
    'event_email_starting_soon'  => 'Starting Soon',
    'event_email_view'           => 'View Event',
    'event_email_view_updated'   => 'View Updated Event',
    'event_email_browse'         => 'Browse Events',
    'event_email_cancel_sorry'   => "We're sorry to let you know that the following event has been cancelled:",
    'event_email_was_scheduled'  => 'Was scheduled for :when',
    'event_email_updated_body'   => 'The event <strong>":title"</strong> has been updated:',
    'event_email_reminder_body'  => 'This is a friendly reminder that <strong>":title"</strong> :time_note.',
    'event_email_happening_tomorrow' => 'is happening tomorrow',
    'event_email_starts_in_hour' => 'starts in about 1 hour',
    'event_email_online'         => 'Online Event',
    'event_email_location'       => 'Location: :location',
    'event_rsvp_status_going'    => 'Going',
    'event_rsvp_status_interested' => 'Interested',
    'event_change_date_time'     => 'date/time',
    'event_change_end_time'      => 'end time',
    'event_change_location'      => 'location',
    'event_change_title'         => 'title',
    'event_change_separator'     => ' and ',

    // =========================================================================
    // NotificationDispatcher — Push titles
    // =========================================================================
    'push_vol_application_received'  => 'New Application',
    'push_vol_application_approved'  => 'Application Approved',
    'push_vol_application_declined'  => 'Application Declined',
    'push_vol_hours_approved'        => 'Hours Approved',
    'push_vol_hours_declined'        => 'Hours Declined',
    'push_vol_hours_pending_review'  => 'Hours Pending Review',
    'push_vol_shift_reminder'        => 'Shift Reminder',
    'push_vol_shift_cancelled'       => 'Shift Cancelled',
    'push_vol_waitlist_promoted'     => 'Waitlist Update',
    'push_vol_swap_requested'        => 'Shift Swap Request',
    'push_vol_swap_approved'         => 'Shift Swap Approved',
    'push_vol_swap_declined'         => 'Shift Swap Declined',
    'vol_application_fallback_opportunity' => 'a volunteer opportunity',
    'vol_application_received_body'  => ':name applied for your volunteer opportunity: :title',
    'vol_application_approved_body'  => 'Your volunteer application for ":title" was accepted!',
    'vol_application_declined_body'  => 'Your volunteer application for ":title" was not accepted',
    'vol_shift_signup_body'          => ':name signed up for a shift',
    'vol_hours_approved_paid_body'   => 'Your :hours h were approved and :hours time credits added to your wallet!',
    'vol_hours_approved_unpaid_body' => 'Your :hours h were approved! Time credits will be paid when the organization funds their wallet.',
    'vol_hours_org_wallet_insufficient_body' => 'Approved :hours h for a volunteer but your org wallet has insufficient balance. Please fund your wallet.',
    'vol_hours_approved_body'        => 'Your :hours h of volunteering were approved!',
    'vol_hours_approved_no_credit_body' => 'Your :hours h were approved, but that is under an hour so no time credit was added.',
    'vol_hours_declined_body'        => 'Your :hours h volunteering log was declined.',
    'push_new_topic'                 => 'New Post',
    'push_new_reply'                 => 'New Reply',
    'push_mention'                   => 'You Were Mentioned',
    'push_hot_match'                 => 'Hot Match Found',
    'push_mutual_match'              => 'Mutual Match Found',
    'push_default'                   => 'New Notification',
    'push_private_body'              => 'Open Timebank Global to view this private update.',

    'push_marketplace_enforcement' => 'Update on your listing',
    'push_feed_report_created' => 'New content report',
    'push_social_report_created' => 'New content report',
    'push_listing_report_created' => 'New listing report',
    'push_marketplace_report_filed' => 'Marketplace report (DSA)',
    'push_job_flagged_spam' => 'Job flagged for review',
    'push_safeguarding_assigned' => 'Safeguarding report assigned',
    'push_safeguarding_escalated' => 'Report escalated',
    'push_new_message' => 'New Message',
    'push_connection_request' => 'New Connection Request',
    'push_connection_accepted' => 'Connection Accepted',
    'push_gdpr_request' => 'New GDPR request',
    'push_gdpr_account_deletion' => 'Account deleted',
    'push_gdpr_data_export' => 'Data export',
    'push_gdpr_consent' => 'Consent updated',
    // =========================================================================
    // NotificationDispatcher — Match notifications
    // =========================================================================
    'hot_match_content'          => 'Hot Match! :name posted ":title" - :score% match:distance',
    'mutual_match_content'       => 'Mutual Match! :name can help you with :they_offer, and you can help them with :you_offer',
    'match_digest_content'       => 'Your :period match digest: :count new matches',
    'match_digest_hot'           => ', :count hot',
    'match_digest_mutual'        => ', :count mutual',
    'match_approval_request'     => 'Match needs approval: :name matched with ":title"',
    'match_approved'             => 'Great news! You\'ve been matched with ":title"',
    'match_rejected'             => 'Match update: ":title" wasn\'t suitable at this time',
    'match_rejected_reason'      => '. Reason: :reason',

    // =========================================================================
    // NotificationDispatcher — Exchange notifications
    // =========================================================================
    'exchange_request_received'      => 'New exchange request for your listing',
    'exchange_request_declined'      => 'Your exchange request was declined',
    'exchange_request_declined_reason' => 'Your exchange request was declined: :reason',
    'exchange_approved'              => 'Your exchange has been approved! You can now begin.',
    'exchange_rejected'              => 'Exchange was not approved',
    'exchange_rejected_reason'       => 'Exchange was not approved: :reason',
    'exchange_completed'             => 'Exchange completed! :hours hours transferred.',
    'exchange_cancelled'             => 'Exchange was cancelled',
    'exchange_disputed'              => 'Exchange has conflicting hour confirmations - broker review needed',
    'exchange_problem_reported' => 'A problem was reported with your exchange. A coordinator will review it.',
    'exchange_accepted'              => 'Your exchange request was accepted! You can now coordinate the service.',
    'exchange_pending_broker'        => 'Exchange accepted - awaiting coordinator approval',
    'exchange_started'               => 'Exchange has started! Service is now in progress.',
    'exchange_ready_confirmation'    => 'Exchange complete - please confirm :hours hours worked',
    'listing_risk_tagged'            => "Listing ':title' tagged as :level risk",
    'credit_received'                => ':name sent you :amount hour(s)',
    'credit_received_for'            => 'for ":description"',

    // Exchange email subjects
    'exchange_email_request_received'   => 'New exchange request for ":title"',
    'exchange_email_request_declined'   => 'Exchange request declined',
    'exchange_email_approved'           => 'Exchange approved by coordinator - Ready to begin!',
    'exchange_email_rejected'           => 'Exchange not approved',
    'exchange_email_completed'          => 'Exchange completed - Hours transferred!',
    'exchange_email_cancelled'          => 'Exchange cancelled',
    'exchange_email_disputed'           => 'Exchange needs broker review',
    'exchange_email_accepted'           => 'Your exchange request was accepted!',
    'exchange_email_pending_broker'     => 'Exchange accepted - Awaiting coordinator approval',
    'exchange_email_started'            => 'Exchange started - Service in progress',
    'exchange_email_ready_confirmation' => 'Action needed: Confirm your exchange hours',
    'exchange_email_default'            => 'Exchange update',

    // Exchange email titles & messages
    'exchange_title_request_received'    => 'New Exchange Request',
    'exchange_title_request_declined'    => 'Request Declined',
    'exchange_title_approved'            => 'Exchange Approved!',
    'exchange_title_rejected'            => 'Exchange Not Approved',
    'exchange_title_completed'           => 'Exchange Completed!',
    'exchange_title_cancelled'           => 'Exchange Cancelled',
    'exchange_title_disputed'            => 'Exchange Needs Review',
    'exchange_title_accepted'            => 'Request Accepted!',
    'exchange_title_pending_broker'      => 'Awaiting Coordinator Approval',
    'exchange_title_started'             => 'Exchange Started!',
    'exchange_title_ready_confirmation'  => 'Confirm Your Hours',
    'exchange_title_default'             => 'Exchange Update',

    'exchange_msg_request_received'      => '<strong>:name</strong> would like to exchange services with you! They\'ve proposed <strong>:hours hour(s)</strong> for this exchange.',
    'exchange_msg_request_declined'      => 'Unfortunately, <strong>:name</strong> has declined your exchange request.',
    'exchange_msg_approved'              => 'Great news! Your exchange has been approved by a coordinator. You can now begin the service exchange.',
    'exchange_msg_rejected'              => 'A coordinator has reviewed this exchange and was unable to approve it at this time.',
    'exchange_msg_completed'             => 'Congratulations! Your exchange has been completed successfully. <strong>:hours hour(s)</strong> have been transferred.',
    'exchange_msg_cancelled'             => 'This exchange has been cancelled.',
    'exchange_msg_disputed'              => "There's a discrepancy in the hours confirmed by both parties. A coordinator will review this exchange and help resolve the difference.",
    'exchange_msg_accepted'              => 'Great news! <strong>:name</strong> has accepted your exchange request. You can now coordinate when and where the service will take place.',
    'exchange_msg_pending_broker'        => 'The provider has accepted your request! Before you can begin, a community coordinator needs to review and approve this exchange.',
    'exchange_msg_started'               => 'The exchange is now in progress! The service is being provided.',
    'exchange_msg_ready_confirmation'    => 'The exchange has been marked as complete! Please confirm the number of hours worked so the time credits can be transferred.',
    'exchange_msg_default'               => 'There has been an update to your exchange.',

    'exchange_btn_review'                => 'Review Request',
    'exchange_btn_browse'                => 'Browse Other Listings',
    'exchange_btn_start'                 => 'Start Exchange',
    'exchange_btn_view'                  => 'View Details',
    'exchange_btn_view_exchange'         => 'View Exchange',
    'exchange_btn_view_wallet'           => 'View in Wallet',
    'exchange_btn_confirm'               => 'Confirm Hours',

    'exchange_help_review'               => 'You can accept or decline this request from your exchanges dashboard.',
    'exchange_help_declined'             => "Don't worry - there are plenty of other members who might be a great match!",
    'exchange_help_approved'             => 'Once you begin, remember to confirm the hours when the service is complete.',
    'exchange_help_rejected'             => 'If you have questions about this decision, please contact your community coordinator.',
    'exchange_help_completed'            => 'Thank you for being an active member of our time-sharing community!',
    'exchange_help_cancelled'            => 'No time credits have been transferred.',
    'exchange_help_disputed'             => 'A coordinator will be in touch to help resolve this. No action is needed from you right now.',
    'exchange_help_accepted'             => 'Contact the provider to arrange the details of your exchange.',
    'exchange_help_pending_broker'       => "You'll receive another notification once the coordinator has reviewed your exchange.",
    'exchange_help_started'              => 'When the service is complete, both parties will need to confirm the hours worked.',
    'exchange_help_ready_confirmation'   => 'Both parties need to confirm the hours before credits are transferred.',
    'exchange_help_default'              => 'Visit your dashboard to see the latest details.',

    'exchange_next_contact'              => 'Contact the other party to arrange when and where the service will take place.',
    'exchange_next_done'                 => 'Your time credit balance has been updated. Consider leaving a review for the other member!',
    'exchange_next_message'              => 'Message :name to arrange when and where the service will happen.',
    'exchange_next_mark_done'            => 'When the service is complete, mark it as done and confirm the actual hours worked.',
    'exchange_next_confirm_asap'         => 'Please confirm the hours as soon as possible so the other party receives their time credits.',
    'exchange_why_approval'              => 'Some exchanges require coordinator review to ensure safety and suitability for all members.',
    'exchange_under_review'              => 'A coordinator will review the confirmed hours and make a fair decision.',
    'exchange_reason_provided'           => 'Reason provided:',
    'exchange_coordinator_note'          => "Coordinator's note:",

    // =========================================================================
    // NotificationDispatcher — Credit & Review emails
    // =========================================================================
    'credit_received_heading'    => 'You received time credits!',
    'credit_received_body'       => '<strong>:sender</strong> has sent you <strong>:amount</strong> on :tenant.',
    'credit_email_subject'       => ':sender sent you :amount on :tenant',
    'credit_view_wallet'         => 'View Your Wallet',
    'credit_footer'              => ':tenant — Time credits that strengthen communities',

    'review_received_in_app'     => ':name left you a :rating-star review',
    'review_received_heading'    => 'New Review Received!',
    'review_received_body'       => '<strong>:reviewer</strong> has left you a review on :tenant.',
    'review_email_subject'       => ':reviewer left you a :rating-star review on :tenant',
    'review_what_they_said'      => 'What they said',
    'review_out_of_stars'        => ':rating out of 5 stars',
    'review_view_profile'        => 'View Your Profile',
    'review_email_sent_by'       => 'This email was sent by :tenant',

    // =========================================================================
    // NotificationDispatcher — Identity verification
    // =========================================================================
    'verification_passed'            => 'Your identity has been verified successfully.',
    'verification_failed'            => 'Your identity verification was unsuccessful.',
    'verification_failed_reason'     => 'Your identity verification was unsuccessful. Reason: :reason',
    'verification_passed_admin'      => 'Identity verification passed for :name (:email)',
    'verification_failed_admin'      => 'Identity verification failed for :name (:email)',
    'verification_reminder'          => "You haven't completed identity verification yet. Please verify your identity to activate your account.",
    'verification_reminder_heading'  => 'Verification Reminder',
    'verification_reminder_body'     => "You started registering but haven't completed identity verification yet. Please verify your identity to activate your account.",
    'verification_reminder_cta'      => 'Complete Verification',
    'verification_passed_heading'    => 'Identity Verified',
    'verification_passed_body'       => 'Your identity has been successfully verified. Your account is now active and ready to use.',
    'verification_passed_cta'        => 'Go to Dashboard',
    'verification_failed_heading'    => 'Verification Unsuccessful',
    'verification_failed_body'       => 'We were unable to verify your identity. You may retry the verification process or contact support for assistance.',
    'verification_failed_cta'        => 'Retry Verification',

    // =========================================================================
    // NotificationDispatcher — Match email headings
    // =========================================================================
    'match_hot_heading'              => 'Hot Match Found!',
    'match_hot_subheading'           => 'A :score% compatible listing just appeared',
    'match_hot_posted_by'            => 'Posted by :name',
    'match_mutual_heading'           => 'Mutual Match!',
    'match_mutual_subheading'        => 'A perfect exchange opportunity',
    'match_mutual_exchange_with'     => 'Exchange with :name',
    'match_mutual_they_help'         => 'They can help you with:',
    'match_mutual_you_help'          => 'You can help them with:',
    'match_approval_heading'         => 'Match Needs Approval',
    'match_approval_body'            => 'A new match is waiting for your approval:',
    'match_approval_member'          => 'Member:',
    'match_approval_listing'         => 'Matched with listing:',
    'match_approval_review_note'     => 'Please review this match to ensure the member is suitable (mobility, health considerations) and the activity is within insurance coverage.',
    'match_approval_review_cta'      => 'Review Match',
    'match_approved_heading'         => "You've Been Matched!",
    'match_approved_body'            => 'Great news! A coordinator has approved a match for you:',
    'match_approved_cta_note'        => 'Click below to view the listing and get in touch with the member.',
    'match_approved_cta'             => 'View Match',
    'match_rejected_heading'         => 'Match Update',
    'match_rejected_body'            => "Unfortunately, a coordinator has determined that the following match wasn't suitable at this time:",
    'match_rejected_encouragement'   => "Don't worry - there are plenty of other opportunities in your community! Browse more matches to find a good fit.",
    'match_rejected_cta'             => 'Browse Matches',

    // Exchange type badges
    'exchange_type_offering'         => 'Offering',
    'exchange_type_requesting'       => 'Requesting',

    // Common labels
    'label_service'                  => 'Service',
    'label_requester'                => 'Requester',
    'label_provider'                 => 'Provider',
    'label_proposed_hours'           => 'Proposed Hours',
    'label_approved_hours'           => 'Approved Hours',
    'label_agreed_hours'             => 'Agreed Hours',
    'label_expected_hours'           => 'Expected Hours',
    'label_hours_transferred'        => 'Hours Transferred',
    'label_requester_confirmed'      => 'Requester confirmed',
    'label_provider_confirmed'       => 'Provider confirmed',
    'label_reason'                   => 'Reason:',
    'label_next_step'                => 'Next step:',
    'label_well_done'                => 'Well done!',
    'label_remember'                 => 'Remember:',
    'label_action_needed'            => 'Action needed:',
    'label_why_approval'             => 'Why approval?',
    'label_under_review'             => 'Under review:',

    // Event + ideation notifications (hardcoded-string audit — 2026-04-20)
    'event_created_confirmation'     => ':title has been created',
    'event_attendee_confirmation'    => 'You are confirmed for :title',
    'ideation_status_under_review'   => 'under review',
    'ideation_status_approved'       => 'approved',
    'ideation_status_rejected'       => 'rejected',
    'ideation_status_implemented'    => 'implemented',
    'appreciation_someone'            => 'Someone',
    'appreciation_received'           => ':name sent you a thank-you note',

    'caring_caregiver_link_requested' => ':name asked to be linked as your caregiver. Review the request before any caregiver access is granted.',
    'caring_caregiver_link_confirmed' => 'The care recipient confirmed the caregiver-link request. It is waiting for staff safeguarding review.',
    'caring_caregiver_link_approved'  => 'The caregiver relationship was approved. Caregiver tools are now available for this relationship.',
    'caring_caregiver_link_rejected'  => 'The caregiver relationship was not approved. Reason: :reason',

    'marketplace' => [
        'low_stock' => 'Low stock for ":title" (:count remaining).',
        'restocked' => '":title" is back in stock.',
    ],

    // Digest period words (interpolated into match_digest_content)
    'period_daily' => 'daily',
    'period_weekly' => 'weekly',
    'period_fortnightly' => 'fortnightly',
    'period_monthly' => 'monthly',
];
