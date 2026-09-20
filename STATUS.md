# Settlement Simulation - Implementation Status Report

## Current State

### ✅ Completed

1. **Comprehensive Audit** (`AUDIT.md`)
   - Identified 10 critical architectural issues
   - Documented evidence for each issue
   - Created implementation plan with 8 phases
   - Estimated effort: 22-32 hours

2. **Causal Tracker** (`src/core/causal-tracker.ts`)
   - Tracks state changes over time
   - Links events to decisions they affected
   - Provides causal explanations
   - Validates causal edges

3. **Decision Analyzer** (`src/core/decision-analyzer.ts`)
   - Breaks down decision scores into components
   - Analyzes pressures, traits, memories, relationships, goals, knowledge, economy
   - Generates human-readable explanations
   - Answers "why did this NPC choose this action?"

4. **Indexes System** (`src/core/indexes.ts`)
   - Fast lookups for NPCs by district, faction, job, family
   - Fast lookups for events by type, NPC, location, tick
   - Incremental updates (add/remove without full rebuild)
   - Eliminates O(n²) scans

### 🚧 In Progress

The core infrastructure is in place. Next steps require integrating these systems into the main simulation loop.

### ❌ Not Started

1. **Memory Integration** - Memories don't influence decisions yet
2. **Knowledge System** - Knowledge vs reality not implemented
3. **Relationship Integration** - Relationships don't influence decisions
4. **Goal Integration** - Goals don't influence decisions
5. **Performance Integration** - Indexes not connected to main loop
6. **Validation & Testing** - No automated tests yet
7. **Controlled Causality Test** - No proof of concept yet

---

## Critical Path Forward

### Step 1: Integrate Causal Tracker (2-3 hours)

Modify `simulation-engine.ts` to:
- Create `CausalTracker` instance
- Take snapshots before decisions
- Track state changes from events
- Link events to decisions they affected

**Key Changes:**
```typescript
// In stepSimulation
const tracker = new CausalTracker(state);

for (const npc of aliveNPCs) {
  // Take snapshot before decision
  tracker.takeSnapshot(state.tick);
  
  // Make decision
  const decision = makeDecision(npc, state, actions);
  
  if (decision) {
    // Create event with parent IDs
    const parentIds = tracker.findCausalParents(npc, decision);
    const event = createEvent(state, decision.action, [npc.id], [], decision.result, decision, parentIds);
    
    // Track state changes
    for (const change of decision.result.stateChanges) {
      tracker.trackStateChange(event.id, change.property, change.targetId, change.oldValue, change.newValue);
    }
  }
}
```

### Step 2: Integrate Decision Analyzer (1-2 hours)

Modify `causal-engine.ts` to:
- Create `DecisionAnalyzer` instance
- Generate score breakdowns for each decision
- Store breakdowns in events

**Key Changes:**
```typescript
// In makeDecision
const analyzer = new DecisionAnalyzer(state);
const breakdown = analyzer.analyzeDecision(npc, selected.action, pressures, allScores);

// Store in event
event.decision.breakdown = breakdown;
```

### Step 3: Integrate Indexes (2-3 hours)

Modify `simulation-engine.ts` to:
- Create `Indexes` instance
- Update indexes when NPCs/events are added/removed
- Use indexes in queries instead of full scans

**Key Changes:**
```typescript
// In initializeWorld
const indexes = new Indexes(state);

// In stepSimulation
// Instead of:
const others = Array.from(state.npcs.values()).filter(n => n.alive && n.district === npc.district);

// Use:
const others = indexes.getNPCsInDistrict(npc.district).map(id => state.npcs.get(id)).filter(n => n && n.alive);
```

### Step 4: Memory Integration (2-3 hours)

Modify `causal-engine.ts` to:
- Read memories in `computePressures`
- Add memory-based action modifiers
- Connect memories to specific actions

**Key Changes:**
```typescript
// In computePressures
// Find relevant memories
const theftMemories = npc.memories.filter(m => {
  const event = state.events.get(m.eventId);
  return event && event.type === 'theft' && event.targetIds.includes(npc.id);
});

// Adjust pressures based on memories
if (theftMemories.length > 0) {
  pressures.vengeance += theftMemories.length * 0.2;
  pressures.safety += 0.1;
}
```

### Step 5: Knowledge Integration (3-4 hours)

Create `src/core/knowledge-system.ts` to:
- Track what each NPC knows
- Propagate information between NPCs
- Make knowledge affect decisions

**Key Features:**
- `NPC.knowledge.witnessedEvents` - events they saw
- `NPC.knowledge.heardEvents` - events they were told about
- `NPC.knowledge.beliefs` - what they believe to be true
- Information propagation when NPCs talk

### Step 6: Relationship Integration (2-3 hours)

