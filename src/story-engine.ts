// ============================================================
// STORY ENGINE - Thread Detection and Mission Generation
// ============================================================

import type { WorldState, StoryThread, Mission, SimEvent, NPC, Approach, Consequence } from './types';

// ============================================================
// STORY THREAD DETECTION
// ============================================================

export function detectStoryThreads(state: WorldState): void {
  // Find unresolved situations in the event graph
  const unresolvedEvents = findUnresolvedSituations(state);
  
  for (const situation of unresolvedEvents) {
    // Check if this situation already has a story thread
    const existingThread = Array.from(state.storyThreads.values()).find(
      t => t.eventIds.includes(situation.event.id)
    );
    
    if (existingThread) {
      // Update existing thread
      updateStoryThread(existingThread, situation, state);
    } else {
      // Create new thread
      const thread = createStoryThread(situation, state);
      if (thread) {
        state.storyThreads.set(thread.id, thread);
      }
    }
  }
  
  // Update all active threads
  for (const thread of state.storyThreads.values()) {
    if (thread.status === 'active') {
      updateThreadMetrics(thread, state);
    }
  }
}

interface UnresolvedSituation {
  event: SimEvent;
  type: string;
  stakes: number;
  participants: number[];
  causalDepth: number;
}

function findUnresolvedSituations(state: WorldState): UnresolvedSituation[] {
  const situations: UnresolvedSituation[] = [];
  
  for (const event of state.events.values()) {
    // Look for events that create unresolved problems
    if (isUnresolvedSituation(event, state)) {
      const situation = analyzeSituation(event, state);
      if (situation) {
        situations.push(situation);
      }
    }
  }
  
  return situations;
}

function isUnresolvedSituation(event: SimEvent, state: WorldState): boolean {
  // Debt situations
  if (event.type === 'debt_created') {
    const debtorId = event.actorIds[0];
    const debtor = state.npcs.get(debtorId);
    if (debtor && debtor.debts.length > 0) {
      return true;
    }
  }
  
  // Crime situations
  if (event.type === 'theft' || event.type === 'murder' || event.type === 'assault') {
    const hasUnsolvedCrime = event.actorIds.some(id => {
      const npc = state.npcs.get(id);
      return npc && npc.crimes.some(c => !c.solved);
    });
    if (hasUnsolvedCrime) return true;
  }
  
  // Revenge goals
  if (event.type === 'betrayal' || event.type === 'theft' || event.type === 'murder_attempt') {
    const victimId = event.targetIds[0];
    const victim = state.npcs.get(victimId);
    if (victim && victim.goals.some(g => g.type === 'revenge' && !g.completed)) {
      return true;
    }
  }
  
  // Feud situations
  if (event.type === 'argument' || event.type === 'fight') {
    const npc1Id = event.actorIds[0];
    const npc2Id = event.targetIds[0];
    const npc1 = state.npcs.get(npc1Id);
    const npc2 = state.npcs.get(npc2Id);
    
    if (npc1 && npc2) {
      const rel1 = npc1.relationships.get(npc2Id);
      const rel2 = npc2.relationships.get(npc1Id);
      
      if ((rel1 && rel1.affinity < -0.5) || (rel2 && rel2.affinity < -0.5)) {
        return true;
      }
    }
  }
  
  return false;
}

function analyzeSituation(event: SimEvent, state: WorldState): UnresolvedSituation | null {
  const participants = [...new Set([...event.actorIds, ...event.targetIds])];
  const causalDepth = calculateCausalDepth(event, state);
  
  let type = 'unknown';
  let stakes = 0.5;
  
  if (event.type === 'debt_created') {
    type = 'debt';
    const debtor = state.npcs.get(event.actorIds[0]);
    if (debtor) {
      stakes = Math.min(1, debtor.debts.reduce((sum, d) => sum + d.amount, 0) / 100);
    }
  } else if (event.type === 'theft') {
    type = 'crime_theft';
    stakes = 0.6;
  } else if (event.type === 'murder' || event.type === 'murder_attempt') {
    type = 'crime_violent';
    stakes = 0.9;
  } else if (event.type === 'betrayal') {
    type = 'betrayal';
    stakes = 0.8;
  } else if (event.type === 'fight' || event.type === 'argument') {
    type = 'conflict';
    stakes = 0.5;
  }
  
  return {
    event,
    type,
    stakes,
    participants,
    causalDepth
  };
}

