import type { RunnerInput, RunnerOutput } from '@breaks/schema';
import {
  classifyOutput,
  decodeRunnerInput,
  encodeRunnerInput,
  type Implementation,
  type RunOutcome,
} from './protocol.ts';

// A convenience wrapper, not a shortcut. The reference engine and the tests run through this,
// and if it were laxer than the process path they would be measured by a different contract
// than every third-party implementation - which is the one way a reference engine can quietly
// become the oracle it is not allowed to be.

export type CaseFunction = (input: RunnerInput) => RunnerOutput | Promise<RunnerOutput>;

/**
 * Wrap an in-process ESM function in the process contract.
 *
 * The input is serialised and re-parsed, and the return value is serialised and put through
 * `classifyOutput`, exactly as a child process's stdout would be. A function returning
 * something JSON cannot carry, or something the submission schema rejects, fails here for the
 * same reason and with the same `reason` as a command that printed it.
 *
 * The timeout is honest about what it can do: an in-process function cannot be killed, so an
 * over-time call is reported as `timeout` and abandoned. It keeps running until it returns.
 * That is why the corpus is scored against spawned processes and this exists for the engine
 * and for tests.
 */
export function functionImplementation(fn: CaseFunction): Implementation {
  return async (input, options) => {
    // Serialised and parsed back, exactly as a child process would receive it: the function
    // gets the case through the same door, branding and all, not the runner's own objects.
    // A case that will not serialise is reported, not thrown, for the same reason as in the
    // process path - one broken case must not abort the corpus run.
    let request: RunnerInput;
    try {
      request = decodeRunnerInput(encodeRunnerInput(input));
    } catch (cause) {
      return {
        status: 'failed',
        reason: 'input_rejected',
        detail: cause instanceof Error ? cause.message : String(cause),
        stderr: '',
      };
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<RunOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          status: 'failed',
          reason: 'timeout',
          detail: `no result within ${String(options.timeoutMs)} ms`,
          stderr: '',
        });
      }, options.timeoutMs);
    });

    const call = (async (): Promise<RunOutcome> => {
      let result: RunnerOutput;
      try {
        result = await fn(request);
      } catch (cause) {
        return {
          status: 'failed',
          reason: 'exit_nonzero',
          detail: `implementation threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          stderr: cause instanceof Error ? (cause.stack ?? '') : '',
        };
      }

      let printed: string;
      try {
        printed = JSON.stringify(result);
      } catch (cause) {
        return {
          status: 'failed',
          reason: 'unparseable_output',
          detail: `result is not JSON-serialisable: ${cause instanceof Error ? cause.message : String(cause)}`,
          stderr: '',
        };
      }

      // JSON.stringify returns undefined for a bare undefined return value; there is no line
      // to classify, which is the in-process shape of "printed nothing".
      return classifyOutput(printed ?? '', '');
    })();

    try {
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
