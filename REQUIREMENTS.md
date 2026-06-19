# Lecture Helper Requirements

## Goal

Lecture Helper automates the user's unfinished e-learning courses after the user signs in manually. The extension should process every incomplete course and every incomplete lesson until all eligible items are complete.

## User Flow

1. Open the login page.
2. The user signs in manually.
3. After login, open the main page.
4. From the main page, navigate to the user's course list.
5. Load the list of enrolled courses.
6. Find incomplete courses from the course list.
7. Open the detail/status page for the next incomplete course.
8. On the detail/status page, find incomplete lesson rows.
9. For the next incomplete lesson:
   - Read the lesson title.
   - Read the completed lesson time.
   - Read the total lesson time.
   - Open the lesson playback popup.
   - Wait for the remaining required time.
10. When the lesson playback time is complete:
    - Close the playback popup.
    - Return to the course detail/status page.
    - Re-check the lesson list.
11. Repeat step 9 until every lesson in the current course is complete.
12. When the current course is complete, click the top-right close/X control to return to the course list.
13. Return to step 5 and continue with the next incomplete course.
14. Stop when every course in the course list is complete.

## Expected Behavior

- The extension must not start before the user has signed in.
- Course list detection must ignore recommendation, enrollment, favorite, and unrelated content areas.
- Course detail pages must prefer lesson-level progress over course-level progress.
- The progress panel must show both course-level and lesson-level context:
  - Course name with progress index, such as `강의명 (1/14)`.
  - Lesson title with progress index, such as `차시명 (3/4)`.
- Lesson timing values must be lesson-level values:
  - Title: lesson title, not course title.
  - Completed: lesson completed time.
  - Total: lesson total time.
- Playback popups must be tracked and closed after the remaining time has elapsed.
- After closing a lesson popup, the extension must verify progress before moving to the next lesson.
- Stop must interrupt the current wait loop and close any tracked playback popup when possible.

## Current Verified Example

On the course detail page for `[mobile겸용] 긴급복지지원 신고의무 교육`, the expected active lesson values are:

- Lesson title: `전문가와의 만남 및 신고 이후 대상자 지원절차`
- Completed time: `00:11:33` or later, depending on live progress
- Total time: `00:15:20`
