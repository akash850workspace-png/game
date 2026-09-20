// ============================================================
// MAIN SIMULATION ENGINE - Causal World Simulator
// ============================================================

import type { WorldState, NPC, SimEvent, Location, EconomyState, WildlifeState, SimulationStats } from './types';
import { makeDecision, applyStateChanges, applyRelationshipChanges, applyMemoryCreations, updatePerception, updateGoals, createEvent } from './causal-engine';
import { detectStoryThreads, generateMissions } from './story-engine';
import { exportSimulation, downloadExport, generateEventLog, generateCausalChains, generateEmergentHistory } from './export-system';

// ============================================================
// SEEDED RANDOM NUMBER GENERATOR
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

// ============================================================
// INITIALIZATION
// ============================================================

export function initializeWorld(seed: number, population: number = 150): WorldState {
  const rng = mulberry32(seed);
  
  const state: WorldState = {
    tick: 0,
    seed,
    rng,
    npcs: new Map(),
    locations: new Map(),
    events: new Map(),
    eventGraph: {
      nodes: new Map(),
      edges: new Map(),
      reverseEdges: new Map()
    },
    storyThreads: new Map(),
    missions: new Map(),
    economy: {
      resources: new Map(),
      transactions: []
    },
    wildlife: {
      creatures: new Map(),
      populations: new Map()
    },
    stats: {
      populationByYear: [],
      birthsByYear: [],
      deathsByYear: [],
      avgCoinByYear: [],
      giniByYear: [],
      crimeRateByYear: [],
      foodPriceByYear: [],
      minPopByYear: [],
      maxPopByYear: [],
      totalEvents: 0,
      totalDecisions: 0,
      avgCausalDepth: 0
    },
    nextNpcId: 1,
    nextEventId: 1,
    nextStoryId: 1,
    nextMissionId: 1
  };
  
  // Initialize locations
  initializeLocations(state);
  
  // Initialize economy
  initializeEconomy(state);
  
  // Initialize NPCs
  for (let i = 0; i < population; i++) {
    createInitialNPC(state);
  }
  
  // Initialize wildlife
  initializeWildlife(state);
  
  return state;
}

function initializeLocations(state: WorldState): void {
  const districts = ['Market', 'Farms', 'Docks', 'Old Quarter'];
  
  for (const name of districts) {
    const location: Location = {
      id: name.toLowerCase().replace(' ', '_'),
      name,
      type: 'district',
      safety: 0.7,
      resources: {}
    };
    state.locations.set(location.id, location);
  }
}

function initializeEconomy(state: WorldState): void {
  const resources = ['food', 'wood', 'iron', 'cloth', 'tools', 'medicine', 'luxuries'];
  
  for (const resource of resources) {
    state.economy.resources.set(resource, {
      supply: 100 + state.rng() * 100,
      demand: 50 + state.rng() * 50,
      price: 0.8 + state.rng() * 0.4,
      production: 10,
      consumption: 5
    });
  }
}

function initializeWildlife(state: WorldState): void {
  // Create some initial creatures
  const species = ['wolf', 'bear', 'deer', 'rabbit'];
  
  for (const sp of species) {
    state.wildlife.populations.set(sp, 5 + Math.floor(state.rng() * 10));
    
    // Create individual creatures
    for (let i = 0; i < 3; i++) {
      const creature = {
        id: `creature_${sp}_${i}`,
        species: sp,
        age: 1 + Math.floor(state.rng() * 10),
        health: 0.8 + state.rng() * 0.2,
        hunger: state.rng() * 0.5,
        location: Array.from(state.locations.keys())[Math.floor(state.rng() * state.locations.size)],
        territory: [],
        threat: sp === 'wolf' || sp === 'bear' ? 0.7 : 0.2,
        alive: true,
        memories: []
      };
      state.wildlife.creatures.set(creature.id, creature);
    }
  }
}

