importScripts("config.js", "utils.js");

const CONFIG = globalThis.LectureHelperConfig;
const Utils = globalThis.LectureHelperUtils;
const STATE_KEY = "lectureHelperState";

const defaultState = {
  status: "idle",
  running: false,
  tabId: null,
  courseTitle: "",
  courseIndex: 0,
  courseTotal: 0,
  courseQueue: [],
  currentTitle: "",
  lessonIndex: 0,
  lessonTotal: 0,
  completedTime: 0,
  totalTime: 0,
  remainingTime: 0,
  lastError: "",
  updatedAt: Date.now()
};

const popupTrackers = new Map();

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return { ...defaultState, ...(stored[STATE_KEY] || {}) };
}

async function setState(patch) {
  const next = { ...(await getState()), ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

function allowTargetPopups() {
  if (!chrome.contentSettings || !chrome.contentSettings.popups) return Promise.resolve(false);

  return new Promise((resolve) => {
    chrome.contentSettings.popups.set({
      primaryPattern: "https://moip.nhi.go.kr/*",
      setting: "allow"
    }, () => resolve(!chrome.runtime.lastError));
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureContentScripts(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch (_error) {
    // Fall through to injection below.
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["config.js", "utils.js", "content.js"]
  });
}

async function findLectureFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const rowsFromList = Array.from(document.querySelectorAll(".study_group .list_area .list_clear, .study_group .list_area .list.clear, .list_area .list_clear, .list_area .list.clear, .list_clear, .list.clear"))
        .filter((row) => row.querySelector(".subject a, a[onclick*='checkRtprgs'], button[onclick*='checkRtprgs']") && row.querySelector(".progress, .current, .total"));
      const rowsFromTime = Array.from(document.querySelectorAll(".progress .current, .progress .total, span.current, span.total, [class*='current'], [class*='total']"))
        .map((node) => node.closest(".list_clear, .list.clear"))
        .filter((row) => row && row.querySelector(".subject a, a[onclick*='checkRtprgs'], button[onclick*='checkRtprgs']"));
      const rows = Array.from(new Set([...rowsFromList, ...rowsFromTime]));
      const text = document.body ? document.body.innerText || "" : "";
      const progressCount = document.querySelectorAll(".progress").length;
      const currentCount = document.querySelectorAll(".current, [class*='current']").length;
      const totalCount = document.querySelectorAll(".total, [class*='total']").length;
      const hasLessonSignals = rows.some((row) => {
        return row.querySelector(".subject a, a[onclick*='checkTrRng'], button[onclick*='checkTrRng'], a[onclick*='checkRtprgs'], button[onclick*='checkRtprgs']");
      });
      return {
        rowCount: rows.length,
        score: hasLessonSignals
          ? rows.length * 100 + progressCount * 10 + currentCount * 10 + totalCount * 10 + (/00:\d{2}:\d{2}|보고듣고말하기/.test(text) ? 1 : 0)
          : 0,
        title: rows[0]?.querySelector(".subject a, a[onclick*='checkRtprgs']")?.innerText?.trim() || "",
        url: location.href,
        diagnostics: {
          listClear: document.querySelectorAll(".list_clear, .list.clear").length,
          subjectLinks: document.querySelectorAll(".subject a").length,
          progress: progressCount,
          current: currentCount,
          total: totalCount,
          hasVisibleLessonText: /00:\d{2}:\d{2}|보고듣고말하기/.test(text)
        }
      };
    }
  });

  const found = results
    .filter((result) => result.result && result.result.score > 0)
    .sort((a, b) => b.result.score - a.result.score)[0] || null;
  if (found) return found;

  const diagnostics = results
    .map((result) => {
      const data = result.result || {};
      const diag = data.diagnostics || {};
      return `frame=${result.frameId} score=${data.score || 0} rows=${data.rowCount || 0} list=${diag.listClear || 0} subject=${diag.subjectLinks || 0} progress=${diag.progress || 0} current=${diag.current || 0} total=${diag.total || 0} text=${diag.hasVisibleLessonText ? "Y" : "N"}`;
    })
    .join(" | ");
  return { frameId: null, diagnostics };
}

