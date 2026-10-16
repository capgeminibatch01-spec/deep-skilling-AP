// Shared option domains + file rules.
// These mirror css/js validation on the client AND the CHECK constraints
// in schema.sql. Three layers, one source of truth per layer.

export const BUCKET = "deep-skilling-documents";
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (§48)

export const OPTIONS = {
    unique_id_type: [
    "10th Marksheet",
    "12th Marksheet",
    "Degree Marksheet",
  ],
  gender: ["Male", "Female", "Third Gender", "Prefer Not to Say"],
    beneficiary_state: ["Andhra Pradesh"],
  ews_category: ["Yes - 1", "No - 2"],
  training_centre_preference: [
    "Guntur, Andhra Pradesh",
    "Vijayawada, Andhra Pradesh",
    "Vizag, Andhra Pradesh",
  ],
  last_completed_education: [
    "1-Not completed formal education",
    "2-Completed 12th",
    "3-Diploma/ITI",
    "4-Graduation",
    "5-Post Graduation & above",
    "6-None of the above",
  ],
  degree_specialization: [
    "B.A.", "B.Sc.", "B.Com.", "B.Tech/B.E.", "BCA", "BBA",
    "M.A.", "M.Sc.", "MBA", "M.Tech", "Diploma", "ITI",
  ],
  annual_income: [
    "1-Less than 99,999",
    "2-1 to 2.99 Lakh",
    "3-3 to 4.99 Lakh",
    "4-5 to 7.99 Lakh",
    "5-Above 8 Lakh",
  ],
  occupation: [
    "1-Employed", "2-Unemployed", "3-Entrepreneur", "4-Student", "5-Unpaid work",
  ],
  institution_type: ["1-School", "2-University", "3-ITI", "4-NGO Centre", "5-None"],
    domain_course: ["Data Analytics", "Artificial Intelligence", "Cyber Security", "BFSI"],
  pwd_status: ["Yes - 1", "No - 2"],
    social_category: ["SC-1", "ST-2", "OBC-3", "Gen-4", "Others - 5"],
} as const;

export const DISTRICTS: Record<string, string[]> = {
  "Andhra Pradesh": [
    "Alluri Sitharama Raju", "Anakapalli", "Anantapur", "Annamayya",
    "Bapatla", "Chittoor", "Dr. B.R. Ambedkar Konaseema", "East Godavari",
    "Eluru", "Guntur", "Kakinada", "Krishna",
    "Kurnool", "Nandyal", "NTR", "Palnadu",
    "Parvathipuram Manyam", "Prakasam", "Sri Sathya Sai", "SPSR Nellore",
    "Srikakulam", "Tirupati", "Visakhapatnam", "Vizianagaram",
    "West Godavari", "YSR Kadapa",
  ],
};

export const ID_PROOF_PATTERNS: Record<string, { regex: RegExp; message: string }> = {
  "10th Marksheet": {
    regex: /^[A-Za-z0-9\/-]{3,25}$/,
    message: "Please enter a valid Roll Number / Register Number.",
  },
  "12th Marksheet": {
    regex: /^[A-Za-z0-9\/-]{3,25}$/,
    message: "Please enter a valid Roll Number / Register Number.",
  },
  "Degree Marksheet": {
    regex: /^[A-Za-z0-9\/-]{3,25}$/,
    message: "Please enter a valid Register Number / Marksheet Number.",
  },
};

export const DOC_KINDS = [
  "marksheet_10th", "marksheet_12th", "marksheet_degree", "marksheet_diploma_iti",
  "ews", "pwd",
] as const;
export type DocKind = typeof DOC_KINDS[number];

export const OPTIONAL_DOC_KINDS: DocKind[] = [
  "marksheet_degree", "marksheet_diploma_iti",
];

export const DOC_LABELS: Record<DocKind, string> = {
  marksheet_10th: "10th MS",
  marksheet_12th: "12th MS",
  marksheet_degree: "Degree MS",
  marksheet_diploma_iti: "Diploma/ITI MS",
  ews: "EWS Certificate",
  pwd: "PWD Certificate",
};

export const DOC_STORAGE_LABELS: Record<DocKind, string> = {
  ...DOC_LABELS,
  marksheet_diploma_iti: "Diploma-ITI MS",
};

export const PDF_ONLY_KINDS: DocKind[] = [
  "marksheet_10th", "marksheet_12th", "marksheet_degree", "marksheet_diploma_iti",
];

export const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg"];
export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg"];
export const PDF_ONLY_EXTENSIONS = ["pdf"];
export const PDF_ONLY_MIME = ["application/pdf"];
