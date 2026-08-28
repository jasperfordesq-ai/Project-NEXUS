// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  createMarketplaceShippingOption,
  deleteMarketplaceShippingOption,
  getMarketplaceShippingOptions,
  updateMarketplaceShippingOption,
  type MarketplaceShippingOption,
} from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';

const CURRENCIES = ['EUR', 'GBP', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY'] as const;

interface ShippingFormState {
  courierName: string;
  price: string;
  currency: string;
  estimatedDays: string;
  isDefault: boolean;
}

function normalizeSupportedCurrency(value?: string | null): string {
  const candidate = value?.trim().toUpperCase() ?? '';
  return CURRENCIES.includes(candidate as (typeof CURRENCIES)[number]) ? candidate : '';
}

function createEmptyForm(currency: string): ShippingFormState {
  return {
    courierName: '',
    price: '',
    currency,
    estimatedDays: '',
    isDefault: false,
  };
}

function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(dateLocale(), { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export default function MarketplaceShippingOptionsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceShippingOptionsScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceShippingOptionsScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const { hasFeature, tenant } = useTenant();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const marketplaceEnabled = hasFeature('marketplace');
  const canLoadOptions = marketplaceEnabled && !isAuthLoading && isAuthenticated;
  const options = useApi(() => getMarketplaceShippingOptions(), [], { enabled: canLoadOptions });
  const defaultCurrency = normalizeSupportedCurrency(tenant?.currency);
  const [form, setForm] = useState<ShippingFormState>(() => createEmptyForm(defaultCurrency));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!marketplaceEnabled) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('shipping.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-tools' as Href} />
        <EmptyState icon="car-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
      </SafeAreaView>
    );
  }

  if (isAuthLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('shipping.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-tools' as Href} />
        <View className="flex-1 items-center justify-center">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('shipping.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-tools' as Href} />
        <View className="flex-1 justify-center px-4">
          <EmptyState
            icon="car-outline"
            title={t('shipping.signInTitle')}
            subtitle={t('shipping.signInHint')}
            actionLabel={t('auth:login.submit')}
            onAction={() => router.push('/(auth)/login' as Href)}
          />
        </View>
      </SafeAreaView>
    );
  }

  function update<K extends keyof ShippingFormState>(key: K, value: ShippingFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function edit(option: MarketplaceShippingOption) {
    setEditingId(option.id);
    setForm({
      courierName: option.courier_name,
      price: String(option.price),
      currency: option.currency || defaultCurrency,
      estimatedDays: option.estimated_days != null ? String(option.estimated_days) : '',
      isDefault: option.is_default,
    });
  }

  function reset() {
    setEditingId(null);
    setForm(createEmptyForm(defaultCurrency));
  }

  async function save() {
    const price = Number(form.price);
    const estimatedDays = form.estimatedDays ? Number(form.estimatedDays) : null;
    if (!form.courierName.trim() || !Number.isFinite(price) || price < 0) {
      showToast({ title: t('common:errors.alertTitle'), description: t('shipping.validation'), variant: 'warning' });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        courier_name: form.courierName.trim(),
        price,
        ...(form.currency ? { currency: form.currency } : {}),
        estimated_days: estimatedDays && Number.isFinite(estimatedDays) ? estimatedDays : null,
        is_default: form.isDefault,
      };
      if (editingId) {
        await updateMarketplaceShippingOption(editingId, payload);
      } else {
        await createMarketplaceShippingOption(payload);
      }
      reset();
      options.refresh();
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('shipping.saveFailed'),
        variant: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  }

  function confirmRemove(option: MarketplaceShippingOption) {
    confirm({
      title: t('shipping.deleteTitle'),
      message: t('shipping.deleteMessage', { name: option.courier_name }),
      confirmLabel: t('common:buttons.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => remove(option),
    });
  }

  async function remove(option: MarketplaceShippingOption) {
    try {
      await deleteMarketplaceShippingOption(option.id);
      if (editingId === option.id) reset();
      options.refresh();
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('shipping.deleteFailed'),
        variant: 'danger',
      });
    }
  }

  async function makeDefault(option: MarketplaceShippingOption) {
    try {
      await updateMarketplaceShippingOption(option.id, { is_default: true });
      options.refresh();
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('shipping.saveFailed'),
        variant: 'danger',
      });
    }
  }

  const data = options.data?.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('shipping.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-tools' as Href} />
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        ListHeaderComponent={
          <View>
            <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="car-outline" size={25} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('shipping.eyebrow')}</Text>
                    <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('shipping.title')}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('shipping.subtitle')}</Text>
                  </View>
                </View>

                <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
                  <FormInput label={t('shipping.courierName')} value={form.courierName} onChangeText={(value) => update('courierName', value)} placeholder={t('shipping.courierNamePlaceholder')} />
                  <View className="flex-row gap-2">
                    <FormInput label={t('shipping.price')} value={form.price} onChangeText={(value) => update('price', value)} placeholder={t('shipping.pricePlaceholder')} keyboardType="decimal-pad" />
                    <FormInput label={t('shipping.estimatedDays')} value={form.estimatedDays} onChangeText={(value) => update('estimatedDays', value)} placeholder={t('shipping.estimatedDaysPlaceholder')} keyboardType="number-pad" />
                  </View>
                  <View className="gap-2">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('shipping.currency')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {(form.currency && !CURRENCIES.includes(form.currency as (typeof CURRENCIES)[number])
                        ? [form.currency, ...CURRENCIES]
                        : CURRENCIES).map((currency) => (
                        <HeroButton key={currency} size="sm" variant={form.currency === currency ? 'primary' : 'secondary'} onPress={() => update('currency', currency)}>
                          <HeroButton.Label>{currency}</HeroButton.Label>
                        </HeroButton>
                      ))}
                    </ScrollView>
                  </View>
                  <HeroButton variant={form.isDefault ? 'primary' : 'secondary'} onPress={() => update('isDefault', !form.isDefault)}>
                    <Ionicons name={form.isDefault ? 'checkmark-circle-outline' : 'ellipse-outline'} size={16} color={form.isDefault ? '#fff' : primary} />
                    <HeroButton.Label>{t('shipping.defaultToggle')}</HeroButton.Label>
                  </HeroButton>
                  <View className="flex-row gap-2">
                    {editingId ? (
                      <HeroButton className="flex-1" variant="secondary" onPress={reset}>
                        <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
                      </HeroButton>
                    ) : null}
                    <HeroButton className="flex-1" variant="primary" onPress={() => void save()} isDisabled={isSaving}>
                      <HeroButton.Label>{editingId ? t('shipping.update') : t('shipping.create')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                </Surface>
              </HeroCard.Body>
            </HeroCard>
          </View>
        }
        renderItem={({ item }) => (
          <ShippingOptionRow
            option={item}
            onEdit={() => edit(item)}
            onDelete={() => confirmRemove(item)}
            onDefault={() => void makeDefault(item)}
          />
        )}
        ListEmptyComponent={
          options.isLoading ? (
            <View className="py-16"><LoadingSpinner /></View>
          ) : (
            <EmptyState icon="car-outline" title={options.error ?? t('shipping.empty')} subtitle={t('shipping.emptyHint')} />
          )
        }
      />
      {confirmDialog}
    </SafeAreaView>
  );
}

