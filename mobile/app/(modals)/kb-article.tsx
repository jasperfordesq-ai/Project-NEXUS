// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Card as HeroCard } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import { getKbArticle, submitKbFeedback, type KbArticle } from '@/lib/api/resources';
import { API_V2 } from '@/lib/constants';
import { downloadAuthenticatedFile, SHARING_UNAVAILABLE } from '@/lib/volunteering/authenticatedFileDownload';
import { Button } from '@/components/ui/NativeButton';
import ErrorState from '@/components/ui/ErrorState';
import { isRefusal, isRefusalStatus } from '@/lib/api/refusal';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { buildWebUrl } from '@/lib/utils/webUrl';
import ArticleBody from '@/components/ui/ArticleBody';
import { useOpenExternalUrl } from '@/components/ui/useOpenExternalUrl';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';

function KbArticleScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const parsedId = /^\d+$/.test(rawId ?? '') ? Number(rawId) : NaN;
  const id = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : 0;
  return <KbArticleContent key={id} id={id} />;
}

function KbArticleContent({ id }: { id: number }) {
  const openExternal = useOpenExternalUrl();
  const { tenant } = useTenant();
  const { t } = useTranslation(['resources', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { data: article, isLoading, error, errorStatus, refresh } = useApi(() => getKbArticle(id), [id], { enabled: id > 0, clearOnRefusal: true });
  /*
    🔴 A refusal is not a failure. An article that was removed, or one this community does
    not share, answers 404 or 403 — and that was rendered as "could not load" with a Retry
    the member could press for ever. Found by the 2026-09-07 audit (F/F-8).
  */
  const refused = id === 0 || isRefusalStatus(errorStatus);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={!refused && article ? article.title : t('resources:articleTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/resources' as Href} />
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={isLoading && Boolean(article)} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        >
          <RefreshFailedNotice error={article && !refused ? error : null} onRetry={refresh} />
          {isLoading && !article ? (
            <View className="items-center justify-center py-14">
              <LoadingSpinner />
            </View>
          ) : refused ? (
            <EmptyState
              icon="lock-closed-outline"
              title={t('common:errors.notAvailableTitle')}
              subtitle={t('common:errors.notAvailableHint')}
              testID="kb-article-refused"
            />
          ) : !article ? (
            /* `error || !article` until 2026-09-09: a refresh that failed while the article
               was on screen replaced it with this empty state. The notice above carries the
               message now, and the article stays where the member was reading it. */
            <EmptyState
              icon={error ? 'warning-outline' : 'book-outline'}
              title={error ? t('resources:errorTitle') : t('resources:emptyTitle')}
              subtitle={error ? String(error) : undefined}
              actionLabel={error ? t('common:buttons.retry') : undefined}
              onAction={error ? refresh : undefined}
              testID="kb-article-error"
            />
          ) : (
            <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-12 items-center justify-center rounded-panel-inner bg-surface-secondary">
                    <Ionicons name="book-outline" size={24} color={theme.info} />
                  </View>
                  <View className="min-w-0 flex-1 gap-2">
                    <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                      {article.title}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {article.category_name ? <Chip size="sm" variant="secondary"><Chip.Label>{article.category_name}</Chip.Label></Chip> : null}
                      <Chip size="sm" variant="secondary">
                        <Chip.Label>{t('resources:views', { count: article.views_count ?? article.view_count ?? 0 })}</Chip.Label>
                      </Chip>
                    </View>
                  </View>
                </View>
                <ArticleBody content={article.content ?? article.content_preview ?? ''} contentType={article.content_type}
                  baseUrl={buildWebUrl(tenant?.slug, `/kb/${id}`)} />
                {article.video_url?.trim() ? (
                  <View className="gap-2">
                    <Button variant="secondary" onPress={() => void openExternal(article.video_url)}>
                      <Ionicons name="play-circle-outline" size={20} color={theme.info} />
                      <Button.Label>{t('resources:watchVideo')}</Button.Label>
                    </Button>
                    <Text style={{ color: theme.textSecondary }}>{t('resources:videoExternalHint')}</Text>
                  </View>
                ) : null}
                {article.attachments?.length ? <ArticleAttachments articleId={id} files={article.attachments} /> : null}
                <ArticleFeedback article={article} onRefresh={refresh} />
                {article.children?.length ? (
                  <View className="gap-3">
                    <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>{t('resources:relatedArticles')}</Text>
                    {article.children.map((child) => (
                      <Button key={child.id} variant="secondary" onPress={() => router.push({ pathname: '/(modals)/kb-article', params: { id: String(child.id) } } as Href)}>
                        <Button.Label>{child.title}</Button.Label>
                        <Ionicons name="chevron-forward-outline" size={18} color={theme.info} />
                      </Button>
                    ))}
                  </View>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function ArticleFeedback({ article, onRefresh }: { article: KbArticle; onRefresh: () => void }) {
  const { t } = useTranslation(['resources', 'common']);
  const theme = useTheme();
  const mounted = useRef(true);
  const pending = useRef(false);
  const currentArticle = useRef(article);
  const [saved, setSaved] = useState(article);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ choice: boolean; refused: boolean } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    currentArticle.current = article;
    setSaved(article);
    setFailure(null);
    setConfirmed(false);
  }, [article]);

  async function vote(choice: boolean) {
    if (!mounted.current || pending.current || failure?.refused) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    setConfirmed(false);
    try {
      const result = await submitKbFeedback(article.id, choice);
      if (!mounted.current) return;
      if (currentArticle.current !== article) {
        onRefresh();
        return;
      }
      setSaved(result);
      setConfirmed(true);
    } catch (error) {
      if (mounted.current && currentArticle.current === article) {
        setFailure({ choice, refused: isRefusal(error) });
        if (isRefusal(error)) onRefresh();
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      <Text accessibilityRole="header" style={{ color: theme.text }}>{t('resources:feedback.question')}</Text>
      {failure?.refused ? <EmptyState icon="lock-closed-outline" title={t('common:errors.notAvailableTitle')} /> : (
        <View className="flex-row flex-wrap gap-3">
          {[true, false].map((choice) => (
            <Button key={String(choice)} variant={saved.my_feedback === choice ? 'primary' : 'secondary'}
              accessibilityLabel={`${t(choice ? 'resources:feedback.yes' : 'resources:feedback.no')} (${choice ? saved.helpful_yes ?? 0 : saved.helpful_no ?? 0})`}
              isDisabled={busy} accessibilityState={{ selected: saved.my_feedback === choice, disabled: busy, busy }}
              onPress={() => void vote(choice)}>
              <Button.Label>{t(choice ? 'resources:feedback.yes' : 'resources:feedback.no')} ({choice ? saved.helpful_yes ?? 0 : saved.helpful_no ?? 0})</Button.Label>
            </Button>
          ))}
        </View>
      )}
      {confirmed ? <Text accessibilityLiveRegion="polite" style={{ color: theme.textSecondary }}>{t('resources:feedbackThanks')}</Text> : null}
      {failure && !failure.refused ? <ErrorState title={t('resources:feedbackFailed')} onRetry={() => void vote(failure.choice)} /> : null}
    </View>
  );
}

function ArticleAttachments({ articleId, files }: { articleId: number; files: NonNullable<KbArticle['attachments']> }) {
  const navigation = useNavigation();
  const focusGeneration = useRef(0);
  useEffect(() => navigation.addListener('blur', () => { focusGeneration.current += 1; }), [navigation]);
  const { t } = useTranslation(['resources', 'common']);
  const theme = useTheme();
  const mounted = useRef(true);
  const pending = useRef(false);
  const currentFiles = useRef(files);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [unavailableIds, setUnavailableIds] = useState<Set<number>>(() => new Set());
  const [failure, setFailure] = useState<{ file: typeof files[number]; message: string; refused: boolean } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    currentFiles.current = files;
    setUnavailableIds(new Set());
    setFailure(null);
  }, [files]);

  async function download(file: typeof files[number]) {
    if (!mounted.current || pending.current || unavailableIds.has(file.id)) return;
    const generation = focusGeneration.current;
    pending.current = true;
    setBusyId(file.id);
    setFailure(null);
    try {
      await downloadAuthenticatedFile(`${API_V2}/kb/${articleId}/attachments/${file.id}/download`, file.file_name, {}, {
        isActive: () => mounted.current && focusGeneration.current === generation,
      });
    } catch (error) {
      if (focusGeneration.current !== generation) return;
      if (mounted.current && currentFiles.current === files && isRefusal(error)) setUnavailableIds((ids) => new Set(ids).add(file.id));
      if (mounted.current && currentFiles.current === files) setFailure({ file, refused: isRefusal(error), message: t(error instanceof Error && error.message === SHARING_UNAVAILABLE
        ? 'resources:sharingUnavailable' : 'resources:downloadFailed') });
    } finally {
      pending.current = false;
      if (mounted.current) setBusyId(null);
    }
  }
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>{t('resources:attachments')}</Text>
      {files.filter((file) => !unavailableIds.has(file.id)).map((file) => (
        <Button key={file.id} variant="secondary" isDisabled={busyId !== null} accessibilityLabel={file.file_name}
          accessibilityState={{ disabled: busyId !== null, busy: busyId === file.id }} onPress={() => void download(file)}>
          <Ionicons name="download-outline" size={18} color={theme.info} />
          <Button.Label>{file.file_name}</Button.Label>
        </Button>
      ))}
      {failure ? failure.refused ? (
        <EmptyState icon="document-outline" title={t('common:errors.notAvailableTitle')} subtitle={t('common:errors.notAvailableHint')} />
      ) : <ErrorState title={failure.message} onRetry={() => void download(failure.file)} /> : null}
    </View>
  );
}

export default withRouteGate(KbArticleScreen, 'kb-article');