function createInitialNPC(state: WorldState): NPC {
  const id = state.nextNpcId++;
  const sex = state.rng() > 0.5 ? 'M' : 'F';
  const age = 18 + Math.floor(state.rng() * 40);
  
  const firstNames = ['Aldric', 'Brienne', 'Cedric', 'Dagny', 'Eldrin', 'Freya', 'Gareth', 'Hilda', 'Igor', 'Jorah'];
  const lastNames = ['Ashford', 'Blackwood', 'Carrick', 'Deepdelver', 'Elmsworth', 'Fireforge', 'Greycastle', 'Hammerfall'];
  
  const firstName = firstNames[Math.floor(state.rng() * firstNames.length)];
  const lastName = lastNames[Math.floor(state.rng() * lastNames.length)];
  
  const jobs = ['farmer', 'merchant', 'guard', 'craftsman', 'healer', 'scholar', 'thief', 'hunter'];
  const job = jobs[Math.floor(state.rng() * jobs.length)];
  
  const districts = Array.from(state.locations.keys());
  const district = districts[Math.floor(state.rng() * districts.length)];
  
  const npc: NPC = {
    id,
    name: `${firstName} ${lastName}`,
    age,
    sex,
    alive: true,
    birthTick: state.tick - age * 360,
    health: 0.7 + state.rng() * 0.3,
    hunger: state.rng() * 0.3,
    rest: state.rng() * 0.3,
    district,
    coin: 10 + Math.floor(state.rng() * 90),
    inventory: {},
    job,
    relationships: new Map(),
    familyLinks: [],
    spouseId: null,
    parentIds: [],
    traits: {
      greed: state.rng(),
      honesty: state.rng(),
      courage: state.rng(),
      empathy: state.rng(),
      ambition: state.rng(),
      curiosity: state.rng(),
      temper: state.rng(),
      loyalty: state.rng(),
      piety: state.rng(),
      cunning: state.rng()
    },
    skills: {
      farming: Math.floor(state.rng() * 100),
      trading: Math.floor(state.rng() * 100),
      crafting: Math.floor(state.rng() * 100),
      fighting: Math.floor(state.rng() * 100),
      stealth: Math.floor(state.rng() * 100),
      persuasion: Math.floor(state.rng() * 100),
      medicine: Math.floor(state.rng() * 100),
      scholarship: Math.floor(state.rng() * 100),
      leadership: Math.floor(state.rng() * 100)
    },
    memories: [],
    goals: [],
    knowledge: {
      witnessedEvents: new Set(),
      heardEvents: new Set(),
      beliefs: new Map()
    },
    faction: null,
    reputation: {
      'Guards': 0,
      'Merchant Guild': 0,
      'Farmer Collective': 0,
      'Criminal Underground': 0
    },
    crimes: [],
    debts: [],
    eventParticipation: [],
    decisionsMade: []
  };
  
  state.npcs.set(id, npc);
  return npc;
}

// ============================================================
// MAIN SIMULATION LOOP
// ============================================================

export function stepSimulation(state: WorldState): void {
  // Update each living NPC
  const aliveNPCs = Array.from(state.npcs.values()).filter(n => n.alive);
  
  for (const npc of aliveNPCs) {
    // Daily needs update
    updateDailyNeeds(npc, state);
    
    if (!npc.alive) {
      handleDeath(npc, state);
      continue;
    }
    
    // Decision making (every 1-3 days)
    if (state.tick - (npc as any).lastActionTick >= 1 + Math.floor(state.rng() * 2)) {
      (npc as any).lastActionTick = state.tick;
      
      // Make decision using causal engine
      const actions = getAvailableActions(npc, state);
      const decision = makeDecision(npc, state, actions);
      
      if (decision) {
        // Create event
        const event = createEvent(
          state,
          decision.action,
          [npc.id],
          [],
          decision.result,
          decision
        );
        
        // Apply state changes
        applyStateChanges(state, decision.result.stateChanges);
        applyRelationshipChanges(state, decision.result.relationshipChanges);
        applyMemoryCreations(state, decision.result.memoryCreations);
        
        // Update perception
        updatePerception(state, event);
        
        // Update goals
        updateGoals(npc, state, event);
        
        // Track participation
        npc.eventParticipation.push(event.id);
        npc.decisionsMade.push(event.id);
        
        state.stats.totalDecisions++;
      }
    }
    
    // Birth check
    if (npc.sex === 'F' && npc.age >= 18 && npc.age <= 40 && npc.spouseId) {
      const spouse = state.npcs.get(npc.spouseId);
      if (spouse && spouse.alive && state.rng() < 0.008) {
        handleBirth(npc, spouse, state);
      }
    }
  }
  
  // World events
  processWorldEvents(state);
  
  // Wildlife
  processWildlife(state);
  
  // Economy
  updateEconomy(state);
  
  // Story detection
  if (state.tick % 30 === 0) {
    detectStoryThreads(state);
    generateMissions(state);
  }
  
  // Statistics
  if (state.tick % 360 === 0) {
    updateYearlyStats(state);
  }
  
  state.tick++;
  state.stats.totalEvents = state.events.size;
}

