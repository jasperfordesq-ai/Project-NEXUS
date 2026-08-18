// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Popover, PopoverTrigger, PopoverContent, PopoverHeading } from '@/components/ui/Popover';
import { SearchField } from '@/components/ui/SearchField';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
/**
 * Conversation Page - Individual message thread
 *
 * Features:
 * - Real-time message updates via polling (with cursor for efficiency)
 * - Infinite scroll for message history (scroll up to load older messages)
 * - Voice message playback
 * - Typing indicators (when Pusher is available)
 */

import { Fragment, useState, useEffect, useRef, useCallback, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { AnimatePresence } from '@/lib/motion';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Info from 'lucide-react/icons/info';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Trash2 from 'lucide-react/icons/trash-2';
import Search from 'lucide-react/icons/search';
import X from 'lucide-react/icons/x';
import FileText from 'lucide-react/icons/file-text';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Languages from 'lucide-react/icons/languages';
import MessageCircle from 'lucide-react/icons/message-circle';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldOff from 'lucide-react/icons/shield-off';
import { useNotifications, useToast } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { useAuth, useTenant } from '@/contexts';
import { usePresenceOptional } from '@/contexts/PresenceContext';
import { usePusherOptional, type NewMessageEvent, type TypingEvent } from '@/contexts/PusherContext';
import { usePageTitle } from '@/hooks';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { PageMeta } from '@/components/seo';
import { useVerificationBadges, VerificationBadgeRow } from '@/components/verification/VerificationBadge';
import { api, type ApiErrorDetail, type ApiResponse } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatDate, resolveAvatarUrl } from '@/lib/helpers';
import { safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageGetJSON, safeLocalStorageSetJSON } from '@/lib/safeStorage';
import type { Message, User } from '@/types/api';
import { MessageContextCard } from '@/components/messages/MessageContextCard';
import { MessageBubble } from './components/MessageBubble';
import { MessageInputArea } from './components/MessageInputArea';
import type { AttachmentPreview } from './components/MessageInputArea';

interface OtherUser {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  avatar?: string | null;
  tagline?: string;
  is_online?: boolean;
}

interface SafeguardingMeta {
  restricted: boolean;
  code: string;
  title?: string | null;
  message?: string | null;
  detail?: string | null;
  action_label?: string | null;
  required_vetting_types?: string[];
  required_vetting_labels?: string[];
  can_request_coordinator?: boolean;
}

interface ConversationMeta {
  id: number;
  other_user: OtherUser;
  context_type?: string;
  context_id?: number;
  // Server-authoritative preflight safeguarding state. Present (restricted=true)
  // when direct contact with other_user is gated; absent/null otherwise.
  safeguarding?: SafeguardingMeta | null;
}

interface ConversationData {
  meta: ConversationMeta;
  messages: Message[];
}

interface PaginationState {
  olderCursor: string | null;
  newerCursor: string | null;
  hasOlderMessages: boolean;
  hasNewerMessages: boolean;
}

interface SafeguardingBlockNotice {
  code: 'VETTING_REQUIRED' | 'SAFEGUARDING_CONTACT_RESTRICTED' | 'SAFEGUARDING_POLICY_UNAVAILABLE';
  status: 'deny' | 'unavailable';
  source: 'preflight' | 'send';
  translationKey: 'safeguarding_vetting_required' | 'safeguarding_contact_restricted' | 'safeguarding_policy_unavailable';
  title?: string;
  message: string;
  detail?: string;
  actionLabel?: string;
  requiredVettingTypes: string[];
  requiredVettingLabels: string[];
  canRequestCoordinator: boolean;
}

type SafeguardingPolicyStatus = 'allow' | 'deny' | 'unavailable';

interface SafeguardingPolicyEvaluation {
  status: SafeguardingPolicyStatus;
  notice: SafeguardingBlockNotice | null;
}

/**
 * What prompted a safeguarding re-evaluation. This decides whether an incoming
 * `allow` is allowed to erase a denial the member is currently looking at.
 *
 * - `authoritative` — the conversation was (re)loaded, or the member asked:
 *   "Check again", or returning focus/visibility to the tab. Always applied.
 * - `background` — a timer asked: the message poll, or the blocked-policy
 *   recheck interval. Applied, except it may not clear a `source: 'send'` denial.
 *
 * Why the asymmetry: `MessageService::send` re-evaluates the gate against LOCKED
 * tenant-scoped rows inside the write transaction (`MessageService.php:636`,
 * documented as the "Definitive write check"), whereas the preflight state in
 * `getConversation()` — the `safeguarding` meta every GET returns, poll included
 * — comes from the UNLOCKED read. A background `allow` is therefore strictly
 * weaker evidence than the denial the member's own send attempt just returned,
 * and letting it win silently deleted their only explanation ~5s after they hit
 * send. The member is never stranded: the panel's "Check again" button, and
 * simply returning to the tab, both still clear it.
 */
type SafeguardingRefreshTrigger = 'authoritative' | 'background';

type MessageSendFailure = Pick<ApiResponse<unknown>, 'code' | 'error' | 'errors'>;

const SAFEGUARDING_BLOCK_CODES = new Set([
  'VETTING_REQUIRED',
  'SAFEGUARDING_CONTACT_RESTRICTED',
  'SAFEGUARDING_POLICY_UNAVAILABLE',
]);

// Expected business-rule refusals that handleSendFailure already surfaces to the
// user (safeguarding panel or a toast). Reporting these to Sentry at error level
// is noise that also dilutes/masks genuine 5xx send failures under the same
// fingerprint, so only unexpected failures (5xx / unknown code) are logged.
const EXPECTED_SEND_FAILURE_CODES = new Set([
  ...SAFEGUARDING_BLOCK_CODES,
  'BLOCKED',
  'MESSAGING_DISABLED',
  'VALIDATION_ERROR',
  'ONBOARDING_REQUIRED',
  'NOT_FOUND',
  'FORBIDDEN',
  'MAINTENANCE_MODE',
  'SERVICE_UNAVAILABLE',
]);

const SAFEGUARDING_RECHECK_INTERVAL_MS = 5000;

