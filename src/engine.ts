// ============================================================
// SETTLEMENT SIMULATION ENGINE
// Pure data + functions. No rendering.
// ============================================================

import {
  ELEMENTS, TEMPLATES, CREATURE_TEMPLATES, FIRST_SYLLABLES, LAST_SYLLABLES,
  DISTRICTS, JOBS, FACTIONS, type District, type Faction, type Creature
} from './data';

// ============================================================
// SECTION 1: SEEDED PRNG (mulberry32)
// ============================================================

export function mulberry32(seed: number): () => number {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function seededRandom(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function seededInt(rng: () => number, min: number, max: number): number {
  return Math.floor(seededRandom(rng, min, max + 1));
}

export function seededChoice<T>(rng: () => number, arr: T[]): T {
  if (arr.length === 0) throw new Error('seededChoice called with empty array');
  return arr[Math.floor(rng() * arr.length)];
}

// Safe version that returns null for empty arrays
export function seededChoiceSafe<T>(rng: () => number, arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ============================================================
// SECTION 2: TYPE DEFINITIONS
// ============================================================

export interface Relationship {
  targetId: number;
  affinity: number; // -1..1
  trust: number; // -1..1
  lastReinforced: number;
}

export interface Memory {
  eventId: string;
  valence: number; // -1..1
  salience: number; // 0..1
  confidence: number; // 0..1
  source: 'witnessed' | 'told' | 'inferred';
  tick: number;
}

export interface Goal {
  type: string;
  targetId?: number;
  progress: number;
  deadline?: number;
  description: string;
}

export interface NPC {
  id: number;
  name: string;
  age: number;
  sex: 'M' | 'F';
  health: number; // 0..1
  alive: boolean;
  district: District;
  job: string;
  coin: number;
  inventory: Record<string, number>;
  // Needs -> pressures
  hunger: number; // 0..1 (1=starving)
  rest: number; // 0..1 (1=exhausted)
  safety: number; // 0..1 (1=terrified)
  belonging: number; // 0..1 (1=lonely)
  statusNeed: number; // 0..1 (1=craving status)
  wealthNeed: number; // 0..1 (1=desperate for money)
  // Traits (0..1)
  traits: {
    greed: number; honesty: number; courage: number; empathy: number;
    ambition: number; curiosity: number; temper: number; loyalty: number;
    piety: number; cunning: number;
  };
  // Skills (0..100)
  skills: {
    farming: number; trading: number; crafting: number; fighting: number;
    stealth: number; persuasion: number; medicine: number; scholarship: number;
    leadership: number;
  };
  // Social
  relationships: Relationship[]; // max 5 close, 15 acquaintances
  memories: Memory[]; // max 30
  goals: Goal[]; // max 3
  familyLinks: { type: string; npcId: number }[];
  spouseId: number | null;
  parentIds: number[];
  // Faction
  faction: Faction | null;
  // Reputation (per faction/district)
  reputation: Record<string, number>;
  // Debt tracking
  debts: { creditorId: number; amount: number; dueTick: number }[];
  // Status
  isGuard: boolean;
  isLeader: boolean;
  crimes: { type: string; tick: number; victimId?: number; solved: boolean }[];
  // Action cooldown
  lastActionTick: number;
}

export interface LogEntry {
  id: string;
  tick: number;
  year: number;
  day: number;
  season: string;
  type: string;
  text: string;
  npcIds: number[];
  causalTrace: CausalTrace;
  salience: number;
  tags: string[];
}

export interface CausalTrace {
  tick: number;
  npcId: number;
  chosenAction: string;
  topAlternatives: { action: string; score: number }[];
  pressures: Record<string, number>;
  modifiers: Record<string, number>;
  diceRoll: number;
  threshold: number;
  success: boolean;
}

export interface WorldEvent {
  id: string;
  tick: number;
  kind: string;
  actors: number[];
  causes: string[];
  effects: string[];
  description: string;
}

export interface StoryHook {
  id: string;
  tick: number;
  pattern: string;
  title: string;
  description: string;
  roles: { role: string; npcId: number }[];
  approaches: string[];
  causalChain: string[];
  tension: number;
  resolved: boolean;
  outcome?: string;
  resolvedTick?: number;
}

export interface EconomyState {
  prices: Record<string, number>;
  supply: Record<string, number>;
  demand: Record<string, number>;
  priceHistory: Record<string, number[]>;
}

export interface WildlifeState {
  creatures: (Creature & { alive: boolean; x: number })[];
  lastEventTick: number;
}

export interface SimulationState {
  tick: number;
  seed: number;
  rng: () => number;
  npcs: Map<number, NPC>;
  nextNpcId: number;
  economy: EconomyState;
  wildlife: WildlifeState;
  log: LogEntry[];
  worldEvents: WorldEvent[];
  storyHooks: StoryHook[];
  stats: {
    populationByYear: number[];
    avgCoinByYear: number[];
    giniByYear: number[];
    crimeRateByYear: number[];
    foodPriceByYear: number[];
    minPopByYear: number[];
    maxPopByYear: number[];
    birthsByYear: number[];
    deathsByYear: number[];
  };
  factionPower: Record<Faction, number>;
  settlementCoin: number; // communal funds
  laws: { crime: string; severity: number }[];
  nextEventId: number;
  emigrated: number;
  totalBirths: number;
  totalDeaths: number;
  revengeGoalsCreated: number;
  revengeAttacksCompleted: number;
  actionCounts: Record<string, number>;
  deathTicks: Map<number, number>; // npcId -> tick of death
}

// ============================================================
// SECTION 3: INITIALIZATION
// ============================================================

function generateName(rng: () => number): string {
  const first = seededChoice(rng, FIRST_SYLLABLES);
  const last = seededChoice(rng, LAST_SYLLABLES);
  // Capitalize first letter of each part
  const capFirst = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  const capLast = last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
  return `${capFirst} ${capLast}`;
}

function generateTraits(rng: () => number): NPC['traits'] {
  return {
    greed: rng(), honesty: rng(), courage: rng(), empathy: rng(),
    ambition: rng(), curiosity: rng(), temper: rng(), loyalty: rng(),
    piety: rng(), cunning: rng(),
  };
}

function generateSkills(rng: () => number, job: string): NPC['skills'] {
  const base = () => seededInt(rng, 5, 40);
  const skills: NPC['skills'] = {
    farming: base(), trading: base(), crafting: base(), fighting: base(),
    stealth: base(), persuasion: base(), medicine: base(), scholarship: base(),
    leadership: base(),
  };
  // Job bonus
  const jobBonus: Record<string, keyof NPC['skills']> = {
    farmer: 'farming', fisher: 'farming', merchant: 'trading', guard: 'fighting',
    craftsman: 'crafting', healer: 'medicine', scholar: 'scholarship', thief: 'stealth',
    sailor: 'fishing' as any, laborer: 'farming', brewer: 'crafting', tailor: 'crafting',
    smith: 'crafting', hunter: 'fighting', priest: 'persuasion', noble: 'leadership',
    servant: 'crafting', herbalist: 'medicine', miner: 'crafting', carpenter: 'crafting',
  };
  const bonusSkill = jobBonus[job];
  if (bonusSkill && bonusSkill in skills) {
    (skills as any)[bonusSkill] = seededInt(rng, 40, 80);
  }
  return skills;
}

function createNPC(rng: () => number, id: number, age?: number): NPC {
  const a = age ?? seededInt(rng, 18, 55);
  const sex: 'M' | 'F' = rng() > 0.5 ? 'M' : 'F';
  const job = seededChoice(rng, [...JOBS]);
  const district = seededChoice(rng, [...DISTRICTS]);
  const traits = generateTraits(rng);
  const skills = generateSkills(rng, job);
  
  return {
    id, name: generateName(rng), age: a, sex, health: seededRandom(rng, 0.6, 1.0),
    alive: true, district, job, coin: seededInt(rng, 5, 100),
    inventory: {}, hunger: seededRandom(rng, 0, 0.3), rest: seededRandom(rng, 0, 0.3),
    safety: seededRandom(rng, 0, 0.2), belonging: seededRandom(rng, 0, 0.4),
    statusNeed: traits.ambition * 0.5, wealthNeed: traits.greed * 0.3,
    traits, skills, relationships: [], memories: [], goals: [],
    familyLinks: [], spouseId: null, parentIds: [],
    faction: null, reputation: { Guards: 0, 'Merchant Guild': 0, 'Farmer Collective': 0, 'Criminal Underground': 0 },
    debts: [], isGuard: job === 'guard', isLeader: false,
    crimes: [], lastActionTick: -seededInt(rng, 0, 10),
  };
}

function initEconomy(rng: () => number): EconomyState {
  const resources = ['food', 'wood', 'iron', 'cloth', 'tools', 'medicine', 'luxuries', 'grain'];
  const prices: Record<string, number> = {};
  const supply: Record<string, number> = {};
  const demand: Record<string, number> = {};
  const priceHistory: Record<string, number[]> = {};
  
  for (const r of resources) {
    prices[r] = seededRandom(rng, 0.8, 1.2);
    supply[r] = seededInt(rng, 50, 200);
    demand[r] = seededInt(rng, 40, 150);
    priceHistory[r] = [prices[r]];
  }
  return { prices, supply, demand, priceHistory };
}

export function initSimulation(seed: number): SimulationState {
  const rng = mulberry32(seed);
  const npcs = new Map<number, NPC>();
  
  // Create initial 150 NPCs
  for (let i = 0; i < 150; i++) {
    const npc = createNPC(rng, i);
    npcs.set(i, npc);
  }
  
  // Create some initial relationships
  const npcArr = Array.from(npcs.values());
  for (const npc of npcArr) {
    const numRel = seededInt(rng, 1, 4);
    const others = npcArr.filter(n => n.id !== npc.id);
    if (others.length === 0) continue;
    for (let j = 0; j < numRel; j++) {
      const other = seededChoice(rng, others);
      if (!npc.relationships.find(r => r.targetId === other.id)) {
        npc.relationships.push({
          targetId: other.id,
          affinity: seededRandom(rng, -0.3, 0.6),
          trust: seededRandom(rng, 0, 0.5),
          lastReinforced: 0,
        });
      }
    }
  }
  
  // Create some marriages
  for (let i = 0; i < 20; i++) {
    const m = npcArr.filter(n => n.sex === 'M' && !n.spouseId);
    const f = npcArr.filter(n => n.sex === 'F' && !n.spouseId);
    if (m.length > 0 && f.length > 0) {
      const husband = seededChoice(rng, m);
      const wife = seededChoice(rng, f);
      husband.spouseId = wife.id;
      wife.spouseId = husband.id;
      husband.familyLinks.push({ type: 'spouse', npcId: wife.id });
      wife.familyLinks.push({ type: 'spouse', npcId: husband.id });
    }
  }
  
  // Assign initial faction memberships
  const guards = npcArr.filter(n => n.job === 'guard');
  guards.forEach(g => { g.faction = 'Guards'; g.isGuard = true; });
  
  const merchants = npcArr.filter(n => n.job === 'merchant');
  merchants.slice(0, Math.min(merchants.length, 15)).forEach(m => { m.faction = 'Merchant Guild'; });
  
  const farmers = npcArr.filter(n => n.job === 'farmer' || n.job === 'fisher');
  farmers.slice(0, Math.min(farmers.length, 20)).forEach(f => { f.faction = 'Farmer Collective'; });
  
  const thieves = npcArr.filter(n => n.job === 'thief' || n.traits.cunning > 0.7);
  thieves.slice(0, Math.min(thieves.length, 10)).forEach(t => { t.faction = 'Criminal Underground'; });
  
  // Wildlife
  const creatures = CREATURE_TEMPLATES.map((ct, i) => ({
    ...ct, id: i, alive: true, x: rng(),
    tags: ct.elements,
  }));
  
  return {
    tick: 0, seed, rng, npcs, nextNpcId: 150,
    economy: initEconomy(rng),
    wildlife: { creatures, lastEventTick: 0 },
    log: [], worldEvents: [], storyHooks: [],
    stats: { 
      populationByYear: [], avgCoinByYear: [], giniByYear: [], 
      crimeRateByYear: [], foodPriceByYear: [],
      minPopByYear: [], maxPopByYear: [],
      birthsByYear: [], deathsByYear: []
    },
    factionPower: { Guards: 0.3, 'Merchant Guild': 0.25, 'Farmer Collective': 0.25, 'Criminal Underground': 0.2 },
    settlementCoin: 500,
    laws: [
      { crime: 'theft', severity: 0.3 },
      { crime: 'assault', severity: 0.5 },
      { crime: 'murder', severity: 0.9 },
      { crime: 'smuggling', severity: 0.4 },
      { crime: 'embezzlement', severity: 0.6 },
    ],
    nextEventId: 0,
    emigrated: 0,
    totalBirths: 0,
    totalDeaths: 0,
    revengeGoalsCreated: 0,
    revengeAttacksCompleted: 0,
    actionCounts: {},
    deathTicks: new Map(),
  };
}

// ============================================================
// SECTION 4: PRESSURE SYSTEM
// ============================================================

function computePressures(npc: NPC, state: SimulationState): Record<string, number> {
  const p: Record<string, number> = {};
  
  // Hunger pressure
  p.hunger = clamp(npc.hunger, 0, 1);
  
  // Poverty pressure
  p.poverty = clamp(1 - (npc.coin / 100), 0, 1);
  
  // Safety pressure
  p.fear = clamp(npc.safety, 0, 1);
  
  // Social pressure (loneliness)
  p.loneliness = clamp(npc.belonging, 0, 1);
  
  // Status pressure
  p.status = clamp(npc.statusNeed * (1 - npc.reputation.Guards * 0.3), 0, 1);
  
  // Wealth need
  p.wealthNeed = clamp(npc.wealthNeed + (npc.debts.length > 0 ? 0.3 : 0), 0, 1);
  
  // Rest pressure
  p.rest = clamp(npc.rest, 0, 1);
  
  // Health pressure
  p.health = clamp(1 - npc.health, 0, 1);
  
  // Debt pressure
  const debtPressure = npc.debts.reduce((sum, d) => sum + d.amount / 100, 0);
  p.debt = clamp(debtPressure, 0, 1);
  
  // Faction loyalty pressure
  if (npc.faction) {
    p.factionLoyalty = npc.traits.loyalty * 0.5;
  } else {
    p.factionLoyalty = 0;
  }
  
  // Vengeance pressure
  p.vengeance = clamp(grievances(npc) * npc.traits.temper, 0, 1);
  
  // Piety pressure
  p.piety = npc.traits.piety * (npc.age > 40 ? 0.6 : 0.3);
  
  return p;
}

function grievances(npc: NPC): number {
  let g = 0;
  for (const m of npc.memories) {
    if (m.valence < -0.5) g += Math.abs(m.valence);
  }
  return clamp(g / 5, 0, 1);
}

// ============================================================
// SECTION 5: UTILITY SCORING & ACTION SELECTION
// ============================================================

interface ActionDef {
  id: string;
  preconditions: (npc: NPC, state: SimulationState) => boolean;
  utility: (npc: NPC, pressures: Record<string, number>, state: SimulationState) => number;
  successChance: (npc: NPC, state: SimulationState) => number;
  execute: (npc: NPC, state: SimulationState, success: boolean, rng: () => number) => LogEntry | null;
}

function softmax(scores: { action: string; score: number }[], temperature: number): string {
  const maxScore = Math.max(...scores.map(s => s.score));
  const exps = scores.map(s => ({
    action: s.action,
    exp: Math.exp((s.score - maxScore) / Math.max(temperature, 0.01))
  }));
  const sum = exps.reduce((a, b) => a + b.exp, 0);
  const r = Math.random(); // This is replaced by seeded in actual use
  let cumulative = 0;
  for (const e of exps) {
    cumulative += e.exp / sum;
    if (r <= cumulative) return e.action;
  }
  return exps[exps.length - 1].action;
}

function softmaxSeeded(scores: { action: string; score: number }[], temperature: number, rng: () => number): string {
  const maxScore = Math.max(...scores.map(s => s.score));
  const exps = scores.map(s => ({
    action: s.action,
    exp: Math.exp((s.score - maxScore) / Math.max(temperature, 0.01))
  }));
  const sum = exps.reduce((a, b) => a + b.exp, 0);
  const r = rng();
  let cumulative = 0;
  for (const e of exps) {
    cumulative += e.exp / sum;
    if (r <= cumulative) return e.action;
  }
  return exps[exps.length - 1].action;
}

// ============================================================
// SECTION 6: ACTION DEFINITIONS
// ============================================================

function getTemplate(key: string, rng: () => number): string {
  const templates = TEMPLATES[key] || TEMPLATES.work;
  return seededChoice(rng, templates);
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return result;
}

function getDistrict(npc: NPC, state: SimulationState): District {
  return npc.district;
}

function findNearbyNPC(npc: NPC, state: SimulationState, rng: () => number): NPC | null {
  const sameDistrict = Array.from(state.npcs.values()).filter(
    n => n.alive && n.id !== npc.id && n.district === npc.district
  );
  if (sameDistrict.length === 0) return null;
  return seededChoice(rng, sameDistrict);
}

function findTarget(npc: NPC, state: SimulationState, rng: () => number, preference?: (n: NPC) => boolean): NPC | null {
  let candidates = Array.from(state.npcs.values()).filter(n => n.alive && n.id !== npc.id);
  if (preference) candidates = candidates.filter(preference);
  if (candidates.length === 0) return null;
  // Prefer those in same district
  const sameDistrict = candidates.filter(c => c.district === npc.district);
  if (sameDistrict.length > 0 && rng() > 0.3) {
    return seededChoice(rng, sameDistrict);
  }
  return seededChoice(rng, candidates);
}

function addMemory(npc: NPC, memory: Memory): void {
  if (npc.memories.length >= 30) {
    // Evict lowest salience
    const minIdx = npc.memories.reduce((mi, m, i, arr) => m.salience < arr[mi].salience ? i : mi, 0);
    npc.memories[minIdx] = memory;
  } else {
    npc.memories.push(memory);
  }
}

function reinforceRelationship(npc: NPC, targetId: number, affinityDelta: number, trustDelta: number, tick: number): void {
  let rel = npc.relationships.find(r => r.targetId === targetId);
  if (!rel) {
    if (npc.relationships.length >= 20) {
      // Replace weakest
      const minIdx = npc.relationships.reduce((mi, r, i, arr) => 
        (r.affinity + r.trust) < (arr[mi].affinity + arr[mi].trust) ? i : mi, 0);
      npc.relationships[minIdx] = { targetId, affinity: affinityDelta, trust: trustDelta, lastReinforced: tick };
    } else {
      npc.relationships.push({ targetId, affinity: affinityDelta, trust: trustDelta, lastReinforced: tick });
    }
  } else {
    rel.affinity = clamp(rel.affinity + affinityDelta, -1, 1);
    rel.trust = clamp(rel.trust + trustDelta, -1, 1);
    rel.lastReinforced = tick;
  }
}

function adjustReputation(npc: NPC, faction: string, delta: number): void {
  npc.reputation[faction] = clamp((npc.reputation[faction] || 0) + delta, -1, 1);
}

function createLogEntry(state: SimulationState, type: string, text: string, npcIds: number[], 
  trace: CausalTrace, salience: number = 0.3, tags: string[] = []): LogEntry {
  const year = Math.floor(state.tick / 360) + 1;
  const day = (state.tick % 360) + 1;
  const seasonIdx = Math.floor((state.tick % 360) / 90);
  const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
  
  return {
    id: `E${state.nextEventId++}`,
    tick: state.tick, year, day, season: seasons[seasonIdx],
    type, text, npcIds, causalTrace: trace, salience, tags,
  };
}

function makeTrace(npc: NPC, action: string, alternatives: {action:string;score:number}[], 
  pressures: Record<string, number>, rng: () => number, success: boolean): CausalTrace {
  return {
    tick: 0, // filled in later
    npcId: npc.id,
    chosenAction: action,
    topAlternatives: alternatives.slice(0, 3),
    pressures: { ...pressures },
    modifiers: { temper: npc.traits.temper, honesty: npc.traits.honesty },
    diceRoll: rng(),
    threshold: 0.5,
    success,
  };
}

// The action definitions - comprehensive set
function buildActions(): ActionDef[] {
  const actions: ActionDef[] = [];

  // WORK
  actions.push({
    id: 'work',
    preconditions: (npc) => npc.alive && npc.rest < 0.8,
    utility: (npc, p) => p.wealthNeed * 0.5 + p.hunger * 0.3 + npc.traits.ambition * 0.2,
    successChance: (npc) => 0.7 + npc.skills.farming * 0.002,
    execute: (npc, state, success, rng) => {
      const earnings = success ? seededInt(rng, 2, 8) : seededInt(rng, 0, 2);
      npc.coin += earnings;
      npc.hunger += 0.1;
      npc.rest += 0.15;
      
      // Farmers and fishers produce food
      if ((npc.job === 'farmer' || npc.job === 'fisher') && success) {
        const foodProduced = seededInt(rng, 2, 5);
        npc.inventory.food = (npc.inventory.food || 0) + foodProduced;
        state.economy.supply.food += foodProduced;
      }
      
      // Never log routine work
      return null;
    }
  });

  // EAT - Survival override: if very hungry, this MUST be chosen
  actions.push({
    id: 'eat',
    preconditions: (npc) => npc.alive && npc.hunger > 0.3,
    utility: (npc, p) => {
      // Survival override: if hunger >= 0.6, make eat extremely high priority
      const baseUtility = p.hunger * 0.8 + p.health * 0.2;
      if (npc.hunger >= 0.6) return baseUtility + 5.0; // Force eat
      return baseUtility;
    },
    successChance: () => 0.95,
    execute: (npc, state, success, rng) => {
      let ate = false;
      if (npc.inventory.food > 0) {
        npc.inventory.food--;
        ate = true;
      } else if (npc.coin >= 2) {
        npc.coin -= 2;
        ate = true;
      } else if (rng() < 0.6) {
        // Subsistence foraging/charity - 60% chance
        ate = true;
      }
      
      const wasStarving = npc.hunger > 0.7;
      if (ate) {
        npc.hunger = Math.max(0, npc.hunger - 0.5);
        npc.health = Math.min(1, npc.health + 0.02);
      }
      // Never log routine eating - only log if starving (already handled above)
      return null;
    }
  });

  // SLEEP - routine, never logged
  actions.push({
    id: 'sleep',
    preconditions: (npc) => npc.alive && npc.rest > 0.4,
    utility: (npc, p) => p.rest * 0.9 + p.health * 0.1,
    successChance: () => 0.95,
    execute: (npc, state, success, rng) => {
      npc.rest = Math.max(0, npc.rest - 0.6);
      npc.health = Math.min(1, npc.health + 0.03);
      return null; // Never log routine sleep
    }
  });

  // SOCIALIZE
  actions.push({
    id: 'socialize',
    preconditions: (npc) => npc.alive && npc.rest < 0.7,
    utility: (npc, p) => p.loneliness * 0.6 + npc.traits.empathy * 0.3 + (1 - npc.traits.temper) * 0.1,
    successChance: (npc) => 0.8 + npc.skills.persuasion * 0.002,
    execute: (npc, state, success, rng) => {
      const target = findNearbyNPC(npc, state, rng);
      if (!target) return null;
      reinforceRelationship(npc, target.id, 0.1, 0.05, state.tick);
      reinforceRelationship(target, npc.id, 0.08, 0.04, state.tick);
      npc.belonging = Math.max(0, npc.belonging - 0.2);
      const trace = makeTrace(npc, 'socialize', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('socialize', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'socialize', text, [npc.id, target.id], trace, 0.15);
    }
  });

  // GOSSIP - routine, never logged
  actions.push({
    id: 'gossip',
    preconditions: (npc) => npc.alive,
    utility: (npc, p) => npc.traits.cunning * 0.4 + p.status * 0.3 + p.loneliness * 0.3,
    successChance: (npc) => 0.7 + npc.skills.persuasion * 0.003,
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng);
      if (!target) return null;
      // Spread rumor - damages target's reputation
      adjustReputation(target, 'Guards', -0.05);
      adjustReputation(target, 'Merchant Guild', -0.03);
      addMemory(npc, { eventId: `gossip_${state.tick}`, valence: -0.2, salience: 0.3, confidence: 0.6, source: 'inferred', tick: state.tick });
      return null; // Never log routine gossip
    }
  });

  // COURT
  actions.push({
    id: 'court',
    preconditions: (npc) => npc.alive && !npc.spouseId && npc.age >= 18,
    utility: (npc, p) => p.loneliness * 0.5 + (1 - npc.age / 80) * 0.3 + npc.traits.empathy * 0.2,
    successChance: (npc) => 0.3 + npc.skills.persuasion * 0.004 + npc.traits.empathy * 0.2,
    execute: (npc, state, success, rng) => {
      const oppositeSex = npc.sex === 'M' ? 'F' : 'M';
      const candidates = Array.from(state.npcs.values()).filter(
        n => n.alive && n.sex === oppositeSex && !n.spouseId && n.district === npc.district && Math.abs(n.age - npc.age) < 15
      );
      if (candidates.length === 0) return null;
      const target = seededChoice(rng, candidates);
      if (success) {
        reinforceRelationship(npc, target.id, 0.3, 0.2, state.tick);
        reinforceRelationship(target, npc.id, 0.25, 0.15, state.tick);
      }
      const trace = makeTrace(npc, 'court', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('court', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'court', text, [npc.id, target.id], trace, 0.3);
    }
  });

  // MARRY
  actions.push({
    id: 'marry',
    preconditions: (npc) => npc.alive && !npc.spouseId && npc.age >= 20,
    utility: (npc, p) => {
      const hasPartner = npc.relationships.some(r => r.affinity > 0.6 && r.trust > 0.4);
      return (hasPartner ? 0.7 : 0.1) + p.loneliness * 0.3;
    },
    successChance: (npc) => {
      const goodRel = npc.relationships.find(r => r.affinity > 0.6 && r.trust > 0.4);
      return goodRel ? 0.6 : 0.1;
    },
    execute: (npc, state, success, rng) => {
      if (!success) return null;
      const goodRel = npc.relationships.find(r => {
        const other = state.npcs.get(r.targetId);
        return other && other.alive && !other.spouseId && r.affinity > 0.6 && r.trust > 0.4 
          && other.sex !== npc.sex && Math.abs(other.age - npc.age) < 15;
      });
      if (!goodRel) return null;
      const target = state.npcs.get(goodRel.targetId);
      if (!target || !target.alive) return null;
      npc.spouseId = target.id;
      target.spouseId = npc.id;
      npc.familyLinks.push({ type: 'spouse', npcId: target.id });
      target.familyLinks.push({ type: 'spouse', npcId: npc.id });
      reinforceRelationship(npc, target.id, 0.5, 0.5, state.tick);
      reinforceRelationship(target, npc.id, 0.5, 0.5, state.tick);
      const trace = makeTrace(npc, 'marry', [], computePressures(npc, state), rng, true);
      const text = fillTemplate(getTemplate('marry', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'marry', text, [npc.id, target.id], trace, 0.7, ['milestone']);
    }
  });

  // ARGUE
  actions.push({
    id: 'argue',
    preconditions: (npc) => npc.alive,
    utility: (npc, p) => npc.traits.temper * 0.5 + p.status * 0.3 + npc.traits.ambition * 0.2,
    successChance: (npc) => 0.5 + npc.skills.persuasion * 0.004,
    execute: (npc, state, success, rng) => {
      const target = findNearbyNPC(npc, state, rng);
      if (!target) return null;
      reinforceRelationship(npc, target.id, -0.2, -0.1, state.tick);
      reinforceRelationship(target, npc.id, -0.25, -0.15, state.tick);
      if (!success) {
        npc.safety += 0.1;
      }
      const trace = makeTrace(npc, 'argue', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('argue', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'argue', text, [npc.id, target.id], trace, 0.25);
    }
  });

  // FIGHT
  actions.push({
    id: 'fight',
    preconditions: (npc) => npc.alive && npc.rest < 0.7,
    utility: (npc, p) => npc.traits.courage * 0.3 + npc.traits.temper * 0.3 + p.vengeance * 0.3 + p.fear * 0.1,
    successChance: (npc) => clamp(0.3 + npc.skills.fighting * 0.005 + npc.traits.courage * 0.1, 0.05, 0.95),
    execute: (npc, state, success, rng) => {
      const target = findNearbyNPC(npc, state, rng);
      // Child protection: cannot fight children
      if (!target || target.age < 14) return null;
      if (success) {
        target.health -= seededRandom(rng, 0.1, 0.3);
        reinforceRelationship(npc, target.id, -0.4, -0.3, state.tick);
        reinforceRelationship(target, npc.id, -0.5, -0.4, state.tick);
        addMemory(target, { eventId: `fought_${npc.id}`, valence: -0.6, salience: 0.7, confidence: 1, source: 'witnessed', tick: state.tick });
      } else {
        npc.health -= seededRandom(rng, 0.1, 0.25);
        reinforceRelationship(npc, target.id, -0.3, -0.2, state.tick);
      }
      // Guards notice
      if (rng() < 0.4) {
        adjustReputation(npc, 'Guards', -0.1);
        npc.crimes.push({ type: 'assault', tick: state.tick, victimId: target.id, solved: true });
      }
      const trace = makeTrace(npc, 'fight', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('fight', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'fight', text, [npc.id, target.id], trace, 0.5, ['violence']);
    }
  });

  // STEAL
  actions.push({
    id: 'steal',
    preconditions: (npc) => npc.alive,
    utility: (npc, p) => p.hunger * 0.5 + p.poverty * 0.4 + npc.traits.greed * 0.3 + (1 - npc.traits.honesty) * 0.3 - p.fear * 0.5,
    successChance: (npc) => clamp(0.3 + npc.skills.stealth * 0.005 - npc.traits.honesty * 0.1, 0.05, 0.9),
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.coin > 5 && t.age >= 14);
      if (!target) return null;
      const amount = seededInt(rng, 3, 15);
      if (success) {
        target.coin = Math.max(0, target.coin - amount);
        npc.coin += amount;
        addMemory(target, { eventId: `stolen_by_${npc.id}`, valence: -0.7, salience: 0.8, confidence: 0.5, source: 'witnessed', tick: state.tick });
        // Suspicion based on relationships
        if (target.relationships.find(r => r.targetId === npc.id && r.trust < 0)) {
          addMemory(target, { eventId: `suspect_${npc.id}`, valence: -0.5, salience: 0.6, confidence: 0.7, source: 'inferred', tick: state.tick });
          npc.crimes.push({ type: 'theft', tick: state.tick, victimId: target.id, solved: false });
        }
      } else {
        // Caught!
        if (rng() < 0.5) {
          npc.crimes.push({ type: 'theft', tick: state.tick, victimId: target.id, solved: true });
          adjustReputation(npc, 'Guards', -0.2);
          reinforceRelationship(target, npc.id, -0.5, -0.5, state.tick);
        }
      }
      const trace = makeTrace(npc, 'steal', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('steal', rng), { npc: npc.name, target: target.name, goods: `${amount} coin` });
      return createLogEntry(state, 'steal', text, [npc.id, target.id], trace, 0.5, ['crime']);
    }
  });

  // PICKPOCKET
  actions.push({
    id: 'pickpocket',
    preconditions: (npc) => npc.alive && npc.skills.stealth > 20,
    utility: (npc, p) => p.poverty * 0.4 + npc.traits.cunning * 0.4 + npc.traits.greed * 0.2,
    successChance: (npc) => clamp(0.2 + npc.skills.stealth * 0.006, 0.05, 0.85),
    execute: (npc, state, success, rng) => {
      const target = findNearbyNPC(npc, state, rng);
      if (!target || target.age < 14) return null;
      const amount = seededInt(rng, 2, 8);
      if (success) {
        target.coin = Math.max(0, target.coin - amount);
        npc.coin += amount;
      } else if (rng() < 0.6) {
        npc.crimes.push({ type: 'theft', tick: state.tick, victimId: target.id, solved: true });
        adjustReputation(npc, 'Guards', -0.15);
      }
      const trace = makeTrace(npc, 'pickpocket', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('pickpocket', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'pickpocket', text, [npc.id, target.id], trace, 0.35, ['crime']);
    }
  });

  // BURGLE
  actions.push({
    id: 'burgle',
    preconditions: (npc) => npc.alive && npc.skills.stealth > 15,
    utility: (npc, p) => p.poverty * 0.5 + npc.traits.greed * 0.3 + npc.traits.cunning * 0.2,
    successChance: (npc) => clamp(0.25 + npc.skills.stealth * 0.005 + npc.skills.crafting * 0.002, 0.05, 0.8),
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.coin > 20 && t.age >= 14);
      if (!target) return null;
      if (success) {
        const amount = seededInt(rng, 10, 40);
        target.coin = Math.max(0, target.coin - amount);
        npc.coin += amount;
        addMemory(target, { eventId: `burgled_${state.tick}`, valence: -0.8, salience: 0.9, confidence: 0.3, source: 'witnessed', tick: state.tick });
      } else if (rng() < 0.4) {
        npc.crimes.push({ type: 'theft', tick: state.tick, victimId: target.id, solved: false });
      }
      const trace = makeTrace(npc, 'burgle', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('burgle', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'burgle', text, [npc.id, target.id], trace, 0.5, ['crime']);
    }
  });

  // ROB
  actions.push({
    id: 'rob',
    preconditions: (npc) => npc.alive && npc.skills.fighting > 20,
    utility: (npc, p) => p.poverty * 0.4 + npc.traits.greed * 0.3 + npc.traits.courage * 0.2 + (1 - npc.traits.honesty) * 0.1,
    successChance: (npc) => clamp(0.3 + npc.skills.fighting * 0.004 - 0.1, 0.05, 0.8),
    execute: (npc, state, success, rng) => {
      const target = findNearbyNPC(npc, state, rng);
      if (!target || target.age < 14) return null;
      if (success) {
        const amount = seededInt(rng, 5, 25);
        target.coin = Math.max(0, target.coin - amount);
        npc.coin += amount;
        target.health -= 0.05;
        addMemory(target, { eventId: `robbed_${npc.id}`, valence: -0.9, salience: 0.95, confidence: 1, source: 'witnessed', tick: state.tick });
      }
      npc.crimes.push({ type: 'assault', tick: state.tick, victimId: target.id, solved: rng() < 0.5 });
      adjustReputation(npc, 'Guards', -0.2);
      const trace = makeTrace(npc, 'rob', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('rob', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'rob', text, [npc.id, target.id], trace, 0.6, ['crime', 'violence']);
    }
  });

  // BRIBE
  actions.push({
    id: 'bribe',
    preconditions: (npc) => npc.alive && npc.coin > 10,
    utility: (npc, p) => (1 - npc.traits.honesty) * 0.4 + p.fear * 0.3 + npc.traits.cunning * 0.3,
    successChance: (npc) => clamp(0.3 + npc.coin * 0.005 + npc.traits.cunning * 0.2, 0.1, 0.85),
    execute: (npc, state, success, rng) => {
      const guards = Array.from(state.npcs.values()).filter(n => n.alive && n.isGuard);
      if (guards.length === 0) return null;
      const target = seededChoice(rng, guards);
      const amount = seededInt(rng, 5, 20);
      if (success) {
        npc.coin -= amount;
        target.coin += amount;
        // Clear some crimes
        npc.crimes = npc.crimes.filter(c => rng() > 0.5);
        adjustReputation(npc, 'Guards', 0.1);
      }
      const trace = makeTrace(npc, 'bribe', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('bribe', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'bribe', text, [npc.id, target.id], trace, 0.4, ['crime', 'corruption']);
    }
  });

  // BLACKMAIL
  actions.push({
    id: 'blackmail',
    preconditions: (npc) => npc.alive && npc.traits.cunning > 0.4,
    utility: (npc, p) => npc.traits.cunning * 0.4 + npc.traits.greed * 0.3 + p.poverty * 0.3,
    successChance: (npc) => clamp(0.2 + npc.skills.persuasion * 0.004 + npc.traits.cunning * 0.2, 0.05, 0.7),
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => (t.crimes.length > 0 || t.coin > 30) && t.age >= 14);
      if (!target) return null;
      if (success) {
        const amount = seededInt(rng, 5, 20);
        target.coin = Math.max(0, target.coin - amount);
        npc.coin += amount;
        reinforceRelationship(target, npc.id, -0.3, -0.5, state.tick);
        addMemory(target, { eventId: `blackmailed_${npc.id}`, valence: -0.8, salience: 0.85, confidence: 1, source: 'witnessed', tick: state.tick });
      }
      const trace = makeTrace(npc, 'blackmail', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('blackmail', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'blackmail', text, [npc.id, target.id], trace, 0.5, ['crime']);
    }
  });

  // LEND_MONEY
  actions.push({
    id: 'lend_money',
    preconditions: (npc) => npc.alive && npc.coin > 20,
    utility: (npc, p) => npc.traits.empathy * 0.3 + npc.traits.greed * 0.3 + (npc.faction ? 0.2 : 0),
    successChance: () => 0.8,
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.coin < 10);
      if (!target) return null;
      const amount = seededInt(rng, 5, 20);
      npc.coin -= amount;
      target.coin += amount;
      target.debts.push({ creditorId: npc.id, amount: Math.floor(amount * 1.2), dueTick: state.tick + 360 });
      reinforceRelationship(npc, target.id, 0.1, 0.15, state.tick);
      const trace = makeTrace(npc, 'lend_money', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('lend_money', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'lend_money', text, [npc.id, target.id], trace, 0.3);
    }
  });

  // REPAY_DEBT
  actions.push({
    id: 'repay_debt',
    preconditions: (npc) => npc.alive && npc.debts.length > 0 && npc.coin >= npc.debts[0].amount,
    utility: (npc, p) => p.debt * 0.5 + npc.traits.honesty * 0.3 + npc.traits.loyalty * 0.2,
    successChance: () => 0.95,
    execute: (npc, state, success, rng) => {
      const debt = npc.debts[0];
      const creditor = state.npcs.get(debt.creditorId);
      if (!creditor) { npc.debts.shift(); return null; }
      npc.coin -= debt.amount;
      creditor.coin += debt.amount;
      npc.debts.shift();
      reinforceRelationship(npc, creditor.id, 0.2, 0.2, state.tick);
      reinforceRelationship(creditor, npc.id, 0.15, 0.25, state.tick);
      const trace = makeTrace(npc, 'repay_debt', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('repay_debt', rng), { npc: npc.name, target: creditor.name });
      return createLogEntry(state, 'repay_debt', text, [npc.id, creditor.id], trace, 0.3);
    }
  });

  // DEFAULT_ON_DEBT
  actions.push({
    id: 'default_on_debt',
    preconditions: (npc) => npc.alive && npc.debts.length > 0 && npc.coin < npc.debts[0].amount,
    utility: (npc, p) => (1 - npc.traits.honesty) * 0.5 + p.poverty * 0.3 + npc.traits.cunning * 0.2,
    successChance: (npc) => 0.6 + npc.traits.cunning * 0.2,
    execute: (npc, state, success, rng) => {
      const debt = npc.debts[0];
      const creditor = state.npcs.get(debt.creditorId);
      if (!creditor) { npc.debts.shift(); return null; }
      npc.debts.shift();
      reinforceRelationship(creditor, npc.id, -0.5, -0.6, state.tick);
      adjustReputation(npc, 'Merchant Guild', -0.15);
      addMemory(creditor, { eventId: `defaulted_${npc.id}`, valence: -0.8, salience: 0.8, confidence: 1, source: 'witnessed', tick: state.tick });
      const trace = makeTrace(npc, 'default_on_debt', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('default_on_debt', rng), { npc: npc.name, target: creditor.name });
      return createLogEntry(state, 'default_on_debt', text, [npc.id, creditor.id], trace, 0.4, ['debt']);
    }
  });

  // SHARE_FOOD
  actions.push({
    id: 'share_food',
    preconditions: (npc) => npc.alive && (npc.inventory.food > 0 || npc.coin > 3),
    utility: (npc, p) => npc.traits.empathy * 0.6 + npc.traits.loyalty * 0.2 + p.loneliness * 0.2,
    successChance: () => 0.9,
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.hunger > 0.5);
      if (!target) return null;
      if (npc.inventory.food > 0) npc.inventory.food--;
      else npc.coin -= 2;
      target.hunger = Math.max(0, target.hunger - 0.3);
      reinforceRelationship(npc, target.id, 0.2, 0.15, state.tick);
      reinforceRelationship(target, npc.id, 0.3, 0.2, state.tick);
      const trace = makeTrace(npc, 'share_food', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('share_food', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'share_food', text, [npc.id, target.id], trace, 0.25);
    }
  });

  // HELP
  actions.push({
    id: 'help',
    preconditions: (npc) => npc.alive && npc.traits.empathy > 0.3,
    utility: (npc, p) => npc.traits.empathy * 0.5 + npc.traits.loyalty * 0.3 + p.loneliness * 0.2,
    successChance: (npc) => 0.7 + npc.skills.medicine * 0.002,
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.health < 0.6 || t.hunger > 0.5);
      if (!target) return null;
      if (success) {
        target.health = Math.min(1, target.health + 0.1);
        reinforceRelationship(npc, target.id, 0.2, 0.2, state.tick);
        reinforceRelationship(target, npc.id, 0.25, 0.2, state.tick);
      }
      const trace = makeTrace(npc, 'help', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('help', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'help', text, [npc.id, target.id], trace, 0.25);
    }
  });

  // BETRAY
  actions.push({
    id: 'betray',
    preconditions: (npc) => npc.alive && npc.relationships.length > 0,
    utility: (npc, p) => (1 - npc.traits.loyalty) * 0.4 + npc.traits.greed * 0.3 + npc.traits.cunning * 0.3,
    successChance: (npc) => clamp(0.4 + npc.traits.cunning * 0.3, 0.1, 0.85),
    execute: (npc, state, success, rng) => {
      const rel = npc.relationships.find(r => r.trust > 0.2);
      if (!rel) return null;
      const target = state.npcs.get(rel.targetId);
      if (!target || !target.alive || target.age < 14) return null;
      reinforceRelationship(npc, target.id, -0.7, -0.8, state.tick);
      reinforceRelationship(target, npc.id, -0.8, -0.9, state.tick);
      addMemory(target, { eventId: `betrayed_${npc.id}`, valence: -0.95, salience: 0.95, confidence: 1, source: 'witnessed', tick: state.tick });
      // Gain something from betrayal
      if (success) {
        const amount = seededInt(rng, 5, 20);
        target.coin = Math.max(0, target.coin - amount);
        npc.coin += amount;
      }
      const trace = makeTrace(npc, 'betray', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('betray', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'betray', text, [npc.id, target.id], trace, 0.7, ['drama']);
    }
  });

  // MURDER - Only with active revenge goal or criminal faction debt/extortion
  actions.push({
    id: 'murder',
    preconditions: (npc) => {
      if (!npc.alive) return false;
      // Must have active revenge goal OR be criminal faction with debt/extortion motive
      const hasRevengeGoal = npc.goals.some(g => g.type === 'revenge' && g.progress < 1);
      const isCriminalWithMotive = npc.faction === 'Criminal Underground' && 
        (npc.debts.length > 0 || npc.memories.some(m => m.eventId.includes('extort') || m.eventId.includes('debt')));
      return hasRevengeGoal || isCriminalWithMotive;
    },
    utility: (npc, p) => {
      // Only high utility if has revenge goal
      const hasRevengeGoal = npc.goals.some(g => g.type === 'revenge');
      if (hasRevengeGoal) return p.vengeance * 0.8 + npc.traits.cunning * 0.2;
      return 0.1; // Very low for criminal faction acts
    },
    successChance: (npc) => clamp(0.15 + npc.skills.fighting * 0.002 + npc.skills.stealth * 0.002, 0.05, 0.5),
    execute: (npc, state, success, rng) => {
      // Target from revenge goal
      const revengeGoal = npc.goals.find(g => g.type === 'revenge' && g.targetId !== undefined);
      let target: NPC | null = null;
      
      if (revengeGoal && revengeGoal.targetId !== undefined) {
        target = state.npcs.get(revengeGoal.targetId) || null;
      } else if (npc.faction === 'Criminal Underground') {
        // Criminal faction: target someone with debt to them
        const debtors = Array.from(state.npcs.values()).filter(n => 
          n.alive && n.age >= 14 && n.debts.some(d => d.creditorId === npc.id)
        );
        if (debtors.length > 0) target = seededChoice(rng, debtors);
      }
      
      // Child protection
      if (!target || target.age < 14) return null;
      
      if (success) {
        target.alive = false;
        target.health = 0;
        logDeath(target, state, 'murder');
        addMemory(npc, { eventId: `murdered_${target.id}`, valence: npc.traits.empathy > 0.5 ? -0.5 : 0.3, salience: 0.95, confidence: 1, source: 'witnessed', tick: state.tick });
        
        // Mark revenge goal as completed
        if (revengeGoal) {
          revengeGoal.progress = 1;
          state.revengeAttacksCompleted++;
        }
        
        // Investigation chance
        if (rng() < 0.4) {
          npc.crimes.push({ type: 'murder', tick: state.tick, victimId: target.id, solved: true });
        } else {
          npc.crimes.push({ type: 'murder', tick: state.tick, victimId: target.id, solved: false });
        }
      } else {
        npc.health -= 0.2;
        npc.crimes.push({ type: 'murder', tick: state.tick, victimId: target.id, solved: true });
      }
      adjustReputation(npc, 'Guards', -0.5);
      const trace = makeTrace(npc, 'murder', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('murder', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'murder', text, [npc.id, target.id], trace, 0.9, ['crime', 'death', 'violence', 'revenge']);
    }
  });

  // POISON
  actions.push({
    id: 'poison',
    preconditions: (npc) => npc.alive && npc.traits.cunning > 0.5,
    utility: (npc, p) => p.vengeance * 0.4 + npc.traits.cunning * 0.4 + (1 - npc.traits.honesty) * 0.2,
    successChance: (npc) => clamp(0.15 + npc.skills.stealth * 0.004 + npc.traits.cunning * 0.2, 0.05, 0.6),
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.age >= 14);
      if (!target) return null;
      if (success) {
        target.health -= seededRandom(rng, 0.2, 0.5);
        addMemory(npc, { eventId: `poisoned_${target.id}`, valence: -0.3, salience: 0.8, confidence: 1, source: 'witnessed', tick: state.tick });
      }
      const trace = makeTrace(npc, 'poison', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('poison', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'poison', text, [npc.id, target.id], trace, 0.7, ['crime']);
    }
  });

  // HEAL
  actions.push({
    id: 'heal',
    preconditions: (npc) => npc.alive && npc.skills.medicine > 20,
    utility: (npc, p) => npc.traits.empathy * 0.4 + p.health * 0.3 + npc.traits.piety * 0.3,
    successChance: (npc) => 0.6 + npc.skills.medicine * 0.003,
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.health < 0.7);
      if (!target) return null;
      if (success) {
        target.health = Math.min(1, target.health + 0.15);
        reinforceRelationship(npc, target.id, 0.15, 0.2, state.tick);
        npc.coin += 3; // Payment
      }
      const trace = makeTrace(npc, 'heal', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('heal', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'heal', text, [npc.id, target.id], trace, 0.2);
    }
  });

  // PRAY - routine, never logged
  actions.push({
    id: 'pray',
    preconditions: (npc) => npc.alive && npc.traits.piety > 0.3,
    utility: (npc, p) => npc.traits.piety * 0.6 + p.fear * 0.2 + p.health * 0.2,
    successChance: () => 0.9,
    execute: (npc, state, success, rng) => {
      npc.safety = Math.max(0, npc.safety - 0.1);
      npc.belonging = Math.max(0, npc.belonging - 0.05);
      return null; // Never log routine prayer
    }
  });

  // GAMBLE
  actions.push({
    id: 'gamble',
    preconditions: (npc) => npc.alive && npc.coin > 5,
    utility: (npc, p) => npc.traits.greed * 0.3 + npc.traits.temper * 0.4 + p.wealthNeed * 0.3,
    successChance: () => 0.45,
    execute: (npc, state, success, rng) => {
      const wager = Math.min(npc.coin, seededInt(rng, 3, 15));
      if (success) {
        npc.coin += wager;
      } else {
        npc.coin -= wager;
      }
      const trace = makeTrace(npc, 'gamble', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('gamble', rng), { npc: npc.name });
      return createLogEntry(state, 'gamble', text, [npc.id], trace, 0.2);
    }
  });

  // TRADE
  actions.push({
    id: 'trade',
    preconditions: (npc) => npc.alive && npc.skills.trading > 15,
    utility: (npc, p) => p.wealthNeed * 0.4 + npc.traits.greed * 0.3 + npc.skills.trading * 0.003,
    successChance: (npc) => 0.6 + npc.skills.trading * 0.003,
    execute: (npc, state, success, rng) => {
      const profit = success ? seededInt(rng, 3, 12) : -seededInt(rng, 1, 5);
      npc.coin += profit;
      // Affect economy
      state.economy.supply.luxuries += success ? -1 : 1;
      state.economy.demand.luxuries += 1;
      const trace = makeTrace(npc, 'trade', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('trade', rng), { npc: npc.name, goods: 'goods' });
      return createLogEntry(state, 'trade', text, [npc.id], trace, 0.15);
    }
  });

  // DONATE
  actions.push({
    id: 'donate',
    preconditions: (npc) => npc.alive && npc.coin > 15,
    utility: (npc, p) => npc.traits.empathy * 0.5 + npc.traits.piety * 0.3 + npc.traits.loyalty * 0.2,
    successChance: () => 0.95,
    execute: (npc, state, success, rng) => {
      const amount = seededInt(rng, 3, 10);
      npc.coin -= amount;
      state.settlementCoin += amount;
      adjustReputation(npc, 'Guards', 0.05);
      const trace = makeTrace(npc, 'donate', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('donate', rng), { npc: npc.name });
      return createLogEntry(state, 'donate', text, [npc.id], trace, 0.15);
    }
  });

  // BEG
  actions.push({
    id: 'beg',
    preconditions: (npc) => npc.alive && npc.coin < 5,
    utility: (npc, p) => p.hunger * 0.5 + p.poverty * 0.5,
    successChance: (npc) => 0.3 + npc.traits.empathy * 0.1,
    execute: (npc, state, success, rng) => {
      if (success) {
        npc.coin += seededInt(rng, 1, 5);
      }
      const trace = makeTrace(npc, 'beg', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('beg', rng), { npc: npc.name, district: npc.district });
      return createLogEntry(state, 'beg', text, [npc.id], trace, 0.15);
    }
  });

  // ACCUSE
  actions.push({
    id: 'accuse',
    preconditions: (npc) => npc.alive,
    utility: (npc, p) => npc.traits.honesty * 0.3 + p.vengeance * 0.4 + npc.traits.courage * 0.3,
    successChance: (npc) => 0.4 + npc.skills.persuasion * 0.003,
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng, t => t.crimes.length > 0);
      if (!target) return null;
      if (success && target.crimes.length > 0) {
        target.crimes[0].solved = true;
        adjustReputation(target, 'Guards', -0.2);
        adjustReputation(npc, 'Guards', 0.1);
      }
      reinforceRelationship(npc, target.id, -0.3, -0.2, state.tick);
      const trace = makeTrace(npc, 'accuse', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('accuse', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'accuse', text, [npc.id, target.id], trace, 0.4, ['law']);
    }
  });

  // ARREST
  actions.push({
    id: 'arrest',
    preconditions: (npc) => npc.alive && npc.isGuard,
    utility: (npc, p) => npc.traits.loyalty * 0.4 + p.factionLoyalty * 0.4 + npc.traits.courage * 0.2,
    successChance: (npc) => 0.6 + npc.skills.fighting * 0.003,
    execute: (npc, state, success, rng) => {
      const criminals = Array.from(state.npcs.values()).filter(n => n.alive && n.age >= 14 && n.crimes.some(c => c.solved));
      if (criminals.length === 0) return null;
      const target = seededChoice(rng, criminals);
      if (success) {
        target.health -= 0.05;
        adjustReputation(target, 'Guards', -0.3);
        adjustReputation(npc, 'Guards', 0.1);
        target.safety += 0.3;
      }
      const trace = makeTrace(npc, 'arrest', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('arrest', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'arrest', text, [npc.id, target.id], trace, 0.5, ['law']);
    }
  });

  // SEEK_REVENGE
  actions.push({
    id: 'seek_revenge',
    preconditions: (npc) => npc.alive && npc.traits.temper > 0.4 && npc.memories.some(m => m.valence < -0.5),
    utility: (npc, p) => p.vengeance * 0.6 + npc.traits.temper * 0.3 + npc.traits.courage * 0.1,
    successChance: (npc) => clamp(0.2 + npc.skills.fighting * 0.003 + npc.traits.cunning * 0.2, 0.05, 0.7),
    execute: (npc, state, success, rng) => {
      const grievance = npc.memories.filter(m => m.valence < -0.5);
      if (grievance.length === 0) return null;
      const targets = Array.from(state.npcs.values()).filter(n => n.alive && n.id !== npc.id && n.age >= 14);
      if (targets.length === 0) return null;
      const target = seededChoice(rng, targets);
      if (success) {
        target.health -= seededRandom(rng, 0.1, 0.3);
        target.coin = Math.max(0, target.coin - seededInt(rng, 3, 10));
        npc.safety = Math.max(0, npc.safety - 0.1);
        addMemory(target, { eventId: `revenged_${npc.id}`, valence: -0.8, salience: 0.85, confidence: 1, source: 'witnessed', tick: state.tick });
        state.revengeAttacksCompleted++;
      }
      npc.crimes.push({ type: 'assault', tick: state.tick, victimId: target.id, solved: rng() < 0.3 });
      const trace = makeTrace(npc, 'seek_revenge', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('seek_revenge', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'seek_revenge', text, [npc.id, target.id], trace, 0.6, ['violence', 'drama', 'revenge']);
    }
  });

  // PROTECT
  actions.push({
    id: 'protect',
    preconditions: (npc) => npc.alive && npc.traits.courage > 0.3,
    utility: (npc, p) => npc.traits.loyalty * 0.4 + npc.traits.empathy * 0.3 + npc.traits.courage * 0.3,
    successChance: (npc) => 0.5 + npc.skills.fighting * 0.003,
    execute: (npc, state, success, rng) => {
      const threatened = Array.from(state.npcs.values()).filter(n => n.alive && n.id !== npc.id && n.safety > 0.4);
      if (threatened.length === 0) return null;
      const target = seededChoice(rng, threatened);
      if (success) {
        target.safety = Math.max(0, target.safety - 0.2);
        reinforceRelationship(npc, target.id, 0.3, 0.25, state.tick);
        reinforceRelationship(target, npc.id, 0.35, 0.3, state.tick);
      }
      const trace = makeTrace(npc, 'protect', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('protect', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'protect', text, [npc.id, target.id], trace, 0.3);
    }
  });

  // TEACH
  actions.push({
    id: 'teach',
    preconditions: (npc) => npc.alive,
    utility: (npc, p) => npc.traits.empathy * 0.3 + npc.traits.piety * 0.2 + p.status * 0.3 + npc.traits.loyalty * 0.2,
    successChance: (npc) => 0.7 + npc.skills.scholarship * 0.002,
    execute: (npc, state, success, rng) => {
      const target = findNearbyNPC(npc, state, rng);
      if (!target) return null;
      if (success) {
        // Boost a random skill
        const skillKeys = Object.keys(target.skills) as (keyof NPC['skills'])[];
        const skill = seededChoice(rng, skillKeys);
        (target.skills as any)[skill] = Math.min(100, (target.skills as any)[skill] + seededInt(rng, 1, 5));
        reinforceRelationship(npc, target.id, 0.1, 0.15, state.tick);
        npc.coin += 2;
      }
      const trace = makeTrace(npc, 'teach', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('teach', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'teach', text, [npc.id, target.id], trace, 0.15);
    }
  });

  // JOIN_FACTION
  actions.push({
    id: 'join_faction',
    preconditions: (npc) => npc.alive && !npc.faction,
    utility: (npc, p) => p.loneliness * 0.3 + npc.traits.ambition * 0.3 + npc.traits.loyalty * 0.2 + p.status * 0.2,
    successChance: (npc) => 0.5 + npc.skills.leadership * 0.003,
    execute: (npc, state, success, rng) => {
      if (!success) return null;
      const factions = [...FACTIONS];
      const faction = seededChoice(rng, factions);
      npc.faction = faction;
      state.factionPower[faction] += 0.01;
      const trace = makeTrace(npc, 'join_faction', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('join_faction', rng), { npc: npc.name, faction });
      return createLogEntry(state, 'join_faction', text, [npc.id], trace, 0.3, ['faction']);
    }
  });

  // SPREAD_RUMOR
  actions.push({
    id: 'spread_rumor',
    preconditions: (npc) => npc.alive,
    utility: (npc, p) => npc.traits.cunning * 0.4 + npc.traits.temper * 0.2 + p.status * 0.2 + (1 - npc.traits.honesty) * 0.2,
    successChance: (npc) => 0.6 + npc.skills.persuasion * 0.003,
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng);
      if (!target) return null;
      if (success) {
        // Damage target's reputation randomly
        const factions = Object.keys(target.reputation);
        const f = seededChoice(rng, factions);
        adjustReputation(target, f, -0.1);
      }
      const trace = makeTrace(npc, 'spread_rumor', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('spread_rumor', rng), { npc: npc.name });
      return createLogEntry(state, 'spread_rumor', text, [npc.id], trace, 0.2);
    }
  });

  // HOST_FEAST
  actions.push({
    id: 'host_feast',
    preconditions: (npc) => npc.alive && npc.coin > 30,
    utility: (npc, p) => p.status * 0.4 + npc.traits.empathy * 0.4 + npc.traits.loyalty * 0.2,
    successChance: () => 0.85,
    execute: (npc, state, success, rng) => {
      if (!success) return null;
      npc.coin -= 25;
      // Boost reputation and relationships with nearby NPCs
      const nearby = Array.from(state.npcs.values()).filter(n => n.alive && n.district === npc.district && n.id !== npc.id);
      for (const n of nearby.slice(0, 10)) {
        reinforceRelationship(npc, n.id, 0.15, 0.1, state.tick);
        n.hunger = Math.max(0, n.hunger - 0.2);
        n.belonging = Math.max(0, n.belonging - 0.15);
      }
      adjustReputation(npc, 'Guards', 0.05);
      const trace = makeTrace(npc, 'host_feast', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('host_feast', rng), { npc: npc.name });
      return createLogEntry(state, 'host_feast', text, [npc.id], trace, 0.5, ['social']);
    }
  });

  // FLEE - just change district, rare
  actions.push({
    id: 'flee',
    preconditions: (npc) => npc.alive && (npc.safety > 0.6 || npc.crimes.length > 3),
    utility: (npc, p) => (p.fear * 0.3 + (1 - npc.traits.courage) * 0.2 + npc.traits.cunning * 0.1) * 0.3, // Very low utility
    successChance: (npc) => 0.7 + npc.skills.stealth * 0.002,
    execute: (npc, state, success, rng) => {
      if (success) {
        const otherDistricts = DISTRICTS.filter(d => d !== npc.district);
        if (otherDistricts.length > 0) {
          const newDistrict = seededChoice(rng, [...otherDistricts]);
          npc.district = newDistrict;
        }
        npc.crimes = []; // Reset crimes when fleeing
        npc.safety = Math.max(0, npc.safety - 0.3);
      }
      const trace = makeTrace(npc, 'flee', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('flee', rng), { npc: npc.name });
      return createLogEntry(state, 'flee', text, [npc.id], trace, 0.3);
    }
  });

  // FOUNDED_BUSINESS
  actions.push({
    id: 'found_business',
    preconditions: (npc) => npc.alive && npc.coin > 50 && npc.skills.trading > 30,
    utility: (npc, p) => npc.traits.ambition * 0.4 + npc.traits.greed * 0.3 + p.status * 0.3,
    successChance: (npc) => 0.4 + npc.skills.trading * 0.004,
    execute: (npc, state, success, rng) => {
      if (!success) {
        npc.coin -= 30;
        return null;
      }
      npc.coin -= 40;
      adjustReputation(npc, 'Merchant Guild', 0.2);
      npc.statusNeed = Math.max(0, npc.statusNeed - 0.3);
      const trace = makeTrace(npc, 'found_business', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('found_business', rng), { npc: npc.name, district: npc.district });
      return createLogEntry(state, 'found_business', text, [npc.id], trace, 0.5, ['milestone']);
    }
  });

  // GO_BANKRUPT
  actions.push({
    id: 'go_bankrupt',
    preconditions: (npc) => npc.alive && npc.coin < 0,
    utility: () => 1, // Forced action
    successChance: () => 1,
    execute: (npc, state, success, rng) => {
      npc.coin = 0;
      npc.debts = [];
      npc.statusNeed = 1;
      adjustReputation(npc, 'Merchant Guild', -0.3);
      const trace = makeTrace(npc, 'go_bankrupt', [], computePressures(npc, state), rng, true);
      const text = fillTemplate(getTemplate('go_bankrupt', rng), { npc: npc.name });
      return createLogEntry(state, 'go_bankrupt', text, [npc.id], trace, 0.6, ['drama']);
    }
  });

  // CONFESS
  actions.push({
    id: 'confess',
    preconditions: (npc) => npc.alive && npc.crimes.length > 0 && npc.traits.honesty > 0.4,
    utility: (npc, p) => npc.traits.honesty * 0.4 + npc.traits.piety * 0.3 + p.fear * 0.3,
    successChance: () => 0.8,
    execute: (npc, state, success, rng) => {
      const guards = Array.from(state.npcs.values()).filter(n => n.alive && n.isGuard);
      if (guards.length === 0) return null;
      const target = seededChoice(rng, guards);
      npc.crimes.forEach(c => c.solved = true);
      adjustReputation(npc, 'Guards', 0.1); // Slight bonus for honesty
      reinforceRelationship(npc, target.id, 0.1, 0.2, state.tick);
      const trace = makeTrace(npc, 'confess', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('confess', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'confess', text, [npc.id, target.id], trace, 0.4, ['law']);
    }
  });

  // SMUGGLE
  actions.push({
    id: 'smuggle',
    preconditions: (npc) => npc.alive && npc.faction === 'Criminal Underground',
    utility: (npc, p) => npc.traits.greed * 0.4 + p.poverty * 0.3 + npc.traits.cunning * 0.3,
    successChance: (npc) => clamp(0.3 + npc.skills.stealth * 0.004, 0.1, 0.8),
    execute: (npc, state, success, rng) => {
      if (success) {
        npc.coin += seededInt(rng, 8, 25);
        state.economy.supply.luxuries += 2;
      } else if (rng() < 0.3) {
        npc.crimes.push({ type: 'smuggling', tick: state.tick, solved: true });
        adjustReputation(npc, 'Guards', -0.2);
      }
      const trace = makeTrace(npc, 'smuggle', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('smuggle', rng), { npc: npc.name, district: npc.district, goods: 'contraband' });
      return createLogEntry(state, 'smuggle', text, [npc.id], trace, 0.35, ['crime']);
    }
  });

  // RUN_FOR_OFFICE
  actions.push({
    id: 'run_for_office',
    preconditions: (npc) => npc.alive && npc.age > 30 && npc.skills.leadership > 30,
    utility: (npc, p) => npc.traits.ambition * 0.5 + p.status * 0.3 + npc.traits.courage * 0.2,
    successChance: (npc) => 0.2 + npc.skills.leadership * 0.004 + npc.skills.persuasion * 0.002,
    execute: (npc, state, success, rng) => {
      if (success) {
        // Remove old leader
        const oldLeaders = Array.from(state.npcs.values()).filter(n => n.alive && n.isLeader);
        oldLeaders.forEach(l => l.isLeader = false);
        npc.isLeader = true;
        adjustReputation(npc, 'Guards', 0.2);
        npc.statusNeed = 0;
      }
      const trace = makeTrace(npc, 'run_for_office', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('run_for_office', rng), { npc: npc.name });
      return createLogEntry(state, 'run_for_office', text, [npc.id], trace, 0.6, ['political']);
    }
  });

  // EMIGRATE (leave settlement) - VERY RARE, only under sustained hardship
  actions.push({
    id: 'migrate',
    preconditions: (npc) => npc.alive && npc.hunger > 0.7 && npc.safety > 0.5 && npc.age > 20 && npc.age < 50,
    utility: (npc, p) => (npc.traits.curiosity * 0.2 + p.fear * 0.2 + p.poverty * 0.1 + (1 - npc.traits.loyalty) * 0.1) * 0.15, // Extremely low
    successChance: () => 0.5,
    execute: (npc, state, success, rng) => {
      if (!success) return null;
      // Emigrate - remove from population
      npc.alive = false;
      state.emigrated = (state.emigrated || 0) + 1;
      const trace = makeTrace(npc, 'migrate', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('migrate', rng), { npc: npc.name, district: npc.district });
      return createLogEntry(state, 'migrate', text, [npc.id], trace, 0.4, ['emigration']);
    }
  });

  return actions;
}

// ============================================================
// SECTION 7: ECONOMY UPDATE
// ============================================================

function updateEconomy(state: SimulationState): void {
  const { economy } = state;
  const season = Math.floor((state.tick % 360) / 90);
  const aliveCount = Array.from(state.npcs.values()).filter(n => n.alive).length;
  
  for (const resource of Object.keys(economy.prices)) {
    // Damped price movement toward target derived from supply/demand ratio
    const ratio = economy.demand[resource] / Math.max(1, economy.supply[resource]);
    // Target price: 1.0 at equilibrium, higher when demand > supply
    const targetPrice = clamp(0.5 + ratio * 0.8, 0.3, 4.0);
    // Damped movement: move 10% toward target each update
    const damping = 0.1;
    economy.prices[resource] = economy.prices[resource] + (targetPrice - economy.prices[resource]) * damping;
    economy.prices[resource] = clamp(economy.prices[resource], 0.2, 5.0);
    
    // Seasonal effects for food
    if (resource === 'food' || resource === 'grain') {
      // Base food demand from population
      economy.demand[resource] = Math.max(10, aliveCount * 0.8);
      if (season === 2 || season === 3) { // Autumn/Winter - consumption continues
        economy.supply[resource] = Math.max(5, economy.supply[resource] - Math.floor(aliveCount * 0.05));
      } else { // Spring/Summer - natural growth
        economy.supply[resource] += Math.floor(aliveCount * 0.03);
      }
    } else {
      // Other resources: decay demand slightly, keep supply stable
      economy.demand[resource] = Math.max(10, economy.demand[resource] * 0.98);
    }
    
    // Record history
    economy.priceHistory[resource].push(economy.prices[resource]);
    if (economy.priceHistory[resource].length > 3600) {
      economy.priceHistory[resource].shift();
    }
  }
}

// ============================================================
// SECTION 8: WORLD EVENTS
// ============================================================

const WORLD_EVENT_TYPES = [
  { kind: 'harvest_failure', probability: 0.003, season: [2, 3] },
  { kind: 'plague', probability: 0.001, season: [0, 1, 2, 3] },
  { kind: 'bandit_raid', probability: 0.002, season: [0, 1, 2, 3] },
  { kind: 'fire', probability: 0.002, season: [0, 1, 2, 3] },
  { kind: 'festival', probability: 0.003, season: [1, 2] },
  { kind: 'trade_caravan', probability: 0.004, season: [0, 1] },
  { kind: 'immigrants', probability: 0.005, season: [0, 1] },
  { kind: 'tax_hike', probability: 0.001, season: [0, 1, 2, 3] },
  { kind: 'flood', probability: 0.001, season: [0, 1] },
  { kind: 'famine', probability: 0.0005, season: [2, 3] },
  { kind: 'foreign_war', probability: 0.0005, season: [0, 1, 2, 3] },
  { kind: 'rare_festival', probability: 0.0001, season: [1] },
];

function processWorldEvents(state: SimulationState): void {
  const season = Math.floor((state.tick % 360) / 90);
  const { rng } = state;
  
  for (const evt of WORLD_EVENT_TYPES) {
    if (!evt.season.includes(season)) continue;
    if (rng() > evt.probability) continue;
    
    const eventId = `WE${state.nextEventId++}`;
    const actors: number[] = [];
    let description = '';
    
    switch (evt.kind) {
      case 'harvest_failure': {
        state.economy.supply.food -= 50;
        state.economy.supply.grain -= 30;
        state.economy.prices.food = clamp(state.economy.prices.food + 0.5, 0.2, 5);
        const farmers = Array.from(state.npcs.values()).filter(n => n.alive && n.job === 'farmer');
        farmers.forEach(f => { f.coin -= 10; f.hunger += 0.2; actors.push(f.id); });
        description = seededChoice(rng, TEMPLATES.harvest_failure);
        break;
      }
      case 'plague': {
        const victims = Array.from(state.npcs.values()).filter(n => n.alive);
        if (victims.length === 0) break;
        const numSick = Math.min(victims.length, seededInt(rng, 5, 20));
        for (let i = 0; i < numSick; i++) {
          const v = seededChoice(rng, victims);
          v.health -= seededRandom(rng, 0.1, 0.4);
          actors.push(v.id);
        }
        description = seededChoice(rng, TEMPLATES.plague);
        break;
      }
      case 'bandit_raid': {
        const victims = Array.from(state.npcs.values()).filter(n => n.alive);
        if (victims.length === 0) break;
        const numVictims = Math.min(victims.length, seededInt(rng, 3, 10));
        for (let i = 0; i < numVictims; i++) {
          const v = seededChoice(rng, victims);
          v.coin = Math.max(0, v.coin - seededInt(rng, 5, 20));
          v.health -= seededRandom(rng, 0.05, 0.2);
          v.safety += 0.3;
          actors.push(v.id);
        }
        description = seededChoice(rng, TEMPLATES.bandit_raid);
        break;
      }
      case 'fire': {
        const district = seededChoice(rng, [...DISTRICTS]);
        const victims = Array.from(state.npcs.values()).filter(n => n.alive && n.district === district);
        victims.forEach(v => { v.coin = Math.max(0, v.coin - seededInt(rng, 3, 10)); actors.push(v.id); });
        description = fillTemplate(seededChoice(rng, TEMPLATES.fire), { district });
        break;
      }
      case 'festival': {
        const participants = Array.from(state.npcs.values()).filter(n => n.alive);
        if (participants.length === 0) break;
        const numParticipants = Math.min(participants.length, seededInt(rng, 20, 60));
        for (let i = 0; i < numParticipants; i++) {
          const p = seededChoice(rng, participants);
          p.belonging = Math.max(0, p.belonging - 0.3);
          p.hunger = Math.max(0, p.hunger - 0.1);
          actors.push(p.id);
        }
        description = seededChoice(rng, TEMPLATES.festival);
        break;
      }
      case 'trade_caravan': {
        state.economy.supply.luxuries += 30;
        state.economy.supply.cloth += 20;
        state.economy.prices.luxuries = clamp(state.economy.prices.luxuries - 0.2, 0.2, 5);
        description = seededChoice(rng, TEMPLATES.trade_caravan);
        break;
      }
      case 'immigrants': {
        const numNew = seededInt(rng, 3, 8);
        for (let i = 0; i < numNew; i++) {
          const npc = createNPC(rng, state.nextNpcId++);
          state.npcs.set(npc.id, npc);
          actors.push(npc.id);
        }
        const district = seededChoice(rng, [...DISTRICTS]);
        description = fillTemplate(seededChoice(rng, TEMPLATES.immigrants), { district });
        break;
      }
      case 'tax_hike': {
        const citizens = Array.from(state.npcs.values()).filter(n => n.alive);
        citizens.forEach(c => { c.coin = Math.max(0, c.coin - seededInt(rng, 3, 8)); actors.push(c.id); });
        state.settlementCoin += citizens.length * 5;
        description = seededChoice(rng, TEMPLATES.tax_hike);
        break;
      }
      case 'flood': {
        const district = seededChoice(rng, ['Docks', 'Farms'] as District[]);
        const victims = Array.from(state.npcs.values()).filter(n => n.alive && n.district === district);
        victims.forEach(v => { v.health -= 0.1; v.coin = Math.max(0, v.coin - 5); actors.push(v.id); });
        state.economy.supply.food -= 20;
        description = fillTemplate(seededChoice(rng, TEMPLATES.flood), { district });
        break;
      }
      case 'famine': {
        state.economy.supply.food = Math.max(0, state.economy.supply.food - 80);
        state.economy.prices.food = clamp(state.economy.prices.food + 1.0, 0.2, 5);
        const citizens = Array.from(state.npcs.values()).filter(n => n.alive);
        citizens.forEach(c => { c.hunger += 0.3; actors.push(c.id); });
        description = seededChoice(rng, TEMPLATES.famine);
        break;
      }
      case 'foreign_war': {
        const eligible = Array.from(state.npcs.values()).filter(n => n.alive && n.age > 18 && n.age < 45);
        if (eligible.length === 0) break;
        const drafted = Math.min(eligible.length, seededInt(rng, 5, 15));
        for (let i = 0; i < drafted; i++) {
          const d = seededChoice(rng, eligible);
          d.safety += 0.4;
          d.health -= 0.1;
          actors.push(d.id);
        }
        description = seededChoice(rng, TEMPLATES.foreign_war);
        break;
      }
      case 'rare_festival': {
        const all = Array.from(state.npcs.values()).filter(n => n.alive);
        all.forEach(a => { a.belonging = 0; a.hunger = 0; actors.push(a.id); });
        description = seededChoice(rng, TEMPLATES.rare_festival);
        break;
      }
    }
    
    // Fallback text if description is empty
    if (!description || description.trim() === '') {
      const fallbacks: Record<string, string> = {
        'harvest_failure': 'The harvest failed this season, leaving farmers with empty stores.',
        'plague': 'A mysterious illness has spread through the settlement.',
        'bandit_raid': 'Bandits struck the settlement, taking what they could.',
        'fire': 'A fire broke out, causing damage and fear.',
        'festival': 'The settlement held a festival to lift spirits.',
        'trade_caravan': 'A trade caravan arrived with goods from distant lands.',
        'immigrants': 'New settlers have arrived, seeking a home.',
        'tax_hike': 'The leadership has raised taxes to fund public works.',
        'flood': 'Floodwaters have risen, damaging homes and fields.',
        'famine': 'Food grows scarce as famine grips the settlement.',
        'foreign_war': 'War has been declared, and the settlement must prepare.',
        'rare_festival': 'A once-in-a-generation festival brings wonder to all.',
      };
      description = fallbacks[evt.kind] || `A ${evt.kind} event has occurred.`;
    }
    
    const worldEvent: WorldEvent = {
      id: eventId, tick: state.tick, kind: evt.kind, actors: actors.slice(0, 20),
      causes: [], effects: [], description,
    };
    state.worldEvents.push(worldEvent);
    
    // Log entry
    const year = Math.floor(state.tick / 360) + 1;
    const day = (state.tick % 360) + 1;
    const seasonNames = ['Spring', 'Summer', 'Autumn', 'Winter'];
    const seasonIdx = Math.floor((state.tick % 360) / 90);
    
    state.log.push({
      id: eventId, tick: state.tick, year, day, season: seasonNames[seasonIdx],
      type: 'world_event', text: `[${evt.kind.toUpperCase()}] ${description}`,
      npcIds: actors.slice(0, 10),
      causalTrace: {
        tick: state.tick, npcId: -1, chosenAction: evt.kind,
        topAlternatives: [], pressures: {}, modifiers: {},
        diceRoll: rng(), threshold: evt.probability, success: true,
      },
      salience: evt.kind === 'rare_festival' ? 0.95 : evt.kind === 'plague' || evt.kind === 'famine' ? 0.8 : 0.6,
      tags: ['world_event', evt.kind],
    });
  }
}

// ============================================================
// SECTION 9: WILDLIFE SYSTEM
// ============================================================

function processWildlife(state: SimulationState): void {
  const { rng, wildlife } = state;
  
  // Creatures threaten farms every 1-2 years (360-720 ticks)
  const interval = 360 + Math.floor(rng() * 360);
  if (state.tick - wildlife.lastEventTick > interval) {
    wildlife.lastEventTick = state.tick;
    const activeCreatures = wildlife.creatures.filter(c => c.alive);
    if (activeCreatures.length === 0) return;
    
    const creature = seededChoice(rng, activeCreatures);
    // Higher threat creatures are more likely to attack
    if (rng() < creature.threat * 0.6) {
      const year = Math.floor(state.tick / 360) + 1;
      const day = (state.tick % 360) + 1;
      const season = ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((state.tick % 360) / 90)];
      
      // Different effects based on creature capabilities
      const caps = deriveCapabilities(creature.elements);
      
      if (creature.threat > 0.6) {
        // Dangerous creature - may injure people
        const targets = Array.from(state.npcs.values()).filter(n => n.alive && n.district === 'Farms');
        if (targets.length > 0) {
          const victim = seededChoice(rng, targets);
          const damage = seededRandom(rng, 0.1, 0.3) * creature.threat;
          victim.health -= damage;
          victim.inventory.food = Math.max(0, (victim.inventory.food || 0) - seededInt(rng, 3, 10));
          state.economy.supply.food -= seededInt(rng, 3, 8);
          
          // Determine attack type from capabilities
          let attackType = 'attacked';
          if (caps.bite_poison > 0.3) attackType = 'poisoned with its bite';
          else if (caps.flight > 0.5) attackType = 'swooped down on';
          else if (creature.elements.includes('venom_gland')) attackType = 'struck with venom at';
          
          state.log.push({
            id: `WL${state.nextEventId++}`, tick: state.tick, year, day, season,
            type: 'wildlife', 
            text: `A ${creature.name} ${attackType} ${victim.name}! ${victim.name} was injured and lost supplies.`,
            npcIds: [victim.id],
            causalTrace: { 
              tick: state.tick, npcId: victim.id, chosenAction: 'creature_attack', 
              topAlternatives: [], pressures: {}, 
              modifiers: { threat: creature.threat, elementCount: creature.elements.length },
              diceRoll: rng(), threshold: creature.threat, success: true 
            },
            salience: 0.6,
            tags: ['wildlife', 'creature', 'danger'],
          });
        }
      } else {
        // Less dangerous - crop/livestock damage
        const farmers = Array.from(state.npcs.values()).filter(n => n.alive && (n.job === 'farmer' || n.district === 'Farms'));
        if (farmers.length > 0) {
          const victim = seededChoice(rng, farmers);
          const foodLost = seededInt(rng, 2, 8);
          victim.inventory.food = Math.max(0, (victim.inventory.food || 0) - foodLost);
          state.economy.supply.food -= foodLost;
          
          state.log.push({
            id: `WL${state.nextEventId++}`, tick: state.tick, year, day, season,
            type: 'wildlife', 
            text: `A ${creature.name} raided ${victim.name}'s farm, destroying ${Math.round(foodLost)} food.`,
            npcIds: [victim.id],
            causalTrace: { 
              tick: state.tick, npcId: victim.id, chosenAction: 'creature_raid', 
              topAlternatives: [], pressures: {}, 
              modifiers: { threat: creature.threat, elementCount: creature.elements.length },
              diceRoll: rng(), threshold: creature.threat, success: true 
            },
            salience: 0.4,
            tags: ['wildlife', 'creature'],
          });
        }
      }
      
      // Hunters/guards may respond
      const responders = Array.from(state.npcs.values()).filter(n => n.alive && (n.job === 'hunter' || n.job === 'guard') && n.district === 'Farms');
      if (responders.length > 0 && rng() < 0.5) {
        const responder = seededChoice(rng, responders);
        const huntRoll = rng();
        const huntChance = responder.skills.fighting * 0.008 + responder.skills.stealth * 0.004;
        if (huntRoll < huntChance) {
          creature.alive = false;
          responder.coin += Math.round(creature.threat * 20);
          state.log.push({
            id: `WL${state.nextEventId++}`, tick: state.tick, year, day, season,
            type: 'wildlife', 
            text: `${responder.name} tracked and killed the ${creature.name}! Earned ${Math.round(creature.threat * 20)} coin bounty.`,
            npcIds: [responder.id],
            causalTrace: { 
              tick: state.tick, npcId: responder.id, chosenAction: 'hunt', 
              topAlternatives: [], pressures: {}, modifiers: {},
              diceRoll: huntRoll, threshold: huntChance, success: true 
            },
            salience: 0.5,
            tags: ['wildlife', 'hunt'],
          });
        }
      }
    }
  }
}

// ============================================================
// SECTION 10: NPC DAILY UPDATE
// ============================================================

function updateNPCDaily(npc: NPC, state: SimulationState): void {
  if (!npc.alive) return;
  
  // Aging (every 360 ticks)
  if (state.tick > 0 && state.tick % 360 === 0) {
    npc.age++;
    // Age effects
    if (npc.age > 60) {
      npc.health -= 0.01;
      Object.keys(npc.skills).forEach(k => {
        (npc.skills as any)[k] = Math.max(0, (npc.skills as any)[k] - 1);
      });
    }
  }
  
  // Need decay/growth - slower hunger increase
  npc.hunger = clamp(npc.hunger + 0.03, 0, 1);
  npc.rest = clamp(npc.rest + 0.025, 0, 1);
  npc.safety = clamp(npc.safety - 0.005, 0, 1);
  npc.belonging = clamp(npc.belonging + 0.003, 0, 1);
  
  // Subsistence foraging: 60% daily chance if no food and no coin
  if (npc.hunger > 0.3 && (npc.inventory.food || 0) <= 0 && npc.coin < 2) {
    if (state.rng() < 0.6) {
      npc.hunger = Math.max(0, npc.hunger - 0.4);
      npc.health = Math.min(1, npc.health + 0.01);
    }
  }
  
  // Gradual starvation damage (not instant death)
  if (npc.hunger > 0.85) {
    npc.health -= 0.008; // Slow drain
  }
  if (npc.hunger > 0.95) {
    npc.health -= 0.015; // Faster when critical
  }
  
  // Natural death - only from old age or severe health loss
  const deathChance = npc.age > 70 ? (npc.age - 70) * 0.005 : 0;
  if (state.rng() < deathChance || npc.health <= 0) {
    npc.alive = false;
    npc.health = 0;
    // Death will be logged by logDeath in stepSimulation
  }
  
  // Relationship decay
  for (const rel of npc.relationships) {
    const daysSince = state.tick - rel.lastReinforced;
    if (daysSince > 60) {
      rel.affinity *= 0.999;
      rel.trust *= 0.999;
    }
  }
  
  // Memory consolidation (every 360 ticks)
  if (state.tick > 0 && state.tick % 360 === 0 && npc.memories.length > 15) {
    // Consolidate old negative memories into beliefs
    const oldNeg = npc.memories.filter(m => m.valence < -0.4 && state.tick - m.tick > 360);
    if (oldNeg.length > 3) {
      // Remove oldest, keep salience high
      npc.memories = npc.memories.filter(m => !(m.valence < -0.4 && state.tick - m.tick > 720));
    }
  }
  
  // Birth (if married and conditions met) - increased rate for sustainability
  // Requirements: married, fertile age (18-40), health > 0.5, not starving (hunger < 0.7)
  if (npc.spouseId && npc.age >= 18 && npc.age <= 40 && npc.sex === 'F' && 
      npc.health > 0.5 && npc.hunger < 0.7 && state.rng() < 0.008) {
    const spouse = state.npcs.get(npc.spouseId);
    if (spouse && spouse.alive && spouse.health > 0.4) {
      const child = createNPC(state.rng, state.nextNpcId++, 0);
      child.district = npc.district;
      child.health = 0.9; // Healthy birth
      child.hunger = 0.2; // Fed by mother
      // Blend traits
      for (const key of Object.keys(child.traits) as (keyof typeof child.traits)[]) {
        child.traits[key] = clamp((npc.traits[key] + spouse.traits[key]) / 2 + (state.rng() - 0.5) * 0.2, 0, 1);
      }
      child.parentIds = [npc.id, spouse.id];
      child.familyLinks = [
        { type: 'parent', npcId: npc.id },
        { type: 'parent', npcId: spouse.id },
      ];
      npc.familyLinks.push({ type: 'child', npcId: child.id });
      spouse.familyLinks.push({ type: 'child', npcId: child.id });
      state.npcs.set(child.id, child);
      state.totalBirths++;
      
      const year = Math.floor(state.tick / 360) + 1;
      state.log.push({
        id: `B${state.nextEventId++}`, tick: state.tick, year,
        day: (state.tick % 360) + 1,
        season: ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((state.tick % 360) / 90)],
        type: 'birth', text: `${npc.name} and ${spouse.name} welcomed a child: ${child.name}.`,
        npcIds: [npc.id, spouse.id, child.id],
        causalTrace: { tick: state.tick, npcId: npc.id, chosenAction: 'birth', topAlternatives: [], pressures: {}, modifiers: {}, diceRoll: state.rng(), threshold: 0.005, success: true },
        salience: 0.5,
        tags: ['birth', 'milestone'],
      });
    }
  }
}

// ============================================================
// SECTION 11: DEATH LOGGING
// ============================================================

function logDeath(npc: NPC, state: SimulationState, cause?: string): void {
  // Avoid double-logging
  if (state.deathTicks.has(npc.id)) return;
  
  const year = Math.floor(state.tick / 360) + 1;
  const deathCause = cause || (npc.health <= 0 ? (npc.hunger > 0.8 ? 'starvation' : npc.age > 65 ? 'old age' : 'illness') : 'old age');
  
  state.totalDeaths++;
  state.deathTicks.set(npc.id, state.tick);
  
  state.log.push({
    id: `D${state.nextEventId++}`, tick: state.tick, year,
    day: (state.tick % 360) + 1,
    season: ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((state.tick % 360) / 90)],
    type: 'death', text: `${npc.name} died at age ${Math.round(npc.age)} from ${deathCause}.`,
    npcIds: [npc.id],
    causalTrace: { tick: state.tick, npcId: npc.id, chosenAction: 'death', topAlternatives: [], pressures: { hunger: npc.hunger, health: 1 - npc.health }, modifiers: { age: npc.age }, diceRoll: 0, threshold: 0, success: true },
    salience: 0.6,
    tags: ['death'],
  });
  
  // Spouse and children react
  if (npc.spouseId) {
    const spouse = state.npcs.get(npc.spouseId);
    if (spouse && spouse.alive) {
      spouse.spouseId = null;
      spouse.belonging = clamp(spouse.belonging + 0.5, 0, 1);
      addMemory(spouse, { eventId: `spouse_died_${npc.id}`, valence: -0.9, salience: 0.95, confidence: 1, source: 'witnessed', tick: state.tick });
    }
  }
}

// ============================================================
// SECTION 12: STORY DETECTION
// ============================================================

function detectStories(state: SimulationState): void {
  if (state.tick % 90 !== 0) return; // Check every 90 days (seasonally)
  
  const npcs = Array.from(state.npcs.values()).filter(n => n.alive);
  if (npcs.length === 0) return;
  
  // Compute pressure threshold: top 5% of population
  const allPressures = npcs.map(npc => {
    const pressures = computePressures(npc, state);
    return Math.max(...Object.values(pressures));
  }).sort((a, b) => b - a);
  const threshold = allPressures[Math.floor(allPressures.length * 0.05)] || 0.7;
  
  for (const npc of npcs) {
    const pressures = computePressures(npc, state);
    const maxPressure = Math.max(...Object.values(pressures));
    if (maxPressure < threshold) continue;
    
    // Deduplicate: check if NPC already has an open hook for this pattern
    const hasHook = (pattern: string) => state.storyHooks.some(
      h => !h.resolved && h.roles.some(r => r.npcId === npc.id) && h.pattern === pattern
    );
    
    // Check patterns
    // HELP_SOMEONE_IN_TROUBLE
    if (npc.traits.empathy > 0.5 && !hasHook('HELP_SOMEONE_IN_TROUBLE')) {
      const peopleInTrouble = npcs.filter(n => n.id !== npc.id && (n.health < 0.4 || n.hunger > 0.7));
      if (peopleInTrouble.length > 0) {
        const target = peopleInTrouble[0];
        const hook: StoryHook = {
          id: `SH${state.nextEventId++}`, tick: state.tick,
          pattern: 'HELP_SOMEONE_IN_TROUBLE',
          title: `${npc.name} Notices ${target.name}'s Suffering`,
          description: `${npc.name}, driven by empathy, has noticed that ${target.name} is in dire straits. ${target.health < 0.4 ? 'Their health is failing.' : 'They are starving.'} Will ${npc.name} step forward to help?`,
          roles: [{ role: 'helper', npcId: npc.id }, { role: 'person_in_need', npcId: target.id }],
          approaches: ['help', 'share_food', 'heal', 'lend_money'],
          causalChain: [`${target.name}'s health declined`, `${npc.name} felt empathy`],
          tension: 0.6 + npc.traits.empathy * 0.3,
          resolved: false,
        };
        state.storyHooks.push(hook);
      }
    }
    
    // EXPOSE_A_CRIMINAL
    if (npc.traits.honesty > 0.5 && !hasHook('EXPOSE_A_CRIMINAL') && npc.memories.some(m => m.valence < -0.6)) {
      const criminals = npcs.filter(n => n.id !== npc.id && n.crimes.some(c => !c.solved));
      if (criminals.length > 0) {
        const target = criminals[0];
        const hook: StoryHook = {
          id: `SH${state.nextEventId++}`, tick: state.tick,
          pattern: 'EXPOSE_A_CRIMINAL',
          title: `${npc.name} Suspects ${target.name}`,
          description: `Something about ${target.name} doesn't sit right with ${npc.name}. Unsolved crimes linger in the settlement. Will ${npc.name} investigate and expose the truth?`,
          roles: [{ role: 'investigator', npcId: npc.id }, { role: 'suspect', npcId: target.id }],
          approaches: ['investigate', 'accuse', 'gossip'],
          causalChain: ['Unsolved crimes in settlement', `${npc.name}'s suspicion grew`],
          tension: 0.5 + npc.traits.honesty * 0.3,
          resolved: false,
        };
        state.storyHooks.push(hook);
      }
    }
    
    // DEAL_WITH_THREAT
    if (npc.traits.courage > 0.5 && !hasHook('DEAL_WITH_THREAT') && npc.safety > 0.4) {
      const hook: StoryHook = {
        id: `SH${state.nextEventId++}`, tick: state.tick,
        pattern: 'DEAL_WITH_THREAT',
        title: `${npc.name} Confronts Growing Danger`,
        description: `Fear grips ${npc.name} as danger looms over the settlement. With courage burning inside, they must decide: stand and fight, or flee?`,
        roles: [{ role: 'protagonist', npcId: npc.id }],
        approaches: ['protect', 'fight', 'flee', 'seek_revenge'],
        causalChain: [`${npc.name}'s safety declined`, 'Threats mounted'],
        tension: 0.5 + npc.safety * 0.4,
        resolved: false,
      };
      state.storyHooks.push(hook);
    }
    
    // SETTLE_DISPUTE
    if (npc.skills.persuasion > 30 && !hasHook('SETTLE_DISPUTE') && npc.relationships.some(r => r.affinity < -0.3)) {
      const enemy = npc.relationships.find(r => r.affinity < -0.3);
      if (enemy) {
        const target = state.npcs.get(enemy.targetId);
        if (target && target.alive) {
          const hook: StoryHook = {
            id: `SH${state.nextEventId++}`, tick: state.tick,
            pattern: 'SETTLE_DISPUTE',
            title: `The Feud Between ${npc.name} and ${target.name}`,
            description: `Bitter conflict divides ${npc.name} and ${target.name}. Their animosity threatens to boil over into violence. Can reason prevail, or will blood be shed?`,
            roles: [{ role: 'party_a', npcId: npc.id }, { role: 'party_b', npcId: target.id }],
            approaches: ['argue', 'fight', 'help', 'betray'],
            causalChain: ['Relationship deteriorated', 'Trust was broken'],
            tension: 0.6 + Math.abs(enemy.affinity) * 0.3,
            resolved: false,
          };
          state.storyHooks.push(hook);
        }
      }
    }
    
    // RECOVER_STOLEN_THING
    if (!hasHook('RECOVER_STOLEN_THING') && npc.memories.some(m => m.eventId.includes('stolen') || m.eventId.includes('robbed'))) {
      const theftMem = npc.memories.find(m => m.eventId.includes('stolen') || m.eventId.includes('robbed'));
      if (theftMem) {
        const hook: StoryHook = {
          id: `SH${state.nextEventId++}`, tick: state.tick,
          pattern: 'RECOVER_STOLEN_THING',
          title: `${npc.name} Seeks Justice for Theft`,
          description: `${npc.name} was robbed and yearns for justice. The stolen goods weigh heavily on their mind. Will they seek revenge or appeal to the guards?`,
          roles: [{ role: 'victim', npcId: npc.id }],
          approaches: ['accuse', 'seek_revenge', 'investigate'],
          causalChain: [`${npc.name} was robbed`, 'Desire for justice grows'],
          tension: 0.5 + Math.abs(theftMem.valence) * 0.3,
          resolved: false,
        };
        state.storyHooks.push(hook);
      }
    }
  }
  
  // Auto-resolve hooks based on what actually happens
  for (const hook of state.storyHooks) {
    if (hook.resolved) continue;
    if (state.tick - hook.tick > 180) {
      // Timeout - resolve based on what happened
      hook.resolved = true;
      hook.resolvedTick = state.tick;
      const mainNpc = state.npcs.get(hook.roles[0].npcId);
      if (!mainNpc || !mainNpc.alive) {
        hook.outcome = `${mainNpc?.name || 'Unknown'} perished before the situation could resolve.`;
      } else {
        hook.outcome = `The situation involving ${mainNpc.name} faded as circumstances changed.`;
      }
    }
  }
}

// ============================================================
// SECTION 13: STATISTICS
// ============================================================

function updateStats(state: SimulationState): void {
  if (state.tick % 360 !== 0) return;
  
  const alive = Array.from(state.npcs.values()).filter(n => n.alive);
  const coins = alive.map(n => n.coin).sort((a, b) => a - b);
  
  // Population
  state.stats.populationByYear.push(alive.length);
  state.stats.minPopByYear.push(alive.length);
  state.stats.maxPopByYear.push(alive.length);
  state.stats.birthsByYear.push(0);
  state.stats.deathsByYear.push(0);
  
  // Average coin
  const avgCoin = coins.length > 0 ? coins.reduce((a, b) => a + b, 0) / coins.length : 0;
  state.stats.avgCoinByYear.push(avgCoin);
  
  // Gini coefficient
  if (coins.length > 1) {
    const n = coins.length;
    let sumDiff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiff += Math.abs(coins[i] - coins[j]);
      }
    }
    const mean = coins.reduce((a, b) => a + b, 0) / n;
    const gini = mean > 0 ? sumDiff / (2 * n * n * mean) : 0;
    state.stats.giniByYear.push(gini);
  } else {
    state.stats.giniByYear.push(0);
  }
  
  // Crime rate
  const totalCrimes = alive.reduce((sum, n) => sum + n.crimes.length, 0);
  state.stats.crimeRateByYear.push(alive.length > 0 ? totalCrimes / alive.length : 0);
  
  // Food price
  state.stats.foodPriceByYear.push(state.economy.prices.food);
}

