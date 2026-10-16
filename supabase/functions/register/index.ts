// deno-lint-ignore-file no-explicit-any
// =====================================================================
//  POST /functions/v1/register
//
//  { action: "upload-slots", files: [{kind, filename, size, type}] }
//      -> signed upload URLs into a private staging folder
//
//  { action: "submit", staging_id, files: {...}, data: {...} }
//      -> validates everything server-side, atomically allocates the
//         Ma Foi ID, moves the staged files to their final renamed
//         location, and returns the assigned ID.
//
//  Deploy with:  supabase functions deploy register --no-verify-jwt
//  (auth is not required for public registration; every input is
//   validated here and the service-role key never leaves the server.)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { BUCKET, DOC_KINDS, DOC_STORAGE_LABELS, MAX_FILE_BYTES, OPTIONAL_DOC_KINDS, type DocKind } from "../_shared/constants.ts";
import { corsHeaders, fail, json, mapDbError } from "../_shared/http.ts";
import {
  extensionOf,
  extMatchesContent,
  type FieldError,
  sniffType,
  validateFileMeta,
  validateRegistration,
} from "../_shared/validation.ts";
import { deleteAndReindex } from "../_shared/reindex.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STAGING_PREFIX = "staging";
const isUuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", "Malformed request.", 400);
  }

  try {
    if (body?.action === "upload-slots") return await uploadSlots(body);
    if (body?.action === "submit") return await submit(body);
    return fail("BAD_REQUEST", "Unknown action.", 400);
  } catch (err) {
    console.error("register:", err);
    return fail("SERVER_ERROR", "Something went wrong on our side. Please try again in a moment.", 500);
  }
});

// ---------------------------------------------------------------------
//  Is the site currently locked for reindexing?
// ---------------------------------------------------------------------
async function assertOpen(): Promise<Response | null> {
  const { data, error } = await admin.rpc("registration_status");
  if (error) {
    console.error("registration_status:", error.message);
    return fail("SERVER_ERROR", "Registration is temporarily unavailable. Please try again shortly.", 503);
  }
  if (data?.is_locked) {
    return fail("MAINTENANCE_LOCK", "Updating registrations. Please wait...", 423);
  }
  return null;
}

