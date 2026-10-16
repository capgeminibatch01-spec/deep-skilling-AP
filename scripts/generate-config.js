#!/usr/bin/env node
/* ---------------------------------------------------------------------
   Writes js/config.js from environment variables at build time so that
   no credentials are ever committed to source control (§62).

   Required Vercel environment variables:
     SUPABASE_URL
     SUPABASE_ANON_KEY     (publishable / anon key ONLY)

   The service-role key must never be added to this project on Vercel.
--------------------------------------------------------------------- */
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "deep-skilling-documents";

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "\n[FATAL] SUPABASE_SERVICE_ROLE_KEY is set on this project.\n" +
    "        The service-role key must never be available to a frontend build.\n" +
    "        Remove it from the Vercel project environment and redeploy.\n",
  );
  process.exit(1);
}

if (!url || !key) {
  console.error(
    "\n[FATAL] Missing SUPABASE_URL and/or SUPABASE_ANON_KEY.\n" +
    "        Add them under Vercel → Project → Settings → Environment Variables,\n" +
    "        or copy js/config.example.js to js/config.js for local development.\n",
  );
  process.exit(1);
}

if (/service_role/i.test(key)) {
  console.error("\n[FATAL] SUPABASE_ANON_KEY looks like a service-role key. Aborting.\n");
  process.exit(1);
}

const contents = `/* Generated at build time by scripts/generate-config.js — do not edit. */
window.DS_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)},
  STORAGE_BUCKET: ${JSON.stringify(bucket)}
};
`;

const target = path.join(__dirname, "..", "js", "config.js");
fs.writeFileSync(target, contents, "utf8");
console.log(`[ok] Wrote ${path.relative(process.cwd(), target)} for ${url}`);