function updateDailyNeeds(npc: NPC, state: WorldState): void {
  // Hunger increases
  npc.hunger = Math.min(1, npc.hunger + 0.03);
  
  // Rest increases
  npc.rest = Math.min(1, npc.rest + 0.025);
  
  // Health effects
  if (npc.hunger > 0.9) {
    npc.health = Math.max(0, npc.health - 0.01);
  }
  
  // Death check
  if (npc.health <= 0 || (npc.age > 70 && state.rng() < 0.005)) {
    npc.alive = false;
    npc.deathTick = state.tick;
  }
}

function handleDeath(npc: NPC, state: WorldState): void {
  // Create death event
  const event = createEvent(
    state,
    'death',
    [npc.id],
    [],
    {
      stateChanges: [{
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'alive',
        oldValue: true,
        newValue: false
      }],
      relationshipChanges: [],
      memoryCreations: [],
      description: `${npc.name} died at age ${npc.age}`,
      salience: 0.6,
      tags: ['death']
    }
  );
  
  // Update spouse
  if (npc.spouseId) {
    const spouse = state.npcs.get(npc.spouseId);
    if (spouse) {
      spouse.spouseId = null;
    }
  }
  
  state.stats.deathsByYear[Math.floor(state.tick / 360)] = 
    (state.stats.deathsByYear[Math.floor(state.tick / 360)] || 0) + 1;
}

function handleBirth(mother: NPC, father: NPC, state: WorldState): void {
  const child = createInitialNPC(state);
  child.age = 0;
  child.birthTick = state.tick;
  child.parentIds = [mother.id, father.id];
  child.district = mother.district;
  
  // Blend traits
  for (const key of Object.keys(child.traits) as (keyof typeof child.traits)[]) {
    child.traits[key] = (mother.traits[key] + father.traits[key]) / 2 + (state.rng() - 0.5) * 0.2;
    child.traits[key] = Math.max(0, Math.min(1, child.traits[key]));
  }
  
  // Create birth event
  const event = createEvent(
    state,
    'birth',
    [mother.id, father.id],
    [child.id],
    {
      stateChanges: [],
      relationshipChanges: [],
      memoryCreations: [],
      description: `${mother.name} and ${father.name} welcomed a child: ${child.name}`,
      salience: 0.5,
      tags: ['birth', 'milestone']
    }
  );
  
  // Update family links
  mother.familyLinks.push({ type: 'child', npcId: child.id });
  father.familyLinks.push({ type: 'child', npcId: child.id });
  child.familyLinks.push({ type: 'parent', npcId: mother.id });
  child.familyLinks.push({ type: 'parent', npcId: father.id });
  
  state.stats.birthsByYear[Math.floor(state.tick / 360)] = 
    (state.stats.birthsByYear[Math.floor(state.tick / 360)] || 0) + 1;
}

function processWorldEvents(state: WorldState): void {
  // Random world events
  if (state.rng() < 0.001) {
    const eventTypes = ['famine', 'plague', 'bandit_raid', 'festival', 'trade_caravan'];
    const type = eventTypes[Math.floor(state.rng() * eventTypes.length)];
    
    const event = createEvent(
      state,
      type,
      [],
      [],
      {
        stateChanges: [],
        relationshipChanges: [],
        memoryCreations: [],
        description: `A ${type.replace('_', ' ')} has occurred`,
        salience: 0.7,
        tags: ['world_event', type]
      }
    );
    
    // Apply effects based on event type
    if (type === 'famine') {
      const food = state.economy.resources.get('food');
      if (food) {
        food.supply *= 0.5;
        food.price *= 1.5;
      }
    } else if (type === 'festival') {
      // Boost morale
      for (const npc of state.npcs.values()) {
        if (npc.alive) {
          npc.rest = Math.max(0, npc.rest - 0.2);
        }
      }
    }
  }
}

