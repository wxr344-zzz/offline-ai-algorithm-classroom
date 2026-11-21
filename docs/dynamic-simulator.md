# Dynamic algorithm simulations

The native simulator dispatches registered topics to `exam_simulator.core.REGISTRY`.
An unregistered named topic goes through `exam_simulator.generated.compute_trace`.
It must never select the first catalog entry on a resolution failure.

The dynamic path:

1. Identify the named algorithm; ask for clarification on ambiguous topics.
2. Generate a pure `solve(data)` implementation and explicit input/output contracts.
3. Generate an independent, simpler result oracle and independent boundary inputs.
   Repair checker errors without discarding the candidate implementation. Reject
   exact source copies and alpha-renamed copies while retaining operand identity.
4. Review algorithm alignment and boundary coverage.
5. Run both implementations in a disposable local Pyodide WASM worker. Check both
   boundary sets and the actual input. Replay the instrumented implementation
   twice and require identical outcomes and snapshots.
6. Render only the execution snapshots. Labels identify executed source lines;
   the model never supplies animation frames. Arrays, matrices, node lists and
   nested working containers retain their structure. Pointer links come from
   actual subscripts in each function, rather than model hints.

Generated Python never executes in the FastAPI host interpreter. The driver
allows pure functions and bounded containers, denies imports/reflection/JS,
guards large multiplications/powers, limits instruction and snapshot counts,
and uses a 20-second worker watchdog. Python/JS runtime files are local assets
under `public/vendor/eduplus/pyodide`. No application environment or credentials
are passed to the child process. Browser requests cannot supply source code.

Only accepted implementations are cached, with a maximum of 32 entries and
owner-scoped keys. Each new input still executes and is cross-checked; results
are not cached. Client disconnects cancel generation and sandbox work.

`verified` with `verification.kind=execution-crosscheck` means that finite
execution checks passed. It is not a mathematical proof for all possible inputs.
Failed checks must remain visible errors after bounded automatic repair; never
publish invented frames or silently substitute an unrelated algorithm.

Relevant regressions:

- `tests/test_dynamic_simulator.py`: real WASM runs, hostile capabilities,
  allocation/instruction budgets, independent checker repair, replay and pointers.
- `tests/test_agent_api.py`: authenticated dispatch, source rejection and cancellation.
- `tests/components/simulator-dynamic-routing.test.ts`: no first-entry substitution,
  unknown-topic rendering and custom-input reruns.
- `tests/generation/app-scene-builder.test.ts`: historical blocked preview migration.