async function findCourseFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const excludeWords = ["추천과정", "추천자료", "수강신청", "신청", "관심", "찜", "좋아요"];
      const incompleteWords = ["미이수", "미수료", "학습중", "수강중", "진행중", "대기"];
      const completeWords = ["이수완료", "수료", "수강완료", "학습완료", "완료", "100%"];
      const textOf = (node) => node ? (node.innerText || node.textContent || "") : "";
      const excluded = (node) => excludeWords.some((word) => textOf(node).includes(word));
      const percentOf = (node) => {
        const matches = [...textOf(node).matchAll(/(\d{1,3})(?:\.\d+)?\s*%/g)].map((match) => Number(match[1]));
        return matches.length ? Math.max(...matches) : null;
      };
      const directRows = Array.from(document.querySelectorAll("tr.studyRow"))
        .filter((row) => row.querySelector("td.subject a[onclick*='onViewPage'], a[onclick*='onViewPage']"));
      const rows = (directRows.length > 0 ? directRows : Array.from(document.querySelectorAll("tr.studyRow, tbody tr.studyRow, .tbl-type01 tr.studyRow, [data-course-row], .course-row, .lecture-row, .class-row, .my_course .list_clear, .course_list .list_clear, .list_area .list_clear, .my_course li, .course_list li, .list_area li, tr")))
        .filter((row) => {
          const text = textOf(row);
          if (!text.trim() || excluded(row)) return false;
          if (row.querySelector(".progress, .current, .total")) return false;
          const hasOpen = row.querySelector("td.subject a[onclick*='onViewPage'], a[onclick*='onViewPage'], a[onclick*='elrnMain'], a[onclick*='study'], a[onclick*='detail'], a[href*='elrnMain'], a[href*='study'], a[href*='detail'], .subject a, .title a");
          if (!hasOpen) return false;
          const percent = percentOf(row);
          if (row.matches && row.matches("tr.studyRow") && row.querySelector("a[onclick*='onViewPage']")) return true;
          return incompleteWords.some((word) => text.includes(word))
            || completeWords.some((word) => text.includes(word))
            || percent != null;
        });
      const pendingRows = rows.filter((row) => {
        const text = textOf(row);
        const percent = percentOf(row);
        if (completeWords.some((word) => text.includes(word))) return false;
        if (row.matches && row.matches("tr.studyRow") && row.querySelector("a[onclick*='onViewPage']")) {
          return percent == null || percent < 100 || incompleteWords.some((word) => text.includes(word));
        }
        return incompleteWords.some((word) => text.includes(word)) || (percent != null && percent < 100);
      });
      return {
        rowCount: rows.length,
        pendingCount: pendingRows.length,
        score: pendingRows.length * 100 + rows.length,
        sample: textOf(pendingRows[0] || rows[0]).trim().slice(0, 80),
        diagnostics: {
          listClear: document.querySelectorAll(".list_clear").length,
          subjectLinks: document.querySelectorAll(".subject a").length,
          titleLinks: document.querySelectorAll(".title a").length,
          studyLinks: document.querySelectorAll("a[onclick*='onViewPage'], a[onclick*='study'], a[onclick*='elrn'], a[onclick*='learn'], a[href*='study'], a[href*='elrn'], a[href*='learn']").length,
          percentTexts: (textOf(document.body).match(/\d{1,3}(?:\.\d+)?\s*%/g) || []).length,
          excludedText: excluded(document.body)
        }
      };
    }
  });

  const found = results
    .filter((result) => result.result && result.result.pendingCount > 0)
    .sort((a, b) => b.result.score - a.result.score)[0] || null;
  if (found) return found;

  const diagnostics = results
    .map((result) => {
      const data = result.result || {};
      const diag = data.diagnostics || {};
      return `frame=${result.frameId} rows=${data.rowCount || 0} pending=${data.pendingCount || 0} list=${diag.listClear || 0} subject=${diag.subjectLinks || 0} title=${diag.titleLinks || 0} studyLinks=${diag.studyLinks || 0} percents=${diag.percentTexts || 0} excluded=${diag.excludedText ? "Y" : "N"} sample=${data.sample || "-"}`;
    })
    .join(" | ");
  return { frameId: null, diagnostics };
}

