/**
 * Run: node examples/parabank-basic.ts --sequences 3 --actions 20
 * --sequences and --actions are optional; --headed shows the browser.
 */
import { parseArgs } from "node:util";
import type { Browser } from "playwright";
import { createEvidencePlaywright } from "testar-evidence-playwright";
import { explore } from "../dist/index.js";

async function asmRun(browser: Browser, sequence: number, actions: number) {
    // A fresh context resets cookies and storage for this sequence.
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        // These ordinary scripted steps are recorded by the evidence facade too.
        await page.goto("https://para.testar.org/parabank/index.htm");
        await page.locator('input[name="username"]').fill("john");
        await page.locator('input[name="password"]').fill("demo");
        await page.getByRole("button", {name: "Log In"}).click();
        await page.getByText("Account Services", {exact: true}).waitFor();

        const result = await explore(page, {actionLimit: actions});
        console.log("Sequence", sequence, "stop reason:", result.stopped.reason);
        console.log("Evidence directory:", result.evidenceDirectory);
    } finally {
        await context.close();
    }
}

async function main() {
    const {values} = parseArgs({options: {
        sequences: {type: "string", default: "1"}, actions: {type: "string", default: "20"},
        headed: {type: "boolean", default: false},
    }});
    const sequences = Number(values.sequences);
    const actions = Number(values.actions);
    if (![sequences, actions].every(value => Number.isSafeInteger(value) && value > 0)) {
        throw new Error("sequences and actions must be positive integers.");
    }
    // All metadata options are optional. They describe the SUT and test objective;
    // every page receives a unique trace folder under the default target/traces.
    const {chromium} = createEvidencePlaywright({
        sut: "parabank", testObjective: "Login followed by default exploration",
    });
    const browser = await chromium.launch({headless: !values.headed});
    try {
        for (let sequence = 1; sequence <= sequences; sequence++) {
            await asmRun(browser, sequence, actions);
        }
    } finally {
        await browser.close();
    }
}

await main();
