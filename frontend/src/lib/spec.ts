// The contract's funding rules, run in the browser so a spec is checked
// before anything is signed. Mirrors clause_core.spec_errors and
// acceptance_test_error; frontend/scripts/parity.ts holds the two to the same
// answers on tests/fixtures/spec_vectors.json.

export interface ClauseSpec {
  id: string;
  criterion: string;
  test: string;
  amount: number | bigint | string;
}

export const MAX_CLAUSES = 8;
const MAX_ID = 24;
const MIN_CRITERION = 8;
const MIN_TEST = 12;
const MAX_TEXT = 400;
export const MIN_WINDOW = 60;
export const MAX_WINDOW = 90 * 86400;

const VAGUE = new Set([
  "good", "great", "nice", "quality", "high-quality", "professional", "satisfactory",
  "appropriate", "reasonable", "excellent", "clean", "polished", "beautiful", "best",
  "acceptable", "adequate", "well", "properly", "decent", "impressive", "engaging",
]);
const ANCHORS = new Set([
  "json", "csv", "yaml", "xml", "html", "markdown", "pdf", "png", "jpg", "svg", "url", "urls",
  "link", "links", "key", "keys", "field", "fields", "column", "columns", "row", "rows",
  "section", "sections", "heading", "headings", "header", "word", "words", "line", "lines",
  "item", "items", "name", "names", "file", "files", "page", "pages", "sentence", "sentences",
  "paragraph", "paragraphs", "character", "characters", "table", "list", "image", "images",
  "language", "english", "french", "spanish", "format", "title", "email", "date", "dates",
]);

/** Python's str.isalnum is Unicode-aware; so is this. */
const isAlnum = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

function words(text: string): string[] {
  const out: string[] = [];
  let word = "";
  for (const ch of text.toLowerCase()) {
    if (isAlnum(ch) || ch === "-") word += ch;
    else {
      if (word) out.push(word);
      word = "";
    }
  }
  if (word) out.push(word);
  return out;
}

/** Python strip(): ASCII and Unicode whitespace. */
const strip = (s: string) => s.replace(/^\s+|\s+$/gu, "");
const pyLen = (s: string) => [...s].length;

export function acceptanceTestError(test: string): string {
  const text = strip(String(test));
  if (pyLen(text) < MIN_TEST) return `the acceptance test is under ${MIN_TEST} characters`;
  if (pyLen(text) > MAX_TEXT) return `the acceptance test is longer than ${MAX_TEXT} characters`;
  const ws = words(text);
  for (const w of ws) if (VAGUE.has(w)) return `the acceptance test relies on taste ('${w}')`;
  const hasDigit = /\p{Nd}/u.test(text);
  const hasQuote = (text.match(/"/g) ?? []).length >= 2 || (text.match(/'/g) ?? []).length >= 2;
  const hasAnchor = ws.some((w) => ANCHORS.has(w));
  if (!(hasDigit || hasQuote || hasAnchor))
    return "the acceptance test names nothing checkable (a number, a quoted value, or a key/section/word count)";
  return "";
}

function idError(id: string): string {
  if (id.length < 1 || id.length > MAX_ID) return `a clause id is 1-${MAX_ID} characters`;
  if (!/^[a-z0-9_-]+$/.test(id)) return "a clause id is lowercase letters, digits, - and _";
  return "";
}

/** Every reason this spec could not be funded; [] means it can. The amounts
 *  are integers in atto-GEN. */
export function specErrors(clauses: ClauseSpec[], opts: { buyer: string; seller: string; timing: Record<string, number> }): string[] {
  const errors: string[] = [];
  if (!Array.isArray(clauses) || clauses.length === 0) return ["the spec needs at least one clause"];
  if (clauses.length > MAX_CLAUSES) errors.push(`at most ${MAX_CLAUSES} clauses`);
  const seen = new Set<string>();
  clauses.forEach((c, i) => {
    const where = `clause ${i + 1}`;
    const extra = Object.keys(c).filter((k) => !["id", "criterion", "test", "amount"].includes(k));
    if (extra.length) errors.push(`${where}: unknown fields ${extra.sort().join(", ")}`);
    const id = String(c.id ?? "");
    const e = idError(id);
    if (e) errors.push(`${where}: ${e}`);
    else if (seen.has(id)) errors.push(`${where}: duplicate id '${id}'`);
    seen.add(id);
    const crit = strip(String(c.criterion ?? ""));
    if (pyLen(crit) < MIN_CRITERION || pyLen(crit) > MAX_TEXT) errors.push(`${where}: the criterion is ${MIN_CRITERION}-${MAX_TEXT} characters`);
    const t = acceptanceTestError(String(c.test ?? ""));
    if (t) errors.push(`${where} (${id}): ${t}`);
    let amount: bigint | null = null;
    try {
      amount = typeof c.amount === "bigint" ? c.amount : BigInt(String(c.amount));
    } catch {
      amount = null;
    }
    if (amount === null || amount <= 0n) errors.push(`${where}: the amount must be a positive integer`);
  });
  for (const k of ["delivery_seconds", "review_seconds", "redelivery_seconds", "ruling_seconds"]) {
    const v = opts.timing[k];
    if (!Number.isInteger(v) || v < MIN_WINDOW || v > MAX_WINDOW) errors.push(`${k} must be ${MIN_WINDOW}-${MAX_WINDOW} seconds`);
  }
  if (opts.buyer && opts.seller && opts.buyer.toLowerCase() === opts.seller.toLowerCase()) errors.push("the buyer and the seller must differ");
  return errors;
}

/** The total the buyer must send: the sum of the clause amounts. */
export function total(clauses: ClauseSpec[]): bigint {
  return clauses.reduce((a, c) => a + BigInt(String(c.amount || 0)), 0n);
}