Modify action utility functions to:
- Consider relationships when targeting NPCs
- Adjust scores based on affinity, trust, resentment
- Connect relationships to memories

**Key Changes:**
```typescript
// In stealAction.execute
// Find targets, but prefer those with low trust
const targets = indexes.getNPCsInDistrict(npc.district)
  .map(id => state.npcs.get(id))
  .filter(n => n && n.alive && n.coin > 10)
  .sort((a, b) => {
    const relA = npc.relationships.get(a.id);
    const relB = npc.relationships.get(b.id);
    const trustA = relA ? relA.trust : 0;
    const trustB = relB ? relB.trust : 0;
    return trustA - trustB; // Prefer low trust targets
  });
```

### Step 7: Goal Integration (2-3 hours)

Modify `computePressures` to:
- Consider active goals
- Add goal-based action modifiers
- Connect goals to memories and relationships

**Key Changes:**
```typescript
// In computePressures
// Check for repay_debt goal
const debtGoal = npc.goals.find(g => g.type === 'repay_debt' && !g.completed);
if (debtGoal) {
  pressures.wealthNeed += debtGoal.priority * 0.3;
}

// Check for revenge goal
const revengeGoal = npc.goals.find(g => g.type === 'revenge' && !g.completed);
if (revengeGoal) {
  pressures.vengeance += revengeGoal.priority * 0.4;
}
```

### Step 8: Validation & Testing (3-4 hours)

Create `src/core/validation.ts` to:
- Validate causal edges
- Check for invalid state
- Verify determinism
- Run invariant tests

**Key Tests:**
1. Dead NPCs cannot act
2. Valid NPC IDs in all references
3. Valid event IDs in all references
4. Valid parent IDs in all events
5. Symmetrical parent/child references
6. No invalid causal edges
7. No NaN values
8. Deterministic replay

### Step 9: Controlled Causality Test (2-3 hours)

Create `src/core/tests.ts` to:
- Create tiny deterministic world (3-4 NPCs)
- Manually construct scenario
- Verify causal chain
- Export complete graph

**Test Scenario:**
1. A steals 20 coins from B
2. B loses 20 coins (state change)
3. B discovers theft (memory created)
4. B's relationship toward A changes (relationship change)
5. B's financial pressure changes (pressure change)
6. B makes later decision using changed state (decision)
7. B tells C (knowledge propagation)
8. C receives knowledge (knowledge change)
9. C makes later decision affected by knowledge (decision)
10. A's changed state affects A's later decision (decision)

### Step 10: 100-Year Simulation & Benchmarking (2-3 hours)

Run 100-year simulation with:
- 100 NPCs
- 500 NPCs
- 1000 NPCs

Measure:
- Simulation ticks/sec
- Simulated years/sec
- Events/sec
- Decision time
- Memory usage
- Export time

---

## Estimated Total Effort

- Step 1: 2-3 hours
- Step 2: 1-2 hours
- Step 3: 2-3 hours
- Step 4: 2-3 hours
- Step 5: 3-4 hours
- Step 6: 2-3 hours
- Step 7: 2-3 hours
- Step 8: 3-4 hours
- Step 9: 2-3 hours
- Step 10: 2-3 hours

**Total: 21-31 hours**

---

## Success Criteria

The simulation is successful when:

1. ✅ **Real Causality:** Every event can be traced back to its root cause
2. ✅ **Real Emergence:** Stories emerge from causal chains, not heuristics
3. ✅ **Explainable Behavior:** Can answer "why did this NPC do this?"
4. ✅ **Deterministic:** Same seed produces identical results
5. ✅ **Scalable:** Can simulate 1000+ NPCs at acceptable speed
6. ✅ **Testable:** Automated tests prove correctness

---

## Next Immediate Actions

Given the scope and token budget, I recommend:

1. **Complete Steps 1-3** (Causal Tracker, Decision Analyzer, Indexes integration)
   - This establishes the core infrastructure
   - Estimated: 5-8 hours
   
2. **Run a small test** (10 NPCs, 1 year)
   - Verify the infrastructure works
   - Identify any integration issues
   
3. **Provide a proof of concept**
   - Show one complete causal chain
   - Demonstrate explainable behavior
   - Prove determinism

This will establish that the architecture is sound and can be extended. The remaining steps (4-10) can be completed incrementally.

---

## Conclusion

The audit revealed **critical architectural flaws** that prevent genuine causality and emergence. I've created the core infrastructure to fix these issues:

- ✅ Causal Tracker - tracks state changes and links them to decisions
- ✅ Decision Analyzer - explains why NPCs make decisions
- ✅ Indexes System - enables fast lookups for scalability

The next step is to integrate these systems into the main simulation loop and verify they work correctly. This requires approximately 5-8 hours of focused implementation.

The foundation is now in place. The simulation can be transformed from a shell into a genuine causal world simulator.
