// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

const mockRouterPush = jest.fn();
let mockRouteParams: Record<string, string> = { id: '1' };

jest.mock('expo-router', () => ({
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

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
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

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/groups', () => ({
  getGroup: jest.fn(),
  createGroupDiscussion: jest.fn().mockResolvedValue({ data: {} }),
  getGroupMembers: jest.fn(),
  getGroupDiscussions: jest.fn(),
  getGroupAnnouncements: jest.fn(),
  getGroupFiles: jest.fn(),
  deleteGroupFile: jest.fn().mockResolvedValue({ data: { message: 'Deleted' } }),
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

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
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
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

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
  getGroupWikiPage,
  getGroupWikiPages,
  getGroupWikiRevisions,
  getGroupTasks,
  getGroupTaskStats,
  getGroupQuestion,
  joinGroup,
  updateGroupTask,
  updateGroupWikiPage,
  updateGroupAnnouncement,
  uploadGroupMedia,
  voteGroupQA,
} from '@/lib/api/groups';
import * as ImagePicker from 'expo-image-picker';

const defaultApiState = { data: null, isLoading: true, error: null, refresh: jest.fn() };

beforeEach(() => {
  mockRouteParams = { id: '1' };
  mockAuthUser = { id: 99, name: 'Current User' };
  mockUseApi.mockReturnValue(defaultApiState);
  mockRouterPush.mockClear();
  jest.clearAllMocks();
});

const mockGroupDetail = {
  id: 1,
  name: 'Garden Club',
  description: 'A club for gardening enthusiasts.',
  long_description: null,
  visibility: 'public' as const,
  member_count: 12,
  posts_count: 5,
  is_featured: false,
  is_member: false,
  tags: [],
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

  it('lets group admins create announcements from the native announcements tab', async () => {
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
    fireEvent.press(getByText('Publish announcement'));

    await waitFor(() => {
      expect(createGroupAnnouncement).toHaveBeenCalledWith(1, {
        title: 'Spring update',
        content: 'Seeds arrive Friday.',
        is_pinned: true,
      });
      expect(refreshAnnouncements).toHaveBeenCalled();
    });
  });

  it('lets members start a discussion from the bottom-sheet composer', async () => {
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

    const { getByPlaceholderText, getByTestId, getByText, queryByTestId } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Discussions'));

    // The composer sheet is closed until the trigger button opens it.
    expect(queryByTestId('group-discussion-sheet')).toBeNull();
    fireEvent.press(getByText('New'));
    expect(getByTestId('group-discussion-sheet')).toBeTruthy();

    // Validation: publishing with empty fields never calls the API.
    fireEvent.press(getByText('Publish discussion'));
    expect(createGroupDiscussion).not.toHaveBeenCalled();
    expect(getByTestId('group-discussion-sheet')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Discussion title'), 'Compost rota');
    fireEvent.changeText(getByPlaceholderText('Write a message'), 'Who can take the Friday slot?');
    fireEvent.press(getByText('Publish discussion'));

    await waitFor(() => {
      expect(createGroupDiscussion).toHaveBeenCalledWith(1, {
        title: 'Compost rota',
        content: 'Who can take the Friday slot?',
      });
      expect(refreshDiscussions).toHaveBeenCalled();
      // The sheet closes and fields reset after a successful publish.
      expect(queryByTestId('group-discussion-sheet')).toBeNull();
    });
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
  });

  it('lets group admins delete files from the native files tab', async () => {
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

    const { getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Files'));
    fireEvent.press(getByText('Delete'));

    await waitFor(() => {
      expect(deleteGroupFile).toHaveBeenCalledWith(1, 31);
      expect(refreshFiles).toHaveBeenCalled();
    });
  });

  it('renders native group media and filters by type', async () => {
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

    const { findByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Media'));

    expect(await findByText('Spring garden')).toBeTruthy();
    expect(getByText('Photos')).toBeTruthy();

    fireEvent.press(getByText('Videos'));

    await waitFor(() => {
      expect(getGroupMedia).toHaveBeenCalledWith(1, { type: 'video' });
    });
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
    fireEvent.press(getByText('Upload photo'));

    await waitFor(() => {
      expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled();
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      }));
      expect(uploadGroupMedia).toHaveBeenCalledWith(1, expect.objectContaining({
        uri: 'file:///tmp/group-media.jpg',
        fileName: 'group-media.jpg',
        mimeType: 'image/jpeg',
      }));
    });
  });

  it('lets members ask questions from the native Q&A tab', async () => {
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
    fireEvent.press(getByText('Publish question'));

    await waitFor(() => {
      expect(createGroupQuestion).toHaveBeenCalledWith(1, {
        title: 'Which compost bin works best?',
        body: 'We need a lidded bin for the shared garden.',
      });
      expect(refreshQuestions).toHaveBeenCalled();
    });
  });

  it('lets members open a question and post an answer', async () => {
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

    const { findByText, getByLabelText, getByPlaceholderText, getByText } = render(<GroupDetailScreen />);

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
    fireEvent.press(getByText('Post answer'));

    await waitFor(() => {
      expect(answerGroupQuestion).toHaveBeenCalledWith(1, 41, {
        body: 'Add brown material and keep it covered.',
      });
      expect(refreshQuestions).toHaveBeenCalled();
    });
  });

  it('lets group admins accept answers from the native Q&A tab', async () => {
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

    const { findByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Q&A'));
    fireEvent.press(getByText('How do we compost safely?'));
    expect(await findByText('Use a lidded bin.')).toBeTruthy();
    fireEvent.press(getByText('Accept answer'));

    await waitFor(() => {
      expect(acceptGroupAnswer).toHaveBeenCalledWith(1, 50);
    });
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

  it('renders native wiki pages and opens page content', async () => {
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

    const { findAllByText, findByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Wiki'));

    expect((await findAllByText('Compost guide')).length).toBeGreaterThan(0);
    expect(await findByText('Use a lidded bin.')).toBeTruthy();
    expect(getGroupWikiPages).toHaveBeenCalledWith(1);
    expect(getGroupWikiPage).toHaveBeenCalledWith(1, 'compost-guide');

    fireEvent.press(getByText('Revisions'));
    expect(await findByText('Initial note')).toBeTruthy();
    expect(getGroupWikiRevisions).toHaveBeenCalledWith(1, 61);
  });

  it('lets group admins delete native wiki pages', async () => {
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

    const { findAllByText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Wiki'));
    await findAllByText('Compost guide');
    fireEvent.press(getByText('Delete'));

    await waitFor(() => {
      expect(deleteGroupWikiPage).toHaveBeenCalledWith(1, 61);
    });
  });

  it('lets members create and edit native wiki pages', async () => {
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

    const { findAllByText, getAllByPlaceholderText, getByPlaceholderText, getByText } = render(<GroupDetailScreen />);

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
      });
    });

    fireEvent.press(getByText('Edit'));
    fireEvent.changeText(getAllByPlaceholderText('Write the page content...')[0], 'Keep it covered.');
    fireEvent.changeText(getByPlaceholderText('Change summary'), 'Clarified storage.');
    fireEvent.press(getByText('Save page'));

    await waitFor(() => {
      expect(updateGroupWikiPage).toHaveBeenCalledWith(1, 62, {
        title: 'Tool care',
        content: 'Keep it covered.',
        change_summary: 'Clarified storage.',
      });
    });
  });

  it('renders native group tasks and cycles task status', async () => {
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
      }],
      meta: { has_more: false, cursor: null },
    });
    jest.mocked(getGroupTaskStats).mockResolvedValue({
      data: { total: 1, todo: 1, in_progress: 0, done: 0, overdue: 0 },
    });
    mockUseApi.mockReturnValue({
      data: { data: { ...mockGroupDetail, is_member: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { findByText, getByLabelText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Tasks'));

    expect(await findByText('Water seedlings')).toBeTruthy();
    expect(getByText('Use the small greenhouse cans.')).toBeTruthy();
    expect(getByText('High')).toBeTruthy();
    fireEvent.press(getByLabelText('To do'));

    await waitFor(() => {
      expect(updateGroupTask).toHaveBeenCalledWith(70, { status: 'in_progress' });
    });
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

    const { getByPlaceholderText, getByText } = render(<GroupDetailScreen />);

    fireEvent.press(getByText('Tasks'));
    await waitFor(() => expect(getGroupTasks).toHaveBeenCalledWith(1, { status: 'all' }));
    fireEvent.press(getByText('New task'));
    fireEvent.changeText(getByPlaceholderText('Task title'), 'Mulch vegetable beds');
    fireEvent.changeText(getByPlaceholderText('Add task details...'), 'Use the compost near shed two.');
    fireEvent.changeText(getByPlaceholderText('Due date, for example 2026-06-30'), '2026-06-30');
    fireEvent.press(getByText('High'));
    fireEvent.press(getByText('Create task'));

    await waitFor(() => {
      expect(createGroupTask).toHaveBeenCalledWith(1, {
        title: 'Mulch vegetable beds',
        description: 'Use the compost near shed two.',
        status: 'todo',
        priority: 'high',
        assigned_to: null,
        due_date: '2026-06-30',
      });
    });
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
});