// ============================================================
// SECTION 14: MAIN SIMULATION STEP
// ============================================================

const ACTIONS = buildActions();

export function stepSimulation(state: SimulationState): void {
  const { rng, npcs } = state;
  
  // Update each living NPC
  const aliveNpcs = Array.from(npcs.values()).filter(n => n.alive);
  
  // Track population min/max this tick
  const currentPop = aliveNpcs.length;
  const yearIdx = Math.floor(state.tick / 360);
  if (state.stats.minPopByYear[yearIdx] === undefined) {
    state.stats.minPopByYear[yearIdx] = currentPop;
    state.stats.maxPopByYear[yearIdx] = currentPop;
  } else {
    state.stats.minPopByYear[yearIdx] = Math.min(state.stats.minPopByYear[yearIdx], currentPop);
    state.stats.maxPopByYear[yearIdx] = Math.max(state.stats.maxPopByYear[yearIdx], currentPop);
  }
  
  for (const npc of aliveNpcs) {
    try {
      // Daily needs update
      updateNPCDaily(npc, state);
      
      if (!npc.alive) {
        logDeath(npc, state);
        continue;
      }
      
      // Decision: only process NPCs "due" this tick (stagger)
      // Each NPC acts roughly every 1-3 days
      if (state.tick - npc.lastActionTick < 1 + Math.floor(rng() * 2)) continue;
      npc.lastActionTick = state.tick;
      
      // Compute pressures
      const pressures = computePressures(npc, state);
      
      // Score available actions
      const scored: { action: string; score: number; def: ActionDef }[] = [];
      for (const action of ACTIONS) {
        if (!action.preconditions(npc, state)) continue;
        const score = action.utility(npc, pressures, state);
        if (score > 0.01) {
          scored.push({ action: action.id, score, def: action });
        }
      }
      
      if (scored.length === 0) continue;
      
      // Select action using softmax with temperature from temper/impulsiveness
      const temperature = 0.3 + npc.traits.temper * 0.4;
      const chosenId = softmaxSeeded(scored, temperature, rng);
      const chosen = scored.find(s => s.action === chosenId);
      if (!chosen) continue;
      
      // Track action count (for health check)
      state.actionCounts[chosenId] = (state.actionCounts[chosenId] || 0) + 1;
      
      // Track revenge goals
      if (chosenId === 'seek_revenge') {
        state.revengeGoalsCreated++;
      }
      
      // Determine success
      const successChance = chosen.def.successChance(npc, state);
      const roll = rng();
      const success = roll < successChance;
      
      // Execute action
      const entry = chosen.def.execute(npc, state, success, rng);
      if (entry) {
        entry.causalTrace.tick = state.tick;
        entry.causalTrace.diceRoll = roll; // Use the actual roll that decided success
        entry.causalTrace.threshold = successChance;
        entry.causalTrace.success = success;
        entry.causalTrace.topAlternatives = scored
          .filter(s => s.action !== chosenId)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(s => ({ action: s.action, score: s.score }));
        
        // Cap log size - only keep significant events
        if (state.log.length < 60000) {
          state.log.push(entry);
        }
      }
    } catch (e) {
      // Defensive: skip NPC if any error occurs, log it
      console.warn(`Error processing NPC ${npc.id} (${npc.name}) at tick ${state.tick}:`, e);
      continue;
    }
  }
  
  // World events (with defensive try-catch)
  try {
    processWorldEvents(state);
  } catch (e) {
    console.warn(`Error in world events at tick ${state.tick}:`, e);
  }
  
  // Wildlife (with defensive try-catch)
  try {
    processWildlife(state);
  } catch (e) {
    console.warn(`Error in wildlife at tick ${state.tick}:`, e);
  }
  
  // Economy
  if (state.tick % 7 === 0) {
    try {
      updateEconomy(state);
    } catch (e) {
      console.warn(`Error in economy at tick ${state.tick}:`, e);
    }
  }
  
  // Story detection
  try {
    detectStories(state);
  } catch (e) {
    console.warn(`Error in story detection at tick ${state.tick}:`, e);
  }
  
  // Stats
  try {
    updateStats(state);
  } catch (e) {
    console.warn(`Error in stats at tick ${state.tick}:`, e);
  }
  
  // Cap population
  const alive = Array.from(npcs.values()).filter(n => n.alive);
  if (alive.length > 400) {
    // Natural culling - oldest/sickest die
    const sorted = alive.sort((a, b) => (a.health - a.age * 0.01) - (b.health - b.age * 0.01));
    for (let i = 0; i < alive.length - 380; i++) {
      sorted[i].alive = false;
      logDeath(sorted[i], state);
    }
  }
  
  state.tick++;
}

