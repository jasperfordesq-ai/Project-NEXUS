// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useMemo } from 'react';

import Search from 'lucide-react/icons/search';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { DynamicIcon, ICON_MAP, ICON_NAMES } from '@/components/ui/DynamicIcon';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody } from '@/components/ui/Modal';

interface IconPickerProps {
  value: string | null;
  onChange: (icon: string | null) => void;
  label?: string;
}

export function IconPicker({ value, onChange, label }: IconPickerProps) {
  const { t } = useTranslation('admin_nav');
  const resolvedLabel = label ?? t('icon_picker.label');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredIcons = useMemo(() => {
    if (!search.trim()) return ICON_NAMES;
    const q = search.toLowerCase();
    return ICON_NAMES.filter((name) =>
      name.toLowerCase().includes(q) || t(`icon_picker.icons.${name}`).toLowerCase().includes(q)
    );
  }, [search, t]);

  const handleSelect = (iconName: string) => {
    onChange(iconName);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = () => {
    onChange(null);
  };

  return (
    <div>
      <p className="text-sm font-medium text-theme-primary mb-1.5">{resolvedLabel}</p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="flex items-center gap-2 px-3 py-2 bg-theme-elevated hover:bg-theme-hover border border-theme-default rounded-lg h-10 min-w-[140px] justify-start"
          onPress={() => setIsOpen(true)}
        >
          {value ? (
            <>
              <DynamicIcon name={value} className="w-4 h-4 text-theme-primary" />
              <span className="text-sm text-theme-primary">{t(`icon_picker.icons.${value}`)}</span>
            </>
          ) : (
            <span className="text-sm text-theme-subtle">{t('icon_picker.search_for_icon')}</span>
          )}
        </Button>
        {value && (
          <Button
            isIconOnly
            variant="tertiary"
            size="sm"
            onPress={handleClear}
            aria-label={t('icon_picker.clear_icon')}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <Modal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false); setSearch(''); }}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-2">
            <ModalHeading>{t('icon_picker.choose_icon')}</ModalHeading>
            <Input
              placeholder={t('icon_picker.search_icons')}
              aria-label={t('icon_picker.search_icons')}
              value={search}
              onValueChange={setSearch}
              startContent={<Search className="w-4 h-4 text-theme-subtle" />}
              size="sm"
              autoFocus
            />
          </ModalHeader>
          <ModalBody className="pb-6">
            {filteredIcons.length === 0 ? (
              <p className="text-center text-theme-subtle py-8">{t('icon_picker.no_icons_found', { search })}</p>
            ) : (
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {filteredIcons.map((name) => {
                  const Icon = ICON_MAP[name];
                  if (!Icon) return null;
                  const isSelected = value === name;
                  const iconLabel = t(`icon_picker.icons.${name}`);
                  return (
                    <Button
                      key={name}
                      onPress={() => handleSelect(name)}
                      variant="tertiary"
                      className={`flex min-h-14 min-w-0 flex-col items-center gap-1 rounded-lg p-2 text-center transition-all hover:bg-theme-hover ${
                        isSelected
                          ? 'bg-accent/10 ring-2 ring-accent text-accent-soft-foreground'
                          : 'text-theme-muted'
                      }`}
                      title={iconLabel}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-[10px] leading-tight truncate w-full">{iconLabel}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
