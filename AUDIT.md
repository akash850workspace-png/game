# Settlement Simulation - Complete Architecture Audit

## Executive Summary

The current simulation has **critical architectural flaws** that prevent genuine causality and emergence. While the code compiles and runs, it does NOT produce real causal chains. Every event is essentially independent, with fake parent-child relationships.

---

## Critical Issues Identified

### 1. FAKE CAUSALITY (CRITICAL)

**Problem:** Events are created with empty `parentIds` arrays. No actual causal reasoning occurs.

**Evidence:**
```typescript
// In simulation-engine.ts, line 254-261
const event = createEvent(
  state,
  decision.action,
  [npc.id],
  [],
  decision.result,
  decision
  // parentIds is NOT provided - defaults to []
);
```

**Impact:** Cannot answer "why did this happen?" No causal chains exist.

---

### 2. DECISIONS DON'T EXPLAIN WHY (CRITICAL)

**Problem:** The `makeDecision` function returns a decision but doesn't track WHY each action scored the way it did.

**Evidence:**
```typescript
// In causal-engine.ts, line 126-130
const scored = available.map(a => ({
  action: a.id,
  score: a.utility(npc, pressures, state),
  def: a
}));
```

The score is computed but the breakdown (pressures, traits, memories, relationships, goals) is lost.

**Impact:** Cannot explain NPC behavior. Cannot debug why an NPC chose a specific action.

---

### 3. MEMORY DOESN'T INFLUENCE DECISIONS (CRITICAL)

**Problem:** Memories are created but never read during decision-making.

**Evidence:**
```typescript
// In causal-engine.ts, line 27-66
export function computePressures(npc: NPC, state: WorldState): Pressures {
  const pressures: Pressures = {
    hunger: npc.hunger,
    rest: npc.rest,
    // ... other pressures
    vengeance: 0,  // Computed from memories but not used in decisions
  };
  
  // Calculate vengeance from memories
  const grievances = npc.memories.filter(m => m.valence < -0.5);
  pressures.vengeance = Math.min(1, grievances.length * 0.2 * npc.traits.temper);
  
  return pressures;
}
```

While `vengeance` is computed from memories, the individual memories themselves don't influence specific actions. A memory of being stolen from should make an NPC more likely to steal, but this connection doesn't exist.

**Impact:** Memories are decorative. They don't affect behavior.

---

### 4. KNOWLEDGE VS REALITY NOT IMPLEMENTED (CRITICAL)

**Problem:** NPCs have `knowledge.witnessedEvents` but this is never used in decisions.

**Evidence:**
```typescript
// In types.ts, line 213-217
export interface Knowledge {
  witnessedEvents: Set<string>;
  heardEvents: Set<string>;
  beliefs: Map<string, Belief>;
}
```

This data structure exists but is never read during `makeDecision` or `computePressures`.

**Impact:** NPCs act as if they know everything. No information asymmetry. No secrets. No misunderstandings.

---

### 5. RELATIONSHIPS DON'T INFLUENCE DECISIONS (CRITICAL)

**Problem:** Relationships are updated but never read during decision-making.

**Evidence:**
```typescript
// In causal-engine.ts, line 263-287
export function applyRelationshipChanges(state: WorldState, changes: RelationshipChange[]): void {
  // Relationships are updated...
}

// But in computePressures, relationships are only used for "belonging"
const closeRelationships = Array.from(npc.relationships.values()).filter(r => r.affinity > 0.3);
pressures.belonging = Math.max(0, 1 - closeRelationships.length * 0.2);
```

Relationships affect `belonging` pressure but don't influence specific actions toward specific NPCs. An NPC with high affinity toward someone should be more likely to help them, but this doesn't happen.

**Impact:** Social dynamics are fake. Relationships are decorative.

---

### 6. GOALS DON'T INFLUENCE DECISIONS (CRITICAL)

**Problem:** Goals are created but never considered in `makeDecision`.

**Evidence:**
```typescript
// In causal-engine.ts, line 372-418
export function updateGoals(npc: NPC, state: WorldState, event: SimEvent): void {
  // Goals are created...
  // But never read during decision-making
}
```

An NPC with a goal to "repay debt" should be more likely to choose "work", but goals are never checked in `computePressures` or action utility functions.