function calculateCausalDepth(event: SimEvent, state: WorldState, visited: Set<string> = new Set()): number {
  if (visited.has(event.id)) return 0;
  visited.add(event.id);
  
  if (event.parentIds.length === 0) return 1;
  
  let maxDepth = 0;
  for (const parentId of event.parentIds) {
    const parent = state.events.get(parentId);
    if (parent) {
      maxDepth = Math.max(maxDepth, calculateCausalDepth(parent, state, visited));
    }
  }
  
  return maxDepth + 1;
}

function createStoryThread(situation: UnresolvedSituation, state: WorldState): StoryThread | null {
  const threadId = `ST${state.nextStoryId++}`;
  
  // Determine protagonist and antagonist
  const protagonistIds: number[] = [];
  const antagonistIds: number[] = [];
  
  if (situation.type === 'debt') {
    protagonistIds.push(situation.event.actorIds[0]); // Debtor
  } else if (situation.type.startsWith('crime_') || situation.type === 'betrayal') {
    protagonistIds.push(...situation.event.targetIds); // Victims
    antagonistIds.push(...situation.event.actorIds); // Perpetrators
  } else if (situation.type === 'conflict') {
    protagonistIds.push(situation.event.actorIds[0]);
    antagonistIds.push(situation.event.targetIds[0]);
  }
  
  // Generate title
  const title = generateThreadTitle(situation, state);
  
  // Generate conflict description
  const conflict = generateConflictDescription(situation, state);
  
  const thread: StoryThread = {
    id: threadId,
    title,
    status: 'active',
    originEventId: situation.event.id,
    originTick: situation.event.tick,
    protagonistIds,
    antagonistIds,
    otherParticipantIds: situation.participants.filter(
      id => !protagonistIds.includes(id) && !antagonistIds.includes(id)
    ),
    eventIds: [situation.event.id],
    causalDepth: situation.causalDepth,
    conflict,
    stakes: situation.stakes,
    escalation: 0,
    currentProblem: conflict,
    unresolvedIssues: [conflict],
    noveltyScore: calculateNovelty(situation, state),
    emotionalWeight: situation.stakes,
    createdTick: state.tick,
    lastUpdatedTick: state.tick
  };
  
  return thread;
}

function updateStoryThread(thread: StoryThread, situation: UnresolvedSituation, state: WorldState): void {
  // Add new event to thread
  if (!thread.eventIds.includes(situation.event.id)) {
    thread.eventIds.push(situation.event.id);
    thread.lastUpdatedTick = state.tick;
  }
  
  // Update causal depth
  thread.causalDepth = Math.max(thread.causalDepth, situation.causalDepth);
  
  // Update stakes
  thread.stakes = Math.max(thread.stakes, situation.stakes);
  
  // Update escalation
  thread.escalation = Math.min(1, thread.escalation + 0.1);
  
  // Check if resolved
  if (isThreadResolved(thread, state)) {
    thread.status = 'resolved';
    thread.resolvedTick = state.tick;
    thread.unresolvedIssues = [];
  }
}

function isThreadResolved(thread: StoryThread, state: WorldState): boolean {
  // Check if all protagonists have resolved their goals
  for (const protId of thread.protagonistIds) {
    const prot = state.npcs.get(protId);
    if (prot) {
      const unresolvedGoals = prot.goals.filter(g => 
        thread.eventIds.some(eId => g.relatedEventIds.includes(eId)) && !g.completed
      );
      if (unresolvedGoals.length > 0) return false;
    }
  }
  
  // Check if conflict has been addressed
  if (thread.conflict.includes('debt')) {
    const debtor = state.npcs.get(thread.protagonistIds[0]);
    if (debtor && debtor.debts.length === 0) return true;
  }
  
  if (thread.conflict.includes('revenge')) {
    const avenger = state.npcs.get(thread.protagonistIds[0]);
    if (avenger) {
      const revengeGoals = avenger.goals.filter(g => g.type === 'revenge');
      if (revengeGoals.every(g => g.completed)) return true;
    }
  }
  
  return false;
}

