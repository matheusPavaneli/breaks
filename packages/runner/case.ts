import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  expectedSchema,
  policySchema,
  settlementRecordListSchema,
  type Expected,
  type Policy,
  type SettlementRecord,
} from '@breaks/schema';

// Structural, so the runner does not take a direct dependency on zod for one type name. Any
// schema from @breaks/schema satisfies it, and nothing here needs more of one than this.
type Issue = { readonly path: readonly PropertyKey[]; readonly message: string };
type ParseFailure = { readonly success: false; readonly error: { readonly issues: readonly Issue[] } };
type Parser<T> = {
  safeParse(data: unknown): { readonly success: true; readonly data: T } | ParseFailure;
};

// A case directory is untrusted input like any other file on disk, and it is untrusted in a
// specific way: it is hand-written. A malformed case file is a defect in the corpus, never in
// the implementation being scored, so it is thrown here - before any process is spawned -
// rather than folded into a score the participant would be blamed for.

const POLICY_FILE = 'policy.json';
const INPUT_A_FILE = 'input_a.json';
const INPUT_B_FILE = 'input_b.json';
const EXPECTED_FILE = 'expected.json';

export class CaseFileError extends Error {
  readonly file: string;
  /** Dotted field paths inside that file, empty when the file itself could not be read. */
  readonly paths: readonly string[];

  constructor(file: string, detail: string, paths: readonly string[], cause: unknown) {
    super(`${file}: ${detail}`, { cause });
    this.name = 'CaseFileError';
    this.file = file;
    this.paths = paths;
  }
}

export type CorpusCase = {
  /** `<category>/<slug>`, taken from the directory that holds the case. */
  readonly case_id: string;
  readonly dir: string;
  readonly policy: Policy;
  readonly records_a: readonly SettlementRecord[];
  readonly records_b: readonly SettlementRecord[];
  readonly expected: Expected;
};

/**
 * `<category>/<slug>` from the case directory.
 *
 * The id is derived rather than declared inside the case files on purpose: a second copy of
 * it would be a second source of truth, and the pair would eventually disagree after a
 * directory rename that nobody propagated.
 */
export function caseIdFromDir(dir: string): string {
  const segments = dir.split(/[\\/]/).filter((segment) => segment.length > 0 && segment !== '.');
  const tail = segments.slice(-2);
  if (tail.length === 0) {
    throw new TypeError(`case directory has no name: ${JSON.stringify(dir)}`);
  }
  return tail.join('/');
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.');
}

async function readAndParse<T>(dir: string, file: string, schema: Parser<T>): Promise<T> {
  let text: string;
  try {
    text = await readFile(join(dir, file), 'utf8');
  } catch (cause) {
    throw new CaseFileError(file, 'cannot be read', [], cause);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new CaseFileError(file, 'is not valid JSON', [], cause);
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => formatIssuePath(issue.path));
    const detail = result.error.issues
      .map((issue) => {
        const path = formatIssuePath(issue.path);
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
    throw new CaseFileError(file, `failed validation - ${detail}`, paths, result.error);
  }
  return result.data;
}

/**
 * Every id `expected.json` names has to be a record that exists on that side.
 *
 * The four files validate in isolation, and in isolation `"a": ["ch_l"]` for `ch_1` is a
 * perfectly well-formed expectation - of a record nobody can find. The case would then be
 * unwinnable by construction, every implementation would take a `missed_match` on it, and the
 * symptom would read as an engine bug rather than as the corpus typo it is.
 *
 * CLAUDE.md puts the full coherence pass in `breaks verify`, which is a later slice. This is
 * the referential half of it, and it belongs wherever a case is loaded at all.
 */
function checkExpectedIsAboutTheseRecords(
  expected: Expected,
  records_a: readonly SettlementRecord[],
  records_b: readonly SettlementRecord[],
): void {
  const sides = [
    {
      known: new Set(records_a.map((record) => record.id)),
      file: 'input_a.json',
      cited: [
        ...expected.matches.flatMap((match) => match.a.map((id) => ({ id, path: 'matches.a' }))),
        ...expected.unmatched_a.map((entry) => ({ id: entry.id, path: 'unmatched_a.id' })),
        ...expected.ambiguous.flatMap((entry) => entry.a.map((id) => ({ id, path: 'ambiguous.a' }))),
      ],
    },
    {
      known: new Set(records_b.map((record) => record.id)),
      file: 'input_b.json',
      cited: [
        ...expected.matches.flatMap((match) => match.b.map((id) => ({ id, path: 'matches.b' }))),
        ...expected.unmatched_b.map((entry) => ({ id: entry.id, path: 'unmatched_b.id' })),
        ...expected.ambiguous.flatMap((entry) =>
          entry.candidates_b.map((id) => ({ id, path: 'ambiguous.candidates_b' })),
        ),
      ],
    },
  ];

  const unknown = sides.flatMap((side) =>
    side.cited
      .filter((citation) => !side.known.has(citation.id))
      .map((citation) => ({ ...citation, file: side.file })),
  );

  if (unknown.length > 0) {
    const detail = unknown
      .map((citation) => `${citation.path} names ${JSON.stringify(citation.id)}, absent from ${citation.file}`)
      .join('; ');
    throw new CaseFileError(
      EXPECTED_FILE,
      `refers to records that do not exist - ${detail}`,
      unknown.map((citation) => citation.path),
      undefined,
    );
  }
}

/** Load and validate one corpus case directory. */
export async function loadCase(dir: string): Promise<CorpusCase> {
  const case_id = caseIdFromDir(dir);

  // Sequential, not Promise.all: the first bad file is the one worth reporting, and four
  // rejections racing each other make which one that is depend on disk timing.
  const policy = await readAndParse(dir, POLICY_FILE, policySchema);
  const records_a = await readAndParse(dir, INPUT_A_FILE, settlementRecordListSchema);
  const records_b = await readAndParse(dir, INPUT_B_FILE, settlementRecordListSchema);
  const expected = await readAndParse(dir, EXPECTED_FILE, expectedSchema);

  checkExpectedIsAboutTheseRecords(expected, records_a, records_b);

  return { case_id, dir, policy, records_a, records_b, expected };
}

/** The four files a case directory must hold, in the order `loadCase` reads them. */
export const CASE_FILES = [POLICY_FILE, INPUT_A_FILE, INPUT_B_FILE, EXPECTED_FILE] as const;