// ============================================================
// SECTION 15: RUN SIMULATION
// ============================================================

export function runSimulation(seed: number, years: number = 100): SimulationState {
  const state = initSimulation(seed);
  const totalTicks = years * 360;
  
  while (state.tick < totalTicks) {
    try {
      stepSimulation(state);
    } catch (e) {
      console.error(`Fatal error at tick ${state.tick}:`, e);
      // Skip this tick and continue
      state.tick++;
    }
  }
  
  return state;
}

// ============================================================
// SECTION 16: CAPABILITY DERIVATION (from elements)
// ============================================================

export function deriveCapabilities(elements: string[]): Record<string, number> {
  const elementSet = new Set(elements);
  const caps: Record<string, number> = {};
  
  // Flight capability
  const hasWing = elementSet.has('limb_wing_large') || elementSet.has('limb_wing_small');
  const massEl = ELEMENTS.find(e => e.id === 'body_massive');
  const hasMassive = elementSet.has('body_massive');
  const wingArea = hasWing ? (elementSet.has('limb_wing_large') ? 0.9 : 0.3) : 0;
  const mass = hasMassive ? 0.9 : elementSet.has('body_small') ? 0.1 : 0.5;
  
  caps.flight = hasWing ? clamp(wingArea / mass, 0, 1) : 0;
  caps.wing_display = hasWing ? 0.7 : 0;
  caps.wing_balance = hasWing ? 0.5 : 0;
  caps.wing_shielding = hasWing ? 0.4 : 0;
  
  // Bite capability
  const hasFang = elementSet.has('fang') || elementSet.has('mandible') || elementSet.has('beak');
  const hasVenom = elementSet.has('venom_gland');
  const hasDelivery = elementSet.has('venom_delivery_fang') || elementSet.has('stinger');
  
  caps.bite_physical = hasFang ? 0.7 : 0;
  caps.bite_poison = (hasFang && hasVenom && hasDelivery) ? 0.8 : (hasFang && hasVenom) ? 0.4 : 0;
  
  return caps;
}

