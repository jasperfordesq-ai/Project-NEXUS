// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type Key, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tab, Tabs } from '@/components/ui/Tabs';
import {
  REACTION_EMOJI_MAP,
  REACTION_LABEL_MAP,
  type ReactionType,
} from './reactions';

export type SortedReactionTypes = Array<[string, number]>;

interface ReactorUser {
  id: number;
  name: string;
  avatar_url: string | null;
  reacted_at: string;
  reaction_type?: string;
}

/** The reactors endpoint's pseudo type for "everyone, whatever they chose". */
const ALL_TAB = 'all';

interface ReactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sortedTypes: SortedReactionTypes;
  total: number;
  entityType: string;
  entityId: number;
}

const renderEmoji = (type: string, label: string) => {
  if (type === 'time_credit') {
    return <Clock className="w-3 h-3 text-accent" role="img" aria-label={label} />;
  }

  return (
    <span role="img" aria-label={label}>
      {REACTION_EMOJI_MAP[type as ReactionType] ?? type}
    </span>
  );
};

export function ReactionDetailsModal({
  isOpen,
  onClose,
  sortedTypes,
  total,
  entityType,
  entityId,
}: ReactionDetailsModalProps) {
  const { t } = useTranslation(['feed', 'social', 'common']);
  const { tenantPath } = useTenant();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const reactionLabel = (type: string) => {
    const key = REACTION_LABEL_MAP[type as ReactionType];
    return key ? tr(key, type) : type;
  };
  const [selectedTab, setSelectedTab] = useState<string>(ALL_TAB);
  const [reactors, setReactors] = useState<ReactorUser[]>([]);
  const [isLoadingReactors, setIsLoadingReactors] = useState(false);
  const [reactorPage, setReactorPage] = useState(1);
  const [hasMoreReactors, setHasMoreReactors] = useState(false);
  // Only the newest request may fill the list: switching tabs quickly must not
  // let a slower earlier response overwrite the tab the member is looking at.
  const latestRequest = useRef(0);

  const loadReactors = useCallback(
    async (type: string, page = 1, append = false) => {
      const requestId = ++latestRequest.current;
      setIsLoadingReactors(true);
      try {
        // "All" is the same paginated list with no reaction filter. It used to
        // read the summary's three-name preview, which under-listed any post
        // with more than three reactions and stamped every row "now".
        const res = await api.get<ReactorUser[]>(
          `/v2/reactions/${entityType}/${entityId}/users/${encodeURIComponent(type)}?page=${page}&per_page=20`
        );
        if (requestId !== latestRequest.current) return;
        if (res.success && res.data) {
          const users = Array.isArray(res.data) ? res.data : [];
          setReactors((current) => (append ? [...current, ...users] : users));
          setHasMoreReactors(res.meta?.has_more ?? false);
        }
      } catch (err) {
        logError('Failed to load reactors', err);
      } finally {
        if (requestId === latestRequest.current) {
          setIsLoadingReactors(false);
        }
      }
    },
    [entityType, entityId]
  );

  useEffect(() => {
    if (!isOpen) return;

    setSelectedTab(ALL_TAB);
    setReactorPage(1);
    setReactors([]);
    void loadReactors(ALL_TAB, 1);
  }, [isOpen, loadReactors]);

  const handleTabChange = useCallback(
    (key: Key) => {
      const tabKey = String(key);
      setSelectedTab(tabKey);
      setReactorPage(1);
      setReactors([]);
      void loadReactors(tabKey, 1);
    },
    [loadReactors]
  );

  const handleLoadMore = useCallback(() => {
    const nextPage = reactorPage + 1;
    setReactorPage(nextPage);
    void loadReactors(selectedTab, nextPage, true);
  }, [reactorPage, selectedTab, loadReactors]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      scrollBehavior="inside"
      classNames={{
        base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)]',
        backdrop: 'bg-black/60 backdrop-blur-sm',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-3 pb-0 text-[var(--text-primary)]">
          <div className="flex -space-x-1" aria-hidden="true">
            {sortedTypes.slice(0, 3).map(([type]) => (
              <span
                key={type}
                className="w-7 h-7 rounded-full bg-[var(--surface-elevated)] border-2 border-[var(--glass-bg)] flex items-center justify-center text-sm"
              >
                {renderEmoji(type, reactionLabel(type))}
              </span>
            ))}
          </div>
          <ModalHeading>
            {tr('card.reactions_title', 'Reactions')} ({total})
          </ModalHeading>
        </ModalHeader>
        <ModalBody className="pb-4 pt-2">
          <Tabs
            aria-label={t('social:reactions_tabs_aria')}
            selectedKey={selectedTab}
            onSelectionChange={handleTabChange}
            variant="light"
            size="sm"
            classNames={{
              tabList: 'gap-1 flex-wrap',
              tab: 'text-xs px-2',
            }}
          >
            <Tab key={ALL_TAB} title={`${tr('card.all', 'All')} ${total}`} />
            {sortedTypes.map(([type, count]) => (
              <Tab
                key={type}
                title={
                  <span className="flex items-center gap-1">
                    {renderEmoji(type, reactionLabel(type))} {count}
                  </span>
                }
              />
            ))}
          </Tabs>

          <div className="mt-3">
            {isLoadingReactors && reactors.length === 0 ? (
              <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('common:loading')}>
                <Spinner size="md" />
              </div>
            ) : reactors.length === 0 ? (
              <p className="text-sm text-[var(--text-subtle)] text-center py-6 italic">
                {tr('card.no_reactions', 'No reactions yet')}
              </p>
            ) : (
              <div className="space-y-1">
                {reactors.map((reactor) => (
                  <Link
                    key={reactor.id}
                    to={tenantPath(`/profile/${reactor.id}`)}
                    onClick={onClose}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    <span className="relative shrink-0">
                      <Avatar
                        name={reactor.name}
                        src={resolveAvatarUrl(reactor.avatar_url)}
                        size="sm"
                        className="ring-2 ring-white/10"
                      />
                      {selectedTab === ALL_TAB && reactor.reaction_type && (
                        <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[var(--surface-dropdown)] border border-[var(--border-default)] flex items-center justify-center text-[11px] leading-none">
                          {renderEmoji(reactor.reaction_type, reactionLabel(reactor.reaction_type))}
                        </span>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {reactor.name}
                      </p>
                      {reactor.reacted_at && (
                        <p className="text-xs text-[var(--text-subtle)]">
                          {formatRelativeTime(reactor.reacted_at)}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}

                {hasMoreReactors && (
                  <div className="pt-2 text-center">
                    <Button
                      size="sm"
                      variant="flat"
                      className="bg-[var(--surface-elevated)] text-[var(--text-muted)]"
                      onPress={handleLoadMore}
                      isLoading={isLoadingReactors}
                    >
                      {tr('card.load_more', 'Load More')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default ReactionDetailsModal;
