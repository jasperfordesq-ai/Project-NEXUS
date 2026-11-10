import { CardBody, Card, Select, SelectItem, Button, Chip, Spinner, Input, Textarea } from '@/components/ui';
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDPR Request Create
 * Creation form for new admin-initiated GDPR requests.
 * Route: /admin/enterprise/gdpr/requests/create
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Eye from 'lucide-react/icons/eye';
import Trash2 from 'lucide-react/icons/trash-2';
import Download from 'lucide-react/icons/download';
import Edit from 'lucide-react/icons/square-pen';
import Lock from 'lucide-react/icons/lock';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Search from 'lucide-react/icons/search';
import type { LucideIcon } from 'lucide-react';
import { useTenant, useToast } from '@/contexts';
import { adminEnterprise, adminUsers } from '../../api/adminApi';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import type { AdminUser } from '../../api/types';

import { useTranslation } from 'react-i18next';

interface RequestTypeOption {
  key: string;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
}

const REQUEST_TYPES: RequestTypeOption[] = [
  { key: 'access', labelKey: 'enterprise.gdpr_type_access', descriptionKey: 'enterprise.gdpr_type_access_desc', icon: Eye },
  { key: 'erasure', labelKey: 'enterprise.gdpr_type_erasure', descriptionKey: 'enterprise.gdpr_type_erasure_desc', icon: Trash2 },
  { key: 'portability', labelKey: 'enterprise.gdpr_type_portability', descriptionKey: 'enterprise.gdpr_type_portability_desc', icon: Download },
  { key: 'rectification', labelKey: 'enterprise.gdpr_type_rectification', descriptionKey: 'enterprise.gdpr_type_rectification_desc', icon: Edit },
  { key: 'restriction', labelKey: 'enterprise.gdpr_type_restriction', descriptionKey: 'enterprise.gdpr_type_restriction_desc', icon: Lock },
  { key: 'objection', labelKey: 'enterprise.gdpr_type_objection', descriptionKey: 'enterprise.gdpr_type_objection_desc', icon: AlertTriangle },
];

const PRIORITY_KEYS = ['low', 'normal', 'high', 'urgent'] as const;