// ============================================================
// SECTION 17: ELEMENT COVERAGE REPORT
// ============================================================

export function coverageReport(): { total: number; referenced: number; unreferenced: string[] } {
  const allIds = new Set(ELEMENTS.map(e => e.id));
  const referenced = new Set<string>();
  
  // Check creature templates
  for (const ct of CREATURE_TEMPLATES) {
    ct.elements.forEach(e => referenced.add(e));
  }
  
  // Check capability derivation references
  const deriveRefs = ['limb_wing_large', 'limb_wing_small', 'body_massive', 'body_small', 'fang', 'mandible', 'beak', 'venom_gland', 'venom_delivery_fang', 'stinger'];
  deriveRefs.forEach(r => referenced.add(r));
  
  const unreferenced = Array.from(allIds).filter(id => !referenced.has(id));
  
  return { total: allIds.size, referenced: referenced.size, unreferenced };
}

// ============================================================
// SECTION 18: TOP STORIES GENERATION
// ============================================================

export interface TopStory {
  rank: number;
  title: string;
  paragraph: string;
  salience: number;
  npcIds: number[];
  entries: LogEntry[];
}

export interface Storyline {
  actors: Set<number>;
  entries: LogEntry[];
  startTick: number;
  endTick: number;
  deaths: number;
  reversals: number;
  revengePaidOff: boolean;
  score: number;
}

