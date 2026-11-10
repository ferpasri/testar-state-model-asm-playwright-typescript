/**
 * Run: node examples/parabank-inputs-and-filters.ts --sequences 3 --actions 20
 * The flags are optional. Configured fill values and action filters are shown inline.
 */
import { parseArgs } from "node:util";
import type { Browser } from "playwright";
import { createEvidencePlaywright } from "testar-evidence-playwright";
import { explore } from "../dist/index.js";

async function asmRun(browser: Browser, sequence: number, actions: number) {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        await page.goto("https://para.testar.org/parabank/index.htm");
        await page.locator('input[name="username"]').fill("john");
        await page.locator('input[name="password"]').fill("demo");
        await page.getByRole("button", {name: "Log In"}).click();
        await page.getByText("Account Services", {exact: true}).waitFor();

        const result = await explore(page, {
            actionLimit: actions,
            actionDerivation: {
                // Fills are derived only for fields that have configured values.
                inputValues: {"#amount": "999999", "#downPayment": "1"},
                // Exclude this link before offering choices to the ASM.
                excludedSelectors: ['a[href*="logout"]'],
                sameOriginOnly: true,
            },
            // This is the default. It lets the ASM choose browser back when a page
            // has no eligible widget actions. Use "stop" to finish there instead.
            stateWithoutActions: "go_back",
        });
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
    const {chromium} = createEvidencePlaywright({
        sut: "parabank", testObjective: "Explore with configured loan inputs and filters",
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
