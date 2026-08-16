<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    // Shared across course templates
    'back_to_teaching' => 'Back to courses you teach',
    'back_to_course' => 'Back to course',
    'level_meta' => 'Level: :level',
    'completed_tag' => 'Completed',
    'notice_title' => 'Notice',

    // Browse (index)
    'search_hint' => 'Search by title.',
    'category_label' => 'Category',
    'category_all' => 'All categories',
    'level_filter_label' => 'Level',
    'search_button' => 'Search',

    // My learning
    'my_learning_caption' => 'Your courses at :community',
    'my_learning_title' => 'My learning',
    'my_learning_intro' => 'Pick up where you left off with the courses you are enrolled in.',
    'my_learning_empty' => 'You are not enrolled in any courses yet. Browse the course library to get started.',
    'browse_courses' => 'Browse courses',
    'percent_complete' => ':percent% complete',
    'resume' => 'Resume',
    'start_learning' => 'Start learning',

    // Course detail
    'review_count' => '{1} Based on :count review|[2,*] Based on :count reviews',
    'rated_out_of_5' => 'Rated :rating out of 5',
    'rating_option' => ':rating out of 5',
    'what_you_will_learn' => 'What you will learn',
    'join_course' => 'Join this course',
    'credit_cost' => '{1} This course costs :count time credit|[2,*] This course costs :count time credits',

    // Instructor dashboard
    'teaching_caption' => 'Teaching at :community',
    'teaching_title' => 'Courses you teach',
    'teaching_intro' => 'Create and manage the courses you teach, track enrolments and publish when you are ready.',
    'create_course' => 'Create a course',
    'not_approved_author' => 'Course creation is limited to approved instructors at this community.',
    'no_courses_created' => 'You have not created any courses yet. Create your first course to start teaching.',
    'enrolments_count' => 'Enrolments: :count',
    'completions_count' => 'Completions: :count',
    'edit_course' => 'Edit course',
    'view_analytics' => 'View analytics',

    // Analytics
    'analytics_caption' => 'Course analytics',
    'analytics_intro' => 'See how learners are progressing through your course.',
    'analytics_no_data' => 'There is no enrolment data for this course yet.',
    'completions_by_lesson' => 'Completions by lesson',
    'completions_intro' => 'How many learners have completed each lesson, in order. A drop is where learners tend to stop.',
    'analytics_no_lessons' => 'This course has no lessons yet, so there is nothing to chart.',
    'lesson_completed_count' => ':count completed',

    // Learn
    'learning_caption' => 'Learning at :community',
    'course_completed_panel' => 'You have completed this course. Well done.',
    'no_lessons_available' => 'This course has no lessons available yet.',
    'not_yet_available' => 'Not yet available',
    'select_lesson' => 'Select a lesson from the list to begin.',
    'video_unsupported' => 'Your browser cannot play this video. Open it in a new tab below.',
    'open_video' => 'Open the video',
    'download_material' => 'Download the lesson material',
    'quiz_unavailable' => 'This quiz is not available yet.',
    'quiz_fallback_title' => 'Quiz',
    'quiz_pass_mark' => 'Pass mark: :percent%',
    'quiz_attempts_remaining' => 'Attempts remaining: :count',
    'quiz_awaiting_marking' => 'Your last attempt is awaiting marking by an instructor.',
    'quiz_last_score' => 'Your last score: :percent%',
    'quiz_passed' => 'Passed',
    'quiz_not_passed' => 'Not passed',
    'quiz_no_attempts_left' => 'You have used all your attempts for this quiz.',
    'quiz_no_questions' => 'This quiz has no questions yet.',
    'quiz_submit' => 'Submit answers',
    'lesson_completed' => 'You have completed this lesson.',
    'mark_complete' => 'Mark lesson as complete',

    // Grading
    'grading_caption' => 'Review quiz attempts at :community',
    'grading_title' => 'Grading queue',
    'grading_course_label' => 'Course:',
    'grading_intro' => 'Quiz attempts that need a manual grade. Review the learner answers, then award a score.',
    'grading_empty' => 'There are no attempts waiting to be graded for this course.',
    'grading_submitted' => 'Submitted: :date',
    'learner_answers' => 'Learner answers',
    'no_answers' => 'The learner did not provide any answers.',
    'score_label' => 'Score (%)',
    'score_hint' => 'A percentage from 0 to 100.',
    'outcome_legend' => 'Outcome',
    'pass_label' => 'Pass',
    'fail_label' => 'Fail',
    'feedback_label' => 'Feedback for the learner',
    'optional_parenthetical' => '(optional)',
    'feedback_hint' => 'Optional. The learner will see this with their result.',
    'save_grade' => 'Save grade',

    // Analytics stat labels
    'analytics' => [
        'total' => 'Total enrolments',
        'active' => 'Active',
        'completed' => 'Completed',
        'dropped' => 'Dropped out',
        'completion_rate' => 'Completion rate',
        'avg_progress' => 'Average progress',
        'avg_quiz_score' => 'Average quiz score',
        'quiz_attempts' => 'Quiz attempts',
    ],

    // Route-level status messages (courses.js routeStatus)
    'status' => [
        // Course detail
        'enrolled' => 'You are now enrolled. Enjoy the course.',
        'enrol_required' => 'Enrol on this course before opening the learning area.',
        'review_saved' => 'Thank you - your review has been saved.',
        'insufficient_credits' => 'You do not have enough time credits to enrol on this course.',
        'enrol_failed' => 'We could not enrol you on this course. Please try again.',
        'certificate_locked' => 'You can download your certificate once you have completed the course.',
        'certificate_failed' => 'We could not produce your certificate. Please try again.',
        'review_invalid' => 'Please choose a rating between 1 and 5 stars.',
        'review_not_enrolled' => 'Only enrolled learners can review this course.',
        'review_failed' => 'We could not save your review. Please try again.',

        // Learn
        'lesson_completed' => 'Lesson marked as complete.',
        'course_completed' => 'You have finished the course. Well done.',
        'quiz_passed' => 'Well done - you passed the quiz.',
        'quiz_pending_review' => 'Your answers were submitted and are awaiting instructor marking.',
        'quiz_failed' => 'You did not reach the pass mark this time. Review the lesson and try again if you have attempts left.',
        'quiz_no_attempts' => 'You have no attempts remaining for this quiz.',
        'quiz_error' => 'Sorry, we could not record your quiz attempt. Please try again.',

        // Instructor dashboard
        'deleted' => 'Your course was deleted.',
        'delete_failed' => 'Sorry, your course could not be deleted. Please try again.',

        // Instructor course form
        'created' => 'Your course was created. Add the details and publish when you are ready.',
        'create_failed' => 'Enter a course title before creating the course.',
        'saved' => 'Your changes were saved.',
        'save_failed' => 'Sorry, your changes could not be saved. Please try again.',
        'published' => 'Your course is published and visible to learners.',
        'pending_review' => 'Your course was submitted and is awaiting review before it goes live.',
        'publish_failed' => 'Sorry, your course could not be published. Please try again.',
        'unpublished' => 'Your course was unpublished and is now a draft.',
        'unpublish_failed' => 'Sorry, your course could not be unpublished. Please try again.',
        'section_added' => 'Your section was added.',
        'section_saved' => 'Your section was renamed.',
        'section_deleted' => 'Your section was deleted. Its lessons were kept and moved out of any section.',
        'section_failed' => 'Sorry, that section action could not be completed. Please try again.',
        'section_title_missing' => 'Enter a title for the section.',
        'lesson_added' => 'Your lesson was added.',
        'lesson_saved' => 'Your lesson was saved.',
        'lesson_deleted' => 'Your lesson was deleted.',
        'lesson_failed' => 'Sorry, that lesson action could not be completed. Please try again.',
        'lesson_title_missing' => 'Enter a title for the lesson.',

        // Grading
        'graded' => 'The attempt has been graded.',
        'grade_failed' => 'The attempt could not be graded. Please try again.',
    ],
];
