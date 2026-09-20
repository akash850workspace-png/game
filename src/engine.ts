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
  };
  factionPower: Record<Faction, number>;
  settlementCoin: number; // communal funds
  laws: { crime: string; severity: number }[];
  nextEventId: number;
}

// ============================================================
// SECTION 3: INITIALIZATION
// ============================================================

function generateName(rng: () => number): string {
  const first = seededChoice(rng, FIRST_SYLLABLES);
  const last = seededChoice(rng, LAST_SYLLABLES);
  return `${first} ${last}`;
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
    stats: { populationByYear: [], avgCoinByYear: [], giniByYear: [], crimeRateByYear: [], foodPriceByYear: [] },
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
      const trace = makeTrace(npc, 'work', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('work', rng), { npc: npc.name, job: npc.job, district: npc.district });
      return createLogEntry(state, 'work', text, [npc.id], trace, 0.1);
    }
  });

  // EAT
  actions.push({
    id: 'eat',
    preconditions: (npc) => npc.alive && npc.hunger > 0.3,
    utility: (npc, p) => p.hunger * 0.8 + p.health * 0.2,
    successChance: () => 0.9,
    execute: (npc, state, success, rng) => {
      if (npc.coin >= 2 || npc.inventory.food > 0) {
        if (npc.inventory.food > 0) npc.inventory.food--;
        else npc.coin -= 2;
        npc.hunger = Math.max(0, npc.hunger - 0.5);
        npc.health = Math.min(1, npc.health + 0.02);
      }
      const trace = makeTrace(npc, 'eat', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('eat', rng), { npc: npc.name });
      return createLogEntry(state, 'eat', text, [npc.id], trace, 0.05);
    }
  });

  // SLEEP
  actions.push({
    id: 'sleep',
    preconditions: (npc) => npc.alive && npc.rest > 0.4,
    utility: (npc, p) => p.rest * 0.9 + p.health * 0.1,
    successChance: () => 0.95,
    execute: (npc, state, success, rng) => {
      npc.rest = Math.max(0, npc.rest - 0.6);
      npc.health = Math.min(1, npc.health + 0.03);
      const trace = makeTrace(npc, 'sleep', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('sleep', rng), { npc: npc.name });
      return createLogEntry(state, 'sleep', text, [npc.id], trace, 0.02);
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

  // GOSSIP
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
      const trace = makeTrace(npc, 'gossip', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('gossip', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'gossip', text, [npc.id, target.id], trace, 0.2);
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
      if (!target) return null;
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
      const target = findTarget(npc, state, rng, t => t.coin > 5);
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
      if (!target) return null;
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
      const target = findTarget(npc, state, rng, t => t.coin > 20);
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
      if (!target) return null;
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
      const target = findTarget(npc, state, rng, t => t.crimes.length > 0 || t.coin > 30);
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
      if (!target || !target.alive) return null;
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

  // MURDER
  actions.push({
    id: 'murder',
    preconditions: (npc) => npc.alive && npc.traits.courage > 0.4 && (1 - npc.traits.honesty) > 0.4,
    utility: (npc, p) => p.vengeance * 0.5 + npc.traits.cunning * 0.2 + npc.traits.temper * 0.3,
    successChance: (npc) => clamp(0.2 + npc.skills.fighting * 0.003 + npc.skills.stealth * 0.003, 0.05, 0.7),
    execute: (npc, state, success, rng) => {
      // Target someone they have grievance with
      const grievance = npc.memories.filter(m => m.valence < -0.6);
      let target: NPC | null = null;
      if (grievance.length > 0) {
        const mem = seededChoice(rng, grievance);
        // Try to find the npc from the memory event
        const possibleTargets = Array.from(state.npcs.values()).filter(n => n.alive && n.id !== npc.id);
        if (possibleTargets.length > 0) target = seededChoice(rng, possibleTargets);
      } else {
        target = findNearbyNPC(npc, state, rng);
      }
      if (!target) return null;
      if (success) {
        target.alive = false;
        target.health = 0;
        addMemory(npc, { eventId: `murdered_${target.id}`, valence: npc.traits.empathy > 0.5 ? -0.5 : 0.3, salience: 0.95, confidence: 1, source: 'witnessed', tick: state.tick });
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
      return createLogEntry(state, 'murder', text, [npc.id, target.id], trace, 0.9, ['crime', 'death', 'violence']);
    }
  });

  // POISON
  actions.push({
    id: 'poison',
    preconditions: (npc) => npc.alive && npc.traits.cunning > 0.5,
    utility: (npc, p) => p.vengeance * 0.4 + npc.traits.cunning * 0.4 + (1 - npc.traits.honesty) * 0.2,
    successChance: (npc) => clamp(0.15 + npc.skills.stealth * 0.004 + npc.traits.cunning * 0.2, 0.05, 0.6),
    execute: (npc, state, success, rng) => {
      const target = findTarget(npc, state, rng);
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

  // PRAY
  actions.push({
    id: 'pray',
    preconditions: (npc) => npc.alive && npc.traits.piety > 0.3,
    utility: (npc, p) => npc.traits.piety * 0.6 + p.fear * 0.2 + p.health * 0.2,
    successChance: () => 0.9,
    execute: (npc, state, success, rng) => {
      npc.safety = Math.max(0, npc.safety - 0.1);
      npc.belonging = Math.max(0, npc.belonging - 0.05);
      const trace = makeTrace(npc, 'pray', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('pray', rng), { npc: npc.name });
      return createLogEntry(state, 'pray', text, [npc.id], trace, 0.1);
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
      const criminals = Array.from(state.npcs.values()).filter(n => n.alive && n.crimes.some(c => c.solved));
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
    preconditions: (npc) => npc.alive && npc.traits.temper > 0.4,
    utility: (npc, p) => p.vengeance * 0.6 + npc.traits.temper * 0.3 + npc.traits.courage * 0.1,
    successChance: (npc) => clamp(0.2 + npc.skills.fighting * 0.003 + npc.traits.cunning * 0.2, 0.05, 0.7),
    execute: (npc, state, success, rng) => {
      const grievance = npc.memories.filter(m => m.valence < -0.5);
      if (grievance.length === 0) return null;
      const targets = Array.from(state.npcs.values()).filter(n => n.alive && n.id !== npc.id);
      if (targets.length === 0) return null;
      const target = seededChoice(rng, targets);
      if (success) {
        target.health -= seededRandom(rng, 0.1, 0.3);
        target.coin = Math.max(0, target.coin - seededInt(rng, 3, 10));
        npc.safety = Math.max(0, npc.safety - 0.1);
        addMemory(target, { eventId: `revenged_${npc.id}`, valence: -0.8, salience: 0.85, confidence: 1, source: 'witnessed', tick: state.tick });
      }
      npc.crimes.push({ type: 'assault', tick: state.tick, victimId: target.id, solved: rng() < 0.3 });
      const trace = makeTrace(npc, 'seek_revenge', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('seek_revenge', rng), { npc: npc.name, target: target.name });
      return createLogEntry(state, 'seek_revenge', text, [npc.id, target.id], trace, 0.6, ['violence', 'drama']);
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

  // FLEE
  actions.push({
    id: 'flee',
    preconditions: (npc) => npc.alive && (npc.safety > 0.5 || npc.crimes.length > 2),
    utility: (npc, p) => p.fear * 0.5 + (1 - npc.traits.courage) * 0.3 + npc.traits.cunning * 0.2,
    successChance: (npc) => 0.7 + npc.skills.stealth * 0.002,
    execute: (npc, state, success, rng) => {
      if (success) {
        const newDistrict = seededChoice(rng, DISTRICTS.filter(d => d !== npc.district));
        npc.district = newDistrict;
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

  // EMIGRATE (leave settlement)
  actions.push({
    id: 'migrate',
    preconditions: (npc) => npc.alive,
    utility: (npc, p) => npc.traits.curiosity * 0.3 + p.fear * 0.3 + p.poverty * 0.2 + (1 - npc.traits.loyalty) * 0.2,
    successChance: () => 0.7,
    execute: (npc, state, success, rng) => {
      if (!success) return null;
      const newDistrict = seededChoice(rng, DISTRICTS.filter(d => d !== npc.district));
      npc.district = newDistrict;
      const trace = makeTrace(npc, 'migrate', [], computePressures(npc, state), rng, success);
      const text = fillTemplate(getTemplate('migrate', rng), { npc: npc.name, district: newDistrict });
      return createLogEntry(state, 'migrate', text, [npc.id], trace, 0.2);
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
  
  for (const resource of Object.keys(economy.prices)) {
    // Supply/demand adjustment
    const ratio = economy.demand[resource] / Math.max(1, economy.supply[resource]);
    const priceChange = (ratio - 1) * 0.05;
    economy.prices[resource] = clamp(economy.prices[resource] + priceChange, 0.2, 5.0);
    
    // Seasonal effects
    if (resource === 'food' || resource === 'grain') {
      if (season === 2 || season === 3) { // Autumn/Winter - less supply
        economy.supply[resource] = Math.max(10, economy.supply[resource] - 1);
      } else { // Spring/Summer - more supply
        economy.supply[resource] += 2;
      }
    }
    
    // Decay demand slightly
    economy.demand[resource] = Math.max(10, economy.demand[resource] - 0.5);
    
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
  
  // Creatures threaten farms periodically
  if (state.tick - wildlife.lastEventTick > 90) {
    wildlife.lastEventTick = state.tick;
    const activeCreatures = wildlife.creatures.filter(c => c.alive);
    if (activeCreatures.length === 0) return;
    
    const creature = seededChoice(rng, activeCreatures);
    if (creature.threat > 0.3 && rng() < creature.threat * 0.3) {
      // Threaten farms
      const farmers = Array.from(state.npcs.values()).filter(n => n.alive && (n.job === 'farmer' || n.district === 'Farms'));
      if (farmers.length > 0) {
        const victim = seededChoice(rng, farmers);
        victim.inventory.food = Math.max(0, (victim.inventory.food || 0) - seededInt(rng, 2, 8));
        state.economy.supply.food -= seededInt(rng, 2, 5);
        
        state.log.push({
          id: `WL${state.nextEventId++}`, tick: state.tick,
          year: Math.floor(state.tick / 360) + 1, day: (state.tick % 360) + 1,
          season: ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((state.tick % 360) / 90)],
          type: 'wildlife', text: `A ${creature.name} threatened the farms! ${victim.name} lost supplies.`,
          npcIds: [victim.id],
          causalTrace: { tick: state.tick, npcId: -1, chosenAction: 'creature_attack', topAlternatives: [], pressures: {}, modifiers: {}, diceRoll: rng(), threshold: creature.threat, success: true },
          salience: creature.threat > 0.6 ? 0.5 : 0.3,
          tags: ['wildlife', 'creature'],
        });
        
        // Hunters may respond
        const hunters = Array.from(state.npcs.values()).filter(n => n.alive && n.job === 'hunter');
        if (hunters.length > 0 && rng() < 0.4) {
          const hunter = seededChoice(rng, hunters);
          const huntSuccess = rng() < (hunter.skills.fighting * 0.01 + hunter.skills.stealth * 0.005);
          if (huntSuccess && creature.threat > 0.5) {
            creature.alive = false;
            hunter.coin += 10;
            state.log.push({
              id: `WL${state.nextEventId++}`, tick: state.tick,
              year: Math.floor(state.tick / 360) + 1, day: (state.tick % 360) + 1,
              season: ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((state.tick % 360) / 90)],
              type: 'wildlife', text: `${hunter.name} successfully hunted the ${creature.name}!`,
              npcIds: [hunter.id],
              causalTrace: { tick: state.tick, npcId: hunter.id, chosenAction: 'hunt', topAlternatives: [], pressures: {}, modifiers: {}, diceRoll: rng(), threshold: 0.5, success: true },
              salience: 0.4,
              tags: ['wildlife', 'hunt'],
            });
          }
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
      npc.health -= 0.02;
      Object.keys(npc.skills).forEach(k => {
        (npc.skills as any)[k] = Math.max(0, (npc.skills as any)[k] - 1);
      });
    }
  }
  
  // Need decay/growth
  npc.hunger = clamp(npc.hunger + 0.04, 0, 1);
  npc.rest = clamp(npc.rest + 0.03, 0, 1);
  npc.safety = clamp(npc.safety - 0.01, 0, 1);
  npc.belonging = clamp(npc.belonging + 0.005, 0, 1);
  
  // Starvation damage
  if (npc.hunger > 0.9) {
    npc.health -= 0.03;
  }
  
  // Natural death
  const deathChance = npc.age > 70 ? (npc.age - 70) * 0.01 : 0;
  if (state.rng() < deathChance || npc.health <= 0) {
    npc.alive = false;
    npc.health = 0;
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
  
  // Birth (if married and conditions met)
  if (npc.spouseId && npc.age > 20 && npc.age < 45 && npc.sex === 'F' && state.rng() < 0.003) {
    const spouse = state.npcs.get(npc.spouseId);
    if (spouse && spouse.alive) {
      const child = createNPC(state.rng, state.nextNpcId++, 0);
      child.district = npc.district;
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
      
      const year = Math.floor(state.tick / 360) + 1;
      state.log.push({
        id: `B${state.nextEventId++}`, tick: state.tick, year,
        day: (state.tick % 360) + 1,
        season: ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((state.tick % 360) / 90)],
        type: 'birth', text: `${npc.name} and ${spouse.name} welcomed a child: ${child.name}.`,
        npcIds: [npc.id, spouse.id, child.id],
        causalTrace: { tick: state.tick, npcId: npc.id, chosenAction: 'birth', topAlternatives: [], pressures: {}, modifiers: {}, diceRoll: state.rng(), threshold: 0.003, success: true },
        salience: 0.5,
        tags: ['birth', 'milestone'],
      });
    }
  }
}

// ============================================================
// SECTION 11: DEATH LOGGING
// ============================================================

function logDeath(npc: NPC, state: SimulationState): void {
  const year = Math.floor(state.tick / 360) + 1;
  const cause = npc.health <= 0 ? (npc.hunger > 0.8 ? 'starvation' : npc.age > 65 ? 'old age' : 'illness') : 'old age';
  
  state.log.push({
    id: `D${state.nextEventId++}`, tick: state.tick, year,
    day: (state.tick % 360) + 1,
    season: ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((state.tick % 360) / 90)],
    type: 'death', text: `${npc.name} died at age ${npc.age} from ${cause}.`,
    npcIds: [npc.id],
    causalTrace: { tick: state.tick, npcId: npc.id, chosenAction: 'death', topAlternatives: [], pressures: { hunger: npc.hunger, health: 1 - npc.health }, modifiers: { age: npc.age }, diceRoll: 0, threshold: 0, success: true },
    salience: 0.6,
    tags: ['death'],
  });
  
  // Spouse and children react
  if (npc.spouseId) {
    const spouse = state.npcs.get(npc.spouseId);
    if (spouse) {
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
  if (state.tick % 30 !== 0) return;
  
  const npcs = Array.from(state.npcs.values()).filter(n => n.alive);
  
  for (const npc of npcs) {
    const pressures = computePressures(npc, state);
    const sustainedPressure = Object.values(pressures).some(p => p > 0.7);
    if (!sustainedPressure) continue;
    
    // Check patterns
    // HELP_SOMEONE_IN_TROUBLE
    if (npc.traits.empathy > 0.5) {
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
    if (npc.traits.honesty > 0.5 && npc.memories.some(m => m.valence < -0.6)) {
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
    if (npc.traits.courage > 0.5 && npc.safety > 0.4) {
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
    if (npc.skills.persuasion > 30 && npc.relationships.some(r => r.affinity < -0.3)) {
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
    if (npc.memories.some(m => m.eventId.includes('stolen') || m.eventId.includes('robbed'))) {
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
      
      // Determine success
      const successChance = chosen.def.successChance(npc, state);
      const roll = rng();
      const success = roll < successChance;
      
      // Execute action
      const entry = chosen.def.execute(npc, state, success, rng);
      if (entry) {
        entry.causalTrace.tick = state.tick;
        entry.causalTrace.topAlternatives = scored
          .filter(s => s.action !== chosenId)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(s => ({ action: s.action, score: s.score }));
        entry.causalTrace.diceRoll = roll;
        entry.causalTrace.threshold = successChance;
        state.log.push(entry);
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

export function generateTopStories(state: SimulationState, count: number = 20): TopStory[] {
  // Score each log entry by salience factors
  const scoredEntries = state.log.map(entry => {
    let score = entry.salience;
    // Chain length bonus
    if (entry.tags.includes('crime')) score += 0.1;
    if (entry.tags.includes('death')) score += 0.2;
    if (entry.tags.includes('drama')) score += 0.15;
    if (entry.tags.includes('milestone')) score += 0.2;
    if (entry.tags.includes('world_event')) score += 0.1;
    if (entry.npcIds.length > 2) score += 0.05;
    return { entry, score };
  });
  
  scoredEntries.sort((a, b) => b.score - a.score);
  
  // Group related entries into stories
  const stories: TopStory[] = [];
  const usedEntries = new Set<string>();
  
  for (const { entry, score } of scoredEntries) {
    if (stories.length >= count) break;
    if (usedEntries.has(entry.id)) continue;
    if (score < 0.3) continue;
    
    // Find related entries (same NPCs, close in time)
    const related = scoredEntries.filter(({ entry: e }) => 
      !usedEntries.has(e.id) &&
      e.npcIds.some(id => entry.npcIds.includes(id)) &&
      Math.abs(e.tick - entry.tick) < 180
    ).slice(0, 5);
    
    const allEntries = [entry, ...related.map(r => r.entry)];
    allEntries.forEach(e => usedEntries.add(e.id));
    
    // Generate story paragraph
    const mainNpc = entry.npcIds.length > 0 ? state.npcs.get(entry.npcIds[0]) : undefined;
    const year = entry.year;
    
    let paragraph = '';
    if (entry.type === 'murder') {
      const victim = entry.npcIds.length > 1 ? state.npcs.get(entry.npcIds[1]) : undefined;
      paragraph = `In Year ${year}, ${mainNpc?.name || 'Unknown'} murdered ${victim?.name || 'another'}. `;
      if (related.length > 0) {
        paragraph += `This act of violence was preceded by mounting tension. `;
        paragraph += related.slice(0, 2).map(r => r.entry.text).join(' ');
      }
    } else if (entry.type === 'marry') {
      const spouse = entry.npcIds.length > 1 ? state.npcs.get(entry.npcIds[1]) : undefined;
      paragraph = `In Year ${year}, ${mainNpc?.name || 'Unknown'} and ${spouse?.name || 'their partner'} were joined in marriage. `;
      paragraph += `Their union brought hope to the settlement.`;
    } else if (entry.type === 'betray') {
      const target = entry.npcIds.length > 1 ? state.npcs.get(entry.npcIds[1]) : undefined;
      paragraph = `In Year ${year}, trust shattered when ${mainNpc?.name || 'Unknown'} betrayed ${target?.name || 'a companion'}. `;
      paragraph += `The wound of treachery would not heal easily.`;
    } else if (entry.tags.includes('world_event')) {
      paragraph = `In Year ${year}, a great event struck: ${entry.text}`;
    } else {
      paragraph = `In Year ${year}: ${entry.text}`;
      if (related.length > 0) {
        paragraph += ' ' + related.slice(0, 2).map(r => r.entry.text).join(' ');
      }
    }
    
    stories.push({
      rank: stories.length + 1,
      title: `${mainNpc?.name || 'Unknown'}'s Story (Year ${year})`,
      paragraph,
      salience: score,
      npcIds: entry.npcIds,
      entries: allEntries,
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
  
  // Action diversity
  const actionTypes: Record<string, number> = {};
  for (const entry of state.log) {
    actionTypes[entry.type] = (actionTypes[entry.type] || 0) + 1;
  }
  const totalLog = state.log.length;
  for (const [type, count] of Object.entries(actionTypes)) {
    if (count / totalLog > 0.4) {
      flags.push({ type: 'warning', message: `Action "${type}" dominates at ${(count / totalLog * 100).toFixed(0)}% of events.` });
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
