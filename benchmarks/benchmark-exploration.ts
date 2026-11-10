import { chromium, type Browser, type Page } from "playwright";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { EvidenceReader, JsonlStore } from "testar-evidence/node";
import { stringifyJson } from "testar-evidence";
import type { SelectedAction } from "testar-state-model-asm";
import type { AbstractModel } from "testar-abstraction";
import { PlaywrightEvidence } from "testar-evidence-playwright";
import {
    BrowserAction, PlaywrightExploration, PlaywrightExplorationDriver, deriveActions,
} from "../dist/index.js";
import { Timings, Patches, PHASES } from "./timings.ts";
import { benchmarkOptions, type BenchmarkOptions } from "./options.ts";
import { fixture } from "./fixture.ts";

const MODES = ["playwright_baseline", "evidence", "asm"] as const;
type Mode = typeof MODES[number];
interface ActionLog {action_type: string; locator: string | null}
interface Sample {
    mode: Mode;
    seconds: Record<string, number>;
    calls: Record<string, number>;
    action_log: ActionLog[];
    evidence_directory: string | null;
    trace: Awaited<ReturnType<typeof validateTrace>> | null;
    warmup: boolean;
    round: number;
}

function one<T>(actions: T[]): T {
    if (actions.length !== 1) {
        throw new Error("The benchmark requires exactly one eligible action, found " + actions.length);
    }
    return actions[0];
}

async function validateTrace(directory: string, actions: number, screenshots: boolean) {
    const history = await EvidenceReader.read(directory);
    if (history.actionExecutions.length !== actions || history.recordedTransitions.length !== actions ||
        history.observations.length !== actions + 1 || history.actionExecutions.some(item => item.status !== "completed") ||
        history.observations.some(item => item.available_action_scope !== "eligible" || item.available_actions.length !== 1)) {
        throw new Error("The benchmark trace does not preserve each action, result, and next available action.");
    }
    const count = history.observations.flatMap(item => item.artifacts).filter(item => item.media_type === "image/png").length;
    if (count !== (screenshots ? actions + 1 : 0)) {
        throw new Error("Unexpected benchmark screenshot count.");
    }
    return {observations: history.observations.length, executions: history.actionExecutions.length,
        transitions: history.recordedTransitions.length, screenshots: count, jsonl_bytes: (await stat(path.join(directory, "evidence.jsonl"))).size};
}

function installTimings(timings: Timings, patches: Patches, page: Page, actions: ActionLog[]) {
    patches.method(page, "evaluate", operation => function (this: Page, ...args: unknown[]) {
        const source = String(args[0]);
        // Match the static DOM extraction script, not general application evaluations.
        return source.includes("playwright.dom.tagName") && source.includes("JSON.stringify")
            ? timings.measure("dom_capture", () => operation.apply(this, args)) : operation.apply(this, args);
    });
    patches.timed(page, "screenshot", "screenshots", timings);
    patches.timed(JsonlStore.prototype, "append", "recording", timings);
    patches.timed(JsonlStore.prototype, "saveArtifact", "recording", timings);
    patches.timed(BrowserAction.prototype, "applicable", "applicability", timings);
    patches.method(BrowserAction.prototype, "execute", operation => function (this: BrowserAction, ...args: unknown[]) {
        actions.push({action_type: this.actionType, locator: this.locator ? String(this.locator) : null});
        return timings.measure("browser_actions", () => operation.apply(this, args));
    });
}

