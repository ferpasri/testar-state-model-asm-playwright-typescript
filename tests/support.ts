import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

export const form = `<!doctype html><title>Form</title>
    <label>Name<input id="name"></label><label>Password<input id="password" type="password"></label>
    <button id="left" onclick="document.querySelector('#status').textContent='Left'">Left</button>
    <button id="right" onclick="document.querySelector('#status').textContent='Right'">Right</button>
    <a id="empty" href="/empty">Empty</a><p id="status">Ready</p>
    <button id="hidden" style="display:none">Hidden</button><button disabled>Disabled</button>
    <a href="https://example.org">External</a><a href="/download" download>Download</a>`;

export async function fixture() {
    const server = createServer((request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(request.url === "/empty" ? "<title>Empty</title><pre>No actionable widgets</pre>" : form);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const browser = await chromium.launch({headless: true});
    const page = await browser.newPage();
    const directory = await mkdtemp(path.join(os.tmpdir(), "testar-asm-playwright-ts-"));
    const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    await page.goto(url);
    return {
        browser, page, directory, url,
        async close() {
            try {
                await browser.close();
            } finally {
                server.close();
                await once(server, "close");
            }
        },
    };
}
