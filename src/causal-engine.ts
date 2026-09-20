// ============================================================
// CAUSAL ENGINE - Core Decision Pipeline
// ============================================================
// Implements: STATE → PERCEPTION → PRESSURES → ACTIONS → SCORES → SELECTION → OUTCOME → CONSEQUENCES → MEMORY → RELATIONSHIPS → NEW PRESSURES

import type { NPC, SimEvent, StateChange, RelationshipChange, MemoryCreation, WorldState } from './types';

// ============================================================
// PRESSURE CALCULATION
// ============================================================

export interface Pressures {
  hunger: number;        // 0-1, need for food
  rest: number;          // 0-1, need for sleep
  safety: number;        // 0-1, fear level
  belonging: number;     // 0-1, loneliness
  wealthNeed: number;    // 0-1, need for money
  statusNeed: number;    // 0-1, need for respect
  health: number;        // 0-1, health concern
  vengeance: number;     // 0-1, desire for revenge
  curiosity: number;     // 0-1, desire to explore
  piety: number;         // 0-1, religious drive
  factionLoyalty: number;// 0-1, faction duty
  debt: number;          // 0-1, debt pressure
}

export function computePressures(npc: NPC, state: WorldState): Pressures {
  const pressures: Pressures = {
    hunger: npc.hunger,
    rest: npc.rest,
    safety: 1 - npc.health, // Low health = high safety concern
    belonging: 0,
    wealthNeed: 0,
    statusNeed: 0,
    health: 1 - npc.health,
    vengeance: 0,
    curiosity: npc.traits.curiosity,
    piety: npc.traits.piety,
    factionLoyalty: 0,
    debt: 0,
  };

  // Calculate belonging from relationships
  const closeRelationships = Array.from(npc.relationships.values()).filter(r => r.affinity > 0.3);
  pressures.belonging = Math.max(0, 1 - closeRelationships.length * 0.2);

  // Calculate wealth need from coin and debts
  const totalDebt = npc.debts.reduce((sum, d) => sum + d.amount, 0);
  pressures.wealthNeed = Math.max(0, 1 - npc.coin / 100) + Math.min(1, totalDebt / 50);
  pressures.debt = Math.min(1, totalDebt / 100);

  // Calculate status need from reputation and ambition
  const avgReputation = Object.values(npc.reputation).reduce((a, b) => a + b, 0) / 4;
  pressures.statusNeed = npc.traits.ambition * (1 - avgReputation);

  // Calculate vengeance from memories - MEMORY INTEGRATION
  const grievances = npc.memories.filter(m => m.valence < -0.5);
  pressures.vengeance = Math.min(1, grievances.length * 0.2 * npc.traits.temper);
  
  // Memory-based pressure modifications
  for (const memory of npc.memories) {
    const event = state.events.get(memory.eventId);
    if (!event) continue;
    
    // Theft memories increase caution and vengeance
    if (event.type === 'theft' && event.targetIds.includes(npc.id)) {
      pressures.safety = Math.min(1, pressures.safety + memory.salience * 0.2);
      pressures.vengeance = Math.min(1, pressures.vengeance + Math.abs(memory.valence) * 0.3);
    }
    
    // Violence memories increase fear
    if ((event.type === 'fight' || event.type === 'assault') && event.targetIds.includes(npc.id)) {
      pressures.safety = Math.min(1, pressures.safety + memory.salience * 0.3);
    }
    
    // Positive social memories reduce loneliness
    if (event.type === 'socialize' && event.actorIds.includes(npc.id)) {
      pressures.belonging = Math.max(0, pressures.belonging - memory.salience * 0.1);
    }
    
    // Economic success/failure memories affect wealth need
    if (event.type === 'work' && event.actorIds.includes(npc.id)) {
      const coinChange = event.stateChanges.find(c => c.property === 'coin');
      if (coinChange && coinChange.delta && coinChange.delta < 0) {
        pressures.wealthNeed = Math.min(1, pressures.wealthNeed + memory.salience * 0.2);
      }
    }
  }
  
  // GOAL INTEGRATION: Active goals influence pressures
  for (const goal of npc.goals) {
    if (goal.completed) continue;
    
    // Revenge goals increase vengeance pressure
    if (goal.type === 'revenge') {
      pressures.vengeance = Math.min(1, pressures.vengeance + goal.priority * 0.4);
    }
    
    // Debt repayment goals increase wealth need
    if (goal.type === 'repay_debt') {
      pressures.wealthNeed = Math.min(1, pressures.wealthNeed + goal.priority * 0.3);
      pressures.debt = Math.min(1, pressures.debt + goal.priority * 0.2);
    }
    
    // Accumulate wealth goals increase wealth need
    if (goal.type === 'accumulate_wealth') {
      pressures.wealthNeed = Math.min(1, pressures.wealthNeed + goal.priority * 0.2);
    }
    
    // Find love goals increase belonging need
    if (goal.type === 'find_love') {
      pressures.belonging = Math.min(1, pressures.belonging + goal.priority * 0.3);
    }
    
    // Gain status goals increase status need
    if (goal.type === 'gain_status') {
      pressures.statusNeed = Math.min(1, pressures.statusNeed + goal.priority * 0.3);
    }
  }

  // Calculate faction loyalty
  if (npc.faction) {
    pressures.factionLoyalty = npc.traits.loyalty * 0.5;
  }

  return pressures;
}

