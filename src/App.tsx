import { useState, useRef, useCallback, useEffect } from 'react';
import {
  runSimulation, stepSimulation, initSimulation, generateTopStories,
  healthCheck, exportLog, exportStories, coverageReport, deriveCapabilities,
  type SimulationState, type LogEntry, type TopStory, type HealthFlag
} from './engine';
import { ELEMENTS } from './data';

type Tab = 'log' | 'stories' | 'stats' | 'health' | 'trace' | 'coverage';

function App() {
  const [seed, setSeed] = useState(42);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<SimulationState | null>(null);
  const [tab, setTab] = useState<Tab>('log');
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [filterNpc, setFilterNpc] = useState<string>('');
  const [topStories, setTopStories] = useState<TopStory[]>([]);
  const [healthFlags, setHealthFlags] = useState<HealthFlag[]>([]);
  const [speed, setSpeed] = useState(100);
  const logRef = useRef<HTMLDivElement>(null);

  const handleRun = useCallback(() => {
    setRunning(true);
    setProgress(0);
    
    // Run in chunks to allow UI updates
    const simState = initSimulation(seed);
    const totalTicks = 100 * 360;
    const chunkSize = 3600; // 10 years per chunk
    
    let currentTick = 0;
    
    const runChunk = () => {
      const endTick = Math.min(currentTick + chunkSize, totalTicks);
      while (simState.tick < endTick) {
        stepSimulation(simState);
      }
      currentTick = endTick;
      setProgress(Math.floor((currentTick / totalTicks) * 100));
      
      if (currentTick < totalTicks) {
        setTimeout(runChunk, 0);
      } else {
        setState(simState);
        setTopStories(generateTopStories(simState, 20));
        setHealthFlags(healthCheck(simState));
        setRunning(false);
        setProgress(100);
      }
    };
    
    setTimeout(runChunk, 0);
  }, [seed]);

  const handleFastRun = useCallback(() => {
    setRunning(true);
    setProgress(0);
    
    setTimeout(() => {
      const simState = runSimulation(seed, 100);
      setState(simState);
      setTopStories(generateTopStories(simState, 20));
      setHealthFlags(healthCheck(simState));
      setRunning(false);
      setProgress(100);
    }, 50);
  }, [seed]);

  const filteredLog = state?.log.filter(entry => {
    if (filterYear && entry.year !== filterYear) return false;
    if (filterType && entry.type !== filterType) return false;
    if (filterNpc) {
      const npc = state.npcs.get(parseInt(filterNpc));
      if (npc && !entry.text.includes(npc.name)) return false;
    }
    return true;
  }) || [];

  const displayLog = filteredLog.slice(-500); // Show last 500 entries for performance

  const actionTypes = state ? [...new Set(state.log.map(e => e.type))] : [];
  const years = state ? [...new Set(state.log.map(e => e.year))].sort((a, b) => a - b) : [];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-xl font-bold text-amber-400">⚔️ Settlement Simulation</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-gray-400">Seed:</label>
            <input
              type="number"
              value={seed}
              onChange={e => setSeed(parseInt(e.target.value) || 0)}
              className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
              disabled={running}
            />
            <label className="text-sm text-gray-400">Speed:</label>
            <input
              type="range"
              min="10"
              max="100"
              value={speed}
              onChange={e => setSpeed(parseInt(e.target.value))}
              className="w-20"
            />
            <button
              onClick={handleFastRun}
              disabled={running}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors"
            >
              {running ? `Running... ${progress}%` : 'Run 100 Years'}
            </button>
            {state && (
              <>
                <button
                  onClick={() => {
                    const blob = new Blob([exportLog(state)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'simulation_log.json'; a.click();
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm"
                >
                  Export Log
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([exportStories(topStories)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'top_stories.json'; a.click();
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm"
                >
                  Export Stories
                </button>
              </>
            )}
          </div>
        </div>
        {running && (
          <div className="max-w-7xl mx-auto mt-2">
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}
      </header>

      {/* Summary bar */}
      {state && (
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
          <div className="max-w-7xl mx-auto flex gap-6 text-sm flex-wrap">
            <span className="text-gray-400">Population: <span className="text-white font-medium">{state.stats.populationByYear[state.stats.populationByYear.length - 1] || 0}</span></span>
            <span className="text-gray-400">Avg Coin: <span className="text-white font-medium">{(state.stats.avgCoinByYear[state.stats.avgCoinByYear.length - 1] || 0).toFixed(1)}</span></span>
            <span className="text-gray-400">Gini: <span className="text-white font-medium">{(state.stats.giniByYear[state.stats.giniByYear.length - 1] || 0).toFixed(2)}</span></span>
            <span className="text-gray-400">Food Price: <span className="text-white font-medium">{state.economy.prices.food.toFixed(2)}</span></span>
            <span className="text-gray-400">Log Entries: <span className="text-white font-medium">{state.log.length}</span></span>
            <span className="text-gray-400">World Events: <span className="text-white font-medium">{state.worldEvents.length}</span></span>
            <span className="text-gray-400">Story Hooks: <span className="text-white font-medium">{state.storyHooks.length}</span></span>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full">
        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {(['log', 'stories', 'stats', 'health', 'trace', 'coverage'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t ? 'text-amber-400 border-b-2 border-amber-400' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t === 'log' ? '📜 Event Log' : t === 'stories' ? '📖 Top Stories' : t === 'stats' ? '📊 Statistics' : t === 'health' ? '🏥 Health Check' : t === 'trace' ? '🔍 Causal Trace' : '📋 Coverage'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 p-4 overflow-auto">
          {!state && !running && (
            <div className="text-center py-20 text-gray-500">
              <p className="text-4xl mb-4">⚔️</p>
              <p className="text-lg">Set the seed and click "Run 100 Years" to begin the simulation.</p>
              <p className="text-sm mt-2">150 NPCs, 4 districts, 100 years of emergent stories.</p>
            </div>
          )}

          {tab === 'log' && state && (
            <div className="flex flex-col h-full">
              {/* Filters */}
              <div className="flex gap-3 mb-3 flex-wrap">
                <select
                  value={filterYear || ''}
                  onChange={e => setFilterYear(e.target.value ? parseInt(e.target.value) : null)}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                >
                  <option value="">All Years</option>
                  {years.map(y => <option key={y} value={y}>Year {y}</option>)}
                </select>
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                >
                  <option value="">All Types</option>
                  {actionTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  placeholder="NPC name..."
                  value={filterNpc}
                  onChange={e => setFilterNpc(e.target.value)}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm w-32"
                />
                <span className="text-gray-500 text-sm self-center">{filteredLog.length} entries</span>
              </div>
              
              {/* Log entries */}
              <div ref={logRef} className="flex-1 overflow-auto bg-gray-800 rounded border border-gray-700 p-3 font-mono text-xs space-y-1">
                {displayLog.map(entry => (
                  <div
                    key={entry.id}
                    onClick={() => { setSelectedEntry(entry); setTab('trace'); }}
                    className={`p-1.5 rounded cursor-pointer hover:bg-gray-700 transition-colors ${
                      entry.type === 'death' ? 'text-red-400' :
                      entry.type === 'murder' ? 'text-red-500' :
                      entry.type === 'marry' ? 'text-pink-400' :
                      entry.type === 'world_event' ? 'text-amber-400' :
                      entry.tags.includes('crime') ? 'text-orange-400' :
                      'text-gray-300'
                    }`}
                  >
                    <span className="text-gray-500">[Y{entry.year} D{entry.day}]</span>{' '}
                    <span className="text-gray-400">({entry.type})</span>{' '}
                    {entry.text}
                    {entry.salience > 0.5 && <span className="text-yellow-500 ml-1">★</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'stories' && state && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-amber-400">Top 20 Stories</h2>
              <p className="text-gray-400 text-sm">Ranked by salience: stakes, chain length, witnesses, relationship changes, deaths, rare events.</p>
              {topStories.map(story => (
                <div key={story.rank} className="bg-gray-800 rounded border border-gray-700 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-amber-600 text-white text-xs px-2 py-0.5 rounded font-bold">#{story.rank}</span>
                    <h3 className="font-medium text-amber-300">{story.title}</h3>
                    <span className="text-gray-500 text-xs ml-auto">Salience: {story.salience.toFixed(2)}</span>
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed">{story.paragraph}</p>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {story.entries.slice(0, 3).map(e => (
                      <span
                        key={e.id}
                        onClick={() => { setSelectedEntry(e); setTab('trace'); }}
                        className="text-xs bg-gray-700 px-2 py-0.5 rounded cursor-pointer hover:bg-gray-600"
                      >
                        Y{e.year}: {e.type}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              
              {/* Story hooks */}
              <h2 className="text-lg font-bold text-amber-400 mt-8">Story Hooks ({state.storyHooks.length})</h2>
              <div className="space-y-2 max-h-96 overflow-auto">
                {state.storyHooks.slice(0, 30).map(hook => (
                  <div key={hook.id} className={`bg-gray-800 rounded border p-3 ${hook.resolved ? 'border-green-800' : 'border-gray-700'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${hook.resolved ? 'bg-green-800' : 'bg-amber-800'}`}>
                        {hook.resolved ? 'Resolved' : 'Active'}
                      </span>
                      <span className="font-medium text-sm">{hook.title}</span>
                      <span className="text-gray-500 text-xs ml-auto">Tension: {hook.tension.toFixed(2)}</span>
                    </div>
                    <p className="text-gray-400 text-xs mt-1">{hook.description}</p>
                    {hook.outcome && <p className="text-green-400 text-xs mt-1">→ {hook.outcome}</p>}
                    <div className="text-gray-500 text-xs mt-1">Pattern: {hook.pattern} | Approaches: {hook.approaches.join(', ')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'stats' && state && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-amber-400">Statistics Over 100 Years</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StatChart
                  title="Population"
                  data={state.stats.populationByYear}
                  color="#f59e0b"
                />
                <StatChart
                  title="Average Coin"
                  data={state.stats.avgCoinByYear}
                  color="#3b82f6"
                />
                <StatChart
                  title="Inequality (Gini)"
                  data={state.stats.giniByYear}
                  color="#ef4444"
                />
                <StatChart
                  title="Crime Rate"
                  data={state.stats.crimeRateByYear}
                  color="#8b5cf6"
                />
                <StatChart
                  title="Food Price Index"
                  data={state.stats.foodPriceByYear}
                  color="#10b981"
                />
                <div className="bg-gray-800 rounded border border-gray-700 p-4">
                  <h3 className="font-medium text-amber-300 mb-3">Faction Power</h3>
                  {Object.entries(state.factionPower).map(([faction, power]) => (
                    <div key={faction} className="flex items-center gap-2 mb-2">
                      <span className="text-sm text-gray-400 w-40">{faction}</span>
                      <div className="flex-1 bg-gray-700 rounded-full h-3">
                        <div
                          className="h-3 rounded-full bg-amber-500"
                          style={{ width: `${power * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-xs text-gray-500 w-12">{(power * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'health' && state && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-amber-400">Health Check</h2>
              <div className="space-y-2">
                {healthFlags.map((flag, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded border ${
                      flag.type === 'critical' ? 'bg-red-900/30 border-red-700 text-red-300' :
                      flag.type === 'warning' ? 'bg-amber-900/30 border-amber-700 text-amber-300' :
                      'bg-blue-900/30 border-blue-700 text-blue-300'
                    }`}
                  >
                    <span className="font-medium">
                      {flag.type === 'critical' ? '🔴' : flag.type === 'warning' ? '🟡' : '🔵'}{' '}
                      {flag.message}
                    </span>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 bg-gray-800 rounded border border-gray-700 p-4">
                <h3 className="font-medium text-amber-300 mb-3">Action Distribution</h3>
                <div className="space-y-1">
                  {(() => {
                    const counts: Record<string, number> = {};
                    state.log.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
                    const total = state.log.length;
                    return Object.entries(counts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <div key={type} className="flex items-center gap-2">
                          <span className="text-sm text-gray-400 w-32">{type}</span>
                          <div className="flex-1 bg-gray-700 rounded-full h-2">
                            <div
                              className="h-2 rounded-full bg-blue-500"
                              style={{ width: `${(count / total) * 100}%` }}
                            ></div>
                          </div>
                          <span className="text-xs text-gray-500 w-20">{count} ({(count / total * 100).toFixed(1)}%)</span>
                        </div>
                      ));
                  })()}
                </div>
              </div>
            </div>
          )}

          {tab === 'trace' && state && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-amber-400">Causal Trace</h2>
              {selectedEntry ? (
                <div className="bg-gray-800 rounded border border-gray-700 p-4">
                  <div className="mb-4">
                    <h3 className="text-amber-300 font-medium">{selectedEntry.text}</h3>
                    <p className="text-gray-500 text-sm mt-1">Year {selectedEntry.year}, Day {selectedEntry.day}, {selectedEntry.season}</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-2">Decision Details</h4>
                      <div className="bg-gray-900 rounded p-3 text-xs font-mono space-y-1">
                        <p>Action: <span className="text-amber-400">{selectedEntry.causalTrace.chosenAction}</span></p>
                        <p>Success: <span className={selectedEntry.causalTrace.success ? 'text-green-400' : 'text-red-400'}>{selectedEntry.causalTrace.success ? 'YES' : 'NO'}</span></p>
                        <p>Dice Roll: <span className="text-blue-400">{selectedEntry.causalTrace.diceRoll.toFixed(3)}</span></p>
                        <p>Threshold: <span className="text-purple-400">{selectedEntry.causalTrace.threshold.toFixed(3)}</span></p>
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-2">Top Alternatives</h4>
                      <div className="bg-gray-900 rounded p-3 text-xs font-mono space-y-1">
                        {selectedEntry.causalTrace.topAlternatives.map((alt, i) => (
                          <p key={i}>
                            <span className="text-gray-500">{i + 1}.</span>{' '}
                            <span className="text-gray-300">{alt.action}</span>{' '}
                            <span className="text-blue-400">({alt.score.toFixed(3)})</span>
                          </p>
                        ))}
                        {selectedEntry.causalTrace.topAlternatives.length === 0 && (
                          <p className="text-gray-500">No alternatives scored</p>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-2">Pressures</h4>
                      <div className="bg-gray-900 rounded p-3 text-xs font-mono space-y-1">
                        {Object.entries(selectedEntry.causalTrace.pressures).map(([key, val]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-gray-400 w-24">{key}</span>
                            <div className="flex-1 bg-gray-700 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${val > 0.7 ? 'bg-red-500' : val > 0.4 ? 'bg-amber-500' : 'bg-green-500'}`}
                                style={{ width: `${val * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-gray-500 w-10">{val.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-2">Modifiers</h4>
                      <div className="bg-gray-900 rounded p-3 text-xs font-mono space-y-1">
                        {Object.entries(selectedEntry.causalTrace.modifiers).map(([key, val]) => (
                          <p key={key}>
                            <span className="text-gray-400">{key}:</span>{' '}
                            <span className="text-gray-300">{typeof val === 'number' ? val.toFixed(2) : val}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-400 mb-2">NPCs Involved</h4>
                    <div className="flex gap-2 flex-wrap">
                      {selectedEntry.npcIds.map(id => {
                        const npc = state.npcs.get(id);
                        return npc ? (
                          <span key={id} className="bg-gray-700 px-2 py-1 rounded text-xs">
                            {npc.name} (#{id}) {npc.alive ? '🟢' : '💀'}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">Click any event in the log to see its causal trace.</p>
              )}
            </div>
          )}

          {tab === 'coverage' && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-amber-400">Element Coverage Report</h2>
              {(() => {
                const report = coverageReport();
                return (
                  <div className="bg-gray-800 rounded border border-gray-700 p-4">
                    <div className="flex gap-6 mb-4">
                      <span className="text-gray-400">Total Elements: <span className="text-white font-medium">{report.total}</span></span>
                      <span className="text-gray-400">Referenced: <span className="text-green-400 font-medium">{report.referenced}</span></span>
                      <span className="text-gray-400">Unreferenced: <span className="text-amber-400 font-medium">{report.unreferenced.length}</span></span>
                    </div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Unreferenced Elements:</h3>
                    <div className="flex flex-wrap gap-1 max-h-64 overflow-auto">
                      {report.unreferenced.map(id => (
                        <span key={id} className="bg-gray-700 px-2 py-0.5 rounded text-xs text-gray-400">{id}</span>
                      ))}
                    </div>
                    
                    <h3 className="text-sm font-medium text-gray-400 mt-4 mb-2">Capability Derivation Test:</h3>
                    <div className="bg-gray-900 rounded p-3 text-xs font-mono space-y-2">
                      <p className="text-gray-400">// Test 1: Flight capability from mass + wing_area</p>
                      <p>Massive body + small wings → flight: <span className="text-amber-400">{deriveCapabilities(['body_massive', 'limb_wing_small']).flight.toFixed(2)}</span></p>
                      <p>Small body + large wings → flight: <span className="text-green-400">{deriveCapabilities(['body_small', 'limb_wing_large']).flight.toFixed(2)}</span></p>
                      <p>Massive body + small wings → wing_display: <span className="text-blue-400">{deriveCapabilities(['body_massive', 'limb_wing_small']).wing_display.toFixed(2)}</span> (&gt;0)</p>
                      <p className="text-gray-400 mt-2">// Test 2: Bite + venom → poison attack</p>
                      <p>Fang + no venom → physical only: <span className="text-amber-400">{deriveCapabilities(['fang']).bite_poison.toFixed(2)}</span> (should be 0)</p>
                      <p>Fang + venom_gland + delivery → poison: <span className="text-green-400">{deriveCapabilities(['fang', 'venom_gland', 'venom_delivery_fang']).bite_poison.toFixed(2)}</span></p>
                      <p>Fang + venom_gland (no delivery) → partial: <span className="text-blue-400">{deriveCapabilities(['fang', 'venom_gland']).bite_poison.toFixed(2)}</span></p>
                    </div>
                  </div>
                );
              })()}
              
              <div className="bg-gray-800 rounded border border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Element Domains:</h3>
                <div className="space-y-1">
                  {(() => {
                    const domains: Record<string, number> = {};
                    ELEMENTS.forEach(e => { domains[e.domain] = (domains[e.domain] || 0) + 1; });
                    return Object.entries(domains).map(([domain, count]) => (
                      <div key={domain} className="flex items-center gap-2">
                        <span className="text-sm text-gray-400 w-48">{domain}</span>
                        <div className="flex-1 bg-gray-700 rounded-full h-2">
                          <div className="h-2 rounded-full bg-purple-500" style={{ width: `${(count / 60) * 100}%` }}></div>
                        </div>
                        <span className="text-xs text-gray-500 w-8">{count}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple canvas chart component
function StatChart({ title, data, color }: { title: string; data: number[]; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const w = canvas.width;
    const h = canvas.height;
    const padding = 30;
    
    ctx.clearRect(0, 0, w, h);
    
    // Background
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, w, h);
    
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    
    // Grid lines
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (h - padding * 2) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
      
      // Labels
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px monospace';
      const val = max - (range * i / 4);
      ctx.fillText(val.toFixed(1), 2, y + 3);
    }
    
    // Data line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    for (let i = 0; i < data.length; i++) {
      const x = padding + (w - padding * 2) * (i / Math.max(1, data.length - 1));
      const y = padding + (h - padding * 2) * (1 - (data[i] - min) / range);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Fill under curve
    ctx.lineTo(padding + (w - padding * 2), h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.closePath();
    ctx.fillStyle = color + '20';
    ctx.fill();
    
    // Title
    ctx.fillStyle = '#d1d5db';
    ctx.font = '11px sans-serif';
    ctx.fillText(title, padding, 15);
    
  }, [data, color, title]);
  
  return (
    <div className="bg-gray-800 rounded border border-gray-700 p-2">
      <canvas ref={canvasRef} width={350} height={180} className="w-full rounded" />
    </div>
  );
}

export default App;
