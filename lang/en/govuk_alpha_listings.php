<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    // ---- Navigation links (added by nav-consolidation) ----------------
    'nav' => [
        'view_analytics' => 'View listing analytics',
    ],
    // Skill tags on the create/edit listing forms (no-JS CSV field).
    'create' => [
        'skill_tags_label' => 'Skills (optional)',
        'skill_tags_hint' => 'List the skills involved, separated by commas — for example: gardening, cooking, tax advice. You can add up to 10.',
        'hours_available_label' => 'Hours available',
        'hours_available_hint' => 'Total hours you are willing to give. Leave blank for no limit.',
        'hours_available_range' => 'Hours available must be at least 0.5.',
        'hours_available_below_estimate' => 'Hours available cannot be less than the estimated hours.',
        'remove_image_label' => 'Remove the current photo',
        'remove_image_failed' => 'the photo could not be removed',
        'image_alt_label' => 'Describe the photo (optional)',
        'image_alt_hint' => 'If you add a photo, say in a few words what it shows. Screen readers read this out.',
    ],
    // Gap #12 — owner-only listing analytics panel.
    'analytics' => [
        'title' => 'Listing analytics',
        'caption' => 'Insights',
        'description' => 'See how members are finding and responding to this listing.',
        'back_to_listing' => 'Back to listing',
        'view_listing' => 'View listing',
        'edit_listing' => 'Edit listing',
        'owner_only' => 'Only the listing owner can view these analytics.',
        'period_legend' => 'Time period',
        'period_hint' => 'Choose how many recent days to include.',
        'period_days' => 'Last :count days',
        'period_submit' => 'Update period',
        'no_data' => 'There is no analytics data for this listing yet. Check back once members start viewing it.',

        // Key metrics
        'key_metrics_heading' => 'Key metrics',
        'total_views' => 'Total views',
        'unique_viewers' => 'Unique viewers',
        'total_contacts' => 'Total contacts',
        'total_saves' => 'Times saved',
        'contact_rate' => 'Contact rate',
        'save_rate' => 'Save rate',
        'views_trend' => '7-day views trend',
        'trend_up' => 'Up :percent% on the previous 7 days',
        'trend_down' => 'Down :percent% on the previous 7 days',
        'trend_flat' => 'No change on the previous 7 days',

        // Views over time
        'views_over_time' => 'Views over time',
        'no_views_yet' => 'No views recorded in this period yet.',
        'views_on_date' => 'Views on :date',
        'count_column' => 'Count',

        // Contacts over time
        'contacts_over_time' => 'Contacts over time',
        'no_contacts_yet' => 'No contacts recorded in this period yet.',
        'contacts_on_date' => 'Contacts on :date',

        // Contact types breakdown
        'contact_types_heading' => 'How members got in touch',
        'no_contact_types' => 'No contacts have been made yet.',
        'contact_type_label' => 'Method',
        'contact_type_message' => 'Message',
        'contact_type_phone' => 'Phone',
        'contact_type_email' => 'Email',
        'contact_type_exchange_request' => 'Exchange request',

        // Dates
        'listing_created' => 'Listing created',
        'listing_expires' => 'Listing expires',
    ],

    // ---- Listing detail extras (delete, comments link, author badges) ----
    'detail' => [
        'like' => 'Like',
        'unlike' => 'Liked',
        'likes_count' => '{0} No likes yet|{1} :count like|[2,*] :count likes',
        'delete_heading' => 'Delete this listing',
        'delete_warning' => 'Deleting this listing cannot be undone. It will be removed for everyone.',
        'delete_button' => 'Delete listing',
        'comments_link' => 'View and add comments',
        'comments_link_count' => 'View and add comments (:count)',
        'author_badges_heading' => 'Verified',
    ],

    // ---- Verification badge labels (mirrors MemberVerificationBadgeService) ----
    'badges' => [
        'email_verified' => 'Email verified',
        'phone_verified' => 'Phone verified',
        'id_verified' => 'ID verified',
        'address_verified' => 'Address verified',
        'admin_verified' => 'Admin verified',
        'background_check' => 'Background check verified',
        'organization_vouched' => 'Organisation vouched',
        'peer_endorsed' => 'Peer endorsed',
    ],

    // ---- Comment thread ----------------------------------------------------
    'comments' => [
        'title' => 'Comments',
        'caption' => 'Listing',
        'back_to_listing' => 'Back to listing',
        'heading' => 'Comments',
        'empty' => 'No comments yet. Be the first to start the conversation.',
        'add_heading' => 'Add a comment',
        'body_label' => 'Your comment',
        'body_hint' => 'Be kind and keep it relevant to this listing.',
        'submit' => 'Post comment',
        'edited' => 'Edited',
        'states' => [
            'comment-added' => 'Your comment has been posted.',
            'reply-added' => 'Your reply has been posted.',
            'comment-invalid' => 'Enter a comment before posting.',
            'comment-failed' => 'Your comment could not be posted. Please try again.',
        ],
    ],

    // ---- AI description helper (create / edit forms) -----------------------
    'ai' => [
        'heading' => 'Need help writing a description?',
        'hint' => 'Add a title first, then generate a suggested description you can edit before saving.',
        'generate_button' => 'Generate a description with AI',
        'regenerate_button' => 'Generate a new suggestion',
        'states' => [
            'ai-generated' => 'We have suggested a description below. Review and edit it before you save.',
            'ai-title-required' => 'Add a title before generating a description.',
            'ai-failed' => 'We could not generate a description right now. Please write one yourself or try again later.',
            'ai-disabled' => 'AI description suggestions are not available on this community.',
        ],
    ],
    // React ListingForm optional service details (folded into the description).
    'service_details' => [
        'not_specified' => 'Not specified',
        'toggle' => 'Optional service details',
        'experience_label' => 'Experience',
        'experience_beginner' => 'Beginner-friendly',
        'experience_some' => 'Some experience helpful',
        'experience_experienced' => 'Experienced practitioner',
        'experience_professional' => 'Professional / certified',
        'equipment_label' => 'Equipment',
        'equipment_provided' => 'I\'ll provide everything needed',
        'equipment_partial' => 'Some things needed from you',
        'equipment_bring_own' => 'You\'ll need to provide your own',
        'equipment_na' => 'Not applicable',
        'accessibility_label' => 'Accessibility Notes',
        'accessibility_hint' => 'e.g., Wheelchair accessible, hearing loop available',
        'accessibility_max_length' => 'Accessibility notes must be 200 characters or fewer',
    ],
    // Listing form messages that were hard-coded English until 29 Oct 2026.
    'form_messages' => [
        'location_max' => 'Location must be 255 characters or fewer',
        'service_type_required' => 'Select how the service will be delivered',
        'image_type' => 'The image must be a JPEG, PNG, GIF or WebP file',
        'image_size' => 'The image must be :max MB or smaller',
        'saved_no_id' => 'Your listing was saved, but we could not open it. You can find it in My listings.',
        'created_tags_failed' => 'Your listing was created, but its skills could not be saved. Edit the listing to try again.',
        'created_image_failed' => 'Your listing was created, but its image could not be uploaded. Edit the listing to try again.',
        'updated_tags_failed' => 'Your listing was updated, but its skills could not be saved. Try again.',
        'updated_image_failed' => 'Your listing was updated, but its image could not be uploaded. Try again.',
        'updated_photo_remove_failed' => 'Your listing was updated, but its photo could not be removed. Try again.',
    ],
];
