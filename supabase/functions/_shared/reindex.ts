// deno-lint-ignore-file no-explicit-any
import { BUCKET } from "./constants.ts";

export interface Rename { from: string; to: string; }

type MoveOutcome = "moved" | "already-at-target" | "source-missing";

/**
 * Move one object. Idempotent: re-running a completed move is a no-op,
 * and a source that has already vanished is reported rather than thrown,
 * so a half-finished run can always be driven to completion.
 */
async function moveObject(admin: any, from: string, to: string): Promise<MoveOutcome> {
  if (from === to) return "already-at-target";

  const { error } = await admin.storage.from(BUCKET).move(from, to);
  if (!error) return "moved";

  // Did it already land at the destination (retry of a partial run)?
  const target = await headObject(admin, to);
  if (target) return "already-at-target";

  const source = await headObject(admin, from);
  if (!source) {
    console.warn(`Storage source missing, skipping move: ${from}`);
    return "source-missing";
  }

  throw new Error(`Storage move failed (${from} -> ${to}): ${error.message}`);
}

export async function headObject(admin: any, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const { data, error } = await admin.storage.from(BUCKET).list(dir, { search: name, limit: 100 });
  if (error) return false;
  return (data ?? []).some((o: any) => o.name === name);
}

/**
 * Delete a registration and renumber everything after it.
 *
 * Order matters: Storage objects are renamed FIRST, while the maintenance
 * lock is held and before any database row changes. If a rename fails we
 * undo the renames we already did and return an error — the database is
 * never touched, so DB, Storage, dashboard and Excel stay in agreement (§77).
 */
export async function deleteAndReindex(
  admin: any,
  registrationId: string,
  reason: string,
  actorId: string | null,
  opts: { lockRetries?: number; lockRetryDelayMs?: number } = {},
) {
  // ---- 1. Take the server-side maintenance lock (§30, §68) -----------
  // Admin deletions do not queue (a second admin gets a clear "busy").
  // Internal rollbacks retry, because they must always be able to finish.
  const retries = opts.lockRetries ?? 0;
  const delay = opts.lockRetryDelayMs ?? 1200;
  let acquired = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error: lockErr } = await admin.rpc("acquire_maintenance_lock", {
      p_reason: reason,
      p_user: actorId,
    });
    if (lockErr) throw lockErr;
    if (data === true) { acquired = true; break; }
    if (attempt < retries) await new Promise((r) => setTimeout(r, delay));
  }

  if (!acquired) {
    const busy: any = new Error("MAINTENANCE_BUSY");
    busy.busy = true;
    throw busy;
  }

  const completed: Rename[] = [];

  try {
    // ---- 2. Plan (read-only) ----------------------------------------
    const { data: plan, error: planErr } = await admin.rpc("compute_reindex_plan", { p_id: registrationId });
    if (planErr) throw planErr;

    const renames: Rename[] = plan.renames ?? [];

    // ---- 3. Rename Storage objects ----------------------------------
    for (const r of renames) {
      const outcome = await moveObject(admin, r.from, r.to);
      if (outcome === "moved") completed.push(r);
    }

    // ---- 4. Commit the database change in one transaction -----------
    const { data: applied, error: applyErr } = await admin.rpc("apply_delete_reindex", {
      p_id: registrationId,
      p_fingerprint: plan.fingerprint,
    });
    if (applyErr) throw applyErr;

    // ---- 5. Remove the deleted registration's own files -------------
    const targetFiles: string[] = (plan.target?.files ?? []).filter(Boolean);
    if (targetFiles.length) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(targetFiles);
      // Orphaned bytes are annoying, not corrupting — log and carry on.
      if (rmErr) console.warn("Could not remove deleted registration files:", rmErr.message);
    }

    return { plan, applied };
  } catch (err) {
    // ---- Roll every completed rename back ---------------------------
    for (const r of completed.reverse()) {
      try {
        await admin.storage.from(BUCKET).move(r.to, r.from);
      } catch (undoErr) {
        console.error("Rename rollback failed:", r, undoErr);
      }
    }
    throw err;
  } finally {
    const { error: relErr } = await admin.rpc("release_maintenance_lock");
    if (relErr) console.error("Failed to release maintenance lock:", relErr.message);
  }
}