async function findCourseDetailFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const startLinks = Array.from(document.querySelectorAll("a[onclick*='onStartNavi'], button[onclick*='onStartNavi']"));
      const text = document.body ? document.body.innerText || "" : "";
      const hasCourseDetail = /학습현황|수료기준|필수학습시간|인정시간/.test(text) || startLinks.length > 0;
      return {
        startCount: startLinks.length,
        score: startLinks.length > 0 ? startLinks.length * 1000 : 0,
        title: document.title,
        diagnostics: {
          hasCourseDetail,
          startCount: startLinks.length
        }
      };
    }
  });

  const found = results
    .filter((result) => result.result && result.result.score > 0)
    .sort((a, b) => b.result.score - a.result.score)[0] || null;
  if (found) return found;

  const diagnostics = results
    .map((result) => {
      const data = result.result || {};
      const diag = data.diagnostics || {};
      return `frame=${result.frameId} detail=${diag.hasCourseDetail ? "Y" : "N"} start=${diag.startCount || 0}`;
    })
    .join(" | ");
  return { frameId: null, diagnostics };
}

async function startAutomation(senderTab = null) {
  const tab = senderTab && senderTab.id != null ? senderTab : await getActiveTab();
  if (!tab || !Utils.isTargetUrl(tab.url)) {
    const allowed = CONFIG.TARGET_HOSTS.join(", ");
    throw new Error(`대상 강의 목록 페이지가 아닙니다. 허용 도메인: ${allowed}`);
  }

  await ensureContentScripts(tab.id);
  await allowTargetPopups();
  await setState({
    status: "running",
    running: true,
    tabId: tab.id,
    courseTitle: "",
    courseIndex: 0,
    courseTotal: 0,
    courseQueue: [],
    currentTitle: "",
    lessonIndex: 0,
    lessonTotal: 0,
    completedTime: 0,
    totalTime: 0,
    remainingTime: 0,
    lastError: ""
  });

  const lectureFrame = await findLectureFrame(tab.id);
  if (lectureFrame && lectureFrame.frameId != null) {
    await chrome.tabs.sendMessage(
      tab.id,
      { type: "START_AUTOMATION" },
      { frameId: lectureFrame.frameId }
    );
    return;
  }

  const courseDetailFrame = await findCourseDetailFrame(tab.id);
  if (courseDetailFrame && courseDetailFrame.frameId != null) {
    await chrome.tabs.sendMessage(
      tab.id,
      { type: "START_AUTOMATION" },
      { frameId: courseDetailFrame.frameId }
    );
    return;
  }

  const courseFrame = await findCourseFrame(tab.id);
  if (courseFrame && courseFrame.frameId != null) {
    await chrome.tabs.sendMessage(
      tab.id,
      { type: "START_AUTOMATION" },
      { frameId: courseFrame.frameId }
    );
    return;
  }

  await setState({
    status: "idle",
    running: false,
    tabId: tab.id,
    currentTitle: "No incomplete course found",
    completedTime: 0,
    totalTime: 0,
    remainingTime: 0,
    lastError: courseFrame?.diagnostics || "No safe incomplete course row was found. Recommendation/enrollment areas were ignored."
  });
}