function generateThreadTitle(situation: UnresolvedSituation, state: WorldState): string {
  const prot = state.npcs.get(situation.participants[0]);
  const protName = prot?.name || 'Unknown';
  
  switch (situation.type) {
    case 'debt':
      return `${protName}'s Debt`;
    case 'crime_theft':
      return `The Theft from ${protName}`;
    case 'crime_violent':
      return `Violence Against ${protName}`;
    case 'betrayal':
      return `${protName}'s Betrayal`;
    case 'conflict':
      return `The Feud of ${protName}`;
    default:
      return `${protName}'s Story`;
  }
}

function generateConflictDescription(situation: UnresolvedSituation, state: WorldState): string {
  const prot = state.npcs.get(situation.participants[0]);
  const ant = situation.participants.length > 1 ? state.npcs.get(situation.participants[1]) : null;
  
  const protName = prot?.name || 'Unknown';
  const antName = ant?.name || 'someone';
  
  switch (situation.type) {
    case 'debt':
      const debt = prot?.debts[0];
      if (debt) {
        const creditor = state.npcs.get(debt.creditorId);
        return `${protName} owes ${debt.amount} coin to ${creditor?.name || 'a creditor'}`;
      }
      return `${protName} is in debt`;
      
    case 'crime_theft':
      return `${antName} stole from ${protName}`;
      
    case 'crime_violent':
      return `${antName} committed violence against ${protName}`;
      
    case 'betrayal':
      return `${antName} betrayed ${protName}'s trust`;
      
    case 'conflict':
      return `${protName} and ${antName} are in bitter conflict`;
      
    default:
      return `${protName} faces an unresolved situation`;
  }
}

function calculateNovelty(situation: UnresolvedSituation, state: WorldState): number {
  // Count similar threads
  const similarThreads = Array.from(state.storyThreads.values()).filter(
    t => t.conflict.includes(situation.type)
  );
  
  // Novelty decreases with similar threads
  return Math.max(0, 1 - similarThreads.length * 0.1);
}

function updateThreadMetrics(thread: StoryThread, state: WorldState): void {
  // Update causal depth
  let maxDepth = 0;
  for (const eventId of thread.eventIds) {
    const event = state.events.get(eventId);
    if (event) {
      maxDepth = Math.max(maxDepth, calculateCausalDepth(event, state));
    }
  }
  thread.causalDepth = maxDepth;
  
  // Update emotional weight based on events
  let totalSalience = 0;
  for (const eventId of thread.eventIds) {
    const event = state.events.get(eventId);
    if (event) {
      totalSalience += event.salience;
    }
  }
  thread.emotionalWeight = totalSalience / thread.eventIds.length;
}

// ============================================================
// MISSION GENERATION
// ============================================================

export function generateMissions(state: WorldState): void {
  // Generate missions from active story threads
  for (const thread of state.storyThreads.values()) {
    if (thread.status !== 'active') continue;
    
    // Check if mission already exists for this thread
    const existingMission = Array.from(state.missions.values()).find(
      m => m.storyThreadId === thread.id
    );
    
    if (!existingMission) {
      const mission = createMission(thread, state);
      if (mission) {
        state.missions.set(mission.id, mission);
      }
    }
  }
}

