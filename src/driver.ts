import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { EvidenceInputBridge } from "testar-abstraction";
import type {
    ExplorationDriver, ObservationUpdate, ExecutionUpdate, SelectedAction, ExecutionReference,
} from "testar-state-model-asm";
import type { PlaywrightEvidence, AvailableAction } from "testar-evidence-playwright";
import { BrowserAction } from "./browser-action.js";
import { deriveActions, resolveActionDerivation } from "./action-derivation.js";
import type { ExplorationOptions, ResolvedActionDerivationOptions } from "./types.js";

/** Connect state capture, available actions, and execution to the generic ASM contract. */
export class PlaywrightExplorationDriver implements ExplorationDriver {
    readonly page: Page;
    readonly recorder: PlaywrightEvidence;
    readonly options: ResolvedActionDerivationOptions;
    readonly sourceId: string;
    #derive: NonNullable<ExplorationOptions["deriveActions"]>;
    #allow: NonNullable<ExplorationOptions["allowAction"]>;
    #ready: NonNullable<ExplorationOptions["waitUntilReady"]>;
    #timeout: number;
    #emptyPolicy: "go_back" | "stop";
    #bridge: EvidenceInputBridge;
    #choices = new Map<string, {action: BrowserAction; description: AvailableAction}>();
    #observation: string | null = null;
    #nextObservation: ObservationUpdate | null = null;

    constructor(page: Page, recorder: PlaywrightEvidence, options: ExplorationOptions = {}) {
        const timeout = options.actionTimeout ?? 5000;
        const policy = options.stateWithoutActions ?? "go_back";
        if (!Number.isFinite(timeout) || timeout <= 0 || !["go_back", "stop"].includes(policy)) {
            throw new Error("Supply a positive action timeout and a go_back or stop empty-state policy.");
        }
        this.page = page;
        this.recorder = recorder;
        this.options = resolveActionDerivation(options.actionDerivation);
        this.#derive = options.deriveActions ?? deriveActions;
        this.#allow = options.allowAction ?? (() => true);
        this.#ready = options.waitUntilReady ?? (page => page.waitForLoadState("domcontentloaded"));
        this.#timeout = timeout;
        this.#emptyPolicy = policy;
        this.sourceId = recorder.recordedEvidence.manifest.evidence_id;
        this.#bridge = new EvidenceInputBridge(recorder.recordedEvidence, {id: this.sourceId, label: "Current exploration"});
    }

    /** Script steps between exploration calls invalidate the cached result-state choices. */
    refreshOnNextObservation(): void {
        this.#nextObservation = null;
    }

    /** Translate new committed events without rereading files or copying widget properties. */
    snapshot() {
        const update = this.#bridge.update();
        return {
            sources: [update.source],
            selected_runs: [{source: this.sourceId, run: this.recorder.runId}],
        };
    }

    async observe(): Promise<ObservationUpdate> {
        if (this.#nextObservation) {
            const observation = this.#nextObservation;
            this.#nextObservation = null;
            return observation;
        }
        return this.observeCurrent();
    }

    private async observeCurrent(): Promise<ObservationUpdate> {
        await this.#ready(this.page);
        const observation = await this.recorder.capture();
        const derived = await this.#derive(this.page, this.options);
        if (!Array.isArray(derived) || derived.some(action => !(action instanceof BrowserAction))) {
            throw new Error("Action derivation must return BrowserAction objects.");
        }
        const actions: BrowserAction[] = [];
        for (const action of derived) {
            if (await this.#allow(action)) {
                actions.push(action);
            }
        }
        if (actions.length === 0 && this.#emptyPolicy === "go_back") {
            const back = new BrowserAction({actionType: "go_back", name: "Go back in browser history", page: this.page});
            if (await back.applicable() && await this.#allow(back)) {
                actions.push(back);
            }
        }
        const descriptions: AvailableAction[] = actions.map(action => ({
            actionType: action.actionType, name: action.name, locator: action.locator,
        }));
        const paths = actions.map(action => action.actionType === "go_back" ? null : action.targetPath);
        // Default derivation already computed each main-document path in the browser.
        // Custom locators without paths use the evidence adapter's normal resolution.
        const targetPaths = paths.every(path => path !== undefined) ? paths as Array<string | null> : undefined;
        await this.recorder.recordAvailableActions(descriptions, {scope: "eligible", observation, targetPaths});
        await this.recorder.commitCapture();
        const snapshot = this.snapshot();
        const recorded = this.recorder.recordedEvidence.observation(observation)!;
        const bindings = new Map(recorded.available_actions.map(binding => [binding.action_description, binding]));
        const choices: ObservationUpdate["context"]["choices"] = [];
        this.#choices.clear();
        for (const [index, description] of descriptions.entries()) {
            const id = this.recorder.description(description).id;
            const binding = bindings.get(id)!;
            if (binding.target_widget === null && actions[index].actionType !== "go_back" || this.#choices.has(id)) {
                continue;
            }
            this.#choices.set(id, {action: actions[index], description});
            choices.push({choice_id: id, ...binding});
        }
        this.#observation = observation;
        return {...snapshot, context: {
            context_id: randomUUID(), observation: {source: this.sourceId, run: this.recorder.runId, observation},
            choices,
        }};
    }

    /** Recheck applicability before allocating evidence execution identity; stale targets request a refresh. */
    async prepareExecution(selection: SelectedAction): Promise<ExecutionReference | null> {
        const selected = this.#choices.get(selection.choice_id);
        if (!selected || !this.#observation) {
            throw new Error("Select a current action before preparing execution.");
        }
        try {
            if (!await selected.action.applicable(Math.min(this.#timeout, 100))) {
                return null;
            }
        } catch (error) {
            if (this.page.isClosed()) {
                throw error;
            }
            return null;
        }
        const execution = await this.recorder.selectRecordedAction(
            selected.description, this.#observation, selected.action.executionParameters());
        return {source: this.sourceId, run: this.recorder.runId, execution};
    }

    /** Capture and derive the result once; the next selection reuses this observation. */
    async execute(selection: SelectedAction, execution: ExecutionReference): Promise<ExecutionUpdate> {
        const selected = this.#choices.get(selection.choice_id);
        if (!selected || execution.source !== this.sourceId || execution.run !== this.recorder.runId) {
            throw new Error("The execution does not belong to this driver's current selection.");
        }
        let operationError: unknown;
        try {
            await this.recorder.executeSelected(async () => {
                try {
                    return await selected.action.execute(this.#timeout);
                } catch (error) {
                    operationError = error;
                    throw error;
                }
            });
        } catch (error) {
            if (error !== operationError || this.recorder.recordingError) {
                throw this.recorder.recordingError ?? error;
            }
            // The adapter recorded the browser error. Reassess the actual current state.
            if (this.page.isClosed()) {
                return this.snapshot();
            }
        }
        this.#nextObservation = await this.observeCurrent();
        return {sources: this.#nextObservation.sources, selected_runs: this.#nextObservation.selected_runs};
    }
}
