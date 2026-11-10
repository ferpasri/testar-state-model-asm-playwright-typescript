import { expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { EvidenceReader } from "testar-evidence/node";
import { PlaywrightEvidence, recordPage } from "testar-evidence-playwright";
import type { SelectedAction } from "testar-state-model-asm";
import { deriveActions, explore, PlaywrightExploration, PlaywrightExplorationDriver } from "../src/index.js";
import { fixture } from "./support.js";

test("three selected actions produce four connected observations and one model update per result", async () => {
    const example = await fixture();
    const exploration = await PlaywrightExploration.create(example.page, {
        actionLimit: 3, chooseIndex: () => 0, actionDerivation: {excludedSelectors: ["#empty"]},
        evidence: {evidencePath: example.directory, capture: {screenshots: false}},
    });
    try {
        const update = vi.spyOn(exploration.asm, "updateEvidence");
        const report = vi.spyOn(exploration.asm, "reportExecution");
        const result = await exploration.run();
        expect(result.stopped.reason).toBe("action_limit_reached");
        expect(update).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledTimes(3);
        await exploration.close();
        const history = await EvidenceReader.read(result.evidenceDirectory);
        expect(history.observations).toHaveLength(4);
        expect(history.actionExecutions).toHaveLength(3);
        expect(history.recordedTransitions).toHaveLength(3);
        expect(history.actionExecutions.every(record => record.status === "completed")).toBe(true);
        expect(example.page.isClosed()).toBe(false);
    } finally {
        await exploration.close();
        await example.close();
    }
});

test("stop normally when no eligible actions remain", async () => {
    const example = await fixture();
    try {
        await example.page.goto(example.url + "/empty");
        const result = await explore(example.page, {stateWithoutActions: "stop",
            evidence: {evidencePath: example.directory, capture: {screenshots: false}}});
        expect(result.stopped.reason).toBe("no_available_choices");
        const history = await EvidenceReader.read(result.evidenceDirectory);
        expect(history.actionExecutions).toHaveLength(0);
        expect(history.observations).toHaveLength(1);
    } finally {
        await example.close();
    }
});

test("go_back is a selected and recorded action when an empty page has browser history", async () => {
    const example = await fixture();
    try {
        const result = await explore(example.page, {
            actionLimit: 2, chooseIndex: () => 0, stateWithoutActions: "go_back",
            allowAction: action => action.name === "Click empty" || action.actionType === "go_back",
            evidence: {evidencePath: example.directory, capture: {screenshots: false}},
        });
        expect(result.stopped.reason).toBe("action_limit_reached");
        expect(example.page.url()).toBe(example.url + "/");
        const history = await EvidenceReader.read(result.evidenceDirectory);
        expect(history.actionDescriptions.some(action => action.action_type === "go_back")).toBe(true);
        expect(history.actionExecutions).toHaveLength(2);
        expect(history.recordedTransitions).toHaveLength(2);
    } finally {
        await example.close();
    }
});

test("reuse a facade recorder while keeping its ownership with the caller", async () => {
    const example = await fixture();
    const page = await recordPage(example.page, {evidencePath: example.directory, capture: {screenshots: false}});
    const exploration = await PlaywrightExploration.create(page, {
        actionLimit: 1, chooseIndex: () => 0, actionDerivation: {excludedSelectors: ["#empty"]},
    });
    try {
        await exploration.run();
        await exploration.close();
        expect(exploration.recorder.recordedEvidence.testRuns[0].status).toBe("running");
        await exploration.recorder.finish();
        const history = await EvidenceReader.read(exploration.recorder.directory);
        // Nested facade calls were suppressed: one ASM choice supplies one execution.
        expect(history.actionExecutions).toHaveLength(1);
        expect(history.observations).toHaveLength(2);
    } finally {
        await exploration.close();
        await exploration.recorder.finish();
        await example.close();
    }
});

test("historical evidence marks Left visited, so Unvisited selects Right on a new visit", async () => {
    const example = await fixture();
    const archived = await PlaywrightEvidence.startTrace(example.page, {evidencePath: example.directory, capture: {screenshots: false}});
    try {
        const driver = new PlaywrightExplorationDriver(example.page, archived, {
            actionDerivation: {excludedSelectors: ["#empty"]}, stateWithoutActions: "stop",
        });
        const observation = await driver.observe();
        const left = (await deriveActions(example.page)).find(action => action.name === "Click left")!;
        const id = archived.description({actionType: left.actionType, name: left.name, locator: left.locator}).id;
        const selection = {choice_id: id} as SelectedAction;
        expect(observation.context.choices.some(choice => choice.choice_id === id)).toBe(true);
        const execution = await driver.prepareExecution(selection);
        await driver.execute(selection, execution!);
        await archived.finish();
        const original = await readFile(archived.directory + "/evidence.jsonl");

        await example.page.goto(example.url);
        const result = await explore(example.page, {
            actionLimit: 1, existingTraces: [archived.directory], chooseIndex: () => 0,
            actionDerivation: {excludedSelectors: ["#empty"]},
            evidence: {evidencePath: example.directory, capture: {screenshots: false}},
        });
        const history = await EvidenceReader.read(result.evidenceDirectory);
        const executed = history.actionExecutions[0].action_execution.action_description;
        expect(history.actionDescription(executed)?.properties["playwright.description"]).toBe("Click right");
        expect(await readFile(archived.directory + "/evidence.jsonl")).toEqual(original);
    } finally {
        await archived.finish();
        await example.close();
    }
});

test("cancellation stops before taking another observation", async () => {
    const example = await fixture();
    const exploration = await PlaywrightExploration.create(example.page, {
        evidence: {evidencePath: example.directory, capture: {screenshots: false}},
    });
    try {
        await exploration.asm.cancel();
        expect((await exploration.run()).stopped.reason).toBe("cancelled");
        expect(exploration.recorder.recordedEvidence.observations).toHaveLength(0);
    } finally {
        await exploration.close();
        await example.close();
    }
});

test("readiness failures propagate without fabricating a recorded execution", async () => {
    const example = await fixture();
    const error = new Error("Application not ready");
    const exploration = await PlaywrightExploration.create(example.page, {
        waitUntilReady: () => { throw error; },
        evidence: {evidencePath: example.directory, capture: {screenshots: false}},
    });
    try {
        await expect(exploration.run()).rejects.toBe(error);
        expect(exploration.recorder.recordedEvidence.actionExecutions).toHaveLength(0);
    } finally {
        await exploration.close();
        await example.close();
    }
});


test("configured password input is executed but its value stays out of saved evidence", async () => {
    const example = await fixture();
    try {
        const result = await explore(example.page, {
            actionLimit: 1,
            actionDerivation: {inputValues: {"#password": "private-exploration-password"}},
            allowAction: action => action.actionType === "fill",
            evidence: {evidencePath: example.directory, capture: {screenshots: false}},
        });
        expect(await example.page.locator("#password").inputValue()).toBe("private-exploration-password");
        const history = await EvidenceReader.read(result.evidenceDirectory);
        expect(history.actionExecutions).toHaveLength(1);
        expect(history.actionExecutions[0].status).toBe("completed");
        expect(await readFile(result.evidenceDirectory + "/evidence.jsonl", "utf8")).not.toContain("private-exploration-password");
    } finally {
        await example.close();
    }
});