async function stopAutomation() {
  const state = await setState({ status: "stopped", running: false });
  if (state.tabId != null) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: "STOP_AUTOMATION" });
      await chrome.scripting.executeScript({
        target: { tabId: state.tabId, allFrames: true },
        func: () => {
          window.postMessage({ source: "LectureHelper", type: "STOP_AUTOMATION_FRAME" }, "*");
        }
      });
    } catch (_error) {
      // The tab may have been closed or navigated away; storage still records stopped.
    }
  }
}

async function preparePopupTracking(senderTabId) {
  const [tabs, windows] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getAll({})
  ]);
  popupTrackers.set(senderTabId, {
    knownTabIds: new Set(tabs.map((tab) => tab.id)),
    knownWindowIds: new Set(windows.map((win) => win.id)),
    popupTabId: null,
    popupWindowId: null,
    startedAt: Date.now()
  });
}

async function autoAcceptDialogs(tabId, durationMs = 30000) {
  if (tabId == null) return { attached: false, reason: "missing_tab" };

  const target = { tabId };
  let attached = false;
  let listener = null;

  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "Page.enable");

    listener = async (source, method, params) => {
      if (source.tabId !== tabId || method !== "Page.javascriptDialogOpening") return;
      const message = String(params && params.message || "");
      const shouldAccept = /이전에\s*학습하신\s*곳으로\s*이동|previous/i.test(message)
        || params.type === "confirm"
        || params.type === "alert";
      if (!shouldAccept) return;

      try {
        await chrome.debugger.sendCommand(target, "Page.handleJavaScriptDialog", { accept: true });
      } catch (_error) {
        // The dialog may already have been handled by the page or user.
      }
    };
    chrome.debugger.onEvent.addListener(listener);

    try {
      await chrome.debugger.sendCommand(target, "Page.handleJavaScriptDialog", { accept: true });
    } catch (_error) {
      // No dialog is currently open; future Page.javascriptDialogOpening events are handled above.
    }

    setTimeout(async () => {
      if (listener) chrome.debugger.onEvent.removeListener(listener);
      try {
        await chrome.debugger.detach(target);
      } catch (_error) {
        // The popup may already be closed.
      }
    }, durationMs);

    return { attached: true };
  } catch (error) {
    if (listener) chrome.debugger.onEvent.removeListener(listener);
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch (_detachError) {
        // Ignore detach failures after attach errors.
      }
    }
    return { attached: false, reason: error.message };
  }
}

async function detectPopup(senderTabId) {
  const tracker = popupTrackers.get(senderTabId);
  if (!tracker) return null;

  const deadline = Date.now() + CONFIG.POPUP_DETECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [tabs, windows] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll({})
    ]);

    const newPopupWindow = windows.find((win) => {
      return !tracker.knownWindowIds.has(win.id) && win.type === "popup";
    });
    const newTab = tabs.find((tab) => {
      return tab.id !== senderTabId && !tracker.knownTabIds.has(tab.id);
    });

    if (newPopupWindow || newTab) {
      tracker.popupWindowId = newPopupWindow ? newPopupWindow.id : null;
      tracker.popupTabId = newTab ? newTab.id : null;
      if (!tracker.popupTabId && tracker.popupWindowId != null) {
        const popupTabs = await chrome.tabs.query({ windowId: tracker.popupWindowId });
        tracker.popupTabId = popupTabs[0]?.id || null;
      }
      popupTrackers.set(senderTabId, tracker);
      if (tracker.popupTabId != null) autoAcceptDialogs(tracker.popupTabId);
      return {
        windowId: tracker.popupWindowId,
        tabId: tracker.popupTabId
      };
    }

    await Utils.sleep(300);
  }

  return null;
}