// ============================================================
// ACTION DEFINITION
// ============================================================

export interface ActionDefinition {
  id: string;
  name: string;
  
  // Preconditions
  preconditions: (npc: NPC, state: WorldState) => boolean;
  
  // Utility calculation
  utility: (npc: NPC, pressures: Pressures, state: WorldState) => number;
  
  // Success probability
  successChance: (npc: NPC, state: WorldState, target?: NPC) => number;
  
  // Execution
  execute: (npc: NPC, state: WorldState, success: boolean, target?: NPC) => ActionResult;
}

export interface ActionResult {
  stateChanges: StateChange[];
  relationshipChanges: RelationshipChange[];
  memoryCreations: MemoryCreation[];
  description: string;
  salience: number;
  tags: string[];
}

// ============================================================
// DECISION PIPELINE
// ============================================================

export interface DecisionResult {
  action: string;
  score: number;
  roll: number;
  threshold: number;
  success: boolean;
  result: ActionResult;
  pressures: Pressures;
  alternatives: { action: string; score: number }[];
}

export function makeDecision(
  npc: NPC,
  state: WorldState,
  actions: ActionDefinition[]
): DecisionResult | null {
  // Step 1: Compute pressures
  const pressures = computePressures(npc, state);

  // Step 2: Filter available actions
  const available = actions.filter(a => a.preconditions(npc, state));
  if (available.length === 0) return null;

  // Step 3: Score each action
  const scored = available.map(a => ({
    action: a.id,
    score: a.utility(npc, pressures, state),
    def: a
  }));

  // Step 4: Select action using softmax
  const temperature = 0.3 + npc.traits.temper * 0.4;
  const selected = softmaxSelection(scored, temperature, state.rng);

  // Step 5: Determine success
  const roll = state.rng();
  const threshold = selected.def.successChance(npc, state);
  const success = roll < threshold;

  // Step 6: Execute action
  const result = selected.def.execute(npc, state, success);

  // Step 7: Build alternatives list
  const alternatives = scored
    .filter(s => s.action !== selected.action)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => ({ action: s.action, score: s.score }));

  return {
    action: selected.action,
    score: selected.score,
    roll,
    threshold,
    success,
    result,
    pressures,
    alternatives
  };
}

