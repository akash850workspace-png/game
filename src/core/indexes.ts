// ============================================================
// INDEXES - Fast lookups for simulation entities
// ============================================================

import type { WorldState, NPC, SimEvent } from '../types';

export class Indexes {
  // NPC indexes
  npcsByDistrict: Map<string, Set<number>> = new Map();
  npcsByFaction: Map<string, Set<number>> = new Map();
  npcsByJob: Map<string, Set<number>> = new Map();
  npcsByFamily: Map<number, Set<number>> = new Map(); // npcId -> family member ids
  
  // Event indexes
  eventsByType: Map<string, Set<string>> = new Map();
  eventsByNpc: Map<number, Set<string>> = new Map();
  eventsByLocation: Map<string, Set<string>> = new Map();
  eventsByTick: Map<number, Set<string>> = new Map();
  
  // Relationship indexes
  relationshipsByNpc: Map<number, Set<number>> = new Map(); // npcId -> related npc ids
  
  // Story indexes
  storiesByEvent: Map<string, Set<string>> = new Map();
  storiesByNpc: Map<number, Set<string>> = new Map();
  
  constructor(private state: WorldState) {
    this.initializeIndexes();
  }
  
  private initializeIndexes(): void {
    // Index NPCs
    for (const [id, npc] of this.state.npcs) {
      if (!npc.alive) continue;
      
      // By district
      if (!this.npcsByDistrict.has(npc.district)) {
        this.npcsByDistrict.set(npc.district, new Set());
      }
      this.npcsByDistrict.get(npc.district)!.add(id);
      
      // By faction
      if (npc.faction) {
        if (!this.npcsByFaction.has(npc.faction)) {
          this.npcsByFaction.set(npc.faction, new Set());
        }
        this.npcsByFaction.get(npc.faction)!.add(id);
      }
      
      // By job
      if (!this.npcsByJob.has(npc.job)) {
        this.npcsByJob.set(npc.job, new Set());
      }
      this.npcsByJob.get(npc.job)!.add(id);
      
      // By family
      for (const link of npc.familyLinks) {
        if (!this.npcsByFamily.has(id)) {
          this.npcsByFamily.set(id, new Set());
        }
        this.npcsByFamily.get(id)!.add(link.npcId);
        
        if (!this.npcsByFamily.has(link.npcId)) {
          this.npcsByFamily.set(link.npcId, new Set());
        }
        this.npcsByFamily.get(link.npcId)!.add(id);
      }
      
      // Relationships
      for (const [otherId] of npc.relationships) {
        if (!this.relationshipsByNpc.has(id)) {
          this.relationshipsByNpc.set(id, new Set());
        }
        this.relationshipsByNpc.get(id)!.add(otherId);
      }
    }
    
    // Index events
    for (const [id, event] of this.state.events) {
      // By type
      if (!this.eventsByType.has(event.type)) {
        this.eventsByType.set(event.type, new Set());
      }
      this.eventsByType.get(event.type)!.add(id);
      
      // By NPC
      for (const npcId of [...event.actorIds, ...event.targetIds]) {
        if (!this.eventsByNpc.has(npcId)) {
          this.eventsByNpc.set(npcId, new Set());
        }
        this.eventsByNpc.get(npcId)!.add(id);
      }
      
      // By location
      if (event.locationId) {
        if (!this.eventsByLocation.has(event.locationId)) {
          this.eventsByLocation.set(event.locationId, new Set());
        }
        this.eventsByLocation.get(event.locationId)!.add(id);
      }
      
      // By tick
      if (!this.eventsByTick.has(event.tick)) {
        this.eventsByTick.set(event.tick, new Set());
      }
      this.eventsByTick.get(event.tick)!.add(id);
    }
  }
  
  // Incremental updates
  
  addNPC(npc: NPC): void {
    const id = npc.id;
    
    // By district
    if (!this.npcsByDistrict.has(npc.district)) {
      this.npcsByDistrict.set(npc.district, new Set());
    }
    this.npcsByDistrict.get(npc.district)!.add(id);
    
    // By faction
    if (npc.faction) {
      if (!this.npcsByFaction.has(npc.faction)) {
        this.npcsByFaction.set(npc.faction, new Set());
      }
      this.npcsByFaction.get(npc.faction)!.add(id);
    }
    
    // By job
    if (!this.npcsByJob.has(npc.job)) {
      this.npcsByJob.set(npc.job, new Set());
    }
    this.npcsByJob.get(npc.job)!.add(id);
  }
  
  removeNPC(npcId: number): void {
    const npc = this.state.npcs.get(npcId);
    if (!npc) return;
    
    // Remove from district
    const districtSet = this.npcsByDistrict.get(npc.district);
    if (districtSet) {
      districtSet.delete(npcId);
    }
    
    // Remove from faction
    if (npc.faction) {
      const factionSet = this.npcsByFaction.get(npc.faction);
      if (factionSet) {
        factionSet.delete(npcId);
      }
    }
    
    // Remove from job
    const jobSet = this.npcsByJob.get(npc.job);
    if (jobSet) {
      jobSet.delete(npcId);
    }
  }
  
  addEvent(event: SimEvent): void {
    const id = event.id;
    
    // By type
    if (!this.eventsByType.has(event.type)) {
      this.eventsByType.set(event.type, new Set());
    }
    this.eventsByType.get(event.type)!.add(id);
    
    // By NPC
    for (const npcId of [...event.actorIds, ...event.targetIds]) {
      if (!this.eventsByNpc.has(npcId)) {
        this.eventsByNpc.set(npcId, new Set());
      }
      this.eventsByNpc.get(npcId)!.add(id);
    }
    
    // By location
    if (event.locationId) {
      if (!this.eventsByLocation.has(event.locationId)) {
        this.eventsByLocation.set(event.locationId, new Set());
      }
      this.eventsByLocation.get(event.locationId)!.add(id);
    }
    
    // By tick
    if (!this.eventsByTick.has(event.tick)) {
      this.eventsByTick.set(event.tick, new Set());
    }
    this.eventsByTick.get(event.tick)!.add(id);
  }
  
  // Query methods
  
  getNPCsInDistrict(district: string): number[] {
    return Array.from(this.npcsByDistrict.get(district) || []);
  }
  
  getNPCsInFaction(faction: string): number[] {
    return Array.from(this.npcsByFaction.get(faction) || []);
  }
  
  getNPCsByJob(job: string): number[] {
    return Array.from(this.npcsByJob.get(job) || []);
  }
  
  getFamilyMembers(npcId: number): number[] {
    return Array.from(this.npcsByFamily.get(npcId) || []);
  }
  
  getRelatedNPCs(npcId: number): number[] {
    return Array.from(this.relationshipsByNpc.get(npcId) || []);
  }
  
  getEventsByType(type: string): string[] {
    return Array.from(this.eventsByType.get(type) || []);
  }
  
  getEventsByNpc(npcId: number): string[] {
    return Array.from(this.eventsByNpc.get(npcId) || []);
  }
  
  getEventsInLocation(locationId: string): string[] {
    return Array.from(this.eventsByLocation.get(locationId) || []);
  }
  
  getEventsAtTick(tick: number): string[] {
    return Array.from(this.eventsByTick.get(tick) || []);
  }
  
  getEventsInRange(startTick: number, endTick: number): string[] {
    const events: string[] = [];
    for (let tick = startTick; tick <= endTick; tick++) {
      events.push(...this.getEventsAtTick(tick));
    }
    return events;
  }
}
