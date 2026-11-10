import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export const PHASES = [
    "startup", "model_setup", "readiness", "action_derivation", "applicability",
    "browser_actions", "dom_capture", "screenshots", "recording", "model_update",
    "selection", "coordination", "cleanup",
] as const;
export type Phase = typeof PHASES[number];
interface Frame {started: number; children: number}

/** Benchmark-only timing: nested work is subtracted from its parent rather than counted twice. */
export class Timings {
    seconds: Record<string, number> = {};
    calls: Record<string, number> = {};
    #active = new AsyncLocalStorage<Frame>();
    private clock: () => number;
    constructor(clock = () => performance.now() / 1000) {
        this.clock = clock;
    }

    async measure<T>(phase: Phase, operation: () => T | Promise<T>): Promise<T> {
        const parent = this.#active.getStore();
        const frame = {started: this.clock(), children: 0};
        return this.#active.run(frame, async () => {
            try {
                return await operation();
            } finally {
                const elapsed = this.clock() - frame.started;
                this.seconds[phase] = (this.seconds[phase] ?? 0) + Math.max(0, elapsed - frame.children);
                this.calls[phase] = (this.calls[phase] ?? 0) + 1;
                if (parent) {
                    parent.children += elapsed;
                }
            }
        });
    }
}

export class Patches {
    #restore: Array<() => void> = [];

    method(target: object, name: string, wrap: (operation: (...arguments_: any[]) => any) => (...arguments_: any[]) => any): void {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        const original = (target as Record<string, any>)[name];
        Object.defineProperty(target, name, {
            configurable: true, writable: true,
            value: wrap(function (this: unknown, ...arguments_: unknown[]) { return Reflect.apply(original, this, arguments_); }),
        });
        this.#restore.push(() => {
            if (descriptor) {
                Object.defineProperty(target, name, descriptor);
            } else {
                Reflect.deleteProperty(target, name);
            }
        });
    }

    timed(target: object, name: string, phase: Phase, timings: Timings): void {
        this.method(target, name, operation => function (this: unknown, ...arguments_: unknown[]) {
            return timings.measure(phase, () => operation.apply(this, arguments_));
        });
    }

    restore(): void {
        for (const restore of this.#restore.reverse()) {
            restore();
        }
        this.#restore = [];
    }
}
