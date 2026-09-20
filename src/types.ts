// ============================================================
// CORE TYPE DEFINITIONS FOR CAUSAL SIMULATION
// ============================================================

// Event Graph Node
export interface SimEvent {
  id: string;
  tick: number;
  type: string;
  
  // Causal structure
  parentIds: string[];      // Events that caused this
  childIds: string[];        // Events this caused
  
  // Participants
  actorIds: number[];
  targetIds: number[];
  witnessIds: number[];
  
  // Location
  locationId?: string;
  
  // State changes (what actually changed)
  stateChanges: StateChange[];
  
  // Decision information (if this was an NPC decision)
  decision?: {
    pressures: Record<string, number>;
    availableActions: { action: string; score: number }[];
    chosenAction: string;
    chosenScore: number;
    roll: number;
    threshold: number;
    success: boolean;
  };
  
  // Effects (downstream consequences)
  effects: {
    relationshipChanges?: RelationshipChange[];
    memoryCreations?: MemoryCreation[];
    economicEffects?: EconomicEffect[];
    healthEffects?: HealthEffect[];
    reputationEffects?: ReputationEffect[];
  };
  
  // Metadata
  salience: number;         // How important is this event?
  tags: string[];
  description: string;
}

export interface StateChange {
  type: string;             // 'npc', 'economy', 'relationship', 'world'
  targetId: string;         // NPC ID, resource name, etc.
  property: string;         // 'health', 'coin', 'affinity', etc.
  oldValue: any;
  newValue: any;
  delta?: number;
}

export interface RelationshipChange {
  npc1Id: number;
  npc2Id: number;
  property: 'affinity' | 'trust' | 'fear' | 'respect' | 'resentment';
  oldValue: number;
  newValue: number;
  delta: number;
  reason: string;           // Event ID or description
}

export interface MemoryCreation {
  npcId: number;
  eventId: string;
  valence: number;          // -1 to 1
  salience: number;         // 0 to 1
  confidence: number;       // 0 to 1
  source: 'witnessed' | 'told' | 'inferred';
}

export interface EconomicEffect {
  resource: string;
  supplyChange?: number;
  demandChange?: number;
  priceChange?: number;
}

export interface HealthEffect {
  npcId: number;
  delta: number;
  cause: string;
}

export interface ReputationEffect {
  npcId: number;
  faction: string;
  delta: number;
  reason: string;
}

// NPC with full causal state
export interface NPC {
  id: number;
  name: string;
  age: number;
  sex: 'M' | 'F';
  alive: boolean;
  birthTick: number;
  deathTick?: number;
  
  // Physical state
  health: number;
  hunger: number;
  rest: number;
  
  // Location
  district: string;
  
  // Economic state
  coin: number;
  inventory: Record<string, number>;
  job: string;
  
  // Social state
  relationships: Map<number, Relationship>;
  familyLinks: FamilyLink[];
  spouseId: number | null;
  parentIds: number[];
  
  // Psychological state
  traits: Traits;
  skills: Skills;
  memories: Memory[];
  goals: Goal[];
  
  // Knowledge (what they know vs reality)
  knowledge: Knowledge;
  
  // Social standing
  faction: string | null;
  reputation: Record<string, number>;
  
  // Legal status
  crimes: Crime[];
  debts: Debt[];
  
  // History tracking
  eventParticipation: string[];  // Event IDs
  decisionsMade: string[];       // Event IDs where this NPC made a decision
}

export interface Relationship {
  affinity: number;      // -1 to 1 (liking)
  trust: number;         // -1 to 1
  fear: number;          // 0 to 1
  respect: number;       // 0 to 1
  resentment: number;    // 0 to 1
  history: string[];     // Event IDs that shaped this relationship
}

export interface FamilyLink {
  type: 'parent' | 'child' | 'spouse' | 'sibling';
  npcId: number;
}

export interface Traits {
  greed: number;
  honesty: number;
  courage: number;
  empathy: number;
  ambition: number;
  curiosity: number;
  temper: number;
  loyalty: number;
  piety: number;
  cunning: number;
}

export interface Skills {
  farming: number;
  trading: number;
  crafting: number;
  fighting: number;
  stealth: number;
  persuasion: number;
  medicine: number;
  scholarship: number;
  leadership: number;
}

export interface Memory {
  id: string;
  eventId: string;
  tick: number;
  valence: number;
  salience: number;
  confidence: number;
  source: 'witnessed' | 'told' | 'inferred';
  participants: number[];
  description: string;
}

export interface Goal {
  id: string;
  type: string;
  targetId?: number;
  description: string;
  priority: number;
  createdTick: number;
  completed: boolean;
  relatedEventIds: string[];
}

export interface Knowledge {
  witnessedEvents: Set<string>;
  heardEvents: Set<string>;
  beliefs: Map<string, Belief>;
}

