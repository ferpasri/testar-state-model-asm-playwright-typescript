import type { Page } from "playwright";
import type { AsmConfiguration, ChooseIndex, SelectionResult } from "testar-state-model-asm";
import type { AbstractModel } from "testar-abstraction";
import type { EvidenceOptions, PlaywrightEvidence } from "testar-evidence-playwright";
import type { BrowserAction } from "./browser-action.js";

export interface ActionDerivationOptions {
    inputValues?: Readonly<Record<string, string>>;
    excludedSelectors?: readonly string[];
    sameOriginOnly?: boolean;
    maxActions?: number;
}
export interface ResolvedActionDerivationOptions {
    inputValues: Readonly<Record<string, string>>;
    excludedSelectors: readonly string[];
    sameOriginOnly: boolean;
    maxActions: number;
}
export interface ExplorationOptions {
    configuration?: AsmConfiguration;
    /** Applied only when the default ASM configuration is used. */
    actionLimit?: number;
    recorder?: PlaywrightEvidence;
    evidence?: EvidenceOptions;
    existingTraces?: string[];
    actionDerivation?: ActionDerivationOptions;
    deriveActions?: (page: Page, options: ResolvedActionDerivationOptions) => BrowserAction[] | Promise<BrowserAction[]>;
    allowAction?: (action: BrowserAction) => boolean | Promise<boolean>;
    waitUntilReady?: (page: Page) => void | Promise<void>;
    actionTimeout?: number;
    stateWithoutActions?: "go_back" | "stop";
    chooseIndex?: ChooseIndex;
}
export interface ExplorationResult {
    stopped: SelectionResult | {result_type: "exploration_stopped"; reason: string; message: string};
    model: AbstractModel;
    evidenceDirectory: string;
}
