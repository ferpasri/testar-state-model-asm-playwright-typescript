import { parseArgs } from "node:util";

export function benchmarkOptions(arguments_: string[]) {
    const parsed = parseArgs({
        args: arguments_,
        options: {
            actions: {type: "string", default: "20"}, repeats: {type: "string", default: "3"},
            warmups: {type: "string", default: "1"}, widgets: {type: "string", default: "50"},
            properties: {type: "string", default: "4"}, states: {type: "string", default: "5"},
            "no-screenshots": {type: "boolean", default: false},
            "existing-trace": {type: "string", multiple: true, default: []},
            output: {type: "string", default: "target/benchmarks"}, help: {type: "boolean", default: false},
        },
    }).values;
    const numbers = Object.fromEntries(["actions", "repeats", "warmups", "widgets", "properties", "states"]
        .map(name => [name, Number(parsed[name as keyof typeof parsed])]));
    for (const [name, minimum, maximum] of [
        ["actions", 1, 10000], ["repeats", 1, 100], ["warmups", 0, 100],
        ["widgets", 0, 2000], ["properties", 0, 32], ["states", 1, 10000],
    ] as const) {
        if (!Number.isSafeInteger(numbers[name]) || numbers[name] < minimum || numbers[name] > maximum) {
            throw new Error("--" + name + " must be an integer between " + minimum + " and " + maximum);
        }
    }
    return {
        actions: numbers.actions, repeats: numbers.repeats, warmups: numbers.warmups, widgets: numbers.widgets,
        properties: numbers.properties, states: numbers.states, screenshots: !parsed["no-screenshots"],
        existingTraces: parsed["existing-trace"], output: parsed.output, help: parsed.help,
    };
}
export type BenchmarkOptions = ReturnType<typeof benchmarkOptions>;
