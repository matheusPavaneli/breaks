import { spawn } from 'node:child_process';
import { runnerInputSchema, runnerOutputSchema, type RunnerInput, type RunnerOutput } from '@breaks/schema';

// SPEC.md section 5: an implementation is a process, not a module. One JSON line in on stdin,
// one JSON line out on stdout, exit 0. Everything here exists to hold that contract from the
// runner's side and to name exactly how it was broken when it was.

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Hard ceiling on what a participant may print. Untrusted output gets a bound, like any payload. */
export const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_TAIL_BYTES = 4 * 1024;

export type FailureReason =
  /** The process was still running when the per-case budget ran out. */
  | 'timeout'
  /** It finished, but not with exit 0. */
  | 'exit_nonzero'
  /** Its stdout was not JSON, or held no non-empty line at all. */
  | 'unparseable_output'
  /** Its stdout was JSON that the submission schema rejects. */
  | 'invalid_output'
  /** It printed more than the runner will read, so nothing it said can be trusted whole. */
  | 'output_too_large'
  /** It never started: no such command, not executable. */
  | 'spawn_failed'
  /**
   * The runner could not put the case on the wire at all.
   *
   * A defect in the corpus or in the runner, never in the implementation - which is why
   * `report.ts` gives it its own status rather than scoring someone zero for it.
   */
  | 'input_rejected';

export type RunOutcome =
  | { readonly status: 'ok'; readonly submission: RunnerOutput }
  | {
      readonly status: 'failed';
      readonly reason: FailureReason;
      readonly detail: string;
      readonly stderr: string;
    };

export type RunOptions = {
  readonly timeoutMs: number;
};

/**
 * Anything that can answer a case: a spawned command, or an in-process function wrapped by
 * `packages/runner/adapter.ts`. Both are handed the same input and judged by the same schema.
 */
export type Implementation = (input: RunnerInput, options: RunOptions) => Promise<RunOutcome>;

/**
 * Serialise the request the implementation receives, and prove it survives the trip.
 *
 * The round trip is not ceremony: `runnerInputSchema` transforms - Money is branded, minted
 * only by `@breaks/money` - so parsing back what we are about to write is what says the bytes
 * on the wire still mean the case that was loaded.
 */
export function encodeRunnerInput(input: RunnerInput): string {
  const line = JSON.stringify(input);
  decodeRunnerInput(line);
  return line;
}

/**
 * The request as the other side of the boundary sees it.
 *
 * The value that comes back is the *parsed* one, not the raw `JSON.parse` result: Money and
 * FxRate are branded, minted only by `@breaks/money`, and handing an implementation a plain
 * object literal that merely looks like Money would let it work with a value the factory
 * never validated.
 */
export function decodeRunnerInput(line: string): RunnerInput {
  const parsed = runnerInputSchema.safeParse(JSON.parse(line));
  if (!parsed.success) {
    throw new TypeError(
      `runner input does not survive serialisation: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function firstNonEmptyLine(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

/**
 * Turn whatever the implementation printed into an outcome.
 *
 * Split out from the spawning so the in-process adapter classifies output by the same code,
 * and so every branch here is reachable from a unit test without a child process.
 */
export function classifyOutput(stdout: string, stderr: string): RunOutcome {
  const line = firstNonEmptyLine(stdout);
  if (line === undefined) {
    return { status: 'failed', reason: 'unparseable_output', detail: 'stdout held no non-empty line', stderr };
  }

  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (cause) {
    return {
      status: 'failed',
      reason: 'unparseable_output',
      detail: `stdout is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      stderr,
    };
  }

  const parsed = runnerOutputSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const path = issue.path.map((segment) => String(segment)).join('.');
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
    return { status: 'failed', reason: 'invalid_output', detail, stderr };
  }

  return { status: 'ok', submission: parsed.data };
}

function tail(text: string, bytes: number): string {
  return text.length <= bytes ? text : text.slice(text.length - bytes);
}

/**
 * Kill the process and everything it started.
 *
 * `child.kill()` reaches the child alone; an implementation that shells out would leave its
 * own children behind, and the next case would run against a machine the previous one is
 * still using. On POSIX the child is spawned detached so it owns a process group; on Windows
 * `taskkill /T` is the only way to walk the tree.
 */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    // A ChildProcess that emits 'error' with no listener throws it as an uncaught exception,
    // which would take the runner down mid-corpus on any image without taskkill on PATH.
    // Nothing can be done about a kill that will not spawn, but it must not be fatal.
    killer.on('error', () => {});
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is already gone - the child exited between the timer firing and this call.
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Nothing left to kill.
    }
  }
}

