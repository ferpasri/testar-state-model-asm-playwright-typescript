import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { AsmRun, type AsmConfiguration, type EvidenceSnapshot, type RunReference } from "testar-state-model-asm";
import { evidenceSource } from "testar-abstraction";
import { EvidenceReader } from "testar-evidence/node";
import { PlaywrightEvidence, evidenceFor } from "testar-evidence-playwright";
import { PlaywrightExplorationDriver } from "./driver.js";
import type { ExplorationOptions, ExplorationResult } from "./types.js";

/** Compare concrete page address/title and captured target identity unless the caller supplies rules. */
export function defaultConfiguration(actionLimit = 20): AsmConfiguration {
    if (!Number.isSafeInteger(actionLimit) || actionLimit <= 0) {
        throw new Error("actionLimit must be a positive integer.");
    }
    return {
        abstraction: {
            version: 1, name: "Page address, title, and target identity",
            state: [
                {name: "address", keys: ["ui.url"], required: true},
                {name: "title", keys: ["ui.title"], required: true},
            ],
            capture: "same",
            actions: {target: [{
                name: "target", keys: ["playwright.attribute.id", "playwright.attribute.name", "playwright.dom.path"], required: true,
            }]},
        },
        asms: [
            {name: "unvisited", action_limit: actionLimit, unmatched_choices: "exclude"},
            {name: "random", action_limit: actionLimit},
        ],
        total_action_limit: actionLimit,
    };
}

function mergeScope(previous: readonly RunReference[], incoming: readonly RunReference[]): RunReference[] {
    const scope = new Map(previous.map(reference => [JSON.stringify([reference.source, reference.run]), reference]));
    for (const reference of incoming) {
        scope.set(JSON.stringify([reference.source, reference.run]), reference);
    }
    return [...scope.values()];
}

/** Own the integration cycle; the generic ASM retains all selection, switching, and limit decisions. */
export class PlaywrightExploration {
    readonly asm: AsmRun;
    readonly recorder: PlaywrightEvidence;
    readonly driver: PlaywrightExplorationDriver;
    readonly #ownsRecorder: boolean;
    #running = false;
    #closed = false;
    #acceptedSourcePrefix: string | null = null;

    private constructor(asm: AsmRun, recorder: PlaywrightEvidence, driver: PlaywrightExplorationDriver, ownsRecorder: boolean) {
        this.asm = asm;
        this.recorder = recorder;
        this.driver = driver;
        this.#ownsRecorder = ownsRecorder;
    }

    /** Load selected historical evidence and attach a recorder, reusing a facade recorder when present. */
    static async create(page: Page, options: ExplorationOptions = {}): Promise<PlaywrightExploration> {
        const configuration = options.configuration ?? defaultConfiguration(options.actionLimit);
        const sources: EvidenceSnapshot["sources"][number][] = [];
        const selectedRuns: RunReference[] = [];
        for (const [index, directory] of (options.existingTraces ?? []).entries()) {
            const history = await EvidenceReader.read(directory);
            const source = evidenceSource(history, {id: "historical:" + index, label: directory});
            sources.push(source);
            for (const run of source.evidence.runs.values()) {
                selectedRuns.push({source: source.id, run: run.id});
            }
        }
        const asm = await AsmRun.create(configuration, sources, selectedRuns, {chooseIndex: options.chooseIndex});
        let recorder = options.recorder;
        let ownsRecorder = false;
        let attached: PlaywrightEvidence | undefined;
        try {
            attached = await evidenceFor(page);
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "Record this page before requesting its evidence recorder.") {
                throw error;
            }
        }
        if (recorder && attached !== recorder && recorder.page !== page) {
            throw new Error("The supplied recorder must belong to this page.");
        }
        recorder ??= attached;
        if (!recorder) {
            recorder = await PlaywrightEvidence.startTrace(page, {
                ...options.evidence, origin: options.evidence?.origin ?? "testar-state-model-asm-playwright-typescript",
            });
            ownsRecorder = true;
        }
        try {
            const driver = new PlaywrightExplorationDriver(page, recorder, options);
            return new PlaywrightExploration(asm, recorder, driver, ownsRecorder);
        } catch (error) {
            if (ownsRecorder) {
                await recorder.finish("configuration_error");
            }
            throw error;
        }
    }

    /** Explore an existing page. Script steps may prepare the SUT before this call or between calls. */
    async run({maxCycles = 1000}: {maxCycles?: number} = {}): Promise<ExplorationResult> {
        if (this.#closed || this.#running || !Number.isSafeInteger(maxCycles) || maxCycles <= 0) {
            throw new Error("Use an open, idle exploration with a positive maxCycles limit.");
        }
        this.#running = true;
        this.driver.refreshOnNextObservation();
        const prefix = randomUUID();
        try {
            for (let cycle = 0; cycle < maxCycles; cycle++) {
                const stopped = await this.asm.explorationStop();
                if (stopped) {
                    return this.result(stopped);
                }
                const observed = await this.driver.observe();
                const sourcePrefix = observed.sources[0].fingerprint;
                if (sourcePrefix !== this.#acceptedSourcePrefix) {
                    await this.asm.updateEvidence(prefix + ":observe:" + cycle, observed.sources, mergeScope(this.asm.selectedRuns, observed.selected_runs));
                    this.#acceptedSourcePrefix = sourcePrefix;
                }
                await this.asm.setContext(observed.context);
                const selection = await this.asm.select();
                if (selection.result_type === "no_action") {
                    return this.result(selection);
                }
                const execution = await this.driver.prepareExecution(selection);
                if (execution === null) {
                    continue;
                }
                await this.asm.beginExecution(selection, execution);
                const report = await this.driver.execute(selection, execution);
                if (report.invoked === false) {
                    await this.asm.reportNotInvoked(execution);
                    continue;
                }
                const response = await this.asm.reportExecution(execution, prefix + ":execute:" + cycle,
                    report.sources, mergeScope(this.asm.selectedRuns, report.selected_runs));
                this.#acceptedSourcePrefix = report.sources[0].fingerprint;
                if (response.status === "awaiting_execution_result" || response.status === "awaiting_resulting_observation") {
                    return this.result(await this.asm.select());
                }
            }
            return this.result(await this.asm.explorationStop() ?? {
                result_type: "exploration_stopped", reason: "cycle_limit_reached", message: "The exploration cycle limit was reached.",
            });
        } finally {
            this.#running = false;
        }
    }

    private result(stopped: ExplorationResult["stopped"]): ExplorationResult {
        return {stopped, model: this.asm.model, evidenceDirectory: this.recorder.directory};
    }

    /** Finish only a recorder created here; the caller retains ownership of its page and browser. */
    async close(): Promise<void> {
        if (this.#running) {
            throw new Error("Cancel exploration and await its run before closing.");
        }
        if (!this.#closed && this.#ownsRecorder) {
            await this.recorder.finish();
        }
        this.#closed = true;
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }
}

export async function explore(page: Page, options: ExplorationOptions & {maxCycles?: number} = {}): Promise<ExplorationResult> {
    const exploration = await PlaywrightExploration.create(page, options);
    try {
        return await exploration.run({maxCycles: options.maxCycles});
    } finally {
        await exploration.close();
    }
}
