// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ReviewModal - Modal for creating/submitting user reviews
 */

import { useState } from 'react';

import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { resolveAvatarUrl } from '@/lib/helpers';
import { Button, Textarea, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter, Avatar } from '@/components/ui';
import { StarRating } from '@/components/ui/StarRating';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  receiverId: number;
  receiverName: string;
  receiverAvatar?: string | null;
  transactionId?: number;
}

export function ReviewModal({
  isOpen,
  onClose,
  onSuccess,
  receiverId,
  receiverName,
  receiverAvatar,
  transactionId,
}: ReviewModalProps) {
  const toast = useToast();
  const { t } = useTranslation('profile');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;

    if (rating === 0) {
      toast.error(t('toast.select_rating'));
      return;
    }

    try {
      setIsSubmitting(true);

      const response = await api.post('/v2/reviews', {
        receiver_id: receiverId,
        rating,
        comment: comment.trim() || undefined,
        transaction_id: transactionId || undefined,
      });

      if (response.success) {
        toast.success(t('toast.review_submitted'));
        handleClose();
        onSuccess?.();
      } else {
        toast.error(response.error || t('review_modal.submit_failed_fallback'));
      }
    } catch {
      toast.error(t('toast.review_submit_failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setRating(0);
    setComment('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <ModalHeading className="text-xl font-bold text-theme-primary">
            {t('review_modal.title')}
          </ModalHeading>
          <p className="text-sm text-theme-subtle font-normal">
            {t('review_modal.subtitle', { name: receiverName })}
          </p>
        </ModalHeader>

        <ModalBody>
          {/* Receiver Info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-theme-elevated">
            <Avatar
              src={resolveAvatarUrl(receiverAvatar)}
              name={receiverName}
              size="md"
              className="ring-2 ring-theme-muted/20"
            />
            <div>
              <p className="font-medium text-theme-primary">{receiverName}</p>
              <p className="text-xs text-theme-subtle">
                {transactionId ? t('review_modal.transaction_review') : t('review_modal.general_review')}
              </p>
            </div>
          </div>

          <StarRating
            value={rating}
            onChange={setRating}
            label={t('review_modal.rating_label')}
            getOptionLabel={(star) => t('review_modal.rate_star', { star })}
            getValueDescription={(star) => [
              t('review_modal.rating_poor'),
              t('review_modal.rating_fair'),
              t('review_modal.rating_good'),
              t('review_modal.rating_very_good'),
              t('review_modal.rating_excellent'),
            ][star - 1]}
            labelClassName="mb-1 basis-full text-sm font-medium text-theme-primary"
            descriptionClassName="mt-1"
            isRequired
          />

          {/* Comment */}
          <div className="flex w-full flex-col gap-1">
            <Textarea
              id="review-comment"
              label={t('review_modal.comment_label')}
              fullWidth
              className="w-full"
              placeholder={t('review_modal.comment_placeholder')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              minRows={4}
              maxRows={8}
              maxLength={2000}
              classNames={{
                label: 'text-sm font-medium text-theme-primary',
                input: 'w-full text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
            <p className="text-xs text-theme-subtle text-right">
              {t('review_modal.characters_count', { count: comment.length, max: 2000 })}
            </p>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button
            variant="flat"
            onPress={handleClose}
            className="bg-theme-elevated text-theme-muted"
          >
            {t('review_modal.cancel')}
          </Button>
          <Button
            onPress={handleSubmit}
            isLoading={isSubmitting}
            isDisabled={rating === 0}
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
          >
            {t('review_modal.submit')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
