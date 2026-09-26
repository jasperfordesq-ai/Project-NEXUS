// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

import React from 'react';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

const mockRouterPush = jest.fn();
let mockRouteParams: Record<string, string> = { id: '1' };

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockRouteParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///tmp/group-media.jpg', fileName: 'group-media.jpg', mimeType: 'image/jpeg' }],
  }),
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos' },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'detail.title': 'Group Detail',
        'detail.invalidId': 'Invalid group ID.',
        'detail.goBack': 'Go back',
        'detail.notFound': 'Group not found.',
        'detail.about': 'About',
        'detail.members': 'Members',
        'detail.admin': 'Group admin',
        'detail.groupAdmin': 'Group admin',
        'detail.emptyAbout': 'No description.',
        'detail.emptyDiscussions': 'No discussions.',
        'detail.emptyMembers': 'No members.',
        'detail.emptyAnnouncements': 'No announcements.',
        'detail.joinToDiscuss': 'Join to discuss.',
        'detail.joinToSeeMembers': 'Join to see members.',
        'detail.joinToSeeAnnouncements': 'Join to see announcements.',
        'detail.pinned': 'Pinned',
        'detail.newAnnouncement': 'New announcement',
        'detail.newAnnouncementHint': 'Post an update.',
        'detail.createAnnouncement': 'Create',
        'detail.announcementTitlePlaceholder': 'Announcement title',
        'detail.announcementContentPlaceholder': 'Write the announcement...',
        'detail.pinAnnouncement': 'Pin announcement',
        'detail.unpinAnnouncement': 'Unpin',
        'detail.publishAnnouncement': 'Publish announcement',
        'detail.announcementRequired': 'Add a title and message.',
        'detail.announcementCreateError': 'Could not create announcement.',
        'detail.announcementUpdateError': 'Could not update announcement.',
        'detail.announcementDeleteError': 'Could not delete announcement.',
        'detail.deleteAnnouncement': 'Delete',
        'detail.deleteAnnouncementTitle': 'Delete announcement',
        'detail.deleteAnnouncementMessage': 'Delete this announcement?',
        'detail.startDiscussion': 'Start a discussion',
        'detail.startDiscussionHint': 'Ask a question.',
        'detail.newDiscussion': 'New',
        'detail.discussionTitlePlaceholder': 'Discussion title',
        'detail.discussionContentPlaceholder': 'Write a message',
        'detail.publishDiscussion': 'Publish discussion',
        'detail.discussionRequired': 'Add a title and message.',
        'detail.discussionCreateError': 'Could not create discussion.',
        'detail.discussionRecoveryError': 'Could not restore the unfinished discussion.',
        'detail.discussionRecoveryNotice': 'An unfinished discussion was restored. Retry it before starting another discussion.',
        'detail.replies': opts ? `${String(opts.count ?? 0)} replies` : '0 replies',
        'detail.tabs.overview': 'Overview',
        'detail.tabs.discussion': 'Discussions',
        'detail.tabs.members': 'Members',
        'detail.tabs.events': 'Events',
        'detail.tabs.announcements': 'Announcements',
        'detail.tabs.files': 'Files',
        'detail.tabs.media': 'Media',
        'detail.tabs.qa': 'Q&A',
        'detail.tabs.wiki': 'Wiki',
        'detail.tabs.tasks': 'Tasks',
        'detail.tabs.analytics': 'Analytics',
        'detail.tabs.marketplace': 'Marketplace',
        'detail.files.title': 'Group files',
        'detail.files.subtitle': 'Documents and resources.',
        'detail.files.upload': 'Upload file',
        'detail.files.uploadLabel': 'Choose a file to share with this group',
        'detail.files.uploading': 'Uploading file',
        'detail.files.uploadSuccess': 'File uploaded.',
        'detail.files.uploadError': 'Could not upload the file.',
        'detail.files.tooLarge': 'Choose a file no larger than 25 MB.',
        'detail.files.unsupportedType': 'This file type is not supported.',
        'detail.files.empty': 'No files yet.',
        'detail.files.joinToView': 'Join to view files.',
        'detail.files.download': 'Download',
        'detail.files.downloadLabel': opts ? `Download ${String(opts.name ?? '')}` : 'Download file',
        'detail.files.delete': 'Delete',
        'detail.files.deleteLabel': opts ? `Delete ${String(opts.name ?? '')}` : 'Delete file',
        'detail.files.deleteTitle': 'Delete file',
        'detail.files.deleteMessage': opts ? `Delete ${String(opts.name ?? '')}?` : 'Delete file?',
        'detail.files.deleteError': 'Could not delete file.',
        'detail.media.title': 'Group media',
        'detail.media.subtitle': 'Photos and videos.',
        'detail.media.empty': 'No media yet.',
        'detail.media.joinToView': 'Join to view media.',
        'detail.media.open': 'Open',
        'detail.media.openLabel': 'Open media',
        'detail.media.delete': 'Delete',
        'detail.media.deleteTitle': 'Delete media',
        'detail.media.deleteMessage': 'Delete media?',
        'detail.media.deleteError': 'Could not delete media.',
        'detail.media.loadError': 'Could not load media.',
        'detail.media.uploadPhoto': 'Upload photo',
        'detail.media.uploadVideo': 'Upload video',
        'detail.media.uploadError': 'Could not upload media.',
        'detail.media.permissionTitle': 'Photo library access needed',
        'detail.media.permissionMessage': 'Allow photo library access.',
        'detail.media.filters.all': 'All',
        'detail.media.filters.image': 'Photos',
        'detail.media.filters.video': 'Videos',
        'detail.media.type.image': 'Photo',
        'detail.media.type.video': 'Video',
        'detail.qa.title': 'Group Q&A',
        'detail.qa.subtitle': 'Ask practical questions.',
        'detail.qa.ask': 'Ask',
        'detail.qa.titlePlaceholder': 'Question title',
        'detail.qa.bodyPlaceholder': 'Add context...',
        'detail.qa.publish': 'Publish question',
        'detail.qa.validation': 'Add a question title and details.',
        'detail.qa.createError': 'Could not create question.',
        'detail.qa.loadError': 'Could not load question.',
        'detail.qa.answerPlaceholder': 'Write an answer...',
        'detail.qa.postAnswer': 'Post answer',
        'detail.qa.answerValidation': 'Write an answer.',
        'detail.qa.answerError': 'Could not post answer.',
        'detail.qa.voteError': 'Could not vote.',
        'detail.qa.acceptError': 'Could not accept answer.',
        'detail.qa.empty': 'No questions yet.',
        'detail.qa.joinToView': 'Join to view Q&A.',
        'detail.qa.answered': 'Answered',
        'detail.qa.accepted': 'Accepted',
        'detail.qa.acceptAnswer': 'Accept answer',
        'detail.qa.upvote': 'Upvote',
        'detail.qa.downvote': 'Downvote',
        'detail.qa.upvoteQuestion': 'Upvote question',
        'detail.qa.downvoteQuestion': 'Downvote question',
        'detail.qa.upvoteAnswer': 'Upvote answer',
        'detail.qa.downvoteAnswer': 'Downvote answer',
        'detail.qa.noAnswers': 'No answers yet.',
        'detail.qa.answers': opts ? `${String(opts.count ?? 0)} answers` : '0 answers',
        'detail.qa.votes': opts ? `${String(opts.count ?? 0)} votes` : '0 votes',
        'detail.wiki.title': 'Group wiki',
        'detail.wiki.subtitle': 'Build a shared knowledge base.',
        'detail.wiki.newPage': 'New page',
        'detail.wiki.titlePlaceholder': 'Page title',
        'detail.wiki.contentPlaceholder': 'Write the page content...',
        'detail.wiki.changeSummaryPlaceholder': 'Change summary',
        'detail.wiki.editContentLabel': 'Wiki page content',
        'detail.wiki.create': 'Create page',
        'detail.wiki.edit': 'Edit',
        'detail.wiki.save': 'Save page',
        'detail.wiki.validation': 'Add a title and content.',
        'detail.wiki.loadError': 'Could not load wiki pages.',
        'detail.wiki.pageLoadError': 'Could not load this wiki page.',
        'detail.wiki.createError': 'Could not create the wiki page.',
        'detail.wiki.saveError': 'Could not save the wiki page.',
        'detail.wiki.deleteError': 'Could not delete wiki page.',
        'detail.wiki.revisionsError': 'Could not load revisions.',
        'detail.wiki.empty': 'No wiki pages yet.',
        'detail.wiki.emptyContent': 'No content yet.',
        'detail.wiki.joinToView': 'Join to view wiki.',
        'detail.wiki.draft': 'Draft',
        'detail.wiki.delete': 'Delete',
        'detail.wiki.deleteTitle': 'Delete wiki page',
        'detail.wiki.deleteMessage': opts ? `Delete ${String(opts.title ?? '')}?` : 'Delete wiki page?',
        'detail.wiki.revisions': 'Revisions',
        'detail.wiki.hideRevisions': 'Hide revisions',
        'detail.wiki.noRevisions': 'No revisions yet.',
        'detail.wiki.revisionFallback': 'Revision',
        'detail.tasks.title': 'Group tasks',
        'detail.tasks.subtitle': 'Track shared work.',
        'detail.tasks.newTask': 'New task',
        'detail.tasks.titlePlaceholder': 'Task title',
        'detail.tasks.descriptionPlaceholder': 'Add task details...',
        'detail.tasks.dueDatePlaceholder': 'Due date, for example 2026-06-30',
        'detail.tasks.priorityLabel': 'Priority',
        'detail.tasks.assigneeLabel': 'Assign to',
        'detail.tasks.quickPriority': 'Priority',
        'detail.tasks.quickAssignee': 'Assignee',
        'detail.tasks.unassigned': 'Unassigned',
        'detail.tasks.create': 'Create task',
        'detail.tasks.validation': 'Add a task title.',
        'detail.tasks.loadError': 'Could not load tasks.',
        'detail.tasks.createError': 'Could not create task.',
        'detail.tasks.recoveryError': 'Could not restore the unfinished task.',
        'detail.tasks.recoveryNotice': 'An unfinished task was restored. Retry it before creating another task.',
        'detail.tasks.updateError': 'Could not update task.',
        'detail.tasks.deleteError': 'Could not delete task.',
        'detail.tasks.empty': 'No tasks yet.',
        'detail.tasks.joinToView': 'Join to view tasks.',
        'detail.tasks.delete': 'Delete',
        'detail.tasks.deleteTitle': 'Delete task',
        'detail.tasks.deleteMessage': opts ? `Delete ${String(opts.title ?? '')}?` : 'Delete task?',
        'detail.tasks.dueDate': opts ? `Due ${String(opts.date ?? '')}` : 'Due',
        'detail.tasks.filters.all': 'All',
        'detail.tasks.filters.todo': 'To do',
        'detail.tasks.filters.in_progress': 'In progress',
        'detail.tasks.filters.done': 'Done',
        'detail.tasks.status.todo': 'To do',
        'detail.tasks.status.in_progress': 'In progress',
        'detail.tasks.status.done': 'Done',
        'detail.tasks.priority.low': 'Low',
        'detail.tasks.priority.medium': 'Medium',
        'detail.tasks.priority.high': 'High',
        'detail.tasks.priority.urgent': 'Urgent',
        'detail.tasks.stats.total': opts ? `${String(opts.count ?? 0)} total` : '0 total',
        'detail.tasks.stats.todo': opts ? `${String(opts.count ?? 0)} to do` : '0 to do',
        'detail.tasks.stats.in_progress': opts ? `${String(opts.count ?? 0)} in progress` : '0 in progress',
        'detail.tasks.stats.done': opts ? `${String(opts.count ?? 0)} done` : '0 done',
        'detail.tasks.stats.overdue': opts ? `${String(opts.count ?? 0)} overdue` : '0 overdue',
        'detail.analytics.title': 'Group analytics',
        'detail.analytics.subtitle': 'Monitor membership.',
        'detail.analytics.adminOnly': 'Only group admins can view analytics.',
        'detail.analytics.loadError': 'Could not load analytics.',
        'detail.analytics.empty': 'No analytics yet.',
        'detail.analytics.activity': 'Activity breakdown',
        'detail.analytics.contributors': 'Top contributors',
        'detail.analytics.content': 'Content performance',
        'detail.analytics.retention': 'Retention',
        'detail.analytics.comparative': 'Group comparison',
        'detail.analytics.noRetention': 'No retention data yet.',
        'detail.analytics.noContributors': 'No contributor activity yet.',
        'detail.analytics.noContent': 'No content performance data yet.',
        'detail.analytics.postCount': opts ? `${String(opts.count ?? 0)} posts` : '0 posts',
        'detail.analytics.replies': opts ? `${String(opts.count ?? 0)} replies` : '0 replies',
        'detail.analytics.participants': opts ? `${String(opts.count ?? 0)} participants` : '0 participants',
        'detail.analytics.retentionDetail': opts ? `${String(opts.joined ?? 0)} joined, ${String(opts.active ?? 0)} still active` : '0 joined',
        'detail.analytics.rankValue': opts ? `#${String(opts.rank ?? 0)} of ${String(opts.total ?? 0)}` : '-',
        'detail.analytics.latestGrowth': opts ? `${String(opts.count ?? 0)} new members, ${String(opts.total ?? 0)} total members` : '0 new members',
        'detail.analytics.latestEngagement': opts ? `${String(opts.posts ?? 0)} posts, ${String(opts.discussions ?? 0)} discussions, ${String(opts.active ?? 0)} active members` : '0 posts',
        'detail.analytics.days.7': '7 days',
        'detail.analytics.days.30': '30 days',
        'detail.analytics.days.90': '90 days',
        'detail.analytics.metrics.members': 'Members',
        'detail.analytics.metrics.activeMembers': 'Active',
        'detail.analytics.metrics.participation': 'Participation',
        'detail.analytics.metrics.postsPerDay': 'Posts/day',
        'detail.analytics.metrics.retention': 'Retention',
        'detail.analytics.metrics.rank': 'Rank',
        'detail.analytics.comparison.members': opts ? `${String(opts.count ?? 0)} members` : '0 members',
        'detail.analytics.comparison.average': opts ? `${String(opts.count ?? 0)} average` : '0 average',
        'detail.analytics.comparison.percentile': opts ? `${String(opts.count ?? 0)} percentile` : '0 percentile',
        'detail.analytics.breakdown.discussions': opts ? `${String(opts.count ?? 0)} discussions` : '0 discussions',
        'detail.analytics.breakdown.posts': opts ? `${String(opts.count ?? 0)} posts` : '0 posts',
        'detail.analytics.breakdown.events': opts ? `${String(opts.count ?? 0)} events` : '0 events',
        'detail.analytics.breakdown.files': opts ? `${String(opts.count ?? 0)} files` : '0 files',
        'detail.analytics.breakdown.member_joins': opts ? `${String(opts.count ?? 0)} joins` : '0 joins',
        'detail.eventsHeading': 'Group events',
        'detail.eventsSubtitle': 'Events connected to this group.',
        'detail.emptyEvents': 'No events yet.',
        'detail.eventAttending': opts ? `${String(opts.count ?? 0)} going` : '0 going',
        'detail.eventOnline': 'Online',
        'detail.roles.owner': 'Owner',
        'detail.roles.admin': 'Admin',
        'detail.roles.member': 'Member',
        'detail.stats.members': 'Members',
        'detail.stats.posts': 'Posts',
        'detail.ownerTools': 'Group tools',
        'detail.edit': 'Edit group',
        'invite_manage.open': 'Manage invitations',
        'featured': 'Featured',
        'private': 'Private',
        'public': 'Public',
        'join': 'Join',
        'leave': 'Leave',
        'joined': 'Joined',
        'leaveConfirmTitle': 'Leave group?',
        'leaveConfirmMessage': 'Are you sure you want to leave?',
        'joinError': 'Failed to join.',
        'leaveError': 'Failed to leave.',
        'members': opts ? `${String(opts.count ?? 0)} members` : '0 members',
        'posts': opts ? `${String(opts.count ?? 0)} posts` : '0 posts',
        'common:buttons.cancel': 'Cancel',
        'common:errors.alertTitle': 'Error',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

