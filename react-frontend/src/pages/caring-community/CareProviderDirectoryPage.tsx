import { Button } from '@/components/ui/Button';
import { CardBody, Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { SearchField } from '@/components/ui/SearchField';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tab, Tabs } from '@/components/ui/Tabs';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';

import BadgeCheck from 'lucide-react/icons/badge-check';
import AlertCircle from 'lucide-react/icons/alert-circle';
import Building2 from 'lucide-react/icons/building-2';
import Mail from 'lucide-react/icons/mail';
import Phone from 'lucide-react/icons/phone';
import Globe from 'lucide-react/icons/globe';
import Heart from 'lucide-react/icons/heart';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { useApi } from '@/hooks/useApi';
import { usePageTitle } from '@/hooks';
import { SubRegionFilter } from '@/components/caring-community/SubRegionFilter';
import { safeHref } from '@/lib/safeHref';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CareProvider {
  id: number;
  name: string;
  type: 'spitex' | 'tagesstätte' | 'private' | 'verein' | 'volunteer';
  description: string | null;
  categories: string[] | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website_url: string | null;
  opening_hours: Record<string, string> | null;
  is_verified: boolean;
}

interface DirectoryResponse {
  data: CareProvider[];
  total: number;
  per_page: number;
  current_page: number;
}

type ProviderType = 'all' | 'spitex' | 'tagesstätte' | 'private' | 'verein' | 'volunteer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ChipColor = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

