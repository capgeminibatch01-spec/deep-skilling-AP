/* =====================================================================
   Admin dashboard controller.

   Authentication is Supabase Auth. Authorization is a second, separate
   check against admin_users — enforced by RLS on every read and again
   inside the Edge Function on every write (§32, §33, §59).
   ===================================================================== */
(function (DS) {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let registrations = [];
  let pendingDelete = null;
  let deleteModal = null;
  let isDeleting = false;

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", async function () {
    deleteModal = new bootstrap.Modal($("deleteModal"));

    if (!DS.configReady) {
      showLoginError("This site is not configured yet. Please contact the technical administrator.");
      $("loginBtn").disabled = true;
      return;
    }

    wireLogin();
    wireDashboard();

    const { data } = await DS.supabase.auth.getSession();
    if (data && data.session) await enterDashboard(data.session);

    DS.supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") showLogin();
    });
  });

  /* ------------------------------------------------------------------ */
  /* Login                                                               */
  /* ------------------------------------------------------------------ */
  function wireLogin() {
    $("loginForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      DS.hideBanner("loginBanner");
      DS.clearAllErrors();

      const email = $("login_email").value.trim();
      const password = $("login_password").value;
      let bad = false;

      if (!email) { DS.setFieldError("login_email", "Please enter your email."); bad = true; }
      if (!password) { DS.setFieldError("login_password", "Please enter your password."); bad = true; }
      if (bad) return;

      setLoginBusy(true);

      const { data, error } = await DS.supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setLoginBusy(false);
        showLoginError("Incorrect email or password.");
        return;
      }

      const ok = await enterDashboard(data.session);
      if (!ok) setLoginBusy(false);
    });

    $("logoutBtn").addEventListener("click", async function () {
      await DS.supabase.auth.signOut();
      showLogin();
    });
  }

  function setLoginBusy(busy) {
    $("loginBtn").disabled = busy;
    $("loginSpinner").classList.toggle("d-none", !busy);
    $("loginLabel").textContent = busy ? "Signing in…" : "Sign in";
  }

  function showLoginError(message) {
    DS.showBanner("loginBanner", message, true);
  }

    function showLogin() {
    $("loginView").hidden = false;
    $("dashboardView").hidden = true;
    $("login_password").value = "";
    setLoginBusy(false);
    registrations = [];
  }

  /* ------------------------------------------------------------------ */
  /* Authorization gate                                                  */
  /* ------------------------------------------------------------------ */
    async function enterDashboard(session) {
    // Authentication alone is not enough — the UUID must be in admin_users.
    const { data, error } = await DS.supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error || !data) {
      await DS.supabase.auth.signOut();
      showLogin();
      showLoginError("This account is not authorised to access the admin dashboard.");
      return false;
    }
    $("loginView").hidden = true;
    $("dashboardView").hidden = false;
    $("adminEmail").textContent = session.user.email || "Admin";
    $("headerDate").textContent = new Date().toLocaleDateString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
    }).replace(/,? (\d{4})$/, ", $1");
    await loadRegistrations();
    return true;
  }
  function showPage(pageId) {
    document.querySelectorAll(".ds-admin-page").forEach((el) => el.hidden = (el.id !== pageId));
    document.querySelectorAll(".ds-admin-nav-link[data-page]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-page") === pageId);
    });
    const crumb = pageId === "dashboardPage" ? "Dashboard" : "Registrations";
    const icon = pageId === "dashboardPage" ? "bi-grid-1x2-fill" : "bi-people-fill";
    $("headerCrumb").innerHTML = `<i class="bi ${icon}"></i> ${crumb}`;
  }

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  async function loadRegistrations() {
    const { data, error } = await DS.supabase
      .from("registrations")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      // An expired session surfaces here first.
      const { data: sess } = await DS.supabase.auth.getSession();
      if (!sess || !sess.session) { showLogin(); return; }
      DS.showBanner("dashBanner", "Could not load registrations. Please refresh.", true);
      return;
    }

    registrations = data || [];
    renderStats();
    renderTable();
  }

    function renderStats() {
    const count = (course) => registrations.filter((r) => r.domain_course === course).length;
    $("statTotal").textContent = registrations.length;
    $("statDA").textContent = count("Data Analytics");
    $("statAI").textContent = count("Artificial Intelligence");
    $("statCS").textContent = count("Cyber Security");
    $("statFemale").textContent = registrations.filter((r) => r.gender === "Female").length;
    $("statMale").textContent = registrations.filter((r) => r.gender === "Male").length;
    $("statEws").textContent = registrations.filter((r) => r.ews_category === "Yes - 1").length;
    $("statPwd").textContent = registrations.filter((r) => r.pwd_status === "Yes - 1").length;
    renderRecentList();
    renderTopStates();
  }
  function renderRecentList() {
    const el = $("recentList");
    if (!el) return;
    const esc = DS.escapeHtml;
    const recent = [...registrations]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 8);
    if (!recent.length) {
      el.innerHTML = '<div class="ds-admin-recent-empty">No registrations yet.</div>';
      return;
    }
    el.innerHTML = recent.map((r) => `
      <div class="ds-admin-recent-row">
        <div class="ds-admin-recent-main">
          <span class="ds-mafoi">${esc(r.mafoi_id)}</span>
          <span class="ds-admin-recent-name">${esc(r.first_name)} ${esc(r.last_name)}</span>
        </div>
        <span class="ds-chip">${esc(r.domain_course)}</span>
        <span class="ds-admin-recent-date">${esc(DS.formatDateTime(r.created_at))}</span>
      </div>`).join("");
  }
  function renderTopStates() {
    const el = $("topStatesList");
    if (!el) return;
    const esc = DS.escapeHtml;
    const counts = {};
    registrations.forEach((r) => {
      if (!r.beneficiary_state) return;
      counts[r.beneficiary_state] = (counts[r.beneficiary_state] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!top.length) {
      el.innerHTML = '<div class="ds-admin-recent-empty">No data yet.</div>';
      return;
    }
    const max = top[0][1];
    el.innerHTML = top.map(([state, n]) => `
      <div class="ds-admin-bar-row">
        <span class="ds-admin-bar-label">${esc(state)}</span>
        <div class="ds-admin-bar-track"><div class="ds-admin-bar-fill" style="width:${Math.round((n / max) * 100)}%"></div></div>
        <span class="ds-admin-bar-value">${n}</span>
      </div>`).join("");
  }

    function populateStateFilter() {
    const select = $("stateFilter");
    const current = select.value;
    const states = [...new Set(registrations.map((r) => r.beneficiary_state).filter(Boolean))].sort();
    select.innerHTML = '<option value="">All Locations</option>' +
      states.map((s) => `<option${s === current ? " selected" : ""}>${DS.escapeHtml(s)}</option>`).join("");
  }
  function visibleRows() {
    const term = $("searchInput").value.trim().toLowerCase();
    const course = $("courseFilter").value;
    const education = $("educationFilter").value;
    const state = $("stateFilter").value;
    const trainingCentre = $("trainingCentreFilter").value;
    const date = $("dateFilter").value; // yyyy-mm-dd
    return registrations.filter((r) => {
      if (course && r.domain_course !== course) return false;
      if (education && r.last_completed_education !== education) return false;
      if (state && r.beneficiary_state !== state) return false;
      if (trainingCentre && r.training_centre_preference !== trainingCentre) return false;
      if (date && (r.created_at || "").slice(0, 10) !== date) return false;
      if (!term) return true;
      return [r.mafoi_id, r.first_name, r.last_name, r.email, r.contact_number]
        .some((v) => String(v || "").toLowerCase().includes(term));
    });
  }

    function renderTable() {
    populateStateFilter();
    $("navRegCount").textContent = registrations.length;
    const rows = visibleRows();
    const body = $("tableBody");
    const esc = DS.escapeHtml;
    if (!rows.length) {
      body.innerHTML = "";
      $("emptyState").hidden = false;
      $("emptyText").textContent = registrations.length
        ? "No registrations match your search or filter."
        : "No registrations yet.";
      $("resultCount").textContent = "0 registrations found";
      return;
    }
    $("emptyState").hidden = true;
    $("resultCount").textContent = `${rows.length} registration${rows.length === 1 ? "" : "s"} found`;

        body.innerHTML = rows.map((r) => `
      <tr>
        <td><span class="ds-mafoi">${esc(r.mafoi_id)}</span></td>
        <td>${esc(r.unique_id_type)}</td>
        <td>${esc(r.id_proof)}</td>
        <td>${esc(r.first_name)}</td>
        <td>${esc(r.last_name)}</td>
        <td>${esc(DS.formatDate(r.date_of_birth))}</td>
        <td>${esc(r.gender)}</td>
        <td>${esc(r.beneficiary_state)}</td>
        <td>${esc(r.district)}</td>
        <td>${esc(r.contact_number)}</td>
        <td>${esc(r.email)}</td>
        <td>${esc(r.ews_category)}</td>
        <td>${esc(r.training_centre_preference)}</td>
        <td>${esc(r.last_completed_education)}</td>
        <td>${esc(r.degree_specialization)}</td>
        <td>${esc(r.annual_income)}</td>
        <td>${esc(r.occupation)}</td>
        <td>${r.institution_type ? esc(r.institution_type) : '<span class="ds-help">—</span>'}</td>
        <td><span class="ds-chip">${esc(r.domain_course)}</span></td>
        <td>${esc(r.pwd_status)}</td>
        <td>${esc(r.parent_name)}</td>
        <td>${esc(r.alternative_contact_number)}</td>
        <td>${esc(r.social_category)}</td>
                <td>${esc(DS.formatDateTime(r.created_at))}</td>
        <td>${documentCell(r.marksheet_10th_document_name, r.marksheet_10th_document_path)}</td>
        <td>${documentCell(r.marksheet_12th_document_name, r.marksheet_12th_document_path)}</td>
        <td>${documentCell(r.marksheet_degree_document_name, r.marksheet_degree_document_path)}</td>
        <td>${documentCell(r.marksheet_diploma_iti_document_name, r.marksheet_diploma_iti_document_path)}</td>
        <td>${documentCell(r.ews_certificate_name, r.ews_certificate_path)}</td>
        <td>${documentCell(r.pwd_certificate_name, r.pwd_certificate_path)}</td>
        <td class="text-center">
          <button class="btn btn-ds-danger" type="button" data-delete="${esc(r.id)}"
                  title="Delete ${esc(r.mafoi_id)}" aria-label="Delete ${esc(r.mafoi_id)}">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`).join("");
  }

  /** Document name/path come straight from the database — never
   *  reconstructed. One document per cell now, instead of a single
   *  combined Documents column. */
  function documentCell(name, path) {
    const esc = DS.escapeHtml;
    if (!name || !path) return '<span class="ds-help">—</span>';

    return `
      <a class="ds-doc-link" role="button" tabindex="0"
         data-doc="${esc(path)}" data-name="${esc(name)}" title="${esc(name)}">
        <i class="bi bi-file-earmark-arrow-down"></i>${esc(name)}
      </a>`;
  }

  /* ------------------------------------------------------------------ */
  /* Interactions                                                        */
  /* ------------------------------------------------------------------ */
    function wireDashboard() {
    document.querySelectorAll(".ds-admin-nav-link[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => showPage(btn.getAttribute("data-page")));
    });
    $("searchInput").addEventListener("input", renderTable);
    $("courseFilter").addEventListener("change", renderTable);
    $("educationFilter").addEventListener("change", renderTable);
    $("stateFilter").addEventListener("change", renderTable);
    $("trainingCentreFilter").addEventListener("change", renderTable);
    $("dateFilter").addEventListener("change", renderTable);
    $("clearFiltersBtn").addEventListener("click", function () {
      $("searchInput").value = "";
      $("courseFilter").value = "";
      $("educationFilter").value = "";
      $("stateFilter").value = "";
      $("trainingCentreFilter").value = "";
      $("dateFilter").value = "";
      renderTable();
    });

    $("excelBtn").addEventListener("click", async function () {
      DS.hideBanner("dashBanner");
      // Always export the latest committed state, never the cached table.
      await loadRegistrations();

      const rows = visibleRows();       // respects the search box + course filter
      if (!rows.length) {
        DS.showBanner("dashBanner",
          registrations.length
            ? "No registrations match your current search or filter."
            : "There are no registrations to export yet.",
          true);
        return;
      }
      try {
        const filename = await DS.exportRegistrations(rows);
        DS.showBanner("dashBanner", `Downloaded ${filename}`, false);
        setTimeout(() => DS.hideBanner("dashBanner"), 5000);
      } catch (err) {
        console.error("excel export:", err);
        DS.showBanner("dashBanner", "Could not generate the Excel file. Please try again.", true);
      }
    });

    $("tableBody").addEventListener("click", onTableClick);
    $("tableBody").addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        if (event.target.closest("[data-doc]")) { event.preventDefault(); onTableClick(event); }
      }
    });

    $("confirmDeleteBtn").addEventListener("click", performDelete);
  }

  async function onTableClick(event) {
    const del = event.target.closest("[data-delete]");
    if (del) return openDeleteModal(del.getAttribute("data-delete"));

    const doc = event.target.closest("[data-doc]");
    if (doc) return openDocument(doc.getAttribute("data-doc"), doc.getAttribute("data-name"));
  }

  /** Private bucket: a short-lived signed URL, never a public URL (§37). */
  async function openDocument(path, filename) {
    DS.hideBanner("dashBanner");
    const { data, error } = await DS.supabase.storage
      .from(DS.BUCKET)
      .createSignedUrl(path, 120, { download: filename });

    if (error || !data) {
      DS.showBanner("dashBanner", "Could not open that document. It may have been moved.", true);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  function openDeleteModal(id) {
    const row = registrations.find((r) => r.id === id);
    if (!row) return;

    pendingDelete = row;
    $("delMafoi").textContent = row.mafoi_id;
    $("delName").textContent = `${row.first_name} ${row.last_name}`;
    $("delEmail").textContent = row.email;
    DS.hideBanner("modalBanner");
    setDeleteBusy(false);
    deleteModal.show();
  }

  function setDeleteBusy(busy) {
    isDeleting = busy;
    $("confirmDeleteBtn").disabled = busy;
    $("cancelDeleteBtn").disabled = busy;
    $("modalCloseX").disabled = busy;
    $("deleteSpinner").classList.toggle("d-none", !busy);
    $("deleteLabel").innerHTML = busy
      ? "Deleting…"
      : '<i class="bi bi-trash me-1"></i>Delete';
  }

  async function performDelete() {
    if (!pendingDelete || isDeleting) return;
    setDeleteBusy(true);
    DS.hideBanner("modalBanner");

    const { data: sess } = await DS.supabase.auth.getSession();
    if (!sess || !sess.session) { showLogin(); return; }

    const result = await DS.callFunction(
      "admin-delete-reindex",
      { registration_id: pendingDelete.id },
      sess.session.access_token,
    );

    if (!result.ok) {
      setDeleteBusy(false);
      if (result.code === "UNAUTHENTICATED") { showLogin(); showLoginError("Your session expired. Please sign in again."); return; }
      DS.showBanner("modalBanner", result.message || DS.GENERIC_ERROR, true);
      return;
    }

    // The function returns the post-reindex list, so the dashboard, the
    // database, the Excel export and the file names can never disagree.
    registrations = result.registrations || [];
    renderStats();
    renderTable();

    setDeleteBusy(false);
    deleteModal.hide();

    DS.showBanner("dashBanner",
      `${pendingDelete.mafoi_id} deleted. All other registration IDs are unchanged.`,
      false);
    setTimeout(() => DS.hideBanner("dashBanner"), 6000);
    pendingDelete = null;
  }
})(window.DS);
