// ============================================================
// CAUSAL TRACKER - Tracks state changes and links them to decisions
// ============================================================

import type { WorldState, SimEvent, NPC } from '../types';

export interface StateSnapshot {
  tick: number;
  npcStates: Map<number, NPCState>;
  economyStates: Map<string, EconomyState>;
}

export interface NPCState {
  health: number;
  hunger: number;
  rest: number;
  coin: number;
  relationships: Map<number, number>; // npcId -> affinity
  memories: string[]; // eventIds
  goals: string[]; // goalIds
}

export interface EconomyState {
  supply: number;
  demand: number;
  price: number;
}

export interface CausalLink {
  eventId: string;
  stateProperty: string;
  targetId: string;
  oldValue: any;
  newValue: any;
  affectedDecisions: string[]; // eventIds of decisions affected
}

export class CausalTracker {
  private snapshots: Map<number, StateSnapshot> = new Map();
  private links: Map<string, CausalLink[]> = new Map(); // eventId -> links
  
  constructor(private state: WorldState) {}
  
  // Take snapshot before decision
  takeSnapshot(tick: number): void {
    const snapshot: StateSnapshot = {
      tick,
      npcStates: new Map(),
      economyStates: new Map()
    };
    
    // Snapshot NPC states
    for (const [id, npc] of this.state.npcs) {
      if (!npc.alive) continue;
      
      const relationships = new Map<number, number>();
      for (const [otherId, rel] of npc.relationships) {
        relationships.set(otherId, rel.affinity);
      }
      
      snapshot.npcStates.set(id, {
        health: npc.health,
        hunger: npc.hunger,
        rest: npc.rest,
        coin: npc.coin,
        relationships,
        memories: npc.memories.map(m => m.eventId),
        goals: npc.goals.map(g => g.id)
      });
    }
    
    // Snapshot economy
    for (const [name, resource] of this.state.economy.resources) {
      snapshot.economyStates.set(name, {
        supply: resource.supply,
        demand: resource.demand,
        price: resource.price
      });
    }
    
    this.snapshots.set(tick, snapshot);
  }
  
  // Track state change from event
  trackStateChange(eventId: string, property: string, targetId: string, oldValue: any, newValue: any): void {
    if (!this.links.has(eventId)) {
      this.links.set(eventId, []);
    }
    
    this.links.get(eventId)!.push({
      eventId,
      stateProperty: property,
      targetId,
      oldValue,
      newValue,
      affectedDecisions: []
    });
  }
  
  // Link event to decisions it affected
  linkToDecision(causalEventId: string, decisionEventId: string): void {
    const links = this.links.get(causalEventId);
    if (links) {
      for (const link of links) {
        if (!link.affectedDecisions.includes(decisionEventId)) {
          link.affectedDecisions.push(decisionEventId);
        }
      }
    }
  }
  
  // Get causal explanation for why an event happened
  getCausalExplanation(eventId: string): string[] {
    const explanations: string[] = [];
    const event = this.state.events.get(eventId);
    if (!event) return explanations;
    
    // Find parent events
    for (const parentId of event.parentIds) {
      const parentEvent = this.state.events.get(parentId);
      if (!parentEvent) continue;
      
      const links = this.links.get(parentId);
      if (!links) continue;
      
      for (const link of links) {
        if (link.affectedDecisions.includes(eventId)) {
          explanations.push(
            `${parentEvent.description} changed ${link.stateProperty} from ${link.oldValue} to ${link.newValue}`
          );
        }
      }
    }
    
    return explanations;
  }
  
  // Get previous state for NPC
  getPreviousNPCState(npcId: number, tick: number): NPCState | null {
    // Find most recent snapshot before tick
    let latestTick = -1;
    for (const snapshotTick of this.snapshots.keys()) {
      if (snapshotTick < tick && snapshotTick > latestTick) {
        latestTick = snapshotTick;
      }
    }
    
    if (latestTick === -1) return null;
    
    const snapshot = this.snapshots.get(latestTick);
    return snapshot?.npcStates.get(npcId) || null;
  }
  
