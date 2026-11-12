import { spawn } from "node:child_process";
export async function within(work, ms, label = "TASK_DEADLINE") {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), Math.max(1, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
// Own process group only. Transport deadlines never wait indefinitely for a child.
export function runProcess(
  command,
  args,
  {
    input = "",
    cwd,
    env = process.env,
    timeoutMs = 15000,
    maxBytes = 8 * 1024 * 1024,
    signal: abortSignal,
  } = {}
) {
  if (abortSignal?.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      failure = null,
      killTimer;
    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch (e) {
        if (e.code !== "ESRCH") failure ??= e;
      }
    };
    const stop = (error) => {
      failure ??= error;
      kill("SIGTERM");
      killTimer ??= setTimeout(() => kill("SIGKILL"), 1000);
    };
    const timer = setTimeout(
      () => stop(new Error(`DEADLINE: ${command} ${timeoutMs}ms`)),
      Math.max(1, timeoutMs)
    );
    const onAbort = () => stop(new Error("CANCELLED"));
    abortSignal?.addEventListener("abort", onAbort, {once: true});
    if (abortSignal?.aborted) onAbort();
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      abortSignal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (x) => {
      stdout += x;
      if (stdout.length + stderr.length > maxBytes)
        stop(new Error("OUTPUT_LIMIT"));
    });
    child.stderr.on("data", (x) => {
      stderr += x;
      if (stdout.length + stderr.length > maxBytes)
        stop(new Error("OUTPUT_LIMIT"));
    });
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code, signal) => {
      // A leader can close before its same-group helpers finish shutdown.
      // Complete pending group escalation before cleanup cancels the timer.
      if (killTimer) kill("SIGKILL");
      cleanup();
      const record = {
        command,
        args,
        code,
        signal,
        stdout,
        stderr,
        elapsedMs: performance.now() - start,
      };
      if (failure || code !== 0) {
        const e =
          failure ?? new Error(`PROCESS_EXIT ${code}: ${stderr.slice(-500)}`);
        e.record = record;
        reject(e);
      } else resolve(record);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