async function closeTabWithDialogHandling(tabId) {
  const target = { tabId };
  let attached = false;
  let listener = null;

  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "Page.enable");

    listener = async (source, method, _params) => {
      if (source.tabId !== tabId || method !== "Page.javascriptDialogOpening") return;
      try {
        await chrome.debugger.sendCommand(target, "Page.handleJavaScriptDialog", { accept: true });
      } catch (_error) {
        // The tab may already be closing.
      }
    };
    chrome.debugger.onEvent.addListener(listener);
  } catch (_error) {
    attached = false;
  }

  try {
    await chrome.tabs.remove(tabId);
  } finally {
    if (listener) chrome.debugger.onEvent.removeListener(listener);
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch (_error) {
        // Already detached because the tab closed.
      }
    }
  }
}

async function dispatchMouseClickOnTab(tabId, point) {
  if (tabId == null || !point) return { clicked: false, reason: "missing_target" };

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none"
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
    return { clicked: true };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch (_error) {
        // The tab may have navigated or closed.
      }
    }
  }
}

async function dispatchMouseClick(sender, point) {
  if (!sender.tab || sender.tab.id == null) return { clicked: false, reason: "missing_target" };
  return dispatchMouseClickOnTab(sender.tab.id, point);
}

async function closeTrackedPopup(senderTabId) {
  const tracker = popupTrackers.get(senderTabId);
  if (!tracker) return { closed: false, reason: "no_tracker" };

  try {
    if (tracker.popupTabId != null) {
      await closeTabWithDialogHandling(tracker.popupTabId);
      popupTrackers.delete(senderTabId);
      return { closed: true, method: "tabs.remove.withDialogHandling" };
    }
    if (tracker.popupWindowId != null) {
      const popupWindow = await chrome.windows.get(tracker.popupWindowId, { populate: true });
      const firstTab = popupWindow.tabs && popupWindow.tabs[0];
      if (firstTab && firstTab.id != null) {
        await closeTabWithDialogHandling(firstTab.id);
      } else {
        await chrome.windows.remove(tracker.popupWindowId);
      }
      popupTrackers.delete(senderTabId);
      return { closed: true, method: "windows.remove.withDialogHandling" };
    }
  } catch (error) {
    return { closed: false, reason: error.message };
  }

  popupTrackers.delete(senderTabId);
  return { closed: false, reason: "popup_not_detected" };
}

async function runPageOnclick(sender, onclick) {
  if (!sender.tab || sender.tab.id == null || !onclick) return { executed: false };

  const target = { tabId: sender.tab.id };
  if (sender.frameId != null) target.frameIds = [sender.frameId];

  const [result] = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (onclickText) => {
      const clearBrokenCoursePopupHandle = (hostWindow) => {
        if (!hostWindow || !hostWindow.contWin) return;
        hostWindow.contWin = null;
      };

      const call = String(onclickText || "").match(/(?:return\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(([\s\S]*?)\)/);
      if (!call) return false;

      const args = [];
      const argRegex = /'([^']*)'|"([^"]*)"|([^,\s)]+)/g;
      let match;
      while ((match = argRegex.exec(call[2])) !== null) {
        args.push(match[1] ?? match[2] ?? match[3] ?? "");
      }

      const path = call[1].split(".");
      let owner = window;
      let fnName = path[path.length - 1];
      if (path[0] === "parent") {
        owner = window.parent || window;
        path.shift();
        fnName = path.pop();
      }
      for (const part of path.slice(0, -1)) {
        owner = owner && owner[part];
      }
      if (!owner || typeof owner[fnName] !== "function") {
        if (window.parent && typeof window.parent[fnName] === "function") owner = window.parent;
        else if (typeof window[fnName] === "function") owner = window;
        else return false;
      }
      clearBrokenCoursePopupHandle(owner);
      const originalAlert = owner.alert;
      const originalConfirm = owner.confirm;
      owner.alert = () => undefined;
      owner.confirm = () => true;
      const restoreDialogs = () => {
        if (owner.alert === originalAlert || owner.alert.toString().includes("undefined")) owner.alert = originalAlert;
        if (owner.confirm === originalConfirm || owner.confirm.toString().includes("true")) owner.confirm = originalConfirm;
      };
      try {
        owner[fnName](...args);
        owner.setTimeout(restoreDialogs, 5000);
      } catch (error) {
        restoreDialogs();
        throw error;
      }
      return true;
    },
    args: [onclick]
  });

  return { executed: Boolean(result && result.result) };
}

