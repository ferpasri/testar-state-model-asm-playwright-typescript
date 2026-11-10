# Local exploration benchmark

Compare the same fixed action plan in three modes:

| Mode | Chooses the action | Records evidence | Updates a model and uses ASM |
| --- | --- | --- | --- |
| `playwright_baseline` | Benchmark script | No | No |
| `evidence` | Benchmark script through the exploration driver | Yes | No |
| `asm` | Real ASM through the same driver | Yes | Yes |

Native Playwright supplies browser operations, not an ASM. The local fixture alternates click and fill operations and offers exactly one eligible action per step. This compares execution overhead; it does not measure exploration quality on a branching SUT.

## Run

~~~shell
npm run benchmark -- --actions 20 --repeats 3 --warmups 1
npm run benchmark -- --actions 20 --repeats 3 --warmups 1 --no-screenshots
npm run benchmark -- --actions 50 --repeats 3 --warmups 1 --widgets 300 --properties 12 --states 10
~~~

Use `--help` for a compact option list.

| Option | Default and meaning |
| --- | --- |
| `--actions` | 20 actions per sample. |
| `--repeats` | 3 measured rounds containing every mode. |
| `--warmups` | 1 initial round excluded from the medians. |
| `--widgets` | 50 extra non-actionable div/span pairs; range 0..2000. |
| `--properties` | 4 extra data attributes per generated div; range 0..32. |
| `--states` | 5 page titles visited cyclically. |
| `--no-screenshots` | Disable screenshots in both recording modes. |
| `--existing-trace PATH` | Historical evidence for ASM mode; repeat for several traces. |
| `--output PATH` | Parent directory; defaults to `target/benchmarks`. |

Each sample uses a fresh browser context. Mode order rotates each round. Browser launch and fixture generation are outside sample timing. Warm-ups help browser and runtime initialization settle; compare repeated measurements with the same browser build and workload.

## Timing categories

Nested work is subtracted from its parent. Categories therefore represent separate elapsed intervals, rather than repeatedly counting the same capture or write.

| Category | Measures |
| --- | --- |
| `startup` | Context/page creation, fixture navigation, recorder initialization. |
| `model_setup` | Historical reading and initial ASM construction. |
| `readiness` | Wait for DOMContentLoaded. |
| `action_derivation` | Derive and describe eligible browser actions. |
| `applicability` | Native usability and target-identity checks. |
| `browser_actions` | Native click/fill operations and Playwright's actionability waits. |
| `dom_capture` | DOM extraction and JSON-text transport through Playwright. |
| `screenshots` | Capture PNG screenshots. |
| `recording` | Evidence validation, append/serialization, durable writes, and artifact storage. |
| `model_update` | Accept new evidence and construct the updated abstract model. |
| `selection` | Ask the real ASM to select. |
| `coordination` | Remaining driver, record mapping, source preparation, and lifecycle work. |
| `cleanup` | Finish the recorder and close the context. |
| `other` | Remaining work inside total timing. |
| `total` | Whole sample, excluding subsequent trace validation and model export. |

Timing wrappers exist only in benchmark code and are restored after every sample. Detailed categories differ somewhat from the Python/Java bindings; compare matching workloads and totals before comparing individual categories.

## Correctness and output

A unique results directory contains the generated HTML, incremental `samples.json`, final `results.json`, model exports, and the recorded traces. Results retain settings, runtime/browser versions, per-category counts, medians, and action logs.

Comparisons are rejected if action logs or browser counters differ. After timing, the evidence reader verifies references, lifecycle, artifact hashes, exactly one completed execution/transition per action, one initial observation plus one result per action, expected screenshot counts, and the next available action.

Historical traces add model work. The default URL-based abstraction may not match a previous benchmark's different local server address. Performance measurements diagnose costs; the benchmark does not enforce machine-dependent speed thresholds.
