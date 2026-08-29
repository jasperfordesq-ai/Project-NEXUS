// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  getIdeationChallenge,
  getIdeationIdeas,
  submitIdeationIdea,
  voteIdeationIdea,
  type IdeationIdea,
  type IdeationSort,
} from '@/lib/api/ideation';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

export default function IdeationDetailScreen() {
  const { t } = useTranslation(['ideation', 'common']);
  const { hasFeature } = useTenant();
  const { user } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const challengeId = Number(params.id ?? 0);
  const [sort, setSort] = useState<IdeationSort>('votes');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const challengeState = useApi(() => getIdeationChallenge(challengeId), [challengeId], {
    enabled: hasFeature('ideation_challenges') && challengeId > 0,
  });
  const ideasState = useApi(() => getIdeationIdeas(challengeId, sort), [challengeId, sort], {
    enabled: hasFeature('ideation_challenges') && challengeId > 0,
  });

  async function submitIdea() {
    if (!title.trim() || !description.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      await submitIdeationIdea(challengeId, { title: title.trim(), description: description.trim() });
      setTitle('');
      setDescription('');
      setStatusMessage(t('ideation:submitSuccess'));
      ideasState.refresh();
      challengeState.refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t('ideation:submitFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function vote(idea: IdeationIdea) {
    try {
      await voteIdeationIdea(idea.id);
      ideasState.refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t('ideation:voteFailed'));
    }
  }

  if (!hasFeature('ideation_challenges')) {
    return (
      <ModalErrorBoundary>
        <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
          <AppTopBar title={t('ideation:title')} backLabel={t('common:back')} fallbackHref={'/(modals)/ideation' as Href} />
          <View className="px-4 py-8" style={{ flex: 1, backgroundColor: theme.bg }}>
            <EmptyState icon="bulb-outline" title={t('ideation:disabledTitle')} subtitle={t('ideation:disabledSubtitle')} />
          </View>
        </SafeAreaView>
      </ModalErrorBoundary>
    );
  }

  const challenge = challengeState.data;
  const ideas = ideasState.data?.items ?? [];
  const isAdmin = Boolean(user?.role && ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(user.role));
  /**
   * 🔴 Only the FIRST load gets the full-page spinner.
   *
   * Voting on an idea and submitting an idea both call `refresh()`, which flips
   * `isLoading` again — and this screen used that flag alone, so a single tap on Vote
   * replaced the whole challenge with a spinner for several seconds and then rebuilt it.
   * Measured on a device on 2026-08-22. Once there is a challenge to show, keep showing it
   * while the refetch runs.
   */
  const loading = (challengeState.isLoading || ideasState.isLoading) && !challenge;
  const error = challengeState.error ?? ideasState.error;

  return (
    <ModalErrorBoundary>
      <SafeAreaView testID="ideation-detail-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={challenge?.title ?? t('ideation:challengeTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/ideation' as Href} />
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: theme.bg }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <ScrollView
          testID="ideation-detail-scroll"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40, backgroundColor: theme.bg }}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View className="items-center justify-center py-14">
              <LoadingSpinner />
            </View>
          ) : error || !challenge ? (
            <View className="px-4 py-8">
              <EmptyState
                icon={error ? 'warning-outline' : 'bulb-outline'}
                title={error ? t('ideation:errorTitle') : t('ideation:emptyTitle')}
                subtitle={error ? String(error) : undefined}
                actionLabel={error ? t('common:buttons.retry') : undefined}
                onAction={error ? () => { challengeState.refresh(); ideasState.refresh(); } : undefined}
              />
            </View>
          ) : (
            <View className="gap-3 px-4">
              <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
                <View className="h-1 w-full" style={{ backgroundColor: primary }} />
                <HeroCard.Body className="gap-4 p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                      <Ionicons name="bulb-outline" size={25} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1 gap-2">
                      <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                        {challenge.title}
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        <Chip size="sm" variant="secondary">
                          <Chip.Label>{t(`ideation:status.${challenge.status}`)}</Chip.Label>
                        </Chip>
                        <Chip size="sm" variant="secondary">
                          <Chip.Label>{t('ideation:ideasCount', { count: challenge.ideas_count ?? ideas.length })}</Chip.Label>
                        </Chip>
                        {challenge.prize_description ? (
                          <Chip size="sm" variant="secondary">
                            <Ionicons name="trophy-outline" size={12} color={primary} />
                            <Chip.Label>{challenge.prize_description}</Chip.Label>
                          </Chip>
                        ) : null}
                      </View>
                    </View>
                  </View>
                  <Text className="text-base leading-7" style={{ color: theme.textSecondary }}>
                    {stripHtml(challenge.description)}
                  </Text>
                  {isAdmin ? <HeroButton variant="secondary" onPress={() => router.push({ pathname: '/(modals)/new-challenge', params: { id: String(challenge.id), mode: 'edit' } } as unknown as Href)}><HeroButton.Label>{t('ideation:admin.edit_challenge')}</HeroButton.Label></HeroButton> : null}
                </HeroCard.Body>
              </HeroCard>

              <HeroCard variant="default" className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <Text className="text-lg font-bold" style={{ color: theme.text }}>
                    {t('ideation:submitIdea')}
                  </Text>
                  <Input label={t('ideation:ideaTitleLabel')} value={title} onChangeText={setTitle} placeholder={t('ideation:ideaTitlePlaceholder')} />
                  <Input label={t('ideation:ideaDescriptionLabel')} value={description} onChangeText={setDescription} placeholder={t('ideation:ideaDescriptionPlaceholder')} multiline numberOfLines={4} />
                  {statusMessage ? (
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>
                      {statusMessage}
                    </Text>
                  ) : null}
                  <HeroButton variant="primary" onPress={() => void submitIdea()} isDisabled={!title.trim() || !description.trim() || isSubmitting}>
                    <HeroButton.Label>{isSubmitting ? t('ideation:submitting') : t('ideation:submitIdea')}</HeroButton.Label>
                  </HeroButton>
                </HeroCard.Body>
              </HeroCard>

              <Surface variant="default" className="rounded-panel-inner p-2">
                <Tabs value={sort} onValueChange={(value) => setSort(value as IdeationSort)} variant="secondary">
                  <Tabs.List>
                    <Tabs.ScrollView scrollAlign="start" contentContainerClassName="gap-1">
                      <Tabs.Indicator />
                      <Tabs.Trigger value="votes"><Tabs.Label>{t('ideation:sort.votes')}</Tabs.Label></Tabs.Trigger>
                      <Tabs.Trigger value="newest"><Tabs.Label>{t('ideation:sort.newest')}</Tabs.Label></Tabs.Trigger>
                    </Tabs.ScrollView>
                  </Tabs.List>
                </Tabs>
              </Surface>

              {ideas.length > 0 ? (
                ideas.map((idea) => <IdeaCard key={idea.id} idea={idea} challengeId={challengeId} onVote={vote} />)
              ) : (
                <EmptyState icon="chatbubble-ellipses-outline" title={t('ideation:noIdeasTitle')} subtitle={t('ideation:noIdeasSubtitle')} />
              )}
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function IdeaCard({ idea, challengeId, onVote }: { idea: IdeationIdea; challengeId: number; onVote: (idea: IdeationIdea) => void }) {
  const { t } = useTranslation(['ideation']);
  const theme = useTheme();
  return (
    <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-panel-inner bg-surface-secondary">
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.info} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>
              {idea.title}
            </Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>
              {stripHtml(idea.description)}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary">
                <Chip.Label>{t(`ideation:ideaStatus.${idea.status}`)}</Chip.Label>
              </Chip>
              <Chip size="sm" variant="secondary">
                <Chip.Label>{t('ideation:votesCount', { count: idea.votes_count ?? 0 })}</Chip.Label>
              </Chip>
            </View>
          </View>
        </View>
        <HeroButton variant={idea.has_voted ? 'primary' : 'secondary'} onPress={() => void onVote(idea)}>
          <Ionicons name="arrow-up-circle-outline" size={16} color={theme.info} />
          <HeroButton.Label>{idea.has_voted ? t('ideation:voted') : t('ideation:vote')}</HeroButton.Label>
        </HeroButton>
        <HeroButton variant="secondary" onPress={() => router.push({ pathname: '/(modals)/ideation-idea', params: { id: String(idea.id), challengeId: String(challengeId) } } as unknown as Href)}>
          <HeroButton.Label>{t('ideation:idea_detail.page_title')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
