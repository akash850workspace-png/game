// ============================================================
// EXPORT SYSTEM - Complete World State Export
// ============================================================

import type { WorldState, ExportData, SimEvent, NPC, StoryThread, Mission } from './types';

// ============================================================
// MAIN EXPORT FUNCTION
// ============================================================

export function exportSimulation(state: WorldState): ExportData {
  console.log('Starting simulation export...');
  
  const exportData: ExportData = {
    metadata: {
      seed: state.seed,
      version: '1.0.0',
      startTick: 0,
      endTick: state.tick,
      totalEvents: state.events.size,
      totalNPCs: state.npcs.size
    },
    events: exportEvents(state),
    npcs: exportNPCs(state),
    storyThreads: exportStoryThreads(state),
    missions: exportMissions(state),
    economy: exportEconomy(state),
    wildlife: exportWildlife(state),
    stats: { ...state.stats },
    eventGraph: exportEventGraph(state)
  };
  
  console.log('Export complete. Validating...');
  validateExport(exportData);
  
  return exportData;
}

// ============================================================
// EVENT EXPORT
// ============================================================

function exportEvents(state: WorldState): SimEvent[] {
  const events: SimEvent[] = [];
  
  for (const event of state.events.values()) {
    events.push({
      ...event,
      // Convert Sets to Arrays for JSON serialization
      witnessIds: Array.from(event.witnessIds || []),
      parentIds: Array.from(event.parentIds || []),
      childIds: Array.from(event.childIds || [])
    });
  }
  
  return events;
}

// ============================================================
// NPC EXPORT
// ============================================================

function exportNPCs(state: WorldState): NPC[] {
  const npcs: NPC[] = [];
  
  for (const npc of state.npcs.values()) {
    // Convert Maps to serializable format
    const relationships: Record<number, any> = {};
    for (const [id, rel] of npc.relationships) {
      relationships[id] = {
        ...rel,
        history: Array.from(rel.history || [])
      };
    }
    
    const knowledge = {
      witnessedEvents: Array.from(npc.knowledge.witnessedEvents),
      heardEvents: Array.from(npc.knowledge.heardEvents),
      beliefs: Array.from(npc.knowledge.beliefs.entries()).map(([key, belief]) => ({
        key,
        ...belief
      }))
    };
    
    npcs.push({
      ...npc,
      relationships: relationships as any,
      knowledge: knowledge as any,
      memories: npc.memories.map(m => ({
        ...m,
        participants: Array.from(m.participants || [])
      })),
      goals: npc.goals.map(g => ({
        ...g,
        relatedEventIds: Array.from(g.relatedEventIds || [])
      })),
      eventParticipation: Array.from(npc.eventParticipation || []),
      decisionsMade: Array.from(npc.decisionsMade || [])
    });
  }
  
  return npcs;
}

// ============================================================
// STORY THREAD EXPORT
// ============================================================

function exportStoryThreads(state: WorldState): StoryThread[] {
  const threads: StoryThread[] = [];
  
  for (const thread of state.storyThreads.values()) {
    threads.push({
      ...thread,
      protagonistIds: Array.from(thread.protagonistIds || []),
      antagonistIds: Array.from(thread.antagonistIds || []),
      otherParticipantIds: Array.from(thread.otherParticipantIds || []),
      eventIds: Array.from(thread.eventIds || []),
      unresolvedIssues: Array.from(thread.unresolvedIssues || [])
    });
  }
  
  return threads;
}

// ============================================================
// MISSION EXPORT
// ============================================================

function exportMissions(state: WorldState): Mission[] {
  const missions: Mission[] = [];
  
  for (const mission of state.missions.values()) {
    // Convert Map to serializable format
    const npcsKnow: Record<number, string[]> = {};
    for (const [npcId, knowledge] of mission.npcsKnow) {
      npcsKnow[npcId] = knowledge;
    }
    
    missions.push({
      ...mission,
      causalChain: Array.from(mission.causalChain || []),
      playerKnows: Array.from(mission.playerKnows || []),
      npcsKnow: npcsKnow as any,
      possibleApproaches: mission.possibleApproaches.map(a => ({
        ...a,
        consequences: a.consequences.map(c => ({ ...c }))
      })),
      consequences: mission.consequences.map(c => ({ ...c }))
    });
  }
  
  return missions;
}

// ============================================================
// ECONOMY EXPORT
// ============================================================