function ShippingOptionRow({
  option,
  onEdit,
  onDelete,
  onDefault,
}: {
  option: MarketplaceShippingOption;
  onEdit: () => void;
  onDelete: () => void;
  onDefault: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const price = formatCurrencyAmount(Number(option.price), option.currency);

  return (
    <HeroCard className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-3">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="car-outline" size={22} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1">
                <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{option.courier_name}</Text>
                <Text className="text-xs" style={{ color: theme.textSecondary }}>
                  {option.estimated_days ? t('shipping.estimatedDaysValue', { days: option.estimated_days }) : t('shipping.noEstimate')}
                </Text>
              </View>
              {option.is_default ? <Chip size="sm" variant="secondary"><Chip.Label>{t('shipping.default')}</Chip.Label></Chip> : null}
            </View>
            <Text className="text-lg font-bold" style={{ color: primary }}>{price}</Text>
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" size="sm" variant="secondary" onPress={onEdit}>
                <Ionicons name="create-outline" size={14} color={primary} />
                <HeroButton.Label>{t('owner.edit')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="secondary" onPress={onDefault} isDisabled={option.is_default}>
                <Ionicons name="checkmark-circle-outline" size={14} color={primary} />
                <HeroButton.Label>{t('shipping.makeDefault')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="danger" onPress={onDelete}>
                <Ionicons name="trash-outline" size={14} color="#fff" />
                <HeroButton.Label>{t('owner.delete')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View className="min-w-0 flex-1">
      <Input
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
      />
    </View>
  );
}
