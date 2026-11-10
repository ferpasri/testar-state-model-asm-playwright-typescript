import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Serve the same generated HTML to every mode at one local address. */
export async function fixture(directory: string, widgets: number, properties: number, states: number) {
    const template = await readFile(new URL("./fixture.html", import.meta.url), "utf8");
    const controls = Array.from({length: widgets}, (_, index) => {
        const attributes = Array.from({length: properties}, (_, property) =>
            'data-property-' + property + '="widget-' + index + '-value-' + property + '"').join(" ");
        return '<div class="widget" ' + attributes + '><span>Widget ' + index + '</span></div>';
    });
    const html = template.replace("{{widgets}}", controls.join("\n")).replace("{{states}}", String(states));
    await writeFile(path.join(directory, "fixture.html"), html);
    const server = createServer((_request, response) => {
        response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
        response.end(html);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        url: "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/",
        async close() {
            server.close();
            await once(server, "close");
        },
    };
}