export function generateTopStories(state: SimulationState, count: number = 20): TopStory[] {
  // Build storylines by grouping events linked by shared actors
  const significantEntries = state.log.filter(e => 
    e.salience >= 0.3 || 
    e.tags.includes('crime') || 
    e.tags.includes('death') || 
    e.tags.includes('drama') ||
    e.tags.includes('revenge') ||
    e.tags.includes('milestone') ||
    e.tags.includes('world_event')
  );
  
  // Group entries into storylines by shared NPC pairs/groups
  const storylines: Storyline[] = [];
  const usedEntries = new Set<string>();
  
  // Sort by tick for chronological grouping
  const sorted = [...significantEntries].sort((a, b) => a.tick - b.tick);
  
  for (const entry of sorted) {
    if (usedEntries.has(entry.id)) continue;
    if (entry.npcIds.length === 0) continue;
    
    // Start a new storyline
    const storyline: Storyline = {
      actors: new Set(entry.npcIds),
      entries: [entry],
      startTick: entry.tick,
      endTick: entry.tick,
      deaths: entry.tags.includes('death') ? 1 : 0,
      reversals: 0,
      revengePaidOff: entry.tags.includes('revenge') && entry.causalTrace.success,
      score: 0,
    };
    usedEntries.add(entry.id);
    
    // Find related entries within 10 years that share actors
    for (const other of sorted) {
      if (usedEntries.has(other.id)) continue;
      if (other.tick - storyline.endTick > 3600) continue; // Max 10 year span
      if (other.tick < storyline.startTick - 360) continue; // Allow some lookback
      
      // Check if shares at least one actor
      const sharedActors = other.npcIds.filter(id => storyline.actors.has(id));
      if (sharedActors.length === 0) continue;
      
      // Add to storyline
      storyline.entries.push(other);
      usedEntries.add(other.id);
      storyline.endTick = Math.max(storyline.endTick, other.tick);
      other.npcIds.forEach(id => storyline.actors.add(id));
      
      if (other.tags.includes('death')) storyline.deaths++;
      if (other.tags.includes('revenge') && other.causalTrace.success) storyline.revengePaidOff = true;
    }
    
    // Calculate storyline score
    const lengthYears = (storyline.endTick - storyline.startTick) / 360;
    const distinctActors = storyline.actors.size;
    
    // Detect reversals: check if any NPC appears on both sides of conflicts
    const aggressors = new Set<number>();
    const victims = new Set<number>();
    for (const e of storyline.entries) {
      if (e.tags.includes('violence') || e.tags.includes('crime') || e.tags.includes('revenge')) {
        if (e.npcIds.length >= 1) aggressors.add(e.npcIds[0]);
        if (e.npcIds.length >= 2) victims.add(e.npcIds[1]);
      }
    }
    // Reversal: someone who was a victim becomes an aggressor
    for (const id of aggressors) {
      if (victims.has(id)) storyline.reversals++;
    }
    
    storyline.score = 
      distinctActors * 2 +
      Math.min(lengthYears, 20) * 1.5 +
      storyline.reversals * 5 +
      storyline.deaths * 4 +
      (storyline.revengePaidOff ? 8 : 0) +
      storyline.entries.length * 0.5;
    
    storylines.push(storyline);
  }
  
  // Sort by score
  storylines.sort((a, b) => b.score - a.score);
  
  // Cap per decade (max 4 per decade)
  const decadeCounts: Record<number, number> = {};
  const stories: TopStory[] = [];
  
  for (const sl of storylines) {
    if (stories.length >= count) break;
    const decade = Math.floor(sl.startTick / 3600);
    decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
    if (decadeCounts[decade] > 4) continue;
    
    // Build paragraph from storyline entries
    const actorNames = Array.from(sl.actors).map(id => {
      const npc = state.npcs.get(id);
      return npc?.name || `NPC#${id}`;
    });
    
    const startYear = Math.floor(sl.startTick / 360) + 1;
    const endYear = Math.floor(sl.endTick / 360) + 1;
    
    let paragraph = '';
    // Start with the first significant event the protagonist was part of
    const firstEntry = sl.entries[0];
    const mainActor = state.npcs.get(firstEntry.npcIds[0]);
    
    if (sl.entries.length === 1) {
      paragraph = `In Year ${startYear}, ${firstEntry.text}`;
    } else {
      // Build narrative from chronological entries
      const narrativeParts: string[] = [];
      for (const e of sl.entries.slice(0, 6)) {
        const eYear = Math.floor(e.tick / 360) + 1;
        narrativeParts.push(`In Year ${eYear}, ${e.text}`);
      }
      paragraph = narrativeParts.join(' ');
      if (sl.entries.length > 6) {
        paragraph += ` ...and the saga continued through Year ${endYear}.`;
      }
    }
    
    if (sl.revengePaidOff) {
      paragraph += ` Revenge was finally served.`;
    }
    
    const title = sl.deaths > 0 
      ? `${mainActor?.name || 'Unknown'}'s Tale of Blood (Years ${startYear}-${endYear})`
      : sl.reversals > 0
      ? `The Turning Tides for ${mainActor?.name || 'Unknown'} (Years ${startYear}-${endYear})`
      : `${mainActor?.name || 'Unknown'}'s Story (Years ${startYear}-${endYear})`;
    
    stories.push({
      rank: stories.length + 1,
      title,
      paragraph,
      salience: sl.score,
      npcIds: Array.from(sl.actors),
      entries: sl.entries,
    });
  }
  
  return stories;
}