let mockGroupTabs: Record<string, boolean> = {};
const mockHasGroupTab = jest.fn((key: string) => mockGroupTabs[key] ?? true);
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true, hasGroupTab: (key: string) => mockHasGroupTab(key), tenant: { id: 2, slug: 'hour-timebank' } }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#16a34a',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

/*
  🔴 Five of this screen's lists moved from `useApi` to `usePaginatedApi` when they were
  given paging, and this file stubs `useApi` POSITIONALLY — one entry per hook call, in
  declaration order. Rather than rewriting twenty positional arrays (and losing the
  ordering they encode), the paginated hook draws from the SAME sequence: it consumes the
  next `mockUseApi` slot and runs the component's real extractor over it, so the
  extractors are exercised rather than bypassed.

  Fixtures written before paging carry no `meta`/`cursor`/`has_more`. Those defaults are
  filled in here rather than caught-and-ignored, so an extractor that reads a field the
  fixture genuinely lacks still throws.
*/
type PaginatedExtract = { items: unknown[]; cursor: string | null; hasMore: boolean };
/** Every `loadMore` handed out this render, so a test can prove a button is wired to one. */
const mockLoadMoreCalls: jest.Mock[] = [];
const mockPaginatedOptions: ({ enabled?: boolean } | undefined)[] = [];
const mockWithPaginationDefaults = (response: unknown): unknown => {
  if (!response || typeof response !== 'object') return response;
  const body = response as Record<string, unknown>;
  const inner = body.data;
  return {
    meta: { cursor: null, has_more: false },
    ...body,
    data: inner && typeof inner === 'object' && !Array.isArray(inner)
      ? { cursor: null, has_more: false, items: [], ...(inner as Record<string, unknown>) }
      : inner,
  };
};
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (
    _fetchFn: unknown,
    extractor: (response: unknown) => PaginatedExtract,
    _deps: unknown,
    options?: { enabled?: boolean },
  ) => {
    mockPaginatedOptions.push(options);
    const state = mockUseApi() as { data?: unknown; isLoading?: boolean; error?: string | null; refresh?: () => void } | undefined;
    const extracted = state?.data
      ? extractor(mockWithPaginationDefaults(state.data))
      : { items: [], cursor: null, hasMore: false };
    return {
      items: extracted.items ?? [],
      isLoading: state?.isLoading ?? false,
      isLoadingMore: false,
      error: state?.error ?? null,
      errorStatus: null,
      errorCode: null,
      hasMore: extracted.hasMore ?? false,
      loadMore: (() => { const fn = jest.fn(); mockLoadMoreCalls.push(fn); return fn; })(),
      refresh: state?.refresh ?? jest.fn(),
    };
  },
}));

let mockAuthUser: { id: number; name: string } | null = { id: 99, name: 'Current User' };
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

const mockReserveGroupFileUploadOperation = jest.fn().mockResolvedValue({
  storageKey: 'group-file-operation',
  key: 'group-file-idempotency-key',
  createdAt: 1,
});
const mockCompleteGroupFileUploadOperation = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/groupFileUploadOperation', () => ({
  reserveGroupFileUploadOperation: (...args: unknown[]) => mockReserveGroupFileUploadOperation(...args),
  completeGroupFileUploadOperation: (...args: unknown[]) => mockCompleteGroupFileUploadOperation(...args),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/groups', () => ({
  getGroup: jest.fn(),
  getGroupJoinRequests: jest.fn().mockResolvedValue({ data: [] }),
  handleGroupJoinRequest: jest.fn().mockResolvedValue({}),
  updateGroupMemberRole: jest.fn().mockResolvedValue({}),
  removeGroupMember: jest.fn().mockResolvedValue({}),
  createGroupDiscussion: jest.fn().mockResolvedValue({ data: {} }),
  getGroupMembers: jest.fn(),
  getGroupDiscussions: jest.fn(),
  getGroupAnnouncements: jest.fn(),
  getGroupFiles: jest.fn(),
  deleteGroupFile: jest.fn().mockResolvedValue({ data: { message: 'Deleted' } }),
  uploadGroupFile: jest.fn().mockResolvedValue({ data: { id: 32, file_name: 'group-notes.txt' } }),
  getGroupMedia: jest.fn().mockResolvedValue({ data: { items: [], cursor: null, has_more: false } }),
  deleteGroupMedia: jest.fn().mockResolvedValue({ data: { message: 'Deleted' } }),
  uploadGroupMedia: jest.fn().mockResolvedValue({ data: { id: 82, url: '/uploads/groups/media.jpg', type: 'image', uploaded_by: 10, created_at: '2026-06-01T00:00:00Z' } }),
  getGroupAnalytics: jest.fn().mockResolvedValue({
    data: {
      overview: { total_members: 0, total_discussions: 0, total_posts: 0, total_events: 0, total_files: 0, pending_requests: 0 },
      member_growth: [],
      engagement: { timeline: [], summary: { total_members: 0, active_members: 0, participation_rate: 0, avg_posts_per_day: 0 } },
      top_contributors: [],
      content_performance: [],
      activity_breakdown: { discussions: 0, posts: 0, events: 0, files: 0, member_joins: 0, total: 0 },
    },
  }),
  getGroupAnalyticsRetention: jest.fn().mockResolvedValue({ data: [] }),
  getGroupAnalyticsComparative: jest.fn().mockResolvedValue({ data: { group_members: 0, avg_members: 0, percentile: 0, total_groups: 0, rank: 0 } }),
  getGroupQuestions: jest.fn(),
  getGroupQuestion: jest.fn().mockResolvedValue({ data: { id: 44, title: 'How should we compost?', answers: [] } }),
  createGroupQuestion: jest.fn().mockResolvedValue({ data: { id: 44, title: 'How should we compost?' } }),
  answerGroupQuestion: jest.fn().mockResolvedValue({ data: { id: 55, question_id: 44 } }),
  voteGroupQA: jest.fn().mockResolvedValue({ data: { message: 'Vote recorded' } }),
  acceptGroupAnswer: jest.fn().mockResolvedValue({ data: { message: 'Accepted' } }),
  getGroupWikiPages: jest.fn().mockResolvedValue({ data: [] }),
  getGroupWikiPage: jest.fn().mockResolvedValue({ data: { id: 61, title: 'Compost guide', slug: 'compost-guide', content: 'Use a lidded bin.', parent_id: null, sort_order: 0, is_published: true, author: { id: 10, name: 'Alice Admin' }, updated_at: '2026-06-01T00:00:00Z' } }),
  createGroupWikiPage: jest.fn().mockResolvedValue({ data: { id: 62, title: 'Tool care', slug: 'tool-care', content: 'Clean tools after use.', parent_id: null, sort_order: 0, is_published: true, author: { id: 10, name: 'Alice Admin' }, updated_at: '2026-06-01T00:00:00Z' } }),
  updateGroupWikiPage: jest.fn().mockResolvedValue({ data: { id: 61, title: 'Compost guide', slug: 'compost-guide', content: 'Keep it covered.', parent_id: null, sort_order: 0, is_published: true, author: { id: 10, name: 'Alice Admin' }, updated_at: '2026-06-02T00:00:00Z' } }),
  getGroupWikiRevisions: jest.fn().mockResolvedValue({ data: [] }),
  deleteGroupWikiPage: jest.fn().mockResolvedValue({ data: { message: 'Deleted' } }),
  getGroupTasks: jest.fn().mockResolvedValue({ data: [], meta: { has_more: false, cursor: null } }),
  getGroupTask: jest.fn().mockResolvedValue({ data: { id: 70, group_id: 1, title: 'Water seedlings', description: null, status: 'in_progress', priority: 'medium', assigned_to: null, due_date: null, created_at: '2026-06-01T00:00:00Z' } }),
  getGroupTaskStats: jest.fn().mockResolvedValue({ data: { total: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 } }),
  createGroupTask: jest.fn().mockResolvedValue({ data: { id: 70, group_id: 1, title: 'Water seedlings', description: null, status: 'todo', priority: 'medium', assigned_to: null, due_date: null, created_at: '2026-06-01T00:00:00Z' } }),
  updateGroupTask: jest.fn().mockResolvedValue({ data: { id: 70, group_id: 1, title: 'Water seedlings', description: null, status: 'in_progress', priority: 'medium', assigned_to: null, due_date: null, created_at: '2026-06-01T00:00:00Z' } }),
  deleteGroupTask: jest.fn().mockResolvedValue(undefined),
  createGroupAnnouncement: jest.fn().mockResolvedValue({ data: {} }),
  updateGroupAnnouncement: jest.fn().mockResolvedValue({ data: {} }),
  deleteGroupAnnouncement: jest.fn().mockResolvedValue({ data: { deleted: true } }),
  joinGroup: jest.fn().mockResolvedValue({}),
  leaveGroup: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/lib/groupJoinRequestDecisionOperation', () => ({
  // The recovery contract has its own focused component suite. Keep this parent-screen
  // harness at the loading boundary so its positional useApi stub remains stable without
  // leaking an unawaited child state update into otherwise unrelated tests.
  loadGroupJoinRequestDecisionOperation: jest.fn(() => new Promise(() => {})),
  reserveGroupJoinRequestDecisionOperation: jest.fn(),
  completeGroupJoinRequestDecisionOperation: jest.fn(),
  discardGroupJoinRequestDecisionOperation: jest.fn(),
}));

jest.mock('@/lib/media/pickGroupFile', () => ({
  pickGroupFile: jest.fn(),
}));

jest.mock('@/lib/groupTaskCreationOperation', () => ({
  loadGroupTaskCreationOperation: jest.fn().mockResolvedValue(null),
  reserveGroupTaskCreationOperation: jest.fn().mockResolvedValue({
    storageKey: 'saved-group-task',
    key: 'group-task-operation-key',
    groupId: 1,
    intent: 'saved-intent',
    draft: {
      title: 'Saved task',
      description: '',
      priority: 'medium',
      assignedTo: null,
      dueDate: '',
    },
    createdAt: 1,
  }),
  completeGroupTaskCreationOperation: jest.fn().mockResolvedValue(undefined),
  discardGroupTaskCreationOperation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/groupContentCreationOperation', () => ({
  loadGroupContentCreationOperation: jest.fn().mockResolvedValue(null),
  reserveGroupContentCreationOperation: jest.fn().mockImplementation(async (groupId, kind, payload) => ({
    storageKey: 'saved-group-content',
    key: 'group-content-operation-key',
    groupId,
    kind,
    intent: JSON.stringify(payload),
    payload,
    createdAt: 1,
  })),
  completeGroupContentCreationOperation: jest.fn().mockResolvedValue(undefined),
  discardGroupContentCreationOperation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

const mockShowToast = jest.fn();

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const hide = jest.fn();
  return { useAppToast: () => ({ show: mockShowToast, hide, isToastVisible: false }) };
});

// The bottom-sheet wrapper renders gesture/portal machinery that does not work in
// the test renderer; mock it as a plain conditional View (same as volunteering-detail).
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <View testID="group-discussion-sheet">{children}</View> : null;
});

// Auto-confirm: pressing a destructive button runs the action immediately,
// mirroring the old Alert.alert destructive button-press simulation.
/*
  🔴 This mock RECORDS the question and does not answer it. It used to run `onConfirm`
  itself, which made every confirmation on this screen unobservable — the delete cases
  below passed identically with the dialog deleted. That is the same shape that hid a
  one-tap cross-community transfer on member-profile. Each case now runs `onConfirm`
  by hand, so "was the member asked?" and "what happens when they say yes?" stay two
  separate questions.
*/
const mockConfirm = jest.fn<void, [{ title: string; message?: string; variant?: string; onConfirm: () => void | Promise<void> }]>();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...(args as [never])),
    confirmDialog: null,
  }),
}));

