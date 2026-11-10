import { expect, test } from "vitest";
import { PlaywrightEvidence } from "testar-evidence-playwright";
import { BrowserAction, deriveActions, PlaywrightExplorationDriver } from "../src/index.js";
import { fixture } from "./support.js";

test("derive visible enabled actions and only explicitly configured fills", async () => {
    const example = await fixture();
    try {
        const actions = await deriveActions(example.page, {
            inputValues: {"#name": "John", "#password": "private-test-value"},
            excludedSelectors: ["#empty", "#right"],
        });
        expect(actions.map(action => action.actionType)).toEqual(["fill", "fill", "click"]);
        expect(actions.map(action => action.name)).toContain("Click left");
        expect(JSON.stringify(actions)).not.toContain("private-test-value");
        expect(actions.every(action => action.targetPath?.startsWith("#document/"))).toBe(true);
    } finally {
        await example.close();
    }
});

test("reject invalid CSS selectors even on a page without controls", async () => {
    const example = await fixture();
    try {
        await example.page.goto(example.url + "/empty");
        await expect(deriveActions(example.page, {excludedSelectors: ["["]})).rejects.toThrow();
    } finally {
        await example.close();
    }
});

test("a different widget at the same DOM path requests a fresh observation", async () => {
    const example = await fixture();
    try {
        const action = (await deriveActions(example.page)).find(action => action.name === "Click left")!;
        expect(await action.applicable()).toBe(true);
        await example.page.locator("#left").evaluate(element => { element.textContent = "Different operation"; });
        expect(await action.applicable()).toBe(false);
    } finally {
        await example.close();
    }
});

test("derived paths bind actions to captured widgets without per-action target resolution", async () => {
    const example = await fixture();
    const recorder = await PlaywrightEvidence.startTrace(example.page, {
        evidencePath: example.directory, capture: {screenshots: false},
    });
    try {
        const driver = new PlaywrightExplorationDriver(example.page, recorder, {
            actionDerivation: {excludedSelectors: ["#empty"]}, stateWithoutActions: "stop",
        });
        const observed = await driver.observe();
        const state = recorder.recordedEvidence.observation(observed.context.observation.observation)!.recorded_state;
        expect(observed.context.choices).toHaveLength(2);
        expect(observed.context.choices.every(choice => state.widgets.some(widget => widget.id === choice.target_widget))).toBe(true);
        expect(recorder.recordedEvidence.observations).toHaveLength(1);
    } finally {
        await recorder.finish();
        await example.close();
    }
});

test("custom derivation can supply native Playwright locators", async () => {
    const example = await fixture();
    const recorder = await PlaywrightEvidence.startTrace(example.page, {evidencePath: example.directory, capture: {screenshots: false}});
    try {
        const driver = new PlaywrightExplorationDriver(example.page, recorder, {
            deriveActions: page => [new BrowserAction({actionType: "click", name: "Custom Left", locator: page.getByRole("button", {name: "Left", exact: true})})],
            stateWithoutActions: "stop",
        });
        const observed = await driver.observe();
        expect(observed.context.choices).toHaveLength(1);
        expect(observed.context.choices[0].target_widget).not.toBeNull();
    } finally {
        await recorder.finish();
        await example.close();
    }
});