const CONTROLLED_VETTING_TRANSLATION_KEYS: Record<string, string> = {
  dbs_enhanced: 'safeguarding_checks.dbs_enhanced',
  pvg_scotland: 'safeguarding_checks.pvg_scotland',
  access_ni: 'safeguarding_checks.access_ni',
  garda_vetting: 'safeguarding_checks.garda_vetting',
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function translationKeyForCode(code: SafeguardingBlockNotice['code']): SafeguardingBlockNotice['translationKey'] {
  if (code === 'VETTING_REQUIRED') return 'safeguarding_vetting_required';
  if (code === 'SAFEGUARDING_CONTACT_RESTRICTED') return 'safeguarding_contact_restricted';
  return 'safeguarding_policy_unavailable';
}

function unavailableNotice(source: SafeguardingBlockNotice['source']): SafeguardingBlockNotice {
  return {
    code: 'SAFEGUARDING_POLICY_UNAVAILABLE',
    status: 'unavailable',
    source,
    translationKey: 'safeguarding_policy_unavailable',
    message: '',
    requiredVettingTypes: [],
    requiredVettingLabels: [],
    canRequestCoordinator: false,
  };
}

function extractSafeguardingBlockNotice(response: MessageSendFailure): SafeguardingBlockNotice | null {
  const details = Array.isArray(response.errors) ? response.errors : [];
  const safeguardingError = details.find((error) => error.code && SAFEGUARDING_BLOCK_CODES.has(error.code))
    ?? (response.code && SAFEGUARDING_BLOCK_CODES.has(response.code) ? details[0] : undefined);
  const code = safeguardingError?.code ?? response.code;

  if (code !== 'VETTING_REQUIRED' && code !== 'SAFEGUARDING_CONTACT_RESTRICTED' && code !== 'SAFEGUARDING_POLICY_UNAVAILABLE') {
    return null;
  }

  const detail = safeguardingError as ApiErrorDetail | undefined;
  const requiredVettingTypes = asStringArray(detail?.required_vetting_types);
  const requiredVettingLabels = asStringArray(detail?.required_vetting_labels);

  return {
    code,
    status: code === 'SAFEGUARDING_POLICY_UNAVAILABLE' ? 'unavailable' : 'deny',
    source: 'send',
    translationKey: translationKeyForCode(code),
    title: asString(detail?.title),
    message: asString(detail?.message) ?? response.error ?? '',
    detail: asString(detail?.detail),
    actionLabel: asString(detail?.action_label),
    requiredVettingTypes,
    requiredVettingLabels,
    canRequestCoordinator: Boolean(detail?.can_request_coordinator),
  };
}

/**
 * Build a safeguarding panel notice from the server-authoritative preflight state
 * delivered in the conversation payload. Lets the panel render — and the composer
 * disable — the moment the conversation opens, before the member types anything.
 * No request is made and no staff are alerted by rendering this.
 */
function evaluateSafeguardingMeta(
  safeguarding: SafeguardingMeta | null | undefined
): SafeguardingPolicyEvaluation {
  if (safeguarding === null) {
    return { status: 'allow', notice: null };
  }

  if (!safeguarding || safeguarding.restricted !== true || !SAFEGUARDING_BLOCK_CODES.has(safeguarding.code)) {
    return { status: 'unavailable', notice: unavailableNotice('preflight') };
  }

  const code = safeguarding.code as SafeguardingBlockNotice['code'];
  const requiredVettingTypes = asStringArray(safeguarding.required_vetting_types);
  const requiredVettingLabels = asStringArray(safeguarding.required_vetting_labels);

  const notice: SafeguardingBlockNotice = {
    code,
    status: code === 'SAFEGUARDING_POLICY_UNAVAILABLE' ? 'unavailable' : 'deny',
    source: 'preflight',
    translationKey: translationKeyForCode(code),
    title: asString(safeguarding.title ?? undefined),
    message: asString(safeguarding.message ?? undefined) ?? '',
    detail: asString(safeguarding.detail ?? undefined),
    actionLabel: asString(safeguarding.action_label ?? undefined),
    requiredVettingTypes,
    requiredVettingLabels,
    canRequestCoordinator: Boolean(safeguarding.can_request_coordinator),
  };

  return { status: notice.status, notice };
}

/**
 * Parse a message timestamp defensively (backend may send "YYYY-MM-DD HH:MM:SS",
 * which Safari's Date constructor rejects without the T separator).
 */
function toMessageDate(dateString: string | undefined): Date | null {
  if (!dateString) return null;
  const normalized = dateString.includes(' ') && !dateString.includes('T')
    ? dateString.replace(' ', 'T')
    : dateString;
  const date = new Date(normalized);
  return isNaN(date.getTime()) ? null : date;
}

/** Whether two dates fall on the same local calendar day. */
function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Scroll to a specific message by ID
 */
function scrollToMessage(messageId: number) {
  const element = document.getElementById(`message-${messageId}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Add highlight effect
    element.classList.add('ring-2', 'ring-yellow-400/50');
    setTimeout(() => {
      element.classList.remove('ring-2', 'ring-yellow-400/50');
    }, 2000);
  }
}

export function ConversationPage() {
  const { t, i18n } = useTranslation('messages');
  const [pageTitle, setPageTitle] = useState(() => t('title'));
  usePageTitle(pageTitle);
  const { id, userId } = useParams<{ id?: string; userId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { refreshCounts } = useNotifications();
  const pusher = usePusherOptional();
  const presence = usePresenceOptional();
  const { hasFeature, hasModule, tenantPath, tenantSlug } = useTenant();
  const isDirectMessagingEnabled = hasFeature('direct_messaging');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<number | null>(null);
  // Scroll-position tracking for auto-scroll, the scroll-to-bottom button and
  // keyboard handling. isNearBottomRef mirrors the 100px auto-scroll rule.
  const isNearBottomRef = useRef(true);
  const prevNewestMessageIdRef = useRef<number | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  // Soft-keyboard inset (iOS Safari doesn't shrink 100dvh when it opens).
  const keyboardOffset = useVisualViewport();
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Determine if this is a new conversation (user ID) or existing (conversation ID)
  const isNewConversationRoute = !!userId;
  const targetId = userId || id;

  // Get listing ID from query params if provided
  const listingIdParam = searchParams.get('listing');
  const listingId = listingIdParam ? parseInt(listingIdParam) : null;

  // Get context from query params (MS1: contextual messaging)
  const contextTypeParam = searchParams.get('context_type');
  const contextIdParam = searchParams.get('context_id');
  const contextType = contextTypeParam || undefined;
  const contextId = contextIdParam ? parseInt(contextIdParam) : undefined;

  const [conversation, setConversation] = useState<ConversationData | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isNewConversation, setIsNewConversation] = useState(false);
  const [listing, setListing] = useState<{ id: number; title: string; type: string } | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [deleteScope, setDeleteScope] = useState<'self' | 'everyone'>('self');
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    olderCursor: null,
    newerCursor: null,
    hasOlderMessages: false,
    hasNewerMessages: false,
  });
  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]); // message IDs
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  // File attachment state
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<AttachmentPreview[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Edit/delete state
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  // Safeguarding notice state (reappears on reload)
  const [isSafeguardingDismissed, setIsSafeguardingDismissed] = useState(false);
  const [safeguardingBlockNotice, setSafeguardingBlockNotice] = useState<SafeguardingBlockNotice | null>(null);
  const [safeguardingPolicyStatus, setSafeguardingPolicyStatus] = useState<SafeguardingPolicyStatus>('unavailable');
  const [isRefreshingSafeguarding, setIsRefreshingSafeguarding] = useState(false);
  const safeguardingRefreshInFlightRef = useRef(false);
  // Mirrors the live notice's provenance so a background refresh can tell a
  // send-time denial from a preflight one without threading state through every
  // `setSafeguardingBlockNotice` call site (there are several success paths that
  // legitimately clear it). Synced from the state itself, so it cannot drift.
  const safeguardingNoticeSourceRef = useRef<SafeguardingBlockNotice['source'] | null>(null);
  const [isRequestingVettingReview, setIsRequestingVettingReview] = useState(false);
  const [vettingReviewRequested, setVettingReviewRequested] = useState(false);
  // Explicit "request coordinator help" action state
  const [isRequestingCoordinator, setIsRequestingCoordinator] = useState(false);
  const [coordinatorRequestSent, setCoordinatorRequestSent] = useState(false);

  // Broker messaging restriction state (+ supporter-view disclosure flags)
  const [messagingRestriction, setMessagingRestriction] = useState<{
    messaging_disabled: boolean;
    under_monitoring: boolean;
    restriction_reason: string | null;
    review_notice_required?: boolean;
    /** True when EITHER participant has an active consented message-access
     *  grant — symmetric on purpose, so it never says whose supporter it is.
     *  Folded into the same banner as the broker notice below. */
    supporter_view_notice_required?: boolean;
    /** True only when THIS user's own messages are shared with a supporter. */
    own_messages_shared?: boolean;
  } | null>(null);

  // ── Translation hint banner (dismissed per-user, scoped to tenant) ──
  const tenantScope = tenantSlug || 'default';
  const TRANSLATION_HINT_KEY = `nexus_translation_hint_dismissed_${tenantScope}`;
  const translationFeatureEnabled = hasFeature('message_translation');
  const [translationHintDismissed, setTranslationHintDismissed] = useState(() =>
    safeLocalStorageGet(TRANSLATION_HINT_KEY) === '1'
  );
  const dismissTranslationHint = useCallback(() => {
    setTranslationHintDismissed(true);
    safeLocalStorageSet(TRANSLATION_HINT_KEY, '1');
  }, [TRANSLATION_HINT_KEY]);

  // ── Auto-translate state (scoped to tenant) ──────────────────────────────
  const STORAGE_KEY = `nexus_auto_translate_${tenantScope}`;

  function getAutoTranslatePrefs(): Record<string, string> {
    return safeLocalStorageGetJSON<Record<string, string>>(STORAGE_KEY, {});
  }

  function isAutoTranslateEnabled(otherUserId: number): boolean {
    return !!getAutoTranslatePrefs()[String(otherUserId)];
  }

  function toggleAutoTranslate(otherUserId: number, targetLang: string): boolean {
    const prefs = getAutoTranslatePrefs();
    if (prefs[String(otherUserId)]) {
      delete prefs[String(otherUserId)];
      safeLocalStorageSetJSON(STORAGE_KEY, prefs);
      return false;
    } else {
      prefs[String(otherUserId)] = targetLang;
      safeLocalStorageSetJSON(STORAGE_KEY, prefs);
      return true;
    }
  }

  const [autoTranslateOn, setAutoTranslateOn] = useState(false);
  const [autoTranslations, setAutoTranslations] = useState<Map<number, string>>(new Map());
  const autoTranslatingRef = useRef(false);
  const translatedIdsRef = useRef<Set<number>>(new Set());
  const autoTranslateAbortRef = useRef<AbortController | null>(null);

  // Sync autoTranslateOn from localStorage when the other user changes
  useEffect(() => {
    if (conversation?.meta?.other_user?.id) {
      setAutoTranslateOn(isAutoTranslateEnabled(conversation.meta.other_user.id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check when other_user changes
  }, [conversation?.meta?.other_user?.id]);

  // Fetch canonical presence for the other participant so the header dot/label reflect
  // live online status (consistent with the conversation list, which uses PresenceContext)
  // rather than only the is_online snapshot baked into the initial conversation payload.
  useEffect(() => {
    const otherId = conversation?.meta?.other_user?.id;
    if (otherId && otherId > 0 && presence) {
      presence.fetchPresence([otherId]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch when the participant changes; presence is a stable ref
  }, [conversation?.meta?.other_user?.id]);

  // Auto-translate effect: translate untranslated messages from the other user
  useEffect(() => {
    if (!autoTranslateOn || !conversation?.messages?.length || autoTranslatingRef.current) return;
    const otherUserId = conversation?.meta?.other_user?.id;
    if (!otherUserId) return;
    const targetLang = (i18n.language || 'en').split('-')[0] || 'en';

    // Find messages from the other user that haven't been translated or queued yet
    const untranslated = conversation.messages.filter(
      (msg) => msg.sender_id === otherUserId
        && !autoTranslations.has(msg.id)
        && !translatedIdsRef.current.has(msg.id)
        && (msg.body || msg.content)
    );
    if (untranslated.length === 0) return;

    // Mark these as queued immediately to prevent duplicate API calls
    for (const msg of untranslated) {
      translatedIdsRef.current.add(msg.id);
    }
    autoTranslatingRef.current = true;

    // Abort any previous in-flight translation loop (e.g., conversation switch)
    if (autoTranslateAbortRef.current) {
      autoTranslateAbortRef.current.abort();
    }
    const controller = new AbortController();
    autoTranslateAbortRef.current = controller;

    // Translate each message sequentially to avoid overwhelming the API
    (async () => {
      const newTranslations = new Map(autoTranslations);
      for (const msg of untranslated) {
        if (controller.signal.aborted || !isMountedRef.current) return;
        try {
          const response = await api.post<{ translated_text: string }>(`/v2/messages/${msg.id}/translate`, {
            target_language: targetLang,
          }, { signal: controller.signal });
          if (controller.signal.aborted || !isMountedRef.current) return;
          const translated = response.data?.translated_text;
          if (translated) {
            newTranslations.set(msg.id, translated);
          }
        } catch {
          // Remove from dedup set so retry is possible on next cycle
          translatedIdsRef.current.delete(msg.id);
        }
      }
      if (controller.signal.aborted || !isMountedRef.current) return;
      setAutoTranslations(newTranslations);
      autoTranslatingRef.current = false;
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- autoTranslateOn + messages length + language change trigger re-translation
  }, [autoTranslateOn, conversation?.messages?.length, i18n.language]);

  function handleAutoTranslateToggle() {
    const otherUser = conversation?.meta?.other_user;
    if (!otherUser) return;
    const targetLang = (i18n.language || 'en').split('-')[0] || 'en';
    const nowEnabled = toggleAutoTranslate(otherUser.id, targetLang);
    setAutoTranslateOn(nowEnabled);

    if (nowEnabled) {
      toast.success(t('auto_translate.enabled_toast'));
    } else {
      toast.info(t('auto_translate.disabled_toast'));
      // Clear auto-translations and dedup set when disabled
      setAutoTranslations(new Map());
      translatedIdsRef.current.clear();
    }
  }
  // ── End auto-translate state ──────────────────────────────────────────────

  // Update page title when conversation loads
  useEffect(() => {
    if (conversation?.meta?.other_user?.name) {
      setPageTitle(t('conversation_with', { name: conversation.meta.other_user.name }));
    }
  }, [conversation?.meta?.other_user?.name, t]);

  // Track document visibility for polling optimization
  useEffect(() => {
    function handleVisibilityChange() {
      setIsDocumentVisible(!document.hidden);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Debounced typing indicator sender
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendTypingIndicator = useCallback((otherUserId: number, isTyping: boolean) => {
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current);
    }
    typingDebounceRef.current = setTimeout(() => {
      if (pusher) {
        pusher.sendTyping(otherUserId, isTyping);
      }
    }, 500);
  }, [pusher]);

  // Subscribe to Pusher channel for real-time updates
  useEffect(() => {
    if (!targetId || !pusher) return;

    const otherUserId = parseInt(targetId, 10);
    pusher.subscribeToConversation(otherUserId);

    // Listen for new messages
    const unsubMessage = pusher.onNewMessage((event: NewMessageEvent) => {
      // Backend may send from_user_id instead of sender_id; normalize
      const senderId: number | undefined = event.sender_id || event.from_user_id;

      // Only handle messages from the other user in this conversation
      if (senderId === otherUserId) {
        // Update last message ID
        lastMessageIdRef.current = event.id;

        // Add the message to the conversation
        setConversation((prev) => {
          if (!prev) return null;

          // Check if message already exists
          if (prev.messages.some((m) => m.id === event.id)) {
            return prev;
          }

          const newMsg: Message = {
            id: event.id,
            body: event.body || event.preview || '',
            sender_id: senderId,
            is_own: false,
            created_at: event.created_at || new Date().toISOString(),
          };

          return {
            ...prev,
            messages: [...prev.messages, newMsg],
          };
        });

        // Mark incoming message as read immediately (user is viewing this conversation)
        if (targetId) {
          api.put(`/v2/messages/${targetId}/read`).catch(() => {
            // non-critical — will sync on next load
          });
        }

        // Scroll to bottom for new messages — but only when the user is
        // already reading the latest ones. When scrolled up into history the
        // scroll-to-bottom button badges the new message instead.
        requestAnimationFrame(() => {
          if (isNearBottomRef.current) scrollToBottom();
        });
      }
    });

    // Listen for typing indicators
    const unsubTyping = pusher.onTyping((event: TypingEvent) => {
      if (event.user_id === otherUserId) {
        setIsOtherUserTyping(event.is_typing);

        // Auto-clear typing after 5 seconds (in case stop event is missed)
        if (event.is_typing) {
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }
          typingTimeoutRef.current = setTimeout(() => {
            setIsOtherUserTyping(false);
          }, 5000);
        }
      }
    });

    return () => {
      if (pusher) {
        pusher.unsubscribeFromConversation(otherUserId);
        if (typeof unsubMessage === 'function') unsubMessage();
        if (typeof unsubTyping === 'function') unsubTyping();
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [targetId, pusher, id]);

  const loadUserForNewConversation = useCallback(async (userIdToLoad: number) => {
    try {
      const response = await api.get<User>(`/v2/users/${userIdToLoad}`);
      if (response.success && response.data) {
        const userData = response.data;
        // Create a mock conversation with the user
        setConversation({
          meta: {
            id: userIdToLoad,
            other_user: {
              id: userData.id,
              name: userData.name || `${userData.first_name || ''} ${userData.last_name || ''}`.trim(),
              first_name: userData.first_name,
              last_name: userData.last_name,
              avatar_url: userData.avatar_url,
              avatar: userData.avatar,
              tagline: userData.tagline,
            },
          },
          messages: [],
        });
        setIsNewConversation(true);
      } else {
        // User not found - go back to messages
        navigate(tenantPath('/messages'));
      }
    } catch (error) {
      logError('Failed to load user for new conversation', error);
      navigate(tenantPath('/messages'));
    }
  }, [navigate, tenantPath]);

  /**
   * Poll for new messages using cursor-based pagination
   * Only fetches messages newer than the last known message
   */
  // Verification badges for the other participant. The phone header renders a
  // compact check icon beside the name plus a labeled status line; desktop
  // keeps the labeled chip row. One fetch feeds both (VerificationBadgeRow
  // receives these as props instead of refetching).
  const { badges: otherUserBadges, isLoaded: otherUserBadgesLoaded } = useVerificationBadges(
    conversation?.meta.other_user?.id
  );
  const otherUserIdVerified = otherUserBadges.some((badge) => badge.type === 'id_verified');

  const applySafeguardingMeta = useCallback((
    safeguarding: SafeguardingMeta | null | undefined,
    trigger: SafeguardingRefreshTrigger = 'authoritative',
  ) => {
    const evaluation = evaluateSafeguardingMeta(safeguarding);

    // Keep the cached conversation meta truthful either way — the guard below is
    // about what the member is shown, not about discarding the server's answer.
    setConversation((current) => current
      ? { ...current, meta: { ...current.meta, safeguarding } }
      : current);

    // A background timer may unlock a preflight restriction (the recipient can
    // withdraw a preference while the conversation is open), but it may not
    // overturn the locked send-time decision. Only an explicit `allow` is held
    // back: a background 'unavailable' still applies, so fail-closed is intact.
    if (trigger === 'background'
      && evaluation.status === 'allow'
      && safeguardingNoticeSourceRef.current === 'send') {
      return;
    }

    setSafeguardingPolicyStatus(evaluation.status);
    setSafeguardingBlockNotice(evaluation.notice);
  }, []);

  // Single sync point for the provenance ref above: derived from the notice state
  // itself, so every existing setter (including the post-send success paths that
  // clear it) is covered without being rewritten.
  useEffect(() => {
    safeguardingNoticeSourceRef.current = safeguardingBlockNotice?.source ?? null;
  }, [safeguardingBlockNotice]);

  const pollForNewMessages = useCallback(async () => {
    // Only poll when we have a target user ID and a known last message
    if (!targetId || !lastMessageIdRef.current) return;

    try {
      // Use the last message ID as cursor to get only newer messages
      const cursor = btoa(String(lastMessageIdRef.current));
      const response = await api.get<Message[]>(`/v2/messages/${targetId}?direction=newer&cursor=${cursor}`);
      // An incremental "newer messages" fetch is not a policy preflight. api.ts
      // resolves rather than throws on 503 / maintenance / expired session, and
      // those envelopes carry no meta at all — while evaluateSafeguardingMeta
      // reads absent policy information as fail-closed 'unavailable'. Applying
      // them unconditionally therefore replaced the composer with the "policy
      // could not be evaluated" panel on any transient blip. Only move the gate
      // when the poll actually carried a conversation payload, matching
      // refreshSafeguardingPolicy below. Nothing is loosened: show() returns
      // meta.conversation on every response including this poll, so a real
      // revocation still arrives here and still locks.
      const pollConversationMeta = response.success
        ? (response.meta?.conversation as ConversationMeta | undefined)
        : undefined;
      if (pollConversationMeta) {
        applySafeguardingMeta(pollConversationMeta.safeguarding, 'background');
      }

      if (response.success && response.data && response.data.length > 0) {
        const newMessages = response.data;

        // Update the last message ID
        const lastNewMsg = newMessages[newMessages.length - 1];
        if (lastNewMsg) lastMessageIdRef.current = lastNewMsg.id;

        // Append new messages to the conversation
        setConversation((prev) => {
          if (!prev) return null;

          // Filter out any duplicates (by ID)
          const existingIds = new Set(prev.messages.map((m) => m.id));
          const uniqueNewMessages = newMessages.filter((m) => !existingIds.has(m.id));

          if (uniqueNewMessages.length === 0) return prev;

          return {
            ...prev,
            messages: [...prev.messages, ...uniqueNewMessages],
          };
        });
      }
    } catch {
      // Silent fail for polling - don't spam console
    }
  }, [applySafeguardingMeta, targetId]);

  // Memoize loadConversation
  const loadConversation = useCallback(async () => {
    if (!targetId) return;

    // Clear auto-translate state from previous conversation
    if (autoTranslateAbortRef.current) {
      autoTranslateAbortRef.current.abort();
      autoTranslateAbortRef.current = null;
    }
    setAutoTranslations(new Map());
    translatedIdsRef.current.clear();
    autoTranslatingRef.current = false;

    try {
      setIsLoading(true);
      setIsNewConversation(false);

      // ALWAYS try to load existing messages from the API first, regardless
      // of whether this is the /messages/new/:userId or /messages/:id route.
      // This prevents the recurring regression where refreshing a "new" conversation
      // URL wiped all chat history because it skipped the API call entirely.
      const response = await api.get<Message[]>(`/v2/messages/${targetId}`);
      const meta = response.meta;
      if (response.success && response.data && meta?.conversation) {
        const messages = response.data as Message[];

        // API returns messages in descending order (newest first).
        // Reverse to chronological order (oldest first) for chat display.
        const chronologicalMessages = [...messages].reverse();

        const conversationMeta = meta.conversation as ConversationMeta;
        setConversation({
          meta: conversationMeta,
          messages: chronologicalMessages,
        });

        // Surface the server-authoritative safeguarding restriction immediately, so the
        // panel shows and the composer is disabled before the member types. Page load
        // never alerts staff — only an actual send or an explicit coordinator request does.
        applySafeguardingMeta(conversationMeta.safeguarding);

        // Track pagination state from response
        setPagination({
          olderCursor: meta.cursor || null,
          newerCursor: null,
          hasOlderMessages: meta.has_more || false,
          hasNewerMessages: false,
        });

        // Track the newest message ID for polling (last in chronological = newest)
        if (chronologicalMessages.length > 0) {
          const newestMsg = chronologicalMessages[chronologicalMessages.length - 1];
          if (newestMsg) lastMessageIdRef.current = newestMsg.id;
        }

        // If we're on the /messages/new/ route but messages exist, redirect to
        // the canonical /messages/:id URL so refreshes continue to work correctly.
        if (isNewConversationRoute && chronologicalMessages.length > 0) {
          navigate(tenantPath(`/messages/${targetId}`), { replace: true });
        }

        // Scroll to bottom on initial load
        setTimeout(() => scrollToBottom(), 100);
      } else if (response.success && response.data && response.data.length > 0) {
        // Fallback: messages loaded but meta.conversation missing — recover gracefully
        const messages = [...(response.data as Message[])].reverse();
        setConversation({
          meta: { id: parseInt(targetId, 10), other_user: { id: parseInt(targetId, 10), name: '' } },
          messages,
        });
        applySafeguardingMeta(undefined);
        if (messages.length > 0) {
          const newestMsg = messages[messages.length - 1];
          if (newestMsg) lastMessageIdRef.current = newestMsg.id;
        }
        if (isNewConversationRoute) {
          navigate(tenantPath(`/messages/${targetId}`), { replace: true });
        }
        setTimeout(() => scrollToBottom(), 100);
      } else {
        // No existing messages — this is genuinely a new conversation.
        // Load user profile to show their info in the empty chat view.
        await loadUserForNewConversation(parseInt(targetId, 10));
        applySafeguardingMeta(undefined);
      }
    } catch (error) {
      // API returned error (e.g., 404 for unknown user) — try new conversation fallback
      logError('Failed to load conversation, trying new conversation', error);
      applySafeguardingMeta(undefined);
      await loadUserForNewConversation(parseInt(targetId, 10));
    } finally {
      setIsLoading(false);
    }
  }, [applySafeguardingMeta, targetId, isNewConversationRoute, loadUserForNewConversation, navigate, tenantPath]);

  // Cleanup ref for unmount guard
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoTranslateAbortRef.current) {
        autoTranslateAbortRef.current.abort();
        autoTranslateAbortRef.current = null;
      }
    };
  }, []);

  // Load initial conversation
  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // Mark conversation as read when it loads and when new messages arrive
  useEffect(() => {
    if (!conversation?.messages?.length || !targetId) return;

    // Find unread messages from the other user
    const unreadMessages = conversation.messages.filter(
      (msg) => msg.sender_id !== user?.id && !msg.is_read && !msg.read_at
    );

    if (unreadMessages.length === 0) return;

    // Mark the conversation as read via the API and refresh global unread badge
    api.put(`/v2/messages/${targetId}/read`).then(() => {
      refreshCounts().catch(() => { /* non-critical */ });
    }).catch((err) => {
      logError('Failed to mark conversation as read', err);
    });

    // Update local state to reflect read status
    setConversation((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.sender_id !== user?.id
            ? { ...msg, is_read: true, read_at: new Date().toISOString() }
            : msg
        ),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- messages.length is sufficient; including messages ref causes double-fire
  }, [conversation?.messages?.length, targetId, user?.id]);

  // Fetch messaging restriction status (broker monitoring + supporter-view
  // disclosure for THIS pair — partner_id makes the response pair-aware).
  const refreshRestrictionStatus = useCallback(() => {
    api.get<{
      messaging_disabled: boolean;
      under_monitoring: boolean;
      restriction_reason: string | null;
      review_notice_required?: boolean;
      supporter_view_notice_required?: boolean;
      own_messages_shared?: boolean;
    }>(
      targetId ? `/v2/messages/restriction-status?partner_id=${targetId}` : '/v2/messages/restriction-status'
    ).then((res) => {
      if (isMountedRef.current && res.success && res.data) {
        setMessagingRestriction(res.data);
      }
    }).catch(() => { /* non-critical */ });
  }, [targetId]);

  useEffect(() => {
    refreshRestrictionStatus();
  }, [refreshRestrictionStatus]);

  useEffect(() => {
    setSafeguardingBlockNotice(null);
    setSafeguardingPolicyStatus('unavailable');
    setCoordinatorRequestSent(false);
    setVettingReviewRequested(false);
  }, [targetId]);

  /**
   * Explicitly ask a coordinator/broker to help arrange contact. This — not opening
   * the conversation — is the action that alerts staff. The server re-checks the
   * restriction, so it is a safe no-op if contact is actually permitted.
   */
  const requestCoordinatorHelp = useCallback(async () => {
    if (!targetId || isRequestingCoordinator || coordinatorRequestSent) return;
    try {
      setIsRequestingCoordinator(true);
      const response = await api.post(`/v2/messages/${targetId}/request-coordinator`, {});
      if (response.success) {
        setCoordinatorRequestSent(true);
        toast.success(t('coordinator_request.success_title'), t('coordinator_request.success_body'));
      } else {
        toast.error(t('error_title'), response.error || t('coordinator_request.error'));
      }
    } catch (error) {
      logError('Failed to request coordinator help', error);
      toast.error(t('error_title'), t('coordinator_request.error'));
    } finally {
      setIsRequestingCoordinator(false);
    }
  }, [targetId, isRequestingCoordinator, coordinatorRequestSent, toast, t]);

  const requestVettingReview = useCallback(async () => {
    if (isRequestingVettingReview || vettingReviewRequested) return;
    setIsRequestingVettingReview(true);
    try {
      const response = await api.post('/v2/safeguarding/vetting-review-request');
      if (response.success) {
        setVettingReviewRequested(true);
        toast.success(t('vetting_review_request.success_title'), t('vetting_review_request.success_body'));
      } else {
        toast.error(t('error_title'), response.error || t('vetting_review_request.error'));
      }
    } catch (error) {
      logError('Failed to request safeguarding vetting review', error);
      toast.error(t('error_title'), t('vetting_review_request.error'));
    } finally {
      setIsRequestingVettingReview(false);
    }
  }, [isRequestingVettingReview, t, toast, vettingReviewRequested]);

  const refreshSafeguardingPolicy = useCallback(async (
    trigger: SafeguardingRefreshTrigger = 'authoritative',
  ) => {
    if (!targetId || safeguardingRefreshInFlightRef.current) return;
    safeguardingRefreshInFlightRef.current = true;
    setIsRefreshingSafeguarding(true);
    try {
      const cursor = lastMessageIdRef.current ? btoa(String(lastMessageIdRef.current)) : null;
      const query = cursor
        ? `?direction=newer&cursor=${encodeURIComponent(cursor)}&per_page=1`
        : '?per_page=1';
      const response = await api.get<Message[]>(`/v2/messages/${targetId}${query}`);
      const refreshedMeta = response.meta?.conversation as ConversationMeta | undefined;
      applySafeguardingMeta(response.success ? refreshedMeta?.safeguarding : undefined, trigger);
    } catch {
      // Fail closed regardless of trigger: 'unavailable' is never held back.
      applySafeguardingMeta(undefined, trigger);
    } finally {
      safeguardingRefreshInFlightRef.current = false;
      setIsRefreshingSafeguarding(false);
    }
  }, [applySafeguardingMeta, targetId]);

  useEffect(() => {
    if (!targetId || isLoading) return;

    // The member coming back to the tab is an explicit re-ask, so these may clear
    // a send-time denial.
    const handleFocus = () => { void refreshSafeguardingPolicy('authoritative'); };
    const handleVisibility = () => {
      if (!document.hidden) void refreshSafeguardingPolicy('authoritative');
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isLoading, refreshSafeguardingPolicy, targetId]);

  // A recipient can withdraw a safeguarding contact preference while someone
  // else already has their conversation open. Message polling does not run for
  // an empty thread because there is no cursor, so recheck a blocked policy on
  // its own short interval. This lets the composer unlock promptly without a
  // page reload or a misleading member-side vetting-review request.
  useEffect(() => {
    if (!targetId
      || isLoading
      || !isDocumentVisible
      || safeguardingPolicyStatus === 'allow') {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshSafeguardingPolicy('background');
    }, SAFEGUARDING_RECHECK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [
    isDocumentVisible,
    isLoading,
    refreshSafeguardingPolicy,
    safeguardingPolicyStatus,
    targetId,
  ]);

  function handleSendFailure(response: MessageSendFailure, fallbackKey: string): void {
    const notice = extractSafeguardingBlockNotice(response);

    if (notice) {
      // Record provenance synchronously. The syncing effect only runs after
      // commit, and a background poll resolving inside that window would
      // otherwise see no send-sourced notice and clear this one immediately —
      // the exact behaviour this guard exists to prevent.
      safeguardingNoticeSourceRef.current = notice.source;
      setSafeguardingBlockNotice(notice);
      setSafeguardingPolicyStatus(notice.status);
      refreshRestrictionStatus();
      return;
    }

    toast.error(t('error_title'), response.error || t(fallbackKey));
    refreshRestrictionStatus();
  }

  // Set up polling (fallback when Pusher not available) - pause when tab hidden
  useEffect(() => {
    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Only poll if: document visible, not new conversation, and have messages loaded.
    // isLoading is in the deps so this re-evaluates once loadConversation has
    // populated lastMessageIdRef — otherwise polling never starts for an
    // existing conversation opened normally.
    if (!isDocumentVisible || isNewConversation || isLoading || !lastMessageIdRef.current) {
      return;
    }

    // When Pusher is connected, use a longer polling interval as a reliability fallback.
    // When disconnected, poll more frequently as it's the primary update mechanism.
    const interval = pusher?.isConnected ? 30000 : 5000;

    pollingIntervalRef.current = setInterval(() => {
      pollForNewMessages();
    }, interval);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [targetId, isNewConversation, isLoading, pusher?.isConnected, isDocumentVisible, pollForNewMessages]);

  // Scroll to bottom when messages change (only for new messages, not history).
  // When the user has scrolled up, count newly-arrived incoming messages so the
  // scroll-to-bottom button can badge them instead of yanking the view down.
  useEffect(() => {
    const messagesList = conversation?.messages;
    const newest = messagesList && messagesList.length > 0 ? messagesList[messagesList.length - 1] : null;
    const prevNewestId = prevNewestMessageIdRef.current;
    prevNewestMessageIdRef.current = newest?.id ?? null;

    const container = messagesContainerRef.current;
    if (!container || !newest) return;

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      scrollToBottom();
    } else if (
      prevNewestId !== null
      && newest.id !== prevNewestId
      && messagesList
    ) {
      // Appended (not prepended-history) messages from the other user while scrolled up
      const incoming = messagesList.filter(
        (m) => m.id > prevNewestId && m.sender_id !== user?.id
      ).length;
      if (incoming > 0) {
        setUnseenCount((count) => count + incoming);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to message-list changes
  }, [conversation?.messages.length]);

  // Keyboard-aware thread: when the soft keyboard opens (offset grows) and the
  // user was reading the latest messages, keep the newest message in view as
  // the container shrinks.
  useEffect(() => {
    if (keyboardOffset > 0 && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        container?.scrollTo({ top: container.scrollHeight });
      });
    }
  }, [keyboardOffset]);

  // Fetch listing details if listing ID is provided
  useEffect(() => {
    if (!listingId) return;

    async function fetchListing() {
      try {
        const response = await api.get<{ id: number; title: string; type: string }>(`/v2/listings/${listingId}`);
        if (response.success && response.data) {
          setListing({
            id: response.data.id,
            title: response.data.title,
            type: response.data.type,
          });
        }
      } catch (error) {
        logError('Failed to fetch listing for message context', error);
      }
    }

    fetchListing();
  }, [listingId]);

  /**
   * Load older messages when user scrolls to top
   */
  const loadOlderMessages = useCallback(async () => {
    if (!targetId || !pagination.hasOlderMessages || isLoadingOlder || !pagination.olderCursor) return;

    try {
      setIsLoadingOlder(true);

      const response = await api.get<Message[]>(
        `/v2/messages/${targetId}?direction=older&cursor=${pagination.olderCursor}`
      );

      if (response.success && response.data) {
        // API returns older messages in descending order — reverse to chronological
        const olderMessages = [...response.data].reverse();

        // Update pagination state
        setPagination((prev) => ({
          ...prev,
          olderCursor: response.meta?.cursor || null,
          hasOlderMessages: response.meta?.has_more || false,
        }));

        // Prepend older messages (now in ascending order) before existing messages
        setConversation((prev) => {
          if (!prev) return null;

          // Filter out duplicates
          const existingIds = new Set(prev.messages.map((m) => m.id));
          const uniqueOlderMessages = olderMessages.filter((m) => !existingIds.has(m.id));

          if (uniqueOlderMessages.length === 0) return prev;

          return {
            ...prev,
            messages: [...uniqueOlderMessages, ...prev.messages],
          };
        });

        // Preserve scroll position after prepending
        const container = messagesContainerRef.current;
        if (container) {
          const scrollHeightBefore = container.scrollHeight;
          requestAnimationFrame(() => {
            const scrollHeightAfter = container.scrollHeight;
            container.scrollTop = scrollHeightAfter - scrollHeightBefore;
          });
        }
      }
    } catch (error) {
      logError('Failed to load older messages', error);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [targetId, pagination.hasOlderMessages, pagination.olderCursor, isLoadingOlder]);

  // Handle scroll: load older messages near the top, and track distance from
  // the bottom for the scroll-to-bottom button + auto-scroll bookkeeping.
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // If scrolled near top (within 50px), load older messages
    if (container.scrollTop < 50 && pagination.hasOlderMessages && !isLoadingOlder) {
      loadOlderMessages();
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 100;
    setShowScrollToBottom(distanceFromBottom > 300);
    if (distanceFromBottom < 100) {
      setUnseenCount(0);
    }
  }, [pagination.hasOlderMessages, isLoadingOlder, loadOlderMessages]);

  function scrollToBottom() {
    // Scroll the messages container directly rather than scrollIntoView:
    // scrollIntoView also scrolls every scrollable ancestor, and on phones the
    // page body scrolls too (the footer sits below the full-viewport thread),
    // which dragged the thread's app bar off-screen.
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }

  /**
   * Localized date-separator label between messages from different calendar
   * days: "Today", "Yesterday", else an Intl-formatted date. Returns null when
   * the message is on the same day as the previous one (no separator).
   */
  function getDateSeparatorLabel(message: Message, prevMessage: Message | null): string | null {
    const date = toMessageDate(message.created_at || message.sent_at);
    if (!date) return null;

    const prevDate = prevMessage ? toMessageDate(prevMessage.created_at || prevMessage.sent_at) : null;
    if (prevDate && isSameCalendarDay(date, prevDate)) return null;

    const now = new Date();
    if (isSameCalendarDay(date, now)) return t('date_today');

    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (isSameCalendarDay(date, yesterday)) return t('date_yesterday');

    return formatDate(message.created_at || message.sent_at || '', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
  }

  /**
   * Delete the conversation — 'self' hides from current user only; 'everyone' hides from both.
   */
  async function deleteConversation(scope: 'self' | 'everyone') {
    if (!targetId || isArchiving) return;

    try {
      setIsArchiving(true);
      const response = await api.delete(`/v2/messages/conversations/${targetId}?scope=${scope}`);

      if (response.success) {
        if (scope === 'everyone') {
          toast.success(t('conversation_deleted_everyone'), t('conversation_deleted_everyone_desc'));
        } else {
          toast.success(t('conversation_archived'), t('conversation_archived_desc'));
        }
        navigate(tenantPath('/messages'));
      } else {
        throw new Error(response.error || t('archive_failed'));
      }
    } catch (error) {
      logError('Failed to delete conversation', error);
      toast.error(t('error_title'), t('archive_failed'));
    } finally {
      setIsArchiving(false);
      setShowArchiveModal(false);
    }
  }

  // Track current previews in a ref so the unmount cleanup can revoke them
  // without re-running (and tearing down an in-progress recording) every time
  // the attachment list changes. Removal/send paths revoke their own URLs.
  const attachmentPreviewsRef = useRef(attachmentPreviews);
  attachmentPreviewsRef.current = attachmentPreviews;

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      // Stop any active recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      // Release microphone
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      // Clear recording interval
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      // Clear typing debounce timeout
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
      }
      // Revoke any remaining blob URLs
      attachmentPreviewsRef.current.forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); });
    };
  }, []);

  /**
   * Start voice recording
   */
  async function startRecording() {
    if (messagingRestriction?.messaging_disabled || safeguardingBlockNotice) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        // Stop all tracks to release the microphone
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      logError('Failed to start recording', error);
      toast.error(t('mic_required_title'), t('mic_required_subtitle'));
    }
  }

  /**
   * Stop voice recording
   */
  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  }

  /**
   * Cancel voice recording
   */
  function cancelRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setAudioBlob(null);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }

  /**
   * Send voice message
   */
  async function sendVoiceMessage() {
    if (!audioBlob || !targetId || isSending) return;
    if (safeguardingBlockNotice) return;
    if (messagingRestriction?.messaging_disabled) {
      toast.error(t('error'), t('messaging_restricted'));
      return;
    }

    try {
      setIsSending(true);

      // Create form data with audio file
      const formData = new FormData();
      formData.append('recipient_id', targetId);
      formData.append('voice_message', audioBlob, 'voice-message.webm');

      const response = await api.upload<Message>('/v2/messages/voice', formData);

      if (response.success && response.data) {
        const sentMessage = response.data;
        lastMessageIdRef.current = sentMessage.id;
        setSafeguardingBlockNotice(null);

        setConversation((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, sentMessage],
          };
        });

        // Clear the audio blob
        setAudioBlob(null);
        setRecordingTime(0);

        if (isNewConversation) {
          setIsNewConversation(false);
          navigate(tenantPath(`/messages/${targetId}`), { replace: true });
        }

        setTimeout(() => scrollToBottom(), 50);
      } else {
        handleSendFailure(response, 'voice_send_error');
      }
    } catch (error) {
      logError('Failed to send voice message', error);
      toast.error(t('error_title'), t('voice_send_error'));
      refreshRestrictionStatus();
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Handle message reaction (toggle)
   */
  async function handleReaction(messageId: number, emoji: string) {
    try {
      const response = await api.post<{ action: 'added' | 'removed' }>(`/v2/messages/${messageId}/reactions`, { emoji });

      if (response.success) {
        // Update the message's reactions locally
        setConversation((prev) => {
          if (!prev) return null;

          return {
            ...prev,
            messages: prev.messages.map((msg) => {
              if (msg.id !== messageId) return msg;

              const reactions = { ...(msg.reactions || {}) };
              const currentCount = reactions[emoji] || 0;

              if (response.data?.action === 'removed') {
                // Reaction was removed
                if (currentCount <= 1) {
                  delete reactions[emoji];
                } else {
                  reactions[emoji] = currentCount - 1;
                }
              } else if (response.data?.action === 'added') {
                // Reaction was added
                reactions[emoji] = currentCount + 1;
              } else {
                // Unknown/missing action — don't guess; leave counts unchanged
                return msg;
              }

              return { ...msg, reactions };
            }),
          };
        });
      }
    } catch (error) {
      logError('Failed to react to message', error);
    }
  }

  /**
   * Search messages in the current conversation
   */
  function handleSearch(query: string) {
    setSearchQuery(query);
    if (!query.trim() || !conversation) {
      setSearchResults([]);
      setCurrentSearchIndex(0);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matchingIds = conversation.messages
      .filter((msg) => (msg.body || msg.content || '').toLowerCase().includes(lowerQuery))
      .map((msg) => msg.id);

    setSearchResults(matchingIds);
    setCurrentSearchIndex(0);

    // Scroll to first result if found
    if (matchingIds.length > 0) {
      const firstId = matchingIds[0];
      if (firstId !== undefined) scrollToMessage(firstId);
    }
  }

  /**
   * Navigate to next/previous search result
   */
  function navigateSearchResult(direction: 'next' | 'prev') {
    if (searchResults.length === 0) return;

    let newIndex = currentSearchIndex;
    if (direction === 'next') {
      newIndex = (currentSearchIndex + 1) % searchResults.length;
    } else {
      newIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    }

    setCurrentSearchIndex(newIndex);
    const resultId = searchResults[newIndex];
    if (resultId !== undefined) scrollToMessage(resultId);
  }

  /**
   * Handle file selection for attachments
   */
  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 5 files at a time
    const newFiles = files.slice(0, 5 - attachments.length);

    // Create previews for images
    const newPreviews = newFiles.map((file) => {
      const isImage = file.type.startsWith('image/');
      return {
        file,
        preview: isImage ? URL.createObjectURL(file) : '',
        type: isImage ? 'image' as const : 'file' as const,
      };
    });

    setAttachments((prev) => [...prev, ...newFiles]);
    setAttachmentPreviews((prev) => [...prev, ...newPreviews]);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  /**
   * Remove an attachment
   */
  function removeAttachment(index: number) {
    // Revoke object URL if it's an image preview
    if (attachmentPreviews[index]?.preview) {
      URL.revokeObjectURL(attachmentPreviews[index].preview);
    }
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * Send message with attachments
   */
  async function sendMessageWithAttachments(e: FormEvent) {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !targetId || isSending) return;
    if (safeguardingBlockNotice) return;
    if (messagingRestriction?.messaging_disabled) {
      toast.error(t('error'), t('messaging_restricted'));
      return;
    }

    try {
      setIsSending(true);

      if (attachments.length > 0) {
        // Create form data with attachments
        const formData = new FormData();
        formData.append('recipient_id', targetId);
        formData.append('body', newMessage.trim());
        attachments.forEach((file) => {
          formData.append('attachments[]', file);
        });

        // Include listing ID if this is the first message in conversation
        if (listingId && isNewConversation) {
          formData.append('listing_id', listingId.toString());
        }

        // MS1: Include context if provided via URL params
        if (contextType && contextId && isNewConversation) {
          formData.append('context_type', contextType);
          formData.append('context_id', contextId.toString());
        }

        const response = await api.upload<Message>('/v2/messages', formData);

        if (response.success && response.data) {
          const sentMessage = response.data;
          lastMessageIdRef.current = sentMessage.id;
          setSafeguardingBlockNotice(null);

          setConversation((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              messages: [...prev.messages, sentMessage],
            };
          });

          // Clear form
          setNewMessage('');
          setAttachments([]);
          attachmentPreviews.forEach((p) => {
            if (p.preview) URL.revokeObjectURL(p.preview);
          });
          setAttachmentPreviews([]);

          if (isNewConversation) {
            setIsNewConversation(false);
            navigate(tenantPath(`/messages/${targetId}`), { replace: true });
          }

          setTimeout(() => scrollToBottom(), 50);
        } else {
          handleSendFailure(response, 'send_error');
        }
      } else {
        // Regular text message (no attachments)
        const payload: Record<string, unknown> = {
          recipient_id: parseInt(targetId, 10),
          body: newMessage.trim(),
        };

        // Include listing ID if this is the first message in conversation
        if (listingId && isNewConversation) {
          payload.listing_id = listingId;
        }

        // MS1: Include context if provided via URL params
        if (contextType && contextId && isNewConversation) {
          payload.context_type = contextType;
          payload.context_id = contextId;
        }

        const response = await api.post<Message>('/v2/messages', payload);

        if (response.success && response.data) {
          const sentMessage = response.data;
          lastMessageIdRef.current = sentMessage.id;
          setSafeguardingBlockNotice(null);

          setConversation((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              messages: [...prev.messages, sentMessage],
            };
          });
          setNewMessage('');

          if (isNewConversation) {
            setIsNewConversation(false);
            // Redirect to the canonical conversation URL so refreshes load
            // message history from the API instead of showing empty state.
            navigate(tenantPath(`/messages/${targetId}`), { replace: true });
          }

          setTimeout(() => scrollToBottom(), 50);
        } else {
          if (!response.code || !EXPECTED_SEND_FAILURE_CODES.has(response.code)) {
            logError('Message send failed', response);
          }
          handleSendFailure(response, 'send_error');
        }
      }
    } catch (error) {
      logError('Failed to send message', error);
      toast.error(t('error_title'), t('send_error'));
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Send a GIF as a message (body contains the GIF URL)
   */
  async function handleGifSelect(gifUrl: string) {
    if (!targetId || isSending) return;
    if (safeguardingBlockNotice) return;
    if (messagingRestriction?.messaging_disabled) {
      toast.error(t('error'), t('messaging_restricted'));
      return;
    }

    try {
      setIsSending(true);
      const payload: Record<string, unknown> = {
        recipient_id: parseInt(targetId, 10),
        body: gifUrl,
      };

      if (listingId && isNewConversation) {
        payload.listing_id = listingId;
      }
      if (contextType && contextId && isNewConversation) {
        payload.context_type = contextType;
        payload.context_id = contextId;
      }

      const response = await api.post<Message>('/v2/messages', payload);

      if (response.success && response.data) {
        const sentMessage = response.data;
        lastMessageIdRef.current = sentMessage.id;
        setSafeguardingBlockNotice(null);

        setConversation((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, sentMessage],
          };
        });

        if (isNewConversation) {
          setIsNewConversation(false);
          navigate(tenantPath(`/messages/${targetId}`), { replace: true });
        }

        setTimeout(() => scrollToBottom(), 50);
      } else {
        if (!response.code || !EXPECTED_SEND_FAILURE_CODES.has(response.code)) {
          logError('GIF message send failed', response);
        }
        handleSendFailure(response, 'send_error');
      }
    } catch (error) {
      logError('Failed to send GIF message', error);
      toast.error(t('error_title'), t('send_error'));
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Start editing a message
   */
  function startEditing(message: Message) {
    setEditingMessageId(message.id);
    setEditingText(message.body || message.content || '');
  }

  /**
   * Cancel editing
   */
  function cancelEditing() {
    setEditingMessageId(null);
    setEditingText('');
  }

  /**
   * Save edited message
   */
  async function saveEdit() {
    if (!editingMessageId || !editingText.trim()) return;

    try {
      const response = await api.put<Message>(`/v2/messages/${editingMessageId}`, {
        body: editingText.trim(),
      });

      if (response.success) {
        setConversation((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.id === editingMessageId
                ? { ...msg, body: editingText.trim(), is_edited: true }
                : msg
            ),
          };
        });
        cancelEditing();
        toast.success(t('message_updated'), t('message_updated_subtitle'));
      } else {
        toast.error(t('error_title'), response.error || t('edit_error'));
      }
    } catch (error) {
      logError('Failed to edit message', error);
      toast.error(t('error_title'), t('edit_error'));
    }
  }

  /**
   * Execute a scoped message delete after the user picks an option in the modal.
   */
  async function executeDelete(scope: 'self' | 'everyone') {
    if (pendingDeleteId === null) return;
    const messageId = pendingDeleteId;
    setPendingDeleteId(null);

    try {
      const response = await api.delete(`/v2/messages/${messageId}?scope=${scope}`);

      if (response.success) {
        if (scope === 'self') {
          // Remove from this user's view entirely
          setConversation((prev) => {
            if (!prev) return null;
            return { ...prev, messages: prev.messages.filter((msg) => msg.id !== messageId) };
          });
          toast.success(t('message_removed_self'), t('message_removed_self_subtitle'));
        } else {
          // Show deleted placeholder to both parties
          setConversation((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              messages: prev.messages.map((msg) =>
                msg.id === messageId
                  ? { ...msg, body: t('message_deleted_placeholder'), is_deleted: true }
                  : msg
              ),
            };
          });
          toast.success(t('message_deleted'), t('message_deleted_subtitle'));
        }
      } else {
        toast.error(t('error_title'), response.error || t('delete_error'));
      }
    } catch (error) {
      logError('Failed to delete message', error);
      toast.error(t('error_title'), t('delete_error'));
    }
  }

  // Feature gate: redirect if messages module is disabled for this tenant
  if (!hasModule('messages')) {
    return <Navigate to={tenantPath('/')} replace />;
  }

  if (isLoading) {
    return <LoadingScreen message={t('loading')} />;
  }

  if (!conversation) {
    return (
      <div className="mx-auto flex min-h-[50dvh] w-full max-w-3xl items-center justify-center px-4">
        <PageMeta title={t('page_meta.conversation.title')} noIndex />
        <GlassCard role="alert" className="w-full p-6 text-center sm:p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-[var(--color-warning)]">
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-theme-primary">{t('load_error_title')}</h3>
          <p className="mx-auto mb-5 max-w-md text-sm text-theme-muted">{t('conversation_load_failed')}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              variant="secondary"
              className="bg-theme-elevated text-theme-muted"
              onPress={() => navigate(tenantPath('/messages'))}
            >
              {t('back_to_messages')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              onPress={() => loadConversation()}
            >
              {t('try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  const { meta, messages } = conversation;
  const other_user = meta.other_user;
  const safeguardingRequiredVettingLabels = safeguardingBlockNotice?.requiredVettingLabels.length
    ? safeguardingBlockNotice.requiredVettingLabels
    : safeguardingBlockNotice?.requiredVettingTypes
        .map((type) => CONTROLLED_VETTING_TRANSLATION_KEYS[type])
        .filter((key): key is string => Boolean(key))
        .map((key) => t(key)) ?? [];
  // Prefer live canonical presence (populated by the fetch effect above) over the
  // is_online snapshot from the initial payload. Fall back to is_online when the
  // participant isn't cached yet — the backend keeps that column fresh off the
  // presence heartbeat, so it is no longer permanently stale.
  const cachedPresence = presence?.onlineUsers.has(other_user.id)
    ? presence.getPresence(other_user.id)
    : null;
  const effectiveOnline = cachedPresence
    ? cachedPresence.status !== 'offline'
    : other_user.is_online;
  const statusLabel = effectiveOnline === undefined
    ? null
    : effectiveOnline ? t('online_status') : t('offline_status');

  return (
    <div
      // --keyboard-offset is genuinely dynamic (visualViewport-driven): iOS
      // Safari does not shrink 100dvh when the soft keyboard opens, so the
      // thread must subtract the keyboard inset itself to keep the composer
      // visible. 0px on desktop / when the keyboard is closed.
      //
      // Mobile height reclaims the space of the bottom tab bar, which is
      // route-hidden on conversation threads (see MobileTabBar
      // hiddenRoutePatterns). On phones/tablets (<768px) the site header is
      // hidden too — data-immersive-thread drives body:has() CSS in index.css
      // that removes the navbar and gives the thread the full viewport; the
      // 3rem/4rem terms below only apply from md: up where the navbar stays.
      // The composer handles safe-area-bottom itself.
      data-immersive-thread=""
      // Structural hook for the E2E suite. Deliberately separate from
      // `data-immersive-thread` above: that one exists to drive `body:has()` CSS
      // and could reasonably change with the layout, whereas this one means
      // "the conversation thread rendered" and must stay stable.
      data-message-thread=""
      style={{ '--keyboard-offset': `${keyboardOffset}px` } as CSSProperties}
      className="-my-6 mx-auto flex h-[calc(100dvh-var(--safe-area-top)-3rem-var(--keyboard-offset,0px))] min-h-0 w-full max-w-4xl flex-col gap-3 sm:-my-8 sm:gap-4 md:h-[calc(100dvh-var(--safe-area-top)-4rem-var(--keyboard-offset,0px))]"
    >
      <PageMeta title={t('page_meta.conversation.title')} noIndex />
      {/* Header */}
      <GlassCard className="shrink-0 overflow-hidden p-3 sm:p-4">
        <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              className="shrink-0 text-theme-muted data-[hover=true]:bg-theme-elevated"
              onPress={() => navigate(tenantPath('/messages'))}
              aria-label={t('aria_back')}
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Button>

            <Link
              to={tenantPath(`/profile/${other_user.id}`)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]"
            >
              <h1 className="sr-only">{t('conversation_with', { name: other_user.name })}</h1>
              <div className="relative shrink-0">
                <Avatar
                  src={resolveAvatarUrl(other_user.avatar_url || other_user.avatar)}
                  name={other_user.name}
                  size="md"
                  className="ring-2 ring-white/20" />
                {effectiveOnline !== undefined && (
                  <span
                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[var(--color-surface)] ${effectiveOnline ? 'bg-success' : 'bg-muted'}`}
                    aria-label={statusLabel ?? undefined}
                    role={statusLabel ? 'img' : undefined} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {other_user.name ? (
                    <h2 className="min-w-0 truncate text-base font-semibold leading-6 text-theme-primary sm:text-lg">{other_user.name}</h2>
                  ) : (
                    <Skeleton className="rounded-md">
                      <div className="h-4 w-32 rounded-md bg-surface-tertiary" />
                    </Skeleton>
                  )}
                  {/* Phones get a compact icon so the name never wraps; the
                      trust label moves to the status line below. Desktop keeps
                      the labeled chip row (badge design rule: never icon-only
                      without an adjacent text label). */}
                  {otherUserBadgesLoaded && (
                    otherUserIdVerified ? (
                      <ShieldCheck
                        className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 sm:hidden"
                        role="img"
                        aria-label={t('common:verification.badge.id_verified')}
                      />
                    ) : (
                      <ShieldOff
                        className="h-3.5 w-3.5 shrink-0 text-theme-muted sm:hidden"
                        role="img"
                        aria-label={t('common:verification.not_id_verified')}
                      />
                    )
                  )}
                  {otherUserBadgesLoaded && (
                    <span className="hidden min-w-0 sm:block">
                      <VerificationBadgeRow badges={otherUserBadges} size="sm" />
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-2">
                  {statusLabel && (
                    <span className="shrink-0 text-xs font-medium text-theme-subtle">{statusLabel}</span>
                  )}
                  {otherUserBadgesLoaded && (
                    <span
                      className={`shrink-0 text-xs font-medium sm:hidden ${
                        otherUserIdVerified
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-theme-muted'
                      }`}
                    >
                      {statusLabel ? '· ' : ''}
                      {otherUserIdVerified
                        ? t('common:verification.badge.id_verified')
                        : t('common:verification.not_id_verified')}
                    </span>
                  )}
                  {other_user.tagline && (
                    <p className="hidden min-w-0 truncate text-xs text-theme-subtle sm:block">{other_user.tagline}</p>
                  )}
                </div>
              </div>
            </Link>
          </div>

          <div className="flex max-w-[44vw] shrink-0 items-center justify-end gap-1 sm:max-w-none sm:gap-2">
            <Button
              isIconOnly
              variant="secondary"
              size="sm"
              className={`hidden sm:flex bg-theme-elevated text-theme-muted ${showSearch ? 'ring-1 ring-accent/40 text-accent' : ''}`}
              aria-label={t('aria_search_messages')}
              aria-expanded={showSearch}
              onPress={() => setShowSearch(!showSearch)}
            >
              <Search className="w-4 h-4" />
            </Button>

            {/* Auto-translate toggle */}
            {translationFeatureEnabled && (
              <Tooltip content={autoTranslateOn ? t('auto_translate.tooltip_on') : t('auto_translate.tooltip_off')}>
                <Button
                  isIconOnly
                  variant="secondary"
                  size="sm"
                  className={autoTranslateOn
                    ? 'hidden sm:flex bg-accent/20 text-accent ring-1 ring-accent/30'
                    : 'hidden sm:flex bg-theme-elevated text-theme-muted'
                  }
                  aria-label={autoTranslateOn ? t('auto_translate.tooltip_on') : t('auto_translate.tooltip_off')}
                  onPress={handleAutoTranslateToggle}
                >
                  <Languages className="w-4 h-4" />
                </Button>
              </Tooltip>
            )}

            <Button
              isIconOnly
              variant="secondary"
              size="sm"
              className="hidden sm:flex bg-theme-elevated text-theme-muted"
              aria-label={t('aria_view_profile')}
              onPress={() => navigate(tenantPath(`/profile/${other_user.id}`))}
            >
              <Info className="w-4 h-4" aria-hidden="true" />
            </Button>

            <Dropdown>
              <DropdownTrigger>
                <Button
                  isIconOnly
                  variant="secondary"
                  size="sm"
                  className="bg-theme-elevated text-theme-muted"
                  aria-label={t('aria_more_options')}
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownTrigger>
              <DropdownMenu aria-label={t('aria_conversation_actions')}>
                {/* Phone-only rows: these actions live as header buttons from
                    sm: up; on phones they fold into this sheet to keep the
                    thread bar to a single ⋮ affordance. */}
                <DropdownItem
                  key="search_messages" id="search_messages"
                  className="sm:hidden"
                  startContent={<Search className="w-4 h-4" />}
                  onPress={() => setShowSearch(!showSearch)}
                >
                  {t('aria_search_messages')}
                </DropdownItem>
                {translationFeatureEnabled ? (
                  <DropdownItem
                    key="auto_translate" id="auto_translate"
                    className="sm:hidden"
                    startContent={<Languages className={`w-4 h-4 ${autoTranslateOn ? 'text-accent' : ''}`} />}
                    onPress={handleAutoTranslateToggle}
                  >
                    {autoTranslateOn ? t('auto_translate.menu_disable') : t('auto_translate.menu_enable')}
                  </DropdownItem>
                ) : null}
                <DropdownItem
                  key="view_profile" id="view_profile"
                  className="sm:hidden"
                  startContent={<Info className="w-4 h-4" />}
                  onPress={() => navigate(tenantPath(`/profile/${other_user.id}`))}
                >
                  {t('aria_view_profile')}
                </DropdownItem>
                <DropdownItem
                  key="delete_self" id="delete_self"
                  startContent={<Trash2 className="w-4 h-4" />}
                  className="text-danger"
                  onPress={() => { setDeleteScope('self'); setShowArchiveModal(true); }}
                >
                  {t('delete_conversation_for_me')}
                </DropdownItem>
                <DropdownItem
                  key="delete_everyone" id="delete_everyone"
                  startContent={<Trash2 className="w-4 h-4" />}
                  className="text-danger"
                  onPress={() => { setDeleteScope('everyone'); setShowArchiveModal(true); }}
                >
                  {t('delete_conversation_for_everyone')}
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>
      </GlassCard>

      {/* Search Bar */}
      {showSearch && (
        <GlassCard className="shrink-0 p-3">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center" role="search">
            <div className="relative min-w-0 flex-1">
              <SearchField
                placeholder={t('conversation_search_placeholder')}
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                aria-label={t('conversation_search_placeholder')}
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                }}
                autoFocus />
            </div>
            {searchResults.length > 0 && (
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="min-w-0 text-sm text-theme-subtle" aria-live="polite">
                  {t('search_result_count', { current: currentSearchIndex + 1, total: searchResults.length })}
                </span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  className="bg-theme-elevated text-theme-muted"
                  onPress={() => navigateSearchResult('prev')}
                  aria-label={t('aria_prev_result')}
                >
                  <ArrowLeft className="w-3 h-3" />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  className="bg-theme-elevated text-theme-muted"
                  onPress={() => navigateSearchResult('next')}
                  aria-label={t('aria_next_result')}
                >
                  <ArrowLeft className="w-3 h-3 rotate-180" />
                </Button>
              </div>
            )}
            <Button
              isIconOnly
              size="sm"
              variant="secondary"
              className="self-end bg-theme-elevated text-theme-muted sm:self-auto"
              onPress={() => {
                setShowSearch(false);
                setSearchQuery('');
                setSearchResults([]);
              }}
              aria-label={t('aria_close_search')}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </GlassCard>
      )}

      {/* Safeguarding / visibility notice. ONE banner, ONE cause-agnostic
          wording, for BOTH causes — broker review and supporter message
          access. Deliberate: distinct wording per cause would let a
          counterparty infer which applies, and therefore who has a
          supporter. Phones get a one-line pill that opens the full wording
          in a popover; sm: and up keep the dismissible full banner.
          Fail direction: review_notice_required defaults toward showing
          (!== false); the supporter flag adds, never subtracts. */}
      {!isSafeguardingDismissed
        && (messagingRestriction?.review_notice_required !== false
          || messagingRestriction?.supporter_view_notice_required === true) && (
        <>
          <div className="flex shrink-0 items-center justify-center sm:hidden">
            <div className="flex items-center gap-0.5 rounded-full bg-amber-500/10 pr-1">
              <Popover>
                <PopoverTrigger>
                  <Button
                    size="sm"
                    variant="tertiary"
                    className="h-7 min-h-7 gap-1.5 rounded-full px-3 text-xs font-medium text-amber-700 dark:text-amber-300"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('safeguarding_notice_compact')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent>
                  <div className="flex max-w-md items-start gap-3 p-4" role="alert">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <PopoverHeading className="text-sm font-semibold text-theme-primary">
                        {t('safeguarding_notice_compact')}
                      </PopoverHeading>
                      <p className="mt-1 text-sm text-theme-primary">{t('safeguarding_notice')}</p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                className="h-7 min-h-7 w-7 min-w-7 rounded-full text-amber-700 dark:text-amber-300"
                onPress={() => setIsSafeguardingDismissed(true)}
                aria-label={t('aria_dismiss_safeguarding')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="hidden shrink-0 items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:flex" role="alert">
            <AlertTriangle className="w-5 h-5 text-[var(--color-warning)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-theme-warning text-sm flex-1">
              {t('safeguarding_notice')}
            </p>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              className="text-[var(--color-warning)] hover:text-amber-700 dark:hover:text-amber-300 flex-shrink-0 -mt-0.5"
              onPress={() => setIsSafeguardingDismissed(true)}
              aria-label={t('aria_dismiss_safeguarding')}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}

      {/* The member's OWN reminder: their supporter can see this conversation.
          Their own fact, quiet and persistent (not dismissible with the
          banner), linking to where they can withdraw with one press. */}
      {messagingRestriction?.own_messages_shared === true && (
        <p className="shrink-0 text-center text-xs text-theme-muted" data-testid="own-messages-shared-reminder">
          {t('own_messages_shared_reminder')}{' '}
          <Link to={tenantPath('/settings?tab=linked-accounts')} className="underline">
            {t('own_messages_shared_manage')}
          </Link>
        </p>
      )}

      {safeguardingBlockNotice && (
        <div
          className="flex shrink-0 flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-start"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-[var(--color-error)]">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-theme-danger">
              {safeguardingBlockNotice.title || t(`${safeguardingBlockNotice.translationKey}.title`)}
            </p>
            <p className="mt-1 text-sm text-red-700/90 dark:text-red-200/90">
              {safeguardingBlockNotice.detail || safeguardingBlockNotice.message || t(`${safeguardingBlockNotice.translationKey}.body`)}
            </p>
            {safeguardingRequiredVettingLabels.length > 0 && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-xs font-medium uppercase tracking-wide text-red-700/80 dark:text-red-200/80">
                  {t('safeguarding_vetting_required.required_checks')}
                </span>
                <div className="flex flex-wrap gap-2">
                  {safeguardingRequiredVettingLabels.map((label) => (
                    <Chip
                      key={label}
                      size="sm"
                      variant="soft"
                      className="border border-red-500/20 bg-theme-surface text-red-700 dark:text-red-200"
                    >
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-3 text-xs text-red-700/80 dark:text-red-200/80">
              {t(`${safeguardingBlockNotice.translationKey}.contact_broker`)}
            </p>
            {coordinatorRequestSent && (
              <p
                className="mt-3 text-sm font-medium text-theme-success"
                role="status"
              >
                {t('coordinator_request.sent')}
              </p>
            )}
            {vettingReviewRequested && (
              <p className="mt-3 text-sm font-medium text-theme-success" role="status">
                {t('vetting_review_request.sent')}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
            {safeguardingBlockNotice.code === 'VETTING_REQUIRED' && (
              <Button
                size="sm"
                onPress={requestVettingReview}
                isPending={isRequestingVettingReview}
                isDisabled={vettingReviewRequested}
              >
                {t('vetting_review_request.button')}
              </Button>
            )}
            {safeguardingBlockNotice.canRequestCoordinator && (
              <Button
                size="sm"
                variant="secondary"
                onPress={requestCoordinatorHelp}
                isPending={isRequestingCoordinator}
                isDisabled={coordinatorRequestSent}
                aria-label={t('coordinator_request.aria_button')}
              >
                {t('coordinator_request.button')}
              </Button>
            )}
            <Button
              size="sm"
              variant="tertiary"
              className="bg-theme-elevated text-theme-primary"
              // Wrapped, not passed by reference: onPress hands the callback a
              // PressEvent, which would arrive as the trigger argument.
              onPress={() => { void refreshSafeguardingPolicy('authoritative'); }}
              isPending={isRefreshingSafeguarding}
            >
              {t('safeguarding_check_again')}
            </Button>
          </div>
        </div>
      )}

      {/* Translation feature hint — shown once, dismissible */}
      {translationFeatureEnabled && !translationHintDismissed && (
        <div className="flex shrink-0 items-start gap-3 rounded-lg border border-accent/20 bg-accent/10 p-3" role="status">
          <Languages className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 text-sm text-accent dark:text-accent">
            <p className="font-medium">{t('translate_hint.title')}</p>
            <p className="mt-0.5 opacity-80">{t('translate_hint.body')}</p>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            className="text-accent hover:text-accent dark:hover:text-accent flex-shrink-0 -mt-0.5"
            onPress={dismissTranslationHint}
            aria-label={t('translate_hint.dismiss')}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Auto-translate active indicator */}
      {translationFeatureEnabled && autoTranslateOn && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg bg-accent/10 px-3 py-2" role="status">
          <Languages className="w-4 h-4 text-accent flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-accent dark:text-accent flex-1">
            {t('auto_translate.active_banner')}
          </p>
          <Button
            size="sm"
            variant="tertiary"
            className="min-h-6 min-w-0 px-2 text-xs text-accent"
            onPress={handleAutoTranslateToggle}
          >
            {t('auto_translate.turn_off')}
          </Button>
        </div>
      )}

      {/* Listing Context Card */}
      {listing && (
        <GlassCard className="shrink-0 p-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-theme-muted mb-1">
                {t('regarding_context', { type: listing.type === 'offer' ? t('context_offer') : t('context_request') })}
              </p>
              <Link
                to={tenantPath(`/listings/${listing.id}`)}
                className="font-medium text-theme-heading hover:text-accent transition-colors"
              >
                {listing.title}
              </Link>
            </div>
          </div>
        </GlassCard>
      )}

      {/* MS1: Contextual Message Card — shows linked context from conversation meta or URL params */}
      {!listing && (conversation?.meta?.context_type && conversation?.meta?.context_id) && (
        <MessageContextCard
          contextType={conversation.meta.context_type}
          contextId={conversation.meta.context_id} />
      )}
      {!listing && !conversation?.meta?.context_type && contextType && contextId && (
        <MessageContextCard
          contextType={contextType}
          contextId={contextId} />
      )}

      {/* Messages */}
      <GlassCard className="flex min-h-0 flex-1 overflow-hidden flex-col bg-[var(--color-surface)]/90">
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={messagesContainerRef}
          className="min-h-0 flex-1 scroll-pb-6 space-y-4 overflow-y-auto p-3 [scrollbar-gutter:stable] sm:p-5"
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label={t('aria_messages_region', { name: other_user.name })}
        >
          {/* Loading indicator for older messages */}
          {isLoadingOlder && (
            <div className="flex justify-center py-2">
              <div role="status" aria-label={t('loading_older')} aria-busy="true">
                <Spinner size="md" aria-hidden="true" />
              </div>
            </div>
          )}

          {/* "Load more" indicator when there are older messages */}
          {pagination.hasOlderMessages && !isLoadingOlder && (
            <div className="flex justify-center py-2">
              <Button
                variant="secondary"
                size="sm"
                className="bg-theme-elevated text-sm text-theme-muted"
                onPress={loadOlderMessages}
                isLoading={isLoadingOlder}
              >
                {t('load_older_hint')}
              </Button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center px-4 text-center">
              <div className="relative mb-4">
                <Avatar
                  src={resolveAvatarUrl(other_user.avatar_url || other_user.avatar)}
                  name={other_user.name}
                  className="h-20 w-20 ring-4 ring-theme-default" />
                <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-theme-default bg-theme-card text-accent shadow-sm">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <Chip size="sm" variant="soft" className="mb-3 bg-theme-elevated text-theme-muted">
                {t('new_message')}
              </Chip>
              <h3 className="mb-1 max-w-full truncate text-lg font-semibold text-theme-primary">{other_user.name}</h3>
              <p className="max-w-sm text-sm leading-6 text-theme-subtle">
                {t('conversation_start', { name: other_user.name })}
              </p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {messages.map((message, index) => {
                const prevMessage = index > 0 ? messages[index - 1] ?? null : null;
                const dateSeparatorLabel = getDateSeparatorLabel(message, prevMessage);

                return (
                  <Fragment key={message.id}>
                    {dateSeparatorLabel && (
                      <div className="flex justify-center py-1" role="separator" aria-label={dateSeparatorLabel}>
                        <span className="rounded-full bg-theme-elevated px-3 py-1 text-xs font-medium text-theme-subtle">
                          {dateSeparatorLabel}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      id={`message-${message.id}`}
                      message={message}
                      isOwn={message.sender_id === user?.id}
                      showAvatar={
                        index === 0 ||
                        messages[index - 1]?.sender_id !== message.sender_id
                      }
                      otherUser={other_user}
                      onReact={handleReaction}
                      isHighlighted={searchResults.includes(message.id)}
                      highlightQuery={searchQuery}
                      onEdit={startEditing}
                      onDelete={(id) => setPendingDeleteId(id)}
                      isEditing={editingMessageId === message.id}
                      editingText={editingMessageId === message.id ? editingText : ''}
                      onEditingTextChange={setEditingText}
                      onSaveEdit={saveEdit}
                      onCancelEdit={cancelEditing}
                      autoTranslatedText={autoTranslations.get(message.id) ?? null} />
                  </Fragment>
                );
              })}
            </AnimatePresence>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll-to-bottom button — floats above the composer when the user
            has scrolled up into history; badges messages that arrive meanwhile */}
        {showScrollToBottom && (
          <div className="absolute bottom-3 end-3 z-20">
            <Badge
              content={unseenCount > 99 ? '99+' : unseenCount}
              color="danger"
              size="sm"
              placement="top-right"
              isInvisible={unseenCount === 0}
            >
              <Button
                isIconOnly
                radius="full"
                className="h-11 w-11 min-w-0 border border-theme-default bg-theme-elevated text-theme-primary shadow-lg backdrop-blur"
                onPress={() => {
                  setUnseenCount(0);
                  scrollToBottom();
                }}
                aria-label={unseenCount > 0
                  ? t('aria_scroll_to_bottom_unread', { count: unseenCount })
                  : t('aria_scroll_to_bottom')}
              >
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Badge>
          </div>
        )}
        </div>

        {/* Typing Indicator */}
        <div aria-live="polite" aria-atomic="true">
          {isOtherUserTyping && (
            <div className="border-t border-theme-default px-4 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm text-theme-subtle">
                <div className="flex gap-1" aria-hidden="true">
                  <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="min-w-0 truncate">{t('typing_indicator', { name: other_user.name })}</span>
              </div>
            </div>
          )}
        </div>

        {/* Message Input Area */}
        <MessageInputArea
          isDirectMessagingEnabled={isDirectMessagingEnabled}
          messagingRestriction={messagingRestriction}
          safeguardingPolicyStatus={safeguardingPolicyStatus}
          newMessage={newMessage}
          onNewMessageChange={setNewMessage}
          onSendMessage={sendMessageWithAttachments}
          isSending={isSending}
          onTypingIndicator={(value) => {
            if (targetId) {
              sendTypingIndicator(parseInt(targetId, 10), value.length > 0);
            }
          }}
          onBlurTypingStop={() => {
            if (pusher && targetId) {
              pusher.sendTyping(parseInt(targetId, 10), false);
            }
          }}
          isRecording={isRecording}
          recordingTime={recordingTime}
          audioBlob={audioBlob}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onCancelRecording={cancelRecording}
          onSendVoiceMessage={sendVoiceMessage}
          onClearAudioBlob={() => setAudioBlob(null)}
          attachments={attachments}
          attachmentPreviews={attachmentPreviews}
          fileInputRef={fileInputRef}
          onFileSelect={handleFileSelect}
          onRemoveAttachment={removeAttachment}
          onGifSelect={handleGifSelect} />
      </GlassCard>

      {/* Archive Confirmation Modal */}
      <Modal
        isOpen={showArchiveModal}
        onOpenChange={setShowArchiveModal}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {deleteScope === 'everyone'
              ? t('delete_conversation_for_everyone')
              : t('delete_conversation_for_me')}
          </ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {deleteScope === 'everyone'
                ? t('delete_conversation_everyone_prompt', { name: other_user.name })
                : t('delete_conversation_self_prompt', { name: other_user.name })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              className="bg-theme-elevated text-theme-muted"
              onPress={() => setShowArchiveModal(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={() => deleteConversation(deleteScope)}
              isLoading={isArchiving}
            >
              {t('delete_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Message Modal */}
      <Modal
        isOpen={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {t('delete_message_title')}
          </ModalHeader>
          <ModalBody>
            <p className="text-theme-muted text-sm">{t('delete_message_body')}</p>
          </ModalBody>
          <ModalFooter className="flex-col gap-2">
            <Button variant="danger-soft" fullWidth onPress={() => executeDelete('everyone')}>
              {t('delete_for_everyone')}
            </Button>
            <Button variant="secondary" fullWidth onPress={() => executeDelete('self')}>
              {t('delete_for_me')}
            </Button>
            <Button variant="tertiary" fullWidth onPress={() => setPendingDeleteId(null)}>
              {t('cancel')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default ConversationPage;