function createMission(thread: StoryThread, state: WorldState): Mission | null {
  const missionId = `M${state.nextMissionId++}`;
  
  // Get origin event
  const originEvent = state.events.get(thread.originEventId);
  if (!originEvent) return null;
  
  // Get protagonist
  const protagonist = state.npcs.get(thread.protagonistIds[0]);
  if (!protagonist) return null;
  
  // Generate causal chain
  const causalChain = buildCausalChain(thread, state);
  
  // Determine what player knows vs reality
  const playerKnows = generatePlayerKnowledge(thread, state);
  const reality = generateRealityDescription(thread, state);
  
  // Generate approaches
  const approaches = generateApproaches(thread, state);
  
  // Generate consequences
  const consequences = generateConsequences(thread, state);
  
  const mission: Mission = {
    id: missionId,
    storyThreadId: thread.id,
    originatingEventId: thread.originEventId,
    causalChain,
    title: thread.title,
    description: generateMissionDescription(thread, state),
    location: protagonist.district,
    playerKnows,
    npcsKnow: generateNPCKnowledge(thread, state),
    reality,
    possibleApproaches: approaches,
    status: 'available',
    stakes: thread.stakes,
    consequences,
    causalDepth: thread.causalDepth,
    noveltyScore: thread.noveltyScore
  };
  
  return mission;
}

function buildCausalChain(thread: StoryThread, state: WorldState): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  
  function traverse(eventId: string) {
    if (visited.has(eventId)) return;
    visited.add(eventId);
    
    const event = state.events.get(eventId);
    if (!event) return;
    
    chain.unshift(eventId);
    
    for (const parentId of event.parentIds) {
      traverse(parentId);
    }
  }
  
  traverse(thread.originEventId);
  return chain;
}

function generatePlayerKnowledge(thread: StoryThread, state: WorldState): string[] {
  const knowledge: string[] = [];
  
  // Player knows the basic situation
  knowledge.push(thread.currentProblem);
  
  // Player may know some history
  const originEvent = state.events.get(thread.originEventId);
  if (originEvent) {
    knowledge.push(originEvent.description);
  }
  
  return knowledge;
}

function generateRealityDescription(thread: StoryThread, state: WorldState): string {
  // Full reality including hidden information
  const parts: string[] = [];
  
  parts.push(thread.currentProblem);
  
  // Add causal history
  for (const eventId of thread.eventIds.slice(0, 3)) {
    const event = state.events.get(eventId);
    if (event) {
      parts.push(event.description);
    }
  }
  
  return parts.join('. ');
}

function generateMissionDescription(thread: StoryThread, state: WorldState): string {
  const prot = state.npcs.get(thread.protagonistIds[0]);
  const protName = prot?.name || 'Someone';
  
  return `${protName} needs help with: ${thread.currentProblem}`;
}

function generateNPCKnowledge(thread: StoryThread, state: WorldState): Map<number, string[]> {
  const knowledge = new Map<number, string[]>();
  
  // Each NPC knows different things based on their memories
  for (const npcId of [...thread.protagonistIds, ...thread.antagonistIds, ...thread.otherParticipantIds]) {
    const npc = state.npcs.get(npcId);
    if (!npc) continue;
    
    const npcKnowledge: string[] = [];
    
    // NPC knows events they witnessed
    for (const eventId of thread.eventIds) {
      if (npc.knowledge.witnessedEvents.has(eventId)) {
        const event = state.events.get(eventId);
        if (event) {
          npcKnowledge.push(event.description);
        }
      }
    }
    
    knowledge.set(npcId, npcKnowledge);
  }
  
  return knowledge;
}

