<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    // ---- Navigation links to related feed pages ----
    'nav' => [
        'hashtags' => 'Discover hashtags and trending topics',
    ],

    // ---- Shared states / status banners ----
    'states' => [
        'error' => 'Sorry, there is a problem with this page. Try again later.',
        'success_title' => 'Success',
        'error_title' => 'There is a problem',
        'auth_required' => 'Sign in to take part in the feed.',
        'not_interested' => 'Thank you. We will show you less like this.',
        'not_interested_failed' => 'Sorry, we could not record your feedback. Try again later.',
        'reaction_added' => 'Your reaction has been added.',
        'reaction_removed' => 'Your reaction has been removed.',
        'reaction_failed' => 'Sorry, we could not save your reaction. Try again later.',
    ],

    // ---- Hashtag discovery / trending ----
    'hashtags' => [
        'title' => 'Hashtags',
        'caption' => 'Discover topics at :community',
        'subtitle' => 'Browse trending hashtags or search for a topic.',
        'back_to_feed' => 'Back to the feed',
        'search_label' => 'Search hashtags',
        'search_hint' => 'Enter at least one character to search by topic.',
        'search_button' => 'Search',
        'clear_search' => 'Clear search and show trending',
        'trending_heading' => 'Trending hashtags',
        'results_heading' => 'Search results',
        'post_count' => '{0} No posts|{1} 1 post|[2,*] :count posts',
        'view_tag' => 'View posts tagged :tag',
        'empty_trending' => 'There are no trending hashtags yet.',
        'empty_search' => 'No hashtags match :query.',
    ],

    // ---- Single hashtag browse ----
    'hashtag' => [
        'caption' => 'Posts tagged at :community',
        'back_to_hashtags' => 'Back to hashtags',
        'total_posts' => '{0} No posts|{1} 1 post|[2,*] :count posts',
        'empty_title' => 'No posts found',
        'empty_body' => 'There are no posts tagged :tag that you can see.',
        'show_more' => 'Show more posts',
        'view_post' => 'View this post',
    ],

    // ---- Polymorphic feed-item permalink ----
    'item' => [
        'title' => 'Feed item',
        'caption' => 'A shared item at :community',
        'back_to_feed' => 'Back to the feed',
        'heading' => 'Feed item',
        'posted_by' => 'Posted by :name',
        'posted_on' => 'Posted on',
        'open_full' => 'Open full item',
        'open_full_hint' => 'View the full details for this item.',
        'view_listing' => 'View listing',
        'view_event' => 'View event',
        'view_poll' => 'View poll',
        'view_goal' => 'View goal',
        'view_job' => 'View job',
        'view_blog' => 'View article',
        'view_resource' => 'View resource',
        'view_volunteer' => 'View opportunity',
        'view_challenge' => 'View challenge',
        'view_review' => 'View review',
        'view_discussion' => 'View discussion',
        'unknown_author' => 'A community member',
        'engagement_summary' => ':likes · :comments',
        'comments_heading' => 'Comments',
        'no_comments' => 'No comments yet.',
        'comment_label' => 'Add a comment',
        'comment_hint' => 'Be respectful. Comments are visible to other members.',
        'comment_submit' => 'Add comment',
        'image_alt' => 'Image attached to this feed item',
    ],

    // ---- Shared engagement labels ----
    'engagement' => [
        'likes' => '{0} 0 likes|{1} 1 like|[2,*] :count likes',
        'comments' => '{0} 0 comments|{1} 1 comment|[2,*] :count comments',
        'like' => 'Like',
        'unlike' => 'Remove like',
        'like_for' => 'Like this item',
        'reactions_legend' => 'React to this item',
        'reaction_for' => 'React to the item by :name',
        'not_interested' => 'Not interested',
        'not_interested_hint' => 'Show fewer items like this. This will not notify anyone.',
        'item_type' => 'Type',
    ],

    // ---- Item type labels ----
    'item_types' => [
        'post' => 'Post',
        'listing' => 'Listing',
        'event' => 'Event',
        'poll' => 'Poll',
        'goal' => 'Goal',
        'review' => 'Review',
        'volunteer' => 'Volunteering',
        'challenge' => 'Challenge',
        'resource' => 'Resource',
        'blog' => 'Article',
        'discussion' => 'Discussion',
        'job' => 'Job',
        'activity' => 'Activity',
    ],

    // ---- Quoted-post embed ----
    'quoted' => [
        'heading' => 'Quoted post',
        'posted_by' => 'Quoted post by :name',
        'truncated' => 'This quoted post has been shortened.',
        'image_alt' => 'Image attached to the quoted post',
    ],

    // ---- Feed reactions, as React offers them (27 Oct 2026 parity) ----
    'reactions' => [
        'like' => 'Like',
        'love' => 'Love',
        'laugh' => 'Laugh',
        'wow' => 'Wow',
        'sad' => 'Sad',
        'celebrate' => 'Celebrate',
        'clap' => 'Clap',
        'time_credit' => 'Time credit',
        'legend' => 'React to this post',
        'comment_legend' => 'React to this comment',
        'see_who' => 'See who reacted with :reaction (:count)',
        'reactors_title' => 'People who reacted with :reaction',
        'reactors_total' => 'Total: :count',
        'reactors_empty' => 'Nobody has reacted with :reaction yet.',
        'unknown_member' => 'A community member',
        'show_more' => 'Show more people',
    ],

    // ---- Shared navigation for the post sub-pages ----
    'post_pages' => [
        'back_to_post' => 'Back to the post',
    ],

    // ---- Translate a feed post (React FeedCard TranslateButton) ----
    'translate' => [
        'button' => 'Translate this post',
        'heading' => 'Translation',
        'hint' => 'Translated automatically. The original post is shown above.',
        'done' => 'The post has been translated.',
        'failed' => 'Sorry, we could not translate this post. Try again later.',
        'unavailable' => 'Translation is not available in this community.',
        'same' => 'This post is already in your language.',
        'empty' => 'This post has no text to translate.',
        'listing_button' => 'Translate this listing',
        'comment_button' => 'Translate this comment',
        'comment_by' => '(comment by :name)',
        'discussion_button' => 'Translate this discussion',
        'reply_button' => 'Translate this reply',
        'reply_by' => '(reply by :name)',
        'original_above_hint' => 'Translated automatically. The original is shown above.',
        'text_done' => 'The translation is shown below the original.',
        'text_failed' => 'Sorry, we could not translate this. Try again later.',
        'text_same' => 'This is already in your language.',
        'text_empty' => 'There is no text to translate.',
    ],

    // ---- "Why am I seeing this?" in the ranked feed (React WhyShown) ----
    'why_shown' => [
        'label' => 'Why am I seeing this?',
        'default_reason' => 'Ranked for you based on your activity',
    ],

    // ---- Post statistics for the author (React PostAnalyticsModal) ----
    'stats' => [
        'link' => 'View post statistics',
        'title' => 'Post statistics',
        'intro' => 'Only you can see these numbers.',
        'views' => 'Views',
        'likes' => 'Likes',
        'comments' => 'Comments',
        'shares' => 'Shares',
        'reach' => 'Reach',
        'reach_hint' => 'Reach is the number of different people who have seen the post.',
        'reactions_breakdown' => 'Reactions',
        'no_reactions' => 'No reactions yet.',
        'forbidden' => 'Only the person who wrote this post can see its statistics.',
        'failed' => 'Sorry, we could not load the statistics. Try again later.',
    ],

    // ---- Share a post with your own comment (React ShareButton quote) ----
    'quote' => [
        'summary' => 'Share with your own comment',
        'label' => 'Your comment',
        'hint' => 'Your comment appears with the post when you share it.',
        'submit' => 'Share with comment',
    ],
    // ---- Feed composer photos + publish later, and @mentions (React parity, 27 Oct 2026) ----
    'compose' => [
        'more_images_summary' => 'Add more photos (up to :max in total)',
        'image_n_label' => 'Photo :number (optional)',
        'image_n_alt_label' => 'Description of photo :number (optional)',
        'schedule_summary' => 'Publish later (optional)',
        'schedule_legend' => 'When to publish the post',
        'schedule_hint' => 'For example, 14 11 2026. Leave the date and time blank to publish now.',
        'scheduled' => 'Your post has been scheduled.',
        'image_invalid' => 'Each photo must be a JPG, PNG, GIF or WEBP image.',
        'schedule_invalid' => 'Enter a real date and time to publish the post, or leave both blank to publish now.',
    ],
    'mentions' => [
        'hint' => 'To mention a member, type @ and their username, for example @alex_smith. They will get a notification.',
        'find_link' => 'Find a member\'s username',
        'title' => 'Find a member\'s username',
        'intro' => 'To mention a member in a post or comment, type @ followed by their username. Search by name to find the username to type.',
        'search_label' => 'Name or username',
        'search_hint' => 'For example, Alex or alex_smith',
        'search_button' => 'Search',
        'results_title' => 'Members found',
        'no_username' => 'This member has no username.',
        'no_results' => 'No members match your search. Some members choose not to appear in member search.',
        'failed' => 'The search could not be completed. Try again.',
    ],
];