function softmaxSelection(
  options: { action: string; score: number; def: ActionDefinition }[],
  temperature: number,
  rng: () => number
): { action: string; score: number; def: ActionDefinition } {
  const maxScore = Math.max(...options.map(o => o.score));
  const exps = options.map(o => ({
    ...o,
    exp: Math.exp((o.score - maxScore) / Math.max(temperature, 0.01))
  }));
  
  const sum = exps.reduce((a, b) => a + b.exp, 0);
  const r = rng();
  let cumulative = 0;
  
  for (const e of exps) {
    cumulative += e.exp / sum;
    if (r <= cumulative) return e;
  }
  
  return exps[exps.length - 1];
}

// ============================================================
// EVENT CREATION
// ============================================================

export function createEvent(
  state: WorldState,
  type: string,
  actorIds: number[],
  targetIds: number[],
  result: ActionResult,
  decision?: DecisionResult,
  parentIds: string[] = []
): SimEvent {
  const eventId = `E${state.nextEventId++}`;
  
  const event: SimEvent = {
    id: eventId,
    tick: state.tick,
    type,
    parentIds,
    childIds: [],
    actorIds,
    targetIds,
    witnessIds: [], // Will be populated by perception system
    stateChanges: result.stateChanges,
    decision: decision ? {
      pressures: { ...decision.pressures },
      availableActions: decision.alternatives,
      chosenAction: decision.action,
      chosenScore: decision.score,
      roll: decision.roll,
      threshold: decision.threshold,
      success: decision.success
    } : undefined,
    effects: {
      relationshipChanges: result.relationshipChanges,
      memoryCreations: result.memoryCreations
    },
    salience: result.salience,
    tags: result.tags,
    description: result.description
  };

  // Add to event graph
  state.events.set(eventId, event);
  
  // Update parent-child relationships
  for (const parentId of parentIds) {
    const parent = state.events.get(parentId);
    if (parent) {
      parent.childIds.push(eventId);
    }
  }

  return event;
}

// ============================================================
// STATE APPLICATION
// ============================================================

export function applyStateChanges(state: WorldState, changes: StateChange[]): void {
  for (const change of changes) {
    if (change.type === 'npc') {
      const npc = state.npcs.get(parseInt(change.targetId));
      if (npc) {
        (npc as any)[change.property] = change.newValue;
      }
    } else if (change.type === 'economy') {
      const resource = state.economy.resources.get(change.targetId);
      if (resource) {
        (resource as any)[change.property] = change.newValue;
      }
    }
  }
}

export function applyRelationshipChanges(state: WorldState, changes: RelationshipChange[]): void {
  for (const change of changes) {
    const npc1 = state.npcs.get(change.npc1Id);
    const npc2 = state.npcs.get(change.npc2Id);
    
    if (npc1 && npc2) {
      // Update npc1's relationship with npc2
      let rel1 = npc1.relationships.get(change.npc2Id);
      if (!rel1) {
        rel1 = { affinity: 0, trust: 0, fear: 0, respect: 0, resentment: 0, history: [] };
        npc1.relationships.set(change.npc2Id, rel1);
      }
      (rel1 as any)[change.property] = change.newValue;
      
      // Update npc2's relationship with npc1 (may differ)
      let rel2 = npc2.relationships.get(change.npc1Id);
      if (!rel2) {
        rel2 = { affinity: 0, trust: 0, fear: 0, respect: 0, resentment: 0, history: [] };
        npc2.relationships.set(change.npc1Id, rel2);
      }
      // Reverse relationship changes are typically smaller
      (rel2 as any)[change.property] = change.newValue * 0.8;
    }
  }
}

