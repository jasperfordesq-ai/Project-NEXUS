// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button, Card, CardBody, CardFooter, Chip, Input, Textarea, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Skeleton } from '@/components/ui';
import { useState, useCallback, useEffect, useMemo } from 'react';

import Globe from 'lucide-react/icons/globe';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import Handshake from 'lucide-react/icons/handshake';
import MapPin from 'lucide-react/icons/map-pin';
import Tag from 'lucide-react/icons/tag';
import Send from 'lucide-react/icons/send';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import XCircle from 'lucide-react/icons/circle-x';
import Filter from 'lucide-react/icons/filter';
import Mail from 'lucide-react/icons/mail';
import ExternalLink from 'lucide-react/icons/external-link';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminFederation } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { useTranslation } from 'react-i18next';
import { PartnerTimebankGuidance } from './PartnerTimebankGuidance';

/**
 * Partner Directory
 * Browse discoverable communities in the federation network.
 * Supports search, region/category filters, partnership requests.
 */


interface CommunityTopic {
  name: string;
  slug: string;
  icon: string;
  category: string;
  is_primary: boolean;
}

interface Community {
  id: number;
  name: string;
  slug: string;
  domain?: string;
  logo_url?: string;
  description?: string;
  categories?: string;
  region?: string;
  contact_email?: string;
  contact_name?: string;
  member_count?: number | null;
  federation_member_count_public?: number;
  profiles_enabled?: number;
  listings_enabled?: number;
  messaging_enabled?: number;
  transactions_enabled?: number;
  events_enabled?: number;
  groups_enabled?: number;
  partnership_status?: string | null;
  partnership_id?: number | null;
  topics?: CommunityTopic[];
}

interface TopicFilter {
  id: number;
  name: string;
  slug: string;
  icon: string;
  category: string;
  tenant_count: number;
}

interface DirectoryResponse {
  communities: Community[];
  regions: string[];
  categories: string[];
  topics: TopicFilter[];
}

const partnershipStatusConfig: Record<string, { color: 'success' | 'warning' | 'danger' | 'default'; icon: typeof CheckCircle; label: string }> = {
  active: { color: 'success', icon: CheckCircle, label: 'federation.status_partner' },
  pending: { color: 'warning', icon: Clock, label: 'federation.status_pending' },
  rejected: { color: 'danger', icon: XCircle, label: 'federation.status_rejected' },
  terminated: { color: 'default', icon: XCircle, label: 'federation.status_terminated' },
  suspended: { color: 'danger', icon: XCircle, label: 'federation.status_suspended' },
};

const enabledFeatures = (community: Community): string[] => {
  const features: string[] = [];
  if (community.profiles_enabled) features.push('federation.feature_profiles');
  if (community.listings_enabled) features.push('federation.feature_listings');
  if (community.messaging_enabled) features.push('federation.feature_messages');
  if (community.transactions_enabled) features.push('federation.feature_transactions');
  if (community.events_enabled) features.push('federation.feature_events');
  if (community.groups_enabled) features.push('federation.feature_groups');
  return features;
};