function exportEconomy(state: WorldState): any {
  const resources: Record<string, any> = {};
  for (const [name, resource] of state.economy.resources) {
    resources[name] = { ...resource };
  }
  
  return {
    resources,
    transactions: state.economy.transactions.map(t => ({ ...t }))
  };
}

// ============================================================
// WILDLIFE EXPORT
// ============================================================

function exportWildlife(state: WorldState): any {
  const creatures: Record<string, any> = {};
  for (const [id, creature] of state.wildlife.creatures) {
    creatures[id] = {
      ...creature,
      territory: Array.from(creature.territory || []),
      memories: Array.from(creature.memories || [])
    };
  }
  
  const populations: Record<string, number> = {};
  for (const [species, count] of state.wildlife.populations) {
    populations[species] = count;
  }
  
  return {
    creatures,
    populations
  };
}

// ============================================================
// EVENT GRAPH EXPORT
// ============================================================

function exportEventGraph(state: WorldState): any {
  const nodes: string[] = [];
  const edges: [string, string][] = [];
  
  for (const event of state.events.values()) {
    nodes.push(event.id);
    
    for (const parentId of event.parentIds) {
      edges.push([parentId, event.id]);
    }
  }
  
  return { nodes, edges };
}

// ============================================================
// VALIDATION
// ============================================================

