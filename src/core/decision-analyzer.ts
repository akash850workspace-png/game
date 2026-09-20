// ============================================================
// DECISION SCORE BREAKDOWN - Explains why NPCs choose actions
// ============================================================

import type { NPC, WorldState, Goal, Memory } from '../types';

interface Pressures {
  hunger: number;
  rest: number;
  safety: number;
  belonging: number;
  wealthNeed: number;
  statusNeed: number;
  health: number;
  vengeance: number;
  curiosity: number;
  piety: number;
  factionLoyalty: number;
  debt: number;
}

export interface ScoreBreakdown {
  action: string;
  baseScore: number;
  components: ScoreComponent[];
  finalScore: number;
}

export interface ScoreComponent {
  category: string;
  factor: string;
  value: number;
  contribution: number;
  explanation: string;
}

export class DecisionAnalyzer {
  constructor(private state: WorldState) {}
  
  // Analyze why an NPC chose a specific action
  analyzeDecision(
    npc: NPC,
    action: string,
    pressures: Pressures,
    allScores: Map<string, number>
  ): ScoreBreakdown {
    const breakdown: ScoreBreakdown = {
      action,
      baseScore: 0,
      components: [],
      finalScore: allScores.get(action) || 0
    };
    
    // Analyze each factor that contributed to the score
    this.analyzePressures(npc, action, pressures, breakdown);
    this.analyzeTraits(npc, action, breakdown);
    this.analyzeMemories(npc, action, breakdown);
    this.analyzeRelationships(npc, action, breakdown);
    this.analyzeGoals(npc, action, breakdown);
    this.analyzeKnowledge(npc, action, breakdown);
    this.analyzeEconomicState(npc, action, breakdown);
    
    // Calculate base score
    breakdown.baseScore = breakdown.components.reduce((sum, c) => sum + c.contribution, 0);
    
    return breakdown;
  }
  
  private analyzePressures(npc: NPC, action: string, pressures: Pressures, breakdown: ScoreBreakdown): void {
    // Different actions are influenced by different pressures
    const pressureInfluences: Record<string, Array<{ pressure: keyof Pressures; weight: number }>> = {
      'work': [
        { pressure: 'wealthNeed', weight: 0.5 },
        { pressure: 'hunger', weight: 0.3 }
      ],
      'eat': [
        { pressure: 'hunger', weight: 0.8 }
      ],
      'sleep': [
        { pressure: 'rest', weight: 0.9 }
      ],
      'socialize': [
        { pressure: 'belonging', weight: 0.6 }
      ],
      'steal': [
        { pressure: 'wealthNeed', weight: 0.5 },
        { pressure: 'hunger', weight: 0.3 }
      ],
      'fight': [
        { pressure: 'vengeance', weight: 0.5 }
      ]
    };
    
    const influences = pressureInfluences[action] || [];
    
    for (const { pressure, weight } of influences) {
      const value = pressures[pressure];
      const contribution = value * weight;
      
      breakdown.components.push({
        category: 'pressure',
        factor: pressure,
        value,
        contribution,
        explanation: `${pressure} (${value.toFixed(2)}) × ${weight} = ${contribution.toFixed(2)}`
      });
    }
  }
  
  private analyzeTraits(npc: NPC, action: string, breakdown: ScoreBreakdown): void {
    // Different actions are influenced by different traits
    const traitInfluences: Record<string, Array<{ trait: keyof NPC['traits']; weight: number; positive: boolean }>> = {
      'work': [
        { trait: 'ambition', weight: 0.2, positive: true }
      ],
      'eat': [],
      'sleep': [],
      'socialize': [
        { trait: 'empathy', weight: 0.3, positive: true }
      ],
      'steal': [
        { trait: 'honesty', weight: -0.3, positive: false },
        { trait: 'greed', weight: 0.3, positive: true }
      ],
      'fight': [
        { trait: 'temper', weight: 0.3, positive: true },
        { trait: 'courage', weight: 0.2, positive: true }
      ]
    };
    
    const influences = traitInfluences[action] || [];
    
    for (const { trait, weight, positive } of influences) {
      const value = npc.traits[trait];
      const contribution = value * weight;
      
      breakdown.components.push({
        category: 'trait',
        factor: trait,
        value,
        contribution,
        explanation: `${trait} (${value.toFixed(2)}) × ${weight} = ${contribution.toFixed(2)}`
      });
    }
  }
  
  private analyzeMemories(npc: NPC, action: string, breakdown: ScoreBreakdown): void {
    // Memories influence decisions based on their valence and relevance
    const relevantMemories = npc.memories.filter(m => {
      // Check if memory is relevant to this action
      const event = this.state.events.get(m.eventId);
      if (!event) return false;
      
      // Theft memories influence steal decisions
      if (action === 'steal' && event.type === 'theft') return true;
      // Violence memories influence fight decisions
      if (action === 'fight' && (event.type === 'fight' || event.type === 'assault')) return true;
      // Social memories influence socialize decisions
      if (action === 'socialize' && event.type === 'socialize') return true;
      
      return false;
    });
    
    for (const memory of relevantMemories) {
      const contribution = memory.valence * memory.salience * 0.2;
      
      breakdown.components.push({
        category: 'memory',
        factor: `memory_${memory.eventId}`,
        value: memory.valence,
        contribution,
        explanation: `Memory of ${memory.eventId} (valence: ${memory.valence.toFixed(2)}, salience: ${memory.salience.toFixed(2)})`
      });
    }
  }
  
