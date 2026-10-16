import {
  ALLOWED_EXTENSIONS, ALLOWED_MIME, DISTRICTS, ID_PROOF_PATTERNS, MAX_FILE_BYTES, OPTIONS,
  PDF_ONLY_EXTENSIONS, PDF_ONLY_MIME, PDF_ONLY_KINDS,
} from "./constants.ts";

export interface FieldError { field: string; message: string; }

const DIGITS = /^[0-9]+$/;
const TEN_DIGITS = /^[0-9]{10}$/;
const GMAIL = /^[a-z0-9]+([._%+-][a-z0-9]+)*@gmail\.com$/;

/** Whole-year age on the actual birth date (§7.5). */
export function ageOn(dob: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename ?? "");
  return m ? m[1].toLowerCase() : "";
}

export function validateFileMeta(
  kind: string,
  filename: string,
  size: number,
  mime: string,
): FieldError[] {
  const errors: FieldError[] = [];
  const field = `${kind}_file`;
  const ext = extensionOf(filename);
  const pdfOnly = (PDF_ONLY_KINDS as readonly string[]).includes(kind);
  const extList = pdfOnly ? PDF_ONLY_EXTENSIONS : ALLOWED_EXTENSIONS;
  const mimeList = pdfOnly ? PDF_ONLY_MIME : ALLOWED_MIME;
  const typeLabel = pdfOnly ? "PDF" : "PDF or JPG";

  if (!filename) {
    errors.push({ field, message: "Please choose a file to upload." });
    return errors;
  }
  if (/[\\/]|\.\./.test(filename)) {
    errors.push({ field, message: "That file name is not allowed." });
  }
  if (!extList.includes(ext)) {
    errors.push({ field, message: `Please upload a ${typeLabel} file.` });
  }
  if (!mimeList.includes((mime || "").toLowerCase())) {
    errors.push({ field, message: `Please upload a ${typeLabel} file.` });
  }
  if (!Number.isFinite(size) || size <= 0) {
    errors.push({ field, message: "That file appears to be empty." });
  } else if (size > MAX_FILE_BYTES) {
    errors.push({ field, message: "File size must not exceed 10 MB." });
  }
  return errors;
}