  // Validate causal edge
  validateCausalEdge(parentId: string, childId: string): { valid: boolean; reason: string } {
    const parent = this.state.events.get(parentId);
    const child = this.state.events.get(childId);
    
    if (!parent || !child) {
      return { valid: false, reason: 'Event not found' };
    }
    
    // Check if parent actually changed state that affected child's decision
    const links = this.links.get(parentId);
    if (!links) {
      return { valid: false, reason: 'Parent event has no state changes' };
    }
    
    const affectedChild = links.some(link => link.affectedDecisions.includes(childId));
    if (!affectedChild) {
      return { valid: false, reason: 'Parent state change did not affect child decision' };
    }
    
    return { valid: true, reason: 'Valid causal link' };
  }
  
  // Export causal data
  exportCausalData(): any {
    return {
      links: Array.from(this.links.entries()).map(([eventId, links]) => ({
        eventId,
        links: links.map(link => ({
          property: link.stateProperty,
          target: link.targetId,
          oldValue: link.oldValue,
          newValue: link.newValue,
          affectedDecisions: link.affectedDecisions
        }))
      }))
    };
  }
  
  // Find causal parents for a decision
  // This finds events that changed state relevant to the NPC's decision
  findCausalParents(npc: NPC, decision: any): string[] {
    const parentIds: string[] = [];
    const currentTick = this.state.tick;
    
    // Look back through recent events (last 30 days)
    const lookbackTicks = 30;
    const startTick = Math.max(0, currentTick - lookbackTicks);
    
    for (const [eventId, event] of this.state.events) {
      if (event.tick < startTick || event.tick >= currentTick) continue;
      
      // Check if this event changed state relevant to the NPC
      const links = this.links.get(eventId);
      if (!links) continue;
      
      for (const link of links) {
        // Check if the state change affects this NPC
        if (link.targetId === npc.id.toString()) {
          // This event changed the NPC's state
          // Check if it's relevant to the decision
          if (this.isStateChangeRelevant(link.stateProperty, decision.action)) {
            if (!parentIds.includes(eventId)) {
              parentIds.push(eventId);
            }
          }
        }
        
        // Also check if event involved NPCs the decision-maker has relationships with
        if (event.actorIds.includes(npc.id) || event.targetIds.includes(npc.id)) {
          if (!parentIds.includes(eventId)) {
            parentIds.push(eventId);
          }
        }
      }
    }
    
    // Also add events from NPC's memories
    for (const memory of npc.memories) {
      const memoryEvent = this.state.events.get(memory.eventId);
      if (memoryEvent && memoryEvent.tick >= startTick) {
        if (!parentIds.includes(memory.eventId)) {
          parentIds.push(memory.eventId);
        }
      }
    }
    
    // Limit to most relevant parents (top 5 by recency and relevance)
    return parentIds
      .map(id => ({
        id,
        tick: this.state.events.get(id)?.tick || 0
      }))
      .sort((a, b) => b.tick - a.tick)
      .slice(0, 5)
      .map(p => p.id);
  }
  
  // Check if a state change is relevant to a specific action
  private isStateChangeRelevant(property: string, action: string): boolean {
    const relevanceMap: Record<string, string[]> = {
      'coin': ['work', 'eat', 'steal', 'buy', 'trade', 'borrow'],
      'health': ['fight', 'heal', 'rest', 'work'],
      'hunger': ['eat', 'work', 'steal', 'beg'],
      'rest': ['sleep', 'work', 'socialize'],
      'affinity': ['socialize', 'fight', 'help', 'betray'],
      'trust': ['trade', 'lend', 'borrow', 'betray'],
      'reputation': ['work', 'crime', 'help', 'fight']
    };
    
    const relevantActions = relevanceMap[property] || [];
    return relevantActions.includes(action);
  }
}
