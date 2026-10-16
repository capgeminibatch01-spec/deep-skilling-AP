/* =====================================================================
   Supabase client bootstrap + tiny shared helpers.
   Loaded by both index.html and admin.html.
   ===================================================================== */
window.DS = window.DS || {};

(function (DS) {
  "use strict";

  const cfg = window.DS_CONFIG || {};
  DS.BUCKET = cfg.STORAGE_BUCKET || "deep-skilling-documents";

  DS.configReady =
    !!cfg.SUPABASE_URL &&
    !!cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.startsWith("YOUR_") &&
    !cfg.SUPABASE_ANON_KEY.startsWith("YOUR_");

  DS.supabase = DS.configReady
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

  /** Content type derived from the extension, not from the browser. */
  DS.contentTypeFor = function (filename) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") return "application/pdf";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    return "application/octet-stream";
  };

  DS.extensionOf = function (filename) {
    const m = /\.([A-Za-z0-9]+)$/.exec(filename || "");
    return m ? m[1].toLowerCase() : "";
  };

  DS.formatBytes = function (bytes) {
    if (!bytes) return "0 KB";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  DS.formatDate = function (value) {
    if (!value) return "";
    // Date-only values are kept literal so a browser timezone can never
    // shift a date of birth by a day (§55).
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-");
      return `${d}-${m}-${y}`;
    }
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
  };

  DS.formatDateTime = function (value) {
    if (!value) return "";
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };

  DS.escapeHtml = function (value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  };

  DS.showBanner = function (id, message, isError) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = el.querySelector("span");
    if (text) text.textContent = message;
    el.classList.toggle("ds-banner-error", !!isError);
    el.classList.add("show");
  };

  DS.hideBanner = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("show");
  };

  /** Anything that escapes our own error mapping becomes this. */
  DS.GENERIC_ERROR =
    "Something went wrong. Please check your connection and try again.";

  /**
   * Call an Edge Function and always get the parsed JSON body back,
   * success or failure. supabase-js swallows error bodies, and we need
   * the per-field messages the server returns.
   */
  DS.callFunction = async function (name, body, accessToken) {
    const url = `${cfg.SUPABASE_URL}/functions/v1/${name}`;
    const headers = {
      "Content-Type": "application/json",
      apikey: cfg.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || cfg.SUPABASE_ANON_KEY}`,
    };

    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (networkErr) {
      console.error(`callFunction(${name}) network error:`, networkErr);
      return { ok: false, code: "NETWORK", message: DS.GENERIC_ERROR, status: 0 };
    }

    let payload = null;
    try { payload = await res.json(); } catch { /* empty or non-JSON body */ }

    if (!payload) {
      return { ok: false, code: "SERVER_ERROR", message: DS.GENERIC_ERROR, status: res.status };
    }
    return { ...payload, status: res.status };
  };
})(window.DS);
