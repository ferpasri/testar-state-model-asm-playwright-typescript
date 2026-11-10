/**
 * Run: node examples/parabank-existing-evidence.ts --existing-trace PATH --actions 20
 * Repeat --existing-trace for several individual trace directories.
 */
import { parseArgs } from "node:util";
import { createEvidencePlaywright } from "testar-evidence-playwright";
import { defaultConfiguration, explore } from "../dist/index.js";

const {values} = parseArgs({options: {
    "existing-trace": {type: "string", multiple: true, default: []},
    actions: {type: "string", default: "20"}, headed: {type: "boolean", default: false},
}});
const actions = Number(values.actions);
if (!Number.isSafeInteger(actions) || actions <= 0) {
    throw new Error("actions must be a positive integer.");
}
const configuration = defaultConfiguration(actions);
// The abstraction is explicit and editable. This example removes known session
// parameters while keeping the captured original URLs unchanged in evidence.
configuration.abstraction.state[0].transforms = [{
    op: "url", remove_path_parameters: ["jsessionid", "JSESSIONID_8111"],
    remove_query: ["session"], remove_fragment: true,
}];

const {chromium} = createEvidencePlaywright({sut: "parabank", testObjective: "Explore using existing evidence"});
const browser = await chromium.launch({headless: !values.headed});
try {
    const page = await browser.newPage();
    await page.goto("https://para.testar.org/parabank/index.htm");
    await page.locator('input[name="username"]').fill("john");
    await page.locator('input[name="password"]').fill("demo");
    await page.getByRole("button", {name: "Log In"}).click();
    await page.getByText("Account Services", {exact: true}).waitFor();

    const result = await explore(page, {
        configuration, existingTraces: values["existing-trace"],
        actionDerivation: {excludedSelectors: ['a[href*="logout"]']},
    });
    console.log("Stop reason:", result.stopped.reason);
    console.log("Evidence directory:", result.evidenceDirectory);
} finally {
    await browser.close();
}
