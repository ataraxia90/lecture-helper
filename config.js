(() => {
  const CONFIG = {
    TARGET_HOSTS: ["moip.nhi.go.kr"],
    URL_MATCH: [/^https:\/\/moip\.nhi\.go\.kr\/.*$/i],

    ROW_SELECTORS: [
      ".study_group .list_area .list_clear:has(.progress)",
      ".study_group .list_area .list.clear:has(.progress)",
      ".study_group .list_area .list_clear",
      ".study_group .list_area .list.clear",
      ".list_area .list_clear",
      ".list_area .list.clear",
      ".list_clear",
      ".list.clear",
      "[data-lecture-row]",
      ".lecture-row",
      ".lesson-row",
      ".chapter-row",
      "tr"
    ],
    TITLE_SELECTORS: [
      "a[onclick*='checkTrRng']",
      "button[onclick*='checkTrRng']",
      ".subject a",
      ".subject button",
      ".subject",
      "a[onclick*='checkRtprgs']",
      "button[onclick*='checkRtprgs']",
      "[data-lecture-title]",
      ".lecture-title",
      ".lesson-title",
      ".title"
    ],
    COMPLETED_TIME_SELECTORS: [
      ".progress .current",
      ".time",
      ".subject ~ .time",
      "[data-completed-time]",
      ".completed-time",
      ".study-time",
      ".learned-time",
      ".progress-time"
    ],
    TOTAL_TIME_SELECTORS: [
      ".progress .total",
      ".subject [role='tooltip']",
      ".subject .tooltip",
      ".subject .total-time",
      ".subject .lecture-time",
      ".subject .lesson-time",
      ".subject .duration",
      "[data-total-time]",
      ".total-time",
      ".lecture-time",
      ".lesson-time",
      ".duration",
      "[role='tooltip']",
      ".tooltip"
    ],
    COURSE_ROW_SELECTORS: [
      "tr.studyRow",
      "tbody tr.studyRow",
      ".tbl-type01 tr.studyRow",
      "[data-course-row]",
      ".course-row",
      ".lecture-row",
      ".class-row",
      ".my_course .list_clear",
      ".course_list .list_clear",
      ".list_area .list_clear",
      ".my_course li",
      ".course_list li",
      ".list_area li",
      "tr"
    ],
    COURSE_TITLE_SELECTORS: [
      "[data-course-title]",
      ".course-title",
      ".lecture-title",
      ".subject a",
      ".subject",
      ".title a",
      ".title"
    ],
    COURSE_DETAIL_SELECTORS: [
      "td.subject a[onclick*='onViewPage']",
      "a[onclick*='onViewPage']",
      "a[onclick*='elrn']",
      "a[onclick*='Elrn']",
      "a[onclick*='learn']",
      "a[onclick*='Learn']",
      "a[onclick*='elrnMain']",
      "a[onclick*='study']",
      "a[onclick*='detail']",
      "a[href*='elrn']",
      "a[href*='learn']",
      "a[href*='elrnMain']",
      "a[href*='study']",
      "a[href*='detail']",
      ".subject a",
      ".title a"
    ],
    COURSE_STATUS_SELECTORS: [
      "[data-course-status]",
      ".status",
      ".state",
      ".progress",
      ".rate",
      ".percent",
      ".info"
    ],
    COURSE_INCOMPLETE_KEYWORDS: [
      "\uBBF8\uC774\uC218",
      "\uBBF8\uC218\uB8CC",
      "\uD559\uC2B5\uC911",
      "\uC218\uAC15\uC911",
      "\uC9C4\uD589\uC911",
      "\uB300\uAE30",
      "0%",
      "33%",
      "66%"
    ],
    COURSE_COMPLETE_KEYWORDS: [
      "\uC774\uC218\uC644\uB8CC",
      "\uC218\uB8CC",
      "\uC218\uAC15\uC644\uB8CC",
      "\uD559\uC2B5\uC644\uB8CC",
      "\uC644\uB8CC",
      "100%"
    ],
    COURSE_EXCLUDE_KEYWORDS: [
      "\uCD94\uCC9C\uACFC\uC815",
      "\uCD94\uCC9C\uC790\uB8CC",
      "\uC218\uAC15\uC2E0\uCCAD",
      "\uC2E0\uCCAD",
      "\uAD00\uC2EC",
      "\uCC1C",
      "\uC88B\uC544\uC694"
    ],
    COMPLETED_KEYWORDS: [
      "\uC644\uB8CC",
      "\uC774\uC218\uC644\uB8CC",
      "\uC218\uAC15\uC644\uB8CC",
      "\uD559\uC2B5\uC644\uB8CC",
      "100%"
    ],
    TIME_REGEXES: [
      /\b\d{1,2}:\d{2}:\d{2}\b/g,
      /\b\d{1,3}:\d{2}\b/g,
      /\d+\s*\uC2DC\uAC04\s*\d+\s*\uBD84\s*\d+\s*\uCD08/g,
      /\d+\s*\uC2DC\uAC04\s*\d+\s*\uBD84/g,
      /\d+\s*\uBD84\s*\d+\s*\uCD08/g,
      /\d+\s*\uBD84/g,
      /\d+\s*\uCD08/g
    ],
    HOVER_RETRY_COUNT: 2,
    HOVER_WAIT_MS: 700,
    SAFETY_BUFFER_MS: 3000,
    VERIFY_WAIT_MS: 2500,
    STATUS_POLL_INTERVAL: 1000,
    POPUP_DETECT_TIMEOUT_MS: 10000,
    AUTO_SHOW_CONTROL_PANEL: true,
    AUTO_RESUME_RUNNING: true
  };

  globalThis.LectureHelperConfig = CONFIG;
})();