export interface Belief {
  subject: string;
  proposition: string;
  confidence: number;
  source: string;
  tick: number;
}

export interface Crime {
  type: string;
  tick: number;
  victimId?: number;
  solved: boolean;
  eventId: string;
}

export interface Debt {
  creditorId: number;
  amount: number;
  dueTick: number;
  eventId: string;
}

// Story Thread - persistent narrative structure
export interface StoryThread {
  id: string;
  title: string;
  status: 'active' | 'resolved' | 'dormant';
  
  // Origin
  originEventId: string;
  originTick: number;
  
  // Participants
  protagonistIds: number[];
  antagonistIds: number[];
  otherParticipantIds: number[];
  
  // Causal structure
  eventIds: string[];
  causalDepth: number;
  
  // Narrative properties
  conflict: string;
  stakes: number;
  escalation: number;
  
  // State
  currentProblem: string;
  unresolvedIssues: string[];
  
  // Metrics
  noveltyScore: number;
  emotionalWeight: number;
  
  // Timeline
  createdTick: number;
  lastUpdatedTick: number;
  resolvedTick?: number;
}

// Mission - actionable story for player
export interface Mission {
  id: string;
  storyThreadId: string;
  
  // Origin
  originatingEventId: string;
  causalChain: string[];
  
  // Content
  title: string;
  description: string;
  location: string;
  
  // Knowledge
  playerKnows: string[];
  npcsKnow: Map<number, string[]>;
  reality: string;
  
  // Approaches
  possibleApproaches: Approach[];
  
  // State
  status: 'available' | 'active' | 'completed' | 'failed';
  stakes: number;
  consequences: Consequence[];
  
  // Metrics
  causalDepth: number;
  noveltyScore: number;
}

export interface Approach {
  id: string;
  description: string;
  requiredTraits?: Partial<Traits>;
  requiredSkills?: Partial<Skills>;
  successProbability: number;
  consequences: Consequence[];
}

export interface Consequence {
  type: string;
  target: string;
  effect: string;
  probability: number;
  delay?: number;
}

// World State
export interface WorldState {
  tick: number;
  seed: number;
  rng: () => number;
  
  // Entities
  npcs: Map<number, NPC>;
  locations: Map<string, Location>;
  
  // Event graph
  events: Map<string, SimEvent>;
  eventGraph: EventGraph;
  
  // Story structures
  storyThreads: Map<string, StoryThread>;
  missions: Map<string, Mission>;
  
  // Economy
  economy: EconomyState;
  
  // Wildlife
  wildlife: WildlifeState;
  
  // Statistics
  stats: SimulationStats;
  
  // Metadata
  nextNpcId: number;
  nextEventId: number;
  nextStoryId: number;
  nextMissionId: number;
}

export interface Location {
  id: string;
  name: string;
  type: string;
  safety: number;
  resources: Record<string, number>;
}

export interface EventGraph {
  nodes: Map<string, SimEvent>;
  edges: Map<string, string[]>;  // eventId -> [parentEventIds]
  reverseEdges: Map<string, string[]>;  // eventId -> [childEventIds]
}

export interface EconomyState {
  resources: Map<string, ResourceState>;
  transactions: Transaction[];
}

export interface ResourceState {
  supply: number;
  demand: number;
  price: number;
  production: number;
  consumption: number;
}

export interface Transaction {
  tick: number;
  type: string;
  buyerId?: number;
  sellerId?: number;
  resource: string;
  amount: number;
  price: number;
  eventId: string;
}

export interface WildlifeState {
  creatures: Map<string, Creature>;
  populations: Map<string, number>;
}

export interface Creature {
  id: string;
  species: string;
  age: number;
  health: number;
  hunger: number;
  location: string;
  territory: string[];
  threat: number;
  alive: boolean;
  memories: string[];
}

export interface SimulationStats {
  populationByYear: number[];
  birthsByYear: number[];
  deathsByYear: number[];
  avgCoinByYear: number[];
  giniByYear: number[];
  crimeRateByYear: number[];
  foodPriceByYear: number[];
  minPopByYear: number[];
  maxPopByYear: number[];
  totalEvents: number;
  totalDecisions: number;
  avgCausalDepth: number;
}

// Export types for serialization
export interface ExportData {
  metadata: {
    seed: number;
    version: string;
    startTick: number;
    endTick: number;
    totalEvents: number;
    totalNPCs: number;
  };
  events: SimEvent[];
  npcs: NPC[];
  storyThreads: StoryThread[];
  missions: Mission[];
  economy: EconomyState;
  wildlife: WildlifeState;
  stats: SimulationStats;
  eventGraph: {
    nodes: string[];
    edges: [string, string][];
  };
}
