// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Input, Textarea, Button, Spinner, Chip, Skeleton } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';

import Building from 'lucide-react/icons/building';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';
import Star from 'lucide-react/icons/star';
import Tag from 'lucide-react/icons/tag';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminFederation } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';

/**
 * Federation Profile (My Listing)
 * View and edit this community's profile in the federation directory.
 * Supports editing name, description, contact email, website, and topic/interest tags.
 */


interface FedProfile {
  id: number;
  name: string;
  slug: string;
  status: string;
  federation_profile: {
    description: string;
    contact_email: string;
    website: string;
    categories: string[];
  };
}

interface FedTopic {
  id: number;
  name: string;
  slug: string;
  icon: string;
  category: string;
  tenant_count?: number;
  is_primary?: boolean;
}

export function MyProfile() {
  const { t } = useTranslation('admin_federation');

  const CATEGORY_LABELS: Record<string, string> = {
    care: t('federation.category_care'),
    skills: t('federation.category_skills'),
    creative: t('federation.category_creative'),
    home: t('federation.category_home'),
    health: t('federation.category_health'),
    community: t('federation.category_community'),
    services: t('federation.category_services'),
  };
  usePageTitle(t('federation.my_profile_title'));
  const toast = useToast();

  const [profile, setProfile] = useState<FedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Editable form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [website, setWebsite] = useState('');

  // Topics
  const [allTopics, setAllTopics] = useState<FedTopic[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [primaryTopicIds, setPrimaryTopicIds] = useState<Set<number>>(new Set());
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsDirty, setTopicsDirty] = useState(false);
  const [topicsSaving, setTopicsSaving] = useState(false);

  const populateForm = useCallback((p: FedProfile) => {
    setName(p.name || '');
    setDescription(p.federation_profile?.description || '');
    setContactEmail(p.federation_profile?.contact_email || '');
    setWebsite(p.federation_profile?.website || '');
    setDirty(false);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFederation.getProfile();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        let profileData: FedProfile;
        if (payload && typeof payload === 'object' && 'data' in payload) {
          profileData = (payload as { data: FedProfile }).data;
        } else {
          profileData = payload as FedProfile;
        }
        setProfile(profileData);
        populateForm(profileData);
      }
    } catch {
      toast.error(t('federation.failed_to_load_federation_profile'));
      setProfile(null);
    }
    setLoading(false);
  }, [t, toast, populateForm]);


  const loadTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const [allRes, myRes] = await Promise.all([
        adminFederation.getTopics(),
        adminFederation.getMyTopics(),
      ]);

      if (allRes.success && allRes.data) {
        const payload = allRes.data as unknown;
        const topics = (payload && typeof payload === 'object' && 'data' in payload)
          ? (payload as { data: FedTopic[] }).data
          : payload as FedTopic[];
        setAllTopics(topics);
      }

      if (myRes.success && myRes.data) {
        const payload = myRes.data as unknown;
        const myTopics = (payload && typeof payload === 'object' && 'data' in payload)
          ? (payload as { data: FedTopic[] }).data
          : payload as FedTopic[];
        setSelectedTopicIds(new Set(myTopics.map((t) => t.id)));
        setPrimaryTopicIds(new Set(myTopics.filter((t) => t.is_primary).map((t) => t.id)));
      }
    } catch {
      // Topics are optional â€” fail silently
    }
    setTopicsLoading(false);
  }, []);

  useEffect(() => { loadData(); loadTopics(); }, [loadData, loadTopics]);

  const markDirty = useCallback(() => {
    if (!dirty) setDirty(true);
  }, [dirty]);

  const toggleTopic = (topicId: number) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
        // Also remove from primary if deselected
        setPrimaryTopicIds((p) => {
          const np = new Set(p);
          np.delete(topicId);
          return np;
        });
      } else {
        if (next.size >= 10) return prev; // Max 10
        next.add(topicId);
      }
      setTopicsDirty(true);
      return next;
    });
  };

  const togglePrimary = (topicId: number) => {
    if (!selectedTopicIds.has(topicId)) return;
    setPrimaryTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        if (next.size >= 3) return prev; // Max 3 primary
        next.add(topicId);
      }
      setTopicsDirty(true);
      return next;
    });
  };

  const handleSaveProfile = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await adminFederation.updateProfile({
        name,
        federation_profile: {
          description,
          contact_email: contactEmail,
          website,
          categories: [], // Legacy field â€” topics replace this
        },
      });
      if (res.success) {
        toast.success(t('federation.federation_profile_updated_successfully'));
        setDirty(false);
        await loadData();
      } else {
        toast.error(t('federation.failed_to_update_federation_profile'));
      }
    } catch {
      toast.error(t('federation.failed_to_update_federation_profile'));
    } finally {
      setSaving(false);
    }
  }, [profile, name, description, contactEmail, website, t, toast, loadData]);


  const handleSaveTopics = useCallback(async () => {
    setTopicsSaving(true);
    try {
      const res = await adminFederation.updateMyTopics(
        Array.from(selectedTopicIds),
        Array.from(primaryTopicIds),
      );
      if (res.success) {
        toast.success(t('federation.topics_updated_successfully'));
        setTopicsDirty(false);
      } else {
        toast.error(t('federation.failed_to_update_topics'));
      }
    } catch {
      toast.error(t('federation.failed_to_update_topics'));
    } finally {
      setTopicsSaving(false);
    }
  }, [selectedTopicIds, primaryTopicIds, t, toast]);


  // One Save for the whole listing. It saves whichever of the two parts
  // (details, topics) has changed. Until November 2026 each card had its own
  // Save button, and saving one left the other's changes unsaved.
  const handleSaveAll = useCallback(async () => {
    if (dirty) await handleSaveProfile();
    if (topicsDirty) await handleSaveTopics();
  }, [dirty, topicsDirty, handleSaveProfile, handleSaveTopics]);

  // What the listing will show: main topics first, as the directory does.
  const previewTopics = allTopics
    .filter((topic) => selectedTopicIds.has(topic.id))
    .sort((a, b) => Number(primaryTopicIds.has(b.id)) - Number(primaryTopicIds.has(a.id)))
    .slice(0, 5);

  // Group all topics by category
  const topicsByCategory = allTopics.reduce<Record<string, FedTopic[]>>((acc, topic) => {
    const cat = topic.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(topic);
    return acc;
  }, {});

  if (loading) {
    return (
      <div>
        <PageHeader
          title={t('federation.my_profile_title')}
          description={t('federation.my_profile_desc')}
        />
        <div className="space-y-6">
          <Card >
            <CardHeader><Skeleton className="h-5 w-36 rounded-lg" /></CardHeader>
            <CardBody className="space-y-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <PageHeader
          title={t('federation.my_profile_title')}
          description={t('federation.my_profile_desc')}
          actions={
            <Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={loadData}>
              {t('federation.refresh')}
            </Button>
          }
        />
        <Card >
          <CardBody className="flex flex-col items-center py-8 text-muted">
            <Building size={40} className="mb-2" />
            <p>{t('federation.profile_not_available')}</p>
            <p className="text-xs mt-1">{t('federation.enable_federation_to_create_profile')}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('federation.my_profile_title')}
        description={t('federation.my_profile_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={() => { loadData(); loadTopics(); }}
            size="sm"
          >
            {t('federation.refresh')}
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Profile Details Card */}
        <Card >
          <CardHeader>
            <h3 className="text-lg font-semibold">{t('federation.community_profile')}</h3>
          </CardHeader>
          <CardBody className="gap-4">
            <Input
              label={t('federation.community_name')}
              value={name}
              onValueChange={(val) => { setName(val); markDirty(); }}
              variant="secondary"
              description={t('federation.desc_the_public_name_of_your_community_in_the')}
            />
            <Input
              label={t('federation.contact_email')}
              type="email"
              value={contactEmail}
              onValueChange={(val) => { setContactEmail(val); markDirty(); }}
              variant="secondary"
              description={t('federation.public_contact_email_desc')}
            />
            <Input
              label={t('federation.website')}
              type="url"
              value={website}
              onValueChange={(val) => { setWebsite(val); markDirty(); }}
              variant="secondary"
              placeholder="https://"
              description={t('federation.website_desc')}
            />
            <Textarea
              label={t('federation.description')}
              value={description}
              onValueChange={(val) => { setDescription(val); markDirty(); }}
              variant="secondary"
              minRows={3}
              maxRows={6}
              description={t('federation.desc_a_brief_description_of_your_community_fo')}
            />
          </CardBody>
        </Card>

        {/* Topic / Interest Tags Card */}
        <Card >
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Tag size={18} />
                {t('federation.topic_tags_title')}
              </h3>
              <p className="text-sm text-muted mt-1">
                {t('federation.topic_tags_desc')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="gap-5">
            {topicsLoading ? (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-6">
                <Spinner size="sm" />
              </div>
            ) : (
              <>
                {/* Selection count */}
                <div className="text-sm text-muted">
                {t('federation.topics_selected_count', { count: selectedTopicIds.size })}
                {primaryTopicIds.size > 0 && (
                  <span className="ml-2 text-warning">
                      ({t('federation.primary_topics_count', { count: primaryTopicIds.size })})
                  </span>
                )}
                </div>

                {/* Helper text for primary topic toggle */}
                <p className="text-xs text-muted">
                  {t('federation.click_star_for_primary_hint')}
                </p>

                {/* Topics grouped by category */}
                {Object.entries(topicsByCategory).map(([category, topics]) => (
                  <div key={category}>
                    <h4 className="text-sm font-medium text-muted mb-2">
                      {CATEGORY_LABELS[category] || category}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {topics.map((topic) => {
                        const isSelected = selectedTopicIds.has(topic.id);
                        const isPrimary = primaryTopicIds.has(topic.id);

                        return (
                          <Chip
                            key={topic.id}
                            variant={isSelected ? 'solid' : 'bordered'}
                            color={isPrimary ? 'warning' : isSelected ? 'primary' : 'default'}
                            className="cursor-pointer select-none"
                            startContent={isPrimary ? <Star size={12} className="fill-current" /> : undefined}
                            onClick={() => toggleTopic(topic.id)}
                          >
                            {topic.name}
                            {topic.tenant_count ? (
                              <span className="ml-1 opacity-60 text-xs">({topic.tenant_count})</span>
                            ) : null}
                          </Chip>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Selected topics summary with primary toggle */}
                {selectedTopicIds.size > 0 && (
                  <div className="border-t border-divider pt-4">
                    <h4 className="text-sm font-medium text-muted mb-2">
                      {t('federation.your_selected_topics')}
                      <span className="font-normal text-muted ml-2">
                        ({t('federation.click_star_for_primary')})
                      </span>
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {allTopics
                        .filter((topic) => selectedTopicIds.has(topic.id))
                        .map((topic) => {
                          const isPrimary = primaryTopicIds.has(topic.id);
                          return (
                            <Chip
                              key={topic.id}
                              variant="primary"
                              color={isPrimary ? 'warning' : 'primary'}
                              startContent={
                                <Button
                                  isIconOnly
                                  variant="tertiary"
                                  size="sm"
                                  className="flex h-6 w-6 min-h-0 min-w-0 items-center justify-center rounded-full bg-transparent p-0 text-current"
                                  onPress={() => togglePrimary(topic.id)}
                                  aria-label={isPrimary ? t('federation.remove_primary') : t('federation.set_as_primary')}
                                >
                                  <Star size={12} className={isPrimary ? 'fill-current' : 'opacity-40'} />
                                </Button>
                              }
                              onClose={() => toggleTopic(topic.id)}
                            >
                              {topic.name}
                            </Chip>
                          );
                        })}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>

        {/* How the listing looks to another timebank browsing the directory.
            It follows the form as you type, before anything is saved. */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">{t('federation.listing_preview_title')}</h3>
          </CardHeader>
          <CardBody>
            <div data-testid="listing-preview" className="max-w-md rounded-2xl border border-divider bg-surface p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                  <Building size={20} className="text-accent" aria-hidden="true" />
                </div>
                <p className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{name.trim() || profile.name}</p>
              </div>
              <p className="mt-3 text-sm text-muted">
                {description.trim() || t('federation.listing_preview_empty_description')}
              </p>
              {previewTopics.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {previewTopics.map((topic) => (
                    <Chip
                      key={topic.id}
                      size="sm"
                      variant="soft"
                      color={primaryTopicIds.has(topic.id) ? 'warning' : 'default'}
                      startContent={<Tag size={10} />}
                    >
                      {topic.name}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-divider bg-surface/95 p-3 shadow-sm backdrop-blur">
          {(dirty || topicsDirty) && <span className="text-xs text-warning">{t('federation.unsaved_changes')}</span>}
          <Button
            startContent={<Save size={16} />}
            onPress={handleSaveAll}
            isLoading={saving || topicsSaving}
            isDisabled={!dirty && !topicsDirty}
          >
            {t('federation.save_changes')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default MyProfile;
