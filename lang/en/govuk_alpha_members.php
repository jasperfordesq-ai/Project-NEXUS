<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'nav' => [
        'reputation' => 'Reputation and recognition',
    ],

    // Quick-filter links wired into the core members directory + the two new
    // directory variants (Recommended / Near me).
    'filters' => [
        'heading' => 'Quick filters',
        'all' => 'All members',
        'new' => 'New members',
        'active' => 'Most active',
        'recommended' => 'Recommended',
        'near_me' => 'Members near me',
        'directory' => 'Full directory',
    ],

    // "Recommended members" directory (React ?sort=communityrank).
    'discover' => [
        'title' => 'Recommended members',
        'heading' => 'Recommended members',
        'description' => 'Members ranked by their recent activity, contribution and standing in this community.',
        'algorithm_note' => 'Ordering uses the CommunityRank algorithm: recent activity, hours contributed, reputation, connections and proximity.',
        'search_label' => 'Search recommended members',
        'search_hint' => 'Search by member or organisation name.',
        'results_title' => 'Results',
        'rank_score_label' => 'Community rank',
        'rank_score' => ':percent% match',
        'rank_score_aria' => 'Community rank score :percent per cent',
        'empty' => 'No recommended members to show yet.',
        'disabled_title' => 'Recommendations are not available',
        'disabled_detail' => 'This community has not enabled member recommendations. Browse the full directory instead.',
        'error_detail' => 'Recommended members could not be loaded. Try again.',
        'more_results_label' => 'More recommended members',
    ],

    // "Members near me" directory (React /v2/members/nearby).
    'nearby' => [
        'title' => 'Members near me',
        'heading' => 'Members near me',
        'description' => 'Members within the chosen distance of the location saved on your profile.',
        'radius_label' => 'Distance',
        'search_label' => 'Search nearby members',
        'search_hint' => 'Search by member or organisation name.',
        'results_title' => 'Results',
        'distance_label' => 'Distance',
        'distance' => ':distance km away',
        'empty' => 'No members found within this distance.',
        'no_location_title' => 'Add your location first',
        'no_location_detail' => 'Add a location to your profile to find members near you.',
        'edit_profile' => 'Update your profile',
        'error_detail' => 'Nearby members could not be loaded. Try again.',
        'more_results_label' => 'More nearby members',
    ],

    'insights' => [
        // Page chrome
        'title' => 'Reputation and recognition - :name',
        'heading' => 'Reputation and recognition',
        'unknown_member' => 'this member',
        'back_to_profile' => 'Back to profile',
        'intro_own' => 'A summary of your standing in the community: your NEXUS score, activity totals, verifications and earned badges.',
        'intro_other' => 'A summary of :name’s standing in the community: NEXUS score, activity totals, verifications and earned badges.',

        // NEXUS score
        'nexus_score_title' => 'NEXUS score',
        'nexus_score_out_of' => 'out of 1,000',
        'nexus_percentile' => 'Top :percentile% of members in this community.',
        'nexus_percentile_aria' => 'Ranked in the top :percentile per cent of members',
        'nexus_own_hint' => 'Your NEXUS score reflects your engagement, contribution quality and impact across the community.',
        'nexus_empty' => 'No NEXUS score has been calculated yet. Take part in the community to build one.',

        // NEXUS tiers (match NexusScoreService thresholds)
        'tier_novice' => 'Novice',
        'tier_beginner' => 'Beginner',
        'tier_developing' => 'Developing',
        'tier_intermediate' => 'Intermediate',
        'tier_proficient' => 'Proficient',
        'tier_advanced' => 'Advanced',
        'tier_expert' => 'Expert',
        'tier_elite' => 'Elite',
        'tier_legendary' => 'Legendary',

        // Stats grid
        'stats_title' => 'Activity',
        'stat_hours_given' => 'Hours given',
        'stat_hours_received' => 'Hours received',
        'stat_listings' => 'Active listings',
        'stat_groups' => 'Groups joined',
        'stat_events' => 'Events attended',
        'stat_connections' => 'Connections',
        'stat_reviews' => 'Reviews received',
        'stat_rating' => 'Average rating',
        'stat_level' => 'Level',
        'stat_xp' => 'Experience points',

        // Verification badges
        'verification_title' => 'Verifications',
        'verification_intro' => 'Checks completed for this member.',
        'verification_empty' => 'No verifications have been recorded yet.',
        'verified_on' => 'Verified on :date',
        'verification_type_email_verified' => 'Email verified',
        'verification_type_phone_verified' => 'Phone verified',
        'verification_type_id_verified' => 'ID verified',
        'verification_type_address_verified' => 'Address verified',
        'verification_type_admin_verified' => 'Admin verified',
        'verification_type_background_check' => 'Background check verified',
        'verification_type_organization_vouched' => 'Organisation vouched',
        'verification_type_peer_endorsed' => 'Peer endorsed',

        // Earned badges
        'badges_title' => 'Earned badges',
        'badges_empty' => 'No badges earned yet.',
    ],
    'matches_safeguarding' => [
        'banner_title' => 'Some matches are hidden',
        'banner_body' => 'Your community\'s safeguarding setup isn\'t finished, so matches involving protected members are hidden to keep everyone safe.',
        'empty_title' => 'Some matches can\'t be shown yet',
        'empty_body' => 'Your community\'s safeguarding setup isn\'t finished, so matches involving protected members are hidden to keep everyone safe. Please check back once your community team has completed it.',
    ],
];