export function GdprRequestCreate() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.gdpr_create_request_title') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [userId, setUserId] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // User search autocomplete state
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<AdminUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedSearch = (query: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (query.length < 2) {
      setUserResults([]);
      setShowDropdown(false);
      setSearchDone(false);
      return;
    }
    setSearchDone(false);
    searchTimeoutRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await adminUsers.list({ search: query, page: 1, limit: 10 });
        if (res.success && res.data) {
          const data = res.data as unknown as { data?: AdminUser[] } | AdminUser[];
          const users = Array.isArray(data) ? data : (data as { data?: AdminUser[] }).data || [];
          setUserResults(users);
          setShowDropdown(users.length > 0);
          setSearchDone(true);
        }
      } catch {
        setUserResults([]);
        setSearchDone(true);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  };

  const handleSelectUser = (user: AdminUser) => {
    setSelectedUser(user);
    setUserId(String(user.id));
    setUserSearch('');
    setUserResults([]);
    setShowDropdown(false);
  };

  const handleDeselectUser = () => {
    setSelectedUser(null);
    setUserId('');
    setUserSearch('');
  };

  const handleSubmit = async () => {
    const parsedUserId = parseInt(userId, 10);
    if (!parsedUserId || isNaN(parsedUserId)) {
      toast.error(t('enterprise.gdpr_enter_valid_user_id'));
      return;
    }
    if (!selectedType) {
      toast.error(t('enterprise.gdpr_select_request_type'));
      return;
    }

    setSaving(true);
    try {
      const res = await adminEnterprise.createGdprRequest({
        user_id: parsedUserId,
        type: selectedType,
        priority,
        notes: notes.trim() || undefined,
      });
      if (res.success) {
        toast.success(t('enterprise.gdpr_request_created'));
        navigate(tenantPath('/admin/enterprise/gdpr/requests'));
      } else {
        const error = t('enterprise.gdpr_failed_create_request');
        toast.error(error);
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_create_request'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('enterprise.gdpr_create_request_title')}
        description={t('enterprise.gdpr_create_request_desc')}
        actions={
          <Button
            variant="secondary"
            startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath('/admin/enterprise/gdpr/requests'))}
            size="sm"
          >
            {t('enterprise.gdpr_back_to_requests')}
          </Button>
        }
      />

      <Card>
        <CardBody className="p-6 space-y-6">
          {/* User Search */}
          <div>
            {selectedUser ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {t('enterprise.gdpr_user')} <span className="text-danger">*</span>
                </p>
                <Chip
                  onClose={handleDeselectUser}
                  variant="soft"
                  color="accent"
                  size="lg"
                >
                  {t('enterprise.gdpr_selected_user', {
                    email: selectedUser.email,
                    id: selectedUser.id,
                    name: selectedUser.name,
                  })}
                </Chip>
              </div>
            ) : (
              <div className="relative">
                <Input
                  label={t('enterprise.gdpr_search_user')}
                  placeholder={t('enterprise.gdpr_search_user_placeholder')}
                  value={userSearch}
                  onValueChange={(val) => {
                    setUserSearch(val);
                    debouncedSearch(val);
                  }}
                  onFocus={() => {
                    if (userResults.length > 0) setShowDropdown(true);
                  }}
                  onBlur={() => {
                    // Delay to allow click on dropdown items
                    setTimeout(() => setShowDropdown(false), 200);
                  }}
                  variant="secondary"
                  isRequired
                  startContent={<Search size={16} />}
                  endContent={searchLoading ? <Spinner size="sm" /> : undefined}
                />
                {showDropdown && userResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-overlay border border-divider rounded-xl shadow-lg max-h-60 overflow-y-auto">
                    {userResults.map((user) => (
                      <Button
                        key={user.id}
                        variant="ghost"
                        className="w-full min-h-11 justify-start px-4 py-2.5 text-left transition-colors hover:bg-surface-secondary first:rounded-t-xl last:rounded-b-xl"
                        onMouseDown={(e) => e.preventDefault()}
                        onPress={() => handleSelectUser(user)}
                      >
                        <span className="font-medium text-sm">{user.name}</span>
                        <span className="text-muted text-sm"> ({user.email})</span>
                        <span className="text-muted text-xs ml-1">
                          {t('enterprise.gdpr_user_id_suffix', { id: user.id })}
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
                {searchDone && !searchLoading && userResults.length === 0 && userSearch.length >= 2 && (
                  <p className="text-xs text-muted mt-1">{t('enterprise.gdpr_no_users_found_for')}</p>
                )}
              </div>
            )}
          </div>

          {/* Request Type - Card Selector */}
          <div>
            <p className="text-sm font-medium text-foreground mb-3">
              {t('enterprise.gdpr_request_type')} <span className="text-danger">*</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {REQUEST_TYPES.map((type) => {
                const isSelected = selectedType === type.key;
                const Icon = type.icon;
                return (
                  <Button
                    key={type.key}
                    variant="outline"
                    onPress={() => setSelectedType(type.key)}
                    className={`
                      flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all
                      min-h-32 cursor-pointer text-center
                      ${isSelected
                        ? 'border-accent bg-accent-soft shadow-sm'
                        : 'border-border bg-surface-secondary hover:border-muted'
                      }
                    `}
                  >
                    <div className={`
                      flex h-10 w-10 items-center justify-center rounded-lg
                      ${isSelected ? 'bg-accent/20 text-accent-soft-foreground' : 'bg-surface text-muted'}
                    `}>
                      <Icon size={20} />
                    </div>
                    <div>
                      <p className={`font-semibold text-sm ${isSelected ? 'text-accent' : 'text-foreground'}`}>
                        {t(type.labelKey)}
                      </p>
                      <p className="text-xs text-muted mt-0.5">{t(type.descriptionKey)}</p>
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <Select
            label={t('enterprise.gdpr_priority')}
            selectedKeys={[priority]}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              if (val) setPriority(val);
            }}
            variant="secondary"
            className="max-w-xs"
          >
            {PRIORITY_KEYS.map((key) => (
              <SelectItem key={key} id={key} className="capitalize">
                {t(`enterprise.priority_${key}`)}
              </SelectItem>
            ))}
          </Select>

          {/* Notes */}
          <Textarea
            label={t('enterprise.gdpr_notes')}
            placeholder={t('enterprise.gdpr_notes_placeholder')}
            value={notes}
            onValueChange={setNotes}
            variant="secondary"
            minRows={3}
          />

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="tertiary"
              onPress={() => navigate(tenantPath('/admin/enterprise/gdpr/requests'))}
            >
              {t('enterprise.gdpr_cancel')}
            </Button>
            <Button
              startContent={<Save size={16} />}
              onPress={handleSubmit}
              isLoading={saving}
            >
              {t('enterprise.gdpr_create_request')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default GdprRequestCreate;
