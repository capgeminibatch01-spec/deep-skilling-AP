export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Never let a raw Postgres / storage error reach the browser (§57).
 * Known sentinel messages are translated into safe, student-friendly text.
 */
export function fail(code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ ok: false, code, message, ...extra }, status);
}

export function mapDbError(err: { message?: string } | null): {
  code: string;
  message: string;
  status: number;
  field?: string;
} {
  const raw = err?.message ?? "";

  if (raw.includes("MAINTENANCE_LOCK")) {
    return {
      code: "MAINTENANCE_LOCK",
      status: 423,
      message: "Updating registrations. Please wait...",
    };
  }
  if (raw.includes("DUPLICATE_REGISTRATION") || raw.includes("reg_identity_unique") || raw.includes("reg_email_unique")) {
    return {
      code: "DUPLICATE_REGISTRATION",
      status: 409,
      message: "This student has already been registered.",
    };
  }
  if (raw.includes("REGISTRATION_NOT_FOUND")) {
    return { code: "NOT_FOUND", status: 404, message: "That registration no longer exists." };
  }
  if (raw.includes("PLAN_STALE")) {
    return {
      code: "PLAN_STALE",
      status: 409,
      message: "The registration list changed during the operation. Nothing was deleted — please try again.",
    };
  }
  if (raw.includes("REINDEX_INVARIANT_FAILED")) {
    return {
      code: "REINDEX_FAILED",
      status: 500,
      message: "Reindexing failed its consistency check. No changes were saved.",
    };
  }
  if (raw.startsWith("VALIDATION_ERROR|") || raw.includes("VALIDATION_ERROR|")) {
    const part = raw.slice(raw.indexOf("VALIDATION_ERROR|"));
    const [, field, message] = part.split("|");
    return { code: "VALIDATION_ERROR", status: 400, field, message: message ?? "Please check the highlighted field." };
  }
  if (raw.includes("violates check constraint") || raw.includes("_chk")) {
    return {
      code: "VALIDATION_ERROR",
      status: 400,
      message: "One or more answers are not valid. Please review the form and try again.",
    };
  }

  console.error("Unmapped database error:", raw);
  return {
    code: "SERVER_ERROR",
    status: 500,
    message: "Something went wrong on our side. Please try again in a moment.",
  };
}