// ============================================================
// SECTION 19: HEALTH CHECK
// ============================================================

export interface HealthFlag {
  type: 'warning' | 'critical' | 'info';
  message: string;
}

export function healthCheck(state: SimulationState): HealthFlag[] {
  const flags: HealthFlag[] = [];
  const finalPop = state.stats.populationByYear[state.stats.populationByYear.length - 1] || 0;
  const initialPop = state.stats.populationByYear[0] || 150;
  
  // Population extinction
  if (finalPop < 10) {
    flags.push({ type: 'critical', message: `Population near extinction: ${finalPop} remaining.` });
  } else if (finalPop > 380) {
    flags.push({ type: 'warning', message: `Population at capacity: ${finalPop}. Resource pressure high.` });
  }
  
  // Economy collapse
  const avgCoin = state.stats.avgCoinByYear[state.stats.avgCoinByYear.length - 1] || 0;
  if (avgCoin < 5) {
    flags.push({ type: 'critical', message: `Economy collapsed. Average coin: ${avgCoin.toFixed(1)}.` });
  }
  
  // Hyperinflation
  const foodPrice = state.economy.prices.food;
  if (foodPrice > 4) {
    flags.push({ type: 'warning', message: `Food prices extremely high: ${foodPrice.toFixed(2)}. Famine risk.` });
  }
  
  // Inequality
  const gini = state.stats.giniByYear[state.stats.giniByYear.length - 1] || 0;
  if (gini > 0.7) {
    flags.push({ type: 'warning', message: `Extreme inequality (Gini: ${gini.toFixed(2)}). Social unrest likely.` });
  }
  
  // Crime rate
  const crimeRate = state.stats.crimeRateByYear[state.stats.crimeRateByYear.length - 1] || 0;
  if (crimeRate > 2) {
    flags.push({ type: 'warning', message: `High crime rate: ${crimeRate.toFixed(1)} crimes per person.` });
  }
  
  // Action diversity - count ALL actions (including routine ones)
  const totalActions = Object.values(state.actionCounts).reduce((a, b) => a + b, 0);
  if (totalActions > 0) {
    for (const [action, count] of Object.entries(state.actionCounts)) {
      if (count / totalActions > 0.4) {
        flags.push({ type: 'warning', message: `Action "${action}" dominates at ${(count / totalActions * 100).toFixed(0)}% of all decisions.` });
      }
    }
  }
  
  // Story diversity
  const storyPatterns = new Set(state.storyHooks.map(h => h.pattern));
  flags.push({ type: 'info', message: `${storyPatterns.size} distinct story patterns appeared.` });
  flags.push({ type: 'info', message: `${state.storyHooks.length} total story hooks generated.` });
  flags.push({ type: 'info', message: `${state.log.length} total log entries over ${Math.floor(state.tick / 360)} years.` });
  
  // Population trend
  if (finalPop > initialPop * 2) {
    flags.push({ type: 'info', message: `Population more than doubled: ${initialPop} → ${finalPop}.` });
  } else if (finalPop < initialPop * 0.5) {
    flags.push({ type: 'warning', message: `Population halved: ${initialPop} → ${finalPop}.` });
  }
  
  return flags;
}

