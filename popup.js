const Utils = globalThis.LectureHelperUtils;

const elements = {
  status: document.getElementById("status"),
  currentTitle: document.getElementById("currentTitle"),
  completedTime: document.getElementById("completedTime"),
  totalTime: document.getElementById("totalTime"),
  remainingTime: document.getElementById("remainingTime"),
  lastError: document.getElementById("lastError"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn")
};

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function render(state) {
  const safe = state || {};
  elements.status.textContent = safe.status || "idle";
  elements.currentTitle.textContent = safe.currentTitle || "-";
  elements.completedTime.textContent = Utils.formatDuration(safe.completedTime || 0);
  elements.totalTime.textContent = Utils.formatDuration(safe.totalTime || 0);
  elements.remainingTime.textContent = Utils.formatDuration(safe.remainingTime || 0);
  elements.lastError.textContent = safe.lastError || "-";
  elements.startBtn.disabled = Boolean(safe.running);
  elements.stopBtn.disabled = !safe.running;
}

async function refresh() {
  const response = await sendMessage({ type: "GET_STATE" });
  if (response && response.ok) render(response.state);
}

elements.startBtn.addEventListener("click", async () => {
  elements.startBtn.disabled = true;
  const response = await sendMessage({ type: "START" });
  if (response && response.ok) {
    render(response.state);
  } else {
    render({ status: "error", lastError: response ? response.error : "Start failed" });
  }
});

elements.stopBtn.addEventListener("click", async () => {
  elements.stopBtn.disabled = true;
  const response = await sendMessage({ type: "STOP" });
  if (response && response.ok) render(response.state);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lectureHelperState) {
    render(changes.lectureHelperState.newValue);
  }
});

refresh();
