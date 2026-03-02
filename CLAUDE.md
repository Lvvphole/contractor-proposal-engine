# \# Contractor Proposal Engine

## 

## \## Architecture

## \- Vault is the canonical source of truth, database is a derived cache only

## \- All state mutations follow: append event → update document → rebuild cache

## \- Pricing engine is a pure function with zero I/O and zero LLM involvement

## \- All Claude extraction output is validated against JSON Schema before any persistence

## \- All side effects pass through typed MCP tool contracts

## \- Webhook handlers must be idempotent

## \- No business logic lives inside prompts

## 

## \## Tech Stack

## \- Node.js 20, TypeScript strict mode

## \- Next.js 14 App Router on Vercel

## \- Supabase Postgres as cache only, RLS enforced on every table

## \- Clerk auth with JWT mapping to tenant\_id

## \- Stripe Checkout for deposit and full payment modes

## \- Zod for runtime validation, JSON Schema draft-07 for vault schemas

## \- Vitest for all testing

## \- GitHub Actions CI

## 

## \## Directory Structure

## \- orchestrator/ for pipeline stages and pricing engine

## \- vault/ for canonical storage and shared schemas

## \- supabase/ for SQL migrations

## \- app/ for Next.js with api/, dashboard, and public proposal pages

## \- lib/ for shared types, MCP tool interfaces, utilities

## \- tests/ with unit/, pricing/, integration/, golden-corpus/ subdirectories

## \- scripts/ for bootstrap, migration, and seed scripts

## \- .claude/commands/ for slash commands

## \- .claude/skills/ for auto-invoked skills

## 

## \## Coding Standards

## \- Functions under 30 lines where possible

## \- Pure functions preferred, side effects only through MCP tool contracts

## \- No any types, no implicit defaults, no undocumented fields

## \- Every PR includes tests for changed behavior

## \- Monetary values use 2 decimal places with banker's rounding via toFixed(2)

## \- Small PRs only, one stage per PR maximum

## 

## \## Key Invariants

## 1\. No state may exist only in memory

## 2\. Every mutation appends an event

## 3\. Pricing engine has zero side effects

## 4\. Webhook handlers are idempotent

## 5\. Cache is rebuildable from Vault alone

## 6\. No business logic inside prompts

## 7\. No undocumented fields may be invented

## 8\. All LLM output must be structured JSON validated before write

## 

## \## Testing Requirements

## \- Schema sync tests verify Zod matches JSON Schema

## \- Pricing determinism test runs 100 identical iterations

## \- Golden corpus regression tests for every extraction bug fix

## \- Integration tests use mocked MCP tools

## \- CI must pass before any merge

