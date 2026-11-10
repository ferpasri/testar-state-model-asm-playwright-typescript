# TESTAR State Model ASM Playwright Integration

Start exploration on an existing Playwright page. The integration derives eligible browser actions, records concrete evidence, and asks the TESTAR ASM library to select actions using an abstract model.

## Install

~~~shell
npm install playwright github:ferpasri/testar-state-model-asm-playwright-typescript#v0.3.0
npx playwright install chromium
~~~

Applications import `testar-state-model-asm-playwright`.

~~~typescript
import { chromium } from "playwright";
import { explore } from "testar-state-model-asm-playwright";

const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    await page.goto("https://example.org");
    const result = await explore(page, { actionLimit: 20 });
    console.log(result.stopped.reason, result.evidenceDirectory);
} finally {
    await browser.close();
}
~~~

A script can log in or navigate before handing its page to exploration. Use the evidence facade for those scripted steps when they should also appear in the trace.

## Configure exploration

`explore(page, options)` accepts optional settings:

| Option | Purpose |
| --- | --- |
| `actionLimit` | Total action limit for the default configuration; defaults to 20. |
| `configuration` | Explicit abstraction rules and ASM/controller configuration. |
| `existingTraces` | Individual evidence directories used as historical input. |
| `actionDerivation.inputValues` | Map CSS selectors to configured fill values. |
| `actionDerivation.excludedSelectors` | Exclude controls and their descendants. |
| `deriveActions`, `allowAction` | Supply custom derivation or filter its output. |
| `waitUntilReady` | Define application readiness before capture and derivation. |
| `stateWithoutActions` | `go_back` by default, or `stop`. |
| `evidence`, `recorder` | Configure an owned trace or reuse a caller-owned recorder. |

`PlaywrightExploration.create(page, options)` exposes its ASM and driver for cancellation, inspection, and continued exploration. Close it when finished; the page and browser remain owned by the caller.

The [specification](docs/SPEC.md) explains the cycle and ownership. [Examples](examples/README.md) show default exploration, configured inputs/filters, and existing evidence.

## Development and benchmark

Requires Node.js 24 or later.

~~~shell
npm ci
npx playwright install chromium
npm run check
npm run example
npm run benchmark -- --actions 20 --repeats 3 --warmups 1
npm run benchmark -- --actions 20 --repeats 3 --warmups 1 --no-screenshots
~~~

The [benchmark guide](benchmarks/README.md) explains its fixed action plan, timing categories, larger workloads, and correctness checks. Versions and published GitHub dependencies are declared in `package.json`.

Remaining work is tracked in [TODO](TODO.md).
