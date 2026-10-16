/* =====================================================================
   XLSX export (§38, §39, §56, §69).

   Every column is written with an explicit cell type so Excel cannot
   reinterpret a Ma Foi ID, an ID number or a mobile number as a number
   and drop leading characters or zeros.

   Document name columns are exported as real Excel hyperlinks (backed
   by short-lived signed URLs from the private bucket, generated at
   export time) so the admin can click straight through to the file
   instead of seeing plain, unclickable text.
   ===================================================================== */
(function (DS) {
  "use strict";

  // Signed links live for 7 days — long enough for the exported file to
  // stay useful, short enough to respect the private bucket (§37).
  const LINK_EXPIRY_SECONDS = 60 * 60 * 24 * 7;

  // [header, accessor, type, pathAccessor?]
  //   type: "s" = text, "d" = date, "dt" = datetime, "link" = hyperlink
  //   pathAccessor is only present for "link" columns — it returns the
  //   storage path used to generate the signed URL.
  const COLUMNS = [
    ["Ma Foi ID",                          (r) => r.mafoi_id,                   "s"],
    ["Type of unique ID",                  (r) => r.unique_id_type,             "s"],
    ["Id proof",                           (r) => r.id_proof,                   "s"],
    ["First Name",                         (r) => r.first_name,                 "s"],
    ["Last Name",                          (r) => r.last_name,                  "s"],
    ["Date of Birth",                      (r) => r.date_of_birth,              "d"],
    ["Gender",                             (r) => r.gender,                     "s"],
    ["Current State of Living",               (r) => r.beneficiary_state,          "s"],
    ["District (Current)",                 (r) => r.district,                   "s"],
    ["Contact number",                     (r) => r.contact_number,             "s"],
    ["Email id",                           (r) => r.email,                      "s"],
    ["Do you belong to EWS category?",     (r) => r.ews_category,               "s"],
    ["Training Centre Preference",         (r) => r.training_centre_preference, "s"],
    ["Last Completed Education",           (r) => r.last_completed_education,   "s"],
    ["Degree / Specialization",            (r) => r.degree_specialization,      "s"],
    ["10th Marksheet",                     (r) => r.marksheet_10th_document_name || "",        "link", (r) => r.marksheet_10th_document_path],
    ["12th Marksheet",                     (r) => r.marksheet_12th_document_name || "",        "link", (r) => r.marksheet_12th_document_path],
    ["Degree Marksheet",                   (r) => r.marksheet_degree_document_name || "",      "link", (r) => r.marksheet_degree_document_path],
    ["Diploma or ITI Marksheet",           (r) => r.marksheet_diploma_iti_document_name || "", "link", (r) => r.marksheet_diploma_iti_document_path],
    ["Annual income",                      (r) => r.annual_income,              "s"],
    ["Occupation",                         (r) => r.occupation,                 "s"],
    ["If Student, Type of Institution",    (r) => r.institution_type || "",     "s"],
    ["EWS Certification",                  (r) => r.ews_certificate_name,       "link", (r) => r.ews_certificate_path],
    ["Domain course",                      (r) => r.domain_course,              "s"],
    ["Are you a person with Disability?",  (r) => r.pwd_status,                 "s"],
    ["PWD Certificate",                    (r) => r.pwd_certificate_name || "", "link", (r) => r.pwd_certificate_path],
    ["Name of parent",                     (r) => r.parent_name,                "s"],
    ["Alternative Contact Number",         (r) => r.alternative_contact_number, "s"],
    ["Social Category",                    (r) => r.social_category,            "s"],
    ["Created Date",                       (r) => r.created_at,                 "dt"],
  ];

  /** Excel serial = days since 1899-12-30. Written as a typed number so
   *  every Excel/LibreOffice build renders a real date, not a string. */
  function toSerial(ms) { return ms / 86400000 + 25569; }

  function dateCell(value) {
    if (!value) return { t: "s", v: "" };

    // Date-only: pinned to UTC midnight so no timezone can shift a DOB.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return { t: "n", v: Math.round(toSerial(Date.UTC(y, m - 1, d))), z: "dd-mmm-yyyy" };
    }

    const dt = new Date(value);
    if (isNaN(dt.getTime())) return { t: "s", v: String(value) };
    // Timestamps are shown in the admin's local time, matching the table.
    const localMs = dt.getTime() - dt.getTimezoneOffset() * 60000;
    return { t: "n", v: toSerial(localMs), z: "dd-mmm-yyyy hh:mm" };
  }

  /** One signed URL per distinct storage path, fetched in parallel. The
   *  `download` option forces the browser to save using the renamed
   *  filename (Content-Disposition), never the original uploaded name. */
  async function signUrlsFor(pathNamePairs) {
    const uniqueByPath = new Map();
    pathNamePairs.forEach(([path, name]) => {
      if (path && !uniqueByPath.has(path)) uniqueByPath.set(path, name);
    });
    const map = new Map();

    await Promise.all([...uniqueByPath.entries()].map(async ([path, name]) => {
      try {
        const { data, error } = await DS.supabase.storage
          .from(DS.BUCKET)
          .createSignedUrl(path, LINK_EXPIRY_SECONDS, { download: name || true });
        if (!error && data) map.set(path, data.signedUrl);
      } catch (err) {
        console.error("excel signed url:", path, err);
      }
    }));

    return map;
  }

  DS.exportRegistrations = async function (rows) {
    const sheet = {};
    const range = { s: { c: 0, r: 0 }, e: { c: COLUMNS.length - 1, r: rows.length } };

    // header row
    COLUMNS.forEach((col, c) => {
      sheet[XLSX.utils.encode_cell({ c, r: 0 })] = { t: "s", v: col[0] };
    });

    // data rows: oldest registration first (serial_no is now per-centre,
    // so it can no longer be used as a global order)
    const ordered = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Gather every document (path, download name) pair across every row up
    // front, then sign them all in parallel instead of one round trip per cell.
    const linkColumns = COLUMNS.filter((col) => col[2] === "link");
    const allPathNamePairs = ordered.flatMap((row) =>
      linkColumns.map((col) => [col[3](row), col[1](row)]));
    const urlMap = await signUrlsFor(allPathNamePairs);

    ordered.forEach((row, i) => {
      COLUMNS.forEach((col, c) => {
        const raw = col[1](row);
        const addr = XLSX.utils.encode_cell({ c, r: i + 1 });

        if (col[2] === "link") {
          const path = col[3](row);
          const url = path ? urlMap.get(path) : null;
          const label = raw == null ? "" : String(raw);
          sheet[addr] = url
            ? { t: "s", v: label, l: { Target: url, Tooltip: "Click to download" } }
            : { t: "s", v: label };
          return;
        }

        sheet[addr] = col[2] === "d" || col[2] === "dt"
          ? dateCell(raw)
          : { t: "s", v: raw == null ? "" : String(raw) };
      });
    });

    sheet["!ref"] = XLSX.utils.encode_range(range);
    sheet["!cols"] = COLUMNS.map((col) => ({
      wch: Math.min(Math.max(col[0].length + 4, 14), 42),
    }));
    sheet["!autofilter"] = { ref: sheet["!ref"] };

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Registrations");

    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const filename =
      `Deep_Skilling_Training_Registrations_${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.xlsx`;

    XLSX.writeFile(book, filename, { compression: true });
    return filename;
  };
})(window.DS);