function validateExport(data: ExportData): void {
  const errors: string[] = [];
  
  // Check for unique event IDs
  const eventIds = new Set<string>();
  for (const event of data.events) {
    if (eventIds.has(event.id)) {
      errors.push(`Duplicate event ID: ${event.id}`);
    }
    eventIds.add(event.id);
  }
  
  // Check causal references
  for (const event of data.events) {
    for (const parentId of event.parentIds) {
      if (!eventIds.has(parentId)) {
        errors.push(`Event ${event.id} references non-existent parent: ${parentId}`);
      }
    }
  }
  
  // Check NPC references
  const npcIds = new Set(data.npcs.map(n => n.id));
  for (const event of data.events) {
    for (const actorId of event.actorIds) {
      if (!npcIds.has(actorId)) {
        errors.push(`Event ${event.id} references non-existent NPC: ${actorId}`);
      }
    }
  }
  
  // Check story thread references
  for (const thread of data.storyThreads) {
    if (!eventIds.has(thread.originEventId)) {
      errors.push(`Story thread ${thread.id} references non-existent origin event: ${thread.originEventId}`);
    }
    
    for (const eventId of thread.eventIds) {
      if (!eventIds.has(eventId)) {
        errors.push(`Story thread ${thread.id} references non-existent event: ${eventId}`);
      }
    }
  }
  
  // Check mission references
  for (const mission of data.missions) {
    if (!eventIds.has(mission.originatingEventId)) {
      errors.push(`Mission ${mission.id} references non-existent origin event: ${mission.originatingEventId}`);
    }
    
    const thread = data.storyThreads.find(t => t.id === mission.storyThreadId);
    if (!thread) {
      errors.push(`Mission ${mission.id} references non-existent story thread: ${mission.storyThreadId}`);
    }
  }
  
  // Check for NaN/Infinity values
  for (const npc of data.npcs) {
    if (isNaN(npc.health) || !isFinite(npc.health)) {
      errors.push(`NPC ${npc.id} has invalid health: ${npc.health}`);
    }
    if (isNaN(npc.coin) || !isFinite(npc.coin)) {
      errors.push(`NPC ${npc.id} has invalid coin: ${npc.coin}`);
    }
  }
  
  if (errors.length > 0) {
    console.error('Export validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error(`Export validation failed with ${errors.length} errors`);
  }
  
  console.log('Export validation passed');
}

// ============================================================
// DOWNLOAD FUNCTIONS
// ============================================================

export function downloadExport(data: ExportData, filename: string = 'simulation_export'): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// HUMAN-READABLE EXPORTS
// ============================================================

export function generateEventLog(data: ExportData): string {
  const lines: string[] = [];
  
  lines.push('=== SIMULATION EVENT LOG ===');
  lines.push(`Seed: ${data.metadata.seed}`);
  lines.push(`Total Events: ${data.metadata.totalEvents}`);
  lines.push(`Total NPCs: ${data.metadata.totalNPCs}`);
  lines.push(`Time Span: ${data.metadata.startTick} to ${data.metadata.endTick} ticks`);
  lines.push('');
  
  // Sort events by tick
  const sortedEvents = [...data.events].sort((a, b) => a.tick - b.tick);
  
  for (const event of sortedEvents) {
    const year = Math.floor(event.tick / 360) + 1;
    const day = (event.tick % 360) + 1;
    
    lines.push(`[Year ${year}, Day ${day}] Event ${event.id}`);
    lines.push(`  Type: ${event.type}`);
    lines.push(`  Description: ${event.description}`);
    
    if (event.actorIds.length > 0) {
      const actorNames = event.actorIds.map(id => {
        const npc = data.npcs.find(n => n.id === id);
        return npc?.name || `NPC#${id}`;
      });
      lines.push(`  Actors: ${actorNames.join(', ')}`);
    }
    
    if (event.targetIds.length > 0) {
      const targetNames = event.targetIds.map(id => {
        const npc = data.npcs.find(n => n.id === id);
        return npc?.name || `NPC#${id}`;
      });
      lines.push(`  Targets: ${targetNames.join(', ')}`);
    }
    
    if (event.parentIds.length > 0) {
      lines.push(`  Caused by: ${event.parentIds.join(', ')}`);
    }
    
    if (event.childIds.length > 0) {
      lines.push(`  Led to: ${event.childIds.join(', ')}`);
    }
    
    if (event.decision) {
      lines.push(`  Decision:`);
      lines.push(`    Chosen: ${event.decision.chosenAction} (score: ${event.decision.chosenScore.toFixed(2)})`);
      lines.push(`    Roll: ${event.decision.roll.toFixed(3)} vs threshold ${event.decision.threshold.toFixed(3)}`);
      lines.push(`    Success: ${event.decision.success}`);
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
}

export function generateCausalChains(data: ExportData): string {
  const lines: string[] = [];
  
  lines.push('=== CAUSAL CHAINS ===');
  lines.push('');
  
  // Find root events (no parents)
  const rootEvents = data.events.filter(e => e.parentIds.length === 0);
  
  for (const root of rootEvents) {
    if (root.childIds.length === 0) continue; // Skip isolated events
    
    lines.push(`ROOT EVENT: ${root.id}`);
    lines.push(`  ${root.description}`);
    lines.push('');
    
    // Build chain
    const chain = buildChain(root.id, data);
    for (let i = 0; i < chain.length; i++) {
      const event = data.events.find(e => e.id === chain[i]);
      if (event) {
        const indent = '  '.repeat(i);
        lines.push(`${indent}↓ ${event.id}: ${event.description}`);
      }
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

function buildChain(eventId: string, data: ExportData, visited: Set<string> = new Set()): string[] {
  if (visited.has(eventId)) return [];
  visited.add(eventId);
  
  const chain: string[] = [eventId];
  const event = data.events.find(e => e.id === eventId);
  
  if (event && event.childIds.length > 0) {
    // Follow the most significant child
    const children = event.childIds
      .map(id => data.events.find(e => e.id === id))
      .filter(e => e !== undefined)
      .sort((a, b) => (b?.salience || 0) - (a?.salience || 0));
    
    if (children.length > 0) {
      chain.push(...buildChain(children[0].id, data, visited));
    }
  }
  
  return chain;
}

export function generateEmergentHistory(data: ExportData): string {
  const lines: string[] = [];
  
  lines.push('=== EMERGENT HISTORY ===');
  lines.push('');
  lines.push('The most important stories that emerged from the simulation:');
  lines.push('');
  
  // Sort story threads by importance
  const sortedThreads = [...data.storyThreads].sort((a, b) => {
    const scoreA = a.stakes * a.causalDepth + a.emotionalWeight;
    const scoreB = b.stakes * b.causalDepth + b.emotionalWeight;
    return scoreB - scoreA;
  });
  
  for (const thread of sortedThreads.slice(0, 20)) {
    lines.push(`STORY: ${thread.title}`);
    lines.push(`Status: ${thread.status}`);
    lines.push(`Stakes: ${(thread.stakes * 100).toFixed(0)}%`);
    lines.push(`Causal Depth: ${thread.causalDepth}`);
    lines.push('');
    
    lines.push('Origin:');
    const originEvent = data.events.find(e => e.id === thread.originEventId);
    if (originEvent) {
      const year = Math.floor(originEvent.tick / 360) + 1;
      lines.push(`  Year ${year}: ${originEvent.description}`);
    }
    lines.push('');
    
    lines.push('Conflict:');
    lines.push(`  ${thread.conflict}`);
    lines.push('');
    
    if (thread.protagonistIds.length > 0) {
      const protNames = thread.protagonistIds.map(id => {
        const npc = data.npcs.find(n => n.id === id);
        return npc?.name || `NPC#${id}`;
      });
      lines.push(`Protagonists: ${protNames.join(', ')}`);
    }
    
    if (thread.antagonistIds.length > 0) {
      const antNames = thread.antagonistIds.map(id => {
        const npc = data.npcs.find(n => n.id === id);
        return npc?.name || `NPC#${id}`;
      });
      lines.push(`Antagonists: ${antNames.join(', ')}`);
    }
    
    lines.push('');
    lines.push('Causal Chain:');
    
    for (const eventId of thread.eventIds.slice(0, 5)) {
      const event = data.events.find(e => e.id === eventId);
      if (event) {
        const year = Math.floor(event.tick / 360) + 1;
        lines.push(`  Year ${year}: ${event.description}`);
      }
    }
    
    if (thread.unresolvedIssues.length > 0) {
      lines.push('');
      lines.push('Unresolved Issues:');
      for (const issue of thread.unresolvedIssues) {
        lines.push(`  - ${issue}`);
      }
    }
    
    lines.push('');
    lines.push('─'.repeat(60));
    lines.push('');
  }
  
  return lines.join('\n');
}

// ============================================================
// NPC HISTORY EXPORT
// ============================================================

export function generateNPCHistory(npcId: number, data: ExportData): string {
  const npc = data.npcs.find(n => n.id === npcId);
  if (!npc) return `NPC ${npcId} not found`;
  
  const lines: string[] = [];
  
  lines.push(`=== LIFE OF ${npc.name} (NPC #${npc.id}) ===`);
  lines.push('');
  
  lines.push('Basic Info:');
  lines.push(`  Age: ${npc.age}`);
  lines.push(`  Sex: ${npc.sex}`);
  lines.push(`  Job: ${npc.job}`);
  lines.push(`  District: ${npc.district}`);
  lines.push(`  Alive: ${npc.alive}`);
  lines.push(`  Health: ${(npc.health * 100).toFixed(0)}%`);
  lines.push(`  Coin: ${npc.coin}`);
  lines.push('');
  
  lines.push('Traits:');
  for (const [trait, value] of Object.entries(npc.traits)) {
    lines.push(`  ${trait}: ${(value * 100).toFixed(0)}%`);
  }
  lines.push('');
  
  lines.push('Skills:');
  for (const [skill, value] of Object.entries(npc.skills)) {
    lines.push(`  ${skill}: ${value}`);
  }
  lines.push('');
  
  // Find events involving this NPC
  const npcEvents = data.events.filter(
    e => e.actorIds.includes(npcId) || e.targetIds.includes(npcId)
  ).sort((a, b) => a.tick - b.tick);
  
  lines.push(`Life Events (${npcEvents.length} total):`);
  for (const event of npcEvents.slice(0, 20)) {
    const year = Math.floor(event.tick / 360) + 1;
    const role = event.actorIds.includes(npcId) ? 'ACTOR' : 'TARGET';
    lines.push(`  [Year ${year}] [${role}] ${event.description}`);
  }
  lines.push('');
  
  // Relationships
  lines.push('Relationships:');
  for (const [otherId, rel] of Object.entries(npc.relationships)) {
    const other = data.npcs.find(n => n.id === parseInt(otherId));
    if (other) {
      lines.push(`  ${other.name}:`);
      lines.push(`    Affinity: ${(rel.affinity * 100).toFixed(0)}%`);
      lines.push(`    Trust: ${(rel.trust * 100).toFixed(0)}%`);
    }
  }
  lines.push('');
  
  // Goals
  if (npc.goals.length > 0) {
    lines.push('Goals:');
    for (const goal of npc.goals) {
      const status = goal.completed ? '✓' : '○';
      lines.push(`  [${status}] ${goal.description}`);
    }
    lines.push('');
  }
  
  // Debts
  if (npc.debts.length > 0) {
    lines.push('Debts:');
    for (const debt of npc.debts) {
      const creditor = data.npcs.find(n => n.id === debt.creditorId);
      lines.push(`  Owes ${debt.amount} coin to ${creditor?.name || 'unknown'}`);
    }
    lines.push('');
  }
  
  // Crimes
  if (npc.crimes.length > 0) {
    lines.push('Crimes:');
    for (const crime of npc.crimes) {
      const status = crime.solved ? 'SOLVED' : 'UNSOLVED';
      lines.push(`  [${status}] ${crime.type} (Year ${Math.floor(crime.tick / 360) + 1})`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}
