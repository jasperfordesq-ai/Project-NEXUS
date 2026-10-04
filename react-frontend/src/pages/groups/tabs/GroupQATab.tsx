// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * Group Q&A Tab (GR1)
 * Stack Overflow-style Q&A within a group: questions, answers, voting, accept.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import HelpCircle from 'lucide-react/icons/circle-help';
import ArrowUp from 'lucide-react/icons/arrow-up';
import ArrowDown from 'lucide-react/icons/arrow-down';
import Check from 'lucide-react/icons/check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import MessageSquare from 'lucide-react/icons/message-square';
import Plus from 'lucide-react/icons/plus';
import { useTranslation } from 'react-i18next';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import {
  acceptGroupAnswer,
  askGroupQuestion,
  getGroupQuestion,
  listGroupQuestions,
  postGroupAnswer,
  voteOnGroupQA,
  type GroupQuestion as Question,
  type GroupQuestionDetail as QuestionDetail,
  type GroupQuestionSort as SortOption,
} from '../api/qa';
import { normalizeGroupApiError, type GroupApiError } from '../api/core';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GroupQATabProps {
  groupId: number;
  isAdmin: boolean;
  isMember?: boolean;
}

function nextVoteState(
  voteCount: number,
  userVote: 1 | -1 | 0,
  requestedVote: 1 | -1,
): { vote_count: number; user_vote: 1 | -1 | 0 } {
  const nextVote = userVote === requestedVote ? 0 : requestedVote;
  return {
    vote_count: voteCount + nextVote - userVote,
    user_vote: nextVote,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vote button sub-component
// ─────────────────────────────────────────────────────────────────────────────

interface VoteControlsProps {
  type: 'question' | 'answer';
  targetId: number;
  voteCount: number;
  userVote: 1 | -1 | 0;
  votingIds: Set<string>;
  handleVote: (type: 'question' | 'answer', targetId: number, vote: 1 | -1) => Promise<void>;
  isMember: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function VoteControls({
  type,
  targetId,
  voteCount,
  userVote,
  votingIds,
  handleVote,
  isMember,
  t,
}: VoteControlsProps) {
  const isVoting = votingIds.has(`${type}-${targetId}`);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <Button
        isIconOnly
        variant="light"
        size="sm"
        className={`min-h-11 min-w-11 ${userVote === 1 ? 'text-success' : 'text-muted'}`}
        onPress={() => handleVote(type, targetId, 1)}
        isDisabled={isVoting || !isMember}
        aria-label={t('qa.upvote_aria')}
      >
        <ArrowUp className="w-4 h-4" aria-hidden="true" />
      </Button>
      <span
        role="img"
        className={`text-sm font-semibold ${
          voteCount > 0
            ? 'text-success'
            : voteCount < 0
              ? 'text-danger'
              : 'text-muted'
        }`}
        aria-label={t('qa.vote_count_aria', { count: voteCount })}
      >
        {voteCount}
      </span>
      <Button
        isIconOnly
        variant="light"
        size="sm"
        className={`min-h-11 min-w-11 ${userVote === -1 ? 'text-danger' : 'text-muted'}`}
        onPress={() => handleVote(type, targetId, -1)}
        isDisabled={isVoting || !isMember}
        aria-label={t('qa.downvote_aria')}
      >
        <ArrowDown className="w-4 h-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupQATab({ groupId, isAdmin, isMember = true }: GroupQATabProps) {
  const { t } = useTranslation('groups');
  const { t: tCommon } = useTranslation('common');
  const toast = useToast();
  const askModal = useDisclosure();

  // Question list state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const [listError, setListError] = useState<{ error: GroupApiError; reset: boolean } | null>(null);
  const questionsRequestRef = useRef<AbortController | null>(null);
  const searchMountedRef = useRef(false);

  // Ask question form
  const [askTitle, setAskTitle] = useState('');
  const [askBody, setAskBody] = useState('');
  const [asking, setAsking] = useState(false);

  // Expanded question state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<QuestionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<GroupApiError | null>(null);
  const detailRequestRef = useRef<AbortController | null>(null);

  // Answer form state
  const [answerBody, setAnswerBody] = useState('');
  const [submittingAnswer, setSubmittingAnswer] = useState(false);

  // Voting in-flight tracker
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());

  // ─────────────────────────────────────────────────────────────────────
  // Load questions
  // ─────────────────────────────────────────────────────────────────────

  const loadQuestions = useCallback(
    async (reset = false) => {
      questionsRequestRef.current?.abort();
      const controller = new AbortController();
      questionsRequestRef.current = controller;
      setLoading(true);
      setListError(null);

      try {
        const data = await listGroupQuestions(groupId, {
          sort,
          cursor: reset ? null : cursor,
          query: search,
          perPage: 20,
          signal: controller.signal,
        });
        if (controller.signal.aborted || questionsRequestRef.current !== controller) return;

        if (reset) {
          setQuestions(data.items);
        } else {
          setQuestions((prev) => [...prev, ...data.items]);
        }
        setCursor(data.cursor);
        setHasMore(data.has_more);
      } catch (err) {
        const apiError = normalizeGroupApiError(err);
        if (apiError.isCancellation) return;
        if (questionsRequestRef.current !== controller) return;
        logError('GroupQATab.loadQuestions', err);
        setListError({ error: apiError, reset });
      } finally {
        if (!controller.signal.aborted && questionsRequestRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [groupId, cursor, sort, search],
  );

  useEffect(() => {
    void loadQuestions(true);
  }, [groupId, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detailRequestRef.current?.abort();
    setExpandedId(null);
    setExpandedDetail(null);
    setDetailError(null);
    setAnswerBody('');
  }, [groupId]);

  // Debounced search
  useEffect(() => {
    if (!searchMountedRef.current) {
      searchMountedRef.current = true;
      return;
    }
    const timeout = setTimeout(() => void loadQuestions(true), 300);
    return () => clearTimeout(timeout);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    questionsRequestRef.current?.abort();
    detailRequestRef.current?.abort();
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // Expand / collapse a question (load detail with answers)
  // ─────────────────────────────────────────────────────────────────────

  const loadQuestionDetail = useCallback(
    async (questionId: number) => {
      detailRequestRef.current?.abort();
      const controller = new AbortController();
      detailRequestRef.current = controller;
      setExpandedId(questionId);
      setExpandedDetail(null);
      setDetailError(null);
      setLoadingDetail(true);

      try {
        const detail = await getGroupQuestion(groupId, questionId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || detailRequestRef.current !== controller) return;
        setExpandedDetail(detail);
      } catch (err) {
        const apiError = normalizeGroupApiError(err);
        if (apiError.isCancellation) return;
        if (detailRequestRef.current !== controller) return;
        logError('GroupQATab.loadDetail', err);
        setDetailError(apiError);
      } finally {
        if (!controller.signal.aborted && detailRequestRef.current === controller) {
          setLoadingDetail(false);
        }
      }
    },
    [groupId],
  );

  const toggleExpand = useCallback(
    (questionId: number) => {
      if (expandedId === questionId) {
        detailRequestRef.current?.abort();
        setExpandedId(null);
        setExpandedDetail(null);
        setDetailError(null);
        setAnswerBody('');
        return;
      }

      void loadQuestionDetail(questionId);
    },
    [expandedId, loadQuestionDetail],
  );

  // ─────────────────────────────────────────────────────────────────────
  // Ask a question
  // ─────────────────────────────────────────────────────────────────────

  const handleAsk = async () => {
    if (!askTitle.trim() || !askBody.trim()) return;
    setAsking(true);

    try {
      await askGroupQuestion(groupId, {
        title: askTitle.trim(),
        body: askBody.trim(),
      });
      toast.success(t('qa.ask_success'));
      setAskTitle('');
      setAskBody('');
      askModal.onClose();
      void loadQuestions(true);
    } catch (err) {
      logError('GroupQATab.ask', err);
      toast.error(t('qa.ask_error'));
    } finally {
      setAsking(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Post an answer
  // ─────────────────────────────────────────────────────────────────────

  const handleAnswer = async () => {
    if (!answerBody.trim() || !expandedId) return;
    setSubmittingAnswer(true);

    try {
      await postGroupAnswer(groupId, expandedId, {
        body: answerBody.trim(),
      });
      toast.success(t('qa.answer_success'));
      setAnswerBody('');
      // Refresh expanded detail without collapsing it, plus the list answer count.
      void loadQuestionDetail(expandedId);
      void loadQuestions(true);
    } catch (err) {
      logError('GroupQATab.answer', err);
      toast.error(t('qa.answer_error'));
    } finally {
      setSubmittingAnswer(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Vote (question or answer)
  // ─────────────────────────────────────────────────────────────────────

  const handleVote = async (
    type: 'question' | 'answer',
    targetId: number,
    vote: 1 | -1,
  ) => {
    const key = `${type}-${targetId}`;
    if (votingIds.has(key)) return;

    setVotingIds((prev) => new Set(prev).add(key));

    try {
      await voteOnGroupQA(groupId, {
        type,
        target_id: targetId,
        vote,
      });

      // Update local state for immediate feedback
      if (type === 'question') {
        setQuestions((prev) =>
          prev.map((q) =>
            q.id === targetId
              ? {
                  ...q,
                  ...nextVoteState(q.vote_count, q.user_vote, vote),
                }
              : q,
          ),
        );
        // Also update expanded detail if this question is expanded
        if (expandedDetail && expandedDetail.id === targetId) {
          setExpandedDetail((prev) =>
            prev
              ? {
                  ...prev,
                  ...nextVoteState(prev.vote_count, prev.user_vote, vote),
                }
              : prev,
          );
        }
      } else if (expandedDetail) {
        setExpandedDetail((prev) =>
          prev
            ? {
                ...prev,
                answers: prev.answers.map((a) =>
                  a.id === targetId
                    ? {
                        ...a,
                        ...nextVoteState(a.vote_count, a.user_vote, vote),
                      }
                    : a,
                ),
              }
            : prev,
        );
      }
    } catch (err) {
      logError('GroupQATab.vote', err);
      toast.error(t('qa.vote_error'));
    } finally {
      setVotingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Accept answer
  // ─────────────────────────────────────────────────────────────────────

  const handleAccept = async (answerId: number) => {
    if (!expandedDetail) return;

    try {
      await acceptGroupAnswer(groupId, answerId);

      toast.success(t('qa.accept_success'));

      // Update local state
      setExpandedDetail((prev) =>
        prev
          ? {
              ...prev,
              has_accepted_answer: true,
              answers: prev.answers.map((a) => ({
                ...a,
                is_accepted: a.id === answerId,
              })),
            }
          : prev,
      );

      // Update list to reflect accepted status
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === expandedDetail.id ? { ...q, has_accepted_answer: true } : q,
        ),
      );
    } catch (err) {
      logError('GroupQATab.accept', err);
      toast.error(t('qa.accept_error'));
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Sort tabs config
  // ─────────────────────────────────────────────────────────────────────

  const sortOptions: { key: SortOption; label: string }[] = [
    { key: 'newest', label: t('qa.sort_newest') },
    { key: 'most_voted', label: t('qa.sort_most_voted') },
    { key: 'unanswered', label: t('qa.sort_unanswered') },
  ];

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  if (loading && questions.length === 0) {
    return (
      <div
        className="flex justify-center py-12"
        role="status"
        aria-label={t('qa.loading')}
        aria-busy="true"
      >
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchField
          placeholder={t('qa.search_placeholder')}
          value={search}
          onValueChange={setSearch}
          className="flex-1"
          isClearable={Boolean(search)}
          size="sm"
          aria-label={t('qa.search_aria')}
        />
        {isMember && (
          <Button
            color="primary"
            size="sm"
            className="w-full sm:w-auto"
            startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            onPress={askModal.onOpen}
          >
            {t('qa.ask_question')}
          </Button>
        )}
      </div>

      {/* Sort tabs */}
      <Tabs
        aria-label={t('qa.sort_aria')}
        selectedKey={sort}
        onSelectionChange={(key) => setSort(key as SortOption)}
        variant="underlined"
        color="primary"
        classNames={{
          tabList: 'w-full gap-2 overflow-x-auto rounded-lg border border-border bg-surface px-2',
          tab: 'h-10 px-3',
        }}
      >
        {sortOptions.map((opt) => (
          <Tab key={opt.key} title={opt.label} />
        ))}
      </Tabs>

      {listError && (
        <GlassCard className="p-4" role="alert">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-danger">{t('qa.load_error')}</p>
            {listError.error.retryable && (
              <Button
                variant="flat"
                size="sm"
                onPress={() => void loadQuestions(listError.reset)}
              >
                {tCommon('actions.retry')}
              </Button>
            )}
          </div>
        </GlassCard>
      )}

      {/* Question list */}
      {listError?.reset ? null : questions.length === 0 ? (
        <EmptyState
          icon={<HelpCircle className="w-12 h-12" aria-hidden="true" />}
          title={t('qa.empty_title')}
          description={
            search
              ? t('qa.no_results')
              : t('qa.empty_description')
          }
        />
      ) : (
        <div className="space-y-2">
          {questions.map((question) => (
            <GlassCard key={question.id} className="p-0 overflow-hidden">
              {/* Question row */}
              <div className="flex items-start gap-3 w-full p-3">
                {/* Vote controls remain siblings of the question-toggle button. */}
                <div className="flex-shrink-0">
                  <VoteControls
                    type="question"
                    targetId={question.id}
                    voteCount={question.vote_count}
                    userVote={question.user_vote}
                    votingIds={votingIds}
                    handleVote={handleVote}
                    isMember={isMember}
                    t={t}
                  />
                </div>

                <Button
                  variant="light"
                  className="flex-1 min-w-0 min-h-[44px] text-start p-0 hover:bg-surface-secondary/50 transition-colors justify-start rounded-none"
                  onPress={() => toggleExpand(question.id)}
                  aria-expanded={expandedId === question.id}
                  aria-controls={`group-question-${question.id}-detail`}
                  aria-label={t('qa.expand_aria', {
                    title: question.title,
                  })}
                >
                  <div className="flex items-start gap-3 w-full">
                    {/* Question content */}
                    <div className="flex-1 min-w-0">
                      <p id={`group-question-${question.id}-title`} className="text-sm font-medium text-theme-primary line-clamp-2">
                        {question.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-theme-subtle">
                        <span>{question.author.name}</span>
                        <span aria-hidden="true">&#183;</span>
                        <span>{formatRelativeTime(question.created_at)}</span>
                      </div>
                    </div>

                    {/* Stats badges */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {question.has_accepted_answer && (
                        <Chip
                          size="sm"
                          color="success"
                          variant="flat"
                          startContent={<CheckCircle className="w-3 h-3" aria-hidden="true" />}
                          aria-label={t('qa.accepted_badge')}
                        >
                          {t('qa.accepted')}
                        </Chip>
                      )}
                      <Chip
                        size="sm"
                        variant="flat"
                        startContent={<MessageSquare className="w-3 h-3" aria-hidden="true" />}
                        aria-label={t('qa.answer_count_aria', {
                          count: question.answer_count,
                        })}
                      >
                        {question.answer_count}
                      </Chip>
                    </div>
                  </div>
                </Button>
              </div>

              {/* Expanded detail */}
              {expandedId === question.id && (
                <div
                  id={`group-question-${question.id}-detail`}
                  role="region"
                  aria-labelledby={`group-question-${question.id}-title`}
                  className="border-t border-border p-4 space-y-4"
                >
                  {loadingDetail ? (
                    <div className="flex justify-center py-6" role="status" aria-busy="true" aria-label={t('qa.loading_detail')}>
                      <Spinner size="sm" />
                    </div>
                  ) : detailError ? (
                    <div className="flex flex-col items-start gap-3 py-4" role="alert">
                      <p className="text-sm text-danger">{t('qa.load_error')}</p>
                      {detailError.retryable && (
                        <Button
                          variant="flat"
                          size="sm"
                          onPress={() => void loadQuestionDetail(question.id)}
                        >
                          {tCommon('actions.retry')}
                        </Button>
                      )}
                    </div>
                  ) : expandedDetail ? (
                    <>
                      {/* Question body */}
                      <SafeHtml content={expandedDetail.body} className="text-sm text-theme-secondary whitespace-pre-wrap" as="div" />

                      {/* Answers */}
                      {expandedDetail.answers.length > 0 && (
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-theme-primary">
                            {t('qa.answers_heading', {
                              count: expandedDetail.answers.length,
                            })}
                          </h4>

                          {expandedDetail.answers.map((answer) => (
                            <div
                              key={answer.id}
                              className={`flex items-start gap-3 p-3 rounded-lg ${
                                answer.is_accepted
                                  ? 'bg-success/10 border border-success/30'
                                  : 'bg-surface-secondary/50'
                              }`}
                            >
                              {/* Answer vote controls */}
                              <VoteControls
                                type="answer"
                                targetId={answer.id}
                                voteCount={answer.vote_count}
                                userVote={answer.user_vote}
                                votingIds={votingIds}
                                handleVote={handleVote}
                                isMember={isMember}
                                t={t}
                              />

                              {/* Answer content */}
                              <div className="flex-1 min-w-0">
                                <SafeHtml content={answer.body} className="text-sm text-theme-secondary whitespace-pre-wrap" as="div" />
                                <div className="flex items-center gap-2 mt-2 text-xs text-theme-subtle">
                                  <span>{answer.author.name}</span>
                                  <span aria-hidden="true">&#183;</span>
                                  <span>{formatRelativeTime(answer.created_at)}</span>
                                  {answer.is_accepted && (
                                    <>
                                      <span aria-hidden="true">&#183;</span>
                                      <span className="text-success font-medium flex items-center gap-1">
                                        <CheckCircle className="w-3 h-3" aria-hidden="true" />
                                        {t('qa.accepted_answer')}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Accept button — visible to question author or admin */}
                              {!answer.is_accepted &&
                                (isAdmin ||
                                  expandedDetail.author.id ===
                                    Number(localStorage.getItem('userId'))) && (
                                  <Button
                                    isIconOnly
                                    variant="light"
                                    size="sm"
                                    color="success"
                                    onPress={() => handleAccept(answer.id)}
                                    aria-label={t('qa.accept_aria')}
                                    className="min-h-11 min-w-11 flex-shrink-0"
                                  >
                                    <Check className="w-4 h-4" aria-hidden="true" />
                                  </Button>
                                )}
                            </div>
                          ))}
                        </div>
                      )}
                      {expandedDetail.answers.length === 0 && (
                        <p className="rounded-lg bg-surface-secondary/50 px-3 py-4 text-sm text-theme-muted" role="status">
                          {t('qa.no_answers')}
                        </p>
                      )}

                      {/* Answer form */}
                      {isMember && (
                        <div className="space-y-2 pt-2 border-t border-border">
                          <Textarea
                            placeholder={t('qa.answer_placeholder')}
                            value={answerBody}
                            onValueChange={setAnswerBody}
                            minRows={3}
                            size="sm"
                            aria-label={t('qa.answer_input_aria')}
                          />
                          <div className="flex justify-end">
                            <Button
                              color="primary"
                              size="sm"
                              onPress={handleAnswer}
                              isLoading={submittingAnswer}
                              isDisabled={!answerBody.trim()}
                            >
                              {t('qa.post_answer')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !listError && (
        <div className="flex justify-center pt-4">
          <Button variant="flat" size="sm" onPress={() => loadQuestions(false)} isLoading={loading}>
            {t('qa.load_more')}
          </Button>
        </div>
      )}

      {/* Ask Question modal */}
      <Modal isOpen={askModal.isOpen} onClose={askModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader>{t('qa.ask_title')}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label={t('qa.question_title_label')}
                placeholder={t('qa.question_title_placeholder')}
                value={askTitle}
                onValueChange={setAskTitle}
                size="sm"
                isRequired
                aria-label={t('qa.question_title_aria')}
              />
              <Textarea
                label={t('qa.question_body_label')}
                placeholder={t('qa.question_body_placeholder')}
                value={askBody}
                onValueChange={setAskBody}
                minRows={4}
                size="sm"
                isRequired
                aria-label={t('qa.question_body_aria')}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={askModal.onClose}>
              {t('qa.cancel')}
            </Button>
            <Button
              color="primary"
              onPress={handleAsk}
              isLoading={asking}
              isDisabled={!askTitle.trim() || !askBody.trim()}
            >
              {t('qa.submit_question')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GroupQATab;
