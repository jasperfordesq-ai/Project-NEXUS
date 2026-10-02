// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OnboardingSkillsPicker — one half of the onboarding skills step
 * ("I can offer" or "I'd like help with").
 *
 * The member taps suggestions or types their own. The chosen names are saved
 * on completion into the member's skills (`user_skills`), which matching,
 * Explore and the personalised feed read, and which the member can edit later
 * in Settings → Skills.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Plus from 'lucide-react/icons/plus';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { TagGroup, Tag } from '@/components/ui/TagGroup';

/** Matches user_skills.skill_name and the server-side limit. */
export const SKILL_NAME_MAX = 100;
/** Matches OnboardingService::SKILLS_PER_DIRECTION_MAX. */
export const SKILLS_PER_LIST_MAX = 25;

const keyOf = (name: string) => name.trim().toLocaleLowerCase();

interface OnboardingSkillsPickerProps {
  title: string;
  description: string;
  icon: ReactNode;
  suggestions: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  countLabel: string;
  selectedClassName: string;
}

export function OnboardingSkillsPicker({
  title,
  description,
  icon,
  suggestions,
  selected,
  onChange,
  countLabel,
  selectedClassName,
}: OnboardingSkillsPickerProps) {
  const { t } = useTranslation('onboarding');
  const [draft, setDraft] = useState('');

  // Everything the member can tap: what they already chose first (so typed
  // entries stay visible), then the suggestions, de-duplicated by name.
  const options = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const name of [...selected, ...suggestions]) {
      const k = keyOf(name);
      if (k && !byKey.has(k)) byKey.set(k, name.trim());
    }
    return Array.from(byKey, ([id, label]) => ({ id, label }));
  }, [selected, suggestions]);

  const labelFor = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options]);
  const atLimit = selected.length >= SKILLS_PER_LIST_MAX;
  const draftName = draft.trim();

  const addDraft = () => {
    if (!draftName || atLimit) return;
    if (!selected.some((s) => keyOf(s) === keyOf(draftName))) {
      const existing = labelFor.get(keyOf(draftName));
      onChange([...selected, existing ?? draftName]);
    }
    setDraft('');
  };

  return (
    <GlassCard className="p-6">
      <h2 className="text-lg font-semibold text-theme-primary mb-1 flex items-center gap-2">
        {icon}
        {title}
      </h2>
      <p className="text-theme-muted text-sm mb-4">{description}</p>

      {options.length > 0 && (
        <TagGroup
          aria-label={title}
          selectionMode="multiple"
          selectedKeys={new Set(selected.map(keyOf))}
          onSelectionChange={(keys) => {
            const ids = keys === 'all' ? options.map((o) => o.id) : Array.from(keys).map(String);
            onChange(
              ids
                .map((id) => labelFor.get(id))
                .filter((label): label is string => !!label)
                .slice(0, SKILLS_PER_LIST_MAX),
            );
          }}
        >
          <TagGroup.List className="flex flex-wrap gap-2">
            {options.map((o) => (
              <Tag key={o.id} id={o.id} className={selectedClassName}>
                {o.label}
              </Tag>
            ))}
          </TagGroup.List>
        </TagGroup>
      )}

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addDraft();
        }}
      >
        <Input
          label={t('skills_add_own_label')}
          placeholder={t('skills_add_own_placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={SKILL_NAME_MAX}
          isDisabled={atLimit}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          isDisabled={!draftName || atLimit}
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
        >
          {t('skills_add_button')}
        </Button>
      </form>

      {selected.length > 0 && (
        <p className="text-xs text-theme-muted mt-3 font-medium" role="status">
          {countLabel}
        </p>
      )}
    </GlassCard>
  );
}

export default OnboardingSkillsPicker;
