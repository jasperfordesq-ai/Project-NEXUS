import { Card, CardBody, Button, Chip, Switch } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ModuleCard
 * Displays a single module in the configuration grid with toggle and configure actions.
 */


import Settings2 from 'lucide-react/icons/settings-2';
import { useTranslation } from 'react-i18next';
import type { ModuleDefinition } from './moduleRegistry';

interface ModuleCardProps {
  module: ModuleDefinition;
  enabled: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: (module: ModuleDefinition) => void;
  toggling: boolean;
}

export default function ModuleCard({ module, enabled, onToggle, onConfigure, toggling }: ModuleCardProps) {
  const { t } = useTranslation('admin_config');
  const Icon = module.icon;
  const optionCount = module.configOptions.length;
  const liveCount = module.configOptions.filter(o => !o.comingSoon).length;

  const nameKey = `config.module_name_${module.id}`;
  const descKey = `config.module_desc_${module.id}`;
  const moduleName = t(nameKey);
  const moduleDesc = t(descKey);

  return (
    <Card  className="h-full">
      <CardBody className={`p-4 flex flex-col gap-3 ${!enabled ? 'opacity-60' : ''}`}>
        {module.id === 'two_factor_authentication' && <p className="text-xs">{t('config.two_factor_enforcement_hint')}</p>}
        {/* Header: icon + name + toggle */}
        <div className="flex items-start gap-3">
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
              module.type === 'core'
                ? 'bg-accent-soft text-accent'
                : 'bg-accent/10 text-accent'
            }`}
          >
            <Icon size={20} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="text-sm font-semibold truncate">{moduleName}</h3>
                {module.stage && (
                  <Chip size="sm" variant="soft" color={module.stage === 'alpha' ? 'warning' : 'secondary'} className="flex-shrink-0">
                    {t(`config.stage_${module.stage}`)}
                  </Chip>
                )}
              </div>
              <Switch
                size="sm"
                isSelected={enabled}
                isDisabled={toggling}
                onValueChange={(val) => onToggle(module.id, val)}
                aria-label={module.id === 'two_factor_authentication' ? t('config.two_factor_optional_enrollment') : t('config.toggle_module', { name: moduleName })}
                className="flex-shrink-0"
              />
            </div>
            <p className="text-xs text-muted line-clamp-2 mt-0.5">{moduleDesc}</p>
          </div>
        </div>

        {/* Footer: option count + configure button */}
        <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {optionCount > 0 ? (
              <Chip size="sm" variant="soft" color={liveCount > 0 ? 'primary' : 'default'}>
                {liveCount > 0
                  ? t('config.option_count', { count: liveCount })
                  : t('config.planned_count', { count: optionCount })}
              </Chip>
            ) : !module.detailPageUrl ? (
              <Chip size="sm" variant="soft">{t('config.no_options')}</Chip>
            ) : null}
            {module.type === 'core' && (
              <Chip size="sm" variant="soft">{t('config.core')}</Chip>
            )}
          </div>
          {(optionCount > 0 || module.detailPageUrl) && (
            <Button
              size="sm"
              variant="tertiary"
              startContent={<Settings2 size={14} aria-hidden="true" />}
              onPress={() => onConfigure(module)}
              className="ml-auto shrink-0"
            >
              {t('config.configure')}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
