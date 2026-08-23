<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'states' => [
        'success_title' => 'Success',
        'error_title' => 'There is a problem',
    ],

    'nav' => [
        'heading' => 'Achievements and rewards',
        'achievements' => 'Achievements',
        'shop' => 'XP shop',
        'collections' => 'Collections',
        'showcase' => 'Showcase badges',
        'engagement' => 'Engagement history',
        'leaderboard_heading' => 'Leaderboard',
        'competitive' => 'Competitive',
        'seasons' => 'Seasons',
        'journey' => 'My journey',
        'spotlight' => 'Member spotlight',
        'tiers' => 'Tier ladder',
        'tiers_related_heading' => 'NEXUS score',
        'create_poll' => 'Create a poll',
        'manage_polls' => 'Manage my polls',
        'ranked_tag' => 'Ranked choice',
        'rank_this_poll' => 'Rank this poll',
        'view_ranked_poll' => 'View ranked results',
        'view_and_discuss' => 'View and discuss',
    ],

    'common' => [
        'back_to_achievements' => 'Back to achievements',
        'back_to_leaderboard' => 'Back to leaderboard',
        'back_to_nexus_score' => 'Back to NEXUS score',
        'back_to_polls' => 'Back to polls',
        'you' => 'You',
        'earned' => 'Earned',
        'locked' => 'Locked',
        'unknown_member' => 'Community member',
    ],

    // ---------------------------------------------------------------
    //  XP SHOP
    // ---------------------------------------------------------------
    'shop' => [
        'title' => 'XP shop',
        'caption' => 'Achievements at :community',
        'description' => 'Spend the experience points you have earned on cosmetic badges, profile perks and features.',
        'balance_label' => 'Your XP balance',
        'balance_value' => ':xp XP',
        'empty' => 'There are no items in the shop yet. Check back soon.',
        'cost' => ':xp XP',
        'owned' => 'Owned',
        'out_of_stock' => 'Out of stock',
        'cannot_afford' => 'Not enough XP',
        'buy_button' => 'Buy for :xp XP',
        'type_badge' => 'Badge',
        'type_perk' => 'Perk',
        'type_feature' => 'Feature',
        'type_cosmetic' => 'Cosmetic',
        'warning' => 'Buying an item spends your XP. This cannot be undone.',
        'states' => [
            'purchased' => 'Purchase complete. The item is now yours.',
            'purchase-failed' => 'We could not complete that purchase. You may not have enough XP, or the item may be out of stock.',
        ],
    ],

    // ---------------------------------------------------------------
    //  COLLECTIONS
    // ---------------------------------------------------------------
    'collections' => [
        'title' => 'Badge collections',
        'caption' => 'Achievements at :community',
        'description' => 'Complete a collection by earning every badge in it to unlock a bonus XP reward.',
        'empty' => 'There are no badge collections yet.',
        'progress' => ':earned of :total badges',
        'reward' => 'Reward: :xp XP',
        'completed' => 'Completed',
        'bonus_claimed' => 'Bonus claimed',
    ],

    // ---------------------------------------------------------------
    //  SHOWCASE
    // ---------------------------------------------------------------
    'showcase' => [
        'title' => 'Showcase badges',
        'caption' => 'Achievements at :community',
        'description' => 'Choose up to 5 of your earned badges to feature on your profile.',
        'legend' => 'Select up to 5 badges to showcase',
        'hint' => 'Tick a badge to show it on your profile. You can change this at any time.',
        'empty' => 'You have not earned any badges yet. Earn badges to showcase them here.',
        'save_button' => 'Save showcase',
        'currently_showcased' => 'Currently showcased',
        'states' => [
            'showcase-updated' => 'Your showcase has been updated.',
            'showcase-failed' => 'We could not update your showcase. Please try again.',
            'showcase-too-many' => 'You can showcase a maximum of 5 badges. Please deselect some.',
            'showcase-not-owned' => 'You can only showcase badges you have earned.',
        ],
    ],

    // ---------------------------------------------------------------
    //  BADGE DETAIL
    // ---------------------------------------------------------------
    'badge' => [
        'title' => 'Badge',
        'caption' => 'Achievements at :community',
        'earned_status' => 'You have earned this badge',
        'not_earned_status' => 'You have not earned this badge yet',
        'earned_on' => 'Earned on :date',
        'rarity_label' => 'Rarity',
        'xp_value_label' => 'XP value',
        'tier_label' => 'Tier',
        'type_label' => 'Category',
        'showcased' => 'Showcased on your profile',
        'view_all' => 'View all achievements',
    ],

    // ---------------------------------------------------------------
    //  ENGAGEMENT HISTORY
    // ---------------------------------------------------------------
    'engagement' => [
        'title' => 'Engagement history',
        'caption' => 'Achievements at :community',
        'description' => 'Your community activity over the last 12 months.',
        'empty' => 'There is no engagement history to show yet.',
        'month_column' => 'Month',
        'active_column' => 'Active',
        'activity_column' => 'Activities',
        'active_yes' => 'Active',
        'active_no' => 'Inactive',
        'activities_count' => '{0} no activities|{1} 1 activity|[2,*] :count activities',
    ],

    // ---------------------------------------------------------------
    //  COMPETITIVE LEADERBOARD
    // ---------------------------------------------------------------
    'competitive' => [
        'title' => 'Competitive leaderboard',
        'caption' => 'Leaderboard at :community',
        'description' => 'See how members rank across experience points, volunteer hours, credits earned and NEXUS score.',
        'metric_label' => 'Metric',
        'period_label' => 'Period',
        'apply' => 'Update leaderboard',
        'filter_heading' => 'Filter the leaderboard',
        'your_rank' => 'Your rank: :rank',
        'your_rank_none' => 'You are not yet ranked for this metric.',
        'empty' => 'There are no ranked members for this metric yet.',
        'rank_column' => 'Rank',
        'member_column' => 'Member',
        'score_column' => 'Score',
        'metrics' => [
            'xp' => 'Experience points',
            'volunteer_hours' => 'Volunteer hours',
            'credits_earned' => 'Credits earned',
            'nexus_score' => 'NEXUS score',
        ],
        'periods' => [
            'all' => 'All time',
            'season' => 'This season',
            'month' => 'This month',
            'week' => 'This week',
        ],
        'season_card_title' => 'Active season',
        'season_days_remaining' => '{0} ends today|{1} 1 day remaining|[2,*] :count days remaining',
        'season_participants' => '{0} no participants|{1} 1 participant|[2,*] :count participants',
        'season_view_all' => 'View all seasons',
        'showing_count' => '{0} No members shown|{1} Showing 1 member|[2,*] Showing :count members',
        'load_more' => 'Load more members',
    ],

    // ---------------------------------------------------------------
    //  SEASONS
    // ---------------------------------------------------------------
    'seasons' => [
        'title' => 'Leaderboard seasons',
        'caption' => 'Leaderboard at :community',
        'description' => 'Each season resets the leaderboard so everyone has a fresh chance to compete.',
        'current_heading' => 'Current season',
        'no_current' => 'There is no active season at the moment.',
        'date_range' => ':start to :end',
        'days_remaining' => '{0} ends today|{1} 1 day remaining|[2,*] :count days remaining',
        'ending_soon' => 'Ending soon',
        'participants' => '{0} no participants|{1} 1 participant|[2,*] :count participants',
        'your_rank' => 'Your rank: :rank',
        'your_xp' => 'Your season XP: :xp',
        'rewards_heading' => 'Season rewards',
        'no_rewards' => 'No rewards have been set for this season.',
        'reward_row' => 'Rank :rank',
        'top_members' => 'Season leaders',
        'rank_column' => 'Rank',
        'member_column' => 'Member',
        'xp_column' => 'Season XP',
        'history_heading' => 'Past seasons',
        'no_history' => 'There are no past seasons yet.',
        'season_name_column' => 'Season',
        'period_column' => 'Period',
    ],

    // ---------------------------------------------------------------
    //  PERSONAL JOURNEY
    // ---------------------------------------------------------------
    'journey' => [
        'title' => 'My journey',
        'caption' => 'Leaderboard at :community',
        'description' => 'A timeline of your activity, milestones and progress in the community.',
        'empty' => 'There is nothing to show on your journey yet. Get involved to build your timeline.',
        'summary_heading' => 'Summary',
        'milestones_heading' => 'Milestones',
        'no_milestones' => 'You have not reached any milestones yet.',
        'activity_heading' => 'Monthly activity',
        'no_activity' => 'No monthly activity recorded yet.',
        'month_column' => 'Month',
        'activity_column' => 'Activities',
        'badges_heading' => 'Badge progression',
        'no_badges' => 'No badge progression recorded yet.',
    ],

    // ---------------------------------------------------------------
    //  MEMBER SPOTLIGHT
    // ---------------------------------------------------------------
    'spotlight' => [
        'title' => 'Member spotlight',
        'caption' => 'Leaderboard at :community',
        'description' => 'A daily rotating look at active members of the community.',
        'empty' => 'There are no featured members to show today.',
        'member_since' => 'Member since :date',
        'level' => 'Level :level',
        'xp' => ':xp XP',
        'view_profile' => 'View profile',
    ],

    // ---------------------------------------------------------------
    //  NEXUS TIER LADDER
    // ---------------------------------------------------------------
    'tiers' => [
        'title' => 'NEXUS tier ladder',
        'caption' => 'NEXUS score at :community',
        'description' => 'There are 9 tiers. Your tier rises as your NEXUS score grows.',
        'unavailable' => 'Your NEXUS score is not available yet.',
        'current_tier' => 'Current tier: :tier',
        'your_score' => 'Your score: :score of :max',
        'points_to_next' => ':points points to :tier',
        'top_tier' => 'You have reached the top tier.',
        'tier_column' => 'Tier',
        'threshold_column' => 'Score needed',
        'status_column' => 'Status',
        'status_current' => 'Current',
        'status_reached' => 'Reached',
        'status_locked' => 'Locked',
        'names' => [
            'novice' => 'Novice',
            'beginner' => 'Beginner',
            'developing' => 'Developing',
            'intermediate' => 'Intermediate',
            'proficient' => 'Proficient',
            'advanced' => 'Advanced',
            'expert' => 'Expert',
            'elite' => 'Elite',
            'legendary' => 'Legendary',
        ],
    ],

    // ---------------------------------------------------------------
    //  RANKED POLLS
    // ---------------------------------------------------------------
    'ranked' => [
        'title' => 'Ranked-choice poll',
        'caption' => 'Polls at :community',
        'badge' => 'Ranked',
        'how_it_works' => 'Put the options in your order of preference, with your favourite first. Use the up and down buttons to reorder.',
        'no_options' => 'This poll has no options to rank.',
        'legend' => 'Rank the options in order of preference',
        'position_label' => 'Position :num',
        'move_up' => 'Move up',
        'move_down' => 'Move down',
        'submit_button' => 'Submit ranking',
        'already_ranked' => 'You have already submitted your ranking for this poll.',
        'results_heading' => 'Results',
        'no_results' => 'No rankings have been submitted yet.',
        'total_voters' => '{0} no voters|{1} 1 voter|[2,*] :count voters',
        'first_choice_votes' => '{0} no first-choice votes|{1} 1 first-choice vote|[2,*] :count first-choice votes',
        'winner' => 'Leading',
        'your_ranking_heading' => 'Your ranking',
        'states' => [
            'ranked' => 'Your ranking has been recorded.',
            'rank-failed' => 'We could not record your ranking. You may have already ranked this poll.',
        ],
    ],

    // ---------------------------------------------------------------
    //  POLL CREATE (parity — supports ranked)
    // ---------------------------------------------------------------
    'poll_create' => [
        'title' => 'Create a poll',
        'caption' => 'Polls at :community',
        'description' => 'Create a standard poll, where members pick one option, or a ranked-choice poll, where members order the options.',
        'question_label' => 'Poll question',
        'question_hint' => 'Ask a clear question your community can answer.',
        'desc_label' => 'Description (optional)',
        'desc_hint' => 'Add any extra detail to help members decide.',
        'category_label' => 'Category (optional)',
        'category_none' => 'No category',
        'options_legend' => 'Poll options',
        'options_hint' => 'Add at least 2 options. Leave any you do not need blank.',
        'option_label' => 'Option :num',
        'expires_label' => 'Closing date (optional)',
        'expires_past_error' => 'The closing date must be in the future',
        'type_legend' => 'Poll type',
        'type_standard' => 'Standard — members choose one option',
        'type_ranked' => 'Ranked choice — members order the options',
        'submit_button' => 'Create poll',
        'states' => [
            'poll-created' => 'Your poll has been created.',
            'poll-create-failed' => 'We could not create your poll. Add a question and at least 2 options.',
        ],
    ],

    // ---------------------------------------------------------------
    //  POLL MANAGE (my polls + delete/export)
    // ---------------------------------------------------------------
    'poll_manage' => [
        'title' => 'Manage my polls',
        'caption' => 'Polls at :community',
        'description' => 'View, export and delete the polls you have created.',
        'empty' => 'You have not created any polls yet.',
        'create_link' => 'Create a poll',
        'open_tag' => 'Open',
        'closed_tag' => 'Closed',
        'ranked_tag' => 'Ranked',
        'anonymous_tag' => 'Anonymous',
        'votes_count' => '{0} no votes|{1} 1 vote|[2,*] :count votes',
        'export_button' => 'Export results (CSV)',
        'view_ranked' => 'View ranked results',
        'delete_button' => 'Delete poll',
        'delete_warning' => 'Deleting a poll removes it and all of its votes permanently. This cannot be undone.',
        'delete_confirm_legend' => 'Delete this poll?',
        'states' => [
            'poll-deleted' => 'The poll has been deleted.',
            'poll-delete-failed' => 'We could not delete that poll. It may not exist or may not be yours.',
        ],
    ],

    // ---------------------------------------------------------------
    //  POLL DETAIL + SOCIAL (like + comments)
    // ---------------------------------------------------------------
    'poll_detail' => [
        'title' => 'Poll',
        'caption' => 'Polls at :community',
        'by_label' => 'Posted by :name',
        'closes_on' => 'Closes :date',
        'closed_on' => 'Closed :date',
        'open_tag' => 'Open',
        'closed_tag' => 'Closed',
        'ranked_tag' => 'Ranked',
        'votes_count' => '{0} no votes|{1} 1 vote|[2,*] :count votes',
        'your_choice' => 'Your choice',
        'leading' => 'Leading',
        'results_heading' => 'Results',
        'results_pending' => 'Results will be shown once voting closes or once you have voted.',
        'no_options' => 'This poll has no options.',
        'vote_link' => 'Vote on this poll',
        'rank_link' => 'Rank this poll',
        'social_heading' => 'Likes and comments',
        'like_summary' => '{0} no likes|{1} 1 like|[2,*] :count likes',
        'comment_summary' => '{0} no comments|{1} 1 comment|[2,*] :count comments',
        'like_button' => 'Like',
        'unlike_button' => 'Unlike',
        'comments_heading' => 'Comments',
        'no_comments' => 'No comments yet. Be the first to comment.',
        'comment_label' => 'Add a comment',
        'comment_hint' => 'Be respectful and keep it on topic.',
        'comment_button' => 'Post comment',
        'states' => [
            'poll-liked' => 'You liked this poll.',
            'poll-unliked' => 'You removed your like.',
            'poll-like-failed' => 'We could not record your like. Please try again.',
            'poll-comment-created' => 'Your comment has been posted.',
            'poll-comment-empty' => 'Enter a comment before posting.',
            'poll-comment-too-long' => 'Your comment is too long. Please shorten it.',
            'poll-comment-failed' => 'We could not post your comment. Please try again.',
        ],
    ],
];