/** Magic-byte sniff — never trust the extension or the declared MIME (§49). */
export function sniffType(head: Uint8Array): "pdf" | "jpeg" | null {
  if (head.length >= 5 &&
      head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 &&
      head[3] === 0x46 && head[4] === 0x2d) return "pdf";           // %PDF-
  if (head.length >= 3 &&
      head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  return null;
}

export function extMatchesContent(ext: string, sniffed: "pdf" | "jpeg" | null): boolean {
  if (sniffed === null) return false;
  if (ext === "pdf") return sniffed === "pdf";
  if (ext === "jpg" || ext === "jpeg") return sniffed === "jpeg";
  return false;
}

// deno-lint-ignore no-explicit-any
export function validateRegistration(d: any): FieldError[] {
  const e: FieldError[] = [];
  const str = (k: string) => (typeof d?.[k] === "string" ? d[k].trim() : "");
  const req = (k: string, msg: string) => { if (!str(k)) e.push({ field: k, message: msg }); };
  const oneOf = (k: string, list: readonly string[], msg: string) => {
    if (str(k) && !list.includes(str(k))) e.push({ field: k, message: msg });
  };

  // ---- Mobilization -------------------------------------------------
  req("unique_id_type", "Please select the type of unique ID.");
  oneOf("unique_id_type", OPTIONS.unique_id_type, "Please select a valid type of unique ID.");

    const idProof = str("id_proof");
  if (!idProof) {
    e.push({ field: "id_proof", message: "Please enter your ID number." });
  } else {
    const idTypePattern = ID_PROOF_PATTERNS[str("unique_id_type")];
    if (idTypePattern) {
      if (!idTypePattern.regex.test(idProof)) {
        e.push({ field: "id_proof", message: idTypePattern.message });
      }
    } else if (!/^[A-Za-z0-9]+$/.test(idProof)) {
      e.push({ field: "id_proof", message: "ID proof must contain only letters and numbers." });
    }
  }

  req("first_name", "Please enter your first name.");
  req("last_name", "Please enter your last name.");

  const dobRaw = str("date_of_birth");
  if (!dobRaw) {
    e.push({ field: "date_of_birth", message: "Please enter your date of birth." });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
    e.push({ field: "date_of_birth", message: "Please enter a valid date of birth." });
  } else {
    const dob = new Date(`${dobRaw}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) {
      e.push({ field: "date_of_birth", message: "Please enter a valid date of birth." });
    } else {
      const age = ageOn(dob);
      if (age < 18 || age > 36) {
        e.push({ field: "date_of_birth", message: "Beneficiary must be between 18 and 36 years of age." });
      }
    }
  }

  req("gender", "Please select your gender.");
  oneOf("gender", OPTIONS.gender, "Please select a valid gender.");

  req("beneficiary_state", "Please select your state.");
  oneOf("beneficiary_state", OPTIONS.beneficiary_state, "Please select a valid state.");

  const state = str("beneficiary_state");
  const district = str("district");
  if (!district) e.push({ field: "district", message: "Please select a district." });
  else if (!(DISTRICTS[state] ?? []).includes(district)) {
    e.push({ field: "district", message: "Please select a district that belongs to the selected state." });
  }

  const contact = str("contact_number");
  if (!contact) e.push({ field: "contact_number", message: "Please enter your contact number." });
  else if (!TEN_DIGITS.test(contact)) {
    e.push({ field: "contact_number", message: "Please enter a valid 10-digit mobile number." });
  }

  const email = typeof d?.email === "string" ? d.email : "";
  if (!email.trim()) e.push({ field: "email", message: "Please enter your email id." });
  else if (email !== email.toLowerCase() || !GMAIL.test(email)) {
    e.push({ field: "email", message: "Email must be a lowercase Gmail address (example: dhanabal@gmail.com)." });
  }

  req("ews_category", "Please answer the EWS question.");
  oneOf("ews_category", OPTIONS.ews_category, "Please select a valid EWS option.");

  req("training_centre_preference", "Please select your training centre preference.");
  oneOf("training_centre_preference", OPTIONS.training_centre_preference, "Please select a valid training centre preference.");

  // ---- Enrolment -----------------------------------------------------
  req("last_completed_education", "Please select your last completed education.");
  oneOf("last_completed_education", OPTIONS.last_completed_education, "Please select a valid education option.");

    const degree = str("degree_specialization");
  if (!degree) e.push({ field: "degree_specialization", message: "Please select your degree / specialization." });

  req("annual_income", "Please select your annual income bracket.");
  oneOf("annual_income", OPTIONS.annual_income, "Please select a valid annual income bracket.");

  req("occupation", "Please select your occupation.");
  oneOf("occupation", OPTIONS.occupation, "Please select a valid occupation.");

  const occupation = str("occupation");
  const institution = str("institution_type");
  if (occupation === "4-Student") {
    if (!institution) e.push({ field: "institution_type", message: "Please select the type of institution." });
    else if (!OPTIONS.institution_type.includes(institution as never)) {
      e.push({ field: "institution_type", message: "Please select a valid type of institution." });
    }
  } else if (institution) {
    e.push({ field: "institution_type", message: "Type of institution applies only when Occupation is 4-Student." });
  }

  req("domain_course", "Please select a domain course.");
  oneOf("domain_course", OPTIONS.domain_course, "Please select a valid domain course.");

  req("pwd_status", "Please answer the disability question.");
  oneOf("pwd_status", OPTIONS.pwd_status, "Please select a valid option.");

      const parentName = str("parent_name");
  if (!parentName) {
    e.push({ field: "parent_name", message: "Please enter the name of the parent." });
  } else {
    const parentParts = parentName.split(",").map((p: string) => p.trim()).filter(Boolean);
    if (parentParts.length < 2 || parentParts.some((p: string) => p.length < 2)) {
      e.push({
        field: "parent_name",
        message: "Please enter both father's and mother's names, separated by a comma.",
      });
    }
  }

  const alt = str("alternative_contact_number");
  if (!alt) e.push({ field: "alternative_contact_number", message: "Please enter an alternative contact number." });
  else if (!TEN_DIGITS.test(alt)) {
    e.push({ field: "alternative_contact_number", message: "Please enter a valid 10-digit mobile number." });
  }

  req("social_category", "Please select your social category.");
  oneOf("social_category", OPTIONS.social_category, "Please select a valid social category.");

  return e;
}
