import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CASE_FILES, CaseFileError, caseIdFromDir, loadCase, type CorpusCase } from './case.ts';

// A corpus root is two levels of directory - `<category>/<slug>` - because that is what
// `caseIdFromDir` reads a case id out of. Nothing deeper is searched: a third level would
// produce a case id that no longer matches the path it came from, and the id is what every
// score, leaderboard row and issue refers to.

const CASE_DEPTH = 2;
const VERSION_FILE = 'VERSION';

// A version this file will accept as a corpus version. Three numeric components, nothing
// else: the version is stamped on every published score, and "0.1" or "v0.1.0" would compare
// as a different corpus from "0.1.0" for no reason a reader could see.
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Errno values that answer "is this a case file?" with no, rather than with a failure. */
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

function errnoOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

// `isDirectory()` is false for a symlink that points at a directory - a Dirent reports the
// link, not its target - while `caseFilesPresent` below stats, which follows it. Taking the
// Dirent's word for it would drop a symlinked category or case from the corpus with no error,
// which is the one thing this file refuses to do anywhere else.
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (cause) {
    if (ABSENT.has(errnoOf(cause) ?? '')) return false;
    throw new CaseFileError(path, 'cannot be read while walking the corpus', [], cause);
  }
}

async function directoryNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  // Sequential, and in the order readdir returned: the walk has to report the same defect
  // every time it runs, and a `Promise.all` here would let disk timing pick which of two
  // broken entries raises first.
  for (const entry of entries.toSorted((left, right) => (left.name < right.name ? -1 : 1))) {
    if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(join(dir, entry.name))))) {
      names.push(entry.name);
    }
  }
  return names;
}

type CaseFile = (typeof CASE_FILES)[number];

/**
 * Which of the four case files this directory holds.
 *
 * Only ENOENT and ENOTDIR mean "not there". Every other errno - EACCES on a locked
 * directory, EIO on a failing disk - is a case this machine cannot read, not a case that
 * does not exist, and swallowing it would delete a case from the corpus silently. The
 * denominator of every score is the number of cases loaded, so a case that vanishes without
 * an error moves every number on the leaderboard.
 */
async function caseFilesPresent(dir: string): Promise<CaseFile[]> {
  const found: CaseFile[] = [];
  // Sequential, for the reason `loadCase` gives for reading its four files in order: with two
  // unreadable files, four rejections racing each other would make which one is reported
  // depend on disk timing, and a corpus defect has to look the same on every machine.
  for (const file of CASE_FILES) {
    try {
      if ((await stat(join(dir, file))).isFile()) found.push(file);
    } catch (cause) {
      if (ABSENT.has(errnoOf(cause) ?? '')) continue;
      throw new CaseFileError(file, `cannot be read in ${caseIdFromDir(dir)}`, [], cause);
    }
  }
  return found;
}

/**
 * Every case directory under a corpus root, as `<category>/<slug>` paths.
 *
 * A directory with none of the four case files is skipped: an empty category is a category
 * nobody has written cases for yet, not a broken corpus. A directory with *some* of them is
 * refused, because that is the shape a half-written or misspelled case takes - rename
 * `expected.json` and a silent skip would drop the case from the run, shift the per-case mean
 * it is averaged into, and report nothing at all.
 */
export async function findCaseDirs(root: string): Promise<string[]> {
  let dirs: string[] = [root];
  for (let depth = 0; depth < CASE_DEPTH; depth += 1) {
    const nested: string[] = [];
    for (const dir of dirs) {
      nested.push(...(await directoryNames(dir)).map((name) => join(dir, name)));
    }
    dirs = nested;
  }

  const cases: string[] = [];
  for (const dir of dirs) {
    const present = await caseFilesPresent(dir);
    if (present.length === 0) continue;
    if (present.length < CASE_FILES.length) {
      const missing = CASE_FILES.filter((file) => !present.includes(file));
      throw new CaseFileError(
        missing.join(', '),
        `missing from ${caseIdFromDir(dir)}, which holds ${present.join(', ')}`,
        [],
        undefined,
      );
    }
    cases.push(dir);
  }

  // Sorted by case id, not by the order the filesystem hands the entries back. readdir makes
  // no ordering promise, and invariant 5 is that the same corpus produces byte-identical
  // output: a report whose rows depend on inode order is not deterministic, it is lucky.
  return cases.toSorted((left, right) => (caseIdFromDir(left) < caseIdFromDir(right) ? -1 : 1));
}

// `loadCase` reports the file and the field path inside it, and it has no reason to know
// about the rest of the corpus. Over a whole root that is one identifier short: "policy.json
// failed validation" does not say which of the twelve. The error is re-raised with the case
// id in front of the file name, carrying the original as its cause, so nothing is swallowed
// and the reader gets the path they have to open.
function withCaseId(caseId: string, error: unknown): unknown {
  if (!(error instanceof CaseFileError)) return error;
  const detail = error.message.slice(`${error.file}: `.length);
  return new CaseFileError(`${caseId}/${error.file}`, detail, error.paths, error);
}

/**
 * The corpus version, from `VERSION` at the root.
 *
 * Required, not optional: CLAUDE.md versions the corpus so that an old score stays readable
 * next to the corpus it was measured on, and a run that cannot say which corpus it read
 * produces a number nobody can compare later. A root without the file is a defect in the
 * corpus, reported the same way a malformed case file is.
 */
export async function readCorpusVersion(root: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(join(root, VERSION_FILE), 'utf8');
  } catch (cause) {
    throw new CaseFileError(VERSION_FILE, 'cannot be read at the corpus root', [], cause);
  }

  const version = text.trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new CaseFileError(
      VERSION_FILE,
      `is not a three-part version: ${JSON.stringify(version)}`,
      [],
      undefined,
    );
  }
  return version;
}

export type Corpus = {
  /** From `VERSION` at the root. Every score measured on these cases is stamped with it. */
  readonly version: string;
  readonly cases: readonly CorpusCase[];
};

/**
 * Load and validate a corpus root: its version, and every case under it, ordered by case id.
 *
 * The version travels with the cases rather than being an argument the caller may forget -
 * a report that cannot say which corpus produced it is a number nobody can place next to a
 * later one.
 *
 * An empty root is refused. `findCaseDirs` only looks at `<category>/<slug>`, so a runner
 * pointed at the repository root, or one directory too deep into `corpus/`, finds nothing;
 * returning zero cases would let `buildCorpusReport` publish a scored run of zero cases at
 * `settlement_score: 0`, which reads as an implementation that failed everything rather than
 * as a path that was wrong.
 *
 * Sequential for the same reason `loadCase` reads its four files in order: the first broken
 * case is the one worth reporting, and parallel loads make which one that is depend on disk
 * timing.
 */
export async function loadCorpus(root: string): Promise<Corpus> {
  // Case directories first, then the version: a root with neither is far more likely to be a
  // wrong path than a corpus that forgot its VERSION file, and "holds no case directory" is
  // the diagnosis that sends the reader to look at the path they typed.
  const dirs = await findCaseDirs(root);

  if (dirs.length === 0) {
    throw new CaseFileError(
      root,
      'holds no case directory - a corpus root contains <category>/<slug> directories',
      [],
      undefined,
    );
  }

  const version = await readCorpusVersion(root);

  const cases: CorpusCase[] = [];
  for (const dir of dirs) {
    try {
      cases.push(await loadCase(dir));
    } catch (error) {
      throw withCaseId(caseIdFromDir(dir), error);
    }
  }
  return { version, cases };
}
