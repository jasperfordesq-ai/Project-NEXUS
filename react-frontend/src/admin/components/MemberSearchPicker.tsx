// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useRef, useState } from 'react';

import Search from 'lucide-react/icons/search';
import { adminUsers } from '../api/adminApi';
import type { AdminUser } from '../api/types';
import { Button, Spinner, Input, Avatar } from '@/components/ui';
import { resolveUserDisplayName } from '@/lib/helpers';

const SEARCH_DEBOUNCE_MS = 300;

export interface MemberSearchMember {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
}

interface MemberSearchPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  selectedMember?: MemberSearchMember | null;
  onSelectedMemberChange?: (member: MemberSearchMember | null) => void;
  label: string;
  placeholder: string;
  noResultsText: string;
  clearText: string;
  isRequired?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function mapAdminUser(user: Partial<AdminUser> & { id: number }): MemberSearchMember {
  const fullName = resolveUserDisplayName(user);

  return {
    id: user.id,
    name: user.name || fullName || `#${user.id}`,
    email: user.email || '',
    avatar_url: user.avatar_url ?? user.avatar ?? null,
  };
}

function normalizeSearchResults(payload: unknown): MemberSearchMember[] {
  const items = Array.isArray(payload)
    ? payload
    : (payload as { data?: unknown[] } | null | undefined)?.data;

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is Partial<AdminUser> & { id: number } => Boolean(item && typeof item === 'object' && 'id' in item))
    .map(mapAdminUser);
}

export function MemberSearchPicker({
  value,
  onValueChange,
  selectedMember,
  onSelectedMemberChange,
  label,
  placeholder,
  noResultsText,
  clearText,
  isRequired = false,
  size = 'md',
  className,
}: MemberSearchPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberSearchMember[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hydrationLoading, setHydrationLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [hydratedMember, setHydratedMember] = useState<MemberSearchMember | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedId = value ? Number(value) : null;
  const resolvedSelectedMember = useMemo(() => {
    if (selectedMember && selectedId === selectedMember.id) {
      return selectedMember;
    }

    if (hydratedMember && selectedId === hydratedMember.id) {
      return hydratedMember;
    }

    return null;
  }, [hydratedMember, selectedId, selectedMember]);

  useEffect(() => {
    if (!selectedId) {
      setHydratedMember(null);
      return;
    }

    if (selectedMember && selectedMember.id === selectedId) {
      setHydratedMember(selectedMember);
      return;
    }

    if (hydratedMember && hydratedMember.id === selectedId) {
      return;
    }

    let cancelled = false;

    setHydrationLoading(true);
    adminUsers.get(selectedId)
      .then((response) => {
        if (!cancelled && response.success && response.data) {
          const member = mapAdminUser(response.data as AdminUser);
          setHydratedMember(member);
          onSelectedMemberChange?.(member);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHydratedMember(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHydrationLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hydratedMember, onSelectedMemberChange, selectedId, selectedMember]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await adminUsers.list({ search: query.trim(), page: 1, limit: 8 });
        if (response.success) {
          const members = normalizeSearchResults(response.data);
          setResults(members);
          setShowDropdown(members.length > 0);
        } else {
          setResults([]);
          setShowDropdown(false);
        }
      } catch {
        setResults([]);
        setShowDropdown(false);
      } finally {
        setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  const handleSelect = (member: MemberSearchMember) => {
    setHydratedMember(member);
    onSelectedMemberChange?.(member);
    onValueChange(String(member.id));
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  const handleClear = () => {
    setHydratedMember(null);
    onSelectedMemberChange?.(null);
    onValueChange('');
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  if (resolvedSelectedMember) {
    return (
      <div className={className}>
        <p className="text-sm font-medium text-foreground mb-2">
          {label}
          {isRequired ? <span className="text-danger"> *</span> : null}
        </p>
        <div className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-surface px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              src={resolvedSelectedMember.avatar_url || undefined}
              name={resolvedSelectedMember.name}
              size={size === 'sm' ? 'sm' : 'md'}
              className="shrink-0"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{resolvedSelectedMember.name}</p>
              <p className="truncate text-xs text-muted">{resolvedSelectedMember.email}</p>
            </div>
          </div>
          <Button size={size} variant="tertiary" onPress={handleClear}>
            {clearText}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className || ''}`}>
      <Input
        label={label}
        placeholder={placeholder}
        value={query}
        onValueChange={setQuery}
        onFocus={() => {
          if (results.length > 0) {
            setShowDropdown(true);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setShowDropdown(false), 200);
        }}
        isRequired={isRequired}
        size={size}
        startContent={<Search size={14} className="text-muted" />}
        endContent={searchLoading || hydrationLoading ? <Spinner size="sm" /> : undefined}
      />

      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-[14px] border border-border bg-overlay shadow-lg">
          {results.map((member) => (
            <Button
              key={member.id}
              variant="tertiary"
              className="min-h-10 w-full justify-start gap-3 rounded-none px-3 py-2"
              onMouseDown={(event) => event.preventDefault()}
              onPress={() => handleSelect(member)}
            >
              <Avatar
                src={member.avatar_url || undefined}
                name={member.name}
                size="sm"
                className="shrink-0"
              />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted">{member.email}</p>
              </div>
            </Button>
          ))}
        </div>
      )}

      {query.trim().length >= 2 && !searchLoading && results.length === 0 && (
        <p className="mt-1 text-xs text-muted">{noResultsText}</p>
      )}
    </div>
  );
}
