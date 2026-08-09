// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const http = require('http');
const https = require('https');

const DEFAULT_WEB_BASE_URL = 'http://127.0.0.1:5180';
const DEFAULT_LARAVEL_BASE_URL = 'http://127.0.0.1:8088';
const DEFAULT_SMOKE_EMAIL = 'e2e.user.a@project-nexus.local';
const DEFAULT_SMOKE_PASSWORD = 'TestPassword123!';
const DEFAULT_SMOKE_TENANT = 'hour-timebank';
const DEFAULT_TIMEOUT_MS = 60000;
const ACCESSIBLE_COOKIE_NAME = 'nexus_accessible_cookie_consent';
const DEFAULT_PUBLIC_MODULE_PAGE_PATHS = [
  '/help',
  '/password/reset'
];
const DEFAULT_REAL_FIXTURE_MODULE_PAGE_PATHS = [
  '/events/6',
  '/events/6/map',
  '/events/6/translate',
  '/volunteering/opportunities/307',
  '/organisations/636',
  '/organisations/636/jobs',
  '/organisations/opportunities/307/apply',
  '/members/77/insights',
  '/listings/90992/edit',
  '/listings/42/report',
  '/listings/42/exchange-request',
  '/listings/42/comments',
  '/listings/90967/report',
  '/listings/90967/exchange-request',
  '/listings/90967/comments',
  '/feed/hashtag/timebank',
  '/feed/item/listing/42',
  '/messages/77',
  '/messages/new/77',
  '/jobs/90001',
  '/jobs/90001/qualified',
  '/groups/484',
  '/groups/484/invite',
  '/groups/484/notifications',
  '/groups/484/announcements',
  '/groups/484/discussions',
  '/groups/484/discussions/new',
  '/resources/10/comments',
  '/volunteering/organisations/636/dashboard',
  '/volunteering/organisations/636/manage',
  '/volunteering/organisations/636/settings',
  '/volunteering/organisations/636/volunteers',
  '/volunteering/organisations/636/wallet',
  '/courses/1',
  '/courses/2',
  '/courses/2/learn',
  '/courses/2/certificate',
  '/courses/instructor/1/edit',
  '/courses/instructor/2/edit',
  '/federation/partners/1',
  '/federation/partners/5',
  '/ideation/23',
  '/ideation/22',
  '/ideation/2',
  '/ideation/2/ideas/1',
  '/ideation/23/edit',
  '/ideation/23/manage',
  '/ideation/23/drafts',
  '/ideation/23/outcome',
  '/polls/20',
  '/polls/20/rank',
  '/marketplace/267',
  '/marketplace/267/buy',
  '/marketplace/267/offer',
  '/marketplace/267/report',
  '/marketplace/267/edit',
  '/blog/test-sitemap-blog-post/likers/like',
  '/events/14',
  '/events/14/map',
  '/events/14/translate',
  '/groups/482',
  '/groups/482/announcements',
  '/groups/482/discussions',
  '/groups/482/discussions/new',
  '/groups/482/invite',
  '/groups/482/notifications',
  '/marketplace/6',
  '/marketplace/6/buy',
  '/marketplace/6/offer',
  '/marketplace/6/report',
  '/marketplace/6/edit',
  '/polls/8',
  '/polls/4',
  '/feed/posts/796',
  '/goals/162',
  '/goals/162/edit',
  '/goals/162/checkin',
  '/goals/162/reminder',
  '/goals/162/buddy-actions',
  '/goals/162/insights',
  '/goals/162/history',
  '/goals/162/social',
  '/feed/item/listing/90967',
  '/feed/item/listing/90966',
  '/feed/item/listing/90965',
  '/feed/item/listing/90964',
  '/feed/item/listing/90963',
  '/feed/item/listing/90962',
  '/users/14/appreciations',
  '/jobs/employers/14',
  '/blog/timebank-ireland/likers/like',
  '/blog/test-sitemap-blog-post',
  '/blog/test-sitemap-blog-post/comments',
  '/blog/timebank-ireland',
  '/blog/timebank-ireland/comments',
  '/kb/90001',
  '/achievements/badges/vol_1h',
  '/reviews/18/comments',
  '/marketplace/category/electronics',
  '/marketplace/category/home-garden',
  '/marketplace/category/free-items',
  '/marketplace/category/services',
  '/marketplace/seller/1'
];
const DEFAULT_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = [
  '/volunteering',
  '/volunteering/opportunities/307',
  '/kb',
  '/feed',
  '/feed/posts/796',
  '/feed/item/listing/42',
  '/members',
  '/events',
  '/events/6',
  '/listings',
  '/listings/90992',
  '/federation/listings/1/1',
  '/federation/partners/1',
  '/ideation/1',
  '/ideation/campaigns/1',
  '/organisations',
  '/organisations/browse',
  '/organisations/register',
  '/organisations/manage',
  '/organisations/1',
  '/organisations/1/jobs',
  '/organisations/opportunities/1/apply',
  '/podcasts/1',
  '/podcasts/1/episodes/1',
  '/resources/1/download',
  '/users/1/collections',
  '/polls/1/export',
  '/marketplace/slots/1/edit',
  '/me/collections/1',
  '/search/saved/1/delete',
  '/volunteering/certificates/ABC123/download'
];
const DEFAULT_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = [
  '/exchanges/1',
  '/jobs/applications/1/cv',
  '/jobs/applications/1/history'
];
const DEFAULT_SIGNED_GATED_PAGE_PATHS = [
  { path: '/coupons', status: 403 },
  { path: '/jobs/bias-audit', status: 403 },
  { path: '/jobs/talent-search', status: 403 },
  { path: '/events/6/edit', status: 403 },
  { path: '/events/14/edit', status: 403 },
  { path: '/groups/484/announcements/1/edit', status: 403 },
  { path: '/groups/484/manage', status: 403 },
  { path: '/groups/484/image', status: 403 },
  { path: '/groups/484/files', status: 403 },
  { path: '/groups/484/files/1/download', status: 403 },
  { path: '/groups/482/image', status: 403 },
  { path: '/groups/482/manage', status: 403 },
  { path: '/groups/482/files', status: 403 },
  { path: '/groups/482/files/1/download', status: 403 },
  { path: '/jobs/90001/edit', status: 403 },
  { path: '/jobs/90001/analytics', status: 403 },
  { path: '/jobs/90001/pipeline', status: 403 },
  { path: '/jobs/90001/applications', status: 403 },
  { path: '/ideation/new', status: 403 },
  { path: '/events/14/polls', status: 403 },
  { path: '/events/6/polls', status: 403 },
  { path: '/events/6/recurring-edit', status: 403 },
  { path: '/events/14/recurring-edit', status: 403 },
  { path: '/courses/instructor/1/analytics', status: 403 },
  { path: '/courses/instructor/1/grading', status: 403 },
  { path: '/listings/42/analytics', status: 403 },
  { path: '/listings/90967/analytics', status: 403 },
  { path: '/jobs/talent-search/77', status: 403 },
  { path: '/group-exchanges/1', status: 403 },
  { path: '/messages/groups/33', status: 403 },
  { path: '/resources/10/delete', status: 403 },
  { path: '/clubs', status: 404 },
  { path: '/coupons/1', status: 403 },
  { path: '/coupons/2', status: 403 },
  { path: '/marketplace/coupons', status: 403 },
  { path: '/marketplace/coupons/5/edit', status: 403 }
];
const DEFAULT_SIGNED_REDIRECT_PAGE_PATHS = [
  { path: '/login/two-factor', location: '/login?status=two-factor-expired' },
  { path: '/onboarding', location: '/dashboard' },
  { path: '/groups/484/edit', location: '/groups/484' },
  { path: '/courses/42/certificate', location: '/courses/42?status=certificate-failed' },
  { path: '/courses/1/certificate', location: '/courses/1?status=certificate-failed' },
  { path: '/federation/members', location: '/federation/opt-in' },
  { path: '/federation/members/353', location: '/federation/opt-in' },
  { path: '/federation/members/353/transfer', location: '/federation/opt-in' },
  { path: '/federation/members/351', location: '/federation/opt-in' },
  { path: '/federation/groups', location: '/federation/opt-in' },
  { path: '/federation/events', location: '/federation/opt-in' },
  { path: '/federation/connections', location: '/federation/opt-in' },
  { path: '/federation/messages', location: '/federation/opt-in' },
  { path: '/federation/messages/conversation/77', location: '/federation/messages' },
  { path: '/jobs/90001/applications/export.csv', location: '/jobs/90001/applications?status=export-failed' },
  { path: '/courses/1/learn', location: '/courses/1?status=enrol-required' },
  { path: '/federation/messages/conversation/353', location: '/federation/messages' },
  { path: '/onboarding/profile', location: '/dashboard' },
  { path: '/groups/482/edit', location: '/groups/482' },
  { path: '/onboarding/interests', location: '/dashboard' },
  { path: '/onboarding/safeguarding', location: '/dashboard' },
  { path: '/onboarding/confirm', location: '/dashboard' },
  { path: '/premium/manage', location: '/premium?status=no-subscription' }
];
const DEFAULT_CONTENT_TYPE_PAGE_PATHS = [
  { path: '/blog/feed.xml', contentType: 'application/rss+xml' },
  { path: '/wallet/export.csv', contentType: 'text/csv' }
];
const DEFAULT_BODY_TEXT_PAGE_PATHS = [
  { path: '/explore', text: 'Explore' },
  { path: '/chat', text: 'AI assistant' },
  { path: '/account', text: 'My account' },
  { path: '/wallet', text: 'Wallet' },
  { path: '/wallet/export.csv', text: 'Date,Type,Description' },
  { path: '/wallet/manage', text: 'Manage your credits' },
  { path: '/wallet/recipients', text: 'results' },
  { path: '/messages', text: 'Messages' },
  { path: '/messages/groups', text: 'Group conversations' },
  { path: '/messages/groups/new', text: 'Start a group conversation' },
  { path: '/messages/77', text: 'Conversation' },
  { path: '/messages/new/77', text: 'Conversation with' },
  { path: '/connections', text: 'Connections' },
  { path: '/connections/network', text: 'My network' },
  { path: '/matches', text: 'Open the matches board' },
  { path: '/matches/board', text: 'Suggested matches' },
  { path: '/resources', text: 'Resources' },
  { path: '/resources/library', text: 'Resource library' },
  { path: '/resources/upload', text: 'Upload a resource' },
  { path: '/resources/10/comments', text: 'Comments' },
  { path: '/skills', text: 'Skills' },
  { path: '/goals', text: 'Goals' },
  { path: '/group-exchanges', text: 'Start a group exchange' },
  { path: '/group-exchanges/new', text: 'How are the hours shared out?' },
  { path: '/saved', text: 'Saved items' },
  { path: '/members', text: 'Members' },
  { path: '/members/discover', text: 'Recommended members' },
  { path: '/members/nearby', text: 'Members near me' },
  { path: '/members/77/insights', text: 'Reputation and recognition' },
  { path: '/dashboard', text: 'Welcome back' },
  { path: '/dashboard', text: 'Your time bank' },
  { path: '/dashboard', text: 'Quick links' },
  { path: '/dashboard', text: 'Recent feed' },
  { path: '/dashboard', text: 'Recent listings' },
  { path: '/', text: 'Choose a community' },
  { path: '/about', text: 'About' },
  { path: '/guide', text: 'How timebanking works' },
  { path: '/features', text: 'Features' },
  { path: '/faq', text: 'Frequently asked questions' },
  { path: '/help', text: 'Help centre' },
  { path: '/kb', text: 'Knowledge base' },
  { path: '/kb/90001', text: 'Back to the knowledge base' },
  { path: '/trust-and-safety', text: 'Trust and safety' },
  { path: '/legal', text: 'Legal' },
  { path: '/accessibility', text: 'Accessibility statement' },
  { path: '/legal/terms', text: 'Terms of service' },
  { path: '/legal/privacy', text: 'Privacy policy' },
  { path: '/legal/cookies', text: 'Cookie policy' },
  { path: '/legal/community-guidelines', text: 'Community guidelines' },
  { path: '/legal/acceptable-use', text: 'Acceptable use policy' },
  { path: '/volunteering', text: 'Volunteering' },
  { path: '/volunteering/accessibility', text: 'Your accessibility needs' },
  { path: '/volunteering/certificates', text: 'Volunteer certificates' },
  { path: '/volunteering/opportunities/create', text: 'Post a volunteer opportunity' },
  { path: '/volunteering/credentials', text: 'My credentials' },
  { path: '/volunteering/hours', text: 'Volunteering hours' },
  { path: '/volunteering/wellbeing', text: 'My wellbeing' },
  { path: '/volunteering/donations', text: 'Donations and giving' },
  { path: '/volunteering/expenses', text: 'My expenses' },
  { path: '/volunteering/emergency-alerts', text: 'Urgent shift requests' },
  { path: '/volunteering/group-signups', text: 'Group sign-ups' },
  { path: '/volunteering/training', text: 'Safeguarding' },
  { path: '/volunteering/incidents', text: 'Safeguarding' },
  { path: '/volunteering/waitlist', text: 'Shift waitlist' },
  { path: '/volunteering/swaps', text: 'Shift swaps' },
  { path: '/volunteering/my-organisations', text: 'My organisations' },
  { path: '/volunteering/recommended-shifts', text: 'Recommended for you' },
  { path: '/volunteering/opportunities/307', text: 'Volunteering opportunity' },
  { path: '/volunteering/organisations/636/dashboard', text: 'Organisation dashboard' },
  { path: '/volunteering/organisations/636/manage', text: 'Manage your organisation' },
  { path: '/volunteering/organisations/636/settings', text: 'Organisation settings' },
  { path: '/volunteering/organisations/636/volunteers', text: 'Volunteers roster' },
  { path: '/volunteering/organisations/636/wallet', text: 'Organisation wallet' },
  { path: '/organisations', text: 'Organisations' },
  { path: '/organisations/browse', text: 'Browse organisations' },
  { path: '/organisations/manage', text: 'Manage my organisations' },
  { path: '/organisations/register', text: 'Register a volunteer organisation' },
  { path: '/login', text: 'Sign in' },
  { path: '/login/forgot-password', text: 'Reset your password' },
  { path: '/password/reset', text: 'Choose a new password' },
  { path: '/password/reset?token=reset-token', text: 'Choose a new password' },
  { path: '/register', text: 'Register' },
  { path: '/contact', text: 'Contact Us' },
  { path: '/cookies', text: 'Cookies' },
  { path: '/newsletter/unsubscribe', text: 'Unsubscribe from emails' },
  { path: '/verify-email', text: 'Verify your email address' },
  { path: '/report-a-problem', text: 'Use this form to tell us about a problem you found on this page.' },
  { path: '/exchanges', text: 'Exchanges' },
  { path: '/me/collections', text: 'My collections' },
  { path: '/premium/return', text: 'Donation setup failed' },
  { path: '/profile', text: 'Your profile' },
  { path: '/organisations/636', text: 'About this organisation' },
  { path: '/organisations/636/jobs', text: 'Open roles posted by this organisation' },
  { path: '/organisations/opportunities/307/apply', text: 'Apply for this opportunity' },
  { path: '/events', text: 'Events' },
  { path: '/events/new', text: 'Create an event' },
  { path: '/events/browse', text: 'Browse events by category' },
  { path: '/events/6', text: 'Location' },
  { path: '/events/6/map', text: 'Event location' },
  { path: '/events/6/translate', text: 'Translate event description' },
  { path: '/events/14', text: 'Location' },
  { path: '/events/14/map', text: 'Event location' },
  { path: '/events/14/translate', text: 'Translate event description' },
  { path: '/listings', text: 'Listings' },
  { path: '/listings/new', text: 'Create listing' },
  { path: '/listings/90992/edit', text: 'Edit listing' },
  { path: '/listings/42/report', text: 'Report listing' },
  { path: '/listings/42/exchange-request', text: 'Request an exchange' },
  { path: '/listings/42/comments', text: 'Comments' },
  { path: '/listings/90967/report', text: 'Report listing' },
  { path: '/listings/90967/exchange-request', text: 'Request an exchange' },
  { path: '/listings/90967/comments', text: 'Comments' },
  { path: '/polls', text: 'Polls' },
  { path: '/polls/parity/create', text: 'Create a poll' },
  { path: '/polls/parity/manage', text: 'Manage my polls' },
  { path: '/polls/20', text: 'testing 12!!! testing 12!!! testing 12!!!' },
  { path: '/polls/20/rank', text: 'Polls at this community' },
  { path: '/polls/8', text: 'APK audit poll%3F' },
  { path: '/polls/4', text: 'Is this platform awesome?' },
  { path: '/jobs', text: 'Jobs' },
  { path: '/jobs/90001', text: 'Apply for this opportunity' },
  { path: '/jobs/90001/qualified', text: 'Am I qualified?' },
  { path: '/jobs/saved', text: 'Saved opportunities' },
  { path: '/jobs/applications', text: 'My applications' },
  { path: '/jobs/mine', text: 'My postings' },
  { path: '/jobs/create', text: 'Post an opportunity' },
  { path: '/jobs/alerts', text: 'Job alerts' },
  { path: '/jobs/responses', text: 'Interviews and offers' },
  { path: '/jobs/employer-onboarding', text: 'Post an opportunity' },
  { path: '/jobs/employers/14', text: 'Open opportunities and reviews for this employer' },
  { path: '/courses', text: 'Courses' },
  { path: '/courses/mine', text: 'My learning' },
  { path: '/courses/instructor', text: 'Courses you teach' },
  { path: '/courses/instructor/new', text: 'Create a course' },
  { path: '/courses/1', text: 'Ratings and reviews' },
  { path: '/courses/2', text: 'Ratings and reviews' },
  { path: '/courses/instructor/1/edit', text: 'Edit your course' },
  { path: '/courses/instructor/2/edit', text: 'Edit your course' },
  { path: '/marketplace', text: 'Marketplace' },
  { path: '/marketplace/mine', text: 'My listings' },
  { path: '/marketplace/onboarding', text: 'Become a seller' },
  { path: '/marketplace/saved', text: 'Saved items' },
  { path: '/marketplace/free', text: 'Free items' },
  { path: '/marketplace/offers', text: 'My offers' },
  { path: '/marketplace/orders', text: 'My orders' },
  { path: '/marketplace/sales', text: 'Sales' },
  { path: '/marketplace/pickups', text: 'My collections' },
  { path: '/marketplace/slots', text: 'Pickup slots' },
  { path: '/marketplace/create', text: 'Create a listing' },
  { path: '/marketplace/search', text: 'Advanced search' },
  { path: '/marketplace/coupons/new', text: 'Create a coupon' },
  { path: '/marketplace/267', text: 'Description' },
  { path: '/marketplace/267/buy', text: 'Confirm your purchase' },
  { path: '/marketplace/267/offer', text: 'Make an offer' },
  { path: '/marketplace/267/report', text: 'Report a listing' },
  { path: '/marketplace/267/edit', text: 'Edit your listing' },
  { path: '/marketplace/6', text: 'Description' },
  { path: '/marketplace/6/buy', text: 'Confirm your purchase' },
  { path: '/marketplace/6/offer', text: 'Make an offer' },
  { path: '/marketplace/6/report', text: 'Report a listing' },
  { path: '/marketplace/6/edit', text: 'Edit your listing' },
  { path: '/marketplace/category/electronics', text: 'Search within this category' },
  { path: '/marketplace/category/home-garden', text: 'Search within this category' },
  { path: '/marketplace/category/free-items', text: 'Search within this category' },
  { path: '/marketplace/category/services', text: 'Search within this category' },
  { path: '/marketplace/seller/1', text: 'Items for sale' },
  { path: '/ideation', text: 'Ideas' },
  { path: '/ideation/campaigns', text: 'Campaigns' },
  { path: '/ideation/outcomes', text: 'Outcomes' },
  { path: '/ideation/tags', text: 'Browse by tag' },
  { path: '/ideation/23', text: 'Ideas' },
  { path: '/ideation/22', text: 'Ideas' },
  { path: '/ideation/2', text: 'Ideas' },
  { path: '/ideation/2/ideas/1', text: 'Idea details' },
  { path: '/ideation/23/edit', text: 'Edit challenge' },
  { path: '/ideation/23/manage', text: 'Manage challenge' },
  { path: '/ideation/23/drafts', text: 'Your draft ideas' },
  { path: '/ideation/23/outcome', text: 'Record challenge outcome' },
  { path: '/goals/buddying', text: 'Goals you buddy' },
  { path: '/goals/discover', text: 'Discover goals' },
  { path: '/goals/templates', text: 'Goal templates' },
  { path: '/goals/162', text: 'Back to goals' },
  { path: '/goals/162/edit', text: 'Edit your goal' },
  { path: '/goals/162/checkin', text: 'Log a check-in' },
  { path: '/goals/162/reminder', text: 'Reminder settings' },
  { path: '/goals/162/buddy-actions', text: 'Send buddy support' },
  { path: '/goals/162/insights', text: 'Goal insights' },
  { path: '/goals/162/history', text: 'Progress history' },
  { path: '/goals/162/social', text: 'Likes and comments' },
  { path: '/blog', text: 'Blog' },
  { path: '/feed', text: 'Feed' },
  { path: '/feed/hashtags', text: 'Hashtags' },
  { path: '/feed/hashtag/timebank', text: '#timebank' },
  { path: '/feed/item/listing/42', text: 'View listing' },
  { path: '/feed/posts/796', text: 'Post' },
  { path: '/feed/item/listing/90967', text: 'View listing' },
  { path: '/feed/item/listing/90966', text: 'View listing' },
  { path: '/feed/item/listing/90965', text: 'View listing' },
  { path: '/feed/item/listing/90964', text: 'View listing' },
  { path: '/feed/item/listing/90963', text: 'View listing' },
  { path: '/feed/item/listing/90962', text: 'View listing' },
  { path: '/blog/feed.xml', text: '<rss version="2.0">' },
  { path: '/blog/test-sitemap-blog-post/likers/like', text: 'Blog reactions' },
  { path: '/blog/timebank-ireland/likers/like', text: 'Blog reactions' },
  { path: '/blog/test-sitemap-blog-post', text: 'Back to the blog' },
  { path: '/blog/test-sitemap-blog-post/comments', text: 'Blog discussion' },
  { path: '/blog/timebank-ireland', text: 'Back to the blog' },
  { path: '/blog/timebank-ireland/comments', text: 'Blog discussion' },
  { path: '/podcasts', text: 'Podcasts' },
  { path: '/podcasts/studio', text: 'Podcast studio' },
  { path: '/podcasts/studio/new', text: 'Create a podcast' },
  { path: '/reviews', text: 'Reviews' },
  { path: '/reviews/list', text: 'All reviews' },
  { path: '/reviews/18/comments', text: 'Comments on this review' },
  { path: '/search', text: 'Search' },
  { path: '/search/advanced', text: 'Advanced search' },
  { path: '/federation', text: 'Federation' },
  { path: '/notifications', text: 'Notifications' },
  { path: '/activity', text: 'My activity' },
  { path: '/achievements', text: 'Achievements' },
  { path: '/achievements/badges/vol_1h', text: 'View all achievements' },
  { path: '/leaderboard', text: 'Leaderboard' },
  { path: '/nexus-score', text: 'NEXUS score' },
  { path: '/premium', text: 'Donate' },
  { path: '/profile/settings', text: 'Edit your profile' },
  { path: '/settings/appearance', text: 'Appearance' },
  { path: '/settings/data-rights', text: 'Your data rights' },
  { path: '/profile/delete-account', text: 'Delete your account' },
  { path: '/profile/two-factor', text: 'Authenticator app (two-step verification)' },
  { path: '/profile/blocked', text: 'Blocked members' },
  { path: '/settings/availability', text: 'Your availability' },
  { path: '/settings/linked-accounts', text: 'Linked accounts' },
  { path: '/settings/insurance', text: 'Insurance certificates' },
  { path: '/activity/insights', text: 'Activity insights' },
  { path: '/achievements/shop', text: 'XP shop' },
  { path: '/achievements/collections', text: 'Badge collections' },
  { path: '/achievements/engagement', text: 'Engagement history' },
  { path: '/achievements/showcase', text: 'Showcase badges' },
  { path: '/leaderboard/competitive', text: 'Competitive leaderboard' },
  { path: '/leaderboard/seasons', text: 'Leaderboard seasons' },
  { path: '/leaderboard/journey', text: 'My journey' },
  { path: '/leaderboard/spotlight', text: 'Member spotlight' },
  { path: '/nexus-score/tiers', text: 'NEXUS tier ladder' },
  { path: '/federation/partners', text: 'Federation partners' },
  { path: '/federation/partners/1', text: 'Federation partner' },
  { path: '/federation/partners/5', text: 'Partner Demo' },
  { path: '/federation/settings', text: 'Federation settings' },
  { path: '/federation/opt-in', text: 'Opt in to federation' },
  { path: '/federation/opt-out', text: 'Opt out of federation' },
  { path: '/federation/onboarding', text: 'Welcome to the community network' },
  { path: '/groups', text: 'Groups' },
  { path: '/groups/new', text: 'Create a group' },
  { path: '/groups/484', text: 'Group events' },
  { path: '/groups/484/invite', text: 'Invite members' },
  { path: '/groups/484/notifications', text: 'Notification preferences' },
  { path: '/groups/484/announcements', text: 'Announcements' },
  { path: '/groups/484/discussions', text: 'Discussions' },
  { path: '/groups/484/discussions/new', text: 'Start a discussion' },
  { path: '/groups/482', text: 'Group events' },
  { path: '/groups/482/announcements', text: 'Announcements' },
  { path: '/groups/482/discussions', text: 'Discussions' },
  { path: '/groups/482/discussions/new', text: 'Start a discussion' },
  { path: '/groups/482/invite', text: 'Invite members' },
  { path: '/groups/482/notifications', text: 'Notification preferences' },
  { path: '/users/14/appreciations', text: 'Public thank-you notes other members have sent to this person.' }
];
const DEFAULT_SIGNED_MODULE_PAGE_PATHS = [
  '/',
  '/account',
  '/login',
  '/login/forgot-password',
  '/password/reset?token=reset-token',
  '/register',
  '/explore',
  '/saved',
  '/notifications',
  '/members',
  '/members/discover',
  '/kb',
  '/volunteering',
  '/resources',
  '/skills',
  '/goals',
  '/wallet',
  '/messages',
  '/connections',
  '/connections/network',
  '/matches',
  '/matches/board',
  '/activity',
  '/achievements',
  '/leaderboard',
  '/nexus-score',
  '/profile/settings',
  '/settings/appearance',
  '/settings/data-rights',
  '/federation',
  '/federation/listings',
  '/courses',
  '/courses/mine',
  '/marketplace',
  '/marketplace/mine',
  '/events',
  '/events/new',
  '/listings',
  '/search/advanced',
  '/premium',
  '/podcasts',
  '/profile/delete-account',
  '/profile/two-factor',
  '/profile/blocked',
  '/settings/availability',
  '/settings/linked-accounts',
  '/settings/insurance',
  '/activity/insights',
  '/achievements/shop',
  '/achievements/collections',
  '/achievements/engagement',
  '/achievements/showcase',
  '/leaderboard/competitive',
  '/leaderboard/seasons',
  '/leaderboard/journey',
  '/leaderboard/spotlight',
  '/nexus-score/tiers',
  '/federation/partners',
  '/federation/settings',
  '/federation/opt-in',
  '/federation/opt-out',
  '/federation/onboarding',
  '/courses/instructor',
  '/courses/instructor/new',
  '/marketplace/saved',
  '/marketplace/free',
  '/marketplace/offers',
  '/marketplace/orders',
  '/marketplace/sales',
  '/marketplace/pickups',
  '/marketplace/onboarding',
  '/marketplace/slots',
  '/volunteering/accessibility',
  '/volunteering/certificates',
  '/volunteering/opportunities/create',
  '/volunteering/credentials',
  '/volunteering/hours',
  '/volunteering/wellbeing',
  '/volunteering/donations',
  '/volunteering/expenses',
  '/volunteering/emergency-alerts',
  '/volunteering/group-signups',
  '/volunteering/training',
  '/volunteering/incidents',
  '/volunteering/waitlist',
  '/volunteering/swaps',
  '/volunteering/my-organisations',
  '/volunteering/recommended-shifts',
  '/about',
  '/accessibility',
  '/blog',
  '/blog/feed.xml',
  '/chat',
  '/contact',
  '/cookies',
  '/dashboard',
  '/events/browse',
  '/exchanges',
  '/faq',
  '/features',
  '/feed',
  '/feed/hashtags',
  '/goals/buddying',
  '/goals/discover',
  '/goals/templates',
  '/group-exchanges',
  '/group-exchanges/new',
  '/groups',
  '/groups/new',
  '/guide',
  '/ideation',
  '/ideation/campaigns',
  '/ideation/outcomes',
  '/ideation/tags',
  '/jobs',
  '/jobs/alerts',
  '/jobs/applications',
  '/jobs/create',
  '/jobs/employer-onboarding',
  '/jobs/mine',
  '/jobs/responses',
  '/jobs/saved',
  '/legal',
  '/legal/acceptable-use',
  '/legal/community-guidelines',
  '/legal/cookies',
  '/legal/privacy',
  '/legal/terms',
  '/listings/new',
  '/marketplace/create',
  '/marketplace/search',
  '/marketplace/coupons/new',
  '/me/collections',
  '/members/nearby',
  '/messages/groups',
  '/messages/groups/new',
  '/newsletter/unsubscribe',
  '/organisations',
  '/organisations/browse',
  '/organisations/manage',
  '/organisations/register',
  '/podcasts/studio',
  '/podcasts/studio/new',
  '/polls',
  '/polls/parity/create',
  '/polls/parity/manage',
  '/premium/return',
  '/profile',
  '/report-a-problem',
  '/resources/library',
  '/resources/upload',
  '/reviews',
  '/reviews/list',
  '/search',
  '/trust-and-safety',
  '/verify-email',
  '/wallet/export.csv',
  '/wallet/manage',
  '/wallet/recipients'
];

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  storeFrom(headers) {
    for (const header of getSetCookieHeaders(headers)) {
      const pair = String(header).split(';')[0];
      const separator = pair.indexOf('=');
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
      }
    }
  }

  get(name) {
    return this.cookies.get(name) || '';
  }
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function joinUrl(baseUrl, path) {
  return `${stripTrailingSlash(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,]+=)/).map((part) => part.trim()).filter(Boolean);
}

function getSetCookieHeaders(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  if (typeof headers.raw === 'function') return headers.raw()['set-cookie'] || [];
  if (typeof headers.get === 'function') return splitSetCookieHeader(headers.get('set-cookie'));
  return [];
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function createHeadersFacade(headers) {
  const lowerHeaders = {};
  for (const [name, value] of Object.entries(headers || {})) {
    lowerHeaders[name.toLowerCase()] = value;
  }

  return {
    get(name) {
      const value = lowerHeaders[String(name || '').toLowerCase()];
      if (Array.isArray(value)) return value.join(', ');
      return value || null;
    },
    raw() {
      return lowerHeaders;
    },
    getSetCookie() {
      const value = lowerHeaders['set-cookie'];
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    }
  };
}

async function requestWithHostHeader({ url, options = {}, timeoutMs, hostHeader }) {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const headers = { ...(options.headers || {}), Host: hostHeader };
  const body = options.body || null;

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: options.method || 'GET',
      headers
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const status = response.statusCode || 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: createHeadersFacade(response.headers),
          text: async () => buffer.toString('utf8')
        });
      });
    });

    const timer = setTimeout(() => {
      request.destroy(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function smokeRequest({ fetchImpl, timeoutMs, cookieJar, url, options = {} }) {
  const { hostHeader, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  const cookieHeader = cookieJar?.header();
  if (cookieHeader) headers.cookie = cookieHeader;

  if (hostHeader) {
    const response = await requestWithHostHeader({
      url,
      timeoutMs,
      hostHeader,
      options: {
        ...fetchOptions,
        headers
      }
    });
    if (cookieJar) cookieJar.storeFrom(response.headers);
    return response;
  }

  const response = await fetchWithTimeout(fetchImpl, url, {
    redirect: 'manual',
    ...fetchOptions,
    headers
  }, timeoutMs);

  if (cookieJar) cookieJar.storeFrom(response.headers);
  return response;
}

function responseLocation(response) {
  return response.headers.get('location') || '';
}

function isRedirectTo(response, expectedPath) {
  const location = responseLocation(response);
  return response.status >= 300 && response.status < 400 && (
    location === expectedPath ||
    location.startsWith(`${expectedPath}?`) ||
    location.startsWith(`${expectedPath}#`)
  );
}

