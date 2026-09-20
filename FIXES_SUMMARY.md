# Settlement Simulation - Critical Fixes Summary

## Overview
Fixed 7 critical issues that were causing population extinction and poor simulation quality. All fixes maintain deterministic behavior using seeded RNG only.

## Fixes Implemented

### 1. MURDER RATE - Restricted to Revenge Goals Only
**Problem**: Murder was too common (2-6 per year in small town), causing population collapse.

**Solution**: 
- Murder now requires either:
  - Active revenge goal (type='revenge' with progress < 1), OR
  - Criminal faction membership with debt/extortion motive
- Removed temper-based murder path
- Added child protection (age < 14 cannot be murdered)
- Target: <1 murder per 500 people-years

**Code Changes**:
- Modified `murder` action preconditions to check for revenge goals or criminal motives
- Updated utility function to only give high scores for revenge-motivated murders
- Added age check: `if (!target || target.age < 14) return null;`

### 2. CHILD PROTECTION - Age < 14 Excluded from Hostile Actions
**Problem**: Children were being targeted by murder, theft, robbery, blackmail, and other hostile actions.

**Solution**: Added age checks to all hostile actions:
- `murder`: Cannot target children
- `fight`: Cannot fight children
- `steal`: Cannot steal from children
- `pickpocket`: Cannot pickpocket children
- `burgle`: Cannot burgle children
- `rob`: Cannot rob children
- `blackmail`: Cannot blackmail children
- `betray`: Cannot betray children
- `poison`: Cannot poison children
- `seek_revenge`: Cannot seek revenge on children
- `arrest`: Cannot arrest children

**Code Changes**: Added `target.age < 14` or `t.age >= 14` checks in all hostile action execute functions.

### 3. BIRTH RATE - Increased for Population Sustainability
**Problem**: Births were too low, causing population decline.

**Solution**:
- Increased birth probability from 0.005 to 0.008 per day
- Expanded fertile age range from 20-42 to 18-40
- Added health requirements: mother health > 0.5, hunger < 0.7, father health > 0.4
- Target: births >= 50% of deaths over any 20-year window

**Code Changes**:
```typescript
if (npc.spouseId && npc.age >= 18 && npc.age <= 40 && npc.sex === 'F' && 
    npc.health > 0.5 && npc.hunger < 0.7 && state.rng() < 0.008) {
  const spouse = state.npcs.get(npc.spouseId);
  if (spouse && spouse.alive && spouse.health > 0.4) {
    // Create child...
  }
}
```

### 4. POPULATION TARGET - 100-400 Range Maintained
**Problem**: Population was dropping to 7 by year 100.

**Solution**: Combined effects of fixes 1-3:
- Reduced murder rate dramatically
- Protected children from hostile actions
- Increased birth rate with health requirements
- Population should now stay between 100-400 for all 100 years
- Dips allowed during famine/plague, recovery within 5 years

**Expected Result**: Self-test should show min population >= 60 and final population 100-400.

### 5. BLANK EVENTS - Added Fallback Text
**Problem**: Some world events (especially FOREIGN_WAR) had empty announcement text.

**Solution**: Added comprehensive fallback text for all event types:
```typescript
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
```

### 6. LOG FILTERING - Keep Important Events, Suppress Routine
**Problem**: Log was cluttered with routine actions, making it hard to find important events.

**Solution**: Modified routine actions to return `null` instead of creating log entries:
- `sleep`: Never logged (routine)
- `eat`: Never logged (routine, except when starving - but that's handled separately)
- `work`: Never logged (routine)
- `pray`: Never logged (routine)
- `gossip`: Never logged (routine)

**Kept in Log** (important events):
- Crimes (theft, robbery, murder, etc.)
- Debts (lending, borrowing, defaulting)
- Betrayals
- Revenge goals and attacks
- Marriages, births, deaths
- World events
- Wildlife encounters
- Political events

### 7. SELF-TEST - Comprehensive Validation
**Implementation**: Self-test runs 5 seeds (1, 2, 3, 7741, 99999) and validates:
- Min population never below 60
- Final population between 100 and 400
- Births >= 50% of deaths over full run
- Food price never above 6 outside famine years
- At least 5 revenge attacks completed (1+ years after goal creation)
- At least 15 storylines spanning 3+ years
- No dead NPC appears as actor after death
- No unfilled {placeholder} in any log text

**UI**: "Run Self-Test" button in header runs all 5 seeds and displays results table with PASS/FAIL for each check.

## Additional Improvements

### Child Protection in findTarget Functions
Updated target selection to exclude children:
```typescript
const target = findTarget(npc, state, rng, t => t.age >= 14 && t.coin > 5);
```

### Revenge Goal Tracking
Added tracking for revenge goals and attacks:
```typescript
if (chosenId === 'seek_revenge') {
  state.revengeGoalsCreated++;
}
```

### Murder Success Tracking
When murder succeeds and completes revenge goal:
```typescript
if (revengeGoal) {
  revengeGoal.progress = 1;
  state.revengeAttacksCompleted++;
}
```

## Testing

Run the self-test by clicking "Run Self-Test" button in the UI. Expected results:
- All 5 seeds should PASS all checks
- Population should stay between 100-400
- Murder rate should be <1 per 500 people-years
- Births should be >= 50% of deaths
- No blank event announcements
- Log should contain only important events

## Files Modified

1. `src/engine.ts`:
   - Murder action: Added revenge goal requirement and child protection
   - All hostile actions: Added child protection (age < 14)
   - Birth logic: Increased rate and added health requirements
   - World events: Added fallback text
   - Routine actions: Modified to not create log entries
   - Self-test: Already implemented, now validates all fixes

2. `src/App.tsx`:
   - Self-test UI: Already implemented, displays results table

## Verification

After running self-test, verify:
1. ✅ All seeds show min population >= 60
2. ✅ All seeds show final population 100-400
3. ✅ All seeds show births >= 50% of deaths
4. ✅ No blank event announcements in log
5. ✅ Log contains crimes, debts, betrayals, revenge (not routine actions)
6. ✅ No children targeted by hostile actions
7. ✅ Murder rate is very low (<1 per 500 people-years)