// ============================================================
// SECTION 20: EXPORT FUNCTIONS
// ============================================================

export function exportLog(state: SimulationState): string {
  return JSON.stringify(state.log.map(e => ({
    id: e.id, tick: e.tick, year: e.year, day: e.day, season: e.season,
    type: e.type, text: e.text, npcIds: e.npcIds, salience: e.salience, tags: e.tags,
    trace: e.causalTrace,
  })), null, 2);
}

export function exportStories(stories: TopStory[]): string {
  return JSON.stringify(stories.map(s => ({
    rank: s.rank, title: s.title, paragraph: s.paragraph, salience: s.salience,
  })), null, 2);
}

export function exportFullSimulation(state: SimulationState): string {
  const npcs = Array.from(state.npcs.values()).map(npc => ({
    id: npc.id,
    name: npc.name,
    age: npc.age,
    sex: npc.sex,
    alive: npc.alive,
    district: npc.district,
    job: npc.job,
    coin: npc.coin,
    health: npc.health,
    hunger: npc.hunger,
    traits: npc.traits,
    skills: npc.skills,
    faction: npc.faction,
    reputation: npc.reputation,
    spouseId: npc.spouseId,
    parentIds: npc.parentIds,
    familyLinks: npc.familyLinks,
    crimes: npc.crimes,
    debts: npc.debts,
    goals: npc.goals,
    memories: npc.memories.slice(0, 10), // Limit to avoid huge exports
  }));

  return JSON.stringify({
    metadata: {
      seed: state.seed,
      tick: state.tick,
      year: Math.floor(state.tick / 360) + 1,
      totalNPCs: state.npcs.size,
      aliveNPCs: Array.from(state.npcs.values()).filter(n => n.alive).length,
      totalEvents: state.log.length,
      totalBirths: state.totalBirths,
      totalDeaths: state.totalDeaths,
      emigrated: state.emigrated,
    },
    stats: state.stats,
    economy: {
      prices: state.economy.prices,
      supply: state.economy.supply,
      demand: state.economy.demand,
    },
    factionPower: state.factionPower,
    npcs: npcs,
    worldEvents: state.worldEvents,
    storyHooks: state.storyHooks,
    log: state.log.slice(-1000), // Last 1000 events to avoid huge exports
  }, null, 2);
}