/** Answer the confirmation the screen just raised. */
async function sayYesToTheDialog() {
  const call = mockConfirm.mock.calls[mockConfirm.mock.calls.length - 1];
  if (!call) throw new Error('nothing asked for confirmation');
  await call[0].onConfirm();
}

// --- Tests ---

import GroupDetailScreen from './group-detail';
import {
  answerGroupQuestion,
  acceptGroupAnswer,
  createGroupAnnouncement,
  createGroupDiscussion,
  createGroupQuestion,
  createGroupTask,
  createGroupWikiPage,
  deleteGroupFile,
  deleteGroupMedia,
  deleteGroupWikiPage,
  getGroupAnalytics,
  getGroupAnalyticsComparative,
  getGroupAnalyticsRetention,
  getGroupMedia,
  getGroupMembers,
  getGroupWikiPage,
  getGroupWikiPages,
  getGroupWikiRevisions,
  getGroupTasks,
  getGroupTaskStats,
  getGroupQuestion,
  getGroup,
  joinGroup,
  updateGroupTask,
  updateGroupWikiPage,
  updateGroupAnnouncement,
  uploadGroupFile,
  uploadGroupMedia,
  voteGroupQA,
} from '@/lib/api/groups';
import { ApiResponseError } from '@/lib/api/client';
import * as ImagePicker from 'expo-image-picker';
import { pickGroupFile } from '@/lib/media/pickGroupFile';
import {
  completeGroupTaskCreationOperation,
  discardGroupTaskCreationOperation,
  loadGroupTaskCreationOperation,
  reserveGroupTaskCreationOperation,
} from '@/lib/groupTaskCreationOperation';
import {
  completeGroupContentCreationOperation,
  discardGroupContentCreationOperation,
  loadGroupContentCreationOperation,
  reserveGroupContentCreationOperation,
} from '@/lib/groupContentCreationOperation';

const defaultApiState = { data: null, isLoading: true, error: null, refresh: jest.fn() };

