import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import { BrowserAction } from "./browser-action.js";
import type { ActionDerivationOptions, ResolvedActionDerivationOptions } from "./types.js";

const source = await readFile(new URL("./resources/derive-actions.js", import.meta.url), "utf8");
interface DerivedAction {type: "click" | "fill"; name: string; selector: string; inputSelector?: string; signature: string; path: string}
const deriveFunction = new Function("options", "return (" + source + ")(options);") as
    (options: {inputSelectors: string[]; excluded: readonly string[]; sameOrigin: boolean; limit: number}) => DerivedAction[];

export function resolveActionDerivation(options: ActionDerivationOptions = {}): ResolvedActionDerivationOptions {
    const inputValues = {...options.inputValues};
    const excludedSelectors = [...(options.excludedSelectors ?? [])];
    const maxActions = options.maxActions ?? 200;
    const sameOriginOnly = options.sameOriginOnly ?? true;
    if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 5000 ||
        typeof sameOriginOnly !== "boolean" || excludedSelectors.some(value => typeof value !== "string" || !value) ||
        Object.entries(inputValues).some(([selector, value]) => !selector || typeof value !== "string")) {
        throw new Error("Invalid action derivation options.");
    }
    return Object.freeze({inputValues: Object.freeze(inputValues), excludedSelectors: Object.freeze(excludedSelectors), maxActions, sameOriginOnly});
}

/** Derive the eligible main-document actions in one browser call, returning captured-widget paths too. */
export async function deriveActions(page: Page, supplied: ActionDerivationOptions = {}): Promise<BrowserAction[]> {
    const options = resolveActionDerivation(supplied);
    const descriptions = await page.evaluate(deriveFunction, {
        inputSelectors: Object.keys(options.inputValues), excluded: options.excludedSelectors,
        sameOrigin: options.sameOriginOnly, limit: options.maxActions,
    });
    return descriptions.map(item => new BrowserAction({
        actionType: item.type, name: item.name, locator: page.locator(item.selector),
        value: item.type === "fill" ? options.inputValues[item.inputSelector!] : undefined,
        targetSignature: item.signature, targetPath: item.path,
    }));
}