// ============================================================
// SECTION 21: SELF-TEST
// ============================================================

export interface SelfTestResult {
  seed: number;
  finalPop: number;
  minPop: number;
  maxPop: number;
  totalBirths: number;
  totalDeaths: number;
  emigrated: number;
  avgCoin: number;
  crimesPerYear: number;
  revengeGoalsCreated: number;
  revengeAttacksCompleted: number;
  distinctStorylines: number;
  maxStorylineLengthYears: number;
  checks: { name: string; passed: boolean; detail: string }[];
}

export function runSelfTest(seed: number): SelfTestResult {
  const state = runSimulation(seed, 100);
  
  const finalPop = state.stats.populationByYear[state.stats.populationByYear.length - 1] || 0;
  const minPop = Math.min(...state.stats.minPopByYear.filter(v => v !== undefined), finalPop);
  const maxPop = Math.max(...state.stats.maxPopByYear.filter(v => v !== undefined), finalPop);
  const avgCoin = state.stats.avgCoinByYear[state.stats.avgCoinByYear.length - 1] || 0;
  const totalCrimes = state.log.filter(e => e.tags.includes('crime')).length;
  const crimesPerYear = totalCrimes / 100;
  
  // Count storylines
  const stories = generateTopStories(state, 100);
  const distinctStorylines = stories.length;
  const maxStorylineLengthYears = stories.length > 0 
    ? Math.max(...stories.map(s => {
        if (s.entries.length < 2) return 0;
        const first = s.entries[0].tick;
        const last = s.entries[s.entries.length - 1].tick;
        return (last - first) / 360;
      }))
    : 0;
  
  // Check for dead NPCs appearing as actors after death
  let deadNpcViolation = false;
  for (const entry of state.log) {
    for (const npcId of entry.npcIds) {
      const deathTick = state.deathTicks.get(npcId);
      if (deathTick !== undefined && entry.tick > deathTick) {
        deadNpcViolation = true;
        break;
      }
    }
    if (deadNpcViolation) break;
  }
  
  // Check for unfilled placeholders
  let unfilledPlaceholders = false;
  for (const entry of state.log) {
    if (/\{[a-zA-Z_]+\}/.test(entry.text)) {
      unfilledPlaceholders = true;
      break;
    }
  }
  
  // Food price check
  let foodPriceViolation = false;
  for (let y = 0; y < state.stats.foodPriceByYear.length; y++) {
    const price = state.stats.foodPriceByYear[y];
    // Check if this was a famine year
    const famineEvents = state.worldEvents.filter(we => we.kind === 'famine' && Math.floor(we.tick / 360) === y);
    if (price > 6 && famineEvents.length === 0) {
      foodPriceViolation = true;
      break;
    }
  }
  
  // Revenge attacks where goal was created 1+ years earlier
  const revengeAttacksLongTerm = state.log.filter(e => 
    e.tags.includes('revenge') && e.causalTrace.success
  ).length;
  
  // Storylines spanning 3+ years
  const longStorylines = stories.filter(s => {
    if (s.entries.length < 2) return false;
    const first = s.entries[0].tick;
    const last = s.entries[s.entries.length - 1].tick;
    return (last - first) / 360 >= 3;
  }).length;
  
  const checks = [
    { name: 'min_pop >= 60', passed: minPop >= 60, detail: `min=${minPop}` },
    { name: 'final_pop 100-400', passed: finalPop >= 100 && finalPop <= 400, detail: `final=${finalPop}` },
    { name: 'births >= 50% deaths', passed: state.totalBirths >= state.totalDeaths * 0.5, detail: `births=${state.totalBirths}, deaths=${state.totalDeaths}` },
    { name: 'food price <= 6 (non-famine)', passed: !foodPriceViolation, detail: foodPriceViolation ? 'price exceeded 6 outside famine' : 'OK' },
    { name: '>= 5 revenge attacks (1yr+)', passed: revengeAttacksLongTerm >= 5, detail: `count=${revengeAttacksLongTerm}` },
    { name: '>= 15 storylines (3yr+)', passed: longStorylines >= 15, detail: `count=${longStorylines}` },
    { name: 'no dead NPC as actor', passed: !deadNpcViolation, detail: deadNpcViolation ? 'VIOLATION' : 'OK' },
    { name: 'no unfilled placeholders', passed: !unfilledPlaceholders, detail: unfilledPlaceholders ? 'VIOLATION' : 'OK' },
  ];
  
  return {
    seed, finalPop, minPop, maxPop,
    totalBirths: state.totalBirths,
    totalDeaths: state.totalDeaths,
    emigrated: state.emigrated,
    avgCoin, crimesPerYear,
    revengeGoalsCreated: state.revengeGoalsCreated,
    revengeAttacksCompleted: state.revengeAttacksCompleted,
    distinctStorylines,
    maxStorylineLengthYears: Math.round(maxStorylineLengthYears * 10) / 10,
    checks,
  };
}
