// deno-lint-ignore-file no-explicit-any
// =====================================================================
//  POST /functions/v1/admin-delete-reindex   { registration_id }
//
//  Deletes one registration and its Storage files — admin-only. Other
//  registrations keep their centre codes (AP-VWD-001 …); nothing is renumbered.
//
//  Deploy with: supabase functions deploy admin-delete-reindex --no-verify-jwt
//  (the caller's JWT is verified explicitly below, which works with both
//   legacy anon keys and the newer publishable key format.)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, fail, json, mapDbError } from "../_shared/http.ts";
import { deleteAndReindex } from "../_shared/reindex.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const isUuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);

  // ---- 1. Authentication ---------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return fail("UNAUTHENTICATED", "Please sign in again.", 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return fail("UNAUTHENTICATED", "Your session has expired. Please sign in again.", 401);

  // ---- 2. Authorization (§33) ----------------------------------------
  const { data: isAdmin, error: adminErr } = await admin.rpc("is_admin", { p_uid: user.id });
  if (adminErr) {
    console.error("is_admin:", adminErr.message);
    return fail("SERVER_ERROR", "Could not verify your access. Please try again.", 500);
  }
  if (isAdmin !== true) return fail("FORBIDDEN", "You are not authorised to perform this action.", 403);

  // ---- 3. Input -------------------------------------------------------
  let body: any;
  try { body = await req.json(); } catch { return fail("BAD_REQUEST", "Malformed request.", 400); }

  const registrationId = body?.registration_id;
  if (!isUuid(registrationId)) return fail("BAD_REQUEST", "Invalid registration reference.", 400);

  // ---- 4. Delete + reindex -------------------------------------------
  try {
    const result = await deleteAndReindex(
      admin,
      registrationId,
      `admin delete by ${user.email ?? user.id}`,
      user.id,
    );

    const { data: rows, error: listErr } = await admin
      .from("registrations")
      .select("*")
      .order("created_at", { ascending: true });

    if (listErr) console.error("post-delete list:", listErr.message);

    return json({
      ok: true,
      deleted: result.plan?.target ?? null,
      reindexed: result.applied?.reindexed ?? 0,
      remaining: result.applied?.remaining ?? rows?.length ?? 0,
      registrations: rows ?? [],
    });
  } catch (err: any) {
    if (err?.busy) {
      return fail("MAINTENANCE_BUSY",
        "Another maintenance operation is already running. Please wait for it to finish.", 409);
    }
    const mapped = mapDbError(err);
    if (mapped.code === "SERVER_ERROR") console.error("admin-delete-reindex:", err);
    return fail(mapped.code, mapped.message, mapped.status);
  }
});