  private analyzeRelationships(npc: NPC, action: string, breakdown: ScoreBreakdown): void {
    // Relationships influence decisions about other NPCs
    if (action === 'socialize' || action === 'fight' || action === 'steal') {
      // Find recent interactions
      const recentRelationships = Array.from(npc.relationships.entries())
        .filter(([_, rel]) => rel.history.length > 0)
        .slice(0, 3);
      
      for (const [otherId, rel] of recentRelationships) {
        const other = this.state.npcs.get(otherId);
        if (!other) continue;
        
        let contribution = 0;
        let explanation = '';
        
        if (action === 'socialize') {
          contribution = rel.affinity * 0.2;
          explanation = `Relationship with ${other.name} (affinity: ${rel.affinity.toFixed(2)})`;
        } else if (action === 'fight') {
          contribution = -rel.affinity * 0.3 + rel.resentment * 0.2;
          explanation = `Conflict with ${other.name} (affinity: ${rel.affinity.toFixed(2)}, resentment: ${rel.resentment.toFixed(2)})`;
        } else if (action === 'steal') {
          contribution = -rel.trust * 0.2;
          explanation = `Trust relationship with ${other.name} (trust: ${rel.trust.toFixed(2)})`;
        }
        
        if (Math.abs(contribution) > 0.01) {
          breakdown.components.push({
            category: 'relationship',
            factor: `relationship_${otherId}`,
            value: rel.affinity,
            contribution,
            explanation
          });
        }
      }
    }
  }
  
  private analyzeGoals(npc: NPC, action: string, breakdown: ScoreBreakdown): void {
    // Goals influence decisions that help achieve them
    for (const goal of npc.goals) {
      if (goal.completed) continue;
      
      let contribution = 0;
      let explanation = '';
      
      // Check if this action helps achieve the goal
      if (goal.type === 'repay_debt' && action === 'work') {
        contribution = goal.priority * 0.3;
        explanation = `Goal: ${goal.description} (priority: ${goal.priority.toFixed(2)})`;
      } else if (goal.type === 'revenge' && action === 'fight') {
        contribution = goal.priority * 0.5;
        explanation = `Goal: ${goal.description} (priority: ${goal.priority.toFixed(2)})`;
      } else if (goal.type === 'accumulate_wealth' && action === 'work') {
        contribution = goal.priority * 0.2;
        explanation = `Goal: ${goal.description} (priority: ${goal.priority.toFixed(2)})`;
      }
      
      if (contribution > 0) {
        breakdown.components.push({
          category: 'goal',
          factor: `goal_${goal.id}`,
          value: goal.priority,
          contribution,
          explanation
        });
      }
    }
  }
  
  private analyzeKnowledge(npc: NPC, action: string, breakdown: ScoreBreakdown): void {
    // Knowledge influences decisions based on what NPC knows
    // For example, if NPC knows someone is wealthy, they might target them for theft
    
    if (action === 'steal') {
      // Check if NPC knows about wealthy targets
      const knownWealthy = Array.from(npc.knowledge.witnessedEvents)
        .map(eventId => this.state.events.get(eventId))
        .filter(event => event && event.type === 'work' && event.stateChanges.some(c => c.property === 'coin' && (c.delta || 0) > 10));
      
      if (knownWealthy.length > 0) {
        const contribution = 0.2;
        breakdown.components.push({
          category: 'knowledge',
          factor: 'known_wealthy_targets',
          value: knownWealthy.length,
          contribution,
          explanation: `Knows about ${knownWealthy.length} wealthy targets`
        });
      }
    }
  }
  
  private analyzeEconomicState(npc: NPC, action: string, breakdown: ScoreBreakdown): void {
    // Economic state influences economic decisions
    if (action === 'work' || action === 'eat') {
      const food = this.state.economy.resources.get('food');
      if (food) {
        // High food prices make work more attractive
        if (action === 'work' && food.price > 2) {
          const contribution = (food.price - 2) * 0.1;
          breakdown.components.push({
            category: 'economy',
            factor: 'food_price',
            value: food.price,
            contribution,
            explanation: `High food price (${food.price.toFixed(2)}) increases work incentive`
          });
        }
        
        // High food prices make eating less attractive if poor
        if (action === 'eat' && food.price > 2 && npc.coin < 20) {
          const contribution = -(food.price - 2) * 0.15;
          breakdown.components.push({
            category: 'economy',
            factor: 'food_price',
            value: food.price,
            contribution,
            explanation: `High food price (${food.price.toFixed(2)}) makes eating expensive`
          });
        }
      }
    }
  }
  
  // Generate human-readable explanation
  generateExplanation(breakdown: ScoreBreakdown): string {
    const lines: string[] = [];
    
    lines.push(`ACTION: ${breakdown.action}`);
    lines.push(`FINAL SCORE: ${breakdown.finalScore.toFixed(2)}`);
    lines.push('');
    
    // Group components by category
    const byCategory = new Map<string, ScoreComponent[]>();
    for (const comp of breakdown.components) {
      if (!byCategory.has(comp.category)) {
        byCategory.set(comp.category, []);
      }
      byCategory.get(comp.category)!.push(comp);
    }
    
    for (const [category, components] of byCategory) {
      lines.push(`${category.toUpperCase()}:`);
      for (const comp of components) {
        lines.push(`  ${comp.explanation}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
}
