import { expect, test } from "vitest";
import { Timings } from "../benchmarks/timings.ts";
import { benchmarkOptions } from "../benchmarks/options.ts";

test("nested timing counts each elapsed interval once", async () => {
    let now = 0;
    const timings = new Timings(() => now);
    await timings.measure("coordination", async () => {
        now += 1;
        await timings.measure("browser_actions", async () => { now += 3; });
        now += 2;
    });
    expect(timings.seconds.coordination).toBe(3);
    expect(timings.seconds.browser_actions).toBe(3);
});

test("timing remains usable after an operation fails", async () => {
    let now = 0;
    const timings = new Timings(() => now);
    await expect(timings.measure("recording", async () => {
        now += 2;
        throw new Error("write failed");
    })).rejects.toThrow("write failed");
    await timings.measure("selection", async () => { now += 1; });
    expect(timings.seconds).toEqual({recording: 2, selection: 1});
});

test("benchmark settings accept workloads and reject invalid counts", () => {
    const options = benchmarkOptions(["--actions", "50", "--widgets", "300", "--properties", "12", "--no-screenshots"]);
    expect(options.actions).toBe(50);
    expect(options.widgets).toBe(300);
    expect(options.screenshots).toBe(false);
    expect(() => benchmarkOptions(["--actions", "0"])).toThrow();
});
