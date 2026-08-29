// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Href, useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { Chip } from '@/components/ui/StatusChip';
import {
  addIdeationComment,
  getIdeationComments,
  getIdeationIdea,
  updateIdeationIdea,
  voteIdeationIdea,
} from '@/lib/api/ideation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useApi } from '@/lib/hooks/useApi';
import { useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function IdeationIdeaScreen() {
  const { t } = useTranslation(['ideation', 'common']);
  const { id, challengeId: routeChallengeId } = useLocalSearchParams<{ id?: string; challengeId?: string }>();
  const ideaId = Number(id ?? 0);
  const { user } = useAuth();
  const { hasFeature } = useTenant();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const ideaState = useApi(() => getIdeationIdea(ideaId), [ideaId], { enabled: hasFeature('ideation_challenges') && ideaId > 0 });
  const commentsState = useApi(() => getIdeationComments(ideaId), [ideaId], { enabled: hasFeature('ideation_challenges') && ideaId > 0 });
  const idea = ideaState.data;
  const challengeId = Number(routeChallengeId ?? idea?.challenge_id ?? 0);
  const isOwner = Boolean(user && idea?.user_id === user.id);
  const [comment, setComment] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!idea) return;
    setEditTitle(idea.title);
    setEditDescription(idea.description);
  }, [idea]);

  async function vote() {
    if (!idea || isVoting) return;
    setIsVoting(true);
    try {
      const result = await voteIdeationIdea(idea.id);
      showToast({ title: result.voted ? t('ideation:toast.vote_added') : t('ideation:toast.vote_removed'), variant: 'success' });
      await ideaState.refresh();
    } catch (error) {
      showToast({ title: t('ideation:voteFailed'), description: error instanceof Error ? error.message : t('ideation:toast.error_generic'), variant: 'danger' });
    } finally {
      setIsVoting(false);
    }
  }

  async function postComment() {
    const body = comment.trim();
    if (!body || isPosting) return;
    setIsPosting(true);
    try {
      await addIdeationComment(ideaId, body);
      setComment('');
      showToast({ title: t('ideation:toast.comment_added'), variant: 'success' });
      await Promise.all([commentsState.refresh(), ideaState.refresh()]);
    } catch (error) {
      showToast({ title: t('ideation:comments.load_error'), description: error instanceof Error ? error.message : t('ideation:toast.error_generic'), variant: 'danger' });
    } finally {
      setIsPosting(false);
    }
  }

  async function saveIdea() {
    if (!idea || !editTitle.trim() || !editDescription.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await updateIdeationIdea(idea.id, { title: editTitle.trim(), description: editDescription.trim() });
      setIsEditing(false);
      showToast({ title: t('ideation:toast.idea_updated'), variant: 'success' });
      await ideaState.refresh();
    } catch (error) {
      showToast({ title: t('ideation:toast.error_generic'), description: error instanceof Error ? error.message : undefined, variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  const fallback = challengeId > 0
    ? ({ pathname: '/(modals)/ideation-detail', params: { id: String(challengeId) } } as unknown as Href)
    : ('/(modals)/ideation' as Href);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={idea?.title ?? t('ideation:idea_detail.page_title')} backLabel={t('common:back')} fallbackHref={fallback} />
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {!hasFeature('ideation_challenges') ? (
              <EmptyState icon="bulb-outline" title={t('ideation:disabledTitle')} subtitle={t('ideation:disabledSubtitle')} />
            ) : ideaState.isLoading && !idea ? <LoadingSpinner /> : ideaState.error || !idea ? (
              <EmptyState icon="warning-outline" title={t('ideation:ideas.load_error')} subtitle={ideaState.error ?? undefined} actionLabel={t('ideation:actions.retry')} onAction={ideaState.refresh} />
            ) : (
              <View className="gap-4">
                <HeroCard className="rounded-panel"><HeroCard.Body className="gap-3 p-5">
                  {isEditing ? <>
                    <Input label={t('ideation:form.title_label')} value={editTitle} onChangeText={setEditTitle} />
                    <Input label={t('ideation:form.description_label')} value={editDescription} onChangeText={setEditDescription} multiline numberOfLines={6} />
                    <View className="flex-row gap-2">
                      <HeroButton className="flex-1" variant="secondary" onPress={() => setIsEditing(false)}><HeroButton.Label>{t('ideation:form.cancel')}</HeroButton.Label></HeroButton>
                      <HeroButton className="flex-1" isDisabled={isSaving || !editTitle.trim() || !editDescription.trim()} onPress={() => void saveIdea()}><HeroButton.Label>{isSaving ? t('ideation:form.saving') : t('ideation:form.save')}</HeroButton.Label></HeroButton>
                    </View>
                  </> : <>
                    <Text accessibilityRole="header" className="text-2xl font-bold" style={{ color: theme.text }}>{idea.title}</Text>
                    <View className="flex-row flex-wrap gap-2"><Chip size="sm" variant="secondary"><Chip.Label>{t(`ideation:ideaStatus.${idea.status}`)}</Chip.Label></Chip><Chip size="sm" variant="secondary"><Chip.Label>{t('ideation:votesCount', { count: idea.votes_count ?? 0 })}</Chip.Label></Chip></View>
                    {idea.creator?.name ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('ideation:idea_detail.submitted_by', { name: idea.creator.name })}</Text> : null}
                    <Text className="text-base leading-7" style={{ color: theme.textSecondary }}>{stripHtml(idea.description)}</Text>
                    <View className="flex-row gap-2">
                      <HeroButton className="flex-1" variant={idea.has_voted ? 'primary' : 'secondary'} isDisabled={isVoting} onPress={() => void vote()}><HeroButton.Label>{idea.has_voted ? t('ideation:voted') : t('ideation:vote')}</HeroButton.Label></HeroButton>
                      {isOwner ? <HeroButton className="flex-1" variant="secondary" onPress={() => setIsEditing(true)}><HeroButton.Label>{t('ideation:ideas.edit')}</HeroButton.Label></HeroButton> : null}
                    </View>
                  </>}
                </HeroCard.Body></HeroCard>

                <HeroCard className="rounded-panel"><HeroCard.Body className="gap-3 p-5">
                  <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>{t('ideation:comments.title')}</Text>
                  <Input label={t('ideation:comments.add_label')} value={comment} onChangeText={setComment} placeholder={t('ideation:comments.add_placeholder')} multiline numberOfLines={3} />
                  <HeroButton isDisabled={!comment.trim() || isPosting} onPress={() => void postComment()}><HeroButton.Label>{isPosting ? t('ideation:form.saving') : t('ideation:comments.add_button')}</HeroButton.Label></HeroButton>
                  {commentsState.isLoading && !commentsState.data ? <LoadingSpinner /> : commentsState.error ? <EmptyState icon="warning-outline" title={t('ideation:comments.load_error')} subtitle={commentsState.error} actionLabel={t('ideation:actions.retry')} onAction={commentsState.refresh} /> : (commentsState.data?.items.length ?? 0) === 0 ? <EmptyState icon="chatbubble-outline" title={t('ideation:comments.empty_title')} subtitle={t('ideation:comments.empty_description')} /> : commentsState.data?.items.map((item) => (
                    <View key={item.id} className="gap-1 border-t border-divider py-3"><Text className="text-sm font-semibold" style={{ color: theme.text }}>{item.author?.name ?? t('common:unknown')}</Text><Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{item.body}</Text></View>
                  ))}
                </HeroCard.Body></HeroCard>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
