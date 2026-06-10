importScripts("config.js", "utils.js");

const CONFIG = globalThis.LectureHelperConfig;
const Utils = globalThis.LectureHelperUtils;
const STATE_KEY = "lectureHelperState";

const defaultState = {
  status: "idle",
  running: false,
  tabId: null,
  currentTitle: "",
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
      const rowsFromList = Array.from(document.querySelectorAll(".study_group .list_area .list_clear, .list_area .list_clear, .list_clear"))
        .filter((row) => row.querySelector(".subject a") && row.querySelector(".progress, .current, .total"));
      const rowsFromTime = Array.from(document.querySelectorAll(".progress .current, .progress .total, span.current, span.total, [class*='current'], [class*='total']"))
        .map((node) => node.closest(".list_clear"))
        .filter((row) => row && row.querySelector(".subject a"));
      const rows = Array.from(new Set([...rowsFromList, ...rowsFromTime]));
      const text = document.body ? document.body.innerText || "" : "";
      const progressCount = document.querySelectorAll(".progress").length;
      const currentCount = document.querySelectorAll(".current, [class*='current']").length;
      const totalCount = document.querySelectorAll(".total, [class*='total']").length;
      return {
        rowCount: rows.length,
        score: rows.length * 100 + progressCount * 10 + currentCount * 10 + totalCount * 10 + (/00:\d{2}:\d{2}|보고듣고말하기/.test(text) ? 1 : 0),
        title: rows[0]?.querySelector(".subject a")?.innerText?.trim() || "",
        url: location.href,
        diagnostics: {
          listClear: document.querySelectorAll(".list_clear").length,
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

async function startAutomation() {
  const tab = await getActiveTab();
  if (!tab || !Utils.isTargetUrl(tab.url)) {
    const allowed = CONFIG.TARGET_HOSTS.join(", ");
    throw new Error(`대상 강의 목록 페이지가 아닙니다. 허용 도메인: ${allowed}`);
  }

  await ensureContentScripts(tab.id);
  const lectureFrame = await findLectureFrame(tab.id);
  await setState({
    status: "running",
    running: true,
    tabId: tab.id,
    currentTitle: "",
    completedTime: 0,
    totalTime: 0,
    remainingTime: 0,
    lastError: ""
  });

  if (lectureFrame && lectureFrame.frameId != null) {
    await chrome.tabs.sendMessage(
      tab.id,
      { type: "START_AUTOMATION" },
      { frameId: lectureFrame.frameId }
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
      popupTrackers.set(senderTabId, tracker);
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
      owner[fnName](...args);
      return true;
    },
    args: [onclick]
  });

  return { executed: Boolean(result && result.result) };
}

chrome.runtime.onInstalled.addListener(() => {
  setState(defaultState);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "GET_STATE") {
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (message.type === "START") {
        await startAutomation();
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
      sendResponse({ ok: false, error: "unknown_message" });
    } catch (error) {
      await setState({ status: "error", running: false, lastError: error.message });
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true;
});