function normalizeLessonOnclick(onclick) {
  return String(onclick || "")
    .replace(/^\s*javascript:\s*/i, "")
    .replace(/^\s*return\s+/i, "")
    .replace(/^\s*parent\./, "")
    .replace(/;?\s*$/, ";");
}

async function waitForTabSettled(tabId, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return true;
    } catch (_error) {
      return false;
    }
    await Utils.sleep(250);
  }
  return false;
}

async function createLessonClickPoint(tabId, onclick, frameId = null) {
  const target = { tabId };
  if (frameId != null) target.frameIds = [frameId];

  const [result] = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (onclickText) => {
      const originalCall = String(onclickText || "").replace(/^\s*javascript:\s*/i, "").replace(/;?\s*$/, ";");
      const localCall = originalCall.replace(/^\s*return\s+/i, "").replace(/^\s*parent\./, "");
      const call = localCall.match(/([A-Za-z_$][\w$]*)\s*\(/);
      const fnName = call && call[1];
      const hasLocalRunner = Boolean(fnName && typeof window[fnName] === "function");
      const hasParentRunner = Boolean(fnName && window.parent && window.parent !== window && typeof window.parent[fnName] === "function");

      if (!hasLocalRunner && !hasParentRunner) {
        if (/\/study\/grade\/elrnGradeView\.do/i.test(location.pathname) && history.length > 1) {
          history.back();
          return { navigated: true, url: location.href };
        }
        return { ready: false, reason: "lesson_runner_not_found", url: location.href, fnName };
      }

      const clickCall = hasLocalRunner ? localCall : originalCall;
      try {
        const host = hasLocalRunner ? window : window.parent;
        if (host && "contWin" in host) host.contWin = null;
      } catch (_error) {
        // Ignore stale or read-only popup handles.
      }

      let button = document.getElementById("lecture-helper-trusted-lesson-click");
      if (!button) {
        button = document.createElement("button");
        button.id = "lecture-helper-trusted-lesson-click";
        button.textContent = "LH";
        Object.assign(button.style, {
          position: "fixed",
          left: "24px",
          top: "24px",
          zIndex: 2147483647,
          width: "72px",
          height: "36px",
          opacity: "0.01",
          pointerEvents: "auto"
        });
        document.documentElement.appendChild(button);
      }
      button.setAttribute("onclick", clickCall);
      const rect = button.getBoundingClientRect();
      let x = rect.left + rect.width / 2;
      let y = rect.top + rect.height / 2;
      let win = window;
      while (win.parent && win.parent !== win) {
        try {
          const frame = win.frameElement;
          if (!frame) break;
          const frameRect = frame.getBoundingClientRect();
          x += frameRect.left;
          y += frameRect.top;
          win = win.parent;
        } catch (_error) {
          break;
        }
      }
      return { ready: true, point: { x, y }, url: location.href, fnName };
    },
    args: [onclick]
  });

  return result && result.result ? result.result : { ready: false, reason: "no_script_result" };
}