beforeEach(() => {
  mockRouteParams = { id: '1' };
  mockGroupTabs = {};
  mockPaginatedOptions.length = 0;
  mockAuthUser = { id: 99, name: 'Current User' };
  mockUseApi.mockReturnValue(defaultApiState);
  mockRouterPush.mockClear();
  jest.clearAllMocks();
  jest.mocked(loadGroupTaskCreationOperation).mockReset();
  jest.mocked(reserveGroupTaskCreationOperation).mockReset();
  jest.mocked(completeGroupTaskCreationOperation).mockReset();
  jest.mocked(discardGroupTaskCreationOperation).mockReset();
  jest.mocked(loadGroupTaskCreationOperation).mockResolvedValue(null);
  jest.mocked(reserveGroupTaskCreationOperation).mockResolvedValue({
    storageKey: 'saved-group-task',
    key: 'group-task-operation-key',
    groupId: 1,
    intent: 'saved-intent',
    draft: { title: 'Saved task', description: '', priority: 'medium', assignedTo: null, dueDate: '' },
    createdAt: 1,
  });
  jest.mocked(completeGroupTaskCreationOperation).mockResolvedValue(undefined);
  jest.mocked(discardGroupTaskCreationOperation).mockResolvedValue(undefined);
  jest.mocked(loadGroupContentCreationOperation).mockReset();
  jest.mocked(reserveGroupContentCreationOperation).mockReset();
  jest.mocked(completeGroupContentCreationOperation).mockReset();
  jest.mocked(discardGroupContentCreationOperation).mockReset();
  jest.mocked(loadGroupContentCreationOperation).mockResolvedValue(null);
  jest.mocked(reserveGroupContentCreationOperation).mockImplementation(async (groupId, kind, payload) => ({
    storageKey: 'saved-group-content',
    key: 'group-content-operation-key',
    groupId,
    kind,
    intent: JSON.stringify(payload),
    payload,
    createdAt: 1,
  }) as never);
  jest.mocked(completeGroupContentCreationOperation).mockResolvedValue(undefined);
  jest.mocked(discardGroupContentCreationOperation).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const mockGroupDetail = {
  id: 1,
  name: 'Garden Club',
  description: 'A club for gardening enthusiasts.',
  long_description: null,
  visibility: 'public' as const,
  cover_image: null,
  member_count: 12,
  posts_count: 5,
  is_featured: false,
  is_member: false,
  tags: [],
  created_at: '2026-01-01T00:00:00Z',
  recent_members: [],
  /*
    🔴 A REAL `GET /v2/groups/{id}` sends `creator`, never `admin` — measured 2026-08-24.
    The fixture used to carry `admin` only, which is why no test noticed that the "Admin"
    card on every group page had silently stopped rendering.
  */
  creator: {
    id: 674,
    name: 'Aoife Organiser',
    avatar_url: null,
  },
};

describe('GroupDetailScreen', () => {
  it('opens the tab named by a notification deep link', () => {
    mockRouteParams = { id: '1', tab: 'discussion' };
    const groupState = { data: { data: { ...mockGroupDetail, is_member: true } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [] } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [] } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyQuestionsState = { data: { data: { items: [] } }, isLoading: false, error: null, refresh: jest.fn() };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, emptyFilesState, emptyQuestionsState, eventsState];
    let call = 0;
    mockUseApi.mockImplementation(() => states[call++] ?? emptyListState);

    const { getByText } = render(<GroupDetailScreen />);

    expect(getByText('Join to discuss.')).toBeTruthy();
  });

  it('hides disabled group sections, disables their read and resolves a disabled deep link to overview', () => {
    mockRouteParams = { id: '1', tab: 'files' };
    mockGroupTabs = {
      tab_discussion: true,
      tab_members: false,
      tab_events: false,
      tab_announcements: false,
      tab_files: false,
      tab_media: false,
      tab_qa: false,
      tab_wiki: false,
      tab_tasks: false,
      tab_analytics: false,
    };
    const groupState = { data: { data: { ...mockGroupDetail, is_member: true } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [] } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [] } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyQuestionsState = { data: { data: { items: [] } }, isLoading: false, error: null, refresh: jest.fn() };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, emptyFilesState, emptyQuestionsState, eventsState];
    let call = 0;
    mockUseApi.mockImplementation(() => states[call++] ?? emptyListState);

    const { getByText, getByTestId, queryByTestId, queryByText } = render(<GroupDetailScreen />);

    expect(queryByTestId('group-tab-files')).toBeNull();
    expect(getByTestId('group-tab-discussion')).toBeTruthy();
    for (const hidden of ['members', 'events', 'announcements', 'media', 'qa', 'wiki', 'tasks', 'analytics']) {
      expect(queryByTestId(`group-tab-${hidden}`)).toBeNull();
    }
    expect(queryByText('Group files')).toBeNull();
    expect(getByText('No description.')).toBeTruthy();
    expect(getByTestId('group-tab-overview')).toBeTruthy();
    expect(mockPaginatedOptions.slice(0, 5).map((options) => options?.enabled)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(mockUseApi.mock.calls.some((call) => call[2]?.enabled === false)).toBe(true);
  });
  it('names who runs the group, from the creator the server actually sends', () => {
    // 🔴 The load-bearing case. `GroupDetail.admin` was declared required and is not in the
    // response, so `group.admin ? …` was always false and this whole card vanished — a
    // member could not see who runs their own group.
    mockUseApi.mockReturnValue({
      data: { data: mockGroupDetail },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByText, getByText, getByTestId } = render(<GroupDetailScreen />);

    expect(getByTestId('group-organiser')).toBeTruthy();
    expect(getByText('Aoife Organiser')).toBeTruthy();
    // Twice on purpose: the card's heading and the role beneath the name.
    expect(getAllByText('Group admin').length).toBeGreaterThan(0);
  });

  it('renders loading spinner when data is loading', () => {
    // Default mock: isLoading=true, data=null — LoadingSpinner is mocked to null
    // The screen renders a SafeAreaView with LoadingSpinner (null); we verify no content shown
    const { queryByText } = render(<GroupDetailScreen />);
    expect(queryByText('Garden Club')).toBeNull();
    expect(queryByText('Group not found.')).toBeNull();
  });

  it('renders not-found message when data is null and not loading', () => {
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByText } = render(<GroupDetailScreen />);
    expect(getAllByText('Group not found.').length).toBeGreaterThan(0);
  });

  it('renders group name when data is loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockGroupDetail },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupDetailScreen />);
    expect(getByText('Garden Club')).toBeTruthy();
  });

  it('keeps the native group detail frame full height with an explicit background', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockGroupDetail },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByTestId } = render(<GroupDetailScreen />);
    const screen = getByTestId('group-detail-screen');
    const scroll = getByTestId('group-detail-scroll');

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
      paddingBottom: 40,
    }));
  });

  it('renders join button when user is not a member', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: false } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupDetailScreen />);
    expect(getByText('Join')).toBeTruthy();
  });

  it('renders leave button when user is already a member', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupDetailScreen />);
    expect(getByText('Leave')).toBeTruthy();
  });

  it('renders group description when loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockGroupDetail },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupDetailScreen />);
    expect(getByText('A club for gardening enthusiasts.')).toBeTruthy();
  });

  it('joins a public group from the detail page', async () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: false } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Join'));

    await waitFor(() => {
      expect(joinGroup).toHaveBeenCalledWith(1);
      expect(getByText('Leave')).toBeTruthy();
    });
  });

  it('serializes rapid membership actions before the busy state renders', async () => {
    let resolveJoin!: (value: unknown) => void;
    jest.mocked(joinGroup).mockImplementationOnce(() => new Promise((resolve) => {
      resolveJoin = resolve as (value: unknown) => void;
    }));
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: false } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    const screen = render(<GroupDetailScreen />);

    act(() => {
      fireEvent.press(screen.getByText('Join'));
      fireEvent.press(screen.getByText('Join'));
    });

    expect(joinGroup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Leave')).toBeNull();
    await act(async () => {
      resolveJoin({ data: { status: 'active', action: 'joined' } });
    });
    expect(screen.getByText('Leave')).toBeTruthy();
  });

  it('accepts a joined state after response loss only when group readback proves it', async () => {
    jest.mocked(joinGroup).mockRejectedValueOnce(new ApiResponseError(0, 'response lost'));
    jest.mocked(getGroup).mockResolvedValueOnce({
      data: {
        ...mockGroupDetail,
        is_member: true,
        member_count: 13,
        viewer_membership: { status: 'active', role: 'member', is_admin: false },
      },
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: false } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    const screen = render(<GroupDetailScreen />);

    fireEvent.press(screen.getByText('Join'));

    await waitFor(() => {
      expect(getGroup).toHaveBeenCalledWith(1);
      expect(screen.getByText('Leave')).toBeTruthy();
      expect(screen.getByText('13')).toBeTruthy();
    });
  });

  /**
   * 🔴 A private group answers a join with status "pending". The screen used to show
   * "Joined" and then silently flip back to "Join" (audit 2026-09-07, C/F-2).
   */
  it('shows a private group join as requested, not joined', async () => {
    jest.mocked(joinGroup).mockResolvedValueOnce({ data: { status: 'pending', action: 'requested', message: 'Request sent to the organisers.' } });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: false, visibility: 'private' } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByText, getByTestId } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Join'));

    await waitFor(() => expect(joinGroup).toHaveBeenCalledWith(1));
    await waitFor(() => expect(getByTestId('group-join-requested')).toBeTruthy());
    expect(queryByText('Leave')).toBeNull();
  });

  it('shows an edit action for group admins', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Edit group'));

    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/(modals)/edit-group', params: { id: '1' } });
    fireEvent.press(getByText('Manage invitations'));
    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/(modals)/group-invitations', params: { id: '1' } });
  });

  it('does not offer invitation management to ordinary group members', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true, viewer_membership: { status: 'active', role: 'member', is_admin: false } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    const { queryByText } = render(<GroupDetailScreen />);
    expect(queryByText('Manage invitations')).toBeNull();
  });

  it('opens group event details from HeroUI Native-backed event cards', () => {
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [] } }, isLoading: false, error: null, refresh: jest.fn() };
    const eventsState = {
      data: {
        data: [
          {
            id: 77,
            title: 'Seed swap',
            description: 'Bring seeds to share.',
            start_date: '2026-06-01T12:00:00Z',
            location: 'Community hall',
            is_online: false,
            attendees_count: 4,
          },
        ],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, emptyFilesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Events'));
    fireEvent.press(getByText('Seed swap'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-detail',
      params: { id: '77' },
    });
  });

  it.each([false, true])('publishes group announcements with an initial rejection: %s', async (rejectFirst) => {
    const refreshAnnouncements = jest.fn();
    const groupState = {
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const announcementsState = {
      data: { data: { items: [], cursor: null, has_more: false } },
      isLoading: false,
      error: null,
      refresh: refreshAnnouncements,
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const states = [groupState, emptyListState, emptyListState, announcementsState, emptyFilesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByPlaceholderText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Announcements'));
    fireEvent.press(getByText('Create'));
    fireEvent.changeText(getByPlaceholderText('Announcement title'), 'Spring update');
    fireEvent.changeText(getByPlaceholderText('Write the announcement...'), 'Seeds arrive Friday.');
    fireEvent.press(getByText('Pin announcement'));
    if (rejectFirst) jest.mocked(createGroupAnnouncement).mockRejectedValueOnce(new Error('Service unavailable'));
    fireEvent.press(getByText('Publish announcement'));
    expect(getByPlaceholderText('Announcement title').props.editable).toBe(false);
    expect(getByPlaceholderText('Write the announcement...').props.editable).toBe(false);
    if (rejectFirst) {
      await waitFor(() => expect(getByText('Publish announcement')).toBeTruthy());
      expect(getByPlaceholderText('Announcement title').props.value).toBe('Spring update');
      expect(getByPlaceholderText('Write the announcement...').props.value).toBe('Seeds arrive Friday.');
      expect(getByPlaceholderText('Announcement title').props.editable).toBe(true);
      expect(refreshAnnouncements).not.toHaveBeenCalled();
      fireEvent.press(getByText('Publish announcement'));
    }

    await waitFor(() => {
      expect(createGroupAnnouncement).toHaveBeenCalledWith(1, {
        title: 'Spring update',
        content: 'Seeds arrive Friday.',
        is_pinned: true,
      }, expect.any(String));
      if (rejectFirst) {
        expect(jest.mocked(createGroupAnnouncement).mock.calls[1][2]).toBe(jest.mocked(createGroupAnnouncement).mock.calls[0][2]);
      }
      expect(refreshAnnouncements).toHaveBeenCalled();
    });
  });

  it.each([false, true])('lets members publish a discussion with an initial rejection: %s', async (rejectFirst) => {
    const dimensions = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 360, height: 800, scale: 1, fontScale: 1,
    });
    const refreshDiscussions = jest.fn();
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const discussionsState = { data: { data: [] }, isLoading: false, error: null, refresh: refreshDiscussions };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const states = [groupState, emptyListState, discussionsState, emptyAnnouncementsState, emptyFilesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByPlaceholderText, getByTestId, getByText, queryByTestId, rerender } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Discussions'));

    await waitFor(() => expect(loadGroupContentCreationOperation).toHaveBeenCalledWith(1, 'discussion'));
    await waitFor(() => expect(getByTestId('group-discussion-composer-open').props.accessibilityState.disabled).toBe(false));

    // The composer sheet is closed until the trigger button opens it.
    expect(queryByTestId('group-discussion-sheet')).toBeNull();
    fireEvent.press(getByTestId('group-discussion-composer-open'));
    expect(getByTestId('group-discussion-sheet')).toBeTruthy();

    // Validation: publishing with empty fields never calls the API.
    fireEvent.press(getByText('Publish discussion'));
    expect(createGroupDiscussion).not.toHaveBeenCalled();
    expect(getByTestId('group-discussion-sheet')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Discussion title'), 'Compost rota');
    fireEvent.changeText(getByPlaceholderText('Write a message'), 'Who can take the Friday slot?');
    dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    rerender(<GroupDetailScreen />);
    expect(getByPlaceholderText('Discussion title').props.value).toBe('Compost rota');
    expect(getByPlaceholderText('Write a message').props.value).toBe('Who can take the Friday slot?');
    expect(getByTestId('group-discussion-actions').props.className).not.toContain('flex-row');
    if (rejectFirst) jest.mocked(createGroupDiscussion).mockRejectedValueOnce(new Error('Service unavailable'));
    fireEvent.press(getByText('Publish discussion'));
    expect(getByPlaceholderText('Discussion title').props.editable).toBe(false);
    expect(getByPlaceholderText('Write a message').props.editable).toBe(false);

    if (rejectFirst) {
      await waitFor(() => expect(createGroupDiscussion).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getByText('Publish discussion')).toBeTruthy());
      expect(getByTestId('group-discussion-sheet')).toBeTruthy();
      expect(getByPlaceholderText('Discussion title').props.value).toBe('Compost rota');
      expect(getByPlaceholderText('Write a message').props.value).toBe('Who can take the Friday slot?');
      expect(getByPlaceholderText('Discussion title').props.editable).toBe(false);
      expect(getByPlaceholderText('Write a message').props.editable).toBe(false);
      expect(refreshDiscussions).not.toHaveBeenCalled();
      fireEvent.press(getByText('Publish discussion'));
    }

    await waitFor(() => {
      expect(createGroupDiscussion).toHaveBeenCalledWith(1, {
        title: 'Compost rota',
        content: 'Who can take the Friday slot?',
      }, expect.any(String));
      if (rejectFirst) {
        expect(jest.mocked(createGroupDiscussion).mock.calls[1][2]).toBe(jest.mocked(createGroupDiscussion).mock.calls[0][2]);
      }
      expect(refreshDiscussions).toHaveBeenCalled();
      // The sheet closes and fields reset after a successful publish.
      expect(queryByTestId('group-discussion-sheet')).toBeNull();
    });
  });

  it('discards a definitely rejected discussion operation and unlocks the draft', async () => {
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyState, emptyState, emptyState, emptyState, emptyState, emptyState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });
    jest.mocked(createGroupDiscussion).mockRejectedValueOnce(new ApiResponseError(422, 'Please shorten the title.'));

    const { getByPlaceholderText, getByTestId, getByText } = render(<GroupDetailScreen />);
    fireEvent.press(getByText('Discussions'));
    await waitFor(() => expect(getByTestId('group-discussion-composer-open').props.accessibilityState.disabled).toBe(false));
    fireEvent.press(getByTestId('group-discussion-composer-open'));
    fireEvent.changeText(getByPlaceholderText('Discussion title'), 'A title the server rejects');
    fireEvent.changeText(getByPlaceholderText('Write a message'), 'The member can correct this after rejection.');
    fireEvent.press(getByText('Publish discussion'));

    await waitFor(() => expect(discardGroupContentCreationOperation).toHaveBeenCalledTimes(1));
    expect(getByPlaceholderText('Discussion title').props.editable).toBe(true);
    expect(getByPlaceholderText('Write a message').props.editable).toBe(true);
  });

  it('restores an unfinished discussion and retries its exact durable key', async () => {
    const pending = {
      storageKey: 'saved-group-content',
      key: 'restored-discussion-key',
      groupId: 1,
      kind: 'discussion' as const,
      intent: JSON.stringify({ title: 'Saved title', content: 'Saved opening message' }),
      payload: { title: 'Saved title', content: 'Saved opening message' },
      createdAt: 1,
    };
    jest.mocked(loadGroupContentCreationOperation).mockResolvedValueOnce(pending);
    jest.mocked(reserveGroupContentCreationOperation).mockResolvedValueOnce(pending);

    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyState, emptyState, emptyState, emptyState, emptyState, emptyState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByPlaceholderText, getByText, getByTestId } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Discussions'));
    await waitFor(() => expect(getByTestId('group-discussion-sheet')).toBeTruthy());
    expect(getByText('An unfinished discussion was restored. Retry it before starting another discussion.')).toBeTruthy();
    expect(getByPlaceholderText('Discussion title').props.value).toBe('Saved title');
    expect(getByPlaceholderText('Discussion title').props.editable).toBe(false);
    expect(getByPlaceholderText('Write a message').props.value).toBe('Saved opening message');

    fireEvent.press(getByText('Publish discussion'));

    await waitFor(() => expect(createGroupDiscussion).toHaveBeenCalledWith(1, pending.payload, pending.key));
    expect(completeGroupContentCreationOperation).toHaveBeenCalledWith(pending);
  });

  it('fails closed and offers retry when discussion recovery is unavailable', async () => {
    jest.mocked(loadGroupContentCreationOperation)
      .mockRejectedValueOnce(new Error('secure storage unavailable'))
      .mockResolvedValueOnce(null);
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyState, emptyState, emptyState, emptyState, emptyState, emptyState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByText, getByTestId } = render(<GroupDetailScreen />);
    fireEvent.press(getByText('Discussions'));

    await waitFor(() => expect(getByTestId('group-discussion-recovery-error')).toBeTruthy());
    expect(createGroupDiscussion).not.toHaveBeenCalled();
    fireEvent.press(getByText('common:buttons.retry'));
    await waitFor(() => expect(loadGroupContentCreationOperation).toHaveBeenCalledTimes(2));
  });

  it('lets group admins toggle announcement pinning', async () => {
    const groupState = {
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const announcementsState = {
      data: {
        data: {
          items: [{
            id: 22,
            title: 'Pinned note',
            content: 'Remember the meet-up.',
            is_pinned: true,
            priority: 0,
            is_expired: false,
            author: { id: 10, name: 'Alice Admin', avatar_url: null },
            created_at: '2026-06-01T00:00:00Z',
            updated_at: null,
            expires_at: null,
          }],
          cursor: null,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const states = [groupState, emptyListState, emptyListState, announcementsState, emptyFilesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Announcements'));
    fireEvent.press(getByText('Unpin'));

    await waitFor(() => {
      expect(updateGroupAnnouncement).toHaveBeenCalledWith(1, 22, { is_pinned: false });
    });
  });

  it('renders group files in the native files tab', () => {
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const filesState = {
      data: {
        data: {
          items: [{
            id: 31,
            group_id: 1,
            file_name: 'Planting guide.pdf',
            file_type: 'application/pdf',
            file_size: 2048,
            uploaded_by: 10,
            uploader_name: 'Alice Admin',
            uploader_avatar: null,
            folder: 'Guides',
            description: 'Spring planting checklist.',
            capabilities: { can_download: true, can_delete: true },
            created_at: '2026-06-01T00:00:00Z',
          }],
          cursor: null,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, filesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Files'));

    expect(getByText('Group files')).toBeTruthy();
    expect(getByText('Planting guide.pdf')).toBeTruthy();
    expect(getByText('Spring planting checklist.')).toBeTruthy();
    expect(getByText('Download')).toBeTruthy();
    expect(getByText('Delete')).toBeTruthy();
    expect(getByText('Upload file')).toBeTruthy();
  });

  it.each(['picked', 'cancelled', 'too_large', 'unsupported_type'] as const)('handles group file picker result: %s', async (outcome) => {
    const refreshFiles = jest.fn();
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true, viewer_membership: { status: 'active', role: 'member', is_admin: false } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const filesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: refreshFiles };
    const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, filesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });
    jest.mocked(pickGroupFile).mockResolvedValue(
      outcome === 'picked'
        ? { status: 'picked', file: { uri: 'file:///cache/group-notes.txt', name: 'group-notes.txt', mimeType: 'text/plain', size: 1024 } }
        : outcome === 'too_large'
          ? { status: 'too_large', maxMb: 25 }
          : { status: outcome },
    );

    const { getByText } = render(<GroupDetailScreen />);
    fireEvent.press(getByText('Files'));
    fireEvent.press(getByText('Upload file'));

    await waitFor(() => expect(pickGroupFile).toHaveBeenCalled());
    if (outcome !== 'picked') {
      expect(uploadGroupFile).not.toHaveBeenCalled();
      expect(refreshFiles).not.toHaveBeenCalled();
      if (outcome !== 'cancelled') {
        expect(mockShowToast).toHaveBeenCalledWith({
          title: 'Error',
          description: outcome === 'too_large'
            ? 'Choose a file no larger than 25 MB.'
            : 'This file type is not supported.',
          variant: 'danger',
        });
      }
      return;
    }
    await waitFor(() => {
      expect(uploadGroupFile).toHaveBeenCalledWith(1, {
        uri: 'file:///cache/group-notes.txt',
        fileName: 'group-notes.txt',
        mimeType: 'text/plain',
      }, 'group-file-idempotency-key');
      expect(mockReserveGroupFileUploadOperation).toHaveBeenCalledWith(JSON.stringify({
        groupId: 1,
        mimeType: 'text/plain',
        name: 'group-notes.txt',
        size: 1024,
      }));
      expect(mockCompleteGroupFileUploadOperation).toHaveBeenCalledWith({
        storageKey: 'group-file-operation',
        key: 'group-file-idempotency-key',
        createdAt: 1,
      });
      expect(refreshFiles).toHaveBeenCalled();
    });
  });

  it('keeps the group file operation reserved when upload outcome is uncertain', async () => {
    const refreshFiles = jest.fn();
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true, viewer_membership: { status: 'active', role: 'member', is_admin: false } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const filesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: refreshFiles };
    const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, filesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });
    jest.mocked(pickGroupFile).mockResolvedValue({
      status: 'picked',
      file: { uri: 'file:///cache/group-notes.txt', name: 'group-notes.txt', mimeType: 'text/plain', size: 1024 },
    });
    jest.mocked(uploadGroupFile).mockRejectedValueOnce(new Error('Response lost'));

    const { getByText } = render(<GroupDetailScreen />);
    fireEvent.press(getByText('Files'));
    fireEvent.press(getByText('Upload file'));

    await waitFor(() => expect(uploadGroupFile).toHaveBeenCalled());
    expect(mockCompleteGroupFileUploadOperation).not.toHaveBeenCalled();
    expect(refreshFiles).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Could not upload the file.',
      variant: 'danger',
    }));
  });

  it.each([false, true])('handles file deletion confirmation with departed screen = %s', async (departed) => {
    const refreshFiles = jest.fn();
    const groupState = {
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const filesState = {
      data: {
        data: {
          items: [{
            id: 31,
            group_id: 1,
            file_name: 'Planting guide.pdf',
            file_type: 'application/pdf',
            file_size: 2048,
            uploaded_by: 10,
            uploader_name: 'Alice Admin',
            uploader_avatar: null,
            folder: 'Guides',
            description: 'Spring planting checklist.',
            created_at: '2026-06-01T00:00:00Z',
          }],
          cursor: null,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refresh: refreshFiles,
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, filesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByText, unmount } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Files'));
    fireEvent.press(getByText('Delete'));

    // Asked, not done. A stale confirmation must not submit after departure.
    expect(deleteGroupFile).not.toHaveBeenCalled();
    if (departed) unmount();
    await act(async () => { await sayYesToTheDialog(); });
    if (departed) {
      expect(deleteGroupFile).not.toHaveBeenCalled();
      expect(refreshFiles).not.toHaveBeenCalled();
      return;
    }

    await waitFor(() => {
      expect(deleteGroupFile).toHaveBeenCalledWith(1, 31);
      expect(refreshFiles).toHaveBeenCalled();
    });
  });

  it.each([false, true])('renders media and recovers a failed filter read: %s', async (failFilter) => {
    jest.mocked(getGroupMedia).mockResolvedValue({
      data: {
        items: [{
          id: 81,
          url: 'https://cdn.example.test/garden.jpg',
          thumbnail_url: null,
          type: 'image',
          caption: 'Spring garden',
          file_size: 2048,
          uploaded_by: 10,
          uploader_name: 'Alice Admin',
          created_at: '2026-06-01T00:00:00Z',
        }],
        cursor: null,
        has_more: false,
      },
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findByText, getByText, findByTestId, queryByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Media'));

    expect(await findByText('Spring garden')).toBeTruthy();
    expect(getByText('Photos')).toBeTruthy();

    if (failFilter) jest.mocked(getGroupMedia).mockRejectedValueOnce(new Error('Filter unavailable'));
    fireEvent.press(getByText('Videos'));

    await waitFor(() => {
      expect(getGroupMedia).toHaveBeenCalledWith(1, { type: 'video', cursor: null });
    });
    if (failFilter) {
      await findByTestId('group-media-load-error');
      expect(queryByText('Spring garden')).toBeNull();
      const count = jest.mocked(getGroupMedia).mock.calls.length;
      fireEvent.press(getByText('common:buttons.retry'));
      await waitFor(() => expect(getGroupMedia).toHaveBeenCalledTimes(count + 1));
      expect(getGroupMedia).toHaveBeenLastCalledWith(1, { type: 'video', cursor: null });
    }
  });

  it('lets group admins delete native group media', async () => {
    jest.mocked(getGroupMedia).mockResolvedValue({
      data: {
        items: [{
          id: 81,
          url: 'https://cdn.example.test/garden.jpg',
          thumbnail_url: null,
          type: 'image',
          caption: 'Spring garden',
          file_size: 2048,
          uploaded_by: 10,
          uploader_name: 'Alice Admin',
          created_at: '2026-06-01T00:00:00Z',
        }],
        cursor: null,
        has_more: false,
      },
    });
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Media'));
    expect(await findByText('Spring garden')).toBeTruthy();
    fireEvent.press(getByText('Delete'));

    expect(deleteGroupMedia).not.toHaveBeenCalled();
    await act(async () => { await sayYesToTheDialog(); });

    await waitFor(() => {
      expect(deleteGroupMedia).toHaveBeenCalledWith(1, 81);
    });
  });

  it('lets members upload native group media from the photo library', async () => {
    jest.mocked(getGroupMedia).mockResolvedValue({
      data: { items: [], cursor: null, has_more: false },
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Media'));
    act(() => {
      fireEvent.press(getByText('Upload photo'));
      fireEvent.press(getByText('Upload photo'));
    });

    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
        mediaTypes: ['images'],
      }));
      expect(uploadGroupMedia).toHaveBeenCalledWith(1, expect.objectContaining({
        uri: 'file:///tmp/group-media.jpg',
        fileName: 'group-media.jpg',
        mimeType: 'image/jpeg',
      }), expect.any(String));
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
      expect(uploadGroupMedia).toHaveBeenCalledTimes(1);
    });
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each([false, true])('publishes questions with an initial rejection: %s', async (rejectFirst) => {
    const refreshQuestions = jest.fn();
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const questionsState = {
      data: {
        data: {
          items: [{
            id: 41,
            title: 'How do we compost safely?',
            body: 'What bin should we use?',
            accepted_answer_id: 50,
            is_closed: false,
            view_count: 3,
            vote_count: 2,
            answer_count: 1,
            has_accepted_answer: true,
            user_vote: 0,
            author: { id: 10, name: 'Alice Admin', avatar: null },
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
          }],
          cursor: null,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refresh: refreshQuestions,
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, emptyFilesState, questionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByPlaceholderText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Q&A'));
    expect(getByText('Group Q&A')).toBeTruthy();
    expect(getByText('How do we compost safely?')).toBeTruthy();
    expect(getByText('Answered')).toBeTruthy();

    fireEvent.press(getByText('Ask'));
    fireEvent.changeText(getByPlaceholderText('Question title'), 'Which compost bin works best?');
    fireEvent.changeText(getByPlaceholderText('Add context...'), 'We need a lidded bin for the shared garden.');
    if (rejectFirst) jest.mocked(createGroupQuestion).mockRejectedValueOnce(new Error('Rejected'));
    fireEvent.press(getByText('Publish question'));
    expect(getByPlaceholderText('Question title').props.editable).toBe(false);
    expect(getByPlaceholderText('Add context...').props.editable).toBe(false);
    if (rejectFirst) {
      await waitFor(() => expect(getByText('Publish question')).toBeTruthy());
      expect(getByPlaceholderText('Question title').props.value).toBe('Which compost bin works best?');
      expect(getByPlaceholderText('Add context...').props.value).toBe('We need a lidded bin for the shared garden.');
      expect(getByPlaceholderText('Question title').props.editable).toBe(true);
      expect(getByPlaceholderText('Add context...').props.editable).toBe(true);
      expect(refreshQuestions).not.toHaveBeenCalled();
      fireEvent.press(getByText('Publish question'));
    }

    await waitFor(() => {
      expect(createGroupQuestion).toHaveBeenCalledWith(1, {
        title: 'Which compost bin works best?',
        body: 'We need a lidded bin for the shared garden.',
      }, expect.any(String));
      if (rejectFirst) {
        expect(jest.mocked(createGroupQuestion).mock.calls[1][2]).toBe(jest.mocked(createGroupQuestion).mock.calls[0][2]);
      }
      expect(refreshQuestions).toHaveBeenCalled();
    });
  });

  it.each(['success', 'failed-read', 'changed-question'])('posts an answer with subsequent outcome: %s', async (outcome) => {
    const failReadback = outcome === 'failed-read';
    const refreshQuestions = jest.fn();
    const question = {
      id: 41,
      title: 'How do we compost safely?',
      body: 'What bin should we use?',
      accepted_answer_id: 50,
      is_closed: false,
      view_count: 3,
      vote_count: 2,
      answer_count: 1,
      has_accepted_answer: true,
      user_vote: 0 as const,
      author: { id: 10, name: 'Alice Admin', avatar: null },
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    };
    jest.mocked(getGroupQuestion).mockResolvedValue({
      data: {
        ...question,
        answers: [{
          id: 50,
          question_id: 41,
          body: 'Use a lidded bin.',
          vote_count: 1,
          user_vote: 0 as const,
          is_accepted: true,
          author: { id: 11, name: 'Bob Builder', avatar: null },
          created_at: '2026-06-02T00:00:00Z',
        }],
      },
    });
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const questionsState = {
      data: { data: { items: [question], cursor: null, has_more: false } },
      isLoading: false,
      error: null,
      refresh: refreshQuestions,
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, emptyFilesState, questionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { findByText, getByLabelText, getByPlaceholderText, getByText, queryByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Q&A'));
    fireEvent.press(getByText('How do we compost safely?'));
    expect(await findByText('Use a lidded bin.')).toBeTruthy();

    fireEvent.press(getByLabelText('Upvote question'));
    await waitFor(() => {
      expect(voteGroupQA).toHaveBeenCalledWith(1, { type: 'question', target_id: 41, vote: 'up' });
    });

    fireEvent.press(getByLabelText('Upvote answer'));
    await waitFor(() => {
      expect(voteGroupQA).toHaveBeenCalledWith(1, { type: 'answer', target_id: 50, vote: 'up' });
    });

    fireEvent.changeText(getByPlaceholderText('Write an answer...'), 'Add brown material and keep it covered.');
    await act(async () => {});
    refreshQuestions.mockClear();
    if (failReadback) jest.mocked(getGroupQuestion).mockRejectedValueOnce(new Error('Readback unavailable'));
    let resolveRead!: (value: Awaited<ReturnType<typeof getGroupQuestion>>) => void;
    if (outcome === 'changed-question') {
      jest.mocked(getGroupQuestion).mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    }
    fireEvent.press(getByText('Post answer'));
    expect(getByPlaceholderText('Write an answer...').props.editable).toBe(false);

    await waitFor(() => {
      expect(answerGroupQuestion).toHaveBeenCalledWith(1, 41, {
        body: 'Add brown material and keep it covered.',
      }, expect.any(String));
      expect(refreshQuestions).toHaveBeenCalled();
    });
    if (outcome === 'changed-question') {
      await waitFor(() => expect(resolveRead).toBeDefined());
      // Collapse and reopen while the accepted answer's readback is still in flight.
      fireEvent.press(getByText('How do we compost safely?'));
      jest.mocked(getGroupQuestion).mockResolvedValueOnce({ data: { ...question, answers: [{
        id: 51, question_id: 41, body: 'Newer accepted view', vote_count: 0, user_vote: 0,
        is_accepted: false, author: { id: 11, name: 'Bob Builder', avatar: null }, created_at: '2026-06-03T00:00:00Z',
      }] } });
      fireEvent.press(getByText('How do we compost safely?'));
      await findByText('Newer accepted view');
      await act(async () => { resolveRead({ data: { ...question, answers: [] } }); });
      expect(queryByText('Newer accepted view')).toBeTruthy();
    }
    if (failReadback) {
      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith({
        title: 'common:errors.refreshFailedTitle',
        description: 'common:errors.refreshFailedSubtitle',
        variant: 'warning',
      }));
      expect(getByPlaceholderText('Write an answer...').props.value).toBe('');
      expect(mockShowToast).not.toHaveBeenCalledWith(expect.objectContaining({
        description: 'Could not post answer.',
      }));
    }
  });

  it.each([
    ['accept', 'success'], ['accept', 'failed-read'], ['accept', 'changed-selection'],
    ['vote', 'failed-read'], ['vote', 'changed-selection'],
  ])('handles group Q&A %s with %s', async (action, outcome) => {
    const question = {
      id: 41,
      title: 'How do we compost safely?',
      body: 'What bin should we use?',
      accepted_answer_id: null,
      is_closed: false,
      view_count: 3,
      vote_count: 2,
      answer_count: 1,
      has_accepted_answer: false,
      user_vote: 0 as const,
      author: { id: 10, name: 'Alice Admin', avatar: null },
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    };
    jest.mocked(getGroupQuestion).mockResolvedValue({
      data: {
        ...question,
        answers: [{
          id: 50,
          question_id: 41,
          body: 'Use a lidded bin.',
          vote_count: 1,
          user_vote: 0 as const,
          is_accepted: false,
          author: { id: 11, name: 'Bob Builder', avatar: null },
          created_at: '2026-06-02T00:00:00Z',
        }],
      },
    });
    const groupState = {
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const questionsState = {
      data: { data: { items: [question], cursor: null, has_more: false } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, emptyFilesState, questionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { findByText, getByText, getByLabelText, queryByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Q&A'));
    fireEvent.press(getByText('How do we compost safely?'));
    expect(await findByText('Use a lidded bin.')).toBeTruthy();
    let resolveMutation!: (value: never) => void;
    if (outcome === 'changed-selection') {
      const deferred = new Promise<never>((resolve) => { resolveMutation = resolve; });
      if (action === 'accept') jest.mocked(acceptGroupAnswer).mockReturnValueOnce(deferred);
      else jest.mocked(voteGroupQA).mockReturnValueOnce(deferred);
    }
    if (outcome === 'failed-read') jest.mocked(getGroupQuestion).mockRejectedValueOnce(new Error('Read failed after accepted write'));
    fireEvent.press(action === 'accept' ? getByText('Accept answer') : getByLabelText('Upvote question'));
    await waitFor(() => {
      if (action === 'accept') expect(acceptGroupAnswer).toHaveBeenCalledWith(1, 50);
      else expect(voteGroupQA).toHaveBeenCalledWith(1, { type: 'question', target_id: 41, vote: 'up' });
    });
    if (outcome === 'failed-read') {
      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'common:errors.refreshFailedTitle', variant: 'warning',
      })));
      expect(mockShowToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    }
    if (outcome === 'changed-selection') {
      fireEvent.press(getByText('How do we compost safely?'));
      jest.mocked(getGroupQuestion).mockResolvedValueOnce({ data: { ...question, answers: [] } });
      fireEvent.press(getByText('How do we compost safely?'));
      await waitFor(() => expect(queryByText('Use a lidded bin.')).toBeNull());
      const readsBefore = jest.mocked(getGroupQuestion).mock.calls.length;
      await act(async () => { resolveMutation({} as never); });
      expect(getGroupQuestion).toHaveBeenCalledTimes(readsBefore);
      expect(queryByText('Use a lidded bin.')).toBeNull();
    }
  });

  it('lets the question asker accept answers from the native Q&A tab', async () => {
    mockAuthUser = { id: 99, name: 'Current User' };
    const question = {
      id: 41,
      title: 'How do we compost safely?',
      body: 'What bin should we use?',
      accepted_answer_id: null,
      is_closed: false,
      view_count: 3,
      vote_count: 2,
      answer_count: 1,
      has_accepted_answer: false,
      user_vote: 0 as const,
      author: { id: 99, name: 'Current User', avatar: null },
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    };
    jest.mocked(getGroupQuestion).mockResolvedValue({
      data: {
        ...question,
        answers: [{
          id: 50,
          question_id: 41,
          body: 'Use a lidded bin.',
          vote_count: 1,
          user_vote: 0 as const,
          is_accepted: false,
          author: { id: 11, name: 'Bob Builder', avatar: null },
          created_at: '2026-06-02T00:00:00Z',
        }],
      },
    });
    const groupState = {
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'member', is_admin: false },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const questionsState = {
      data: { data: { items: [question], cursor: null, has_more: false } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, emptyListState, emptyAnnouncementsState, emptyFilesState, questionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { findByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Q&A'));
    fireEvent.press(getByText('How do we compost safely?'));
    expect(await findByText('Use a lidded bin.')).toBeTruthy();
    fireEvent.press(getByText('Accept answer'));

    await waitFor(() => {
      expect(acceptGroupAnswer).toHaveBeenCalledWith(1, 50);
    });
  });

  it('distinguishes a failed wiki load from an empty wiki and retries', async () => {
    jest.mocked(getGroupWikiPages).mockRejectedValueOnce(new Error('Wiki unavailable'));
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false, error: null, refresh: jest.fn(),
    });
    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Wiki'));
    expect(await screen.findByText('Could not load wiki pages.')).toBeTruthy();
    expect(screen.queryByText('No wiki pages yet.')).toBeNull();
    jest.mocked(getGroupWikiPages).mockResolvedValueOnce({ data: [] });
    fireEvent.press(screen.getByText('common:buttons.retry'));
    expect(await screen.findByText('No wiki pages yet.')).toBeTruthy();
    expect(screen.queryByText('Could not load wiki pages.')).toBeNull();
    expect(getGroupWikiPages).toHaveBeenCalledTimes(2);
  });

  it.each(['normal', 'late-success', 'late-failure'])('loads wiki revisions with %s', async (outcome) => {
    jest.mocked(getGroupWikiPages).mockResolvedValue({
      data: [{
        id: 61,
        title: 'Compost guide',
        slug: 'compost-guide',
        parent_id: null,
        sort_order: 0,
        is_published: true,
        author: { id: 10, name: 'Alice Admin' },
        updated_at: '2026-06-01T00:00:00Z',
      }],
    });
    jest.mocked(getGroupWikiPage).mockResolvedValue({
      data: {
        id: 61,
        title: 'Compost guide',
        slug: 'compost-guide',
        parent_id: null,
        sort_order: 0,
        is_published: true,
        author: { id: 10, name: 'Alice Admin' },
        content: 'Use a lidded bin.',
        updated_at: '2026-06-01T00:00:00Z',
      },
    });
    jest.mocked(getGroupWikiRevisions).mockResolvedValue({
      data: [{
        id: 91,
        content: 'Earlier compost notes.',
        change_summary: 'Initial note',
        created_at: '2026-05-30T00:00:00Z',
        editor: { id: 10, name: 'Alice Admin' },
      }],
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findAllByText, findByText, getByText, getByLabelText, queryByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Wiki'));

    expect((await findAllByText('Compost guide')).length).toBeGreaterThan(0);
    expect(await findByText('Use a lidded bin.')).toBeTruthy();
    expect(getGroupWikiPages).toHaveBeenCalledWith(1);
    expect(getGroupWikiPage).toHaveBeenCalledWith(1, 'compost-guide');

    let resolveRevisions!: (value: Awaited<ReturnType<typeof getGroupWikiRevisions>>) => void;
    let rejectRevisions!: (error: Error) => void;
    if (outcome !== 'normal') jest.mocked(getGroupWikiRevisions).mockReturnValueOnce(new Promise((resolve, reject) => {
      resolveRevisions = resolve; rejectRevisions = reject;
    }));
    fireEvent.press(getByText('Revisions'));
    if (outcome !== 'normal') {
      fireEvent.press(getByLabelText('Compost guide'));
      await findByText('Use a lidded bin.');
      mockShowToast.mockClear();
      await act(async () => {
        if (outcome === 'late-failure') rejectRevisions(new Error('Old revision read failed'));
        else resolveRevisions({ data: [{ id: 91, content: 'Old notes', change_summary: 'Stale history', created_at: '2026-05-30T00:00:00Z', editor: { id: 10, name: 'Alice Admin' } }] });
      });
      expect(queryByText('Stale history')).toBeNull();
      expect(mockShowToast).not.toHaveBeenCalled();
      fireEvent.press(getByText('Revisions'));
    }
    expect(await findByText('Initial note')).toBeTruthy();
    expect(getGroupWikiRevisions).toHaveBeenCalledWith(1, 61);
  });

  it.each([false, true])('handles wiki deletion after changing selection: %s', async (changeSelection) => {
    jest.mocked(getGroupWikiPages).mockResolvedValue({
      data: [{
        id: 61,
        title: 'Compost guide',
        slug: 'compost-guide',
        parent_id: null,
        sort_order: 0,
        is_published: true,
        author: { id: 10, name: 'Alice Admin' },
        updated_at: '2026-06-01T00:00:00Z',
      }],
    });
    jest.mocked(getGroupWikiPage).mockResolvedValue({
      data: {
        id: 61,
        title: 'Compost guide',
        slug: 'compost-guide',
        parent_id: null,
        sort_order: 0,
        is_published: true,
        author: { id: 10, name: 'Alice Admin' },
        content: 'Use a lidded bin.',
        updated_at: '2026-06-01T00:00:00Z',
      },
    });
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findAllByText, getByText, getByLabelText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Wiki'));
    await findAllByText('Compost guide');
    fireEvent.press(getByText('Delete'));

    expect(deleteGroupWikiPage).not.toHaveBeenCalled();
    if (changeSelection) fireEvent.press(getByLabelText('Compost guide'));
    await act(async () => { await sayYesToTheDialog(); });
    if (changeSelection) {
      expect(deleteGroupWikiPage).not.toHaveBeenCalled();
      return;
    }

    await waitFor(() => {
      expect(deleteGroupWikiPage).toHaveBeenCalledWith(1, 61);
    });
  });

  it.each(['create', 'delete'])('preserves another wiki page while %s completes', async (action) => {
    const first = { id: 61, title: 'Compost guide', slug: 'compost-guide', content: 'Use a lidded bin.', parent_id: null, sort_order: 0, is_published: true, author: { id: 10, name: 'Alice Admin' }, updated_at: '2026-06-01T00:00:00Z' };
    const second = { ...first, id: 63, title: 'Watering guide', slug: 'watering-guide', content: 'Water in the evening.' };
    jest.mocked(getGroupWikiPages).mockResolvedValue({ data: [first, second] });
    jest.mocked(getGroupWikiPage).mockImplementation(async (_id, slug) => ({ data: slug === second.slug ? second : first }));
    mockUseApi.mockReturnValue({ data: { data: { ...mockGroupDetail, is_member: true, viewer_membership: { status: 'active', role: 'admin', is_admin: true } } }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Wiki'));
    await screen.findByText(first.content);
    let resolveCreate!: (value: Awaited<ReturnType<typeof createGroupWikiPage>>) => void;
    let resolveDelete!: (value: Awaited<ReturnType<typeof deleteGroupWikiPage>>) => void;
    let confirmation: Promise<void> | void;
    if (action === 'create') {
      jest.mocked(createGroupWikiPage).mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve; }));
      fireEvent.press(screen.getByText('New page'));
      fireEvent.changeText(screen.getByPlaceholderText('Page title'), 'Tool care');
      fireEvent.changeText(screen.getByPlaceholderText('Write the page content...'), 'Clean tools.');
      fireEvent.press(screen.getByText('Create page'));
    } else {
      jest.mocked(deleteGroupWikiPage).mockReturnValueOnce(new Promise((resolve) => { resolveDelete = resolve; }));
      fireEvent.press(screen.getByText('Delete'));
      act(() => { confirmation = mockConfirm.mock.calls[0][0].onConfirm(); });
    }
    fireEvent.press(screen.getByLabelText(second.title));
    await screen.findByText(second.content);
    await act(async () => {
      if (action === 'create') resolveCreate({ data: { ...first, id: 62, title: 'Tool care', slug: 'tool-care', content: 'Clean tools.' } });
      else {
        jest.mocked(getGroupWikiPages).mockResolvedValue({ data: [second] });
        resolveDelete({ data: { message: 'Deleted' } });
        await confirmation;
      }
    });
    expect(screen.getByText(second.content)).toBeTruthy();
  });

  it.each([false, true])('saves wiki edits with a changed page selection: %s', async (changeSelection) => {
    jest.mocked(getGroupWikiPages).mockResolvedValue({
      data: [{
        id: 61,
        title: 'Compost guide',
        slug: 'compost-guide',
        parent_id: null,
        sort_order: 0,
        is_published: true,
        author: { id: 10, name: 'Alice Admin' },
        updated_at: '2026-06-01T00:00:00Z',
      }],
    });
    jest.mocked(getGroupWikiPage).mockResolvedValue({
      data: {
        id: 61,
        title: 'Compost guide',
        slug: 'compost-guide',
        parent_id: null,
        sort_order: 0,
        is_published: true,
        author: { id: 10, name: 'Alice Admin' },
        content: 'Use a lidded bin.',
        updated_at: '2026-06-01T00:00:00Z',
      },
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findAllByText, getAllByPlaceholderText, getByPlaceholderText, getByText, getByLabelText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Wiki'));
    await findAllByText('Compost guide');

    fireEvent.press(getByText('New page'));
    fireEvent.changeText(getByPlaceholderText('Page title'), 'Tool care');
    fireEvent.changeText(getByPlaceholderText('Write the page content...'), 'Clean tools after use.');
    fireEvent.press(getByText('Create page'));

    await waitFor(() => {
      expect(createGroupWikiPage).toHaveBeenCalledWith(1, {
        title: 'Tool care',
        content: 'Clean tools after use.',
      }, expect.any(String));
    });

    fireEvent.press(getByText('Edit'));
    fireEvent.changeText(getAllByPlaceholderText('Write the page content...')[0], 'Keep it covered.');
    fireEvent.changeText(getByPlaceholderText('Change summary'), 'Clarified storage.');
    let resolveSave!: (value: Awaited<ReturnType<typeof updateGroupWikiPage>>) => void;
    if (changeSelection) jest.mocked(updateGroupWikiPage).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    fireEvent.press(getByText('Save page'));

    await waitFor(() => {
      expect(updateGroupWikiPage).toHaveBeenCalledWith(1, 62, {
        title: 'Tool care',
        content: 'Keep it covered.',
        change_summary: 'Clarified storage.',
        expected_updated_at: '2026-06-01T00:00:00Z',
      });
    });
    if (changeSelection) {
      fireEvent.press(getByLabelText('Compost guide'));
      await waitFor(() => expect(getByText('Use a lidded bin.')).toBeTruthy());
      await act(async () => { resolveSave({ data: {
        id: 62, title: 'Tool care', slug: 'tool-care', content: 'Keep it covered.',
        parent_id: null, sort_order: 0, is_published: true, author: { id: 10, name: 'Alice Admin' }, updated_at: '2026-06-02T00:00:00Z',
      } }); });
      expect(getByText('Use a lidded bin.')).toBeTruthy();
    }
  });

  it.each(['media', 'tasks'])('uses each accepted cursor across multiple %s pages', async (tab) => {
    mockUseApi.mockReturnValue({ data: { data: { ...mockGroupDetail, is_member: true } }, isLoading: false, error: null, refresh: jest.fn() });
    if (tab === 'media') {
      jest.mocked(getGroupMedia)
        .mockResolvedValueOnce({ data: { items: [], cursor: 'page-two', has_more: true } })
        .mockResolvedValueOnce({ data: { items: [], cursor: 'page-three', has_more: true } })
        .mockResolvedValueOnce({ data: { items: [], cursor: null, has_more: false } });
    } else {
      jest.mocked(getGroupTasks)
        .mockResolvedValueOnce({ data: [], meta: { cursor: 'page-two', has_more: true } })
        .mockResolvedValueOnce({ data: [], meta: { cursor: 'page-three', has_more: true } })
        .mockResolvedValueOnce({ data: [], meta: { cursor: null, has_more: false } });
    }
    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText(tab === 'media' ? 'Media' : 'Tasks'));
    const control = `group-${tab}-load-more`;
    await screen.findByTestId(control);
    const request = tab === 'media' ? getGroupMedia : getGroupTasks;
    fireEvent.press(screen.getByTestId(control));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith(1, expect.objectContaining({ cursor: 'page-two' })));
    await act(async () => {});
    fireEvent.press(screen.getByTestId(control));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith(1, expect.objectContaining({ cursor: 'page-three' })));
    await waitFor(() => expect(screen.queryByTestId(control)).toBeNull());
  });

  it('offers a retry for a failed task filter without relabelling old tasks', async () => {
    const task = { id: 70, group_id: 1, title: 'Pending garden task', description: null, status: 'todo' as const, priority: 'medium' as const, assigned_to: null, due_date: null, created_at: '2026-06-01T00:00:00Z' };
    jest.mocked(getGroupTasks).mockResolvedValue({ data: [task], meta: { has_more: false, cursor: null } });
    jest.mocked(getGroupTaskStats).mockResolvedValue({ data: { total: 1, todo: 1, in_progress: 0, done: 0, overdue: 0 } });
    mockUseApi.mockReturnValue({ data: { data: { ...mockGroupDetail, is_member: true } }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));
    await screen.findByText(task.title);
    expect(screen.getByText('1 total')).toBeTruthy();
    jest.mocked(getGroupTasks).mockRejectedValueOnce(new Error('Task filter failed'));
    jest.mocked(getGroupTaskStats).mockRejectedValueOnce(new Error('Statistics failed too'));
    fireEvent.press(screen.getByText('Done'));
    await screen.findByTestId('group-tasks-load-error');
    expect(screen.queryByText(task.title)).toBeNull();
    expect(screen.queryByText('1 total')).toBeNull();
    jest.mocked(getGroupTasks).mockResolvedValueOnce({ data: [], meta: { has_more: false, cursor: null } });
    fireEvent.press(screen.getByText('common:buttons.retry'));
    await waitFor(() => expect(screen.queryByTestId('group-tasks-load-error')).toBeNull());
    expect(getGroupTasks).toHaveBeenLastCalledWith(1, { status: 'done', cursor: null });
  });

  it.each([false, true])('renders usable group tasks when statistics fail: %s', async (statsFail) => {
    jest.mocked(getGroupTasks).mockResolvedValue({
      data: [{
        id: 70,
        group_id: 1,
        title: 'Water seedlings',
        description: 'Use the small greenhouse cans.',
        status: 'todo',
        priority: 'high',
        assigned_to: null,
        due_date: '2026-06-30',
        created_at: '2026-06-01T00:00:00Z',
        can_update_status: true,
        can_edit: false,
        can_delete: false,
      }],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({
      data: { total: 1, todo: 1, in_progress: 0, done: 0, overdue: 0 },
    });
    if (statsFail) jest.mocked(getGroupTaskStats).mockRejectedValueOnce(new Error('Statistics unavailable'));
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findByText, getByLabelText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Tasks'));

    expect(await findByText('Water seedlings')).toBeTruthy();
    if (statsFail) expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', title: 'common:errors.refreshFailedTitle' }));
    expect(getByText('Use the small greenhouse cans.')).toBeTruthy();
    expect(getByText('High')).toBeTruthy();
    let resolveUpdate!: (value: Awaited<ReturnType<typeof updateGroupTask>>) => void;
    jest.mocked(updateGroupTask).mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve; }));
    act(() => {
      fireEvent.press(getByLabelText('To do'));
      fireEvent.press(getByLabelText('To do'));
    });

    await waitFor(() => {
      expect(updateGroupTask).toHaveBeenCalledWith(70, { status: 'in_progress' });
      expect(updateGroupTask).toHaveBeenCalledTimes(1);
    });
    fireEvent.press(getByText('Done'));
    await waitFor(() => expect(getGroupTasks).toHaveBeenLastCalledWith(1, { status: 'done', cursor: null }));
    const readCount = jest.mocked(getGroupTasks).mock.calls.length;
    const task = (await jest.mocked(getGroupTasks).mock.results[0].value).data[0];
    await act(async () => { resolveUpdate({ data: { ...task, status: 'in_progress' } }); });
    expect(getGroupTasks).toHaveBeenCalledTimes(readCount + 1);
    expect(getGroupTasks).toHaveBeenLastCalledWith(1, { status: 'done', cursor: null });
  });

  it('lets group admins update native task priority inline', async () => {
    jest.mocked(getGroupTasks).mockResolvedValue({
      data: [{
        id: 70,
        group_id: 1,
        title: 'Water seedlings',
        description: 'Use the small greenhouse cans.',
        status: 'todo',
        priority: 'medium',
        assigned_to: null,
        due_date: null,
        created_at: '2026-06-01T00:00:00Z',
        can_update_status: true,
        can_edit: true,
        can_delete: true,
      }],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({
      data: { total: 1, todo: 1, in_progress: 0, done: 0, overdue: 0 },
    });
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Tasks'));
    expect(await findByText('Water seedlings')).toBeTruthy();
    fireEvent.press(getByText('Urgent'));

    await waitFor(() => {
      expect(updateGroupTask).toHaveBeenCalledWith(70, { priority: 'urgent' });
    });
  });

  it('lets group admins update native task assignment inline', async () => {
    jest.mocked(getGroupTasks).mockResolvedValue({
      data: [{
        id: 70,
        group_id: 1,
        title: 'Water seedlings',
        description: 'Use the small greenhouse cans.',
        status: 'todo',
        priority: 'medium',
        assigned_to: null,
        due_date: null,
        created_at: '2026-06-01T00:00:00Z',
        can_update_status: true,
        can_edit: true,
        can_delete: true,
      }],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({
      data: { total: 1, todo: 1, in_progress: 0, done: 0, overdue: 0 },
    });
    const groupState = {
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const membersState = {
      data: { data: [{ id: 11, name: 'Bob Builder', role: 'member', joined_at: '2026-06-01T00:00:00Z', avatar_url: null }] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyQuestionsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const eventsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, membersState, emptyListState, emptyAnnouncementsState, emptyFilesState, emptyQuestionsState, eventsState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { findByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Tasks'));
    expect(await findByText('Water seedlings')).toBeTruthy();

    fireEvent.press(getByText('Bob Builder'));
    await waitFor(() => {
      expect(updateGroupTask).toHaveBeenCalledWith(70, { assigned_to: 11 });
    });
  });

  it('searches and pages task assignees beyond the initially loaded members', async () => {
    const member = (id: number, name: string) => ({ id, name, role: 'member', joined_at: '2026-06-01T00:00:00Z', avatar_url: null });
    let finishOlderSearch!: (value: Awaited<ReturnType<typeof getGroupMembers>>) => void;
    let finishCurrentSearch!: (value: Awaited<ReturnType<typeof getGroupMembers>>) => void;
    jest.mocked(getGroupTasks).mockResolvedValue({
      data: [{
        id: 70,
        group_id: 1,
        title: 'Water seedlings',
        description: null,
        status: 'todo',
        priority: 'medium',
        assigned_to: 99,
        assignee: { id: 99, name: 'Off-page Assignee', avatar_url: null },
        due_date: null,
        created_at: '2026-06-01T00:00:00Z',
        can_update_status: true,
        can_edit: true,
        can_delete: true,
      }],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({ data: { total: 1, todo: 1, in_progress: 0, done: 0, overdue: 0 } });
    jest.mocked(getGroupMembers)
      .mockImplementationOnce(() => new Promise(resolve => { finishOlderSearch = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishCurrentSearch = resolve; }))
      .mockResolvedValueOnce({ data: [member(22, 'Zara Member')], meta: { has_more: false, cursor: null } });
    const groupState = { data: { data: { ...mockGroupDetail, is_member: true, viewer_membership: { status: 'active', role: 'admin', is_admin: true } } }, isLoading: false, error: null, refresh: jest.fn() };
    const membersState = { data: { data: Array.from({ length: 9 }, (_, index) => member(index + 1, `Member ${index + 1}`)) }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyList = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyPaged = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const states = [groupState, membersState, emptyList, emptyPaged, emptyPaged, emptyPaged, emptyList];
    let call = 0;
    mockUseApi.mockImplementation(() => states[call++ % states.length]);

    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));
    await screen.findByText('Water seedlings');
    expect(screen.getByText('Member 9')).toBeTruthy();
    expect(screen.getByText('Off-page Assignee')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('group-task-assignee-70-search'), 'old');
    fireEvent.press(screen.getByTestId('group-task-assignee-70-search-button'));
    fireEvent.changeText(screen.getByTestId('group-task-assignee-70-search'), 'zo');
    fireEvent.press(screen.getByTestId('group-task-assignee-70-search-button'));
    await waitFor(() => expect(getGroupMembers).toHaveBeenCalledTimes(2));
    await act(async () => { finishOlderSearch({ data: [member(20, 'Obsolete Member')], meta: { has_more: false, cursor: null } }); });
    expect(screen.queryByText('Obsolete Member')).toBeNull();
    await act(async () => { finishCurrentSearch({ data: [member(21, 'Zoe Member')], meta: { has_more: true, cursor: 'next-members' } }); });
    await screen.findByText('Zoe Member');
    expect(getGroupMembers).toHaveBeenLastCalledWith(1, null, { query: 'zo' });
    fireEvent.press(screen.getByTestId('group-task-assignee-70-load-more'));
    await screen.findByText('Zara Member');
    expect(getGroupMembers).toHaveBeenLastCalledWith(1, 'next-members', { query: 'zo' });
    fireEvent.press(screen.getByTestId('group-task-assignee-70-member-22'));
    await waitFor(() => expect(updateGroupTask).toHaveBeenCalledWith(70, { assigned_to: 22 }));
  });

  it('keeps the current task assignee when member search fails', async () => {
    jest.mocked(getGroupTasks).mockResolvedValue({
      data: [{
        id: 70,
        group_id: 1,
        title: 'Water seedlings',
        description: null,
        status: 'todo',
        priority: 'medium',
        assigned_to: 99,
        assignee: { id: 99, name: 'Off-page Assignee', avatar_url: null },
        due_date: null,
        created_at: '2026-06-01T00:00:00Z',
        can_update_status: true,
        can_edit: true,
        can_delete: false,
      }],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({ data: { total: 1, todo: 1, in_progress: 0, done: 0, overdue: 0 } });
    jest.mocked(getGroupMembers).mockRejectedValueOnce(new Error('Search unavailable'));
    mockUseApi.mockReturnValue({ data: { data: { ...mockGroupDetail, is_member: true } }, isLoading: false, error: null, refresh: jest.fn() });

    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));
    await screen.findByText('Off-page Assignee');
    fireEvent.changeText(screen.getByTestId('group-task-assignee-70-search'), 'zo');
    fireEvent.press(screen.getByTestId('group-task-assignee-70-search-button'));
    await screen.findByTestId('group-task-assignee-70-error');

    expect(screen.getByText('Off-page Assignee')).toBeTruthy();
    expect(updateGroupTask).not.toHaveBeenCalled();
  });

  it('renders each task action from its server capabilities and fails closed when they are absent', async () => {
    const task = (id: number, title: string, capabilities: Partial<{
      can_update_status: boolean;
      can_edit: boolean;
      can_delete: boolean;
    }> = {}) => ({
      id,
      group_id: 1,
      title,
      description: null,
      status: 'todo' as const,
      priority: 'medium' as const,
      assigned_to: null,
      due_date: null,
      created_at: '2026-06-01T00:00:00Z',
      ...capabilities,
    });
    jest.mocked(getGroupTasks).mockResolvedValue({
      data: [
        task(71, 'Creator task', { can_update_status: true, can_edit: true, can_delete: true }),
        task(72, 'Assignee task', { can_update_status: true, can_edit: false, can_delete: false }),
        task(73, 'Unrelated task'),
      ],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({
      data: { total: 3, todo: 3, in_progress: 0, done: 0, overdue: 0 },
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));
    await screen.findByText('Creator task');

    expect(screen.getByTestId('group-task-status-71')).toBeTruthy();
    expect(screen.getByTestId('group-task-edit-71')).toBeTruthy();
    expect(screen.getByTestId('group-task-delete-71')).toBeTruthy();
    expect(screen.getByTestId('group-task-status-72')).toBeTruthy();
    expect(screen.queryByTestId('group-task-edit-72')).toBeNull();
    expect(screen.queryByTestId('group-task-delete-72')).toBeNull();
    expect(screen.queryByTestId('group-task-status-73')).toBeNull();
    expect(screen.queryByTestId('group-task-edit-73')).toBeNull();
    expect(screen.queryByTestId('group-task-delete-73')).toBeNull();
  });

  it('lets members create native group tasks', async () => {
    jest.mocked(getGroupTasks).mockResolvedValue({
      data: [],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({
      data: { total: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 },
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByPlaceholderText, getByText, getByTestId } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Tasks'));
    await waitFor(() => expect(getGroupTasks).toHaveBeenCalledWith(1, { status: 'all', cursor: null }));
    await waitFor(() => expect(getByTestId('group-task-composer-toggle').props.accessibilityState.disabled).toBe(false));
    fireEvent.press(getByTestId('group-task-composer-toggle'));
    fireEvent.changeText(getByPlaceholderText('Task title'), 'Mulch vegetable beds');
    fireEvent.changeText(getByPlaceholderText('Add task details...'), 'Use the compost near shed two.');
    fireEvent.changeText(getByPlaceholderText('Due date, for example 2026-06-30'), '2026-06-30');
    fireEvent.press(getByText('High'));
    fireEvent.press(getByText('Create task'));

    await waitFor(() => {
      expect(reserveGroupTaskCreationOperation).toHaveBeenCalledWith(1, JSON.stringify({
        groupId: 1,
        title: 'Mulch vegetable beds',
        description: 'Use the compost near shed two.',
        status: 'todo',
        priority: 'high',
        assigned_to: null,
        due_date: '2026-06-30',
      }), {
        title: 'Mulch vegetable beds',
        description: 'Use the compost near shed two.',
        priority: 'high',
        assignedTo: null,
        dueDate: '2026-06-30',
      });
      expect(createGroupTask).toHaveBeenCalledWith(1, {
        title: 'Mulch vegetable beds',
        description: 'Use the compost near shed two.',
        status: 'todo',
        priority: 'high',
        assigned_to: null,
        due_date: '2026-06-30',
      }, 'group-task-operation-key');
      expect(completeGroupTaskCreationOperation).toHaveBeenCalledWith(expect.objectContaining({ key: 'group-task-operation-key' }));
    });
  });

  it('restores and safely retries the exact unfinished task after an app restart', async () => {
    const pending = {
      storageKey: 'saved-group-task',
      key: 'group-task-restart-key',
      groupId: 1,
      intent: 'saved-intent',
      draft: {
        title: 'Resume garden rota',
        description: 'Keep this exact draft.',
        priority: 'urgent' as const,
        assignedTo: null,
        dueDate: '2026-07-01',
      },
      createdAt: 1,
    };
    jest.mocked(loadGroupTaskCreationOperation).mockResolvedValue(pending);
    jest.mocked(reserveGroupTaskCreationOperation).mockResolvedValue(pending);
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));

    await screen.findByDisplayValue('Resume garden rota');
    expect(screen.getByDisplayValue('Keep this exact draft.')).toBeTruthy();
    expect(screen.getByDisplayValue('2026-07-01')).toBeTruthy();
    fireEvent.press(screen.getByText('Create task'));

    await waitFor(() => {
      expect(createGroupTask).toHaveBeenCalledWith(1, expect.objectContaining({
        title: 'Resume garden rota',
        description: 'Keep this exact draft.',
        priority: 'urgent',
        due_date: '2026-07-01',
      }), 'group-task-restart-key');
      expect(completeGroupTaskCreationOperation).toHaveBeenCalledWith(pending);
    });
  });

  it('keeps the task draft and blocks transport when durable reservation fails', async () => {
    jest.mocked(reserveGroupTaskCreationOperation).mockRejectedValueOnce(new Error('Keystore unavailable'));
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));
    await waitFor(() => expect(loadGroupTaskCreationOperation).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByTestId('group-task-composer-toggle').props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByTestId('group-task-composer-toggle'));
    fireEvent.changeText(screen.getByPlaceholderText('Task title'), 'Do not lose this task');
    fireEvent.press(screen.getByText('Create task'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    expect(createGroupTask).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Do not lose this task')).toBeTruthy();
  });

  it('blocks a new task when recovery cannot be read and restores it on retry', async () => {
    const pending = {
      storageKey: 'saved-group-task',
      key: 'group-task-recovered-key',
      groupId: 1,
      intent: 'saved-intent',
      draft: { title: 'Recovered after retry', description: '', priority: 'medium' as const, assignedTo: null, dueDate: '' },
      createdAt: 1,
    };
    let retryAllowed = false;
    jest.mocked(loadGroupTaskCreationOperation).mockImplementation(async () => {
      if (!retryAllowed) throw new Error('Secure storage locked');
      return pending;
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));
    await screen.findByTestId('group-task-recovery-error');
    expect(screen.getByTestId('group-task-composer-toggle').props.accessibilityState.disabled).toBe(true);
    retryAllowed = true;
    fireEvent.press(screen.getByText('common:buttons.retry'));

    await screen.findByDisplayValue('Recovered after retry');
    expect(loadGroupTaskCreationOperation).toHaveBeenCalledTimes(2);
  });

  it('clears a durable task operation after a definite server rejection so the draft can be corrected', async () => {
    jest.mocked(createGroupTask).mockRejectedValueOnce(new ApiResponseError(422, 'Invalid due date'));
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const screen = render(<GroupDetailScreen />);
    fireEvent.press(screen.getByText('Tasks'));
    await waitFor(() => expect(loadGroupTaskCreationOperation).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByTestId('group-task-composer-toggle').props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByTestId('group-task-composer-toggle'));
    fireEvent.changeText(screen.getByPlaceholderText('Task title'), 'Correctable task');
    fireEvent.changeText(screen.getByPlaceholderText('Due date, for example 2026-06-30'), 'bad-date');
    fireEvent.press(screen.getByText('Create task'));

    await waitFor(() => expect(discardGroupTaskCreationOperation).toHaveBeenCalledWith(expect.objectContaining({ key: 'group-task-operation-key' })));
    expect(screen.getByDisplayValue('Correctable task')).toBeTruthy();
  });

  it('renders group analytics for group admins and changes the reporting window', async () => {
    jest.mocked(getGroupAnalytics).mockResolvedValue({
      data: {
        overview: {
          total_members: 12,
          total_discussions: 2,
          total_posts: 7,
          total_events: 1,
          total_files: 1,
          pending_requests: 0,
          created_at: '2026-05-01T00:00:00Z',
          visibility: 'public',
        },
        member_growth: [{ date: '2026-06-01', new_members: 4, total_members: 12 }],
        engagement: {
          timeline: [{ date: '2026-06-01', posts: 7, discussions: 2, active_members: 6 }],
          summary: {
            total_members: 12,
            active_members: 6,
            participation_rate: 50,
            avg_posts_per_day: 1.4,
          },
        },
        top_contributors: [{
          user_id: 10,
          name: 'Alice Admin',
          avatar_url: null,
          post_count: 7,
        }],
        content_performance: [{
          id: 5,
          title: 'Compost rota',
          created_at: '2026-06-01T00:00:00Z',
          author_name: 'Alice Admin',
          reply_count: 3,
          unique_participants: 2,
        }],
        activity_breakdown: {
          discussions: 2,
          posts: 7,
          events: 1,
          files: 1,
          member_joins: 4,
          total: 15,
        },
      },
    });
    jest.mocked(getGroupAnalyticsRetention).mockResolvedValue({
      data: [{ month: '2026-06', joined: 4, still_active: 3, retention_rate: 75 }],
    });
    jest.mocked(getGroupAnalyticsComparative).mockResolvedValue({
      data: { group_members: 12, avg_members: 8, percentile: 80, total_groups: 5, rank: 2 },
    });
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockGroupDetail,
          is_member: true,
          viewer_membership: { status: 'active', role: 'admin', is_admin: true },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findByText, getAllByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Analytics'));

    expect(await findByText('Group analytics')).toBeTruthy();
    expect(getByText('Top contributors')).toBeTruthy();
    expect(getAllByText('Retention').length).toBeGreaterThan(0);
    expect(getByText('Group comparison')).toBeTruthy();
    expect(getByText('4 joined, 3 still active')).toBeTruthy();
    expect(getByText('#2 of 5')).toBeTruthy();
    expect(getByText('Alice Admin')).toBeTruthy();
    expect(getByText('Compost rota')).toBeTruthy();
    expect(getAllByText('7 posts').length).toBeGreaterThan(0);

    fireEvent.press(getByText('90 days'));

    await waitFor(() => {
      expect(getGroupAnalytics).toHaveBeenCalledWith(1, 90);
    });
  });
  it('🔴 opens a discussion so a member can read the answers to it', async () => {
    // The cards listed a title and a reply count and went nowhere, so a member could
    // start a discussion and never read a single answer — including their own.
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const emptyListState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyAnnouncementsState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyFilesState = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const discussionsState = {
      data: {
        data: [{
          id: 42,
          title: 'Can anyone help with a lift on Tuesday?',
          reply_count: 3,
          is_pinned: false,
          author: { id: 10, name: 'Alice Admin', avatar_url: null },
          created_at: '2026-06-01T00:00:00Z',
          last_reply_at: '2026-06-02T00:00:00Z',
        }],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, emptyListState, discussionsState, emptyAnnouncementsState, emptyFilesState, emptyListState, emptyListState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByTestId, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Discussions'));
    expect(getByText('Can anyone help with a lift on Tuesday?')).toBeTruthy();

    fireEvent.press(getByTestId('group-discussion-42'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/group-discussion',
      params: { id: '1', discussionId: '42' },
    });
  });

  /*
    🔴 A group admin on the phone could see the member list and change nothing about it.
    Promotion, demotion and removal all existed on the server with no caller in the app.
    Audit 2026-09-07, fixed 2026-09-08.

    🔴 `mockUseApi` hands out results BY CALL ORDER, so the array below must have one
    entry per useApi call per render — including the one inside GroupJoinRequestsCard,
    which mounts with the members tab. Get the length wrong and every result shifts by
    one on the second render, which is how twelve unrelated cases went red once.
  */
  function renderMembersTabAsAdmin(members: Record<string, unknown>[]) {
    const groupState = {
      data: { data: { ...mockGroupDetail, is_member: true, viewer_membership: { status: 'active', role: 'admin', is_admin: true } } },
      isLoading: false, error: null, refresh: jest.fn(),
    };
    const membersState = { data: { data: members }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyList = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyPaged = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
    const joinRequestsState = { data: { data: [] }, isLoading: false, error: null, errorStatus: null, errorCode: null, refresh: jest.fn() };

    let call = 0;
    mockUseApi.mockImplementation(() => {
      const states = [groupState, membersState, emptyList, emptyPaged, emptyPaged, emptyPaged, emptyList, joinRequestsState];
      const state = states[call % states.length];
      call += 1;
      return state;
    });

    // Open ON the members tab rather than switching to it. The card's own useApi only
    // exists while that tab is mounted, so switching mid-test would give the first
    // render seven calls and later renders eight — and the positional stub would then
    // hand every result to the wrong hook.
    mockRouteParams = { id: '1', tab: 'members' };
    const screen = render(<GroupDetailScreen />);
    return { screen, membersState, groupState };
  }

  const otherMember = {
    id: 21,
    name: 'Bea Member',
    avatar_url: null,
    role: 'member',
    joined_at: '2026-05-01T00:00:00Z',
    capabilities: { can_change_role: true, can_remove: true },
  };

  it('lets a group admin promote a member', async () => {
    const { updateGroupMemberRole } = require('@/lib/api/groups');
    const { screen } = renderMembersTabAsAdmin([otherMember]);

    fireEvent.press(screen.getByTestId('group-member-role-21'));

    await waitFor(() => expect(updateGroupMemberRole).toHaveBeenCalledWith(1, 21, 'admin'));
  });

  it('demotes an admin rather than promoting them again', async () => {
    const { updateGroupMemberRole } = require('@/lib/api/groups');
    const { screen } = renderMembersTabAsAdmin([{ ...otherMember, role: 'admin' }]);

    fireEvent.press(screen.getByTestId('group-member-role-21'));

    await waitFor(() => expect(updateGroupMemberRole).toHaveBeenCalledWith(1, 21, 'member'));
  });

  it('asks before removing somebody from the group', async () => {
    const { removeGroupMember } = require('@/lib/api/groups');
    const { screen } = renderMembersTabAsAdmin([otherMember]);

    fireEvent.press(screen.getByTestId('group-member-remove-21'));

    // Asked, not done. Removal takes away everything shared with them in the group.
    expect(removeGroupMember).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));

    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(removeGroupMember).toHaveBeenCalledWith(1, 21);
  });

  it('ignores a member removal confirmation after leaving the group screen', async () => {
    const { removeGroupMember } = require('@/lib/api/groups');
    const { screen } = renderMembersTabAsAdmin([otherMember]);
    fireEvent.press(screen.getByTestId('group-member-remove-21'));
    screen.unmount();
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(removeGroupMember).not.toHaveBeenCalled();
  });

  it('offers no member actions against the owner or against yourself', () => {
    // The server refuses both, and an admin who demoted themselves would lock
    // themselves out of the screen they are standing on.
    const owner = { id: 5, name: 'Olive Owner', avatar_url: null, role: 'owner', joined_at: null };
    const self = { id: 99, name: 'Current User', avatar_url: null, role: 'admin', joined_at: null };
    const { screen } = renderMembersTabAsAdmin([owner, self, otherMember]);

    expect(screen.queryByTestId('group-member-role-5')).toBeNull();
    expect(screen.queryByTestId('group-member-remove-5')).toBeNull();
    expect(screen.queryByTestId('group-member-role-99')).toBeNull();
    expect(screen.queryByTestId('group-member-remove-99')).toBeNull();
    // …but the ordinary member still has them.
    expect(screen.getByTestId('group-member-role-21')).toBeTruthy();
  });

  it('renders member actions independently from exact capabilities and fails closed when they are absent', () => {
    const roleOnly = { ...otherMember, id: 22, name: 'Role Only', capabilities: { can_change_role: true, can_remove: false } };
    const removeOnly = { ...otherMember, id: 23, name: 'Remove Only', capabilities: { can_change_role: false, can_remove: true } };
    const missingCapabilities = { id: 24, name: 'Read Only', avatar_url: null, role: 'member', joined_at: null };
    const { screen } = renderMembersTabAsAdmin([roleOnly, removeOnly, missingCapabilities]);

    expect(screen.getByTestId('group-member-role-22')).toBeTruthy();
    expect(screen.queryByTestId('group-member-remove-22')).toBeNull();
    expect(screen.queryByTestId('group-member-role-23')).toBeNull();
    expect(screen.getByTestId('group-member-remove-23')).toBeTruthy();
    expect(screen.queryByTestId('group-member-role-24')).toBeNull();
    expect(screen.queryByTestId('group-member-remove-24')).toBeNull();
  });

  /**
   * 🔴 Five of this screen's tabs stopped at twenty rows. Members, discussions,
   * announcements, files and Q&A each fetched one page and rendered it; only the
   * marketplace tab paged. Every one of these endpoints has always answered with a
   * `cursor` and `has_more`, and the screen read neither — so the twenty-first member of
   * a group did not exist as far as the phone was concerned.
   */
  describe('paging', () => {
    function renderTab(tab: string, listState: Record<string, unknown>, slot: number) {
      const groupState = {
        data: { data: { ...mockGroupDetail, is_member: true, viewer_membership: { status: 'active', role: 'admin', is_admin: true } } },
        isLoading: false, error: null, refresh: jest.fn(),
      };
      const emptyList = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      const emptyPaged = { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() };
      const joinRequests = { data: { data: [] }, isLoading: false, error: null, errorStatus: null, errorCode: null, refresh: jest.fn() };
      /* Declaration order: group, members, discussions, announcements, files, questions,
         events — and, on the members tab only, GroupJoinRequestsCard's own useApi last. */
      const states: Record<string, unknown>[] = [groupState, emptyList, emptyList, emptyPaged, emptyPaged, emptyPaged, emptyList];
      // The join-requests card exists only while the members tab is mounted, so the
      // number of calls PER RENDER differs by tab. Getting this length wrong shifts every
      // result by one on the second render — the trap recorded above.
      if (tab === 'members') states.push(joinRequests);
      states[slot] = listState;
      let call = 0;
      mockUseApi.mockImplementation(() => states[call++ % states.length]);
      mockRouteParams = { id: '1', tab };
      return render(<GroupDetailScreen />);
    }

    it('offers Load more on the member list when the server says there are more', () => {
      const members = [{ id: 21, name: 'Bea Member', avatar_url: null, role: 'member', joined_at: null }];
      const { getByTestId } = renderTab('members', {
        data: { data: members, meta: { cursor: 'abc', has_more: true } },
        isLoading: false, error: null, refresh: jest.fn(),
      }, 1);

      expect(getByTestId('group-members-load-more')).toBeTruthy();
    });

    it('offers no Load more when the member list is complete', () => {
      const members = [{ id: 21, name: 'Bea Member', avatar_url: null, role: 'member', joined_at: null }];
      const { queryByTestId } = renderTab('members', {
        data: { data: members, meta: { cursor: null, has_more: false } },
        isLoading: false, error: null, refresh: jest.fn(),
      }, 1);

      expect(queryByTestId('group-members-load-more')).toBeNull();
    });

    it('offers Load more on files and on Q&A, which use the nested envelope', () => {
      const files = [{ id: 3, file_name: 'minutes.pdf', file_size: 1024, folder: null, description: null, uploader_name: 'Aoife', created_at: null }];
      const filesScreen = renderTab('files', {
        data: { data: { items: files, cursor: 'next', has_more: true } },
        isLoading: false, error: null, refresh: jest.fn(),
      }, 4);
      expect(filesScreen.getByTestId('group-files-load-more')).toBeTruthy();
      filesScreen.unmount();

      const questions = [{ id: 8, title: 'When is the next meet?', body: 'Asking for the rota.', answers: [], answer_count: 0, vote_score: 0, is_answered: false, author: null, created_at: null }];
      const qaScreen = renderTab('qa', {
        data: { data: { items: questions, cursor: 'next', has_more: true } },
        isLoading: false, error: null, refresh: jest.fn(),
      }, 5);
      expect(qaScreen.getByTestId('group-questions-load-more')).toBeTruthy();
    });
  });
});
