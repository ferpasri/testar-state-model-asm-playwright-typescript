# Runnable examples

Each script contains its own setup and integration. Build first with `npm run build`.

| Script | Purpose |
| --- | --- |
| `local-exploration.ts` | Explore a self-contained counter page. |
| `parabank-basic.ts` | Script login, then use default exploration. |
| `parabank-inputs-and-filters.ts` | Configure fill values, exclusions, and the empty-state policy. |
| `parabank-existing-evidence.ts` | Load prior traces and supply explicit abstraction rules. |

~~~shell
node examples/local-exploration.ts
node examples/parabank-basic.ts --sequences 3 --actions 20
node examples/parabank-inputs-and-filters.ts --sequences 3 --actions 20 --headed
node examples/parabank-existing-evidence.ts --existing-trace PATH --actions 20
~~~

`--headed` shows the browser. Other examples run headless by default. Sequence and action counts are optional and explained in the scripts. Each sequence creates a fresh browser context; closing it finishes its facade-owned traces.

ParaBank scripts use the public demo account john/demo. The evidence facade records preparation steps and ASM operations in the same page trace. SUT and test objective labels describe the run; they are optional metadata rather than required execution settings.

Existing-trace paths identify individual evidence folders. They are read as historical input; the current execution creates its own trace.
