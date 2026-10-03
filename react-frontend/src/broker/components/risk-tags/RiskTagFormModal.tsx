// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tag a listing, or edit an existing tag. `tag` null means create: the
 * listing is chosen with the search picker (or by id), optionally pre-filled
 * from a `?listing=` deep link. Editing fixes the listing. The server upserts
 * by listing id, so both paths are the same call.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import type { RiskTag } from '@/admin/api/types';
import { ListingSearchPicker } from './ListingSearchPicker';
import {
  EMPTY_RISK_TAG_FORM,
  RISK_CATEGORY_KEYS,
  RISK_LEVEL_KEYS,
  riskTagFormFromTag,
  type ListingSummary,
  type RiskTagFormValues,
} from './riskTagShared';

interface RiskTagFormModalProps {
  isOpen: boolean;
  /** The tag being edited, or null to tag a new listing. */
  tag: RiskTag | null;
  /** Pre-selected listing for a new tag (a `?listing=` deep link). */
  initialListing?: ListingSummary | null;
  onClose: () => void;
  /** Called after a successful save. */
  onSaved: () => void;
}

export function RiskTagFormModal({ isOpen, tag, initialListing = null, onClose, onSaved }: RiskTagFormModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [form, setForm] = useState<RiskTagFormValues>(EMPTY_RISK_TAG_FORM);
  const [selectedListing, setSelectedListing] = useState<ListingSummary | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (tag) {
      setForm(riskTagFormFromTag(tag));
      setSelectedListing(null);
    } else {
      setForm({ ...EMPTY_RISK_TAG_FORM, listing_id: initialListing ? String(initialListing.id) : '' });
      setSelectedListing(initialListing);
    }
  }, [isOpen, tag, initialListing]);

  const patch = (changes: Partial<RiskTagFormValues>) => setForm((prev) => ({ ...prev, ...changes }));

  const handleSave = async () => {
    const listingId = parseInt(form.listing_id, 10);
    if (!listingId || listingId <= 0) {
      toast.error(t('risk_tags.select_listing_error'));
      return;
    }
    if (!form.risk_category.trim()) {
      toast.error(t('risk_tags.category_required_error'));
      return;
    }
    setSaving(true);
    try {
      const res = await adminBroker.saveRiskTag(listingId, {
        risk_level: form.risk_level,
        risk_category: form.risk_category.trim(),
        risk_notes: form.risk_notes || undefined,
        member_visible_notes: form.member_visible_notes || undefined,
        requires_approval: form.requires_approval,
        insurance_required: form.insurance_required,
      });
      if (res.success) {
        toast.success(tag ? t('risk_tags.updated_success') : t('risk_tags.created_success'));
        onSaved();
        onClose();
      } else {
        toast.error(t('risk_tags.save_failed'));
      }
    } catch {
      toast.error(t('risk_tags.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>
          {tag ? t('risk_tags.modal_title_edit') : t('risk_tags.modal_title_create')}
        </ModalHeader>
        <ModalBody className="space-y-4">
          {tag ? (
            <div>
              <p className="text-sm text-muted">{t('risk_tags.listing_field_label')}</p>
              <p className="font-medium">
                {tag.listing_title ?? t('risk_tags.listing_number', { id: tag.listing_id })}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <ListingSearchPicker
                value={form.listing_id}
                onValueChange={(listing_id) => patch({ listing_id })}
                selectedListing={selectedListing}
                onSelectedListingChange={setSelectedListing}
                label={t('risk_tags.search_listing_label')}
                placeholder={t('risk_tags.search_listing_placeholder')}
                noResultsText={t('risk_tags.empty_search_title')}
                clearText={t('risk_tags.change')}
                isRequired
              />
              {!form.listing_id && (
                // Fallback: the broker already knows the listing number.
                <Input
                  label={t('risk_tags.manual_id_label')}
                  type="number"
                  value={form.listing_id}
                  onValueChange={(listing_id) => patch({ listing_id })}
                  placeholder={t('risk_tags.manual_id_placeholder')}
                  min={1}
                  size="sm"
                />
              )}
            </div>
          )}

          <Select
            label={t('risk_tags.risk_level_label')}
            selectedKeys={new Set([form.risk_level])}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as RiskTagFormValues['risk_level'] | undefined;
              if (val) patch({ risk_level: val });
            }}
            isRequired
          >
            {RISK_LEVEL_KEYS.map((key) => (
              <SelectItem key={key} id={key}>{t(`risk_tags.level_${key}`)}</SelectItem>
            ))}
          </Select>

          <Select
            label={t('risk_tags.risk_category_label')}
            selectedKeys={form.risk_category ? new Set([form.risk_category]) : new Set()}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string | undefined;
              if (val) patch({ risk_category: val });
            }}
            isRequired
          >
            {RISK_CATEGORY_KEYS.map((key) => (
              <SelectItem key={key} id={key}>{t(`risk_tags.category_${key}`)}</SelectItem>
            ))}
          </Select>

          <Textarea
            label={t('risk_tags.risk_notes_label')}
            value={form.risk_notes}
            onValueChange={(risk_notes) => patch({ risk_notes })}
            placeholder={t('risk_tags.risk_notes_placeholder')}
            minRows={3}
          />

          <Textarea
            label={t('risk_tags.member_visible_notes_label')}
            value={form.member_visible_notes}
            onValueChange={(member_visible_notes) => patch({ member_visible_notes })}
            placeholder={t('risk_tags.member_visible_notes_placeholder')}
            minRows={3}
          />

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t('risk_tags.requires_approval_label')}</p>
              <p className="text-xs text-muted">{t('risk_tags.requires_approval_description')}</p>
            </div>
            <Switch
              aria-label={t('risk_tags.requires_approval_label')}
              isSelected={form.requires_approval}
              onValueChange={(requires_approval) => patch({ requires_approval })}
              size="sm"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t('risk_tags.insurance_required_label')}</p>
              <p className="text-xs text-muted">{t('risk_tags.insurance_required_description')}</p>
            </div>
            <Switch
              aria-label={t('risk_tags.insurance_required_label')}
              isSelected={form.insurance_required}
              onValueChange={(insurance_required) => patch({ insurance_required })}
              size="sm"
            />
          </div>

          {tag?.dbs_required && (
            <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4" role="alert">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('risk_tags.legacy_role_vetting_unavailable')}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {t('risk_tags.legacy_role_vetting_unavailable_description')}
                </p>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
            {t('risk_tags.cancel')}
          </Button>
          <Button variant="primary" onPress={handleSave} isPending={saving}>
            {tag ? t('risk_tags.update_tag') : t('risk_tags.create_tag')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default RiskTagFormModal;
