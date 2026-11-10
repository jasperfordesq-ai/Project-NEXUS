// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * LocationRadiusFilter — location proximity filter with radius slider.
 */

import { Slider } from '@/components/ui/Slider';
import MapPin from 'lucide-react/icons/map-pin';
import Globe from 'lucide-react/icons/globe';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

interface LocationRadiusFilterProps {
  isNearby: boolean;
  radiusKm: number;
  onToggle: () => void;
  onRadiusChange: (km: number) => void;
  hasLocation: boolean;
}

export function LocationRadiusFilter({
  isNearby,
  radiusKm,
  onToggle,
  onRadiusChange,
  hasLocation,
}: LocationRadiusFilterProps) {
  const { t } = useTranslation('feed');

  const toggleButton = (
    <Button
      size="sm"
      variant={isNearby ? 'flat' : 'light'}
      className={
        isNearby
          ? 'bg-accent/10 text-accent-soft-foreground border border-accent/20'
          : 'text-[var(--text-muted)]'
      }
      startContent={isNearby ? <MapPin className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
      onPress={onToggle}
      isDisabled={!hasLocation}
      aria-label={
        isNearby
          ? t('location.nearby')
          : t('location.global')
      }
    >
      {isNearby
        ? t('location.nearby')
        : t('location.global')}
    </Button>
  );

  return (
    <div className="flex items-center gap-3">
      {!hasLocation ? (
        <Tooltip content={t('location.add_location')}>
          <div>{toggleButton}</div>
        </Tooltip>
      ) : (
        toggleButton
      )}

      {isNearby && hasLocation && (
        <div className="flex items-center gap-2 min-w-[160px]">
          <Slider
            size="sm"
            step={10}
            minValue={10}
            maxValue={500}
            value={radiusKm}
            onChange={(val) => onRadiusChange(val as number)}
            className="flex-1"
            aria-label={t('location.radius')}
            classNames={{
              track: 'bg-[var(--border-default)]',
              filler: 'bg-gradient-to-r from-accent to-accent-gradient-end',
              thumb: 'bg-white shadow-md',
            }}
          />
          <span className="text-xs font-medium whitespace-nowrap min-w-[40px] text-right text-[var(--text-muted)]">
            {radiusKm} {t('location.km')}
          </span>
        </div>
      )}
    </div>
  );
}

export default LocationRadiusFilter;
