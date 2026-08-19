// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  getFederationEvents,
  getFederationGroups,
  getFederationListings,
  getFederationMembers,
  getFederationMessages,
  getFederationPartners,
  getFederationSettings,
  getFederationMember,
  markFederationMessagesReadBatch,
  optInFederation,
  optOutFederation,
  sendFederationMessage,
  translateFederationMessage,
  updateFederationSettings,
  type FederatedEvent,
  type FederatedGroup,
  type FederatedListing,
  type FederatedMember,
  type FederatedMessage,
  type FederatedTenant,
  type FederationSettings,
} from '@/lib/api/federation';
import { useApi } from '@/lib/hooks/useApi';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import Input from '@/components/ui/Input';
import NativePressable from '@/components/ui/NativePressable';
import Toggle from '@/components/ui/Toggle';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import AccentIcon from '@/components/ui/AccentIcon';

type DirectoryMode = 'partners' | 'members' | 'messages' | 'listings' | 'groups' | 'events' | 'settings';
type IoniconName = ComponentProps<typeof Ionicons>['name'];
type ServiceReachFilter = 'all' | 'local_only' | 'remote_ok' | 'travel_ok';
type ListingTypeFilter = 'all' | 'offer' | 'request';
type DirectoryItem = FederatedTenant | FederatedMember | FederatedListing | FederatedGroup | FederatedEvent | FederatedMessage;
type FederatedThread = {
  key: string;
  partner: NonNullable<FederatedMessage['sender']>;
  messages: FederatedMessage[];
  lastMessage: FederatedMessage;
  unreadCount: number;
};

const modeMeta: Record<DirectoryMode, { icon: IoniconName; tone: string }> = {
  partners: { icon: 'globe-outline', tone: '#6366f1' },
  members: { icon: 'people-outline', tone: '#a855f7' },
  messages: { icon: 'chatbubbles-outline', tone: '#06b6d4' },
  listings: { icon: 'list-outline', tone: '#f59e0b' },
  groups: { icon: 'people-circle-outline', tone: '#8b5cf6' },
  events: { icon: 'calendar-outline', tone: '#f43f5e' },
  settings: { icon: 'settings-outline', tone: '#64748b' },
};

function resolvedMediaUrl(url?: string | null): string | null {
  return resolveImageUrl(url ?? null);
}

const settingKeys = [
  'profile_visible_federated',
  'appear_in_federated_search',
  'show_skills_federated',
  'show_location_federated',
  'show_reviews_federated',
  'messaging_enabled_federated',
  'transactions_enabled_federated',
  'email_notifications',
] as const satisfies readonly (keyof FederationSettings)[];

const serviceReachFilters: ServiceReachFilter[] = ['all', 'local_only', 'remote_ok', 'travel_ok'];
const listingTypeFilters: ListingTypeFilter[] = ['all', 'offer', 'request'];

function unwrapArray<T>(response: { data?: T[] } | T[] | null | undefined): T[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return Array.isArray(response.data) ? response.data : [];
}

function unwrapFederationPage<T>(response: { data?: T[]; meta?: { cursor?: string | null; next_cursor?: string | null; has_more?: boolean } } | T[] | null | undefined) {
  const items = unwrapArray<T>(response);
  const meta = Array.isArray(response) ? undefined : response?.meta;
  const cursor = meta?.cursor ?? meta?.next_cursor ?? null;
  return {
    items,
    cursor,
    hasMore: meta?.has_more ?? Boolean(cursor),
  };
}

