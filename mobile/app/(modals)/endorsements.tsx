// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  type TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  addSkill,
  getMembersWithSkill,
  getMySkills,
  getSkillCategory,
  getSkillCategories,
  getUserEndorsements,
  removeSkill,
  type CategorySkill,
  type Endorsement,
  type Skill,
  type SkillCategory,
  type SkillMember,
} from '@/lib/api/endorsements';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import BottomSheet from '@/components/ui/BottomSheet';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';

type Tab = 'skills' | 'endorsements' | 'discover';
type ListItem = Skill | Endorsement;

function HeaderStat({
  icon,
  label,
  tone,
  theme,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface
      variant="secondary"
      className="min-w-[46%] flex-1 rounded-panel-inner p-3"
      style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.14) }}
    >
      <View className="mb-2 size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(tone, 0.12) }}>
        <Ionicons name={icon} size={16} color={tone} />
      </View>
      <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
        {label}
      </Text>
    </Surface>
  );
}

function ActionPill({
  label,
  icon,
  onPress,
  primary,
  tone = 'secondary',
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary: string;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const isPrimary = tone === 'primary';
  const isDanger = tone === 'danger';
  const color = isDanger ? theme.error : primary;

  return (
    <HeroButton
      accessibilityLabel={accessibilityLabel ?? label}
      isDisabled={disabled}
      onPress={onPress}
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      size="sm"
      variant={isPrimary ? 'primary' : 'secondary'}
      style={{
        backgroundColor: isPrimary ? primary : withAlpha(color, 0.12),
        borderWidth: isPrimary ? 0 : 1,
        borderColor: isPrimary ? 'transparent' : withAlpha(color, 0.22),
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Ionicons name={icon} size={16} color={isPrimary ? '#ffffff' : color} />
      <HeroButton.Label className="text-sm font-semibold" style={{ color: isPrimary ? '#ffffff' : theme.text }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}

function SectionTitle({
  icon,
  label,
  primary,
  theme,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
        <Ionicons name={icon} size={16} color={primary} />
      </View>
      <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function getSkillMemberName(member: SkillMember, fallback: string) {
  return member.name ?? ([member.first_name, member.last_name].filter(Boolean).join(' ') || fallback);
}

function asCount(value: number | string | null | undefined) {
  const count = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function isEnabledFlag(value: boolean | number | null | undefined) {
  return value === true || value === 1;
}

export default function EndorsementsScreen() {
  const { t } = useTranslation(['endorsements', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { user } = useAuth();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const [activeTab, setActiveTab] = useState<Tab>('skills');
  const [addingSkill, setAddingSkill] = useState(false);
  const [skillInput, setSkillInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SkillCategory | null>(null);
  const [categorySkills, setCategorySkills] = useState<CategorySkill[]>([]);
  const [loadingCategoryId, setLoadingCategoryId] = useState<number | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillMembers, setSkillMembers] = useState<SkillMember[]>([]);
  const [loadingSkill, setLoadingSkill] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const skillInputRef = useRef<TextInput>(null);

  const userId = user?.id ?? 0;

  const {
    data: skillsData,
    isLoading: skillsLoading,
    refresh: refreshSkills,
  } = useApi(() => getMySkills(), [], { enabled: userId > 0 });

  const {
    data: endorsementsData,
    isLoading: endorsementsLoading,
    refresh: refreshEndorsements,
  } = useApi(() => getUserEndorsements(userId), [userId], { enabled: userId > 0 });
  const {
    data: categoriesData,
    isLoading: categoriesLoading,
  } = useApi(() => getSkillCategories(), []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([refreshSkills(), refreshEndorsements()]);
    setRefreshing(false);
  }, [refreshSkills, refreshEndorsements]);

  const skills = useMemo<Skill[]>(() => skillsData?.data?.skills ?? [], [skillsData?.data?.skills]);
  const endorsements = useMemo<Endorsement[]>(() => endorsementsData?.data ?? [], [endorsementsData?.data]);
  const categories = useMemo<SkillCategory[]>(() => categoriesData?.data ?? [], [categoriesData?.data]);

  async function handleAddSkill() {
    const name = skillInput.trim();
    if (!name) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSubmitting(true);
    try {
      await addSkill(name);
      setSkillInput('');
      setAddingSkill(false);
      refreshSkills();
    } catch (err) {
      showToast({ title: t('addSkillErrorTitle'), description: describeApiError(err, t('addSkillError')), variant: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenCategory(category: SkillCategory) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategory(category);
    setCategorySkills([]);
    setSelectedSkill(null);
    setSkillMembers([]);
    setLoadingCategoryId(category.id);
    try {
      const response = await getSkillCategory(category.id);
      setCategorySkills(response.data.skills ?? []);
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('discover.loadSkillsError')), variant: 'danger' });
    } finally {
      setLoadingCategoryId(null);
    }
  }

  async function handleOpenMembers(skillName: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedSkill(skillName);
    setSkillMembers([]);
    setLoadingSkill(skillName);
    try {
      const response = await getMembersWithSkill(skillName);
      setSkillMembers(response.data ?? []);
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('discover.loadMembersError')), variant: 'danger' });
    } finally {
      setLoadingSkill(null);
    }
  }

  function openMemberProfile(memberId: number) {
    router.push({ pathname: '/(modals)/member-profile', params: { id: String(memberId) } } as unknown as Href);
  }

  const handleRemoveSkill = useCallback((skillId: number) => {
    confirm({
      title: t('removeSkillTitle'),
      message: t('removeSkillConfirm'),
      confirmLabel: t('removeSkill'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
          await removeSkill(skillId);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast({ title: t('skillRemovedTitle'), description: t('skillRemoved'), variant: 'success' });
          refreshSkills();
        } catch (err) {
          showToast({ title: t('removeSkillErrorTitle'), description: describeApiError(err, t('removeSkillError')), variant: 'danger' });
        }
      },
    });
  }, [confirm, refreshSkills, showToast, t]);

  const renderSkill = useCallback(
    ({ item }: { item: Skill }) => {
      const endorseCount = endorsements.filter((e) => e.skill.id === item.id).length;
      return (
        <HeroCard
          variant="default"
          className="mb-3 overflow-hidden rounded-panel p-0"
          style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
        >
          <HeroCard.Body className="gap-4 p-4">
            <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: primary }} />
            <View className="flex-row items-start gap-3 pl-1">
              <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="construct-outline" size={20} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>{item.name}</Text>
                {item.category ? (
                  <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{item.category}</Text>
                ) : null}
                {endorseCount > 0 ? (
                  <Chip size="sm" variant="soft" color="success" className="self-start">
                    <Ionicons name="ribbon-outline" size={12} color={theme.success} />
                    <Chip.Label>{t('endorsedBy', { count: endorseCount })}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
            </View>
            <View className="items-start pl-1">
              <ActionPill
                label={t('removeSkill')}
                icon="trash-outline"
                primary={primary}
                tone="danger"
                onPress={() => void handleRemoveSkill(item.id)}
                accessibilityLabel={t('removeSkill')}
              />
            </View>
          </HeroCard.Body>
        </HeroCard>
      );
    },
    [endorsements, handleRemoveSkill, primary, t, theme.success, theme.text, theme.textSecondary],
  );

  const renderEndorsement = useCallback(
    ({ item }: { item: Endorsement }) => {
      const date = new Date(item.created_at).toLocaleDateString(dateLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return (
        <HeroCard
          variant="default"
          className="mb-3 overflow-hidden rounded-panel p-0"
          style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
        >
          <HeroCard.Body className="gap-3 p-4">
            <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: theme.success }} />
            <View className="flex-row gap-3 pl-1">
              <Avatar uri={item.endorsed_by.avatar} name={item.endorsed_by.name} size={44} />
              <View className="min-w-0 flex-1 gap-2">
                <View className="flex-row items-start justify-between gap-2">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{item.endorsed_by.name}</Text>
                    <Text className="text-[11px]" style={{ color: theme.textMuted }}>{date}</Text>
                  </View>
                  <Chip size="sm" variant="secondary">
                    <Ionicons name="ribbon-outline" size={12} color={primary} />
                    <Chip.Label>{item.skill.name}</Chip.Label>
                  </Chip>
                </View>
                {item.message ? (
                  <Surface variant="secondary" className="rounded-panel-inner px-3 py-2">
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{item.message}</Text>
                  </Surface>
                ) : null}
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>
      );
    },
    [primary, theme.success, theme.text, theme.textMuted, theme.textSecondary],
  );

  const isLoading = activeTab === 'skills' ? skillsLoading : activeTab === 'endorsements' ? endorsementsLoading : categoriesLoading;
  const listData: ListItem[] = activeTab === 'skills' ? skills : activeTab === 'endorsements' ? endorsements : [];

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList<ListItem>
          data={listData}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            activeTab === 'skills'
              ? renderSkill({ item: item as unknown as Skill })
              : renderEndorsement({ item: item as Endorsement })
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={primary}
              colors={[primary]}
            />
          }
          ListHeaderComponent={
            <EndorsementsHeader
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              addingSkill={addingSkill}
              setAddingSkill={setAddingSkill}
              skillInput={skillInput}
              setSkillInput={setSkillInput}
              skillInputRef={skillInputRef}
              submitting={submitting}
              handleAddSkill={handleAddSkill}
              skillsCount={skills.length}
              endorsementsCount={endorsements.length}
              categories={categories}
              categoriesLoading={categoriesLoading}
              selectedCategory={selectedCategory}
              categorySkills={categorySkills}
              loadingCategoryId={loadingCategoryId}
              selectedSkill={selectedSkill}
              skillMembers={skillMembers}
              loadingSkill={loadingSkill}
              onOpenCategory={handleOpenCategory}
              onOpenMembers={handleOpenMembers}
              onOpenMemberProfile={openMemberProfile}
              primary={primary}
              theme={theme}
              t={t}
            />
          }
          ListEmptyComponent={
            activeTab === 'discover' && categories.length > 0 ? null :
            isLoading ? (
              <View className="items-center justify-center py-14">
                <LoadingSpinner />
              </View>
            ) : (
              <View className="px-4 py-8">
                <EmptyState
                  icon={activeTab === 'skills' ? 'construct-outline' : activeTab === 'endorsements' ? 'ribbon-outline' : 'folder-open-outline'}
                  title={activeTab === 'skills' ? t('noSkills') : activeTab === 'endorsements' ? t('noEndorsements') : t('discover.empty')}
                  subtitle={activeTab === 'skills' ? t('noSkillsHint') : activeTab === 'endorsements' ? t('noEndorsementsHint') : t('discover.emptyHint')}
                />
              </View>
            )
          }
        />
        {confirmDialog}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function EndorsementsHeader({
  activeTab,
  setActiveTab,
  addingSkill,
  setAddingSkill,
  skillInput,
  setSkillInput,
  skillInputRef,
  submitting,
  handleAddSkill,
  skillsCount,
  endorsementsCount,
  categories,
  categoriesLoading,
  selectedCategory,
  categorySkills,
  loadingCategoryId,
  selectedSkill,
  skillMembers,
  loadingSkill,
  onOpenCategory,
  onOpenMembers,
  onOpenMemberProfile,
  primary,
  theme,
  t,
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  addingSkill: boolean;
  setAddingSkill: (value: boolean) => void;
  skillInput: string;
  setSkillInput: (value: string) => void;
  skillInputRef: RefObject<TextInput | null>;
  submitting: boolean;
  handleAddSkill: () => Promise<void>;
  skillsCount: number;
  endorsementsCount: number;
  categories: SkillCategory[];
  categoriesLoading: boolean;
  selectedCategory: SkillCategory | null;
  categorySkills: CategorySkill[];
  loadingCategoryId: number | null;
  selectedSkill: string | null;
  skillMembers: SkillMember[];
  loadingSkill: string | null;
  onOpenCategory: (category: SkillCategory) => Promise<void>;
  onOpenMembers: (skillName: string) => Promise<void>;
  onOpenMemberProfile: (memberId: number) => void;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  function selectTab(tab: Tab) {
    if (tab !== activeTab) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActiveTab(tab);
    }
  }

  return (
    <View className="gap-3 pb-2">
      <HeroCard
        variant="default"
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
      >
        <View className="h-1" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-5 p-5">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="ribbon-outline" size={24} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('heroEyebrow')}</Text>
              <Text className="mt-1 text-2xl font-bold leading-8" style={{ color: theme.text }} numberOfLines={2}>{t('title')}</Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{t('subtitle')}</Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <HeaderStat icon="construct-outline" label={t('skillsCount', { count: skillsCount })} tone={primary} theme={theme} />
            <HeaderStat icon="ribbon-outline" label={t('endorsementsCount', { count: endorsementsCount })} tone={theme.success} theme={theme} />
          </View>
        </HeroCard.Body>
      </HeroCard>

      <Surface variant="secondary" className="gap-3 rounded-panel p-2">
        <Tabs value={activeTab} onValueChange={(value) => selectTab(value as Tab)} variant="secondary">
          <Tabs.List>
            <Tabs.Indicator />
            <Tabs.Trigger value="skills">
              <Ionicons name="construct-outline" size={15} color={activeTab === 'skills' ? primary : theme.textMuted} />
              <Tabs.Label>{t('mySkills')}</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="endorsements">
              <Ionicons name="ribbon-outline" size={15} color={activeTab === 'endorsements' ? primary : theme.textMuted} />
              <Tabs.Label>{t('endorsements')}</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="discover">
              <Ionicons name="folder-open-outline" size={15} color={activeTab === 'discover' ? primary : theme.textMuted} />
              <Tabs.Label>{t('discover.title')}</Tabs.Label>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {activeTab === 'skills' ? t('skillsIntro') : activeTab === 'endorsements' ? t('endorsementsIntro') : t('discover.subtitle')}
        </Text>
      </Surface>

      {activeTab === 'skills' ? (
        <Surface variant="secondary" className="gap-3 rounded-panel p-3">
          <View className="items-start">
            <ActionPill
              label={t('addSkill')}
              icon="add-circle-outline"
              primary={primary}
              tone="primary"
              onPress={() => setAddingSkill(true)}
              accessibilityLabel={t('addSkill')}
            />
          </View>
        </Surface>
      ) : null}

      {/* Add-skill composer — bottom sheet so the keyboard never hides the
          input (was a cramped inline field that the keyboard covered). */}
      <BottomSheet
        visible={addingSkill}
        onClose={() => { setAddingSkill(false); setSkillInput(''); }}
        title={t('addSkill')}
      >
        <View className="gap-4 py-2">
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('skillPlaceholder')}
          </Text>
          <View className="flex-row items-center gap-2 rounded-panel-inner border px-3 py-2" style={{ borderColor: withAlpha(primary, 0.34), backgroundColor: theme.surface }}>
            <Ionicons name="add-circle-outline" size={18} color={primary} />
            <Input
              ref={skillInputRef}
              containerClassName="mb-0 flex-1"
              inputClassName="min-h-10 flex-1 text-sm"
              style={{ color: theme.text }}
              placeholder={t('skillPlaceholder')}
              placeholderTextColor={theme.textMuted}
              value={skillInput}
              onChangeText={setSkillInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleAddSkill()}
            />
          </View>
          <View className="flex-row flex-wrap gap-2">
            <ActionPill
              label={t('common:buttons.cancel')}
              icon="close-outline"
              primary={primary}
              onPress={() => { setAddingSkill(false); setSkillInput(''); }}
            />
            <ActionPill
              label={t('addSkill')}
              icon="checkmark-outline"
              primary={primary}
              tone="primary"
              disabled={submitting || !skillInput.trim()}
              onPress={() => void handleAddSkill()}
              accessibilityLabel={t('addSkill')}
            />
          </View>
        </View>
      </BottomSheet>
      {activeTab === 'discover' ? (
        <View className="gap-3">
          {categoriesLoading ? (
            <Surface variant="secondary" className="min-h-[120px] items-center justify-center rounded-panel-inner p-4">
              <LoadingSpinner />
            </Surface>
          ) : categories.length === 0 ? null : (
            <>
              {categories.map((category) => (
                <HeroCard
                  key={category.id}
                  className="overflow-hidden rounded-panel p-0"
                  style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
                >
                  <HeroCard.Body className="gap-3 p-4">
                    <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: primary }} />
                    <View className="flex-row items-start gap-3 pl-1">
                      <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                        <Ionicons name="folder-open-outline" size={19} color={primary} />
                      </View>
                      <View className="min-w-0 flex-1 gap-1">
                        <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                          {category.name}
                        </Text>
                        {category.description ? (
                          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                            {category.description}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      <Chip size="sm" variant="secondary" color="default">
                        <Chip.Label>{t('discover.skillsCount', { count: asCount(category.skills_count) })}</Chip.Label>
                      </Chip>
                      {category.children && category.children.length > 0 ? (
                        <Chip size="sm" variant="secondary" color="default">
                          <Chip.Label>{t('discover.subcategoriesCount', { count: category.children.length })}</Chip.Label>
                        </Chip>
                      ) : null}
                    </View>
                    <View className="items-start pl-1">
                      {loadingCategoryId === category.id ? (
                        <LoadingSpinner />
                      ) : (
                        <ActionPill
                          label={t('discover.viewSkills')}
                          icon="chevron-forward-outline"
                          primary={primary}
                          onPress={() => void onOpenCategory(category)}
                        />
                      )}
                    </View>
                  </HeroCard.Body>
                </HeroCard>
              ))}

              {selectedCategory ? (
                <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}>
                  <HeroCard.Body className="gap-3 p-4">
                    <SectionTitle icon="construct-outline" label={t('discover.skillsInCategory', { category: selectedCategory.name })} primary={primary} theme={theme} />
                    {loadingCategoryId === selectedCategory.id ? (
                      <View className="items-center justify-center py-4">
                        <LoadingSpinner />
                      </View>
                    ) : categorySkills.length === 0 ? (
                      <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('discover.noSkillsInCategory')}</Text>
                    ) : (
                      categorySkills.map((skill) => (
                        <Surface
                          key={skill.skill_name}
                          variant="secondary"
                          className="gap-3 rounded-panel-inner p-3"
                          style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
                        >
                          <View className="flex-row items-start justify-between gap-3">
                            <View className="min-w-0 flex-1">
                              <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                                {skill.skill_name}
                              </Text>
                              <Text className="text-xs" style={{ color: theme.textSecondary }}>
                                {t('discover.memberCount', { count: asCount(skill.user_count) })}
                              </Text>
                            </View>
                            {loadingSkill === skill.skill_name ? (
                              <LoadingSpinner />
                            ) : (
                              <ActionPill
                                label={t('discover.viewMembers')}
                                icon="people-outline"
                                primary={primary}
                                onPress={() => void onOpenMembers(skill.skill_name)}
                              />
                            )}
                          </View>
                          <View className="flex-row flex-wrap gap-2">
                            <Chip size="sm" variant="secondary" color="success">
                              <Chip.Label>{t('discover.offeringCount', { count: asCount(skill.offering_count) })}</Chip.Label>
                            </Chip>
                            <Chip size="sm" variant="secondary" color="default">
                              <Chip.Label>{t('discover.requestingCount', { count: asCount(skill.requesting_count) })}</Chip.Label>
                            </Chip>
                          </View>
                        </Surface>
                      ))
                    )}
                  </HeroCard.Body>
                </HeroCard>
              ) : null}

              {selectedSkill ? (
                <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}>
                  <HeroCard.Body className="gap-3 p-4">
                    <SectionTitle icon="people-outline" label={t('discover.membersWith', { skill: selectedSkill })} primary={primary} theme={theme} />
                    {loadingSkill === selectedSkill ? (
                      <View className="items-center justify-center py-4">
                        <LoadingSpinner />
                      </View>
                    ) : skillMembers.length === 0 ? (
                      <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('discover.noMembers')}</Text>
                    ) : (
                      skillMembers.map((member) => {
                        const name = getSkillMemberName(member, t('discover.memberFallback'));
                        return (
                          <NativePressable
                            key={member.id}
                            className="rounded-panel-inner"
                            onPress={() => onOpenMemberProfile(member.id)}
                            accessibilityLabel={t('discover.openMember', { name })}
                            feedback="highlight"
                          >
                            <Surface variant="secondary" className="w-full flex-row items-center gap-3 rounded-panel-inner p-3">
                              <Avatar uri={member.avatar ?? undefined} name={name} size={38} />
                              <View className="min-w-0 flex-1">
                                <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                                  {name}
                                </Text>
                                {member.proficiency_level ? (
                                  <Text className="text-xs" style={{ color: theme.textSecondary }}>
                                    {t('discover.proficiency', { level: member.proficiency_level })}
                                  </Text>
                                ) : null}
                              </View>
                              {isEnabledFlag(member.is_offering) ? (
                                <Chip size="sm" variant="secondary" color="success">
                                  <Chip.Label>{t('discover.offers')}</Chip.Label>
                                </Chip>
                              ) : isEnabledFlag(member.is_requesting) ? (
                                <Chip size="sm" variant="secondary" color="default">
                                  <Chip.Label>{t('discover.wants')}</Chip.Label>
                                </Chip>
                              ) : null}
                            </Surface>
                          </NativePressable>
                        );
                      })
                    )}
                  </HeroCard.Body>
                </HeroCard>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}