function typeChipColor(type: CareProvider['type']): ChipColor {
  switch (type) {
    case 'spitex':       return 'primary';
    case 'tagesstätte':  return 'secondary';
    case 'private':      return 'warning';
    case 'verein':       return 'success';
    case 'volunteer':    return 'danger';
    default:             return 'default';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProviderCardSkeleton() {
  return (
    <Card className="p-4">
      <CardBody className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-5 w-2/3 rounded-lg" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full rounded-lg" />
        <Skeleton className="h-4 w-5/6 rounded-lg" />
        <div className="flex gap-3 pt-1">
          <Skeleton className="h-4 w-1/3 rounded-lg" />
          <Skeleton className="h-4 w-1/3 rounded-lg" />
        </div>
      </CardBody>
    </Card>
  );
}

interface ProviderCardProps {
  provider: CareProvider;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function providerTypeLabel(type: CareProvider['type'], t: (key: string) => string): string {
  const key = type === 'spitex'
    ? 'providers.filter_spitex'
    : type === 'tagesstätte'
      ? 'providers.filter_tagesstte'
      : type === 'private'
        ? 'providers.filter_private'
        : type === 'verein'
          ? 'providers.filter_verein'
          : 'providers.filter_volunteer';

  return t(key);
}

function ProviderCard({ provider, t }: ProviderCardProps) {
  return (
    <Card className="p-1 hover:shadow-md transition-shadow">
      <CardBody className="gap-2.5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {provider.is_verified && (
              <BadgeCheck
                className="h-4 w-4 shrink-0 text-accent"
                aria-label={t('providers.verified_badge')}
              />
            )}
            <h3 className="min-w-0 truncate font-semibold text-theme-primary">{provider.name}</h3>
          </div>
          <Chip size="sm" color={typeChipColor(provider.type)} variant="flat" className="shrink-0">
            {providerTypeLabel(provider.type, t)}
          </Chip>
        </div>

        {/* Description */}
        {provider.description && (
          <p className="line-clamp-2 break-words text-sm text-theme-muted">{provider.description}</p>
        )}

        {/* Address */}
        {provider.address && (
          <div className="flex items-start gap-1.5 text-sm text-theme-muted">
            <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{provider.address}</span>
          </div>
        )}

        {/* Contact row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {provider.contact_phone && (
            <a
              href={`tel:${provider.contact_phone}`}
              aria-label={t('providers.call_aria', { phone: provider.contact_phone })}
              className="flex items-center gap-1.5 text-theme-muted hover:text-accent transition-colors"
            >
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-all">{provider.contact_phone}</span>
            </a>
          )}
          {provider.contact_email && (
            <a
              href={`mailto:${provider.contact_email}`}
              aria-label={t('providers.email_aria', { email: provider.contact_email })}
              className="flex items-center gap-1.5 text-theme-muted hover:text-accent transition-colors"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[180px] truncate break-all">{provider.contact_email}</span>
            </a>
          )}
          {provider.website_url && (
            <a
              href={safeHref(provider.website_url)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('providers.website_aria', { url: provider.website_url })}
              className="flex items-center gap-1.5 text-theme-muted hover:text-accent transition-colors"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('providers.website')}</span>
            </a>
          )}
        </div>

        {/* Verified badge strip */}
        {provider.is_verified && (
          <div className="flex items-center gap-1.5 text-xs text-accent font-medium pt-0.5">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('providers.verified_badge')}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const FILTER_TABS: { key: ProviderType; labelKey: string }[] = [
  { key: 'all',          labelKey: 'providers.filter_all' },
  { key: 'spitex',       labelKey: 'providers.filter_spitex' },
  { key: 'tagesstätte',  labelKey: 'providers.filter_tagesstte' },
  { key: 'private',      labelKey: 'providers.filter_private' },
  { key: 'verein',       labelKey: 'providers.filter_verein' },
  { key: 'volunteer',    labelKey: 'providers.filter_volunteer' },
];

export default function CareProviderDirectoryPage() {
  const { t } = useTranslation('caring_community');
  const { hasFeature } = useTenant();
  usePageTitle(t('providers.title'));

  const [activeType, setActiveType] = useState<ProviderType>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [subRegionId, setSubRegionId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Build query string
  const params = new URLSearchParams();
  if (activeType !== 'all') params.set('type', activeType);
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (subRegionId !== null) params.set('sub_region_id', String(subRegionId));

  const queryString = params.toString();
  const apiPath = `/v2/caring-community/providers${queryString ? `?${queryString}` : ''}`;

  const { data: response, loading, error, refetch } = useApi<DirectoryResponse>(apiPath);

  if (!hasFeature('caring_community')) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Card className="border border-warning/30 bg-warning/5">
          <CardBody className="gap-3 p-6 text-center text-warning-700 dark:text-warning-300">
            <AlertCircle className="mx-auto h-8 w-8" aria-hidden="true" />
            <p className="font-medium">{t('providers.unavailable')}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const providers = response?.data ?? [];

  return (
    <>
      <PageMeta
        title={t('providers.title')}
        description={t('providers.subtitle')}
      />

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {/* Page header */}
        <div className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-theme-primary">
            <Heart className="h-6 w-6 text-accent" aria-hidden="true" />
            {t('providers.title')}
          </h1>
          <p className="text-theme-muted">{t('providers.subtitle')}</p>
        </div>

        {/* Search + sub-region filter */}
        <div className="flex flex-col gap-3">
          <SearchField
            aria-label={t('providers.search_placeholder')}
            placeholder={t('providers.search_placeholder')}
            value={search}
            onValueChange={setSearch}
            variant="bordered"
            classNames={{ inputWrapper: 'max-w-md' }}
            isClearable
            onClear={() => { setSearch(''); setDebouncedSearch(''); }}
          />
          <SubRegionFilter selectedId={subRegionId} onChange={setSubRegionId} />
        </div>

        {/* Type filter tabs */}
        <Tabs
          selectedKey={activeType}
          onSelectionChange={(key) => setActiveType(key as ProviderType)}
          variant="underlined"
          classNames={{ tabList: 'gap-2 flex-wrap' }}
          aria-label={t('providers.filter_aria')}
        >
          {FILTER_TABS.map(({ key, labelKey }) => (
            <Tab key={key} title={t(labelKey)} />
          ))}
        </Tabs>

        {/* Results */}
        {loading ? (
          <div role="status" aria-busy="true" aria-label={t('loading')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProviderCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-center text-danger" role="alert">
            <AlertCircle className="mx-auto mb-3 h-8 w-8" aria-hidden="true" />
            <p className="font-medium">{t('providers.error_title')}</p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-danger/90">{t('providers.error_body')}</p>
            <Button
              type="button"
              color="danger"
              variant="flat"
              className="mt-4"
              onPress={() => void refetch()}
            >
              {t('providers.retry')}
            </Button>
          </div>
        ) : providers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-theme-muted">
            <Heart className="h-12 w-12 opacity-30" aria-hidden="true" />
            <p className="text-lg font-medium">{t('providers.no_providers')}</p>
            <p className="text-sm">{t('providers.no_providers_hint')}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} t={t} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
