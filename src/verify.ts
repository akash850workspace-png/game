// Quick verification script - run this to test the simulation
import { runSimulation } from './simulation-engine';
import { runControlledCausalTest, printCausalTestResult } from './core/tests';

console.log('====================================');
console.log('SETTLEMENT SIMULATION - QUICK VERIFY');
console.log('====================================\n');

// Test 1: Controlled Causal Test
console.log('Running Controlled Causal Test...\n');
const testResult = runControlledCausalTest();
printCausalTestResult(testResult);

// Test 2: 10-Year Simulation (quick test)
console.log('\nRunning 10-Year Simulation (seed=42)...\n');
const startTime = Date.now();
const state = runSimulation(42, 10);
const endTime = Date.now();

console.log(`Simulation completed in ${endTime - startTime}ms`);
console.log(`Total ticks: ${state.tick}`);
console.log(`Total events: ${state.events.size}`);
console.log(`Total decisions: ${state.stats.totalDecisions}`);
console.log(`Final population: ${Array.from(state.npcs.values()).filter(n => n.alive).length}`);
console.log(`Story threads: ${state.storyThreads.size}`);
console.log(`Missions: ${state.missions.size}`);

// Test 3: Check causal chains
console.log('\nChecking causal chains...\n');
let eventsWithParents = 0;
let eventsWithoutParents = 0;
let totalParents = 0;

for (const event of state.events.values()) {
  if (event.parentIds.length > 0) {
    eventsWithParents++;
    totalParents += event.parentIds.length;
  } else {
    eventsWithoutParents++;
  }
}

console.log(`Events with parents: ${eventsWithParents}`);
console.log(`Events without parents: ${eventsWithoutParents}`);
console.log(`Total parent links: ${totalParents}`);
console.log(`Average parents per event: ${(totalParents / Math.max(1, eventsWithParents)).toFixed(2)}`);

// Test 4: Check decision breakdowns
console.log('\nChecking decision breakdowns...\n');
let eventsWithBreakdown = 0;
for (const event of state.events.values()) {
  if ((event as any).decisionBreakdown) {
    eventsWithBreakdown++;
  }
}
console.log(`Events with decision breakdowns: ${eventsWithBreakdown}`);

// Test 5: Sample causal chain
console.log('\nSample causal chain (first event with parents):\n');
for (const event of state.events.values()) {
  if (event.parentIds.length > 0) {
    console.log(`Event: ${event.id} (${event.type})`);
    console.log(`  Description: ${event.description}`);
    console.log(`  Parents: ${event.parentIds.join(', ')}`);
    
    if (state.causalTracker) {
      const explanation = state.causalTracker.getCausalExplanation(event.id);
      if (explanation.length > 0) {
        console.log(`  Causal explanation:`);
        for (const exp of explanation) {
          console.log(`    - ${exp}`);
        }
      }
    }
    
    if ((event as any).decisionBreakdown) {
      const breakdown = (event as any).decisionBreakdown;
      console.log(`  Decision: ${breakdown.action} (score: ${breakdown.finalScore.toFixed(2)})`);
      console.log(`  Components: ${breakdown.components.length}`);
    }
    
    break;
  }
}

console.log('\n====================================');
console.log('VERIFICATION COMPLETE');
console.log('====================================\n');