export function applyMemoryCreations(state: WorldState, creations: MemoryCreation[]): void {
  for (const creation of creations) {
    const npc = state.npcs.get(creation.npcId);
    if (npc) {
      const event = state.events.get(creation.eventId);
      if (event) {
        const memory: any = {
          id: `M${npc.memories.length}`,
          eventId: creation.eventId,
          tick: state.tick,
          valence: creation.valence,
          salience: creation.salience,
          confidence: creation.confidence,
          source: creation.source,
          participants: event.actorIds.concat(event.targetIds),
          description: event.description
        };
        
        // Add memory (with bounded capacity)
        if (npc.memories.length >= 30) {
          // Remove least salient memory
          const minSalience = Math.min(...npc.memories.map(m => m.salience));
          const minIdx = npc.memories.findIndex(m => m.salience === minSalience);
          npc.memories.splice(minIdx, 1);
        }
        npc.memories.push(memory);
      }
    }
  }
}

// ============================================================
// PERCEPTION SYSTEM (Knowledge vs Reality)
// ============================================================

export function updatePerception(state: WorldState, event: SimEvent): void {
  // Witnesses directly perceive the event
  for (const witnessId of event.witnessIds) {
    const npc = state.npcs.get(witnessId);
    if (npc) {
      npc.knowledge.witnessedEvents.add(event.id);
    }
  }
  
  // Actors know about the event
  for (const actorId of event.actorIds) {
    const npc = state.npcs.get(actorId);
    if (npc) {
      npc.knowledge.witnessedEvents.add(event.id);
    }
  }
  
  // Targets know about the event
  for (const targetId of event.targetIds) {
    const npc = state.npcs.get(targetId);
    if (npc) {
      npc.knowledge.witnessedEvents.add(event.id);
    }
  }
  
  // Nearby NPCs may witness (simplified - in same district)
  for (const [npcId, npc] of state.npcs) {
    if (!npc.alive) continue;
    if (event.actorIds.includes(npcId)) continue;
    if (event.targetIds.includes(npcId)) continue;
    
    // Check if in same location
    const actorInSameLocation = event.actorIds.some(aId => {
      const actor = state.npcs.get(aId);
      return actor && actor.district === npc.district;
    });
    
    if (actorInSameLocation && state.rng() < 0.3) {
      event.witnessIds.push(npcId);
      npc.knowledge.witnessedEvents.add(event.id);
    }
  }
}

// ============================================================
// GOAL MANAGEMENT
// ============================================================

export function updateGoals(npc: NPC, state: WorldState, event: SimEvent): void {
  // Check if event affects existing goals
  for (const goal of npc.goals) {
    if (goal.relatedEventIds.includes(event.id)) {
      // Update goal progress based on event
      if (event.type === 'debt_repaid' && goal.type === 'repay_debt') {
        goal.completed = true;
      }
    }
  }
  
  // Generate new goals from event
  if (event.type === 'theft' && event.targetIds.includes(npc.id)) {
    // Victim of theft may seek revenge
    if (npc.traits.temper > 0.5 && state.rng() < 0.6) {
      const thiefId = event.actorIds[0];
      if (!npc.goals.some(g => g.type === 'revenge' && g.targetId === thiefId)) {
        npc.goals.push({
          id: `G${npc.goals.length}`,
          type: 'revenge',
          targetId: thiefId,
          description: `Seek revenge on ${state.npcs.get(thiefId)?.name} for theft`,
          priority: 0.7,
          createdTick: state.tick,
          completed: false,
          relatedEventIds: [event.id]
        });
      }
    }
  }
  
  if (event.type === 'betrayal' && event.targetIds.includes(npc.id)) {
    // Betrayal creates strong revenge goal
    const betrayerId = event.actorIds[0];
    if (!npc.goals.some(g => g.type === 'revenge' && g.targetId === betrayerId)) {
      npc.goals.push({
        id: `G${npc.goals.length}`,
        type: 'revenge',
        targetId: betrayerId,
        description: `Seek revenge on ${state.npcs.get(betrayerId)?.name} for betrayal`,
        priority: 0.9,
        createdTick: state.tick,
        completed: false,
        relatedEventIds: [event.id]
      });
    }
  }
}