**Impact:** Goals are decorative. NPCs don't pursue them.

---

### 7. PERFORMANCE CATASTROPHE (CRITICAL)

**Problem:** Multiple O(n²) algorithms that will not scale.

**Evidence:**

**Issue 1: updatePerception scans ALL NPCs**
```typescript
// In causal-engine.ts, line 324-366
export function updatePerception(state: WorldState, event: SimEvent): void {
  // Nearby NPCs may witness (simplified - in same district)
  for (const [npcId, npc] of state.npcs) {  // O(n)
    if (!npc.alive) continue;
    // ...
    const actorInSameLocation = event.actorIds.some(aId => {  // O(actors)
      const actor = state.npcs.get(aId);
      return actor && actor.district === npc.district;
    });
    // ...
  }
}
```

For every event, this scans ALL NPCs. With 1000 NPCs and 100,000 events, this is 100,000,000 operations.

**Issue 2: findUnresolvedSituations scans ALL events**
```typescript
// In story-engine.ts, line 49-63
function findUnresolvedSituations(state: WorldState): UnresolvedSituation[] {
  const situations: UnresolvedSituation[] = [];
  
  for (const event of state.events.values()) {  // O(e)
    if (isUnresolvedSituation(event, state)) {
      // ...
    }
  }
  
  return situations;
}
```

This runs every 30 ticks and scans ALL events. With 100,000 events, this is 3,333 scans of 100,000 events = 333,300,000 operations.

**Issue 3: No indexes**
```typescript
// No indexes exist for:
// - NPCs by district
// - NPCs by faction
// - Events by type
// - Events by NPC
// - Relationships by NPC
```

Every query requires a full scan.

**Impact:** Simulation will not scale beyond ~100 NPCs. Will be unusably slow for 1000+ NPCs.

---

### 8. DETERMINISM ISSUES (HIGH)

**Problem:** Need to verify there's no `Math.random()` usage.

**Evidence:**
```bash
# Need to search for Math.random in all files
grep -r "Math.random" src/
```

If `Math.random()` is used anywhere in the simulation logic, determinism is broken.

**Impact:** Same seed may produce different results. Cannot reproduce bugs.

---

### 9. MISSING CAUSAL CHAINS (CRITICAL)

**Problem:** No system to track state changes and link them to future decisions.

**Evidence:**
- `createEvent` accepts `parentIds` but they're rarely provided
- No mechanism to track "event A changed state X, which caused NPC B to make decision Y"
- No causal edge validation

**Impact:** Cannot prove causality. Cannot trace "why did this happen?"

---

### 10. STORY SYSTEM IS HEURISTIC (HIGH)

**Problem:** Stories are detected based on event types, not actual causal chains.

**Evidence:**
```typescript
// In story-engine.ts, line 65-111
function isUnresolvedSituation(event: SimEvent, state: WorldState): boolean {
  // Debt situations
  if (event.type === 'debt_created') {
    // ...
  }
  
  // Crime situations
  if (event.type === 'theft' || event.type === 'murder' || event.type === 'assault') {
    // ...
  }
  
  // Revenge goals
  if (event.type === 'betrayal' || event.type === 'theft' || event.type === 'murder_attempt') {
    // ...
  }
  
  // Feud situations
  if (event.type === 'argument' || event.type === 'fight') {
    // ...
  }
  
  return false;
}
```

Stories are detected by checking event types, not by tracing causal chains. A story might be "theft → revenge" but there's no proof that the revenge was actually caused by the theft.

**Impact:** Stories are not grounded in real causality. Cannot trace missions back to root causes.

---

## Architecture Plan

### Phase 1: Core Causal Infrastructure

**Goal:** Establish real causal chains.

**Changes:**
1. Create `CausalTracker` to track state changes
2. Modify `createEvent` to require `parentIds`
3. Add causal edge validation
4. Track which state changes affect which decisions

**Files:**
- `src/core/causal-tracker.ts` (NEW)
- `src/causal-engine.ts` (MODIFY)
- `src/simulation-engine.ts` (MODIFY)

---

### Phase 2: Decision Score Breakdown

**Goal:** Explain why NPCs make decisions.

**Changes:**
1. Create `DecisionAnalyzer` to break down scores
2. Modify `makeDecision` to return score breakdown
3. Track which factors influenced each decision

