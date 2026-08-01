// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Proximity filter for Listings, Events, and Volunteering pages.
// Coordinates come from the user's profile — no browser geolocation popup.

import { useTranslation } from 'react-i18next';
import MapPin from 'lucide-react/icons/map-pin';
import { Button } from '@/components/ui/Button';
import { Select, SelectItem } from '@/components/ui/Select';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import {
  FALLBACK_RADIUS_KM,
  RADIUS_OPTIONS,
  persistRadiusPreference,
  useSavedRadiusKm,
} from '@/hooks/useSavedRadiusKm';

export interface ProximityFilterParams {
  near_lat: number;
  near_lng: number;
  radius_km: number;
}

interface Props {
  value: ProximityFilterParams | null;
  onFilter: (params: ProximityFilterParams | null) => void;
  className?: string;
}

export function ProximityFilter({ value, onFilter, className }: Props) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const toast = useToast();
  // The member's own saved radius rather than a hardcoded 25 km. This one
  // component backs the Listings, Events and Volunteering filters.
  const savedRadius = useSavedRadiusKm();

  const isActive = value !== null;
  const radiusKm = value?.radius_km ?? savedRadius;

  function handleToggle() {
    if (isActive) {
      onFilter(null);
      return;
    }
    if (user?.latitude == null || user?.longitude == null) {
      toast.error(t('members.near_me_no_location'));
      return;
    }
    onFilter({ near_lat: user.latitude, near_lng: user.longitude, radius_km: savedRadius });
  }

  function handleRadiusChange(km: number) {
    if (user?.latitude == null || user?.longitude == null) return;
    // Remember it, so the next discovery page opens on the same radius.
    persistRadiusPreference(km);
    onFilter({ near_lat: user.latitude, near_lng: user.longitude, radius_km: km });
  }

  return (
    <div className={['flex flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}>
      <Button
        size="sm"
        variant={isActive ? 'solid' : 'flat'}
        className={isActive
          ? 'bg-emerald-600 text-white shadow-sm'
          : 'bg-theme-elevated text-theme-primary hover:bg-emerald-500/10 hover:text-emerald-600'}
        startContent={<MapPin className="w-4 h-4" aria-hidden="true" />}
        onPress={handleToggle}
        aria-pressed={isActive}
      >
        {t('members.near_me')}
      </Button>

      {isActive && (
        <Select
          aria-label={t('members.radius_label')}
          selectedKeys={[String(radiusKm)]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const val = keys instanceof Set ? ([...keys][0] as string) : String(FALLBACK_RADIUS_KM);
            handleRadiusChange(Number(val) || FALLBACK_RADIUS_KM);
          }}
          className="w-28"
          classNames={{
            trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
            value: 'text-theme-primary',
          }}
        >
          {RADIUS_OPTIONS.map((km) => (
            <SelectItem key={String(km)} id={String(km)}>{t(`radius_${km}`)}</SelectItem>
          ))}
        </Select>
      )}
    </div>
  );
}

export default ProximityFilter;
