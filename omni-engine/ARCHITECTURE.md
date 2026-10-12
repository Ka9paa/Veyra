# Veyra Build — Technical Blueprint

## 1. Omnipresent Canvas Router

The canvas router fuses prompt/hotkey/direct-manipulation events with the authoritative node tree, exact geometry, style matrix, selection state, viewport, framework target, current files, and runtime diagnostics.

Pipeline:
1. input capture
2. canvas serialization
3. framework-neutral Visual IR
4. intent fusion
5. planner/layout/interaction/design agents
6. validated mutations
7. deterministic framework compiler
8. preview + QA
9. event persistence

Anti-drift rule: agents do not recreate layouts from screenshots or prose. Geometry and responsive constraints remain authoritative. The compiler owns framework translation.

## 2. Total Feature Full-Stack Amplifier

Every request becomes a FeaturePlan containing domain entities, schema changes, indexes, RLS, auth, API contracts, realtime/background jobs, UI changes, migrations, tests, rollback, and observability.

Database generation is schema-first. Auth supports OAuth, sessions, JWT access/refresh, provider linking, revocation, rate limits, audit events, and secure browser cookies.

## 3. Visual Refinement Agents

Layout Agent: flex/grid/flow, constraints, spacing, sizing, breakpoints, overflow.

Interaction Agent: hover/focus/press/loading/success/error, Framer Motion, GSAP for complex timelines, reduced-motion fallbacks.

Design System Agent: tokens, typography, contrast, radii, shadows, component states, dark/light themes, brand fidelity.

## 4. Multi-Agent Execution

Agents never directly overwrite the project. They emit plans, structured mutations, file patches, diagnostics, confidence, and verification instructions. The orchestrator validates, resolves conflicts, applies changes transactionally, compiles, tests, repairs, and stores an event snapshot.

## 5. Self-Healing Loop

Compiler errors, tests, runtime logs, browser console, a11y scans, migrations, and deployment errors enter a bounded repair loop. Maximum automated attempts prevent infinite repair cycles.

## 6. Deployment

Deployment adapters implement validate/build/deploy/rollback. Production deployments should execute as queued jobs in isolated builders, not long-running browser requests.

## 7. Production Hardening

Required before scale: per-tenant quotas, RBAC, secret vault, signed previews, isolated builders, egress policy, rate limits, audit logs, idempotency, traces, backups, migration locks, queue poison-message handling, and provider circuit breakers.
