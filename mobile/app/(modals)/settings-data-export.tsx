// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';
import { getDataExportHistory, requestDataExport, type DataExportFormat, type DataExportHistoryRow } from '@/lib/api/settings';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { withAlpha } from '@/lib/utils/color';

function formatBytes(bytes: number | null): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function SettingsDataExportScreen() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const [format, setFormat] = useState<DataExportFormat>('json');
  const [history, setHistory] = useState<DataExportHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      setHistory(await getDataExportHistory());
    } catch {
      showToast({ title: t('common:errors.generic'), description: t('dataExport.loadError'), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  }, [t, showToast]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const formatOptions = useMemo<{ value: DataExportFormat; label: string; help: string }[]>(
    () => [
      { value: 'json', label: t('dataExport.format.json'), help: t('dataExport.format.jsonHelp') },
      { value: 'zip', label: t('dataExport.format.zip'), help: t('dataExport.format.zipHelp') },
    ],
    [t],
  );

  async function handleRequest() {
    setIsRequesting(true);
    try {
      await requestDataExport(format);
      showToast({ title: t('dataExport.requested'), description: t('dataExport.requestedBody'), variant: 'success' });
      await loadHistory();
    } catch {
      showToast({ title: t('common:errors.generic'), description: t('dataExport.requestError'), variant: 'danger' });
    } finally {
      setIsRequesting(false);
    }
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('dataExport.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="download-outline" size={22} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Chip size="sm" variant="soft" color="accent">
                    <Chip.Label>{t('dataExport.privacyBadge')}</Chip.Label>
                  </Chip>
                  <Text className="mt-2 text-xl font-bold" style={{ color: theme.text }}>{t('dataExport.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('dataExport.subtitle')}</Text>
                  <Text className="mt-2 text-sm leading-5" style={{ color: theme.textSecondary }}>{t('dataExport.intro')}</Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('dataExport.format.label')}</Text>
              {formatOptions.map((option) => {
                const isSelected = option.value === format;
                return (
                  <HeroButton
                    key={option.value}
                    variant={isSelected ? 'primary' : 'secondary'}
                    onPress={() => setFormat(option.value)}
                    accessibilityLabel={option.label}
                  >
                    <HeroButton.Label>{option.label}</HeroButton.Label>
                  </HeroButton>
                );
              })}
              <Surface variant="secondary" className="rounded-panel-inner px-3 py-3">
                <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
                  {formatOptions.find((option) => option.value === format)?.help}
                </Text>
              </Surface>
              <HeroButton onPress={handleRequest} isDisabled={isRequesting}>
                <HeroButton.Label>{isRequesting ? t('dataExport.requesting') : t('dataExport.requestButton')}</HeroButton.Label>
              </HeroButton>
              <View className="flex-row items-start gap-2">
                <Ionicons name="warning-outline" size={16} color={theme.warning ?? primary} />
                <Text className="min-w-0 flex-1 text-xs leading-4" style={{ color: theme.textSecondary }}>{t('dataExport.warning')}</Text>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-base font-bold" style={{ color: theme.text }}>{t('dataExport.history.title')}</Text>
                <Chip size="sm" variant="soft" color="default">
                  <Chip.Label>{t('dataExport.history.count', { count: history.length })}</Chip.Label>
                </Chip>
              </View>
              {isLoading ? (
                <LoadingSpinner />
              ) : history.length === 0 ? (
                <EmptyState icon="document-text-outline" title={t('dataExport.history.empty')} subtitle={t('dataExport.history.emptyDesc')} />
              ) : (
                <View className="gap-2">
                  {history.map((row) => (
                    <Surface key={row.id} variant="secondary" className="rounded-panel-inner px-3 py-3">
                      <View className="flex-row items-center justify-between gap-3">
                        <View className="min-w-0 flex-1">
                          <Text className="text-sm font-semibold uppercase" style={{ color: theme.text }}>{row.format}</Text>
                          <Text className="text-xs" style={{ color: theme.textSecondary }}>{formatDate(row.requested_at, i18n.language)}</Text>
                        </View>
                        <Text className="text-xs font-semibold" style={{ color: theme.textMuted }}>{formatBytes(row.file_size_bytes)}</Text>
                      </View>
                    </Surface>
                  ))}
                </View>
              )}
            </HeroCard.Body>
          </HeroCard>

          <SourceRepositoryLink />
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
