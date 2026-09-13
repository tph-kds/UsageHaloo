# todo — real-provider-usage-v2 (poteto-mode: no task tool available; playbook steps verbatim)

## Matched playbooks

Large cross-cutting effort -> figure-it-out owns bespoke rigor; multi-PR delivery -> multi-phase-plan checklist is the deliverable shape; governing execution contract -> planonce-brown-large workflow below. Feature playbook throughput checkpoint applies at each implementation wave.

## planonce-brown-large workflow (verbatim)

- [ ] 1. Map the existing code and implementation deeply first (done: subagent recon + REAL_USAGE_V2_BASELINE.md)
- [ ] 2. Build CONTEXT.md from repository evidence (done: rev1)
- [ ] 3. Create DESIGN.md: target architecture, transition, migration/data safety, security/authz impact, threat model, observability, performance, risk, tested rollback (done: rev1 PENDING)
- [ ] 4. Mark costly/one-way decisions explicitly (done: schema/headline/WP16/local-reads/SSE table)
- [ ] 5. Human gate — design approval (AWAITING: approve/amend DESIGN.md rev1)
- [ ] 6. Create exactly one PLAN.md with reversible/independently verifiable phases and bounded waves incl. compat/regression + rollback checks (blocked until gate 5)
- [ ] 7. Human gate — plan approval; run approve + gate execution PASS before coding (blocked)
- [ ] 8. Execute phase by phase; fresh workers where supported else sequential handoffs; gate execution before each phase; BLOCKED -> BLOCKED_AMEND (blocked)
- [ ] 9. Human phase gate at each material boundary with fresh evidence + rollback readiness (blocked)
- [ ] 10. On invalidation: set BLOCKED, record evidence, smallest plan amendment (+design if needed) before resuming
- [ ] 11. Comprehensive regression/integration/migration/build/lint/types/perf/operational + acceptance checks; re-verify after any code change
- [ ] 12. Security trigger — mandatory for Large: run planonce-security on final diff + trust boundaries; disposition Critical/High
- [ ] 13. Audit requirements/non-goals vs final diff; residual risk + fresh evidence in VERIFY.md bound to revision/worktree/plan_digest
- [ ] 14. Run planonce-review to READY or human-accepted READY_WITH_BACKLOG; readiness PASS
- [ ] 15. Human gate — ship (FRESH evidence required); COMPLETE only after human ship

## Feature throughput checkpoint (per implementation wave)

- [ ] Blocking first steps (gates run before fan-out)
- [ ] Independent workstreams (disjoint files/layers parallelize; shared writes serialize)
- [ ] Shared mutable state (default split-the-target; serialize only for real invariants)
- [ ] Smallest safe decomposition (if one worker, name why)

## Brownfield guardrail

- [ ] No drive-by refactors
