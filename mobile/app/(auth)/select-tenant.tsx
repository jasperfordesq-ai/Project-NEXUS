// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button as HeroButton, Card as HeroCard, Chip, Separator, Spinner } from 'heroui-native';
import * as Haptics from '@/lib/haptics';

import { listTenants, type TenantListItem } from '@/lib/api/tenant';
import { useAuthContext } from '@/lib/context/AuthContext';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import NativePressable from '@/components/ui/NativePressable';
import Button from '@/components/ui/Button';

export default function SelectTenantScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const router = useRouter();
  const { isAuthenticated } = useAuthContext();
  const { setTenantSlug, tenantSlug } = useTenant();
  const primary = usePrimaryColor();
  const { data, isLoading, error, refresh } = useApi(() => listTenants());

  const tenants = data?.data ?? [];
  const activeTenant = tenants.find((tenant) => tenant.slug === tenantSlug);

  async function handleSelect(tenant: TenantListItem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setTenantSlug(tenant.slug);
    router.replace(isAuthenticated ? '/home' : '/login');
  }

  const ItemSeparator = useCallback(() => <View className="h-3" />, []);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <FlatList<TenantListItem>
        data={!isLoading && !error ? tenants : []}
        keyExtractor={(item) => String(item.id)}
        ItemSeparatorComponent={ItemSeparator}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        ListHeaderComponent={
          <View className="gap-4 mb-5">
            <View className="flex-row items-center justify-between">
              <HeroButton
                variant="ghost"
                size="sm"
                onPress={() => router.replace(isAuthenticated ? '/home' : '/login')}
                accessibilityLabel={t(
                  isAuthenticated ? 'selectTenant.backToHome' : 'selectTenant.backToLogin',
                )}
              >
                <Ionicons name="arrow-back" size={18} color={primary} />
                <HeroButton.Label>{t('selectTenant.back')}</HeroButton.Label>
              </HeroButton>
            </View>

            <HeroCard className="overflow-hidden">
              <View className="h-1.5 bg-accent" />
              <HeroCard.Header className="px-5 pt-5 pb-2">
                <View
                  className="w-12 h-12 rounded-2xl items-center justify-center mb-3"
                  style={{ backgroundColor: primary }}
                  accessibilityRole="image"
                  accessibilityLabel={t('selectTenant.iconLabel')}
                >
                  <Ionicons name="business-outline" size={24} color="#fff" />
                </View>
                <HeroCard.Title className="text-2xl font-bold">
                  {t('selectTenant.title')}
                </HeroCard.Title>
                <HeroCard.Description className="mt-1">
                  {t('selectTenant.subtitle')}
                </HeroCard.Description>
              </HeroCard.Header>
              {activeTenant ? (
                <HeroCard.Footer className="px-5 pb-5 pt-2">
                  <Chip size="sm" variant="secondary">
                    {t('selectTenant.current', { name: activeTenant.name })}
                  </Chip>
                </HeroCard.Footer>
              ) : null}
            </HeroCard>
          </View>
        }
        renderItem={({ item }) => {
          const isActive = item.slug === tenantSlug;

          /**
           * 🔴 NativePressable, NOT HeroButton. Wrapping a full-width card in a
           * HeroButton sized the card to its own content and centred it, and — the
           * damaging part — gave the `flex-1` name block ZERO width, so the community
           * NAME and its subtitle rendered invisibly. Every row showed nothing but a
           * one-letter badge and a chevron, on the screen a member uses to choose which
           * community to sign in to.
           *
           * 🔴 This was broken at EVERY width. It was found while checking narrow screens
           * and looked like a narrow-screen fault; the control at 411dp was identical,
           * which is the only reason it was not filed as one. Always run the wide-screen
           * control before blaming the width.
           *
           * Same shape as the SafeAreaView finding in components/safeAreaFlex.test.ts: a
           * `flex-1` child collapses to nothing when its parent has no definite size.
           * NativePressable is a plain Pressable, so it takes the width it is given.
           */
          return (
            <NativePressable
              feedback="scale"
              className="w-full"
              onPress={() => void handleSelect(item)}
              accessibilityLabel={item.name}
              accessibilityState={{ selected: isActive }}
            >
              <HeroCard variant={isActive ? 'secondary' : 'default'} className="overflow-hidden">
                {isActive ? <View className="h-1 bg-accent" /> : null}
                <HeroCard.Body className="px-4 py-4">
                  <View className="flex-row items-center gap-3">
                    {item.logo_url ? (
                      <Image
                        source={{ uri: resolveImageUrl(item.logo_url) ?? item.logo_url }}
                        style={{ width: 48, height: 48, borderRadius: 16 }}
                        contentFit="contain"
                      />
                    ) : (
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center"
                        style={{ backgroundColor: primary }}
                      >
                        <Text className="text-white font-bold text-lg">
                          {item.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}

                    <View className="flex-1">
                      <Text className="text-base font-semibold text-foreground">
                        {item.name}
                      </Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        {isActive ? t('selectTenant.selected') : t('selectTenant.tapToChoose')}
                      </Text>
                    </View>

                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        isActive ? 'bg-accent/15' : 'bg-default/10'
                      }`}
                    >
                      <Ionicons
                        name={isActive ? 'checkmark' : 'chevron-forward'}
                        size={18}
                        color={primary}
                      />
                    </View>
                  </View>
                </HeroCard.Body>
              </HeroCard>
            </NativePressable>
          );
        }}
        ListEmptyComponent={
          <View className="mt-6">
            {isLoading ? (
              <HeroCard>
                <HeroCard.Body className="items-center py-10">
                  <Spinner />
                  <Text className="text-muted-foreground text-sm mt-3">
                    {t('selectTenant.loading')}
                  </Text>
                </HeroCard.Body>
              </HeroCard>
            ) : error ? (
              <HeroCard>
                <HeroCard.Body className="items-center py-10 px-5">
                  <Ionicons name="alert-circle-outline" size={34} color={primary} />
                  <Text className="text-foreground font-semibold mt-3">
                    {t('selectTenant.errorTitle')}
                  </Text>
                  <Text className="text-muted-foreground text-sm text-center mt-1">
                    {error}
                  </Text>
                  <View className="w-full mt-5">
                    <Button onPress={() => void refresh()} variant="outline" fullWidth>
                      {t('common:buttons.retry')}
                    </Button>
                  </View>
                </HeroCard.Body>
              </HeroCard>
            ) : (
              <HeroCard>
                <HeroCard.Body className="items-center py-10 px-5">
                  <Ionicons name="business-outline" size={34} color={primary} />
                  <Text className="text-foreground font-semibold mt-3">
                    {t('selectTenant.emptyTitle')}
                  </Text>
                  <Text className="text-muted-foreground text-sm text-center mt-1">
                    {t('selectTenant.empty')}
                  </Text>
                </HeroCard.Body>
              </HeroCard>
            )}
          </View>
        }
        ListFooterComponent={
          tenants.length > 0 && !isLoading && !error ? (
            <View className="mt-5">
              <Separator />
              <Text className="text-muted-foreground text-xs text-center mt-4">
                {t('selectTenant.footer')}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