async function openLessonWithTrustedClick(sender, onclick) {
  if (!sender.tab || sender.tab.id == null || !onclick) return { popup: null, clicked: false, reason: "missing_sender_or_onclick" };

  const tabId = sender.tab.id;
  await preparePopupTracking(tabId);
  await clearPagePopupHandle(sender);

  let pointResult = await createLessonClickPoint(tabId, normalizeLessonOnclick(onclick), sender.frameId ?? null);
  if (pointResult && pointResult.navigated) {
    await waitForTabSettled(tabId);
    await Utils.sleep(1000);
    pointResult = await createLessonClickPoint(tabId, normalizeLessonOnclick(onclick), null);
  }

  if (!pointResult || !pointResult.ready || !pointResult.point) {
    return { popup: null, clicked: false, reason: pointResult?.reason || "click_point_not_ready", diagnostics: pointResult };
  }

  const clickResult = await dispatchMouseClickOnTab(tabId, pointResult.point);
  if (!clickResult.clicked) return { popup: null, clicked: false, reason: clickResult.reason || "debugger_click_failed" };

  return { popup: await detectPopup(tabId), clicked: true, diagnostics: pointResult };
}

async function clearPagePopupHandle(sender) {
  if (!sender.tab || sender.tab.id == null) return { cleared: false };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, allFrames: true },
    world: "MAIN",
    func: () => {
      let cleared = 0;
      try {
        if ("contWin" in window) {
          window.contWin = null;
          cleared += 1;
        }
      } catch (_error) {
        // Ignore pages where the handle is not writable.
      }
      try {
        if (window.parent && window.parent !== window && "contWin" in window.parent) {
          window.parent.contWin = null;
          cleared += 1;
        }
      } catch (_error) {
        // Ignore cross-frame access issues.
      }
      return cleared;
    }
  });

  return { cleared: Boolean(result && result.result) };
}

function parseOnclickArgs(onclick) {
  const call = String(onclick || "").match(/(?:return\s+)?(?:parent\.)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)/);
  if (!call) return null;

  const args = [];
  const argRegex = /'([^']*)'|"([^"]*)"|([^,\s)]+)/g;
  let match;
  while ((match = argRegex.exec(call[2])) !== null) {
    args.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return { name: call[1], args };
}

async function openLearningPopup(sender, onclick) {
  if (!sender.tab || sender.tab.id == null || !onclick) return { opened: false, reason: "missing_sender_or_onclick" };

  const parsed = parseOnclickArgs(onclick);
  if (!parsed || !["checkRtprgs", "onStartNavi"].includes(parsed.name)) {
    return { opened: false, reason: "unsupported_onclick" };
  }

  const target = { tabId: sender.tab.id };
  if (sender.frameId != null) target.frameIds = [sender.frameId];

  const [result] = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (args) => {
      const [
        cntntsYearSeCd,
        cntntsSeCd,
        lctreActplnId,
        turnId,
        sbjectId,
        cntntsAr,
        cntntsHg,
        downloadYn,
        downGubun
      ] = args;

      const hostWindow = window.parent && window.parent !== window ? window.parent : window;
      const hostDocument = hostWindow.document || document;
      const frm = hostDocument.form1 || hostDocument.querySelector("form[name='form1'], #form1");
      if (!frm) return { ok: false, reason: "form1_not_found" };

      const valueOf = (name, fallback = "") => {
        const field = frm.elements && frm.elements[name];
        return field && field.value != null ? field.value : fallback;
      };

      const mobileYn = Boolean(hostWindow.mobileYn);
      const CP_MAIN_NAVI_PATH = "/study/navi/elrnNaviNextMain.do";
      let CP_NAVI_PATH = "";
      if (mobileYn) {
        CP_NAVI_PATH = "/study/navi/mobiVideo.do";
      } else if (cntntsYearSeCd === "1") {
        CP_NAVI_PATH = "/study/navi/elrnVideo.do";
      } else {
        CP_NAVI_PATH = "/study/navi/elrnVideo.do";
      }

      if (cntntsSeCd === "2") return { ok: false, reason: "unsupported_content_type" };

      const nextTurn = turnId || valueOf("contProgInfoV", "01");
      const bottomPage = valueOf("bottomPage", "0");
      const leftPosition = valueOf("leftPosition", "0");
      let url = `${CP_NAVI_PATH}?turnId=${encodeURIComponent(nextTurn)}&bottomPage=${encodeURIComponent(bottomPage)}&leftPosition=${encodeURIComponent(leftPosition)}`;
      if (lctreActplnId) url += `&lctreActplnId=${encodeURIComponent(lctreActplnId)}`;
      if (downloadYn) url += `&downloadYn=${encodeURIComponent(downloadYn)}`;
      if (downGubun) url += `&downGubun=${encodeURIComponent(downGubun)}`;

      const titleNode = hostDocument.querySelector(".sec1 h1.tit, h1.tit");
      const sbjectNm = (titleNode ? titleNode.innerText : hostDocument.title || "").trim();
      url += `&sbjectNm=${encodeURI(encodeURIComponent(sbjectNm))}&sbjectId=${encodeURIComponent(sbjectId || "")}`;

      const width = Number(cntntsAr) || screen.availWidth || 1200;
      const height = Number(cntntsHg) || screen.availHeight || 800;
      return {
        ok: true,
        url: new URL(`${CP_MAIN_NAVI_PATH}?${url}`, location.origin).href,
        width,
        height
      };
    },
    args: [parsed.args]
  });

  const data = result && result.result;
  if (!data || !data.ok || !data.url) return { opened: false, reason: data?.reason || "url_build_failed" };

  const popup = await chrome.windows.create({
    url: data.url,
    type: "popup",
    width: Math.min(Math.max(Math.floor(data.width), 640), 1920),
    height: Math.min(Math.max(Math.floor(data.height), 480), 1080)
  });

  popupTrackers.set(sender.tab.id, {
    knownTabIds: new Set(),
    knownWindowIds: new Set(),
    popupTabId: popup.tabs && popup.tabs[0] ? popup.tabs[0].id : null,
    popupWindowId: popup.id,
    startedAt: Date.now()
  });

  return {
    opened: true,
    popup: {
      windowId: popup.id,
      tabId: popup.tabs && popup.tabs[0] ? popup.tabs[0].id : null
    }
  };
}