function unwrapSettings(response: { data?: { settings: FederationSettings; enabled: boolean }; settings?: FederationSettings; enabled?: boolean } | null | undefined) {
  const payload = response?.data ?? response;
  return {
    settings: payload?.settings ?? {},
    enabled: payload?.enabled ?? payload?.settings?.federation_optin ?? false,
  };
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function displayMemberName(member: FederatedMember, fallback: string) {
  return member.name?.trim() || `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || fallback;
}

function displayFederationPartnerName(partner: FederatedThread['partner'], fallback: string) {
  return partner.name?.trim() || fallback;
}

function externalPartnerIdFromFederatedId(id?: number | string | null): string | null {
  const raw = String(id ?? '');
  if (!raw.startsWith('ext-')) return null;
  const parts = raw.split('-', 3);
  return parts[1] || null;
}

function externalTenantIdFromFederatedId(id?: number | string | null): string | null {
  const partnerId = externalPartnerIdFromFederatedId(id);
  return partnerId ? `ext-${partnerId}` : null;
}

function isFeatureDisabledError(error: string | null) {
  return !!error && /feature disabled|disabled for this tenant|cross-tenant/i.test(error);
}

function getMessagePartner(message: FederatedMessage) {
  return message.direction === 'outbound' ? message.receiver : message.sender;
}

function buildMessageThreads(messages: FederatedMessage[]): FederatedThread[] {
  const groups = new Map<string, FederatedMessage[]>();
  messages.forEach((message) => {
    const partner = getMessagePartner(message);
    if (!partner?.id || !partner.tenant_id) return;
    const key = `${partner.id}-${partner.tenant_id}`;
    groups.set(key, [...(groups.get(key) ?? []), message]);
  });

  return Array.from(groups.entries())
    .map(([key, threadMessages]) => {
      const sorted = [...threadMessages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const lastMessage = sorted[sorted.length - 1] as FederatedMessage;
      const partner = getMessagePartner(lastMessage) ?? {
        id: '',
        name: '',
        tenant_id: '',
        tenant_name: '',
      };
      return {
        key,
        partner,
        messages: sorted,
        lastMessage,
        unreadCount: sorted.filter((message) => message.direction === 'inbound' && message.status === 'unread').length,
      };
    })
    .sort((a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime());
}

function getThreadKeyForMessage(message: FederatedMessage): string | null {
  const partner = getMessagePartner(message);
  if (!partner?.id || !partner.tenant_id) return null;
  return `${partner.id}-${partner.tenant_id}`;
}

function threadMatchesPartner(thread: FederatedThread, partnerId: string) {
  if (!partnerId) return true;
  const normalized = String(partnerId);
  const externalNumericId = normalized.startsWith('ext-') ? normalized.slice(4) : normalized;
  const partnerTenantId = String(thread.partner.tenant_id ?? '');

  if (partnerTenantId === normalized || partnerTenantId === `ext-${externalNumericId}`) {
    return true;
  }

  return thread.messages.some((message) => {
    const externalPartnerId = message.external_partner_id === undefined ? null : String(message.external_partner_id);
    return externalPartnerId === externalNumericId || String(message.sender?.tenant_id ?? '') === normalized || String(message.receiver?.tenant_id ?? '') === normalized;
  });
}

function mergeFederationMessages(remoteMessages: FederatedMessage[], localMessages: FederatedMessage[]): FederatedMessage[] {
  const seen = new Set<string>();
  return [...remoteMessages, ...localMessages].filter((message) => {
    const id = String(message.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function HeaderCard({
  mode,
  count,
  theme,
  t,
}: {
  mode: DirectoryMode;
  count?: number;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const meta = modeMeta[mode];
  return (
    <HeroCard
      variant="default"
      className="mb-4 overflow-hidden rounded-panel p-0"
      style={{ borderWidth: 1, borderColor: withAlpha(meta.tone, 0.16) }}
    >
      <View className="h-1.5" style={{ backgroundColor: meta.tone }} />
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(meta.tone, 0.14) }}>
            <Ionicons name={meta.icon} size={22} color={meta.tone} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {t(`directory.${mode}.eyebrow`)}
            </Text>
            <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={2}>
              {t(`directory.${mode}.title`)}
            </Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
              {t(`directory.${mode}.subtitle`)}
            </Text>
          </View>
        </View>
        {typeof count === 'number' ? (
          <View className="items-start">
            <Chip size="sm" variant="secondary">
              <Ionicons name="analytics-outline" size={13} color={meta.tone} />
              <Chip.Label>{t('directory.resultsCount', { count })}</Chip.Label>
            </Chip>
          </View>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
  tone,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone: string;
}) {
  return (
    <HeroButton size="sm" variant={selected ? 'primary' : 'secondary'} className="max-w-[136px]" onPress={onPress}>
      <HeroButton.Label numberOfLines={1}>{label}</HeroButton.Label>
      {selected ? <AccentIcon name="checkmark-outline" size={13} /> : <Ionicons name="add-outline" size={13} color={tone} />}
    </HeroButton>
  );
}

function FeatureUnavailableCard({
  mode,
  t,
  theme,
  primary,
}: {
  mode: DirectoryMode;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
}) {
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="items-center gap-4 p-6">
        <View className="size-14 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#f59e0b', 0.14) }}>
          <Ionicons name="shield-outline" size={28} color="#f59e0b" />
        </View>
        <View className="gap-2">
          <Text className="text-center text-lg font-bold" style={{ color: theme.text }}>
            {t(`directory.${mode}.unavailableTitle`)}
          </Text>
          <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t(`directory.${mode}.unavailableDescription`)}
          </Text>
        </View>
        <HeroButton variant="secondary" onPress={() => router.replace('/(modals)/federation')}>
          <Ionicons name="git-network-outline" size={16} color={primary} />
          <HeroButton.Label>{t('directory.backToHub')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function PartnerCard({ partner, t, theme, primary }: { partner: FederatedTenant; t: (key: string, opts?: Record<string, unknown>) => string; theme: ReturnType<typeof useTheme>; primary: string }) {
  const connectedDate = formatDate(partner.connected_since ?? partner.partnership_since);
  const federationLevel = partner.federation_level_name?.trim();
  const externalLabel = t('directory.external');
  const shouldShowExternalChip = partner.is_external && federationLevel?.toLowerCase() !== externalLabel.toLowerCase();

  return (
    <NativePressable
      accessibilityLabel={partner.name}
      className="mb-3 rounded-panel"
      onPress={() => {
        router.push({ pathname: '/(modals)/federation-partner', params: { id: String(partner.id) } });
      }}
      feedback="highlight"
    >
      <HeroCard
        variant="default"
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
      >
        <HeroCard.Body className="gap-3 p-4">
          <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: primary }} />
          <View className="flex-row items-start gap-3 pl-1">
            <View
              className="rounded-full p-1"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.18) }}
            >
              <Avatar uri={partner.logo} name={partner.name} size={48} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>{partner.name}</Text>
              {partner.location ? (
                <View className="flex-row items-center gap-1">
                  <Ionicons name="location-outline" size={13} color={theme.textSecondary} />
                  <Text className="min-w-0 flex-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {partner.location}
                  </Text>
                </View>
              ) : null}
              {partner.tagline || partner.description ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                  {partner.tagline || partner.description}
                </Text>
              ) : null}
            </View>
            <View className="size-8 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.1) }}>
              <Ionicons name="chevron-forward-outline" size={17} color={primary} />
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2 pl-1">
            <Chip size="sm" variant="secondary">
              <Ionicons name="people-outline" size={12} color={primary} />
              <Chip.Label>{t('directory.memberCount', { count: partner.member_count ?? 0 })}</Chip.Label>
            </Chip>
            {federationLevel ? (
              <Chip size="sm" variant="secondary"><Chip.Label numberOfLines={1}>{federationLevel}</Chip.Label></Chip>
            ) : null}
            {shouldShowExternalChip ? (
              <Chip size="sm" variant="secondary" color="warning"><Chip.Label>{externalLabel}</Chip.Label></Chip>
            ) : null}
            {connectedDate ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="time-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t('connectedSince', { date: connectedDate })}</Chip.Label>
              </Chip>
            ) : null}
          </View>
          <Text className="pl-1 text-sm font-semibold" style={{ color: primary }} numberOfLines={1}>
            {t('hub.viewCommunity')}
          </Text>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function MemberCard({ member, t, theme, primary }: { member: FederatedMember; t: (key: string, opts?: Record<string, unknown>) => string; theme: ReturnType<typeof useTheme>; primary: string }) {
  const name = displayMemberName(member, t('directory.members.memberFallback'));
  const communityName = member.timebank?.name ?? member.tenant_name ?? t('directory.unknownCommunity');
  const tenantId = member.is_external
    ? externalTenantIdFromFederatedId(member.id) ?? member.tenant_id ?? member.timebank?.id
    : member.tenant_id ?? member.timebank?.id;
  const reach = member.service_reach === 'local_only' || member.service_reach === 'remote_ok' || member.service_reach === 'travel_ok'
    ? member.service_reach
    : null;

  return (
    <HeroCard
      variant="default"
      className="mb-3 overflow-hidden rounded-panel p-0"
      style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
    >
      <HeroCard.Body className="gap-3 p-4">
        <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: primary }} />
        <View className="flex-row items-start gap-3 pl-1">
          <View
            className="rounded-full p-1"
            style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.18) }}
          >
            <Avatar uri={member.avatar ?? null} name={name} size={48} />
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="gap-1">
              <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>{name}</Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="secondary">
                  <Ionicons name="globe-outline" size={12} color={primary} />
                  <Chip.Label numberOfLines={1}>{communityName}</Chip.Label>
                </Chip>
                {member.is_external ? <Chip size="sm" variant="secondary" color="warning"><Chip.Label>{t('directory.external')}</Chip.Label></Chip> : null}
                {reach ? (
                  <Chip size="sm" variant="secondary">
                    <Ionicons name={reachIcon(reach)} size={12} color={primary} />
                    <Chip.Label>{t(`directory.members.reach.${reach}`)}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
            </View>
          </View>
        </View>
        {member.bio ? (
          <Surface
            variant="secondary"
            className="rounded-panel-inner p-3"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{member.bio}</Text>
          </Surface>
        ) : null}
        {member.skills?.length ? (
          <View className="flex-row flex-wrap gap-2 pl-1">
            {member.skills.slice(0, 5).map((skill) => (
              <Chip key={skill} size="sm" variant="secondary">
                <Ionicons name="sparkles-outline" size={12} color={primary} />
                <Chip.Label numberOfLines={1}>{skill}</Chip.Label>
              </Chip>
            ))}
          </View>
        ) : null}
        <Surface
          variant="secondary"
          className="rounded-panel-inner p-2"
          style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
        >
        <View className="flex-row flex-wrap gap-2">
          {tenantId ? (
            <HeroButton
              size="sm"
              variant="primary"
              className="min-w-[46%] flex-1"
              onPress={() => router.push({
                pathname: '/(modals)/federation-member',
                params: member.is_external
                  ? { id: String(member.id), tenant_id: String(tenantId), name }
                : { id: String(member.id), tenant_id: String(tenantId) },
              } as unknown as Href)}
            >
              <AccentIcon name="person-outline" size={14} />
              <HeroButton.Label>{t('directory.members.viewProfile')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {tenantId ? (
            <HeroButton size="sm" variant="secondary" className="min-w-[46%] flex-1" onPress={() => router.push({ pathname: '/(modals)/federation-messages', params: { compose: 'true', to_user: String(member.id), to_tenant: String(tenantId), name, community: communityName } } as unknown as Href)}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={primary} />
              <HeroButton.Label>{t('directory.members.message')}</HeroButton.Label>
            </HeroButton>
          ) : null}
        </View>
        </Surface>
      </HeroCard.Body>
    </HeroCard>
  );
}

function listingCommunityName(listing: FederatedListing, t: (key: string, opts?: Record<string, unknown>) => string) {
  return listing.timebank?.name ?? listing.partner_name ?? t('directory.unknownCommunity');
}

function listingAuthorName(listing: FederatedListing, t: (key: string, opts?: Record<string, unknown>) => string) {
  return listing.author?.name ?? t('directory.listings.anonymousUser');
}

function externalListingAuthorProfileId(listing: FederatedListing): string | number | null {
  if (!listing.author?.id) return null;
  if (!listing.is_external) return listing.author.id;
  const rawAuthorId = String(listing.author.id);
  if (rawAuthorId.startsWith('ext-')) return rawAuthorId;
  const partnerId = externalPartnerIdFromFederatedId(listing.id);
  return partnerId ? `ext-${partnerId}-${rawAuthorId}` : null;
}

function ListingCard({
  listing,
  t,
  theme,
  primary,
  onPress,
}: {
  listing: FederatedListing;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  onPress: () => void;
}) {
  const isOffer = listing.type === 'offer';
  const typeColor = isOffer ? '#22c55e' : '#f59e0b';
  const authorName = listingAuthorName(listing, t);
  const community = listingCommunityName(listing, t);
  const listingImage = resolvedMediaUrl(listing.image_url);
  return (
    <NativePressable
      className="mb-3"
      accessibilityLabel={t('directory.listings.openDetails', { title: listing.title })}
      onPress={onPress}
      feedback="highlight"
    >
      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: typeColor }} />
        <HeroCard.Body className="gap-2.5 p-3.5 pl-5">
          <View className="flex-row items-start gap-3">
            <View
              className="h-16 w-16 overflow-hidden rounded-panel-inner"
              style={{ backgroundColor: withAlpha(typeColor, 0.1), borderWidth: 1, borderColor: withAlpha(typeColor, 0.18) }}
            >
              {listingImage ? (
                <Image source={{ uri: listingImage }} className="h-full w-full bg-surface" resizeMode="cover" />
              ) : (
                <View className="h-full w-full items-center justify-center">
                  <Ionicons name={isOffer ? 'hand-left-outline' : 'search-outline'} size={27} color={typeColor} />
                </View>
              )}
            </View>
            <View className="min-w-0 flex-1 gap-2">
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="secondary" color={isOffer ? 'success' : 'warning'}>
                  <Chip.Label>{isOffer ? t('directory.listings.offer') : t('directory.listings.request')}</Chip.Label>
                </Chip>
                {listing.category_name ? <Chip size="sm" variant="secondary"><Chip.Label>{listing.category_name}</Chip.Label></Chip> : null}
                {listing.is_external ? <Chip size="sm" variant="secondary"><Chip.Label>{t('directory.external')}</Chip.Label></Chip> : null}
              </View>
              <View className="gap-1">
                <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>{listing.title}</Text>
                <View className="flex-row items-center gap-1">
                  <Ionicons name="person-outline" size={13} color={theme.textMuted} />
                  <Text className="min-w-0 flex-1 text-xs font-semibold" style={{ color: theme.textMuted }} numberOfLines={1}>{authorName}</Text>
                </View>
              </View>
            </View>
            <View
              className="h-8 w-8 items-center justify-center rounded-2xl"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
            >
              <Ionicons name="chevron-forward-outline" size={17} color={primary} />
            </View>
          </View>
          {listing.description ? (
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{listing.description}</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary">
              <Ionicons name="globe-outline" size={12} color={primary} />
              <Chip.Label>{community}</Chip.Label>
            </Chip>
            {listing.location ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="location-outline" size={12} color={primary} />
                <Chip.Label>{listing.location}</Chip.Label>
              </Chip>
            ) : null}
            {listing.estimated_hours ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="time-outline" size={12} color={primary} />
                <Chip.Label>{t('directory.listings.hours', { hours: listing.estimated_hours })}</Chip.Label>
              </Chip>
            ) : null}
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function ListingDetailView({
  listing,
  t,
  theme,
  primary,
  onBack,
}: {
  listing: FederatedListing;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  onBack: () => void;
}) {
  const isOffer = listing.type === 'offer';
  const typeColor = isOffer ? '#22c55e' : '#f59e0b';
  const tenantId = listing.is_external
    ? externalTenantIdFromFederatedId(listing.id) ?? listing.timebank?.id
    : listing.timebank?.id;
  const authorProfileId = externalListingAuthorProfileId(listing);
  const authorName = listingAuthorName(listing, t);
  const canOpenAuthor = Boolean(authorProfileId && tenantId);
  const canMessageAuthor = Boolean(listing.author?.id && tenantId);

  function openAuthorProfile() {
    if (!authorProfileId || !tenantId) return;
    router.push({
      pathname: '/(modals)/federation-member',
      params: listing.is_external
        ? { id: String(authorProfileId), tenant_id: String(tenantId), name: authorName }
        : { id: String(authorProfileId), tenant_id: String(tenantId) },
    } as unknown as Href);
  }

  function messageAuthor() {
    if (!listing.author?.id || !tenantId) return;
    router.push({
      pathname: '/(modals)/federation-messages',
      params: { compose: 'true', to_user: String(listing.author.id), to_tenant: String(tenantId), name: authorName, community: listingCommunityName(listing, t) },
    } as unknown as Href);
  }

  return (
    <View className="gap-4">
      <HeroButton variant="secondary" onPress={onBack}>
        <Ionicons name="arrow-back-outline" size={16} color={primary} />
        <HeroButton.Label>{t('directory.listings.backToListings')}</HeroButton.Label>
      </HeroButton>

      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="h-1.5" style={{ backgroundColor: typeColor }} />
        <HeroCard.Body className="gap-4 p-4">
          {resolvedMediaUrl(listing.image_url) ? (
            <Image source={{ uri: resolvedMediaUrl(listing.image_url)! }} className="h-52 w-full rounded-panel-inner bg-surface" resizeMode="cover" />
          ) : (
            <Surface
              variant="secondary"
              className="h-36 items-center justify-center gap-2 rounded-panel-inner"
              style={{ backgroundColor: withAlpha(typeColor, 0.12), borderWidth: 1, borderColor: withAlpha(typeColor, 0.18) }}
            >
              <Ionicons name={isOffer ? 'hand-left-outline' : 'search-outline'} size={42} color={typeColor} />
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textMuted }}>
                {isOffer ? t('directory.listings.offer') : t('directory.listings.request')}
              </Text>
            </Surface>
          )}

          <View className="gap-2">
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary" color={isOffer ? 'success' : 'warning'}>
                <Chip.Label>{isOffer ? t('directory.listings.offer') : t('directory.listings.request')}</Chip.Label>
              </Chip>
              {listing.category_name ? <Chip size="sm" variant="secondary"><Chip.Label>{listing.category_name}</Chip.Label></Chip> : null}
              {listing.is_external ? <Chip size="sm" variant="secondary"><Chip.Label>{t('directory.external')}</Chip.Label></Chip> : null}
            </View>
            <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{listing.title}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
              {listing.description?.trim() ? listing.description : t('directory.listings.noDescription')}
            </Text>
          </View>

          <View className="gap-2">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textMuted }}>{t('directory.listings.details')}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary">
                <Ionicons name="globe-outline" size={12} color={primary} />
                <Chip.Label>{listingCommunityName(listing, t)}</Chip.Label>
              </Chip>
              {listing.location ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="location-outline" size={12} color={primary} />
                  <Chip.Label>{listing.location}</Chip.Label>
                </Chip>
              ) : null}
              {listing.estimated_hours ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="time-outline" size={12} color={primary} />
                  <Chip.Label>{t('directory.listings.hours', { hours: listing.estimated_hours })}</Chip.Label>
                </Chip>
              ) : null}
              {listing.created_at ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="calendar-outline" size={12} color={primary} />
                  <Chip.Label>{formatDate(listing.created_at)}</Chip.Label>
                </Chip>
              ) : null}
            </View>
          </View>
        </HeroCard.Body>
      </HeroCard>

      <HeroCard
        className="rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <HeroCard.Body className="gap-3 p-4">
          <Text className="text-xs font-bold uppercase" style={{ color: theme.textMuted }}>{t('directory.listings.postedBy')}</Text>
          <Surface
            variant="secondary"
            className="flex-row items-center gap-3 rounded-panel-inner p-3"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <View
              className="rounded-full p-1"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.18) }}
            >
              <Avatar uri={listing.author?.avatar ?? null} name={authorName} size={48} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{authorName}</Text>
              <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>{listingCommunityName(listing, t)}</Text>
            </View>
          </Surface>
          <View className="flex-row flex-wrap gap-2">
            {canOpenAuthor ? (
              <HeroButton size="sm" variant="secondary" onPress={openAuthorProfile}>
                <Ionicons name="person-outline" size={14} color={primary} />
                <HeroButton.Label>{t('directory.listings.viewProfile')}</HeroButton.Label>
              </HeroButton>
            ) : null}
            {canMessageAuthor ? (
              <HeroButton size="sm" variant="primary" onPress={messageAuthor}>
                <AccentIcon name="chatbubble-ellipses-outline" size={14} />
                <HeroButton.Label>{t('directory.listings.contactAuthor')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

function GroupCard({
  group,
  t,
  theme,
  primary,
  onPress,
}: {
  group: FederatedGroup;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  onPress: () => void;
}) {
  const community = group.timebank?.name ?? group.partner_name ?? t('directory.unknownCommunity');
  const tone = modeMeta.groups.tone;
  return (
    <NativePressable
      className="mb-3"
      accessibilityLabel={t('directory.groups.openDetails', { name: group.name })}
      onPress={onPress}
      feedback="highlight"
    >
      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: tone }} />
        {resolvedMediaUrl(group.cover_image) ? (
          <Image source={{ uri: resolvedMediaUrl(group.cover_image)! }} className="h-32 w-full bg-surface" resizeMode="cover" />
        ) : null}
        <HeroCard.Body className="gap-3 p-4 pl-5">
          <View className="flex-row items-start gap-3">
            <View
              className="size-12 items-center justify-center rounded-2xl"
              style={{ backgroundColor: withAlpha(tone, 0.14), borderWidth: 1, borderColor: withAlpha(tone, 0.18) }}
            >
              <Ionicons name={group.privacy === 'private' ? 'lock-closed-outline' : 'people-circle-outline'} size={24} color={tone} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>{group.name}</Text>
              {group.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{group.description}</Text> : null}
            </View>
            <View
              className="h-8 w-8 items-center justify-center rounded-2xl"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
            >
              <Ionicons name="chevron-forward-outline" size={17} color={primary} />
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary">
              <Ionicons name="globe-outline" size={12} color={primary} />
              <Chip.Label>{community}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="secondary">
              <Ionicons name="people-outline" size={12} color={primary} />
              <Chip.Label>{t('directory.groups.memberCount', { count: group.member_count ?? 0 })}</Chip.Label>
            </Chip>
            {group.privacy ? <Chip size="sm" variant="secondary"><Chip.Label>{t(`directory.groups.privacy.${group.privacy}`, { defaultValue: group.privacy })}</Chip.Label></Chip> : null}
            {group.is_external || group.external_partner_id ? <Chip size="sm" variant="secondary"><Chip.Label>{t('directory.external')}</Chip.Label></Chip> : null}
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function GroupDetailView({
  group,
  t,
  theme,
  primary,
  onBack,
}: {
  group: FederatedGroup;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  onBack: () => void;
}) {
  const community = group.timebank?.name ?? group.partner_name ?? t('directory.unknownCommunity');
  const tone = modeMeta.groups.tone;
  return (
    <View className="gap-4">
      <HeroButton variant="secondary" onPress={onBack}>
        <Ionicons name="arrow-back-outline" size={16} color={primary} />
        <HeroButton.Label>{t('directory.groups.backToGroups')}</HeroButton.Label>
      </HeroButton>

      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        {resolvedMediaUrl(group.cover_image) ? <Image source={{ uri: resolvedMediaUrl(group.cover_image)! }} className="h-44 w-full bg-surface" resizeMode="cover" /> : <View className="h-1.5" style={{ backgroundColor: tone }} />}
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View
              className="size-13 items-center justify-center rounded-3xl"
              style={{ backgroundColor: withAlpha(tone, 0.14), borderWidth: 1, borderColor: withAlpha(tone, 0.18) }}
            >
              <Ionicons name={group.privacy === 'private' ? 'lock-closed-outline' : 'people-circle-outline'} size={25} color={tone} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textMuted }}>{t('directory.groups.detailEyebrow')}</Text>
              <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{group.name}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {group.description?.trim() ? group.description : t('directory.groups.noDescription')}
              </Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary">
              <Ionicons name="globe-outline" size={12} color={primary} />
              <Chip.Label>{community}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="secondary">
              <Ionicons name="people-outline" size={12} color={primary} />
              <Chip.Label>{t('directory.groups.memberCount', { count: group.member_count ?? 0 })}</Chip.Label>
            </Chip>
            {group.privacy ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name={group.privacy === 'private' ? 'lock-closed-outline' : 'earth-outline'} size={12} color={primary} />
                <Chip.Label>{t(`directory.groups.privacy.${group.privacy}`, { defaultValue: group.privacy })}</Chip.Label>
              </Chip>
            ) : null}
            {group.created_at ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="calendar-outline" size={12} color={primary} />
                <Chip.Label>{formatDate(group.created_at)}</Chip.Label>
              </Chip>
            ) : null}
            {group.is_external || group.external_partner_id ? <Chip size="sm" variant="secondary"><Chip.Label>{t('directory.external')}</Chip.Label></Chip> : null}
          </View>
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

function EventCard({
  event,
  t,
  theme,
  primary,
  onPress,
}: {
  event: FederatedEvent;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  onPress: () => void;
}) {
  const startDate = formatDate(event.start_date);
  const organizerName = event.organizer?.name?.trim() || t('directory.events.organizerFallback');
  const community = event.timebank?.name ?? t('directory.unknownCommunity');
  const tone = modeMeta.events.tone;
  return (
    <NativePressable
      className="mb-3"
      accessibilityLabel={t('directory.events.openDetails', { title: event.title })}
      onPress={onPress}
      feedback="highlight"
    >
      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: tone }} />
        <HeroCard.Body className="gap-3 p-4 pl-5">
          {resolvedMediaUrl(event.cover_image) ? (
            <Image source={{ uri: resolvedMediaUrl(event.cover_image)! }} className="h-36 w-full rounded-panel-inner bg-surface" resizeMode="cover" />
          ) : null}
          <View className="flex-row items-start gap-3">
            <Surface
              variant="secondary"
              className="w-16 items-center rounded-panel-inner p-2"
              style={{ backgroundColor: withAlpha(tone, 0.1), borderWidth: 1, borderColor: withAlpha(tone, 0.18) }}
            >
              <Ionicons name="calendar-outline" size={18} color={tone} />
              <Text className="text-center text-xs font-bold" style={{ color: theme.text }} numberOfLines={2}>{startDate}</Text>
            </Surface>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>{event.title}</Text>
              {event.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{event.description}</Text> : null}
            </View>
            <View
              className="h-8 w-8 items-center justify-center rounded-2xl"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
            >
              <Ionicons name="chevron-forward-outline" size={17} color={primary} />
            </View>
          </View>
          <Surface
            variant="secondary"
            className="flex-row items-center gap-2 rounded-panel-inner p-2.5"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <Avatar uri={event.organizer?.avatar ?? null} name={organizerName} size={32} />
            <View className="min-w-0 flex-1">
              <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textMuted }} numberOfLines={1}>
                {t('directory.events.organizer')}
              </Text>
              <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {organizerName}
              </Text>
            </View>
          </Surface>
          <View className="flex-row flex-wrap gap-2">
            {event.is_online ? <Chip size="sm" variant="secondary" color="success"><Chip.Label>{t('directory.events.online')}</Chip.Label></Chip> : null}
            {event.location ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="location-outline" size={12} color={primary} />
                <Chip.Label>{event.location}</Chip.Label>
              </Chip>
            ) : null}
            <Chip size="sm" variant="secondary">
              <Ionicons name="globe-outline" size={12} color={primary} />
              <Chip.Label>{community}</Chip.Label>
            </Chip>
            {typeof event.attendees_count === 'number' ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="people-outline" size={12} color={primary} />
                <Chip.Label>{t('directory.events.attendeeCount', { count: event.attendees_count })}</Chip.Label>
              </Chip>
            ) : null}
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function EventDetailView({
  event,
  t,
  theme,
  primary,
  onBack,
}: {
  event: FederatedEvent;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  onBack: () => void;
}) {
  const community = event.timebank?.name ?? t('directory.unknownCommunity');
  const organizerName = event.organizer?.name?.trim() || t('directory.events.organizerFallback');
  const tone = modeMeta.events.tone;
  return (
    <View className="gap-4">
      <HeroButton variant="secondary" onPress={onBack}>
        <Ionicons name="arrow-back-outline" size={16} color={primary} />
        <HeroButton.Label>{t('directory.events.backToEvents')}</HeroButton.Label>
      </HeroButton>

      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        {resolvedMediaUrl(event.cover_image) ? <Image source={{ uri: resolvedMediaUrl(event.cover_image)! }} className="h-52 w-full bg-surface" resizeMode="cover" /> : <View className="h-1.5" style={{ backgroundColor: tone }} />}
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View
              className="size-13 items-center justify-center rounded-3xl"
              style={{ backgroundColor: withAlpha(tone, 0.14), borderWidth: 1, borderColor: withAlpha(tone, 0.18) }}
            >
              <Ionicons name="calendar-outline" size={25} color={tone} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textMuted }}>{t('directory.events.detailEyebrow')}</Text>
              <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{event.title}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {event.description?.trim() ? event.description : t('directory.events.noDescription')}
              </Text>
            </View>
          </View>

          <Surface
            variant="secondary"
            className="flex-row items-center gap-3 rounded-panel-inner p-3"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <View
              className="rounded-full p-1"
              style={{ backgroundColor: withAlpha(tone, 0.1), borderWidth: 1, borderColor: withAlpha(tone, 0.18) }}
            >
              <Avatar uri={event.organizer?.avatar ?? null} name={organizerName} size={42} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textMuted }} numberOfLines={1}>
                {t('directory.events.organizer')}
              </Text>
              <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                {organizerName}
              </Text>
            </View>
          </Surface>

          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary">
              <Ionicons name="calendar-outline" size={12} color={primary} />
              <Chip.Label>{formatDate(event.start_date)}</Chip.Label>
            </Chip>
            {event.end_date ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="time-outline" size={12} color={primary} />
                <Chip.Label>{t('directory.events.ends', { date: formatDate(event.end_date) })}</Chip.Label>
              </Chip>
            ) : null}
            {event.is_online ? <Chip size="sm" variant="secondary" color="success"><Chip.Label>{t('directory.events.online')}</Chip.Label></Chip> : null}
            {event.location ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="location-outline" size={12} color={primary} />
                <Chip.Label>{event.location}</Chip.Label>
              </Chip>
            ) : null}
            <Chip size="sm" variant="secondary">
              <Ionicons name="globe-outline" size={12} color={primary} />
              <Chip.Label>{community}</Chip.Label>
            </Chip>
            {typeof event.attendees_count === 'number' ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="people-outline" size={12} color={primary} />
                <Chip.Label>{t('directory.events.attendeeCount', { count: event.attendees_count })}</Chip.Label>
              </Chip>
            ) : null}
          </View>
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

function MessageCard({
  thread,
  t,
  theme,
  primary,
  onPress,
}: {
  thread: FederatedThread;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  onPress: () => void;
}) {
  const { partner, lastMessage: message } = thread;
  const partnerName = displayFederationPartnerName(partner, t('directory.messages.unknownSender'));
  const tone = modeMeta.messages.tone;
  const showStatusChip = !(thread.unreadCount > 0 && message.status === 'unread');

  return (
    <NativePressable
      className="mb-3"
      accessibilityLabel={t('directory.messages.openThread', { name: partnerName })}
      onPress={onPress}
      feedback="highlight"
    >
      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: tone }} />
        <HeroCard.Body className="gap-2.5 p-3.5 pl-5">
          <View className="flex-row items-start gap-3">
            <View
              className="rounded-full p-1"
              style={{ backgroundColor: withAlpha(tone, 0.1), borderWidth: 1, borderColor: withAlpha(tone, 0.18) }}
            >
              <Avatar uri={partner.avatar ?? null} name={partnerName} size={44} />
            </View>
            <View className="min-w-0 flex-1 gap-2">
              <View className="min-w-0 gap-1">
                <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={1}>{partnerName}</Text>
                <View className="flex-row items-center gap-1">
                  <Ionicons name="business-outline" size={13} color={theme.textMuted} />
                  <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {partner.tenant_name ?? t('directory.unknownCommunity')}
                  </Text>
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {thread.unreadCount > 0 ? (
                  <Chip size="sm" variant="secondary" color="warning">
                    <Chip.Label>{t('directory.messages.unreadCount', { count: thread.unreadCount })}</Chip.Label>
                  </Chip>
                ) : null}
                {showStatusChip ? (
                  <Chip size="sm" variant="secondary" color={message.status === 'unread' ? 'warning' : 'default'}>
                    <Chip.Label>{message.status ?? t('directory.messages.delivered')}</Chip.Label>
                  </Chip>
                ) : null}
                <Chip size="sm" variant="secondary">
                  <Ionicons name="time-outline" size={12} color={theme.textMuted} />
                  <Chip.Label>{formatDate(message.created_at)}</Chip.Label>
                </Chip>
              </View>
              <View className="gap-0.5">
                {message.subject ? <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{message.subject}</Text> : null}
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{message.body}</Text>
              </View>
            </View>
            <View
              className="h-8 w-8 items-center justify-center rounded-2xl"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
            >
              <Ionicons name="chevron-forward-outline" size={17} color={primary} />
            </View>
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function MessageThreadView({
  thread,
  t,
  theme,
  primary,
  canTranslate,
  onBack,
  onSent,
}: {
  thread: FederatedThread;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  canTranslate: boolean;
  onBack: () => void;
  onSent: (message?: FederatedMessage) => void;
}) {
  const { i18n } = useTranslation();
  const { show: showToast } = useAppToast();
  const partnerName = displayFederationPartnerName(thread.partner, t('directory.messages.unknownSender'));
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translationErrors, setTranslationErrors] = useState<Record<string, boolean>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});
  const [showOriginalIds, setShowOriginalIds] = useState<Record<string, boolean>>({});
  const canSend = reply.trim().length > 0 && !isSending;
  const targetLanguage = (i18n.language || 'en').split('-')[0] || 'en';

  async function sendReply() {
    if (!reply.trim()) return;
    setIsSending(true);
    try {
      const response = await sendFederationMessage({
        receiver_id: thread.partner.id,
        receiver_tenant_id: thread.partner.tenant_id ?? '',
        subject: thread.lastMessage.subject ?? '',
        body: reply.trim(),
        reference_message_id: thread.lastMessage.id,
      });
      setReply('');
      onSent(response.data);
    } catch {
      showToast({ title: t('directory.messages.sendFailedTitle'), description: t('directory.messages.sendFailedDescription'), variant: 'danger' });
    } finally {
      setIsSending(false);
    }
  }

  async function translateMessage(message: FederatedMessage) {
    const key = String(message.id);
    if (translations[key]) {
      setShowOriginalIds((current) => ({ ...current, [key]: !current[key] }));
      return;
    }
    setTranslatingIds((current) => ({ ...current, [key]: true }));
    setTranslationErrors((current) => ({ ...current, [key]: false }));
    try {
      const response = await translateFederationMessage(message.id, targetLanguage);
      const payload = (response as { data?: { translated_text?: string } }).data ?? (response as { translated_text?: string });
      const translated = payload?.translated_text?.trim();
      if (!translated) throw new Error('No translated text returned');
      setTranslations((current) => ({ ...current, [key]: translated }));
      setShowOriginalIds((current) => ({ ...current, [key]: false }));
    } catch {
      setTranslationErrors((current) => ({ ...current, [key]: true }));
    } finally {
      setTranslatingIds((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <View className="gap-4">
      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="h-1.5" style={{ backgroundColor: modeMeta.messages.tone }} />
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View
              className="rounded-full p-1"
              style={{ backgroundColor: withAlpha(modeMeta.messages.tone, 0.1), borderWidth: 1, borderColor: withAlpha(modeMeta.messages.tone, 0.18) }}
            >
              <Avatar uri={thread.partner.avatar ?? null} name={partnerName} size={52} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                {t('directory.messages.threadEyebrow')}
              </Text>
              <Text className="text-xl font-bold" style={{ color: theme.text }} numberOfLines={2}>
                {partnerName}
              </Text>
              <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {thread.partner.tenant_name ?? t('directory.unknownCommunity')}
              </Text>
            </View>
          </View>
          <HeroButton variant="secondary" onPress={onBack}>
            <Ionicons name="arrow-back-outline" size={16} color={primary} />
            <HeroButton.Label>{t('directory.messages.backToInbox')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>

      <View className="gap-3">
        {thread.messages.map((message) => {
          const outbound = message.direction === 'outbound';
          const key = String(message.id);
          const translated = translations[key];
          const showOriginal = showOriginalIds[key] === true;
          return (
            <View key={String(message.id)} className={outbound ? 'items-end' : 'items-start'}>
              <Surface
                variant={outbound ? 'default' : 'secondary'}
                className="max-w-[88%] rounded-panel p-3"
                style={{
                  borderWidth: 1,
                  borderColor: outbound ? withAlpha(primary, 0.24) : theme.borderSubtle,
                  ...(outbound ? { backgroundColor: withAlpha(primary, 0.18) } : {}),
                }}
              >
                {message.subject ? (
                  <Text className="mb-1 text-sm font-semibold" style={{ color: theme.text }}>{message.subject}</Text>
                ) : null}
                <Text className="text-sm leading-5" style={{ color: theme.text }}>{translated && !showOriginal ? translated : message.body}</Text>
                {translated && !showOriginal ? (
                  <Chip size="sm" variant="secondary" className="mt-2 self-start">
                    <Ionicons name="language-outline" size={12} color={primary} />
                    <Chip.Label>{t('directory.messages.translatedLabel')}</Chip.Label>
                  </Chip>
                ) : null}
                {!outbound && canTranslate ? (
                  <View className="mt-2 gap-1">
                    <HeroButton
                      size="sm"
                      variant="secondary"
                      isDisabled={translatingIds[key]}
                      onPress={() => void translateMessage(message)}
                      accessibilityLabel={translated && !showOriginal ? t('directory.messages.showOriginal') : t('directory.messages.translate')}
                    >
                      {translatingIds[key] ? <Spinner size="sm" /> : <Ionicons name="language-outline" size={14} color={primary} />}
                      <HeroButton.Label>{translated && !showOriginal ? t('directory.messages.showOriginal') : t('directory.messages.translate')}</HeroButton.Label>
                    </HeroButton>
                    {translationErrors[key] ? (
                      <Text className="text-xs" style={{ color: theme.error }}>{t('directory.messages.translateFailed')}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Text className="mt-2 text-[11px]" style={{ color: theme.textMuted }}>
                  {formatDate(message.created_at)}
                </Text>
              </Surface>
            </View>
          );
        })}
      </View>

      <HeroCard
        className="rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <HeroCard.Body className="gap-3 p-4">
          <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('directory.messages.reply')}</Text>
          <Input
            value={reply}
            onChangeText={setReply}
            placeholder={t('directory.messages.replyPlaceholder')}
            placeholderTextColor={theme.textMuted}
            multiline
            textAlignVertical="top"
            containerClassName="mb-0"
            inputClassName="min-h-28 flex-1 rounded-panel-inner border border-border bg-surface px-4 py-3 text-base"
            style={{ color: theme.text }}
          />
          <HeroButton variant="primary" isDisabled={!canSend} onPress={() => void sendReply()} style={{ backgroundColor: canSend ? primary : theme.border }}>
            {isSending ? <Spinner size="sm" /> : <AccentIcon name="send-outline" size={17} />}
            <HeroButton.Label>{t('directory.messages.sendReply')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

function FederationComposeCard({
  toUser,
  toTenant,
  initialName,
  initialCommunity,
  theme,
  primary,
  t,
  onSent,
}: {
  toUser?: string;
  toTenant?: string;
  initialName?: string;
  initialCommunity?: string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onSent: (message?: FederatedMessage) => void;
}) {
  const { show: showToast } = useAppToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<FederatedMember | null>(null);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<FederatedMember[]>([]);
  const [isSearchingRecipients, setIsSearchingRecipients] = useState(false);
  const selectedRecipientTenantId = selectedRecipient?.tenant_id ?? selectedRecipient?.timebank?.id;
  const effectiveToUser = selectedRecipient?.id ?? toUser;
  const effectiveToTenant = selectedRecipientTenantId ?? toTenant;
  const hasTarget = !!effectiveToUser && !!effectiveToTenant;
  const shouldLookupRecipient = !!toUser && !!toTenant && !selectedRecipient && !String(toTenant).startsWith('ext-');

  const { data: recipientData, isLoading: isLoadingRecipient } = useApi(
    () => getFederationMember(toUser as string, toTenant as string),
    [toUser, toTenant],
    { enabled: shouldLookupRecipient },
  );
  const recipient = selectedRecipient ?? (shouldLookupRecipient ? recipientData?.data as FederatedMember | undefined : undefined);
  const recipientName = displayMemberName(recipient ?? { id: toUser ?? '', name: initialName }, t('directory.messages.recipientFallback'));
  const recipientCommunity = (recipient?.timebank?.name ?? recipient?.tenant_name ?? initialCommunity?.trim()) || t('directory.unknownCommunity');
  const canSend = hasTarget && body.trim().length > 0 && !isSending;

  useEffect(() => {
    if (hasTarget || !recipientQuery.trim()) {
      setRecipientResults([]);
      setIsSearchingRecipients(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearchingRecipients(true);
      try {
        const response = await getFederationMembers({ q: recipientQuery.trim(), limit: '8' });
        if (!cancelled) {
          setRecipientResults(unwrapArray<FederatedMember>(response));
        }
      } catch {
        if (!cancelled) setRecipientResults([]);
      } finally {
        if (!cancelled) setIsSearchingRecipients(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasTarget, recipientQuery]);

  async function handleSend() {
    if (!effectiveToUser || !effectiveToTenant || !body.trim()) return;
    setIsSending(true);
    try {
      const response = await sendFederationMessage({
        receiver_id: effectiveToUser,
        receiver_tenant_id: effectiveToTenant,
        subject: subject.trim(),
        body: body.trim(),
      });
      setSubject('');
      setBody('');
      showToast({ title: t('directory.messages.sentTitle'), description: t('directory.messages.sentDescription', { name: recipientName }), variant: 'success' });
      onSent(response.data);
    } catch {
      showToast({ title: t('directory.messages.sendFailedTitle'), description: t('directory.messages.sendFailedDescription'), variant: 'danger' });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <HeroCard
      className="mb-4 overflow-hidden rounded-panel p-0"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <View className="h-1.5" style={{ backgroundColor: modeMeta.messages.tone }} />
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View
            className="rounded-full p-1"
            style={{ backgroundColor: withAlpha(modeMeta.messages.tone, 0.1), borderWidth: 1, borderColor: withAlpha(modeMeta.messages.tone, 0.18) }}
          >
            <Avatar uri={recipient?.avatar ?? null} name={recipientName} size={50} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
              {t('directory.messages.composeEyebrow')}
            </Text>
            <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={2}>
              {isLoadingRecipient ? t('directory.messages.loadingRecipient') : recipientName}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary">
                <Ionicons name="globe-outline" size={12} color={primary} />
                <Chip.Label>{recipientCommunity}</Chip.Label>
              </Chip>
              <Chip size="sm" variant="secondary" color="success">
                <Ionicons name="shield-checkmark-outline" size={12} color={theme.success} />
                <Chip.Label>{t('directory.messages.federated')}</Chip.Label>
              </Chip>
            </View>
          </View>
        </View>

        {!hasTarget ? (
          <View className="gap-3">
            <Surface
              variant="secondary"
              className="rounded-panel-inner p-3"
              style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
            >
              <Text className="text-sm" style={{ color: theme.textSecondary }}>
                {t('directory.messages.noRecipient')}
              </Text>
            </Surface>
            <View className="gap-2">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('directory.messages.recipientSearch')}</Text>
              <Input
                value={recipientQuery}
                onChangeText={setRecipientQuery}
                placeholder={t('directory.messages.recipientSearchPlaceholder')}
                placeholderTextColor={theme.textMuted}
                containerClassName="mb-0"
                inputClassName="flex-1 rounded-panel-inner border border-border bg-surface px-4 py-3 text-base"
                style={{ color: theme.text }}
              />
            </View>
            {isSearchingRecipients ? (
              <Surface variant="secondary" className="items-center rounded-panel-inner p-3">
                <Spinner size="sm" />
              </Surface>
            ) : recipientResults.length > 0 ? (
              <View className="gap-2">
                {recipientResults.map((candidate) => {
                  const candidateTenantId = candidate.tenant_id ?? candidate.timebank?.id;
                  const candidateName = displayMemberName(candidate, t('directory.messages.recipientFallback'));
                  const candidateCommunity = candidate.timebank?.name ?? candidate.tenant_name ?? t('directory.unknownCommunity');
                  return (
                    <HeroButton
                      key={`${candidateTenantId ?? 'tenant'}-${candidate.id}`}
                      variant="secondary"
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedRecipient(candidate);
                        setRecipientQuery('');
                        setRecipientResults([]);
                      }}
                      accessibilityLabel={t('directory.messages.selectRecipient', { name: candidateName })}
                      className="justify-start"
                    >
                      <Avatar uri={candidate.avatar ?? null} name={candidateName} size={32} />
                      <View className="min-w-0 flex-1 items-start">
                        <HeroButton.Label>{candidateName}</HeroButton.Label>
                        <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                          {candidateCommunity}
                        </Text>
                      </View>
                    </HeroButton>
                  );
                })}
              </View>
            ) : recipientQuery.trim() ? (
              <Text className="text-sm" style={{ color: theme.textSecondary }}>
                {t('directory.messages.noRecipientsFound')}
              </Text>
            ) : null}
          </View>
        ) : selectedRecipient ? (
          <HeroButton
            variant="secondary"
            onPress={() => {
              setSelectedRecipient(null);
              setRecipientQuery('');
              setRecipientResults([]);
            }}
            accessibilityLabel={t('directory.messages.changeRecipient')}
          >
            <Ionicons name="swap-horizontal-outline" size={16} color={primary} />
            <HeroButton.Label>{t('directory.messages.changeRecipient')}</HeroButton.Label>
          </HeroButton>
        ) : null}

        <View className="gap-2">
          <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('directory.messages.subject')}</Text>
          <Input
            value={subject}
            onChangeText={setSubject}
            placeholder={t('directory.messages.subjectPlaceholder')}
            placeholderTextColor={theme.textMuted}
            containerClassName="mb-0"
            inputClassName="flex-1 rounded-panel-inner border border-border bg-surface px-4 py-3 text-base"
            style={{ color: theme.text }}
          />
        </View>

        <View className="gap-2">
          <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('directory.messages.body')}</Text>
          <Input
            value={body}
            onChangeText={setBody}
            placeholder={t('directory.messages.bodyPlaceholder')}
            placeholderTextColor={theme.textMuted}
            multiline
            textAlignVertical="top"
            containerClassName="mb-0"
            inputClassName="min-h-32 flex-1 rounded-panel-inner border border-border bg-surface px-4 py-3 text-base"
            style={{ color: theme.text }}
          />
        </View>

        <HeroButton variant="primary" isDisabled={!canSend} onPress={() => void handleSend()} style={{ backgroundColor: canSend ? primary : theme.border }}>
          {isSending ? <Spinner size="sm" /> : <AccentIcon name="send-outline" size={17} />}
          <HeroButton.Label>{t('directory.messages.send')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function SettingsScreen({ theme, primary, t }: { theme: ReturnType<typeof useTheme>; primary: string; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const { show: showToast } = useAppToast();
  const { data, isLoading, refresh } = useApi(() => getFederationSettings(), []);
  const payload = unwrapSettings(data);
  const [draft, setDraft] = useState<FederationSettings | null>(null);
  const current = draft ?? payload.settings;
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const federationEnabled = enabledOverride ?? payload.enabled;
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  async function save() {
    setIsSaving(true);
    try {
      await updateFederationSettings(current);
      setDraft(null);
      refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleFederationStatus() {
    setIsTogglingStatus(true);
    try {
      if (federationEnabled) {
        await optOutFederation();
        setEnabledOverride(false);
      } else {
        await optInFederation();
        setEnabledOverride(true);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh();
    } catch {
      showToast({ title: t('directory.settings.statusFailedTitle'), description: t('directory.settings.statusFailedDescription'), variant: 'danger' });
    } finally {
      setIsTogglingStatus(false);
    }
  }

  if (isLoading) {
    return <View className="items-center py-8"><Spinner size="lg" /></View>;
  }

  return (
    <View className="gap-4">
      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="h-1.5" style={{ backgroundColor: federationEnabled ? '#22c55e' : '#f59e0b' }} />
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <View
              className="size-11 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: withAlpha(federationEnabled ? '#22c55e' : '#f59e0b', 0.14),
                borderWidth: 1,
                borderColor: withAlpha(federationEnabled ? '#22c55e' : '#f59e0b', 0.2),
              }}
            >
              <Ionicons name={federationEnabled ? 'shield-checkmark-outline' : 'shield-outline'} size={22} color={federationEnabled ? '#22c55e' : '#f59e0b'} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-lg font-bold leading-6" style={{ color: theme.text }} numberOfLines={1}>
                {federationEnabled ? t('directory.settings.active') : t('directory.settings.inactive')}
              </Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                {t('directory.settings.statusDescription')}
              </Text>
            </View>
          </View>

          <HeroButton
            variant={federationEnabled ? 'danger-soft' : 'primary'}
            onPress={() => void toggleFederationStatus()}
            isDisabled={isTogglingStatus}
            accessibilityLabel={federationEnabled ? t('directory.settings.disable') : t('directory.settings.enable')}
          >
            {isTogglingStatus ? <Spinner size="sm" /> : <Ionicons name={federationEnabled ? 'shield-outline' : 'shield-checkmark-outline'} size={16} color={federationEnabled ? theme.error : '#fff'} />}
            <HeroButton.Label>{federationEnabled ? t('directory.settings.disable') : t('directory.settings.enable')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>

      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <HeroCard.Body className="gap-1.5 p-2.5">
          {settingKeys.map((key) => {
            const selected = current[key] === true;
            return (
              <Surface
                key={key}
                variant={selected ? 'secondary' : 'transparent'}
                className="flex-row items-center justify-between gap-2.5 rounded-panel-inner px-2.5 py-2"
                style={{ borderWidth: 1, borderColor: selected ? withAlpha(primary, 0.16) : theme.borderSubtle }}
              >
                <View
                  className="size-9 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: withAlpha(primary, selected ? 0.14 : 0.08) }}
                >
                  <Ionicons name={settingIcon(key)} size={18} color={selected ? primary : theme.textMuted} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{t(`directory.settings.${key}.label`)}</Text>
                  <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{t(`directory.settings.${key}.description`)}</Text>
                </View>
                <Toggle
                  value={selected}
                  size="sm"
                  accessibilityLabel={t(`directory.settings.${key}.label`)}
                  onValueChange={(value) => setDraft((prev) => ({ ...(prev ?? current), [key]: value }))}
                />
              </Surface>
            );
          })}
        </HeroCard.Body>
      </HeroCard>

      <HeroCard
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <HeroCard.Body className="gap-3 p-3">
          <View className="flex-row flex-wrap gap-2">
            {(['local_only', 'remote_ok', 'travel_ok'] as const).map((reach) => (
              <HeroButton
                key={reach}
                size="sm"
                variant={current.service_reach === reach ? 'primary' : 'secondary'}
                onPress={() => setDraft((prev) => ({ ...(prev ?? current), service_reach: reach }))}
              >
                <Ionicons name={reachIcon(reach)} size={14} color={current.service_reach === reach ? '#fff' : primary} />
                <HeroButton.Label>{t(`directory.settings.reach.${reach}`)}</HeroButton.Label>
              </HeroButton>
            ))}
          </View>

          <HeroButton
            variant="primary"
            onPress={save}
            isDisabled={isSaving}
            accessibilityLabel={t('directory.settings.save')}
          >
            {isSaving ? <Spinner size="sm" /> : <AccentIcon name="save-outline" size={16} />}
            <HeroButton.Label>{t('directory.settings.save')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

function settingIcon(key: (typeof settingKeys)[number]): IoniconName {
  if (key === 'profile_visible_federated') return 'person-outline';
  if (key === 'appear_in_federated_search') return 'search-outline';
  if (key === 'show_skills_federated') return 'sparkles-outline';
  if (key === 'show_location_federated') return 'location-outline';
  if (key === 'show_reviews_federated') return 'star-outline';
  if (key === 'messaging_enabled_federated') return 'chatbubbles-outline';
  if (key === 'transactions_enabled_federated') return 'swap-horizontal-outline';
  return 'mail-outline';
}

function reachIcon(reach: NonNullable<FederationSettings['service_reach']>): IoniconName {
  if (reach === 'local_only') return 'home-outline';
  if (reach === 'remote_ok') return 'laptop-outline';
  return 'navigate-outline';
}

export default function FederationDirectoryScreen({ mode }: { mode: DirectoryMode }) {
  const { t } = useTranslation(['federation', 'common']);
  const params = useLocalSearchParams<{ partner_id?: string; q?: string; compose?: string; to_user?: string; to_tenant?: string; name?: string; community?: string }>();
  const [search, setSearch] = useState(params.q ?? '');
  const [selectedPartner, setSelectedPartner] = useState(params.partner_id ? String(params.partner_id) : '');
  const [serviceReach, setServiceReach] = useState<ServiceReachFilter>('all');
  const [skills, setSkills] = useState('');
  const [listingType, setListingType] = useState<ListingTypeFilter>('all');
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [activeListing, setActiveListing] = useState<FederatedListing | null>(null);
  const [activeGroup, setActiveGroup] = useState<FederatedGroup | null>(null);
  const [activeEvent, setActiveEvent] = useState<FederatedEvent | null>(null);
  const [localFederationMessages, setLocalFederationMessages] = useState<FederatedMessage[]>([]);
  const primary = usePrimaryColor();
  const { hasFeature } = useTenant();
  const theme = useTheme();
  const meta = modeMeta[mode];

  useEffect(() => {
    setSearch(params.q ?? '');
    setSelectedPartner(params.partner_id ? String(params.partner_id) : '');
    setActiveThreadKey(null);
    setActiveListing(null);
    setActiveGroup(null);
    setActiveEvent(null);
  }, [mode, params.partner_id, params.q]);

  const queryParams = useMemo(() => {
    const result: Record<string, string> = { per_page: '30' };
    if (search.trim()) result.q = search.trim();
    if (selectedPartner) result.partner_id = selectedPartner;
    if (mode === 'members' && serviceReach !== 'all') result.service_reach = serviceReach;
    if (mode === 'members' && skills.trim()) result.skills = skills.trim();
    if (mode === 'listings' && listingType !== 'all') result.type = listingType;
    if (mode === 'events' && upcomingOnly) result.upcoming = 'true';
    return result;
  }, [listingType, mode, search, selectedPartner, serviceReach, skills, upcomingOnly]);

  const { data: partnerFilterData } = useApi<unknown>(
    () => getFederationPartners(null),
    [],
    { enabled: mode === 'members' || mode === 'messages' || mode === 'listings' || mode === 'groups' || mode === 'events' },
  );
  const partnerFilters = unwrapArray<FederatedTenant>(partnerFilterData as { data?: FederatedTenant[] } | FederatedTenant[] | null);

  const fetchDirectoryPage = useCallback((cursor: string | null) => {
    const params = { ...queryParams };
    if (cursor) params.cursor = cursor;
    if (mode === 'partners') return getFederationPartners(cursor) as Promise<unknown>;
    if (mode === 'members') return getFederationMembers(params) as Promise<unknown>;
    if (mode === 'listings') return getFederationListings(params) as Promise<unknown>;
    if (mode === 'groups') return getFederationGroups(params) as Promise<unknown>;
    if (mode === 'events') return getFederationEvents(params) as Promise<unknown>;
    return Promise.resolve({ data: [], meta: { cursor: null, has_more: false } });
  }, [mode, queryParams]);

  const extractDirectoryPage = useCallback((response: unknown) => (
    unwrapFederationPage<DirectoryItem>(response as { data?: DirectoryItem[]; meta?: { cursor?: string | null; next_cursor?: string | null; has_more?: boolean } } | DirectoryItem[] | null)
  ), []);

  const directoryPage = usePaginatedApi<DirectoryItem, unknown>(
    fetchDirectoryPage,
    extractDirectoryPage,
    [mode, JSON.stringify(queryParams)],
  );

  const { data: messageData, isLoading: isLoadingMessages, error: messageError, refresh: refreshMessages } = useApi<unknown>(
    () => getFederationMessages(),
    [mode],
    { enabled: mode === 'messages' },
  );

  const remoteItems = mode === 'messages'
    ? unwrapArray<DirectoryItem>(messageData as { data?: DirectoryItem[] } | DirectoryItem[] | null)
    : directoryPage.items;
  const items = mode === 'messages'
    ? mergeFederationMessages(remoteItems as FederatedMessage[], localFederationMessages) as DirectoryItem[]
    : remoteItems;
  const isLoading = mode === 'messages' ? isLoadingMessages : directoryPage.isLoading;
  const error = mode === 'messages' ? messageError : directoryPage.error;
  const refresh = mode === 'messages' ? refreshMessages : directoryPage.refresh;
  const hasMore = mode !== 'messages' && mode !== 'settings' && directoryPage.hasMore;
  const isLoadingMore = mode !== 'messages' && mode !== 'settings' && directoryPage.isLoadingMore;
  const loadMore = directoryPage.loadMore;
  const messageThreads = useMemo(() => mode === 'messages' ? buildMessageThreads(items as FederatedMessage[]) : [], [items, mode]);
  const visibleMessageThreads = useMemo(
    () => (mode === 'messages' && selectedPartner
      ? messageThreads.filter((thread) => threadMatchesPartner(thread, selectedPartner))
      : messageThreads),
    [messageThreads, mode, selectedPartner],
  );
  const activeThread = useMemo(() => visibleMessageThreads.find((thread) => thread.key === activeThreadKey) ?? null, [visibleMessageThreads, activeThreadKey]);
  const showSearch = (mode === 'members' || mode === 'listings' || mode === 'groups' || mode === 'events') && !activeListing && !activeGroup && !activeEvent;
  const disabledFeature = isFeatureDisabledError(error);
  const isComposeRequested = mode === 'messages' && params.compose === 'true';
  const isEmpty = mode === 'messages' ? visibleMessageThreads.length === 0 : items.length === 0;

  async function openThread(thread: FederatedThread) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveThreadKey(thread.key);
    const unreadIds = thread.messages.filter((message) => message.direction === 'inbound' && message.status === 'unread').map((message) => message.id);
    if (unreadIds.length > 0) {
      await markFederationMessagesReadBatch(unreadIds).catch(() => null);
      refresh();
    }
  }

  const handleFederationMessageSent = useCallback((message?: FederatedMessage) => {
    const key = message ? getThreadKeyForMessage(message) : null;
    if (message && key) {
      setLocalFederationMessages((current) => (
        current.some((existing) => String(existing.id) === String(message.id))
          ? current
          : [...current, message]
      ));
      setActiveThreadKey(key);
    }
    refresh();
  }, [refresh]);

  function openListing(listing: FederatedListing) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveListing(listing);
  }

  function openGroup(group: FederatedGroup) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveGroup(group);
  }

  function openEvent(event: FederatedEvent) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveEvent(event);
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t(`directory.${mode}.title`)} backLabel={t('common:back')} fallbackHref="/(modals)/federation" />
        <ScrollView
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        >
          <HeaderCard mode={mode} count={mode === 'settings' ? undefined : (mode === 'messages' ? visibleMessageThreads.length : items.length)} theme={theme} t={t} />

          {isComposeRequested && !activeThread && !activeListing && !activeGroup && !activeEvent ? (
            <FederationComposeCard
              toUser={params.to_user ? String(params.to_user) : undefined}
              toTenant={params.to_tenant ? String(params.to_tenant) : undefined}
              initialName={params.name ? String(params.name) : undefined}
              initialCommunity={params.community ? String(params.community) : undefined}
              theme={theme}
              primary={primary}
              t={t}
              onSent={handleFederationMessageSent}
            />
          ) : null}

          {showSearch ? (
            <Surface variant="secondary" className="mb-4 gap-3 rounded-panel p-4">
              <Input
                value={search}
                onChangeText={setSearch}
                placeholder={t(`directory.${mode}.search`)}
                leftIcon={<Ionicons name="search-outline" size={18} color={theme.textSecondary} />}
              />

              {mode === 'members' ? (
                <Input
                  value={skills}
                  onChangeText={setSkills}
                  placeholder={t('directory.members.skillsSearch')}
                  leftIcon={<Ionicons name="sparkles-outline" size={18} color={theme.textSecondary} />}
                />
              ) : null}

              {partnerFilters.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  <FilterChip label={t('directory.filters.allCommunities')} selected={!selectedPartner} onPress={() => setSelectedPartner('')} tone={primary} />
                  {partnerFilters.map((partner) => (
                    <FilterChip
                      key={String(partner.id)}
                      label={partner.name}
                      selected={selectedPartner === String(partner.id)}
                      onPress={() => setSelectedPartner(String(partner.id))}
                      tone={primary}
                    />
                  ))}
                </View>
              ) : null}
              {mode === 'members' ? (
                <View className="flex-row flex-wrap gap-2">
                  {serviceReachFilters.map((reach) => (
                    <FilterChip
                      key={reach}
                      label={t(`directory.members.reach.${reach}`)}
                      selected={serviceReach === reach}
                      onPress={() => setServiceReach(reach)}
                      tone={primary}
                    />
                  ))}
                </View>
              ) : null}

              {mode === 'listings' ? (
                <View className="flex-row flex-wrap gap-2">
                  {listingTypeFilters.map((type) => (
                    <FilterChip
                      key={type}
                      label={t(`directory.listings.type.${type}`)}
                      selected={listingType === type}
                      onPress={() => setListingType(type)}
                      tone={primary}
                    />
                  ))}
                </View>
              ) : null}

              {mode === 'events' ? (
                <FilterChip
                  label={t('directory.events.upcomingOnly')}
                  selected={upcomingOnly}
                  onPress={() => setUpcomingOnly((value) => !value)}
                  tone={primary}
                />
              ) : null}
            </Surface>
          ) : null}

          {mode === 'messages' && partnerFilters.length > 0 ? (
            <Surface variant="secondary" className="mb-4 rounded-panel p-4">
              <View className="flex-row flex-wrap gap-2">
                <FilterChip label={t('directory.filters.allCommunities')} selected={!selectedPartner} onPress={() => setSelectedPartner('')} tone={primary} />
                {partnerFilters.map((partner) => (
                  <FilterChip
                    key={String(partner.id)}
                    label={partner.name}
                    selected={selectedPartner === String(partner.id)}
                    onPress={() => setSelectedPartner(String(partner.id))}
                    tone={primary}
                  />
                ))}
              </View>
            </Surface>
          ) : null}

          {mode === 'settings' ? (
            <SettingsScreen theme={theme} primary={primary} t={t} />
          ) : activeListing ? (
            <ListingDetailView
              listing={activeListing}
              t={t}
              theme={theme}
              primary={primary}
              onBack={() => setActiveListing(null)}
            />
          ) : activeGroup ? (
            <GroupDetailView
              group={activeGroup}
              t={t}
              theme={theme}
              primary={primary}
              onBack={() => setActiveGroup(null)}
            />
          ) : activeEvent ? (
            <EventDetailView
              event={activeEvent}
              t={t}
              theme={theme}
              primary={primary}
              onBack={() => setActiveEvent(null)}
            />
          ) : activeThread ? (
            <MessageThreadView
              thread={activeThread}
              t={t}
              theme={theme}
              primary={primary}
              canTranslate={hasFeature('message_translation')}
              onBack={() => setActiveThreadKey(null)}
              onSent={handleFederationMessageSent}
            />
          ) : isLoading ? (
            <View className="items-center py-8"><Spinner size="lg" /></View>
          ) : disabledFeature ? (
            <FeatureUnavailableCard mode={mode} t={t} theme={theme} primary={primary} />
          ) : error ? (
            <Surface variant="secondary" className="items-center gap-3 rounded-panel p-5">
              <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
              <Text className="text-center text-sm" style={{ color: theme.text }}>{error}</Text>
              <HeroButton variant="secondary" onPress={refresh}><HeroButton.Label>{t('directory.tryAgain')}</HeroButton.Label></HeroButton>
            </Surface>
          ) : isEmpty ? (
            <Surface
              variant="secondary"
              className="overflow-hidden rounded-panel p-0"
              style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
            >
              <View className="items-center gap-3 px-5 py-7">
                <View
                  className="h-14 w-14 items-center justify-center rounded-3xl"
                  style={{ backgroundColor: withAlpha(meta.tone, 0.12), borderWidth: 1, borderColor: withAlpha(meta.tone, 0.18) }}
                >
                  <Ionicons name={meta.icon} size={27} color={meta.tone} />
                </View>
                <View className="gap-1">
                  <Text className="text-center text-lg font-bold leading-6" style={{ color: theme.text }}>
                    {mode === 'messages' && selectedPartner ? t('directory.messages.emptyForPartnerTitle') : t(`directory.${mode}.emptyTitle`)}
                  </Text>
                  <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {mode === 'messages' && selectedPartner ? t('directory.messages.emptyForPartnerDescription') : t(`directory.${mode}.emptyDescription`)}
                  </Text>
                </View>
              </View>
            </Surface>
          ) : (
            <View>
              {mode === 'partners' && (items as FederatedTenant[]).map((item) => <PartnerCard key={String(item.id)} partner={item} t={t} theme={theme} primary={primary} />)}
              {mode === 'members' && (items as FederatedMember[]).map((item) => <MemberCard key={`${item.timebank?.id ?? item.tenant_id}-${item.id}`} member={item} t={t} theme={theme} primary={primary} />)}
              {mode === 'listings' && (items as FederatedListing[]).map((item) => (
                <ListingCard
                  key={`${item.timebank?.id ?? 'listing'}-${item.id}`}
                  listing={item}
                  t={t}
                  theme={theme}
                  primary={primary}
                  onPress={() => openListing(item)}
                />
              ))}
              {mode === 'groups' && (items as FederatedGroup[]).map((item) => (
                <GroupCard
                  key={`${item.timebank?.id ?? item.partner_name ?? 'group'}-${item.id}`}
                  group={item}
                  t={t}
                  theme={theme}
                  primary={primary}
                  onPress={() => openGroup(item)}
                />
              ))}
              {mode === 'events' && (items as FederatedEvent[]).map((item) => (
                <EventCard
                  key={`${item.timebank?.id ?? 'event'}-${item.id}`}
                  event={item}
                  t={t}
                  theme={theme}
                  primary={primary}
                  onPress={() => openEvent(item)}
                />
              ))}
              {mode === 'messages' && visibleMessageThreads.map((thread) => (
                <MessageCard
                  key={thread.key}
                  thread={thread}
                  t={t}
                  theme={theme}
                  primary={primary}
                  onPress={() => void openThread(thread)}
                />
              ))}
              {hasMore ? (
                <HeroButton
                  variant="secondary"
                  onPress={loadMore}
                  isDisabled={isLoadingMore}
                  className="mt-2"
                >
                  {isLoadingMore ? <Spinner size="sm" /> : <Ionicons name="download-outline" size={16} color={primary} />}
                  <HeroButton.Label>{t(`directory.${mode}.loadMore`)}</HeroButton.Label>
                </HeroButton>
              ) : null}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
