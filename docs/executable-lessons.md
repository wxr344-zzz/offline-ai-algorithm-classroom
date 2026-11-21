# Executable lesson generation

The classroom HTTP workflow enables `executable_labs` in `agent_api.run_agent`.
Saved legacy courses and explicit offline repairs retain their previous schemas.
The production route no longer asks a model to invent a variable quota and two
different answers for every algorithm. That old requirement caused repeated,
identical validation failures for otherwise valid course requests.

## One execution contract, two exercises

1. Known algorithms resolve to the simulator's maintained metadata and executor.
   The core and defining Python module are linked with AST transformations into
   a portable reference. No host eval or model-generated source is involved.
2. Candidate boundary inputs are accepted only by real executor runs. Correlated
   fields can be relabelled together. The answers are the actual outcomes.
3. Unknown named algorithms use the existing independent-checker and WASM trace
   pipeline. Programming concepts use the same generator to define a concrete
   computation, without incorrectly requiring a named catalog algorithm.
   Platform-generated empty collection probes prevent the model from omitting
   those boundaries. A candidate must agree on every probe its independent
   checker can solve. Validated probe inputs become actual exercise cases.
   Execution errors include the failing input and component. A source failure
   repairs source only under the accepted contract; a checker failure repairs
   the checker. Rewriting examples to hide a counterexample is not permitted.
   The original teaching requirement reaches generation and review, rather
   than being reduced to a broad topic label between workflow nodes.
4. The guide implements one computation. The independent exercise processes a
   batch and performs stable deduplication or result-frequency aggregation.
   Titles, settings and roles can vary, but executable rules and expected answers
   are compiled from one spec. An unavailable editorial model does not invalidate
   a correct implementation.
5. Both complete references must pass every public and hidden assertion in a
   disposable local Pyodide WASM worker before course assets are returned. The
   fixed sandbox uses the application's actual Python worker runtime, an empty
   JS bridge, no application credentials, bounded memory and a watchdog.
6. The teacher metadata and supplementary teaching for compiled courses are
   constructed from the accepted contract. A later editorial request cannot
   overwrite the task, examples, answers or invent simulation snapshots.
   Maintained results are projected onto an unambiguous semantic value where
   available (such as LCS length, MST total or Huffman WPL), rather than grading
   an arbitrary choice among multiple valid witnesses. Independent checker
   source and hashes are retained in teacher-only pytest metadata for auditing.

The native PPT, scene, simulator and recording generation path is retained.
Its existing outline and lab-course checkpoints allow resuming downstream work
without regenerating accepted lab assets. `ALGORITHM_CONTRACT_FAILED` and
`REFERENCE_EXECUTION_FAILED` distinguish failed verification from provider,
network, timeout and configuration failures. Failed checks never become fake
success, missing exercises, or unverified answers.

## Scope of evidence

The regression suite compiles all 76 maintained catalog algorithms and runs all
76 guides and independent exercises in WASM. It also covers corrupted expected
answers, runtime exceptions, ordinary programming concepts, metadata routing and
unknown dynamic programs. End-to-end classroom runs are recorded separately in
`logs/executable-classroom-acceptance.json`.

Finite tests and independently generated checkers are not mathematical proofs
for every algorithm or input. Provider outages, invalid/ambiguous requirements,
exhausted resources and new implementation defects remain explicit failures,
with checkpoints retained. Increasing success must not weaken correctness gates
or silently remove required programming modules.
