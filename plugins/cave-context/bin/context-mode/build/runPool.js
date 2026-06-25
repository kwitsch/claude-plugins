/**
 * Generic in-flight-capped worker pool.
 *
 * Used by:
 *   - runBatchCommands (ctx_batch_execute parallel branch)
 *   - runBatchFetch    (ctx_fetch_and_index batch path)
 *
 * Returns Promise.allSettled-style results so one job's throw cannot
 * strand siblings. Caller maps fulfilled/rejected per index. Output
 * order is preserved by input index (not completion order).
 *
 * Designed to be the SINGLE concurrency primitive for the project —
 * all "run N independent operations with at most M in flight" needs
 * route here. Avoids the worker-pool copy-paste flagged in the
 * concurrency PRD architectural review (finding G).
 */
import { cpus } from "node:os";
export async function runPool(jobs, opts) {
    const { concurrency, capByCpuCount = false, onSettled } = opts;
    if (jobs.length === 0) {
        return { settled: [], effectiveConcurrency: 0, capped: false };
    }
    const requested = Math.max(1, concurrency);
    const cpuCap = capByCpuCount ? Math.max(1, cpus().length) : requested;
    const effectiveConcurrency = Math.min(requested, cpuCap, jobs.length);
    const capped = effectiveConcurrency < requested;
    const settled = new Array(jobs.length);
    let nextIdx = 0;
    async function worker() {
        while (true) {
            const idx = nextIdx++;
            if (idx >= jobs.length)
                return;
            try {
                const value = await jobs[idx].run();
                settled[idx] = { status: "fulfilled", value };
            }
            catch (err) {
                settled[idx] = { status: "rejected", reason: err };
            }
            onSettled?.(idx, settled[idx]);
        }
    }
    const workers = [];
    for (let w = 0; w < effectiveConcurrency; w++)
        workers.push(worker());
    // allSettled defends against any promise rejection escaping a worker
    // (the worker already swallows its own errors, but this is belt-and-braces).
    await Promise.allSettled(workers);
    return { settled, effectiveConcurrency, capped };
}
