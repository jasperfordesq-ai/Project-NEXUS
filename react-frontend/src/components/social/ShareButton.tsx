// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ShareButton — Share content to feed or copy link.
 */

import { useState } from 'react';import Share2 from 'lucide-react/icons/share-2';
import Link2 from 'lucide-react/icons/link-2';
import Repeat2 from 'lucide-react/icons/repeat-2';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';

import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from '@/components/ui';
export interface ShareButtonProps {
  shareToFeed: (content?: string) => Promise<boolean>;
  title?: string;
  description?: string;
  className?: string;
  isAuthenticated: boolean;
  canShareToFeed?: boolean;
  shareToFeedDisabledReason?: string;
  /** Small, background-free trigger for a row of quiet actions. */
  quiet?: boolean;
}

export function ShareButton({
  shareToFeed,
  title,
  description,
  className = '',
  isAuthenticated,
  canShareToFeed = true,
  shareToFeedDisabledReason,
  quiet = false,
}: ShareButtonProps) {
  const { t } = useTranslation('social');
  const toast = useToast();
  const [isSharing, setIsSharing] = useState(false);

  const handleShareToFeed = async () => {
    if (!isAuthenticated || !canShareToFeed) return;
    setIsSharing(true);
    try {
      const ok = await shareToFeed();
      if (ok) {
        toast.success(t('shared_to_feed'));
      } else {
        toast.error(t('share_failed'));
      }
    } catch (err) {
      logError('Failed to share to feed', err);
      toast.error(t('share_failed'));
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t('link_copied'));
    } catch {
      toast.error(t('copy_failed'));
    }
  };

  const handleNativeShare = async () => {
    const shareData = {
      title: title ?? document.title,
      text: description?.slice(0, 100),
      url: window.location.href,
    };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          logError('Share failed', err);
        }
      }
    } else {
      await handleCopyLink();
    }
  };

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button
          variant={quiet ? 'ghost' : 'flat'}
          size={quiet ? 'sm' : undefined}
          className={`${quiet ? '' : 'bg-theme-elevated '}text-theme-primary ${className}`}
          startContent={<Share2 className="w-4 h-4" aria-hidden="true" />}
          isLoading={isSharing}
        >
          {t('share')}
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label={t('share_options')}>
        {isAuthenticated ? (
          <DropdownItem
            key="feed" id="feed"
            startContent={<Repeat2 className="w-4 h-4" aria-hidden="true" />}
            onPress={handleShareToFeed}
            isDisabled={!canShareToFeed}
          >
            {canShareToFeed ? t('share_to_feed') : (shareToFeedDisabledReason ?? t('cannot_share_own_content'))}
          </DropdownItem>
        ) : (
          <DropdownItem
            key="feed-disabled" id="feed-disabled"
            startContent={<Repeat2 className="w-4 h-4" aria-hidden="true" />}
            isDisabled
          >
            {t('login_to_share')}
          </DropdownItem>
        )}
        <DropdownItem
          key="link" id="link"
          startContent={<Link2 className="w-4 h-4" aria-hidden="true" />}
          onPress={handleNativeShare}
        >
          {t('copy_link')}
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}

export default ShareButton;
