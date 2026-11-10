# Integration specification

## Responsibilities

| Component | Responsibility |
| --- | --- |
| `BrowserAction` | Retain an executable operation, check applicability, and delegate it to Playwright. |
| `deriveActions` | Derive eligible main-document actions in one browser call. |
| `PlaywrightExplorationDriver` | Capture states, report available actions, execute selections, and supply evidence updates. |
| `PlaywrightExploration` | Connect the driver and recorder to the generic ASM's selection and execution lifecycle. |

The evidence adapter records concrete facts. The abstraction library groups states and actions. The ASM library makes selection, navigation, switching, and action-limit decisions.

## Observation and execution cycle

Readiness defaults to DOMContentLoaded. Observation captures the page, derives and filters actions, attaches them to that buffered capture with eligible scope, then commits it. Default derivation supplies structural widget paths in the same browser call, avoiding a separate locator-resolution request for every available action.

Before invocation, the selected control must still identify one visible, enabled widget. Fills also require editability. A signature compares the current tag, ID, name, type, address, explicit accessible-label attribute, and text with the derived control. A mismatch requests a fresh observation without recording an execution.

The driver selects a binding from the committed observation and invokes it through `executeSelected`. This suppresses nested facade recording. The result is captured and its available actions are derived once. That saved observation updates the model and becomes the next selection context. Ordinary uninterrupted exploration records one initial observation plus one result per executed action.

The integration skips a redundant evidence update when the cached result prefix was already accepted by the preceding execution report. The evidence-to-abstraction bridge reuses committed immutable payloads and translates newly accepted events. State capture, derivation, and execution remain separate browser operations; the final Playwright actionability checks still apply.

Browser-operation errors retain their recorded failed result and trigger reassessment when the page remains available. Readiness, derivation, and persistence failures propagate. An outstanding ASM execution remains available for inspection when reporting could not complete.

## Action derivation and configuration

Default derivation offers clicks on visible enabled buttons, links, checkbox/radio inputs, and explicit button/link roles. Text inputs and textareas receive fills only when a configured CSS selector supplies a string value. Input values stay out of action descriptions; actual input belongs to execution parameters and follows the evidence adapter's password redaction policy.

Hidden, disabled, inert, excluded, and readonly fill controls are omitted. Links remain on the same origin and in the current browsing context by default. Download links are omitted. `maxActions` defaults to 200 and permits 1..5000 actions. Eligible scope describes the reported set rather than all possible application actions.

Default derivation covers the main document and creates structural CSS locators without adding attributes to the SUT. Custom derivation returns `BrowserAction` objects and can use native locators. Custom locators without captured paths use the evidence adapter's resolution. Uncaptured widget targets remain recorded but are not offered for model-based widget execution.

With `stateWithoutActions: "go_back"`, an empty eligible set can offer browser-history back as a target-free available action. It passes through the filter and ASM like other actions and consumes the normal action count. The default Random fallback permits its selection when target-based abstraction leaves it unmatched. `stop`, or unavailable backward history, ends selection normally.

A custom readiness callback may time out before the empty-state policy is reached. Applications decide what readiness means for their own pages.

## Models, history, and ownership

Default rules compare the captured page address/title and target ID, name, or structural path. They retain URL query/session values. Applications supply different abstraction rules when their exploration objective requires them.

Existing traces are read and validated through the evidence library. The ASM constructs the initial model from those records and updates it with current evidence. Historical traces remain unchanged; new evidence goes into the current trace.

The integration reuses an attached facade recorder or an explicitly supplied recorder without taking ownership. Otherwise it creates a timestamped trace and finishes it on close. Page/browser ownership stays with the caller. Repeated `run()` calls retain the ASM's evidence and cumulative action limits; each call refreshes the current observation to account for intervening script steps.

Public cancellation uses `exploration.asm.cancel()`. The action currently being executed is still reported. A cycle limit bounds repeated applicability refreshes. Calls to `run()` on one exploration do not overlap.

The shared [ASM contract](https://github.com/ferpasri/testar-state-model-asm-specs/blob/main/docs/contract.md) defines selection, reporting, and error semantics.