async function readTextSafely(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function extractCsrfToken(html) {
  const match = String(html || '').match(/name=["']_csrf["'][^>]*value=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

async function refreshSignedSession(config, cookieJar) {
  const loginResponse = await smokeRequest({
    fetchImpl: config.fetchImpl,
    timeoutMs: config.timeoutMs,
    cookieJar,
    url: joinUrl(config.webBaseUrl, '/login')
  });
  const html = await readTextSafely(loginResponse);
  const csrfToken = extractCsrfToken(html);
  if (!loginResponse.ok || !csrfToken) {
    throw new Error(`expected login form with CSRF token, got ${loginResponse.status}`);
  }

  const form = new URLSearchParams({
    _csrf: csrfToken,
    email: config.email,
    password: config.password,
    tenant_slug: config.tenant
  });
  const response = await smokeRequest({
    fetchImpl: config.fetchImpl,
    timeoutMs: config.timeoutMs,
    cookieJar,
    url: joinUrl(config.webBaseUrl, '/login'),
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    }
  });

  if (!isRedirectTo(response, '/dashboard')) {
    throw new Error(`expected 302 redirect to /dashboard, got ${response.status} ${responseLocation(response)}`);
  }
}

function addCheck(checks, name, ok, detail, meta = {}) {
  const check = {
    name,
    ok,
    detail,
    ...meta
  };
  checks.push(check);
  if (process.env.SMOKE_PROGRESS === '1') {
    process.stderr.write(`[smoke] ${ok ? 'PASS' : 'FAIL'} ${name}\n`);
  }
}

function modulePageCheckName(path) {
  const slug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `module-page-${slug || 'home'}-renders`;
}

function publicModulePageCheckName(path) {
  const slug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `public-module-page-${slug || 'home'}-renders-unsigned`;
}

function gatedPageCheckName(path, status) {
  const slug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `gated-page-${slug || 'home'}-returns-${status}`;
}

function redirectPageCheckName(path, location) {
  const pathSlug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  const locationSlug = String(location || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `redirect-page-${pathSlug || 'home'}-redirects-${locationSlug || 'home'}`;
}

function contentTypePageCheckName(path, contentType) {
  const pathSlug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  const contentTypeSlug = String(contentType || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `content-type-page-${pathSlug || 'home'}-returns-${contentTypeSlug || 'unknown'}`;
}

function bodyTextPageCheckName(path, text) {
  const pathSlug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  const textSlug = String(text || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `body-text-page-${pathSlug || 'home'}-contains-${textSlug || 'text'}`;
}

function tenantDomainPageCheckName(host, path) {
  const hostSlug = String(host || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const pathSlug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `tenant-domain-page-${hostSlug || 'host'}-${pathSlug || 'home'}-renders`;
}

function authRequiredPageCheckName(path, location) {
  const pathSlug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  const locationSlug = String(location || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `auth-required-page-${pathSlug || 'home'}-redirects-${locationSlug || 'home'}`;
}

function unsignedLoginRedirectPageCheckName(path) {
  const pathSlug = String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `unsigned-login-page-${pathSlug || 'home'}-redirects-login`;
}

function cookieConsentPostCheckName() {
  return 'cookie-consent-post-stores-essential-choice';
}

function cookieConsentAllPostCheckName() {
  return 'cookie-consent-post-stores-all-choice';
}

function cookieSettingsSaveCheckName() {
  return 'cookie-settings-post-saves-analytics-choice';
}

function logoutPostCheckName() {
  return 'logout-post-clears-signed-session';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function splitSmokeList(value) {
  const text = String(value || '').trim();
  if (/^(none|off|false)$/i.test(text)) return [];
  return text
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePathList(options, optionName, env, envName, fallback) {
  if (hasOwn(options, optionName)) return options[optionName];
  if (hasOwn(env, envName)) return splitSmokeList(env[envName]);
  return fallback;
}

function applySmokeChunk(paths, chunk) {
  const match = String(chunk || '').trim().match(/^(\d+)\/(\d+)$/);
  if (!match) return paths;

  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total) {
    return paths;
  }

  return paths.filter((_, position) => position % total === index - 1);
}

function resolveModulePagePaths(options, env) {
  const paths = resolvePathList(
    options,
    'modulePagePaths',
    env,
    'SMOKE_MODULE_PAGE_PATHS',
    [...DEFAULT_PUBLIC_MODULE_PAGE_PATHS, ...DEFAULT_SIGNED_MODULE_PAGE_PATHS, ...DEFAULT_REAL_FIXTURE_MODULE_PAGE_PATHS]
  );

  if (hasOwn(options, 'modulePagePaths')) return paths;
  return applySmokeChunk(paths, env.SMOKE_MODULE_PAGE_CHUNK);
}

function parseGatedPages(value) {
  return splitSmokeList(value).map((item) => {
    const separator = item.lastIndexOf(':');
    if (separator <= 0) return { path: item, status: 403 };
    return {
      path: item.slice(0, separator),
      status: Number(item.slice(separator + 1)) || 403
    };
  });
}

function parseRedirectPages(value) {
  return splitSmokeList(value).map((item) => {
    const separator = item.indexOf('=>');
    if (separator <= 0) return { path: item, location: '/login' };
    return {
      path: item.slice(0, separator).trim(),
      location: item.slice(separator + 2).trim()
    };
  }).filter((item) => item.path && item.location);
}

function parseContentTypePages(value) {
  return splitSmokeList(value).map((item) => {
    const separator = item.indexOf('=>');
    if (separator <= 0) return { path: item, contentType: 'text/html' };
    return {
      path: item.slice(0, separator).trim(),
      contentType: item.slice(separator + 2).trim().toLowerCase()
    };
  }).filter((item) => item.path && item.contentType);
}

function parseBodyTextPages(value) {
  return splitSmokeList(value).map((item) => {
    const separator = item.indexOf('=>');
    if (separator <= 0) return { path: item, text: '' };
    return {
      path: item.slice(0, separator).trim(),
      text: item.slice(separator + 2).trim()
    };
  }).filter((item) => item.path && item.text);
}

function parseTenantDomainPages(value) {
  return splitSmokeList(value).map((item) => {
    const textSeparator = item.indexOf('=>');
    const target = textSeparator <= 0 ? item.trim() : item.slice(0, textSeparator).trim();
    const hostSeparator = target.indexOf('|');
    if (hostSeparator <= 0) {
      return {
        host: '',
        path: '',
        text: ''
      };
    }

    return {
      host: target.slice(0, hostSeparator).trim(),
      path: target.slice(hostSeparator + 1).trim(),
      text: textSeparator <= 0 ? '' : item.slice(textSeparator + 2).trim()
    };
  }).filter((item) => item.host && item.path && item.text);
}

function resolveGatedPages(options, env) {
  if (hasOwn(options, 'gatedPagePaths')) return options.gatedPagePaths;
  if (hasOwn(env, 'SMOKE_GATED_PAGE_PATHS')) return parseGatedPages(env.SMOKE_GATED_PAGE_PATHS);
  return DEFAULT_SIGNED_GATED_PAGE_PATHS;
}

function resolveRedirectPages(options, env) {
  if (hasOwn(options, 'redirectPagePaths')) return options.redirectPagePaths;
  if (hasOwn(env, 'SMOKE_REDIRECT_PAGE_PATHS')) return parseRedirectPages(env.SMOKE_REDIRECT_PAGE_PATHS);
  return DEFAULT_SIGNED_REDIRECT_PAGE_PATHS;
}

function resolveContentTypePages(options, env) {
  if (hasOwn(options, 'contentTypePagePaths')) return options.contentTypePagePaths;
  if (hasOwn(env, 'SMOKE_CONTENT_TYPE_PAGE_PATHS')) return parseContentTypePages(env.SMOKE_CONTENT_TYPE_PAGE_PATHS);
  return DEFAULT_CONTENT_TYPE_PAGE_PATHS;
}

function resolveBodyTextPages(options, env) {
  if (hasOwn(options, 'bodyTextPagePaths')) return options.bodyTextPagePaths;
  const pages = hasOwn(env, 'SMOKE_BODY_TEXT_PAGE_PATHS')
    ? parseBodyTextPages(env.SMOKE_BODY_TEXT_PAGE_PATHS)
    : DEFAULT_BODY_TEXT_PAGE_PATHS;

  return applySmokeChunk(pages, env.SMOKE_BODY_TEXT_PAGE_CHUNK);
}

function resolveTenantDomainPages(options, env) {
  if (hasOwn(options, 'tenantDomainPagePaths')) return options.tenantDomainPagePaths;
  if (hasOwn(env, 'SMOKE_TENANT_DOMAIN_PAGE_PATHS')) return parseTenantDomainPages(env.SMOKE_TENANT_DOMAIN_PAGE_PATHS);
  return [];
}

function resolveOptions(options = {}, env = process.env) {
  return {
    webBaseUrl: stripTrailingSlash(options.webBaseUrl || env.WEB_UK_BASE_URL || DEFAULT_WEB_BASE_URL),
    laravelBaseUrl: stripTrailingSlash(options.laravelBaseUrl || env.LARAVEL_BASE_URL || DEFAULT_LARAVEL_BASE_URL),
    email: options.email || env.SMOKE_EMAIL || DEFAULT_SMOKE_EMAIL,
    password: options.password || env.SMOKE_PASSWORD || DEFAULT_SMOKE_PASSWORD,
    tenant: options.tenant || env.SMOKE_TENANT || DEFAULT_SMOKE_TENANT,
    timeoutMs: Number(options.timeoutMs || env.SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    publicModulePagePaths: resolvePathList(
      options,
      'publicModulePagePaths',
      env,
      'SMOKE_PUBLIC_MODULE_PAGE_PATHS',
      DEFAULT_PUBLIC_MODULE_PAGE_PATHS
    ),
    modulePagePaths: resolveModulePagePaths(options, env),
    unsignedAuthRequiredPagePaths: resolvePathList(
      options,
      'unsignedAuthRequiredPagePaths',
      env,
      'SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS',
      DEFAULT_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS
    ),
    unsignedLoginRedirectPagePaths: resolvePathList(
      options,
      'unsignedLoginRedirectPagePaths',
      env,
      'SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS',
      DEFAULT_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS
    ),
    gatedPagePaths: resolveGatedPages(options, env),
    redirectPagePaths: resolveRedirectPages(options, env),
    contentTypePagePaths: resolveContentTypePages(options, env),
    bodyTextPagePaths: resolveBodyTextPages(options, env),
    tenantDomainPagePaths: resolveTenantDomainPages(options, env),
    fetchImpl: options.fetchImpl || globalThis.fetch
  };
}

async function runLaravelRuntimeSmoke(options = {}) {
  const config = resolveOptions(options);
  const checks = [];
  const cookieJar = new CookieJar();

  if (typeof config.fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to run the Laravel runtime smoke test.');
  }

  try {
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      url: joinUrl(config.laravelBaseUrl, `/api/v2/tenant/bootstrap?slug=${encodeURIComponent(config.tenant)}`)
    });
    addCheck(checks, 'laravel-api-reachable', response.ok, response.ok ? 'Laravel API returned a successful response.' : `expected 2xx from Laravel API, got ${response.status}`, { status: response.status });
  } catch (error) {
    addCheck(checks, 'laravel-api-reachable', false, error.message);
  }

  try {
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      url: joinUrl(config.webBaseUrl, '/health')
    });
    addCheck(checks, 'web-health', response.ok, response.ok ? 'web-uk health endpoint returned a successful response.' : `expected 2xx from web-uk health, got ${response.status}`, { status: response.status });
  } catch (error) {
    addCheck(checks, 'web-health', false, error.message);
  }

  for (const tenantDomainPage of config.tenantDomainPagePaths) {
    const host = tenantDomainPage.host;
    const path = tenantDomainPage.path;
    const expectedText = String(tenantDomainPage.text || '');
    try {
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        url: joinUrl(config.webBaseUrl, path),
        options: {
          hostHeader: host
        }
      });
      const html = await readTextSafely(response);
      const lowerHtml = html.toLowerCase();
      const hasExpectedText = lowerHtml.includes(expectedText.toLowerCase());
      const hasLegacySlug = lowerHtml.includes('/alpha') || lowerHtml.includes('/accessible');
      const ok = response.ok && hasExpectedText && !hasLegacySlug;
      addCheck(
        checks,
        tenantDomainPageCheckName(host, path),
        ok,
        ok
          ? `${path} rendered for ${host} without legacy accessible slug links.`
          : `expected 2xx body containing "${expectedText}" and no /alpha or /accessible links from ${host}${path}, got ${response.status}`,
        { status: response.status, host, path, text: expectedText }
      );
    } catch (error) {
      addCheck(checks, tenantDomainPageCheckName(host, path), false, error.message, { host, path, text: expectedText });
    }
  }

  for (const path of config.publicModulePagePaths) {
    try {
      const unsignedCookieJar = new CookieJar();
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar: unsignedCookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      addCheck(
        checks,
        publicModulePageCheckName(path),
        response.ok,
        response.ok
          ? `${path} rendered successfully without an authenticated session.`
          : `expected unsigned 2xx from ${path}, got ${response.status} ${responseLocation(response)}`,
        { status: response.status, location: responseLocation(response), path }
      );
    } catch (error) {
      addCheck(checks, publicModulePageCheckName(path), false, error.message, { path });
    }
  }

  try {
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar,
      url: joinUrl(config.webBaseUrl, '/account')
    });
    addCheck(
      checks,
      'protected-account-redirects-to-login',
      isRedirectTo(response, '/login'),
      isRedirectTo(response, '/login')
        ? 'Unsigned /account redirects to login.'
        : `expected 302 redirect to /login, got ${response.status} ${responseLocation(response)}`,
      { status: response.status, location: responseLocation(response) }
    );
  } catch (error) {
    addCheck(checks, 'protected-account-redirects-to-login', false, error.message);
  }

  try {
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar,
      url: joinUrl(config.webBaseUrl, '/')
    });
    const html = await readTextSafely(response);
    const csrfToken = extractCsrfToken(html);

    if (!response.ok || !csrfToken) {
      addCheck(
        checks,
        cookieConsentPostCheckName(),
        false,
        `expected home page cookie banner with CSRF token, got ${response.status}`,
        { status: response.status }
      );
    } else {
      const form = new URLSearchParams({
        _csrf: csrfToken,
        cookies: 'reject',
        return: '/cookies'
      });
      const postResponse = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, '/cookie-consent'),
        options: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString()
        }
      });
      const cookieValue = cookieJar.get(ACCESSIBLE_COOKIE_NAME);
      const ok = isRedirectTo(postResponse, '/cookies') && cookieValue === 'essential';
      addCheck(
        checks,
        cookieConsentPostCheckName(),
        ok,
        ok
          ? 'No-JS cookie consent POST stored the essential-only accessible choice.'
          : `expected redirect to /cookies and ${ACCESSIBLE_COOKIE_NAME}=essential, got ${postResponse.status} ${responseLocation(postResponse)} with ${ACCESSIBLE_COOKIE_NAME}=${cookieValue || '<missing>'}`,
        { status: postResponse.status, location: responseLocation(postResponse), cookieValue }
      );
    }
  } catch (error) {
    addCheck(checks, cookieConsentPostCheckName(), false, error.message);
  }

  try {
    const acceptCookieJar = new CookieJar();
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar: acceptCookieJar,
      url: joinUrl(config.webBaseUrl, '/')
    });
    const html = await readTextSafely(response);
    const csrfToken = extractCsrfToken(html);

    if (!response.ok || !csrfToken) {
      addCheck(
        checks,
        cookieConsentAllPostCheckName(),
        false,
        `expected home page cookie banner with CSRF token, got ${response.status}`,
        { status: response.status }
      );
    } else {
      const form = new URLSearchParams({
        _csrf: csrfToken,
        cookies: 'accept',
        return: '/cookies'
      });
      const postResponse = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar: acceptCookieJar,
        url: joinUrl(config.webBaseUrl, '/cookie-consent'),
        options: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString()
        }
      });
      const cookieValue = acceptCookieJar.get(ACCESSIBLE_COOKIE_NAME);
      const ok = isRedirectTo(postResponse, '/cookies') && cookieValue === 'all';
      addCheck(
        checks,
        cookieConsentAllPostCheckName(),
        ok,
        ok
          ? 'No-JS cookie consent POST stored the analytics-enabled accessible choice.'
          : `expected redirect to /cookies and ${ACCESSIBLE_COOKIE_NAME}=all, got ${postResponse.status} ${responseLocation(postResponse)} with ${ACCESSIBLE_COOKIE_NAME}=${cookieValue || '<missing>'}`,
        { status: postResponse.status, location: responseLocation(postResponse), cookieValue }
      );
    }
  } catch (error) {
    addCheck(checks, cookieConsentAllPostCheckName(), false, error.message);
  }

  try {
    const settingsCookieJar = new CookieJar();
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar: settingsCookieJar,
      url: joinUrl(config.webBaseUrl, '/cookies')
    });
    const html = await readTextSafely(response);
    const csrfToken = extractCsrfToken(html);

    if (!response.ok || !csrfToken) {
      addCheck(
        checks,
        cookieSettingsSaveCheckName(),
        false,
        `expected cookie settings form with CSRF token, got ${response.status}`,
        { status: response.status }
      );
    } else {
      const form = new URLSearchParams({
        _csrf: csrfToken,
        cookies: 'save',
        analytics: 'yes'
      });
      const postResponse = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar: settingsCookieJar,
        url: joinUrl(config.webBaseUrl, '/cookie-consent'),
        options: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString()
        }
      });
      const cookieValue = settingsCookieJar.get(ACCESSIBLE_COOKIE_NAME);
      const ok = isRedirectTo(postResponse, '/cookies?status=saved') && cookieValue === 'all';
      addCheck(
        checks,
        cookieSettingsSaveCheckName(),
        ok,
        ok
          ? 'Cookie settings POST saved the analytics-enabled Laravel-compatible choice.'
          : `expected redirect to /cookies?status=saved and ${ACCESSIBLE_COOKIE_NAME}=all, got ${postResponse.status} ${responseLocation(postResponse)} with ${ACCESSIBLE_COOKIE_NAME}=${cookieValue || '<missing>'}`,
        { status: postResponse.status, location: responseLocation(postResponse), cookieValue }
      );
    }
  } catch (error) {
    addCheck(checks, cookieSettingsSaveCheckName(), false, error.message);
  }

  for (const path of config.unsignedAuthRequiredPagePaths) {
    const expectedLocation = '/login?status=auth-required';
    try {
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      const ok = isRedirectTo(response, expectedLocation);
      addCheck(
        checks,
        authRequiredPageCheckName(path, expectedLocation),
        ok,
        ok ? `${path} redirected to ${expectedLocation}.` : `expected redirect to ${expectedLocation} from ${path}, got ${response.status} ${responseLocation(response)}`,
        { status: response.status, location: responseLocation(response), path }
      );
    } catch (error) {
      addCheck(checks, authRequiredPageCheckName(path, expectedLocation), false, error.message, { path });
    }
  }

  for (const path of config.unsignedLoginRedirectPagePaths) {
    const expectedLocation = '/login';
    try {
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      const ok = isRedirectTo(response, expectedLocation);
      addCheck(
        checks,
        unsignedLoginRedirectPageCheckName(path),
        ok,
        ok ? `${path} redirected to ${expectedLocation}.` : `expected redirect to ${expectedLocation} from ${path}, got ${response.status} ${responseLocation(response)}`,
        { status: response.status, location: responseLocation(response), path }
      );
    } catch (error) {
      addCheck(checks, unsignedLoginRedirectPageCheckName(path), false, error.message, { path });
    }
  }

  let csrfToken = '';
  try {
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar,
      url: joinUrl(config.webBaseUrl, '/login')
    });
    const html = await readTextSafely(response);
    csrfToken = extractCsrfToken(html);
    addCheck(
      checks,
      'login-form-csrf',
      response.ok && Boolean(csrfToken),
      response.ok && csrfToken ? 'Login form rendered a CSRF token.' : `expected login form with CSRF token, got ${response.status}`,
      { status: response.status }
    );
  } catch (error) {
    addCheck(checks, 'login-form-csrf', false, error.message);
  }

  try {
    const form = new URLSearchParams({
      _csrf: csrfToken,
      email: config.email,
      password: config.password,
      tenant_slug: config.tenant
    });
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar,
      url: joinUrl(config.webBaseUrl, '/login'),
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString()
      }
    });
    addCheck(
      checks,
      'login-post-redirects-dashboard',
      isRedirectTo(response, '/dashboard'),
      isRedirectTo(response, '/dashboard')
        ? 'Login POST redirected to dashboard.'
        : `expected 302 redirect to /dashboard, got ${response.status} ${responseLocation(response)}`,
      { status: response.status, location: responseLocation(response) }
    );
  } catch (error) {
    addCheck(checks, 'login-post-redirects-dashboard', false, error.message);
  }

  try {
    const response = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar,
      url: joinUrl(config.webBaseUrl, '/account')
    });
    addCheck(
      checks,
      'signed-account-renders',
      response.ok,
      response.ok ? 'Signed account page rendered successfully.' : `expected 2xx from signed account page, got ${response.status} ${responseLocation(response)}`,
      { status: response.status, location: responseLocation(response) }
    );
  } catch (error) {
    addCheck(checks, 'signed-account-renders', false, error.message);
  }

  try {
    const logoutCookieJar = new CookieJar();
    await refreshSignedSession(config, logoutCookieJar);
    const accountResponse = await smokeRequest({
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      cookieJar: logoutCookieJar,
      url: joinUrl(config.webBaseUrl, '/account')
    });
    const html = await readTextSafely(accountResponse);
    const logoutCsrfToken = extractCsrfToken(html);

    if (!accountResponse.ok || !logoutCsrfToken) {
      addCheck(
        checks,
        logoutPostCheckName(),
        false,
        `expected signed account page with logout CSRF token, got ${accountResponse.status}`,
        { status: accountResponse.status }
      );
    } else {
      const form = new URLSearchParams({ _csrf: logoutCsrfToken });
      const logoutResponse = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar: logoutCookieJar,
        url: joinUrl(config.webBaseUrl, '/logout'),
        options: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString()
        }
      });
      const accountAfterLogoutResponse = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar: logoutCookieJar,
        url: joinUrl(config.webBaseUrl, '/account')
      });
      const ok = isRedirectTo(logoutResponse, '/login') && isRedirectTo(accountAfterLogoutResponse, '/login');
      addCheck(
        checks,
        logoutPostCheckName(),
        ok,
        ok
          ? 'Logout POST redirected to login and cleared the signed account session.'
          : `expected logout redirect and signed account to redirect to /login, got logout ${logoutResponse.status} ${responseLocation(logoutResponse)} and account ${accountAfterLogoutResponse.status} ${responseLocation(accountAfterLogoutResponse)}`,
        {
          status: logoutResponse.status,
          location: responseLocation(logoutResponse),
          accountStatus: accountAfterLogoutResponse.status,
          accountLocation: responseLocation(accountAfterLogoutResponse)
        }
      );
    }
  } catch (error) {
    addCheck(checks, logoutPostCheckName(), false, error.message);
  }

  for (const path of config.modulePagePaths) {
    try {
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      addCheck(
        checks,
        modulePageCheckName(path),
        response.ok,
        response.ok ? `${path} rendered successfully.` : `expected 2xx from ${path}, got ${response.status} ${responseLocation(response)}`,
        { status: response.status, location: responseLocation(response), path }
      );
    } catch (error) {
      addCheck(checks, modulePageCheckName(path), false, error.message, { path });
    }
  }

  for (const contentTypePage of config.contentTypePagePaths) {
    const path = contentTypePage.path;
    const expectedContentType = String(contentTypePage.contentType || '').toLowerCase();
    try {
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      const actualContentType = String(response.headers.get('content-type') || '').toLowerCase();
      const ok = response.ok && actualContentType.includes(expectedContentType);
      addCheck(
        checks,
        contentTypePageCheckName(path, expectedContentType),
        ok,
        ok ? `${path} returned ${actualContentType}.` : `expected 2xx ${expectedContentType} from ${path}, got ${response.status} ${actualContentType}`,
        { status: response.status, contentType: actualContentType, path }
      );
    } catch (error) {
      addCheck(checks, contentTypePageCheckName(path, expectedContentType), false, error.message, { path });
    }
  }

  for (const bodyTextPage of config.bodyTextPagePaths) {
    const path = bodyTextPage.path;
    const expectedText = String(bodyTextPage.text || '');
    try {
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      const html = await readTextSafely(response);
      const ok = response.ok && html.toLowerCase().includes(expectedText.toLowerCase());
      addCheck(
        checks,
        bodyTextPageCheckName(path, expectedText),
        ok,
        ok ? `${path} included "${expectedText}".` : `expected 2xx body containing "${expectedText}" from ${path}, got ${response.status}`,
        { status: response.status, text: expectedText, path }
      );
    } catch (error) {
      addCheck(checks, bodyTextPageCheckName(path, expectedText), false, error.message, { path });
    }
  }

  if (config.gatedPagePaths.length > 0) {
    try {
      await refreshSignedSession(config, cookieJar);
    } catch (error) {
      for (const gatedPage of config.gatedPagePaths) {
        addCheck(checks, gatedPageCheckName(gatedPage.path, gatedPage.status), false, error.message, { path: gatedPage.path });
      }
    }
  }

  for (const gatedPage of config.gatedPagePaths) {
    if (checks.some((check) => check.name === gatedPageCheckName(gatedPage.path, gatedPage.status) && !check.ok)) {
      continue;
    }
    const path = gatedPage.path;
    const expectedStatus = gatedPage.status;
    try {
      let response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      if (isRedirectTo(response, '/login')) {
        await refreshSignedSession(config, cookieJar);
        response = await smokeRequest({
          fetchImpl: config.fetchImpl,
          timeoutMs: config.timeoutMs,
          cookieJar,
          url: joinUrl(config.webBaseUrl, path)
        });
      }
      addCheck(
        checks,
        gatedPageCheckName(path, expectedStatus),
        response.status === expectedStatus,
        response.status === expectedStatus ? `${path} returned expected ${expectedStatus}.` : `expected ${expectedStatus} from ${path}, got ${response.status} ${responseLocation(response)}`,
        { status: response.status, location: responseLocation(response), path }
      );
    } catch (error) {
      addCheck(checks, gatedPageCheckName(path, expectedStatus), false, error.message, { path });
    }
  }

  if (config.redirectPagePaths.length > 0) {
    try {
      await refreshSignedSession(config, cookieJar);
    } catch (error) {
      for (const redirectPage of config.redirectPagePaths) {
        addCheck(checks, redirectPageCheckName(redirectPage.path, redirectPage.location), false, error.message, { path: redirectPage.path });
      }
    }
  }

  for (const redirectPage of config.redirectPagePaths) {
    if (checks.some((check) => check.name === redirectPageCheckName(redirectPage.path, redirectPage.location) && !check.ok)) {
      continue;
    }
    const path = redirectPage.path;
    const expectedLocation = redirectPage.location;
    try {
      const response = await smokeRequest({
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        cookieJar,
        url: joinUrl(config.webBaseUrl, path)
      });
      const ok = isRedirectTo(response, expectedLocation);
      addCheck(
        checks,
        redirectPageCheckName(path, expectedLocation),
        ok,
        ok ? `${path} redirected to ${expectedLocation}.` : `expected redirect to ${expectedLocation} from ${path}, got ${response.status} ${responseLocation(response)}`,
        { status: response.status, location: responseLocation(response), path }
      );
    } catch (error) {
      addCheck(checks, redirectPageCheckName(path, expectedLocation), false, error.message, { path });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    webBaseUrl: config.webBaseUrl,
    laravelBaseUrl: config.laravelBaseUrl,
    tenant: config.tenant,
    email: config.email,
    checks
  };
}

function listenForRuntimeSmoke(app, host = '127.0.0.1') {
  if (!app || typeof app.listen !== 'function') {
    throw new Error('A web app with a listen() method is required.');
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(0, host, () => {
      server.off('error', reject);
      const address = server.address();
      resolve({
        server,
        webBaseUrl: `http://${host}:${address.port}`
      });
    });

    server.once('error', reject);
  });
}

function closeRuntimeSmokeServer(server) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      if (error) reject(error); else resolve();
    };
    const forceTimer = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      finish();
    }, 5000);
    server.close(finish);
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  });
}

async function runLaravelRuntimeSmokeAgainstApp(app, options = {}) {
  const { server, webBaseUrl } = await listenForRuntimeSmoke(app);

  try {
    return await runLaravelRuntimeSmoke({
      ...options,
      webBaseUrl
    });
  } finally {
    await closeRuntimeSmokeServer(server);
  }
}

async function main() {
  const result = await runLaravelRuntimeSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  CookieJar,
  extractCsrfToken,
  resolveOptions,
  runLaravelRuntimeSmoke,
  runLaravelRuntimeSmokeAgainstApp,
  splitSetCookieHeader
};