// ---------------------------------------------------------------------
//  ACTION 1 — signed upload slots
// ---------------------------------------------------------------------
async function uploadSlots(body: any): Promise<Response> {
  const closed = await assertOpen();
  if (closed) return closed;

  const files = Array.isArray(body?.files) ? body.files : [];
  if (!files.length || files.length > DOC_KINDS.length) {
    return fail("BAD_REQUEST", "Unexpected number of documents.", 400);
  }

  const errors: FieldError[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!DOC_KINDS.includes(f?.kind)) return fail("BAD_REQUEST", "Unknown document type.", 400);
    if (seen.has(f.kind)) return fail("BAD_REQUEST", "Duplicate document type.", 400);
    seen.add(f.kind);
    errors.push(...validateFileMeta(f.kind, String(f?.filename ?? ""), Number(f?.size), String(f?.type ?? "")));
  }
  if (errors.length) return json({ ok: false, code: "VALIDATION_ERROR", errors }, 400);

  const stagingId = crypto.randomUUID();
  const slots: Record<string, { path: string; token: string }> = {};

  for (const f of files) {
    // The SERVER builds the path. Nothing from the browser is used (§49).
    const ext = extensionOf(String(f.filename));
    const path = `${STAGING_PREFIX}/${stagingId}/${f.kind}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) {
      console.error("createSignedUploadUrl:", error.message);
      return fail("UPLOAD_FAILED", "Could not prepare the file upload. Please try again.", 500);
    }
    slots[f.kind] = { path, token: data.token };
  }

  return json({ ok: true, staging_id: stagingId, slots });
}

// ---------------------------------------------------------------------
//  ACTION 2 — submit
// ---------------------------------------------------------------------
async function submit(body: any): Promise<Response> {
  const closed = await assertOpen();
  if (closed) return closed;

  const stagingId = body?.staging_id;
  if (!isUuid(stagingId)) return fail("BAD_REQUEST", "Invalid upload session.", 400);

  const data = body?.data ?? {};

  // ---- 1. Field validation ------------------------------------------
  const errors = validateRegistration(data);
  if (errors.length) return json({ ok: false, code: "VALIDATION_ERROR", errors }, 400);

  // ---- 2. Which documents must exist? --------------------------------
          const requiredKinds: DocKind[] = ["ews", "marksheet_10th", "marksheet_12th"];
  if (data.pwd_status === "Yes - 1") requiredKinds.push("pwd");
  const optionalKinds: DocKind[] = [...OPTIONAL_DOC_KINDS];
  // The four Supporting Documents (10th/12th/Degree/Diploma-ITI marksheets)
  // are optional — validate them below only if the student attached one.

  // ---- 3. Inspect what was actually staged ---------------------------
  const { data: staged, error: listErr } = await admin.storage
    .from(BUCKET).list(`${STAGING_PREFIX}/${stagingId}`, { limit: 20 });
  if (listErr) {
    console.error("list staging:", listErr.message);
    return fail("UPLOAD_FAILED", "We could not read your uploaded files. Please try again.", 500);
  }

  const stagedByKind = new Map<string, { path: string; ext: string; size: number; mime: string }>();
  for (const obj of staged ?? []) {
    const kind = obj.name.split(".")[0];
    if (!DOC_KINDS.includes(kind as DocKind)) continue;
    stagedByKind.set(kind, {
      path: `${STAGING_PREFIX}/${stagingId}/${obj.name}`,
      ext: extensionOf(obj.name),
      size: Number(obj.metadata?.size ?? 0),
      mime: String(obj.metadata?.mimetype ?? ""),
    });
  }

  const fileErrors: FieldError[] = [];

  for (const kind of requiredKinds) {
    const s = stagedByKind.get(kind);
    if (!s) {
      fileErrors.push({ field: `${kind}_file`, message: "Please upload this document." });
      continue;
    }
    fileErrors.push(...validateFileMeta(kind, `x.${s.ext}`, s.size, s.mime));
    if (s.size > MAX_FILE_BYTES) {
      fileErrors.push({ field: `${kind}_file`, message: "File size must not exceed 10 MB." });
    }
  }

  for (const kind of optionalKinds) {
    const s = stagedByKind.get(kind);
    if (!s) continue;
    fileErrors.push(...validateFileMeta(kind, `x.${s.ext}`, s.size, s.mime));
    if (s.size > MAX_FILE_BYTES) {
      fileErrors.push({ field: `${kind}_file`, message: "File size must not exceed 10 MB." });
    }
  }

  // Optional documents are validated only when the student attached one.
  for (const kind of optionalKinds) {
    const s = stagedByKind.get(kind);
    if (!s) continue;
    fileErrors.push(...validateFileMeta(kind, `x.${s.ext}`, s.size, s.mime));
    if (s.size > MAX_FILE_BYTES) {
      fileErrors.push({ field: `${kind}_file`, message: "File size must not exceed 10 MB." });
    }
  }

  // Degree Marksheet and Diploma/ITI Marksheet are alternatives — each is
  // individually optional, but at least one of the two must be present.
  // 10th and 12th Marksheet requirements are untouched by this rule.
  const DEGREE_DIPLOMA_MSG = "Please upload at least one: Degree Marksheet or Diploma or ITI Marksheet.";
  if (!stagedByKind.has("marksheet_degree") && !stagedByKind.has("marksheet_diploma_iti")) {
    fileErrors.push({ field: "marksheet_degree_file", message: DEGREE_DIPLOMA_MSG });
    fileErrors.push({ field: "marksheet_diploma_iti_file", message: DEGREE_DIPLOMA_MSG });
  }

    // A PWD certificate must not survive a "No - 2" answer (§15).
  if (data.pwd_status === "No - 2" && stagedByKind.has("pwd")) {
    await admin.storage.from(BUCKET).remove([stagedByKind.get("pwd")!.path]);
    stagedByKind.delete("pwd");
  }

  if (fileErrors.length) {
    await purgeStaging(stagingId);
    return json({ ok: false, code: "VALIDATION_ERROR", errors: fileErrors }, 400);
  }

  // ---- 4. Magic-byte check on every file -----------------------------
  for (const kind of [...requiredKinds, ...optionalKinds.filter((k) => stagedByKind.has(k))]) {
    const s = stagedByKind.get(kind)!;
    const sniffed = await sniffStored(s.path);
    if (!extMatchesContent(s.ext, sniffed)) {
      await purgeStaging(stagingId);
      const typeLabel = (DOC_STORAGE_LABELS as Record<string, string>)[kind]?.includes("MS") ? "PDF" : "PDF or JPG";
      return json({
        ok: false,
        code: "VALIDATION_ERROR",
        errors: [{ field: `${kind}_file`, message: `Please upload a genuine ${typeLabel} file.` }],
      }, 400);
    }
  }

  // ---- 5. Atomic insert + Ma Foi ID allocation -----------------------
  const payload = {
    unique_id_type: str(data.unique_id_type),
    id_proof: str(data.id_proof),
    first_name: str(data.first_name),
    last_name: str(data.last_name),
    date_of_birth: str(data.date_of_birth),
    gender: str(data.gender),
    beneficiary_state: str(data.beneficiary_state),
    district: str(data.district),
    contact_number: str(data.contact_number),
    email: String(data.email ?? "").trim(),
    ews_category: str(data.ews_category),
    training_centre_preference: str(data.training_centre_preference),
    last_completed_education: str(data.last_completed_education),
    degree_specialization: str(data.degree_specialization),
    annual_income: str(data.annual_income),
    occupation: str(data.occupation),
    institution_type: str(data.occupation) === "4-Student" ? str(data.institution_type) : "",
    domain_course: str(data.domain_course),
    pwd_status: str(data.pwd_status),
    parent_name: str(data.parent_name),
    alternative_contact_number: str(data.alternative_contact_number),
    social_category: str(data.social_category),
        marksheet_10th_ext:        stagedByKind.get("marksheet_10th")?.ext ?? "",
    marksheet_12th_ext:        stagedByKind.get("marksheet_12th")?.ext ?? "",
    marksheet_degree_ext:      stagedByKind.get("marksheet_degree")?.ext ?? "",
    marksheet_diploma_iti_ext: stagedByKind.get("marksheet_diploma_iti")?.ext ?? "",
    ews_ext: stagedByKind.get("ews")!.ext,
    pwd_ext: stagedByKind.get("pwd")?.ext ?? "",
  };

  const { data: created, error: createErr } = await admin.rpc("create_registration", { p: payload });
  if (createErr) {
    await purgeStaging(stagingId);
    const mapped = mapDbError(createErr);
    return json(
      { ok: false, code: mapped.code, message: mapped.message,
        errors: mapped.field ? [{ field: mapped.field, message: mapped.message }] : undefined },
      mapped.status,
    );
  }

  // ---- 6. Move staged files to their final, renamed home -------------
  const moves: { from: string; to: string }[] = [];
  for (const kind of DOC_KINDS) {
    const doc = created.documents?.[kind];
    const staged = stagedByKind.get(kind);
    if (!doc || !staged) continue;
    moves.push({ from: staged.path, to: doc.path });
  }

  const done: { from: string; to: string }[] = [];
  try {
    for (const m of moves) {
      const { error } = await admin.storage.from(BUCKET).move(m.from, m.to);
      if (error) throw new Error(`move failed: ${error.message}`);
      done.push(m);
    }
  } catch (moveErr) {
    console.error("Final rename failed, rolling registration back:", moveErr);
    // Put the files back where they were, then undo the database row so
    // no half-named registration survives (§47).
    for (const m of done.reverse()) {
      await admin.storage.from(BUCKET).move(m.to, m.from).catch(() => {});
    }
    try {
      await deleteAndReindex(admin, created.id, "registration rollback", null, {
        lockRetries: 5, lockRetryDelayMs: 1000,
      });
    } catch (rbErr) {
      console.error("CRITICAL: rollback failed for registration", created.id, rbErr);
    }
    await purgeStaging(stagingId);
    return fail("UPLOAD_FAILED",
      "Your documents could not be saved, so the registration was cancelled. Please try again.", 500);
  }

  await purgeStaging(stagingId);

  return json({
    ok: true,
    mafoi_id: created.mafoi_id,
    serial_no: created.serial_no,
    documents: created.documents,
  });
}

// ---------------------------------------------------------------------
//  helpers
// ---------------------------------------------------------------------
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function sniffStored(path: string): Promise<"pdf" | "jpeg" | null> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-63" } });
  if (!res.ok && res.status !== 206) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return sniffType(buf.subarray(0, 16));
}

async function purgeStaging(stagingId: string) {
  const { data } = await admin.storage.from(BUCKET).list(`${STAGING_PREFIX}/${stagingId}`, { limit: 50 });
  const paths = (data ?? []).map((o: any) => `${STAGING_PREFIX}/${stagingId}/${o.name}`);
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
}
