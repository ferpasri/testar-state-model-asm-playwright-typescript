import type { Page, Locator } from "playwright";
import type { Properties } from "testar-evidence";

export interface BrowserActionOptions {
    actionType: "click" | "fill" | "go_back";
    name: string;
    locator?: Locator | null;
    value?: string;
    targetSignature?: string;
    targetPath?: string;
    page?: Page;
}

/** An executable available action. Input values stay out of descriptions and JSON representations. */
export class BrowserAction {
    readonly actionType: BrowserActionOptions["actionType"];
    readonly name: string;
    readonly locator: Locator | null;
    readonly targetPath?: string;
    readonly #value?: string;
    readonly #signature?: string;
    readonly #page?: Page;

    constructor(options: BrowserActionOptions) {
        this.actionType = options.actionType;
        this.name = options.name;
        this.locator = options.locator ?? null;
        this.targetPath = options.targetPath;
        this.#value = options.value;
        this.#signature = options.targetSignature;
        this.#page = options.page;
        if (!["click", "fill", "go_back"].includes(this.actionType) || typeof this.name !== "string" || !this.name) {
            throw new Error("Supply a supported action type and description.");
        }
        if (this.actionType === "go_back" ? !this.#page || this.locator !== null : this.locator === null) {
            throw new Error("Widget actions need a locator; go_back needs a page and no widget.");
        }
        if (this.actionType === "fill" && typeof this.#value !== "string") {
            throw new Error("A fill action requires a configured string value.");
        }
    }

    executionParameters(): Properties {
        return this.actionType === "fill" ? {value: this.#value!} : {};
    }

    toJSON() {
        return {actionType: this.actionType, name: this.name};
    }

    /** Recheck native actionability and the derived control's identity before recording an invocation. */
    async applicable(timeout = 100): Promise<boolean> {
        if (this.actionType === "go_back") {
            if (this.#page!.isClosed()) {
                return false;
            }
            return this.#page!.evaluate(() => {
                const navigation = (window as unknown as {navigation?: {canGoBack?: boolean}}).navigation;
                return typeof navigation?.canGoBack === "boolean" ? navigation.canGoBack : history.length > 1;
            });
        }
        const locator = this.locator!;
        if (await locator.count() !== 1 || !await locator.isVisible() ||
            !await locator.isEnabled({timeout}) || this.actionType === "fill" && !await locator.isEditable({timeout})) {
            return false;
        }
        if (this.#signature !== undefined) {
            const signature = await locator.evaluate(element => JSON.stringify([
                element.localName, element.id, element.getAttribute("name"), element.getAttribute("type"),
                element.getAttribute("href"), element.getAttribute("aria-label"), element.textContent,
            ]), undefined, {timeout});
            return signature === this.#signature;
        }
        return true;
    }

    /** The official Playwright API performs the operation and its final actionability checks. */
    async execute(timeout: number): Promise<unknown> {
        if (this.actionType === "go_back") {
            return this.#page!.goBack({timeout, waitUntil: "domcontentloaded"});
        }
        if (this.actionType === "fill") {
            return this.locator!.fill(this.#value!, {timeout});
        }
        return this.locator!.click({timeout});
    }
}
