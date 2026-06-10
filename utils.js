(() => {
  const CONFIG = globalThis.LectureHelperConfig || {};

  function parseDuration(text) {
    if (!text) return null;
    const normalized = String(text).replace(/\s+/g, " ").trim();

    const colon = normalized.match(/\b(\d{1,3})(?::(\d{2}))(?::(\d{2}))?\b/);
    if (colon) {
      const first = Number(colon[1]);
      const second = Number(colon[2]);
      const third = colon[3] == null ? null : Number(colon[3]);
      if (third == null) return first * 60 + second;
      return first * 3600 + second * 60 + third;
    }

    const hours = normalized.match(/(\d+)\s*\uC2DC\uAC04/);
    const minutes = normalized.match(/(\d+)\s*\uBD84/);
    const seconds = normalized.match(/(\d+)\s*\uCD08/);
    if (hours || minutes || seconds) {
      return (hours ? Number(hours[1]) * 3600 : 0)
        + (minutes ? Number(minutes[1]) * 60 : 0)
        + (seconds ? Number(seconds[1]) : 0);
    }

    return null;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    const two = (value) => String(value).padStart(2, "0");
    return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
  }

  function computeRemainingTime(completed, total) {
    return Math.max(0, Math.floor((Number(total) || 0) - (Number(completed) || 0)));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isTargetUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const hostAllowed = (CONFIG.TARGET_HOSTS || []).some((host) => {
        return parsed.hostname === host || parsed.hostname.endsWith(`.${host}`);
      });
      const urlAllowed = (CONFIG.URL_MATCH || []).some((pattern) => pattern.test(url));
      return hostAllowed && urlAllowed;
    } catch (_error) {
      return false;
    }
  }

  function extractDurationCandidates(text) {
    const found = [];
    for (const regex of CONFIG.TIME_REGEXES || []) {
      regex.lastIndex = 0;
      const matches = String(text || "").match(regex) || [];
      for (const match of matches) {
        const seconds = parseDuration(match);
        if (seconds != null) found.push({ text: match, seconds });
      }
    }
    return found;
  }

  globalThis.LectureHelperUtils = {
    parseDuration,
    formatDuration,
    computeRemainingTime,
    sleep,
    isTargetUrl,
    extractDurationCandidates
  };
})();