function processWildlife(state: WorldState): void {
  // Update creature states
  for (const creature of state.wildlife.creatures.values()) {
    if (!creature.alive) continue;
    
    creature.hunger = Math.min(1, creature.hunger + 0.02);
    
    if (creature.hunger > 0.8 && state.rng() < 0.01) {
      // Creature attacks
      const npcsInLocation = Array.from(state.npcs.values()).filter(
        n => n.alive && n.district === creature.location
      );
      
      if (npcsInLocation.length > 0) {
        const target = npcsInLocation[Math.floor(state.rng() * npcsInLocation.length)];
        
        const event = createEvent(
          state,
          'wildlife_attack',
          [],
          [target.id],
          {
            stateChanges: [{
              type: 'npc',
              targetId: target.id.toString(),
              property: 'health',
              oldValue: target.health,
              newValue: target.health - 0.2,
              delta: -0.2
            }],
            relationshipChanges: [],
            memoryCreations: [],
            description: `A ${creature.species} attacked ${target.name}`,
            salience: 0.5,
            tags: ['wildlife', 'attack']
          }
        );
        
        target.health -= 0.2;
      }
    }
  }
}

function updateEconomy(state: WorldState): void {
  // Update prices based on supply/demand
  for (const [name, resource] of state.economy.resources) {
    const ratio = resource.demand / Math.max(1, resource.supply);
    resource.price = Math.max(0.2, Math.min(5.0, resource.price + (ratio - 1) * 0.05));
    
    // Decay supply/demand
    resource.supply = Math.max(0, resource.supply - resource.consumption);
    resource.supply += resource.production;
  }
}

function updateYearlyStats(state: WorldState): void {
  const aliveNPCs = Array.from(state.npcs.values()).filter(n => n.alive);
  const year = Math.floor(state.tick / 360);
  
  state.stats.populationByYear[year] = aliveNPCs.length;
  
  const coins = aliveNPCs.map(n => n.coin);
  const avgCoin = coins.length > 0 ? coins.reduce((a, b) => a + b, 0) / coins.length : 0;
  state.stats.avgCoinByYear[year] = avgCoin;
  
  // Gini coefficient
  if (coins.length > 1) {
    coins.sort((a, b) => a - b);
    const n = coins.length;
    let sumDiff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiff += Math.abs(coins[i] - coins[j]);
      }
    }
    const mean = coins.reduce((a, b) => a + b, 0) / n;
    const gini = mean > 0 ? sumDiff / (2 * n * n * mean) : 0;
    state.stats.giniByYear[year] = gini;
  }
  
  const food = state.economy.resources.get('food');
  if (food) {
    state.stats.foodPriceByYear[year] = food.price;
  }
}

// ============================================================
// ACTION DEFINITIONS
// ============================================================

import type { ActionDefinition } from './causal-engine';

function getAvailableActions(npc: NPC, state: WorldState): ActionDefinition[] {
  return [
    workAction,
    eatAction,
    sleepAction,
    socializeAction,
    stealAction,
    fightAction,
    // Add more actions as needed
  ];
}

const workAction: ActionDefinition = {
  id: 'work',
  name: 'Work',
  preconditions: (npc) => npc.alive && npc.rest < 0.8,
  utility: (npc, pressures) => pressures.wealthNeed * 0.5 + pressures.hunger * 0.3,
  successChance: () => 0.8,
  execute: (npc, state, success) => {
    const earnings = success ? 5 + Math.floor(state.rng() * 10) : 0;
    
    return {
      stateChanges: [{
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'coin',
        oldValue: npc.coin,
        newValue: npc.coin + earnings,
        delta: earnings
      }, {
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'rest',
        oldValue: npc.rest,
        newValue: Math.min(1, npc.rest + 0.15)
      }],
      relationshipChanges: [],
      memoryCreations: [],
      description: `${npc.name} worked and earned ${earnings} coin`,
      salience: 0.1,
      tags: ['work', 'economic']
    };
  }
};