**Files:**
- `src/core/decision-analyzer.ts` (NEW)
- `src/causal-engine.ts` (MODIFY)

---

### Phase 3: Memory Integration

**Goal:** Make memories influence decisions.

**Changes:**
1. Modify `computePressures` to consider memories
2. Add memory-based action modifiers
3. Connect memories to specific actions

**Files:**
- `src/causal-engine.ts` (MODIFY)
- `src/simulation-engine.ts` (MODIFY)

---

### Phase 4: Knowledge System

**Goal:** Implement knowledge vs reality.

**Changes:**
1. Modify `computePressures` to consider knowledge
2. Add information propagation system
3. Make knowledge affect decisions

**Files:**
- `src/core/knowledge-system.ts` (NEW)
- `src/causal-engine.ts` (MODIFY)

---

### Phase 5: Relationship Integration

**Goal:** Make relationships influence decisions.

**Changes:**
1. Modify action utility functions to consider relationships
2. Connect relationships to memories and goals
3. Implement social dynamics

**Files:**
- `src/simulation-engine.ts` (MODIFY)

---

### Phase 6: Goal Integration

**Goal:** Make goals influence decisions.

**Changes:**
1. Modify `computePressures` to consider goals
2. Add goal-based action modifiers
3. Connect goals to memories and relationships

**Files:**
- `src/causal-engine.ts` (MODIFY)

---

### Phase 7: Performance Optimization

**Goal:** Make simulation scale to 1000+ NPCs.

**Changes:**
1. Add indexes for fast lookups
2. Implement incremental updates
3. Add caching for expensive calculations
4. Optimize hot paths

**Files:**
- `src/core/indexes.ts` (NEW)
- `src/causal-engine.ts` (MODIFY)
- `src/simulation-engine.ts` (MODIFY)

---

### Phase 8: Validation and Testing

**Goal:** Prove the system works.

**Changes:**
1. Create controlled causality test
2. Implement invariant tests
3. Run 100-year simulation
4. Verify determinism
5. Measure performance

**Files:**
- `src/core/validation.ts` (NEW)
- `src/core/tests.ts` (NEW)

---

## Implementation Priority

1. **Phase 1: Core Causal Infrastructure** - CRITICAL
   - Without this, nothing else matters
   
2. **Phase 2: Decision Score Breakdown** - CRITICAL
   - Without this, cannot explain behavior
   
3. **Phase 7: Performance Optimization** - CRITICAL
   - Without this, simulation won't scale
   
4. **Phase 3-6: Integration** - HIGH
   - These make the simulation feel alive
   
5. **Phase 8: Validation** - HIGH
   - Proves the system works

---

## Estimated Effort

- Phase 1: 4-6 hours
- Phase 2: 2-3 hours
- Phase 3: 2-3 hours
- Phase 4: 3-4 hours
- Phase 5: 2-3 hours
- Phase 6: 2-3 hours
- Phase 7: 4-6 hours
- Phase 8: 3-4 hours

**Total: 22-32 hours**

---

## Success Criteria

The simulation is successful when:

1. **Real Causality:** Every event can be traced back to its root cause
2. **Real Emergence:** Stories emerge from causal chains, not heuristics
3. **Explainable Behavior:** Can answer "why did this NPC do this?"
4. **Deterministic:** Same seed produces identical results
5. **Scalable:** Can simulate 1000+ NPCs at acceptable speed
6. **Testable:** Automated tests prove correctness

---

## Next Steps

1. Implement Phase 1 (Causal Infrastructure)
2. Implement Phase 2 (Decision Breakdown)
3. Implement Phase 7 (Performance)
4. Implement Phases 3-6 (Integration)
5. Implement Phase 8 (Validation)
6. Run 100-year simulation and verify results
7. Provide complete causal chain example

---

## Conclusion

The current simulation is a **shell** - it has the structure of a causal system but lacks the substance. Every critical system (causality, memory, knowledge, relationships, goals) is either not implemented or not integrated.

This is not a minor bug fix. This is a **complete architectural overhaul** that requires rebuilding the core systems from the ground up.

The good news: the type system and basic structure are sound. The bad news: everything needs to be connected properly.

Let's begin.