export function PartnerDirectory() {
  const { t } = useTranslation('admin_federation');
  usePageTitle(t('federation.page_title'));
  const toast = useToast();

  const [communities, setCommunities] = useState<Community[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [topics, setTopics] = useState<TopicFilter[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [hidePartnered, setHidePartnered] = useState(false);

  // Partnership request modal
  const [requestTarget, setRequestTarget] = useState<Community | null>(null);
  const [requestNotes, setRequestNotes] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);

  const loadData = useCallback(async (params?: { search?: string; region?: string; category?: string; topic?: string; exclude_partnered?: boolean }) => {
    setLoading(true);
    try {
      const res = await adminFederation.getDirectory(params);
      if (res.success && res.data) {
        const payload = res.data as unknown as DirectoryResponse;
        if (payload && typeof payload === 'object' && 'communities' in payload) {
          setCommunities(payload.communities || []);
          setRegions(payload.regions || []);
          setCategories(payload.categories || []);
          setTopics(payload.topics || []);
        } else if (Array.isArray(payload)) {
          // Fallback for old response format
          setCommunities(payload as unknown as Community[]);
        }
      }
    } catch {
      setCommunities([]);
    }
    setLoading(false);
  }, []);

  // Debounced search Ã¢â‚¬â€ also handles initial load on mount (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadData({
        search: search || undefined,
        region: regionFilter || undefined,
        category: categoryFilter || undefined,
        topic: topicFilter || undefined,
        exclude_partnered: hidePartnered || undefined,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, regionFilter, categoryFilter, topicFilter, hidePartnered, loadData]);

  const handleRequestPartnership = async () => {
    if (!requestTarget) return;
    setRequestLoading(true);
    try {
      const res = await adminFederation.requestPartnership(requestTarget.id, requestNotes || undefined);
      if (res.success) {
        toast.success(t('federation.partnership_request_sent'));
        setRequestTarget(null);
        setRequestNotes('');
        loadData({ search, region: regionFilter, category: categoryFilter, topic: topicFilter, exclude_partnered: hidePartnered });
      } else {
        // admin-i18n-ignore: localized server message — FederationPartnershipService
        // refusals are __() keys, guarded by FederationPartnershipErrorLocalisationTest.
        toast.error(res.error || t('federation.failed_to_send_partnership_request'));
      }
    } catch {
      toast.error(t('federation.failed_to_send_partnership_request'));
    } finally {
      setRequestLoading(false);
    }
  };

  const activeFilters = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (regionFilter) count++;
    if (categoryFilter) count++;
    if (topicFilter) count++;
    if (hidePartnered) count++;
    return count;
  }, [search, regionFilter, categoryFilter, topicFilter, hidePartnered]);

  const clearFilters = () => {
    setSearch('');
    setRegionFilter('');
    setCategoryFilter('');
    setTopicFilter('');
    setHidePartnered(false);
  };

  return (
    <div>
      <PageHeader
        title={t('federation.partner_directory_title')}
        description={t('federation.partner_directory_desc')}
        actions={
          <Button
            variant="secondary"
            startContent={<RefreshCw size={16} />}
            onPress={() => loadData({ search, region: regionFilter, category: categoryFilter, topic: topicFilter, exclude_partnered: hidePartnered })}
            isLoading={loading}
          >
            {t('federation.refresh')}
          </Button>
        }
      />

      <div className="mb-6">
        <PartnerTimebankGuidance page="directory" />
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardBody className="gap-4">
          <div className="flex flex-col md:flex-row gap-3">
            <Input type="search" name="admin-search" autoComplete="off"
              className="flex-1"
              placeholder={t('federation.search_communities_placeholder')}
              aria-label={t('federation.label_search_partner_communities')}
              startContent={<Search size={16} className="text-muted" />}
              value={search}
              onValueChange={setSearch}
              variant="secondary"
              size="sm"
            />
            {regions.length > 0 && (
              <Select
                className="w-full md:w-48"
                placeholder={t('federation.placeholder_all_regions')}
                size="sm"
                variant="secondary"
                selectedKeys={regionFilter ? [regionFilter] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  setRegionFilter(arr.length > 0 ? String(arr[0]) : '');
                }}
              >
                {regions.map((r) => (
                  <SelectItem key={r} id={r}>{r}</SelectItem>
                ))}
              </Select>
            )}
            {categories.length > 0 && (
              <Select
                className="w-full md:w-48"
                placeholder={t('federation.placeholder_all_categories')}
                size="sm"
                variant="secondary"
                selectedKeys={categoryFilter ? [categoryFilter] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  setCategoryFilter(arr.length > 0 ? String(arr[0]) : '');
                }}
              >
                {categories.map((c) => (
                  <SelectItem key={c} id={c}>{c}</SelectItem>
                ))}
              </Select>
            )}
            {topics.length > 0 && (
              <Select
                className="w-full md:w-48"
                placeholder={t('federation.placeholder_all_topics')}
                size="sm"
                variant="secondary"
                selectedKeys={topicFilter ? [topicFilter] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  setTopicFilter(arr.length > 0 ? String(arr[0]) : '');
                }}
                startContent={<Tag size={14} className="text-muted" />}
              >
                {topics.map((tp) => (
                  <SelectItem key={tp.slug} id={tp.slug} textValue={tp.name}>
                    {tp.name} ({tp.tenant_count})
                  </SelectItem>
                ))}
              </Select>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant={hidePartnered ? 'primary' : 'secondary'}
                size="sm"
                startContent={<Filter size={14} />}
                onPress={() => setHidePartnered(!hidePartnered)}
              >
                {t('federation.hide_partnered')}
              </Button>
              {activeFilters > 0 && (
                <Button variant="tertiary" size="sm" onPress={clearFilters}>
                  {t('federation.clear_filters')}
                </Button>
              )}
            </div>
            <span className="text-sm text-muted">
              {loading ? t('federation.loading') : t('federation.directory_results_count', { count: communities.length })}
            </span>
          </div>
        </CardBody>
      </Card>

      {/* Loading skeleton */}
      {loading && communities.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardBody className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4 rounded-lg" />
                    <Skeleton className="h-3 w-1/2 rounded-lg" />
                  </div>
                </div>
                <Skeleton className="h-3 w-full rounded-lg" />
                <Skeleton className="h-3 w-2/3 rounded-lg" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && communities.length === 0 && (
        <EmptyState
          icon={Globe}
          title={t('federation.no_communities_found')}
          description={activeFilters > 0
            ? t('federation.no_communities_match_filters')
            : t('federation.directory_empty')
          }
        />
      )}

      {/* Community cards grid */}
      {communities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {communities.map((community) => {
            const communityTopics = community.topics || [];
            const features = enabledFeatures(community);
            const status = community.partnership_status;
            const statusConf = status ? partnershipStatusConfig[status] : null;

            return (
              <Card key={community.id} className="relative">
                {statusConf && (
                  <div className="absolute top-3 right-3 z-10">
                    <Chip
                      size="sm"
                      variant="soft"
                      color={statusConf.color}
                      startContent={<statusConf.icon size={12} />}
                    >
                      {t(statusConf.label)}
                    </Chip>
                  </div>
                )}

                <CardBody className="gap-3 pb-2">
                  <div className="flex items-start gap-3">
                    {community.logo_url ? (
                      <img
                        src={community.logo_url}
                        alt={community.name}
                        className="w-12 h-12 rounded-lg object-cover shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <Globe size={20} className="text-accent" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-foreground truncate pr-16">
                        {community.name}
                      </h3>
                      <p className="text-xs text-muted">/{community.slug}</p>
                    </div>
                  </div>

                  {community.description && (
                    <p className="text-sm text-muted line-clamp-2">
                      {community.description}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {community.member_count != null && (
                      <span className="flex items-center gap-1">
                        <Users size={12} /> {t('federation.directory_member_count', { count: community.member_count ?? 0 })}
                      </span>
                    )}
                    {community.region && (
                      <span className="flex items-center gap-1">
                        <MapPin size={12} /> {community.region}
                      </span>
                    )}
                    {community.contact_email && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} /> {community.contact_name || t('federation.contact')}
                      </span>
                    )}
                  </div>

                  {communityTopics.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {communityTopics.slice(0, 5).map((topic) => (
                        <Chip
                          key={topic.slug}
                          size="sm"
                          variant="soft"
                          color={topic.is_primary ? 'warning' : 'default'}
                          startContent={<Tag size={10} />}
                        >
                          {topic.name}
                        </Chip>
                      ))}
                      {communityTopics.length > 5 && (
                        <Chip size="sm" variant="soft" color="default">
                          {t('federation.directory_more_topics', { count: communityTopics.length - 5 })}
                        </Chip>
                      )}
                    </div>
                  )}

                  {features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {features.map((f) => (
                        <Chip key={f} size="sm" variant="dot" color="success" className="text-xs">
                          {t(f)}
                        </Chip>
                      ))}
                    </div>
                  )}
                </CardBody>

                <CardFooter className="pt-0 gap-2">
                  {community.domain && (
                    <Button
                      as="a"
                      href={`https://${community.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="secondary"
                      size="sm"
                      startContent={<ExternalLink size={14} />}
                    >
                      {t('federation.visit')}
                    </Button>
                  )}

                  {!status && (
                    <Button
                      variant="primary"
                      size="sm"
                      startContent={<Handshake size={14} />}
                      onPress={() => setRequestTarget(community)}
                    >
                      {t('federation.request_partnership')}
                    </Button>
                  )}
                  {status === 'active' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled
                      startContent={<CheckCircle size={14} />}
                    >
                      {t('federation.active_partner')}
                    </Button>
                  )}
                  {status === 'pending' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled
                      startContent={<Clock size={14} />}
                    >
                      {t('federation.request_pending')}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Partnership request modal */}
      <Modal isOpen={!!requestTarget} onClose={() => { setRequestTarget(null); setRequestNotes(''); }}>
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Handshake size={20} />
            {t('federation.request_partnership')}
          </ModalHeader>
          <ModalBody>
            {requestTarget && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-secondary">
                  {requestTarget.logo_url ? (
                    <img src={requestTarget.logo_url} alt={t('federation.partner_logo_alt', { name: requestTarget.name || t('federation.label_partner') })} className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Globe size={18} className="text-accent" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium">{requestTarget.name}</p>
                    {requestTarget.region && (
                      <p className="text-xs text-muted">{requestTarget.region}</p>
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted">
                  {t('federation.partnership_request_description')}
                </p>
                <Textarea
                  label={t('federation.message_optional')}
                  placeholder={t('federation.partnership_message_placeholder')}
                  value={requestNotes}
                  onValueChange={setRequestNotes}
                  variant="secondary"
                  maxLength={1000}
                  minRows={3}
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => { setRequestTarget(null); setRequestNotes(''); }}>
              {t('federation.cancel')}
            </Button>
            <Button
              startContent={<Send size={14} />}
              onPress={handleRequestPartnership}
              isLoading={requestLoading}
            >
              {t('federation.send_request')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default PartnerDirectory;
