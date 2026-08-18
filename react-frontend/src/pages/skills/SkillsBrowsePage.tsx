// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Skills Browse Page - Explore skill categories, skills, and skilled members
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Sparkles from 'lucide-react/icons/sparkles';
import ChevronRight from 'lucide-react/icons/chevron-right';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Users from 'lucide-react/icons/users';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import FolderTree from 'lucide-react/icons/folder-tree';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import HandHelping from 'lucide-react/icons/hand-helping';
import Megaphone from 'lucide-react/icons/megaphone';
import Settings from 'lucide-react/icons/settings';
import ArrowRight from 'lucide-react/icons/arrow-right';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Spinner } from '@/components/ui/Spinner';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { EmptyState } from '@/components/feedback';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';
import type { SkillCategory } from '@/components/skills/SkillSelector';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CategorySkill {
  skill_name: string;
  user_count: number;
  offering_count: number;
  requesting_count: number;
}

interface SkillMember {
  id: number;
  first_name: string;
  last_name: string;
  avatar?: string;
  proficiency_level: string;
  is_offering: boolean;
  is_requesting: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const proficiencyConfig: Record<string, { labelKey: string; color: string; bg: string; dots: number }> = {
  beginner: { labelKey: 'skills.proficiency.beginner', color: 'text-emerald-500', bg: 'bg-emerald-500', dots: 1 },
  intermediate: { labelKey: 'skills.proficiency.intermediate', color: 'text-[var(--color-info)]', bg: 'bg-blue-500', dots: 2 },
  advanced: { labelKey: 'skills.proficiency.advanced', color: 'text-accent', bg: 'bg-accent', dots: 3 },
  expert: { labelKey: 'skills.proficiency.expert', color: 'text-[var(--color-warning)]', bg: 'bg-amber-500', dots: 4 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function ProficiencyBadge({ level }: { level: string }) {
  const { t } = useTranslation('common');
  const config = proficiencyConfig[level] ?? proficiencyConfig['beginner'] ?? { labelKey: 'skills.proficiency.beginner', color: 'text-emerald-500', bg: 'bg-emerald-500', dots: 1 };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${config.color}`}>
      {[1, 2, 3, 4].map((d) => (
        <span
          key={d}
          className={`w-1.5 h-1.5 rounded-full ${d <= config.dots ? config.bg : 'bg-theme-hover'}`}
        />
      ))}
      <span className="ml-0.5">{t(config.labelKey)}</span>
    </span>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number | string }) {
  return (
    <GlassCard className="p-4 text-center">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
        <Icon className="w-5 h-5 text-accent" aria-hidden="true" />
      </div>
      <p className="text-2xl font-bold text-theme-primary">{value}</p>
      <p className="text-xs text-theme-subtle mt-0.5">{label}</p>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

// ── Animation variants ───────────────────────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function SkillsBrowsePage() {
  const { t } = useTranslation('common');
  usePageTitle(t('skills.browse_title'));
  const { tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();

  // State
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [categorySkills, setCategorySkills] = useState<Record<number, CategorySkill[]>>({});
  const [loadingSkills, setLoadingSkills] = useState<number | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<{ categoryId: number; skillName: string } | null>(null);
  const [skillMembers, setSkillMembers] = useState<SkillMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // ── Load categories ──────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadCategories(); }, []);

  const loadCategories = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<SkillCategory[]>('/v2/skills/categories');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setCategories(response.data);
      } else {
        setError(t('skills.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load skill categories', err);
      setError(t('skills.load_failed_retry'));
    } finally {
      setIsLoading(false);
    }
  };

  // ── Load skills for a category ───────────────────────────────────────────
  const loadCategorySkills = useCallback(async (categoryId: number) => {
    if (categorySkills[categoryId]) return; // Already cached
    try {
      setLoadingSkills(categoryId);
      const response = await api.get<{ skills?: CategorySkill[] }>(`/v2/skills/categories/${categoryId}`);
      if (response.success && response.data) {
        // The endpoint returns a category object with a `skills` array
        const data = response.data;
        setCategorySkills((prev) => ({
          ...prev,
          [categoryId]: data.skills || [],
        }));
      }
    } catch (err) {
      logError('Failed to load category skills', err);
    } finally {
      setLoadingSkills(null);
    }
  }, [categorySkills]);

  // ── Toggle category expansion ────────────────────────────────────────────
  const toggleCategory = useCallback((categoryId: number) => {
    setSelectedSkill(null);
    setSkillMembers([]);
    if (expandedCategory === categoryId) {
      setExpandedCategory(null);
    } else {
      setExpandedCategory(categoryId);
      loadCategorySkills(categoryId);
    }
  }, [expandedCategory, loadCategorySkills]);

  // ── Load members for a skill ─────────────────────────────────────────────
  const selectSkill = useCallback(async (categoryId: number, skillName: string) => {
    if (selectedSkill?.categoryId === categoryId && selectedSkill?.skillName === skillName) {
      setSelectedSkill(null);
      setSkillMembers([]);
      return;
    }
    try {
      setSelectedSkill({ categoryId, skillName });
      setLoadingMembers(true);
      setSkillMembers([]);
      const response = await api.get<SkillMember[]>(
        `/v2/skills/members?skill=${encodeURIComponent(skillName)}&limit=30`
      );
      if (response.success && response.data) {
        setSkillMembers(response.data);
      }
    } catch (err) {
      logError('Failed to load skill members', err);
    } finally {
      setLoadingMembers(false);
    }
  }, [selectedSkill]);

  // ── Filter categories by search ──────────────────────────────────────────
  const lowerQuery = searchQuery.toLowerCase();
  const filteredCategories = searchQuery
    ? categories.filter(
        (cat) =>
          cat.name.toLowerCase().includes(lowerQuery) ||
          cat.children?.some((child) => child.name.toLowerCase().includes(lowerQuery))
      )
    : categories;

  // ── Compute stats ────────────────────────────────────────────────────────
  const totalCategories = categories.length;
  const totalSubCategories = categories.reduce(
    (sum, cat) => sum + (cat.children?.length || 0),
    0
  );
  const totalSkillsCount = categories.reduce(
    (sum, cat) =>
      sum +
      (cat.skills_count || 0) +
      (cat.children?.reduce((s, c) => s + (c.skills_count || 0), 0) || 0),
    0
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageMeta
        title={t('page_meta.skills_browse.title')}
        description={t('page_meta.skills_browse.description')}
        noIndex
      />
      {/* ── Hero / Explainer ──────────────────────────────────────────── */}
      <GlassCard className="p-5 sm:p-6">
        <div className="relative">
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              <GraduationCap className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            {t('skills.browse_title')}
          </h1>

          <p className="text-theme-muted mt-3 text-sm leading-relaxed max-w-2xl">
            {t('skills.explainer')}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mt-4">
            <div className="flex items-start gap-2">
              <HandHelping className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-theme-subtle">
                <span className="font-medium text-theme-success">
                  {t('skills.offering_label')}
                </span>
                {' - '}
                {t('skills.offering_desc')}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Megaphone className="w-4 h-4 text-[var(--color-info)] mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-theme-subtle">
                <span className="font-medium text-blue-600 dark:text-blue-400">
                  {t('skills.requesting_label')}
                </span>
                {' - '}
                {t('skills.requesting_desc')}
              </p>
            </div>
          </div>

          {isAuthenticated && (
            <Link
              to={tenantPath('/settings?tab=skills')}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
              {t('skills.add_your_skills')}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </GlassCard>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      {!isLoading && !error && categories.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={FolderTree} label={t('skills.categories')} value={totalCategories} />
          <StatCard icon={Sparkles} label={t('skills.sub_categories')} value={totalSubCategories} />
          <StatCard icon={Users} label={t('skills.total_skills')} value={totalSkillsCount} />
        </div>
      )}

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <GlassCard className="p-4">
        <SearchField
          placeholder={t('skills.search_placeholder')}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setExpandedCategory(null);
            setSelectedSkill(null);
          }}
          aria-label={t('skills.search_placeholder')}
          endContent={
            searchQuery ? (
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => setSearchQuery('')}
                className="p-0.5 rounded-full hover:bg-theme-hover transition-colors min-w-0 w-auto min-h-9"
                aria-label={t('skills.aria_clear_search')}
              >
                <X className="w-3.5 h-3.5 text-theme-subtle" />
              </Button>
            ) : undefined
          }
          classNames={{
            input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
            inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
          }}
        />
      </GlassCard>

      {/* ── Error State ──────────────────────────────────────────────────── */}
      {error && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-primary mb-2">
            {t('skills.unable_to_load')}
          </h3>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            color="primary"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadCategories}
          >
            {t('skills.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <CardRowsSkeleton key={i} className="p-4" />
          ))}
        </div>
      )}

      {/* ── Categories ───────────────────────────────────────────────────── */}
      {!isLoading && !error && (
        <>
          {filteredCategories.length === 0 ? (
            <EmptyState
              icon={<FolderTree className="w-12 h-12" aria-hidden="true" />}
              title={t('skills.no_categories')}
              description={
                searchQuery
                  ? t('skills.no_match', { query: searchQuery })
                  : t('skills.no_categories_yet')
              }
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-3"
            >
              {filteredCategories.map((category) => {
                const isExpanded = expandedCategory === category.id;
                const skills = categorySkills[category.id] || [];
                const isLoadingThis = loadingSkills === category.id;

                return (
                  <motion.div key={category.id} variants={itemVariants}>
                    <GlassCard className="overflow-hidden">
                      {/* Category Header */}
                      <Button
                        variant="light"
                        onPress={() => toggleCategory(category.id)}
                        className="w-full flex items-center justify-between p-4 hover:bg-theme-hover transition-colors justify-between min-h-9"
                        aria-expanded={isExpanded}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                            {category.icon || <FolderTree className="h-5 w-5" aria-hidden="true" />}
                          </div>
                          <div className="text-left">
                            <h3 className="font-semibold text-theme-primary text-base">
                              {category.name}
                            </h3>
                            <div className="flex items-center gap-3 mt-0.5">
                              {category.skills_count !== undefined && category.skills_count > 0 && (
                                <span className="text-xs text-theme-subtle flex items-center gap-1">
                                  <Users className="w-3 h-3" aria-hidden="true" />
                                  {category.skills_count} {t('skills.members_with_skills')}
                                </span>
                              )}
                              {category.children && category.children.length > 0 && (
                                <span className="text-xs text-theme-subtle">
                                  {category.children.length} {t('skills.sub_categories')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5 text-accent transition-transform" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-theme-subtle transition-transform" aria-hidden="true" />
                          )}
                        </div>
                      </Button>

                      {/* Expanded: Sub-categories + Skills */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 border-t border-theme-default">
                              {/* Sub-categories (if any) */}
                              {category.children && category.children.length > 0 && (
                                <div className="pt-3 pb-2">
                                  <p className="text-xs font-medium text-theme-subtle uppercase tracking-wider mb-2">
                                    {t('skills.sub_categories')}
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {category.children.map((child) => (
                                      <Chip
                                        key={child.id}
                                        variant="flat"
                                        size="sm"
                                        className="bg-theme-elevated text-theme-primary border border-theme-default"
                                        startContent={child.icon ? <span className="text-xs">{child.icon}</span> : undefined}
                                      >
                                        {child.name}
                                        {child.skills_count !== undefined && child.skills_count > 0 && (
                                          <span className="text-theme-subtle ml-1">({child.skills_count})</span>
                                        )}
                                      </Chip>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Skills in this category */}
                              {isLoadingThis ? (
                                <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-6">
                                  <Spinner size="sm" />
                                  <span className="text-sm text-theme-subtle ml-2">
                                    {t('skills.loading_skills')}
                                  </span>
                                </div>
                              ) : skills.length > 0 ? (
                                <div className="pt-3">
                                  <p className="text-xs font-medium text-theme-subtle uppercase tracking-wider mb-2">
                                    {t('skills.skills_in_category')} ({skills.length})
                                  </p>
                                  <ToggleButtonGroup
                                    aria-label={t('skills.skills_in_category')}
                                    selectionMode="single"
                                    isDetached
                                    selectedKeys={selectedSkill?.categoryId === category.id && selectedSkill?.skillName ? new Set([selectedSkill.skillName]) : new Set()}
                                    onSelectionChange={(keys) => {
                                      const [k] = Array.from(keys);
                                      const next = k ?? (selectedSkill?.categoryId === category.id ? selectedSkill.skillName : undefined);
                                      if (next) selectSkill(category.id, String(next));
                                    }}
                                    className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                                  >
                                    {skills.map((skill) => (
                                      <ToggleButton
                                        key={skill.skill_name}
                                        id={skill.skill_name}
                                        variant="ghost"
                                        className="text-left p-3 rounded-xl border transition-all justify-start min-h-9 bg-theme-elevated border-theme-default hover:border-accent/30 hover:bg-theme-hover data-[selected=true]:border-accent/40 data-[selected=true]:bg-accent/10 data-[selected=true]:shadow-sm data-[selected=true]:shadow-accent/10"
                                      >
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium text-theme-primary">
                                              {skill.skill_name}
                                            </span>
                                            <Chip
                                              size="sm"
                                              variant="flat"
                                              className="bg-accent/10 text-accent"
                                            >
                                              <Users className="w-3 h-3" aria-hidden="true" />
                                              {skill.user_count}
                                            </Chip>
                                          </div>
                                          <div className="flex items-center gap-3 mt-1.5">
                                            {skill.offering_count > 0 && (
                                              <span className="text-xs text-theme-success flex items-center gap-1">
                                                <HandHelping className="w-3 h-3" aria-hidden="true" />
                                                {skill.offering_count} {t('skills.offering')}
                                              </span>
                                            )}
                                            {skill.requesting_count > 0 && (
                                              <span className="text-xs text-[var(--color-info)] flex items-center gap-1">
                                                <Megaphone className="w-3 h-3" aria-hidden="true" />
                                                {skill.requesting_count} {t('skills.requesting')}
                                              </span>
                                            )}
                                          </div>
                                      </ToggleButton>
                                    ))}
                                  </ToggleButtonGroup>
                                </div>
                              ) : (
                                <div className="py-6 text-center">
                                  <p className="text-sm text-theme-subtle">
                                    {t('skills.no_skills_yet')}
                                  </p>
                                </div>
                              )}

                              {/* ── Member list for selected skill ─────────────── */}
                              <AnimatePresence>
                                {selectedSkill?.categoryId === category.id && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-4 pt-4 border-t border-theme-default">
                                      <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-sm font-semibold text-theme-primary flex items-center gap-2">
                                          <Users className="w-4 h-4 text-accent" aria-hidden="true" />
                                          {t('skills.members_with', {
                                            skill: selectedSkill.skillName,
                                          })}
                                        </h4>
                                        <Button
                                          isIconOnly
                                          size="sm"
                                          variant="light"
                                          onPress={() => {
                                            setSelectedSkill(null);
                                            setSkillMembers([]);
                                          }}
                                          className="p-1 rounded-lg hover:bg-theme-hover transition-colors min-w-0 w-auto min-h-9"
                                          aria-label={t('skills.aria_close_members_list')}
                                        >
                                          <X className="w-4 h-4 text-theme-subtle" />
                                        </Button>
                                      </div>

                                      {loadingMembers ? (
                                        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-6">
                                          <Spinner size="sm" />
                                        </div>
                                      ) : skillMembers.length > 0 ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          {skillMembers.map((member) => (
                                            <Link
                                              key={member.id}
                                              to={tenantPath(`/profile/${member.id}`)}
                                              className="flex items-center gap-3 p-3 rounded-xl bg-theme-elevated border border-theme-default hover:border-accent/30 hover:bg-theme-hover transition-all"
                                            >
                                              <Avatar
                                                src={resolveAvatarUrl(member.avatar)}
                                                name={`${member.first_name} ${member.last_name}`}
                                                size="sm"
                                                className="shrink-0"
                                              />
                                              <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-theme-primary truncate">
                                                  {member.first_name} {member.last_name}
                                                </p>
                                                {member.proficiency_level && (
                                                  <ProficiencyBadge level={member.proficiency_level} />
                                                )}
                                              </div>
                                              <div className="flex gap-1 shrink-0">
                                                {member.is_offering && (
                                                  <Chip size="sm" variant="flat" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                                                    {t('skills.offers')}
                                                  </Chip>
                                                )}
                                                {member.is_requesting && (
                                                  <Chip size="sm" variant="flat" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px]">
                                                    {t('skills.wants')}
                                                  </Chip>
                                                )}
                                              </div>
                                            </Link>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="py-4 text-center">
                                          <p className="text-sm text-theme-subtle">
                                            {t('skills.no_members')}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </GlassCard>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

export default SkillsBrowsePage;