const eatAction: ActionDefinition = {
  id: 'eat',
  name: 'Eat',
  preconditions: (npc) => npc.alive && npc.hunger > 0.3,
  utility: (npc, pressures) => pressures.hunger * 0.8,
  successChance: () => 0.95,
  execute: (npc, state, success) => {
    const cost = 2;
    const canAfford = npc.coin >= cost;
    
    if (!canAfford) {
      return {
        stateChanges: [],
        relationshipChanges: [],
        memoryCreations: [],
        description: `${npc.name} wanted to eat but couldn't afford food`,
        salience: 0.2,
        tags: ['hunger', 'poverty']
      };
    }
    
    return {
      stateChanges: [{
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'coin',
        oldValue: npc.coin,
        newValue: npc.coin - cost
      }, {
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'hunger',
        oldValue: npc.hunger,
        newValue: Math.max(0, npc.hunger - 0.5)
      }],
      relationshipChanges: [],
      memoryCreations: [],
      description: `${npc.name} ate food for ${cost} coin`,
      salience: 0.05,
      tags: ['eat', 'daily']
    };
  }
};

const sleepAction: ActionDefinition = {
  id: 'sleep',
  name: 'Sleep',
  preconditions: (npc) => npc.alive && npc.rest > 0.4,
  utility: (npc, pressures) => pressures.rest * 0.9,
  successChance: () => 0.95,
  execute: (npc, state, success) => {
    return {
      stateChanges: [{
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'rest',
        oldValue: npc.rest,
        newValue: Math.max(0, npc.rest - 0.6)
      }, {
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'health',
        oldValue: npc.health,
        newValue: Math.min(1, npc.health + 0.03)
      }],
      relationshipChanges: [],
      memoryCreations: [],
      description: `${npc.name} slept and recovered`,
      salience: 0.02,
      tags: ['sleep', 'daily']
    };
  }
};

const socializeAction: ActionDefinition = {
  id: 'socialize',
  name: 'Socialize',
  preconditions: (npc) => npc.alive && npc.rest < 0.7,
  utility: (npc, pressures) => pressures.belonging * 0.6 + npc.traits.empathy * 0.3,
  successChance: () => 0.8,
  execute: (npc, state, success) => {
    // Find someone to socialize with
    const others = Array.from(state.npcs.values()).filter(
      n => n.alive && n.id !== npc.id && n.district === npc.district
    );
    
    if (others.length === 0) {
      return {
        stateChanges: [],
        relationshipChanges: [],
        memoryCreations: [],
        description: `${npc.name} wanted to socialize but was alone`,
        salience: 0.1,
        tags: ['social', 'lonely']
      };
    }
    
    const target = others[Math.floor(state.rng() * others.length)];
    
    return {
      stateChanges: [{
        type: 'npc',
        targetId: npc.id.toString(),
        property: 'belonging',
        oldValue: (npc as any).belonging || 0,
        newValue: Math.max(0, ((npc as any).belonging || 0) - 0.2)
      }],
      relationshipChanges: [{
        npc1Id: npc.id,
        npc2Id: target.id,
        property: 'affinity',
        oldValue: 0,
        newValue: 0.1,
        delta: 0.1,
        reason: 'socialized'
      }],
      memoryCreations: [],
      description: `${npc.name} socialized with ${target.name}`,
      salience: 0.15,
      tags: ['social']
    };
  }
};

