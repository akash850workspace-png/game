// ============================================================
// CONTROLLED CAUSAL TEST - Proves real causality exists
// ============================================================

import { initializeWorld, stepSimulation } from '../simulation-engine';
import type { WorldState, NPC } from '../types';

export interface CausalTestResult {
  passed: boolean;
  steps: CausalStep[];
  causalChain: string[];
  errors: string[];
}

export interface CausalStep {
  description: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export function runControlledCausalTest(): CausalTestResult {
  const result: CausalTestResult = {
    passed: true,
    steps: [],
    causalChain: [],
    errors: []
  };
  
  try {
    // Create tiny world with 3 NPCs
    const state = initializeWorld(42, 3);
    
    // Get NPCs
    const npcs = Array.from(state.npcs.values());
    if (npcs.length < 3) {
      result.passed = false;
      result.errors.push('Failed to create 3 NPCs');
      return result;
    }
    
    const npcA = npcs[0]; // Poor, hungry, dishonest
    const npcB = npcs[1]; // Wealthy
    const npcC = npcs[2]; // Friend of B
    
    // Setup NPC A: poor, hungry, dishonest
    npcA.coin = 5;
    npcA.hunger = 0.8;
    npcA.traits.honesty = 0.2;
    npcA.traits.greed = 0.8;
    npcA.traits.temper = 0.7;
    
    // Setup NPC B: wealthy
    npcB.coin = 100;
    npcB.hunger = 0.2;
    npcB.traits.honesty = 0.8;
    
    // Setup NPC C: friend of B
    npcC.coin = 50;
    npcB.relationships.set(npcC.id, {
      affinity: 0.8,
      trust: 0.9,
      fear: 0,
      respect: 0.7,
      resentment: 0,
      history: []
    });
    npcC.relationships.set(npcB.id, {
      affinity: 0.8,
      trust: 0.9,
      fear: 0,
      respect: 0.7,
      resentment: 0,
      history: []
    });
    
    result.steps.push({
      description: 'Setup: A is poor/hungry/dishonest, B is wealthy, C is friend of B',
      expected: 'Initial state configured',
      actual: `A: coin=${npcA.coin}, hunger=${npcA.hunger.toFixed(2)}, honesty=${npcA.traits.honesty.toFixed(2)}\nB: coin=${npcB.coin}\nC: coin=${npcC.coin}`,
      passed: true
    });
    
    // Record initial state
    const initialBCoin = npcB.coin;
    const initialBMemories = npcB.memories.length;
    const initialBRelationship = npcB.relationships.get(npcA.id)?.affinity || 0;
    
    // Run simulation until A steals from B
    let theftEvent: any = null;
    let maxTicks = 100;
    let tick = 0;
    
    while (tick < maxTicks && !theftEvent) {
      stepSimulation(state);
      
      // Check if theft occurred
      for (const event of state.events.values()) {
        if (event.type === 'steal' && 
            event.actorIds.includes(npcA.id) && 
            event.targetIds.includes(npcB.id)) {
          theftEvent = event;
          break;
        }
      }
      
      tick++;
    }
    
    if (!theftEvent) {
      result.passed = false;
      result.errors.push(`Theft did not occur after ${maxTicks} ticks`);
      return result;
    }
    
    result.steps.push({
      description: 'Step 1: A steals from B',
      expected: 'Theft event created',
      actual: `Event ${theftEvent.id} at tick ${theftEvent.tick}`,
      passed: true
    });
    
    result.causalChain.push(`E${theftEvent.id}: A steals from B`);
    
    // Verify B lost coins
    const afterTheftBCoin = npcB.coin;
    const coinLoss = initialBCoin - afterTheftBCoin;
    
    if (coinLoss <= 0) {
      result.passed = false;
      result.errors.push(`B did not lose coins: before=${initialBCoin}, after=${afterTheftBCoin}`);
    } else {
      result.steps.push({
        description: 'Step 2: B loses resources',
        expected: 'B.coin decreases',
        actual: `B.coin: ${initialBCoin} → ${afterTheftBCoin} (lost ${coinLoss})`,
        passed: true
      });
      result.causalChain.push(`B.coin: ${initialBCoin} → ${afterTheftBCoin}`);
    }
    
    // Verify B gained memory
    const afterTheftBMemories = npcB.memories.length;
    const newMemories = afterTheftBMemories - initialBMemories;
    
    if (newMemories <= 0) {
      result.passed = false;
      result.errors.push(`B did not gain memories: before=${initialBMemories}, after=${afterTheftBMemories}`);
    } else {
      result.steps.push({
        description: 'Step 3: B gains memory',
        expected: 'B.memories increases',
        actual: `B.memories: ${initialBMemories} → ${afterTheftBMemories} (+${newMemories})`,
        passed: true
      });
      
      const theftMemory = npcB.memories.find(m => m.eventId === theftEvent.id);
      if (theftMemory) {
        result.causalChain.push(`B remembers theft (valence: ${theftMemory.valence.toFixed(2)}, salience: ${theftMemory.salience.toFixed(2)})`);
      }
    }
    
    // Verify B's relationship toward A changed
    const afterTheftBRelationship = npcB.relationships.get(npcA.id)?.trust || 0;
    
    if (afterTheftBRelationship >= initialBRelationship) {
      result.passed = false;
      result.errors.push(`B's trust in A did not decrease: before=${initialBRelationship.toFixed(2)}, after=${afterTheftBRelationship.toFixed(2)}`);
    } else {
      result.steps.push({
        description: 'Step 4: B\'s relationship toward A changes',
        expected: 'B.trust[A] decreases',
        actual: `B.trust[A]: ${initialBRelationship.toFixed(2)} → ${afterTheftBRelationship.toFixed(2)}`,
        passed: true
      });
      result.causalChain.push(`B.trust[A]: ${initialBRelationship.toFixed(2)} → ${afterTheftBRelationship.toFixed(2)}`);
    }
    
    // Verify B develops goal or changes behavior
    // Run more ticks to see if B's decisions change
    const ticksBeforeBehaviorChange = 50;
    let behaviorChanged = false;
    
    for (let i = 0; i < ticksBeforeBehaviorChange; i++) {
      stepSimulation(state);
      
      // Check if B made a decision influenced by the theft
      for (const event of state.events.values()) {
        if (event.tick > theftEvent.tick && event.actorIds.includes(npcB.id)) {
          // Check if event has causal parent linking to theft
          if (event.parentIds.includes(theftEvent.id)) {
            behaviorChanged = true;
            result.steps.push({
              description: 'Step 5: B makes decision influenced by theft',
              expected: 'B\'s later decision has theft as parent',
              actual: `Event ${event.id} (${event.type}) at tick ${event.tick} has parent ${theftEvent.id}`,
              passed: true
            });
            result.causalChain.push(`E${event.id}: B's decision influenced by theft`);
            break;
          }
        }
      }
      
      if (behaviorChanged) break;
    }
    
    if (!behaviorChanged) {
      result.steps.push({
        description: 'Step 5: B makes decision influenced by theft',
        expected: 'B\'s later decision has theft as parent',
        actual: 'No decision found with theft as causal parent (may need more ticks)',
        passed: false
      });
      result.passed = false;
    }
    
    // Verify causal tracker has links
    if (state.causalTracker) {
      const explanation = state.causalTracker.getCausalExplanation(theftEvent.id);
      if (explanation.length > 0) {
        result.steps.push({
          description: 'Step 6: Causal tracker has explanation',
          expected: 'Causal explanation exists',
          actual: explanation.join('\n'),
          passed: true
        });
      } else {
        result.steps.push({
          description: 'Step 6: Causal tracker has explanation',
          expected: 'Causal explanation exists',
          actual: 'No explanation found',
          passed: false
        });
      }
    }
    
    // Verify decision analyzer created breakdown
    if (theftEvent.decisionBreakdown) {
      result.steps.push({
        description: 'Step 7: Decision breakdown exists',
        expected: 'Decision has score breakdown',
        actual: `Action: ${theftEvent.decisionBreakdown.action}\nScore: ${theftEvent.decisionBreakdown.finalScore.toFixed(2)}\nComponents: ${theftEvent.decisionBreakdown.components.length}`,
        passed: true
      });
    } else {
      result.steps.push({
        description: 'Step 7: Decision breakdown exists',
        expected: 'Decision has score breakdown',
        actual: 'No breakdown found',
        passed: false
      });
    }
    
  } catch (error) {
    result.passed = false;
    result.errors.push(`Test threw error: ${error}`);
  }
  
  return result;
}

export function printCausalTestResult(result: CausalTestResult): void {
  console.log('\n========================================');
  console.log('CONTROLLED CAUSAL TEST RESULTS');
  console.log('========================================\n');
  
  console.log(`Overall: ${result.passed ? '✅ PASSED' : '❌ FAILED'}\n`);
  
  console.log('Steps:');
  for (const step of result.steps) {
    console.log(`  ${step.passed ? '✅' : '❌'} ${step.description}`);
    console.log(`     Expected: ${step.expected}`);
    console.log(`     Actual: ${step.actual}\n`);
  }
  
  if (result.causalChain.length > 0) {
    console.log('Causal Chain:');
    for (let i = 0; i < result.causalChain.length; i++) {
      console.log(`  ${i + 1}. ${result.causalChain[i]}`);
      if (i < result.causalChain.length - 1) {
        console.log('     ↓');
      }
    }
    console.log('');
  }
  
  if (result.errors.length > 0) {
    console.log('Errors:');
    for (const error of result.errors) {
      console.log(`  ❌ ${error}`);
    }
    console.log('');
  }
  
  console.log('========================================\n');
}
