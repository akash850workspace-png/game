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
}