async function runSample(browser: Browser, url: string, mode: Mode, options: BenchmarkOptions, output: string) {
    const timings = new Timings();
    const patches = new Patches();
    const actions: ActionLog[] = [];
    let recorder: PlaywrightEvidence | undefined;
    let exploration: PlaywrightExploration | undefined;
    let model: AbstractModel | undefined;
    const start = performance.now();
    const context = await timings.measure("startup", () => browser.newContext());
    let phases: Record<string, number>;
    try {
        const page = await timings.measure("startup", () => context.newPage());
        installTimings(timings, patches, page, actions);
        await timings.measure("startup", () => page.goto(url));
        const ready = (page: Page) => timings.measure("readiness", () => page.waitForLoadState("domcontentloaded"));
        const derivation = {inputValues: {"#entry": "benchmark text"}};
        const derive = (page: Page, settings: Parameters<typeof deriveActions>[1]) =>
            timings.measure("action_derivation", () => deriveActions(page, settings));
        let driver: PlaywrightExplorationDriver | undefined;
        if (mode !== "playwright_baseline") {
            recorder = await timings.measure("startup", () => PlaywrightEvidence.startTrace(page, {
                evidencePath: path.join(output, "traces"), sut: "benchmark", testObjective: mode,
                capture: {screenshots: options.screenshots, maxWidgets: Math.min(5000, options.widgets * 2 + 64)},
            }));
        }
        if (mode === "asm") {
            exploration = await timings.measure("model_setup", () => PlaywrightExploration.create(page, {
                recorder, actionLimit: options.actions, existingTraces: options.existingTraces, actionDerivation: derivation,
                deriveActions: derive, waitUntilReady: ready, chooseIndex: () => 0, stateWithoutActions: "stop",
            }));
            driver = exploration.driver;
            for (const [method, phase] of [
                ["updateEvidence", "model_update"], ["reportExecution", "model_update"], ["select", "selection"],
                ["setContext", "coordination"], ["beginExecution", "coordination"],
            ] as const) {
                patches.timed(exploration.asm, method, phase, timings);
            }
        } else if (mode === "evidence") {
            driver = new PlaywrightExplorationDriver(page, recorder!, {
                actionDerivation: derivation, deriveActions: derive, waitUntilReady: ready, stateWithoutActions: "stop",
            });
        }
        if (driver) {
            for (const method of ["observe", "prepareExecution", "execute"]) {
                patches.timed(driver, method, "coordination", timings);
            }
        }

        if (mode === "playwright_baseline") {
            // A script chooses the only eligible action. Native Playwright provides no ASM here.
            await ready(page);
            let available = await derive(page, derivation);
            for (let index = 0; index < options.actions; index++) {
                const action = one(available);
                if (!await action.applicable()) {
                    throw new Error("The fixture action unexpectedly became inapplicable.");
                }
                await action.execute(5000);
                await ready(page);
                available = await derive(page, derivation);
            }
        } else if (mode === "evidence") {
            // The same script choice runs through the real recording driver, without a model or ASM.
            for (let index = 0; index < options.actions; index++) {
                const observed = await driver!.observe();
                const selected = {choice_id: one(observed.context.choices).choice_id} as SelectedAction;
                const execution = await driver!.prepareExecution(selected);
                if (!execution) {
                    throw new Error("The fixture unexpectedly needed a refreshed observation.");
                }
                await driver!.execute(selected, execution);
            }
        } else {
            const result = await timings.measure("coordination", () => exploration!.run({maxCycles: options.actions + 1}));
            if (result.stopped.reason !== "action_limit_reached") {
                throw new Error("ASM stopped before its requested action count.");
            }
            model = result.model;
        }
        const finalStep = await page.evaluate(() => (window as unknown as {benchmarkStep: number}).benchmarkStep);
        if (finalStep !== options.actions || actions.length !== options.actions) {
            throw new Error("The modes did not execute the requested action plan.");
        }
    } finally {
        try {
            await timings.measure("cleanup", async () => {
                try {
                    await recorder?.finish();
                } finally {
                    await context.close();
                }
            });
        } finally {
            patches.restore();
        }
    }
    const total = (performance.now() - start) / 1000;
    phases = Object.fromEntries(PHASES.map(phase => [phase, timings.seconds[phase] ?? 0]));
    phases.other = Math.max(0, total - Object.values(phases).reduce((sum, value) => sum + value, 0));
    phases.total = total;
    // Reader, hash, and lifecycle validation are deliberately outside sample timing.
    const trace = recorder ? await validateTrace(recorder.directory, options.actions, options.screenshots) : null;
    if (model) {
        await mkdir(path.join(output, "models"), {recursive: true});
        await writeFile(path.join(output, "models", randomUUID() + ".json"), stringifyJson(model));
    }
    return {mode, seconds: phases, calls: timings.calls, action_log: actions, evidence_directory: recorder?.directory ?? null, trace};
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main() {
    const options = benchmarkOptions(process.argv.slice(2));
    if (options.help) {
        console.log("npm run benchmark -- --actions 20 --repeats 3 --warmups 1\nOptions: --widgets 50 --properties 4 --states 5 --no-screenshots --existing-trace PATH --output PATH");
        return;
    }
    const output = path.resolve(options.output, new Date().toISOString().replace(/[.:]/g, "-") + "-" + randomUUID().slice(0, 8));
    await mkdir(output, {recursive: true});
    const local = await fixture(output, options.widgets, options.properties, options.states);
    const samples: Sample[] = [];
    const browser = await chromium.launch({headless: true});
    const environment = {
        node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(),
        browser: browser.version(), integration: JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version,
    };
    try {
        for (let round = 0; round < options.warmups + options.repeats; round++) {
            const order = [...MODES.slice(round % 3), ...MODES.slice(0, round % 3)];
            let reference: ActionLog[] | undefined;
            for (const mode of order) {
                const sample = await runSample(browser, local.url, mode, options, output);
                if (reference && !isDeepStrictEqual(reference, sample.action_log)) {
                    throw new Error("Modes followed different action sequences; comparison rejected.");
                }
                reference = sample.action_log;
                const warmup = round < options.warmups;
                samples.push({...sample, warmup, round: round + 1});
                console.log((warmup ? "Warm-up" : "Measured") + " round " + (round + 1) + ", " + mode + ": " + sample.seconds.total.toFixed(3) + "s");
                await writeFile(path.join(output, "samples.json"), JSON.stringify(samples, null, 4));
            }
        }
    } finally {
        await browser.close();
        await local.close();
    }
    const medians: Record<string, Record<string, number>> = {};
    console.log("\n" + "Median seconds".padEnd(26) + "Playwright baseline".padStart(20) + "Evidence".padStart(12) + "ASM".padStart(12));
    for (const phase of [...PHASES, "other", "total"]) {
        const row = Object.fromEntries(MODES.map(mode => [mode,
            median(samples.filter(sample => !sample.warmup && sample.mode === mode).map(sample => sample.seconds[phase]))]));
        medians[phase] = row;
        console.log(phase.padEnd(26) + MODES.map(mode => row[mode].toFixed(3).padStart(mode === "playwright_baseline" ? 20 : 12)).join(""));
    }
    console.log("\nEvidence/baseline: " + (medians.total.evidence / medians.total.playwright_baseline).toFixed(2) + "x");
    console.log("ASM/baseline: " + (medians.total.asm / medians.total.playwright_baseline).toFixed(2) + "x");
    await writeFile(path.join(output, "results.json"), JSON.stringify({settings: options, environment, samples, medians}, null, 4));
    console.log("Results and traces: " + output);
}

await main();
