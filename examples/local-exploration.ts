/**
 * Run: node examples/local-exploration.ts
 * This self-contained page uses no external server.
 */
import { chromium } from "playwright";
import { explore } from "../dist/index.js";

const browser = await chromium.launch({headless: !process.argv.includes("--headed")});
try {
    const page = await browser.newPage();
    await page.setContent(`<title>Counter 0</title>
        <button id="advance" onclick="window.count=(window.count||0)+1; document.title='Counter '+window.count">Advance</button>`);

    // actionLimit is optional; its default is 20. The integration derives eligible
    // browser actions and lets the ASM select them. Evidence is written incrementally.
    const result = await explore(page, {
        actionLimit: 5,
        evidence: {sut: "local-counter", testObjective: "Explore five counter actions"},
    });
    console.log("Stop reason:", result.stopped.reason);
    console.log("Evidence directory:", result.evidenceDirectory);
} finally {
    await browser.close();
}
