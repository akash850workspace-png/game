// ============================================================
// KNOWLEDGE SYSTEM - Tracks what NPCs know vs reality
// ============================================================

import type { WorldState, NPC, SimEvent } from '../types';

export class KnowledgeSystem {
  constructor(private state: WorldState) {}
  
  // Propagate knowledge from event to witnesses
  propagateKnowledge(event: SimEvent): void {
    // Direct participants know about the event
    for (const actorId of event.actorIds) {
      const npc = this.state.npcs.get(actorId);
      if (npc && npc.alive) {
        npc.knowledge.witnessedEvents.add(event.id);
      }
    }
    
    for (const targetId of event.targetIds) {
      const npc = this.state.npcs.get(targetId);
      if (npc && npc.alive) {
        npc.knowledge.witnessedEvents.add(event.id);
      }
    }
    
    // Witnesses know about the event
    for (const witnessId of event.witnessIds) {
      const npc = this.state.npcs.get(witnessId);
      if (npc && npc.alive) {
        npc.knowledge.witnessedEvents.add(event.id);
      }
    }
  }
  
  // NPC tells another NPC about an event
  tellInformation(speakerId: number, listenerId: number, eventId: string): boolean {
    const speaker = this.state.npcs.get(speakerId);
    const listener = this.state.npcs.get(listenerId);
    
    if (!speaker || !listener || !speaker.alive || !listener.alive) {
      return false;
    }
    
    // Speaker must know about the event
    if (!speaker.knowledge.witnessedEvents.has(eventId) && 
        !speaker.knowledge.heardEvents.has(eventId)) {
      return false;
    }
    
    // Listener must be in same location or have relationship
    const sameLocation = speaker.district === listener.district;
    const hasRelationship = speaker.relationships.has(listenerId);
    
    if (!sameLocation && !hasRelationship) {
      return false;
    }
    
    // Listener now knows about the event (as hearsay)
    listener.knowledge.heardEvents.add(eventId);
    
    // Update belief
    const event = this.state.events.get(eventId);
    if (event) {
      const beliefKey = `event_${eventId}`;
      listener.knowledge.beliefs.set(beliefKey, {
        subject: eventId,
        proposition: event.description,
        confidence: 0.7, // Lower confidence for hearsay
        source: speaker.name,
        tick: this.state.tick
      });
    }
    
    return true;
  }
  
  // NPC discovers evidence about an event
  discoverEvidence(npcId: number, eventId: string, confidence: number): void {
    const npc = this.state.npcs.get(npcId);
    if (!npc || !npc.alive) return;
    
    const event = this.state.events.get(eventId);
    if (!event) return;
    
    npc.knowledge.witnessedEvents.add(eventId);
    
    const beliefKey = `event_${eventId}`;
    npc.knowledge.beliefs.set(beliefKey, {
      subject: eventId,
      proposition: event.description,
      confidence,
      source: 'discovered',
      tick: this.state.tick
    });
  }
  
  // Check if NPC knows about an event
  knowsAbout(npcId: number, eventId: string): boolean {
    const npc = this.state.npcs.get(npcId);
    if (!npc) return false;
    
    return npc.knowledge.witnessedEvents.has(eventId) || 
           npc.knowledge.heardEvents.has(eventId);
  }
  
  // Get what an NPC knows
  getKnowledge(npcId: number): { witnessed: string[]; heard: string[]; beliefs: any[] } {
    const npc = this.state.npcs.get(npcId);
    if (!npc) {
      return { witnessed: [], heard: [], beliefs: [] };
    }
    
    return {
      witnessed: Array.from(npc.knowledge.witnessedEvents),
      heard: Array.from(npc.knowledge.heardEvents),
      beliefs: Array.from(npc.knowledge.beliefs.values())
    };
  }
  
  // Spread rumors/knowledge through social network
  spreadKnowledge(): void {
    // Every tick, some NPCs talk to each other
    for (const [npcId, npc] of this.state.npcs) {
      if (!npc.alive) continue;
      
      // Only spread knowledge if NPC has something to share
      if (npc.knowledge.witnessedEvents.size === 0 && npc.knowledge.heardEvents.size === 0) {
        continue;
      }
      
      // Find NPCs in same district
      const nearbyNPCs = this.state.indexes 
        ? this.state.indexes.getNPCsInDistrict(npc.district)
            .map((id: number) => this.state.npcs.get(id))
            .filter((n: NPC | undefined): n is NPC => n !== undefined && n.alive && n.id !== npcId)
        : Array.from(this.state.npcs.values())
            .filter(n => n.alive && n.id !== npcId && n.district === npc.district);
      
      if (nearbyNPCs.length === 0) continue;
      
      // Choose someone to talk to (prefer relationships)
      let listener: NPC | null = null;
      
      // 70% chance to talk to someone they have a relationship with
      if (this.state.rng() < 0.7 && npc.relationships.size > 0) {
        const relatedIds = Array.from(npc.relationships.keys());
        const randomRelatedId = relatedIds[Math.floor(this.state.rng() * relatedIds.length)];
        listener = this.state.npcs.get(randomRelatedId) || null;
      }
      
      // 30% chance to talk to random nearby NPC
      if (!listener && nearbyNPCs.length > 0) {
        listener = nearbyNPCs[Math.floor(this.state.rng() * nearbyNPCs.length)];
      }
      
      if (!listener) continue;
      
      // Choose an event to talk about
      const allKnownEvents = [
        ...Array.from(npc.knowledge.witnessedEvents),
        ...Array.from(npc.knowledge.heardEvents)
      ];
      
      if (allKnownEvents.length === 0) continue;
      
      // Prefer recent and salient events
      const eventsWithSalience = allKnownEvents
        .map(eventId => {
          const event = this.state.events.get(eventId);
          return {
            eventId,
            salience: event?.salience || 0.5,
            recency: event ? (this.state.tick - event.tick) : 1000
          };
        })
        .sort((a, b) => {
          // Higher salience and more recent = higher priority
          const scoreA = a.salience * 1000 - a.recency;
          const scoreB = b.salience * 1000 - b.recency;
          return scoreB - scoreA;
        });
      
      // Choose from top 5 events
      const topEvents = eventsWithSalience.slice(0, Math.min(5, eventsWithSalience.length));
      const chosenEvent = topEvents[Math.floor(this.state.rng() * topEvents.length)];
      
      // Tell the listener
      this.tellInformation(npcId, listener.id, chosenEvent.eventId);
    }
  }
  
  // NPC infers information from what they know
  inferKnowledge(npcId: number): void {
    const npc = this.state.npcs.get(npcId);
    if (!npc || !npc.alive) return;
    
    // Example: If NPC knows A stole from B, and knows A is now wealthy,
    // they might infer A still has the stolen goods
    
    // For now, this is a placeholder for more sophisticated inference
    // In the future, this could use belief networks or logical reasoning
  }
}
