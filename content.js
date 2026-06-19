(() => {
  if (globalThis.__lectureHelperContentLoaded) return;
  globalThis.__lectureHelperContentLoaded = true;

  const CONFIG = globalThis.LectureHelperConfig;
  const Utils = globalThis.LectureHelperUtils;

  let stopRequested = false;
  let automationRunning = false;
  let floatingPanelMounted = false;
  const processedLessonKeys = new Set();
  const processedLessonIndexes = new Set();

  function isExtensionContextError(error) {
    return /extension context invalidated|context invalidated|receiving end does not exist/i.test(String(error && (error.message || error)));
  }

  function sendRuntimeMessage(message) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        return Promise.resolve({ ok: false, contextInvalidated: true });
      }
      return chrome.runtime.sendMessage(message).catch((error) => {
        if (isExtensionContextError(error)) {
          stopRequested = true;
          automationRunning = false;
          return { ok: false, contextInvalidated: true };
        }
        throw error;
      });
    } catch (error) {
      if (isExtensionContextError(error)) {
        stopRequested = true;
        automationRunning = false;
        return Promise.resolve({ ok: false, contextInvalidated: true });
      }
      return Promise.reject(error);
    }
  }

  async function sendStatusUpdate(patch) {
    const response = await sendRuntimeMessage({ type: "STATUS_UPDATE", patch });
    return !(response && response.contextInvalidated);
  }

  function formatPanelDuration(seconds) {
    return Utils.formatDuration(seconds || 0);
  }

  function decodeRepeated(value) {
    let decoded = String(value || "").replace(/\+/g, " ");
    for (let index = 0; index < 3; index += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch (_error) {
        break;
      }
    }
    return decoded;
  }

  function cleanCourseTitle(title) {
    return String(title || "")
      .replace(/\[(?:mobile|Mobile)\s*겸용\]\s*/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }

  function getCourseTitleFromUrl(urlText = location.href) {
    const raw = String(urlText || "").match(/[?&]sbjectNm=([^&#]+)/)?.[1];
    if (!raw) return "";
    return cleanCourseTitle(decodeRepeated(raw));
  }

  function getVisibleCourseTitleFallback() {
    return (
      getCourseTitleFromUrl()
      || document.querySelector("body > h1, .top h1, .header h1, .navi-title")?.innerText
      || document.querySelector(".sec1 h1.tit, h1.tit")?.innerText
      || document.title.split(":").pop()
      || ""
    ).trim().slice(0, 160);
  }

  function renderFloatingPanel(root, state) {
    const safe = state || {};
    const urlCourseTitle = getCourseTitleFromUrl();
    const courseTitle = urlCourseTitle || (safe.courseTitle && safe.courseTitle !== "-" ? safe.courseTitle : getVisibleCourseTitleFallback());
    root.querySelector("[data-lh-status]").textContent = safe.status || "idle";
    root.querySelector("[data-lh-course]").textContent = Utils.formatIndexedLabel(courseTitle, safe.courseIndex, safe.courseTotal);
    root.querySelector("[data-lh-title]").textContent = Utils.formatIndexedLabel(safe.currentTitle, safe.lessonIndex, safe.lessonTotal);
    root.querySelector("[data-lh-completed]").textContent = formatPanelDuration(safe.completedTime);
    root.querySelector("[data-lh-total]").textContent = formatPanelDuration(safe.totalTime);
    root.querySelector("[data-lh-remaining]").textContent = formatPanelDuration(safe.remainingTime);
    root.querySelector("[data-lh-error]").textContent = safe.lastError || "-";
    root.querySelector("[data-lh-start]").disabled = Boolean(safe.running);
    root.querySelector("[data-lh-stop]").disabled = !safe.running;
  }

  async function mountFloatingPanel() {
    if (!CONFIG.AUTO_SHOW_CONTROL_PANEL || floatingPanelMounted || window.top !== window) return;
    if (!document.body) return;
    floatingPanelMounted = true;

    const style = document.createElement("style");
    style.textContent = `
      #lecture-helper-panel {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: 320px;
        padding: 14px;
        border: 1px solid #d8dee5;
        border-radius: 8px;
        background: #ffffff;
        color: #1d2329;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
        font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #lecture-helper-panel * { box-sizing: border-box; }
      #lecture-helper-panel .lh-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      #lecture-helper-panel .lh-title {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
      }
      #lecture-helper-panel .lh-status {
        min-width: 78px;
        padding: 4px 7px;
        border-radius: 6px;
        background: #dff4ea;
        color: #0f3c2e;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
      }
      #lecture-helper-panel .lh-controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 10px;
      }
      #lecture-helper-panel button {
        height: 34px;
        border: 1px solid #c7ced6;
        border-radius: 6px;
        background: #ffffff;
        color: #18212b;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      #lecture-helper-panel button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      #lecture-helper-panel .lh-label {
        display: block;
        margin-bottom: 3px;
        color: #64707d;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }
      #lecture-helper-panel .lh-current {
        margin-bottom: 9px;
        overflow-wrap: anywhere;
      }
      #lecture-helper-panel .lh-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 7px;
        margin-bottom: 9px;
      }
      #lecture-helper-panel .lh-card {
        min-width: 0;
        padding: 8px;
        border: 1px solid #d8dee5;
        border-radius: 6px;
      }
      #lecture-helper-panel .lh-card strong {
        display: block;
        margin-top: 2px;
        font-size: 15px;
      }
      #lecture-helper-panel .lh-error {
        color: #b42318;
        overflow-wrap: anywhere;
      }
    `;

    const panel = document.createElement("aside");
    panel.id = "lecture-helper-panel";
    panel.innerHTML = `
      <div class="lh-head">
        <h2 class="lh-title">Lecture Helper</h2>
        <span class="lh-status" data-lh-status>idle</span>
      </div>
      <div class="lh-controls">
        <button type="button" data-lh-start>Start</button>
        <button type="button" data-lh-stop>Stop</button>
      </div>
      <div class="lh-current">
        <span class="lh-label">강의명</span>
        <span data-lh-course>-</span>
      </div>
      <div class="lh-current">
        <span class="lh-label">차시명</span>
        <span data-lh-title>-</span>
      </div>
      <div class="lh-grid">
        <div class="lh-card"><span class="lh-label">completed</span><strong data-lh-completed>0:00</strong></div>
        <div class="lh-card"><span class="lh-label">total</span><strong data-lh-total>0:00</strong></div>
        <div class="lh-card"><span class="lh-label">remaining</span><strong data-lh-remaining>0:00</strong></div>
      </div>
      <div>
        <span class="lh-label">마지막 오류</span>
        <span class="lh-error" data-lh-error>-</span>
      </div>
    `;

    document.documentElement.appendChild(style);
    document.body.appendChild(panel);

    panel.querySelector("[data-lh-start]").addEventListener("click", () => {
      sendRuntimeMessage({ type: "START" }).catch((error) => {
        if (!isExtensionContextError(error)) throw error;
      });
    });
    panel.querySelector("[data-lh-stop]").addEventListener("click", () => {
      sendRuntimeMessage({ type: "STOP" }).catch((error) => {
        if (!isExtensionContextError(error)) throw error;
      });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.lectureHelperState) {
        renderFloatingPanel(panel, changes.lectureHelperState.newValue);
      }
    });

    const response = await sendRuntimeMessage({ type: "GET_STATE" });
    if (response && response.ok) renderFloatingPanel(panel, response.state);
  }

  function queryFirst(root, selectors) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function queryAll(root, selectors) {
    const found = [];
    for (const selector of selectors) {
      try {
        found.push(...root.querySelectorAll(selector));
      } catch (_error) {
        // Ignore selectors unsupported by the current browser engine.
      }
    }
    return [...new Set(found)];
  }

  function getSearchDocuments() {
    const docs = [document];
    for (const frame of document.querySelectorAll("iframe, frame")) {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch (_error) {
        // Cross-origin frames are handled by all_frames injection when the URL matches.
      }
    }
    return [...new Set(docs)];
  }

  function visibleText(element) {
    if (!element) return "";
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return "";
    }
    return element.innerText || element.textContent || "";
  }

  function cssContentText(element, pseudo) {
    const content = getComputedStyle(element, pseudo).content;
    if (!content || content === "none" || content === "normal") return "";
    return content.replace(/^["']|["']$/g, "");
  }

  function searchableText(element) {
    if (!element) return "";
    const parts = [
      visibleText(element),
      element.textContent || "",
      element.innerText || "",
      cssContentText(element, "::before"),
      cssContentText(element, "::after")
    ];
    const attrNames = ["title", "aria-label", "alt", "value", "data-title", "data-time", "data-original-title"];
    const nodes = [element, ...element.querySelectorAll("*")];

    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      for (const attr of attrNames) {
        const value = node.getAttribute(attr);
        if (value) parts.push(value);
      }
      parts.push(cssContentText(node, "::before"), cssContentText(node, "::after"));
    }

    return parts.filter(Boolean).join(" ");
  }

  function durationSecondsIn(element) {
    return Utils.extractDurationCandidates(searchableText(element)).map((item) => item.seconds);
  }

  function durationSecondsInHtml(element) {
    if (!element) return [];
    return Utils.extractDurationCandidates(element.outerHTML || element.innerHTML || "").map((item) => item.seconds);
  }

  function rowHasCompletedKeyword(row) {
    const text = visibleText(row);
    return CONFIG.COMPLETED_KEYWORDS.some((keyword) => text.includes(keyword));
  }

  function isIgnoredTitleText(text) {
    const normalized = String(text || "").replace(/\s+/g, "");
    return [
      "\uB2EB\uAE30",
      "\uC9C4\uB3C4\uC0C1\uC138",
      "\uC0C1\uC138\uBCF4\uAE30",
      "\uD559\uC2B5\uC2DC\uC791",
      "\uC218\uB8CC\uAE30\uC900",
      "\uD559\uC2B5\uD558\uAE30"
    ].includes(normalized);
  }

  function isLectureRow(row) {
    const title = getTitleElement(row);
    const titleText = title ? visibleText(title).trim() : "";
    if (!title) return false;
    if (title && isIgnoredTitleText(titleText)) return false;
    if (!row.querySelector(".progress, .current, .total")) return false;
    return true;
  }

  function findRowFromTimeElement(element) {
    let node = element;
    let fallback = null;
    for (let depth = 0; node && depth < 12; depth += 1) {
      if (node instanceof Element) {
        const hasTime = node.querySelector(".progress, .current, .total");
        const text = searchableText(node);
        const timeCount = Utils.extractDurationCandidates(text).length;
        if (hasTime && timeCount > 0) {
          const titleLike = node.querySelector("a[onclick*='checkTrRng'], button[onclick*='checkTrRng'], a[onclick*='checkRtprgs'], button[onclick*='checkRtprgs'], .subject a");
          if (titleLike) return node;
          if (!fallback && (timeCount >= 2 || node.querySelector(".progress"))) fallback = node;
        }
      }
      node = node.parentElement;
    }
    return fallback || element.closest(".list_clear, .list.clear, li, tr, div");
  }

  function findRows() {
    const titleRows = [];
    for (const doc of getSearchDocuments()) {
      for (const title of doc.querySelectorAll(".study_group .list_area .subject a, a[onclick*='checkRtprgs']")) {
        if (isIgnoredTitleText(visibleText(title))) continue;
        const row = title.closest(".list_clear, .list.clear");
        if (row && isLectureRow(row)) titleRows.push(row);
      }
    }
    if (titleRows.length > 0) return [...new Set(titleRows)];

    const timeRows = [];
    for (const doc of getSearchDocuments()) {
      for (const timeElement of doc.querySelectorAll(".progress, .current, .total, [class*='current'], [class*='total']")) {
        const row = findRowFromTimeElement(timeElement);
        if (row && isLectureRow(row)) timeRows.push(row);
      }
    }
    if (timeRows.length > 0) return [...new Set(timeRows)];

    const rows = [];
    for (const doc of getSearchDocuments()) {
      rows.push(...queryAll(doc, CONFIG.ROW_SELECTORS));
    }

    const selectorRows = [...new Set(rows)].filter(isLectureRow);
    if (selectorRows.length > 0) return selectorRows;

    const fallbackRows = [];
    for (const doc of getSearchDocuments()) {
      for (const title of queryAll(doc, CONFIG.TITLE_SELECTORS)) {
        if (isIgnoredTitleText(visibleText(title))) continue;
        const row = title.closest(".list_clear, li, tr, .row, .item, div");
        if (row && isLectureRow(row)) fallbackRows.push(row);
      }
    }
    return [...new Set(fallbackRows)];
  }

  function getTitleElement(row) {
    const inside = queryFirst(row, CONFIG.TITLE_SELECTORS);
    if (inside) return inside;

    const doc = row.ownerDocument || document;
    const rowRect = row.getBoundingClientRect();
    const candidates = queryAll(doc, ["a[onclick*='checkTrRng']", "button[onclick*='checkTrRng']"])
      .filter((element) => !isIgnoredTitleText(visibleText(element)))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element,
          distance: Math.abs(rect.top - rowRect.top) + Math.abs(rect.left - rowRect.left)
        };
      })
      .sort((a, b) => a.distance - b.distance);

    return candidates[0]?.element || null;
  }

  function getClickableLessonElement(row) {
    const checked = row.querySelector("a[onclick*='checkTrRng'], button[onclick*='checkTrRng'], a[onclick*='checkRtprgs'], button[onclick*='checkRtprgs']");
    if (checked) return checked;

    const titleClickable = row.querySelector(".subject a, .subject button, .title a, .title button");
    if (titleClickable) return titleClickable;

    const title = getTitleElement(row);
    if (title && /^(A|BUTTON)$/i.test(title.tagName)) return title;
    return null;
  }

  function getTitleText(row) {
    const title = getTitleElement(row);
    return (title ? visibleText(title) : visibleText(row)).trim().slice(0, 160);
  }

  function getLessonKey(row, index = 0) {
    const title = getTitleText(row);
    const total = chooseTotalCandidate(row, [], extractCompletedTime(row));
    return `${index}:${title}:${total == null ? "unknown" : total}`;
  }

  function isCourseComplete(row) {
    const text = searchableText(row);
    return CONFIG.COURSE_COMPLETE_KEYWORDS.some((keyword) => text.includes(keyword));
  }

  function isExcludedCourseArea(row) {
    const text = searchableText(row);
    if (CONFIG.COURSE_EXCLUDE_KEYWORDS.some((keyword) => text.includes(keyword))) return true;

    let node = row;
    for (let depth = 0; node && depth < 6; depth += 1) {
      const areaName = [
        node.id || "",
        node.className || "",
        node.getAttribute?.("aria-label") || "",
        node.getAttribute?.("data-area") || "",
        node.getAttribute?.("data-section") || ""
      ].join(" ");
      if (/recommend|suggest|favorite|wish|interest|cart|apply|enrol|enroll/i.test(areaName)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function extractCoursePercent(row) {
    const text = searchableText(row);
    const matches = [...text.matchAll(/(\d{1,3})(?:\.\d+)?\s*%/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value));
    if (matches.length === 0) return null;
    return Math.max(...matches);
  }

  function isCourseIncomplete(row) {
    const text = searchableText(row);
    if (isExcludedCourseArea(row) || isCourseComplete(row)) return false;
    if (row.matches && row.matches("tr.studyRow") && row.querySelector("a[onclick*='onViewPage']")) {
      const percent = extractCoursePercent(row);
      return percent == null || percent < 100;
    }
    if (CONFIG.COURSE_INCOMPLETE_KEYWORDS.some((keyword) => text.includes(keyword))) return true;
    const percent = extractCoursePercent(row);
    return percent != null && percent < 100;
  }

  function getCourseTitleElement(row) {
    return queryFirst(row, CONFIG.COURSE_TITLE_SELECTORS);
  }

  function getCourseTitleText(row) {
    const title = getCourseTitleElement(row);
    return (title ? visibleText(title) : visibleText(row)).trim().slice(0, 160);
  }

  function getCourseKey(row) {
    const openElement = getCourseOpenElement(row);
    const onclick = openElement?.getAttribute("onclick") || openElement?.closest("[onclick]")?.getAttribute("onclick") || "";
    const view = onclick.match(/onViewPage\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/);
    if (view) return `${view[1]}:${view[2]}`;
    const href = openElement?.getAttribute("href") || "";
    return `${getCourseTitleText(row)}:${onclick || href || searchableText(row).slice(0, 80)}`;
  }

  async function ensureCourseQueue(courseRows) {
    const response = await sendRuntimeMessage({ type: "GET_STATE" });
    const storedQueue = response && response.ok && Array.isArray(response.state?.courseQueue)
      ? response.state.courseQueue
      : [];
    if (storedQueue.length > 0) return storedQueue;

    const queue = courseRows.map((row) => ({
      key: getCourseKey(row),
      title: getCourseTitleText(row)
    }));
    await sendStatusUpdate({ courseQueue: queue });
    return queue;
  }

  function getCourseOpenElement(row) {
    const candidates = queryAll(row, CONFIG.COURSE_DETAIL_SELECTORS);
    return candidates.find((element) => !isDeniedCourseOpenElement(element)) || null;
  }

  function isDeniedCourseOpenElement(element) {
    if (!element) return true;
    const text = [
      visibleText(element),
      element.getAttribute("onclick") || "",
      element.getAttribute("href") || "",
      element.getAttribute("title") || "",
      element.getAttribute("aria-label") || ""
    ].join(" ");

    if (CONFIG.COURSE_EXCLUDE_KEYWORDS.some((keyword) => text.includes(keyword))) return true;
    return /sugang|apply|enrol|enroll|request|cart|like|wish|favorite|interest|heart/i.test(text);
  }

  function isCourseRow(row) {
    if (row.matches && row.matches("tr.studyRow") && row.querySelector("a[onclick*='onViewPage']")) {
      return !isExcludedCourseArea(row);
    }

    const title = getCourseTitleElement(row);
    const openElement = getCourseOpenElement(row);
    const text = searchableText(row);
    if (!title || !openElement || !text.trim()) return false;
    if (row.querySelector(".progress, .current, .total")) return false;
    if (isExcludedCourseArea(row)) return false;
    if (isIgnoredTitleText(visibleText(title))) return false;
    return CONFIG.COURSE_INCOMPLETE_KEYWORDS.some((keyword) => text.includes(keyword))
      || CONFIG.COURSE_COMPLETE_KEYWORDS.some((keyword) => text.includes(keyword))
      || extractCoursePercent(row) != null;
  }

  function findCourseRows() {
    const directRows = [];
    for (const doc of getSearchDocuments()) {
      directRows.push(...doc.querySelectorAll("tr.studyRow"));
    }
    const safeDirectRows = [...new Set(directRows)].filter(isCourseRow);
    if (safeDirectRows.length > 0) return safeDirectRows;

    const rows = [];
    for (const doc of getSearchDocuments()) {
      rows.push(...queryAll(doc, CONFIG.COURSE_ROW_SELECTORS));
    }

    const selectorRows = [...new Set(rows)].filter(isCourseRow);
    if (selectorRows.length > 0) return selectorRows;

    const fallbackRows = [];
    for (const doc of getSearchDocuments()) {
      for (const title of queryAll(doc, CONFIG.COURSE_TITLE_SELECTORS)) {
        if (isIgnoredTitleText(visibleText(title))) continue;
        const row = title.closest("tr.studyRow, [data-course-row], .course-row, .lecture-row, .class-row, .list_clear, li, tr, .item");
        if (row && isCourseRow(row)) fallbackRows.push(row);
      }
    }
    return [...new Set(fallbackRows)];
  }

  function findNextIncompleteCourse() {
    return findCourseRows().find((row) => isCourseIncomplete(row)) || null;
  }

  async function findNextIncompleteCourseInfo() {
    const rows = findCourseRows();
    const index = rows.findIndex((row) => isCourseIncomplete(row));
    if (index < 0) return null;
    const queue = await ensureCourseQueue(rows);
    const key = getCourseKey(rows[index]);
    const queueIndex = queue.findIndex((item) => item && item.key === key);
    return {
      row: rows[index],
      index: queueIndex >= 0 ? queueIndex : index,
      total: queue.length || rows.length,
      title: getCourseTitleText(rows[index])
    };
  }

  async function openCourseDetail(row, courseInfo = null) {
    const target = getCourseOpenElement(row);
    if (!target) throw new Error("Course detail link was not found.");
    if (isDeniedCourseOpenElement(target)) throw new Error("Course detail link looked like enrollment/recommendation action; skipped.");
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    await Utils.sleep(150);
    const title = getCourseTitleText(row);
    await sendStatusUpdate({
      status: "opening_popup",
      running: true,
      currentTitle: title || "Opening course detail",
      courseTitle: courseInfo?.title || title || "",
      courseIndex: courseInfo ? courseInfo.index + 1 : 0,
      courseTotal: courseInfo ? courseInfo.total : 0,
      lessonIndex: 0,
      lessonTotal: 0,
      completedTime: 0,
      totalTime: 0,
      remainingTime: 0,
      lastError: "Opening incomplete course detail page"
    });

    const onclick = target.getAttribute("onclick") || target.closest("[onclick]")?.getAttribute("onclick") || "";
    if (onclick) {
      const response = await sendRuntimeMessage({ type: "RUN_PAGE_ONCLICK", onclick });
      if (!response || !response.ok || !response.executed) target.click();
    } else {
      target.click();
    }
  }

  function getCourseDetailStartElement() {
    const candidates = queryAll(document, [
      "a[onclick*='onStartNavi']",
      "button[onclick*='onStartNavi']",
      "a.item2",
      "button.item2"
    ]);
    return candidates.find((element) => {
      if (element.closest("#lecture-helper-panel")) return false;
      const text = visibleText(element).replace(/\s+/g, "");
      const onclick = element.getAttribute("onclick") || "";
      return onclick.includes("onStartNavi") || text.includes("학습시작") || text.includes("학습하기");
    }) || null;
  }

  function extractCourseDetailLearningState() {
    const bodyText = searchableText(document.body);
    const title = (
      document.querySelector(".sec1 h1.tit, h1.tit")?.innerText
      || document.title.match(/학습현황\s*:\s*(.+)$/)?.[1]
      || document.title
      || "Course detail"
    ).trim().slice(0, 160);

    const graphTimeText = document.querySelector(".graph_group .result .item2")?.innerText || "";
    const detailTimeText = Array.from(document.querySelectorAll(".info_group li"))
      .find((item) => visibleText(item).replace(/\s+/g, "").startsWith("학습시간"))
      ?.querySelector(".result")?.innerText || "";
    const exactTimeText = Array.from(document.querySelectorAll(".remodal li, .mdtxt li"))
      .find((item) => visibleText(item).replace(/\s+/g, "").startsWith("학습시간"))
      ?.querySelector(".color10, .bold")?.innerText || "";
    const learnedMatch = bodyText.match(/학습시간\s*:?\s*([0-9]+\s*시(?:간)?\s*)?([0-9]+\s*분)\s*([0-9]+\s*초)?/);
    const compactLearnedMatch = (exactTimeText || detailTimeText || graphTimeText).match(/([0-9]+\s*시(?:간)?\s*)?([0-9]+\s*분)\s*([0-9]+\s*초)?/);
    const creditTimeText = Array.from(document.querySelectorAll(".info_area span, .ly_right span"))
      .map((element) => visibleText(element))
      .find((text) => text.includes("인정시간")) || "";
    const creditMatch = creditTimeText.match(/인정시간\s*:?\s*([0-9]+\s*시(?:간)?\s*)?([0-9]+\s*분)\s*([0-9]+\s*초)?/)
      || bodyText.match(/인정시간\s*:?\s*([0-9]+\s*시(?:간)?\s*)?([0-9]+\s*분)\s*([0-9]+\s*초)?/);
    const requiredMatch = bodyText.match(/필수학습시간\s*:?\s*([0-9]+\s*시(?:간)?\s*)?([0-9]+\s*분)\s*([0-9]+\s*초)?/);

    const completed = compactLearnedMatch
      ? Utils.parseDuration(compactLearnedMatch[0])
      : (learnedMatch ? Utils.parseDuration(learnedMatch[0]) : null);
    const total = creditMatch
      ? Utils.parseDuration(creditMatch[0])
      : (requiredMatch ? Utils.parseDuration(requiredMatch[0]) : null);
    const remaining = completed != null && total != null ? Utils.computeRemainingTime(completed, total) : 0;

    return {
      title,
      completed: completed || 0,
      total: total || 0,
      remaining
    };
  }

  function getCurrentCourseTitle() {
    return (
      getCourseTitleFromUrl()
      || document.querySelector("body > h1, .top h1, .header h1, .navi-title")?.innerText
      ||
      document.querySelector(".sec1 h1.tit, h1.tit")?.innerText
      || document.title.match(/학습현황\s*:\s*(.+)$/)?.[1]
      || ""
    ).trim().slice(0, 160);
  }

  function getCurrentCourseTitleFromAnyFrame() {
    const docs = [document];
    try {
      if (window.parent && window.parent !== window && window.parent.document) docs.push(window.parent.document);
    } catch (_error) {
      // Other hosts may not allow parent-frame access.
    }

    for (const doc of docs) {
      const title = (
        getCourseTitleFromUrl(doc.location?.href || location.href)
        || doc.querySelector("body > h1, .top h1, .header h1, .navi-title")?.innerText
        ||
        doc.querySelector(".sec1 h1.tit, h1.tit")?.innerText
        || doc.title.split(":").pop()
        || ""
      ).trim().slice(0, 160);
      if (title) return title;
    }

    return getCurrentCourseTitle();
  }

  async function runCourseDetailPage() {
    const startElement = getCourseDetailStartElement();
    if (!startElement) return false;

    const state = extractCourseDetailLearningState();
    await sendStatusUpdate({
      status: "opening_popup",
      running: true,
      currentTitle: state.title,
      courseTitle: state.title,
      completedTime: state.completed,
      totalTime: state.total,
      remainingTime: state.remaining,
      lastError: ""
    });

    startElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    await Utils.sleep(150);

    const onclick = startElement.getAttribute("onclick") || startElement.closest("[onclick]")?.getAttribute("onclick") || "";
    await sendRuntimeMessage({ type: "PREPARE_POPUP_TRACKING" });
    if (/onStartNavi\s*\(/.test(onclick)) {
      try {
        window.contWin = null;
      } catch (_error) {
        // Ignore stale page popup handles.
      }
      await sendRuntimeMessage({ type: "CLEAR_PAGE_POPUP_HANDLE" });
      const clicked = await trustedClickElement(startElement);
      if (!clicked) {
        const response = await sendRuntimeMessage({ type: "RUN_PAGE_ONCLICK", onclick });
        if (!response || !response.ok || !response.executed) startElement.click();
      }
    } else if (onclick) {
      const response = await sendRuntimeMessage({ type: "RUN_PAGE_ONCLICK", onclick });
      if (!response || !response.ok || !response.executed) startElement.click();
    } else {
      startElement.click();
    }

    const popupResponse = await sendRuntimeMessage({ type: "WAIT_FOR_POPUP" });
    if (!popupResponse || !popupResponse.ok || !popupResponse.popup) {
      await sendStatusUpdate({
        lastError: `${state.title}: learning popup was not detected.`
      });
      return true;
    }

    const waitMs = state.remaining > 0
      ? state.remaining * 1000 + CONFIG.SAFETY_BUFFER_MS
      : CONFIG.SAFETY_BUFFER_MS;
    const completedWait = await waitForRemainingTime(waitMs, () => stopRequested, {
      completedTime: state.completed,
      totalTime: state.total
    });
    await sendRuntimeMessage({ type: "CLOSE_TRACKED_POPUP" });

    await sendStatusUpdate({
      status: completedWait && !stopRequested ? "idle" : "stopped",
      running: false,
      remainingTime: 0,
      lastError: completedWait ? "Course detail learning popup was processed." : ""
    });
    return true;
  }

  async function closeCourseDetailToList() {
    await sendStatusUpdate({
      status: "returning_to_course_list",
      running: true,
      currentTitle: "",
      lessonIndex: 0,
      lessonTotal: 0,
      remainingTime: 0,
      lastError: "Current course has no pending lessons. Returning to course list."
    });

    await Utils.sleep(150);
    try {
      if (window.parent && window.parent !== window) {
        window.parent.location.assign("/myspace/myroom/myHomeStudyList.do");
      } else {
        window.location.assign("/myspace/myroom/myHomeStudyList.do");
      }
    } catch (_error) {
      window.location.assign("/myspace/myroom/myHomeStudyList.do");
    }
    return true;
  }

  async function autoResumeIfRunning() {
    if (!CONFIG.AUTO_RESUME_RUNNING) return;
    if (window.top !== window) return;
    if (/\/study\/navi\/|elrnVideo\.do/i.test(location.href)) return;
    await Utils.sleep(1000);
    try {
      const response = await sendRuntimeMessage({ type: "GET_STATE" });
      if (response && response.ok && response.state && response.state.running) {
        runAutomationLoop();
      }
    } catch (_error) {
      // The extension context may be reloading; the user can press Start again.
    }
  }

  function getDurationFromSelectors(row, selectors, preferMax = false) {
    const candidates = [];
    for (const element of queryAll(row, selectors)) {
      candidates.push(...durationSecondsIn(element));
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a - b);
    return preferMax ? candidates[candidates.length - 1] : candidates[0];
  }

  function extractCompletedTime(row) {
    const progressCurrent = row.querySelector(".progress .current, span.current, [class*='current']");
    const directCurrent = progressCurrent
      ? Utils.parseDuration([
        progressCurrent.textContent || "",
        progressCurrent.innerText || "",
        progressCurrent.getAttribute("title") || "",
        progressCurrent.getAttribute("aria-label") || "",
        progressCurrent.outerHTML || ""
      ].join(" "))
      : null;
    if (directCurrent != null) return directCurrent;

    const fromSelector = getDurationFromSelectors(row, CONFIG.COMPLETED_TIME_SELECTORS, false);
    if (fromSelector != null) return fromSelector;

    const candidates = [...durationSecondsIn(row), ...durationSecondsInHtml(row)];
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a - b);
    return candidates[0];
  }

  function dispatchMouse(target, type) {
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + Math.min(8, Math.max(1, rect.width / 2)),
      clientY: rect.top + Math.min(8, Math.max(1, rect.height / 2))
    }));
  }

  function chooseTotalCandidate(row, beforeSeconds, completedSeconds) {
    const progressTotal = row.querySelector(".progress .total, span.total, [class*='total']");
    const directTotal = progressTotal
      ? Utils.parseDuration([
        progressTotal.textContent || "",
        progressTotal.innerText || "",
        progressTotal.getAttribute("title") || "",
        progressTotal.getAttribute("aria-label") || "",
        progressTotal.outerHTML || ""
      ].join(" "))
      : null;
    if (directTotal != null && directTotal > 0) return directTotal;

    const selectorCandidate = getDurationFromSelectors(row, CONFIG.TOTAL_TIME_SELECTORS, true);
    if (selectorCandidate != null && selectorCandidate > 0) {
      if (completedSeconds == null || selectorCandidate >= completedSeconds) return selectorCandidate;
    }

    const before = new Set(beforeSeconds);
    const after = durationSecondsIn(row).sort((a, b) => b - a);
    const newCandidates = after.filter((seconds) => !before.has(seconds) && seconds > 0);
    if (newCandidates.length > 0) return newCandidates[0];

    const largerCandidates = after.filter((seconds) => completedSeconds != null && seconds > completedSeconds);
    if (largerCandidates.length > 0) return largerCandidates[0];

    return null;
  }

  async function hoverTitleAndExtractTotalTime(row, completedSeconds = null) {
    const title = getTitleElement(row);
    if (!title) throw new Error("Title element was not found.");

    const beforeSeconds = durationSecondsIn(row);
    const directTotal = chooseTotalCandidate(row, beforeSeconds, completedSeconds);
    if (directTotal != null) return directTotal;

    title.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    await Utils.sleep(150);

    for (let attempt = 0; attempt <= CONFIG.HOVER_RETRY_COUNT; attempt += 1) {
      dispatchMouse(title, "mouseover");
      dispatchMouse(title, "mousemove");
      await Utils.sleep(CONFIG.HOVER_WAIT_MS);

      const total = chooseTotalCandidate(row, beforeSeconds, completedSeconds);
      if (total != null) return total;
    }

    return null;
  }

  async function clickTitleToOpenPopup(row) {
    const title = getClickableLessonElement(row);
    if (!title) throw new Error("Clickable title element was not found.");
    title.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    await Utils.sleep(150);

    const onclick = title.getAttribute("onclick") || title.closest("[onclick]")?.getAttribute("onclick") || "";
    if (/checkTrRng\s*\(|checkRtprgs\s*\(|onStartNavi\s*\(/.test(onclick)) {
      try {
        if (window.parent && window.parent !== window) window.parent.contWin = null;
        else window.contWin = null;
      } catch (_error) {
        // Ignore frame access issues; the background handler also attempts cleanup.
      }
      await sendRuntimeMessage({ type: "CLEAR_PAGE_POPUP_HANDLE" });
    }
    await sendRuntimeMessage({ type: "PREPARE_POPUP_TRACKING" });
    if (/checkTrRng\s*\(|checkRtprgs\s*\(|onStartNavi\s*\(/.test(onclick)) {
      const trustedResponse = await sendRuntimeMessage({ type: "OPEN_LESSON_WITH_TRUSTED_CLICK", onclick });
      if (trustedResponse && trustedResponse.ok && trustedResponse.popup) return trustedResponse;

      const clicked = await trustedClickElement(title);
      if (!clicked) {
        const response = await sendRuntimeMessage({ type: "RUN_PAGE_ONCLICK", onclick });
        if (!response || !response.ok || !response.executed) title.click();
      }
    } else if (row.contains(title) && isLectureRow(row)) {
      const clicked = await trustedClickElement(title);
      if (!clicked) title.click();
    } else {
      throw new Error(`Refused to click non-lesson link: ${visibleText(title).trim().slice(0, 80) || "untitled"}`);
    }

    return sendRuntimeMessage({ type: "WAIT_FOR_POPUP" });
  }

  function getViewportClickPoint(element) {
    let rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    let win = window;

    while (win.parent && win.parent !== win) {
      try {
        const frame = win.frameElement;
        if (!frame) break;
        rect = frame.getBoundingClientRect();
        x += rect.left;
        y += rect.top;
        win = win.parent;
      } catch (_error) {
        break;
      }
    }

    return { x, y };
  }

  async function trustedClickElement(element) {
    const point = getViewportClickPoint(element);
    const response = await sendRuntimeMessage({ type: "DISPATCH_MOUSE_CLICK", point });
    return Boolean(response && response.ok && response.clicked);
  }

  async function waitForRemainingTime(ms, stopSignal, progress = null) {
    const deadline = Date.now() + ms;
    const startedAt = Date.now();
    const baseCompleted = Math.max(0, progress?.completedTime || 0);
    const totalTime = Math.max(0, progress?.totalTime || 0);
    while (Date.now() < deadline) {
      if (stopSignal()) return false;
      const leftMs = Math.max(0, deadline - Date.now());
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const displayedCompleted = totalTime > 0
        ? Math.min(totalTime, baseCompleted + elapsedSeconds)
        : baseCompleted + elapsedSeconds;
      const displayedRemaining = totalTime > 0
        ? Math.max(0, totalTime - displayedCompleted)
        : Math.ceil(leftMs / 1000);
      await sendStatusUpdate({
        status: "waiting",
        completedTime: displayedCompleted,
        totalTime: totalTime || progress?.totalTime || 0,
        remainingTime: displayedRemaining
      });
      await Utils.sleep(Math.min(CONFIG.STATUS_POLL_INTERVAL, leftMs));
    }
    return true;
  }

  async function verifyCompletion(row) {
    await Utils.sleep(CONFIG.VERIFY_WAIT_MS);
    if (rowHasCompletedKeyword(row)) return true;
    const completed = extractCompletedTime(row);
    const total = await hoverTitleAndExtractTotalTime(row, completed);
    if (completed == null || total == null) return false;
    return Utils.computeRemainingTime(completed, total) <= 0;
  }

  async function findNextPendingRow() {
    const rows = findRows();
    const stats = {
      rows: rows.length,
      missingCompleted: 0,
      missingTotal: 0,
      alreadyComplete: 0,
      firstMissingCompleted: ""
    };

    for (let index = 0; index < rows.length; index += 1) {
      if (stopRequested) return null;
      const row = rows[index];
      const title = getTitleText(row);
      const lessonKey = getLessonKey(row, index);
      if (processedLessonIndexes.has(index) || processedLessonKeys.has(lessonKey)) {
        stats.alreadyComplete += 1;
        continue;
      }
      const completed = extractCompletedTime(row);
      if (completed == null) {
        stats.missingCompleted += 1;
        if (!stats.firstMissingCompleted) {
          const htmlCandidates = durationSecondsInHtml(row).join(",");
          stats.firstMissingCompleted = `${title || "untitled"} htmlTimes=${htmlCandidates || "none"}`;
        }
        continue;
      }

      await sendStatusUpdate({
        status: "hovering",
        currentTitle: title,
        lessonIndex: index + 1,
        lessonTotal: rows.length,
        completedTime: completed,
        totalTime: 0,
        remainingTime: 0,
        lastError: ""
      });

      const total = await hoverTitleAndExtractTotalTime(row, completed);
      if (total == null) {
        stats.missingTotal += 1;
        await sendStatusUpdate({ lastError: `${title}: total time was not found in the same row after title hover.` });
        continue;
      }

      const remaining = Utils.computeRemainingTime(completed, total);
      await sendStatusUpdate({
        status: "running",
        courseTitle: getCurrentCourseTitleFromAnyFrame(),
        currentTitle: title,
        lessonIndex: index + 1,
        lessonTotal: rows.length,
        completedTime: completed,
        totalTime: total,
        remainingTime: remaining
      });

      if (remaining > 0 && !rowHasCompletedKeyword(row)) {
        return { row, index, totalRows: rows.length, title, completed, total, remaining, lessonKey };
      }

      stats.alreadyComplete += 1;
    }

    await sendStatusUpdate({
      lastError: `No pending lesson: rows=${stats.rows}, missingCompleted=${stats.missingCompleted}, missingTotal=${stats.missingTotal}, completeOrZero=${stats.alreadyComplete}${stats.firstMissingCompleted ? `, sample=${stats.firstMissingCompleted}` : ""}`
    });
    await closeCourseDetailToList();
    return null;
  }

  async function runAutomationLoop() {
    if (automationRunning) return;
    const initialRows = findRows();
    if (initialRows.length === 0) {
      const handledCourseDetail = await runCourseDetailPage();
      if (handledCourseDetail) return;

      const pendingCourse = await findNextIncompleteCourseInfo();
      if (pendingCourse) {
        automationRunning = true;
        stopRequested = false;
        try {
          await sendStatusUpdate({
            status: "running",
            running: true,
            courseTitle: pendingCourse.title,
            courseIndex: pendingCourse.index + 1,
            courseTotal: pendingCourse.total,
            lessonIndex: 0,
            lessonTotal: 0,
            lastError: `Course rows=${pendingCourse.total}`
          });
          await openCourseDetail(pendingCourse.row, pendingCourse);
        } catch (error) {
          await sendStatusUpdate({
            status: "error",
            running: false,
            lastError: error.message
          });
        } finally {
          automationRunning = false;
        }
        return;
      }
      await sendStatusUpdate({
        status: "idle",
        running: false,
        currentTitle: "No pending lesson",
        completedTime: 0,
        totalTime: 0,
        remainingTime: 0,
        lastError: `No lesson or incomplete course rows found on this page.`
      });
      return;
    }
    automationRunning = true;
    stopRequested = false;
    processedLessonKeys.clear();
    processedLessonIndexes.clear();

    try {
      await sendStatusUpdate({
        status: "running",
        running: true,
        courseTitle: getCurrentCourseTitleFromAnyFrame(),
        lastError: `Initial rows=${initialRows.length}`
      });

      while (!stopRequested) {
        const pending = await findNextPendingRow();
        if (!pending) {
          await closeCourseDetailToList();
          return;
        }

        await sendStatusUpdate({
          status: "opening_popup",
          courseTitle: getCurrentCourseTitleFromAnyFrame(),
          currentTitle: pending.title,
          lessonIndex: pending.index + 1,
          lessonTotal: pending.totalRows,
          completedTime: pending.completed,
          totalTime: pending.total,
          remainingTime: pending.remaining
        });

        const popupResponse = await clickTitleToOpenPopup(pending.row);
        if (!popupResponse || !popupResponse.ok || !popupResponse.popup) {
          await sendStatusUpdate({
            lastError: `${pending.title}: popup was not detected. Waiting will continue, but close fallback may be unavailable.`
          });
        }

        const waitMs = pending.remaining * 1000 + CONFIG.SAFETY_BUFFER_MS;
        const completedWait = await waitForRemainingTime(waitMs, () => stopRequested, {
          completedTime: pending.completed,
          totalTime: pending.total
        });

        await sendRuntimeMessage({ type: "CLOSE_TRACKED_POPUP" });
        await sendRuntimeMessage({ type: "CLEAR_PAGE_POPUP_HANDLE" });
        if (!completedWait || stopRequested) break;

        await sendStatusUpdate({ status: "verifying", remainingTime: 0 });
        if (pending.lessonKey) processedLessonKeys.add(pending.lessonKey);
        processedLessonIndexes.add(pending.index);
        const freshRows = findRows();
        const rowForVerify = freshRows[pending.index] || pending.row;
        await Promise.race([
          verifyCompletion(rowForVerify),
          Utils.sleep(Math.max(CONFIG.VERIFY_WAIT_MS + 5000, 8000))
        ]);
      }

      if (!stopRequested && await closeCourseDetailToList()) {
        return;
      }

      await sendStatusUpdate({
        status: stopRequested ? "stopped" : "idle",
        running: false,
        currentTitle: stopRequested ? "" : "No pending lesson",
        remainingTime: 0
      });
    } catch (error) {
      await sendStatusUpdate({
        status: "error",
        running: false,
        lastError: error.message
      });
    } finally {
      automationRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "START_AUTOMATION") {
      runAutomationLoop();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "STOP_AUTOMATION") {
      stopRequested = true;
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      mountFloatingPanel();
      autoResumeIfRunning();
    }, { once: true });
  } else {
    mountFloatingPanel();
    autoResumeIfRunning();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "LectureHelper") return;
    if (event.data.type === "START_AUTOMATION_FRAME") {
      runAutomationLoop();
    }
    if (event.data.type === "STOP_AUTOMATION_FRAME") {
      stopRequested = true;
    }
  });

  globalThis.LectureHelperContent = {
    parseDuration: Utils.parseDuration,
    formatDuration: Utils.formatDuration,
    extractCompletedTime,
    hoverTitleAndExtractTotalTime,
    computeRemainingTime: Utils.computeRemainingTime,
    clickTitleToOpenPopup,
    waitForRemainingTime,
    verifyCompletion,
    findNextPendingRow,
    sendStatusUpdate
  };
})();
