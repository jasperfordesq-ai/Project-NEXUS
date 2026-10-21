// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { Accordion, AccordionItem, Card, CardBody } from '@/components/ui';
import BookOpen from 'lucide-react/icons/book-open';
import TriangleAlert from 'lucide-react/icons/triangle-alert';

interface PodcastStudioGuideProps {
  /** Upload size limit shown in the "upload it here" step. */
  maxAudioMb: number;
  /** Open every step for creators who have no show yet. */
  expandAll: boolean;
  /** Only mention the podcast-app (RSS) link when the community serves one. */
  rssEnabled: boolean;
}

const STEP_IDS = ['create', 'upload', 'link', 'publish', 'share'] as const;

/**
 * Plain-language walkthrough of the studio: make a show, add audio (upload it
 * here, or paste a DIRECT audio-file link from elsewhere), publish, share.
 *
 * The "link" step exists because creators paste page links (Spotify, SoundCloud,
 * Google Drive "share" links): the field accepts any https address, but a web
 * page cannot play in the player or be listed in a podcast feed.
 *
 * Labels the steps refer to (field names, chips, buttons) are interpolated from
 * their own keys, so every language quotes exactly what is on screen.
 */
export function PodcastStudioGuide({ maxAudioMb, expandAll, rssEnabled }: PodcastStudioGuideProps) {
  const { t } = useTranslation('podcasts');
  const labels = {
    public: t('visibility.public'),
    add_episode: t('studio.add_episode'),
    file_field: t('fields.audio_file'),
    url_field: t('fields.audio_url'),
    clean: t('studio.media_scan_status', { status: t('studio.media_status.clean') }),
    pending: t('moderation.pending'),
    validate: t('studio.validate_feed'),
    my_shows: t('studio.my_shows'),
  };

  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{t('studio.guide.title')}</h2>
        </div>
        <p className="text-sm text-muted">{t('studio.guide.intro')}</p>
        <Accordion
          selectionMode="multiple"
          variant="light"
          defaultExpandedKeys={expandAll ? [...STEP_IDS] : []}
        >
          <AccordionItem id="create" title={t('studio.guide.create_title')}>
            <p className="text-sm leading-relaxed">{t('studio.guide.create_body', labels)}</p>
          </AccordionItem>
          <AccordionItem id="upload" title={t('studio.guide.upload_title')}>
            <p className="text-sm leading-relaxed">{t('studio.guide.upload_body', { ...labels, max: maxAudioMb })}</p>
          </AccordionItem>
          <AccordionItem id="link" title={t('studio.guide.link_title')}>
            <div className="space-y-2 text-sm leading-relaxed">
              <p>{t('studio.guide.link_body', labels)}</p>
              <p>{t('studio.guide.link_test')}</p>
              {/* Foreground text on a tint: the warning colour alone is too pale for AA contrast. */}
              <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-foreground">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                <span>{t('studio.guide.link_wont_work')}</span>
              </p>
              <h3 className="pt-1 font-semibold">{t('studio.guide.where_title')}</h3>
              <p>{t('studio.guide.where_hosts')}</p>
              <p>{t('studio.guide.where_archive')}</p>
            </div>
          </AccordionItem>
          <AccordionItem id="publish" title={t('studio.guide.publish_title')}>
            <p className="text-sm leading-relaxed">{t('studio.guide.publish_body', labels)}</p>
          </AccordionItem>
          <AccordionItem id="share" title={t('studio.guide.share_title')}>
            <div className="space-y-2 text-sm leading-relaxed">
              <p>{t('studio.guide.share_where', labels)}</p>
              <ul className="list-disc space-y-1 ps-5">
                <li>{t('studio.guide.share_members')}</li>
                {rssEnabled && <li>{t('studio.guide.share_public', labels)}</li>}
              </ul>
            </div>
          </AccordionItem>
        </Accordion>
      </CardBody>
    </Card>
  );
}