export type ProcessImplementationOptions = {
  readonly cwd?: string;
  /**
   * The child's entire environment. Omit it to get {@link minimalEnv}; the parent's own
   * environment is never inherited by default.
   */
  readonly env?: NodeJS.ProcessEnv;
};

/**
 * The variables a submitted implementation needs to start, and nothing else.
 *
 * The runner hands a case to someone else's program, and a leaderboard runs it on CI where
 * the parent environment holds publish and repository tokens. Inheriting `process.env` would
 * put every one of them inside an untrusted process for the sake of `PATH`. A caller that
 * genuinely needs more passes `env` explicitly and owns that decision.
 */
export function minimalEnv(): NodeJS.ProcessEnv {
  const keep =
    process.platform === 'win32'
      ? ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']
      : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'];

  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Run a command as the implementation for a case.
 *
 * Network isolation is *not* attempted here: SPEC.md section 5 asks for it where the OS
 * allows, and claiming it without doing it would be worse than not claiming it. The report
 * carries `network_isolated: false` so the gap is visible rather than assumed.
 */
export function processImplementation(
  command: string,
  args: readonly string[] = [],
  options: ProcessImplementationOptions = {},
): Implementation {
  return (input, runOptions) =>
    new Promise<RunOutcome>((resolve) => {
      // Inside the executor, and caught: a case the runner cannot serialise is a corpus
      // defect, and rejecting here would abort the whole corpus run over one bad case
      // instead of reporting that case as the broken one.
      let line: string;
      try {
        line = encodeRunnerInput(input);
      } catch (cause) {
        resolve({
          status: 'failed',
          reason: 'input_rejected',
          detail: cause instanceof Error ? cause.message : String(cause),
          stderr: '',
        });
        return;
      }

      const child = spawn(command, [...args], {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: options.env ?? minimalEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let overflowed = false;
      let timedOut = false;
      let spawnError: Error | undefined;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) killTree(child.pid);
      }, runOptions.timeoutMs);

      const finish = (outcome: RunOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBytes += Buffer.byteLength(chunk, 'utf8');
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          overflowed = true;
          if (child.pid !== undefined) killTree(child.pid);
          return;
        }
        stdout += chunk;
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = tail(stderr + chunk, MAX_STDERR_TAIL_BYTES);
      });

      child.on('error', (error) => {
        spawnError = error;
      });

      // stdin closing early is normal - an implementation may read one line and stop - and it
      // surfaces as EPIPE, which must not be thrown into the runner as an unhandled error.
      child.stdin.on('error', () => {});
      child.stdin.end(`${line}\n`);

      // 'close' rather than 'exit': stdout has been fully drained by then, so a process that
      // prints and exits immediately cannot be scored on a truncated line.
      child.on('close', (code, signal) => {
        if (spawnError !== undefined) {
          finish({
            status: 'failed',
            reason: 'spawn_failed',
            detail: spawnError.message,
            stderr: tail(stderr, MAX_STDERR_TAIL_BYTES),
          });
          return;
        }

        // Overflow before timeout: the runner killed the child for flooding, and the timer
        // firing afterwards is a consequence of that kill, not the reason the run ended.
        if (overflowed) {
          finish({
            status: 'failed',
            reason: 'output_too_large',
            detail: `stdout exceeded ${String(MAX_STDOUT_BYTES)} bytes`,
            stderr: tail(stderr, MAX_STDERR_TAIL_BYTES),
          });
          return;
        }

        if (timedOut) {
          finish({
            status: 'failed',
            reason: 'timeout',
            detail: `no output within ${String(runOptions.timeoutMs)} ms`,
            stderr: tail(stderr, MAX_STDERR_TAIL_BYTES),
          });
          return;
        }

        if (code !== 0) {
          const how = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
          finish({
            status: 'failed',
            reason: 'exit_nonzero',
            detail: `implementation ended with ${how}`,
            stderr: tail(stderr, MAX_STDERR_TAIL_BYTES),
          });
          return;
        }

        finish(classifyOutput(stdout, tail(stderr, MAX_STDERR_TAIL_BYTES)));
      });
    });
}