chrome.runtime.onInstalled.addListener(() => {
  setState(defaultState);
  allowTargetPopups();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "GET_STATE") {
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (message.type === "START") {
        await startAutomation(sender.tab || null);
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (message.type === "STOP") {
        await stopAutomation();
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (message.type === "STATUS_UPDATE") {
        sendResponse({ ok: true, state: await setState(message.patch || {}) });
        return;
      }
      if (message.type === "PREPARE_POPUP_TRACKING") {
        await preparePopupTracking(sender.tab.id);
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "WAIT_FOR_POPUP") {
        sendResponse({ ok: true, popup: await detectPopup(sender.tab.id) });
        return;
      }
      if (message.type === "CLOSE_TRACKED_POPUP") {
        sendResponse({ ok: true, result: await closeTrackedPopup(sender.tab.id) });
        return;
      }
      if (message.type === "RUN_PAGE_ONCLICK") {
        sendResponse({ ok: true, ...(await runPageOnclick(sender, message.onclick)) });
        return;
      }
      if (message.type === "CLEAR_PAGE_POPUP_HANDLE") {
        sendResponse({ ok: true, ...(await clearPagePopupHandle(sender)) });
        return;
      }
      if (message.type === "DISPATCH_MOUSE_CLICK") {
        sendResponse({ ok: true, ...(await dispatchMouseClick(sender, message.point)) });
        return;
      }
      if (message.type === "OPEN_LESSON_WITH_TRUSTED_CLICK") {
        sendResponse({ ok: true, ...(await openLessonWithTrustedClick(sender, message.onclick)) });
        return;
      }
      if (message.type === "OPEN_LEARNING_POPUP") {
        sendResponse({ ok: true, ...(await openLearningPopup(sender, message.onclick)) });
        return;
      }
      sendResponse({ ok: false, error: "unknown_message" });
    } catch (error) {
      await setState({ status: "error", running: false, lastError: error.message });
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true;
});