const stealAction: ActionDefinition = {
  id: 'steal',
  name: 'Steal',
  preconditions: (npc) => npc.alive && npc.traits.honesty < 0.5,
  utility: (npc, pressures) => pressures.wealthNeed * 0.5 + (1 - npc.traits.honesty) * 0.3,
  successChance: (npc) => 0.3 + npc.skills.stealth * 0.005,
  execute: (npc, state, success) => {
    const targets = Array.from(state.npcs.values()).filter(
      n => n.alive && n.id !== npc.id && n.coin > 10
    );
    
    if (targets.length === 0) {
      return {
        stateChanges: [],
        relationshipChanges: [],
        memoryCreations: [],
        description: `${npc.name} considered stealing but found no targets`,
        salience: 0.2,
        tags: ['crime', 'attempted']
      };
    }
    
    const target = targets[Math.floor(state.rng() * targets.length)];
    
    if (success) {
      const amount = 5 + Math.floor(state.rng() * 15);
      
      return {
        stateChanges: [{
          type: 'npc',
          targetId: npc.id.toString(),
          property: 'coin',
          oldValue: npc.coin,
          newValue: npc.coin + amount,
          delta: amount
        }, {
          type: 'npc',
          targetId: target.id.toString(),
          property: 'coin',
          oldValue: target.coin,
          newValue: target.coin - amount,
          delta: -amount
        }],
        relationshipChanges: [],
        memoryCreations: [{
          npcId: target.id,
          eventId: '', // Will be filled in
          valence: -0.7,
          salience: 0.8,
          confidence: 1.0,
          source: 'witnessed'
        }],
        description: `${npc.name} stole ${amount} coin from ${target.name}`,
        salience: 0.5,
        tags: ['crime', 'theft']
      };
    } else {
      return {
        stateChanges: [],
        relationshipChanges: [],
        memoryCreations: [],
        description: `${npc.name} attempted to steal from ${target.name} but failed`,
        salience: 0.3,
        tags: ['crime', 'attempted']
      };
    }
  }
};

const fightAction: ActionDefinition = {
  id: 'fight',
  name: 'Fight',
  preconditions: (npc) => npc.alive && npc.traits.temper > 0.5,
  utility: (npc, pressures) => pressures.vengeance * 0.5 + npc.traits.temper * 0.3,
  successChance: (npc) => 0.3 + npc.skills.fighting * 0.005,
  execute: (npc, state, success) => {
    const targets = Array.from(state.npcs.values()).filter(
      n => n.alive && n.id !== npc.id && n.district === npc.district
    );
    
    if (targets.length === 0) {
      return {
        stateChanges: [],
        relationshipChanges: [],
        memoryCreations: [],
        description: `${npc.name} wanted to fight but found no one`,
        salience: 0.2,
        tags: ['violence', 'attempted']
      };
    }
    
    const target = targets[Math.floor(state.rng() * targets.length)];
    
    if (success) {
      const damage = 0.1 + state.rng() * 0.2;
      
      return {
        stateChanges: [{
          type: 'npc',
          targetId: target.id.toString(),
          property: 'health',
          oldValue: target.health,
          newValue: target.health - damage,
          delta: -damage
        }],
        relationshipChanges: [{
          npc1Id: npc.id,
          npc2Id: target.id,
          property: 'affinity',
          oldValue: 0,
          newValue: -0.4,
          delta: -0.4,
          reason: 'fought'
        }],
        memoryCreations: [],
        description: `${npc.name} fought ${target.name} and dealt damage`,
        salience: 0.5,
        tags: ['violence', 'fight']
      };
    } else {
      const damage = 0.05 + state.rng() * 0.1;
      
      return {
        stateChanges: [{
          type: 'npc',
          targetId: npc.id.toString(),
          property: 'health',
          oldValue: npc.health,
          newValue: npc.health - damage,
          delta: -damage
        }],
        relationshipChanges: [],
        memoryCreations: [],
        description: `${npc.name} fought ${target.name} but took damage`,
        salience: 0.4,
        tags: ['violence', 'fight']
      };
    }
  }
};

// ============================================================
// RUN SIMULATION
// ============================================================

export function runSimulation(seed: number, years: number = 100): WorldState {
  const state = initializeWorld(seed);
  const totalTicks = years * 360;
  
  while (state.tick < totalTicks) {
    stepSimulation(state);
  }
  
  return state;
}

// ============================================================
// EXPORT FUNCTIONS
// ============================================================

export { exportSimulation, downloadExport, generateEventLog, generateCausalChains, generateEmergentHistory };

// Re-export types for convenience
export type { WorldState, SimEvent, NPC, StoryThread, Mission, Location, EconomyState, WildlifeState, SimulationStats } from './types';
