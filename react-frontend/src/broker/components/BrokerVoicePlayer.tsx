// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Lets a broker hear a voice message in the conversation they are reviewing
 * (owner decision, 3 Oct 2026: a safety feature). The recording is fetched
 * only when the broker presses Play — every fetch is audit-logged on the
 * server, so opening the page must not count as listening — and it is held
 * in memory for this page only.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Play from 'lucide-react/icons/play';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface BrokerVoicePlayerProps {
  copyId: number | string;
  messageId: number;
}

export function BrokerVoicePlayer({ copyId, messageId }: BrokerVoicePlayerProps) {
  const { t } = useTranslation('broker');
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Release the in-memory recording when the broker leaves the page.
  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src);
  }, [src]);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const blob = await api.download(`/v2/admin/broker/messages/${copyId}/voice/${messageId}`);
      setSrc(URL.createObjectURL(blob));
    } catch (err) {
      logError('BrokerVoicePlayer.load', err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (src) {
    return (
      <audio
        controls
        autoPlay
        src={src}
        className="w-72 max-w-full"
        aria-label={t('messages.detail_voice_player_label')}
      />
    );
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="secondary"
        startContent={<Play size={14} aria-hidden="true" />}
        onPress={() => void load()}
        isLoading={loading}
      >
        {t('messages.detail_voice_play')}
      </Button>
      {failed ? (
        <p role="alert" className="text-xs text-danger">{t('messages.detail_voice_play_failed')}</p>
      ) : (
        <p className="text-xs text-muted">{t('messages.detail_voice_logged')}</p>
      )}
    </div>
  );
}

export default BrokerVoicePlayer;