function generateApproaches(thread: StoryThread, state: WorldState): Approach[] {
  const approaches: Approach[] = [];
  
  // Generate approaches based on thread type
  if (thread.conflict.includes('debt')) {
    approaches.push({
      id: 'pay_debt',
      description: 'Help pay off the debt',
      requiredSkills: { trading: 20 },
      successProbability: 0.8,
      consequences: [
        { type: 'relationship', target: 'protagonist', effect: 'trust +0.3', probability: 1.0 },
        { type: 'economic', target: 'protagonist', effect: 'debt removed', probability: 1.0 }
      ]
    });
    
    approaches.push({
      id: 'negotiate_debt',
      description: 'Negotiate with the creditor',
      requiredSkills: { persuasion: 40 },
      successProbability: 0.5,
      consequences: [
        { type: 'relationship', target: 'protagonist', effect: 'gratitude', probability: 0.7 },
        { type: 'economic', target: 'debt', effect: 'reduced', probability: 0.5 }
      ]
    });
  }
  
  if (thread.conflict.includes('revenge') || thread.conflict.includes('betrayal')) {
    approaches.push({
      id: 'mediate',
      description: 'Try to mediate the conflict',
      requiredSkills: { persuasion: 50 },
      successProbability: 0.4,
      consequences: [
        { type: 'relationship', target: 'both', effect: 'affinity +0.2', probability: 0.4 },
        { type: 'reputation', target: 'player', effect: 'peacemaker', probability: 0.6 }
      ]
    });
    
    approaches.push({
      id: 'support_victim',
      description: 'Support the victim in seeking justice',
      successProbability: 0.7,
      consequences: [
        { type: 'relationship', target: 'protagonist', effect: 'loyalty +0.4', probability: 1.0 },
        { type: 'conflict', target: 'situation', effect: 'escalation', probability: 0.8 }
      ]
    });
  }
  
  if (thread.conflict.includes('theft') || thread.conflict.includes('crime')) {
    approaches.push({
      id: 'investigate',
      description: 'Investigate the crime',
      requiredSkills: { scholarship: 30 },
      successProbability: 0.6,
      consequences: [
        { type: 'knowledge', target: 'player', effect: 'discover culprit', probability: 0.6 },
        { type: 'reputation', target: 'player', effect: 'detective', probability: 0.8 }
      ]
    });
    
    approaches.push({
      id: 'confront_culprit',
      description: 'Confront the perpetrator',
      requiredSkills: { fighting: 40 },
      requiredTraits: { courage: 0.5 },
      successProbability: 0.5,
      consequences: [
        { type: 'justice', target: 'situation', effect: 'resolution', probability: 0.5 },
        { type: 'danger', target: 'player', effect: 'risk of violence', probability: 0.6 }
      ]
    });
  }
  
  return approaches;
}

function generateConsequences(thread: StoryThread, state: WorldState): Consequence[] {
  const consequences: Consequence[] = [];
  
  // Base consequences on thread type and stakes
  if (thread.stakes > 0.7) {
    consequences.push({
      type: 'escalation',
      target: 'situation',
      effect: 'conflict may worsen',
      probability: 0.6,
      delay: 30
    });
  }
  
  if (thread.eventIds.length > 3) {
    consequences.push({
      type: 'involvement',
      target: 'community',
      effect: 'more people get involved',
      probability: 0.4,
      delay: 60
    });
  }
  
  return consequences;
}

// ============================================================
// STORY RANKING
// ============================================================

export function rankStories(state: WorldState): StoryThread[] {
  const threads = Array.from(state.storyThreads.values());
  
  return threads.sort((a, b) => {
    // Multi-criteria ranking
    const scoreA = calculateStoryScore(a, state);
    const scoreB = calculateStoryScore(b, state);
    return scoreB - scoreA;
  });
}

function calculateStoryScore(thread: StoryThread, state: WorldState): number {
  let score = 0;
  
  // Causal depth (complexity)
  score += thread.causalDepth * 10;
  
  // Number of participants
  const totalParticipants = thread.protagonistIds.length + 
                           thread.antagonistIds.length + 
                           thread.otherParticipantIds.length;
  score += totalParticipants * 5;
  
  // Stakes
  score += thread.stakes * 30;
  
  // Escalation
  score += thread.escalation * 20;
  
  // Emotional weight
  score += thread.emotionalWeight * 25;
  
  // Novelty
  score += thread.noveltyScore * 15;
  
  // Number of events
  score += thread.eventIds.length * 3;
  
  // Unresolved issues
  score += thread.unresolvedIssues.length * 10;
  
  return score;
}
