// TrenchBench — Empirical Bayes Shrinkage & Benchmark Scoring Module
// Computes Bayesian ratings for LLMs with small session counts (N < 10)
// to prevent small-sample distortion on benchmark leaderboards.

export function calculateBayesianRating(obsReturn, sessionCount, globalMean = -3.0, K = 5) {
  if (!sessionCount || sessionCount <= 0) return globalMean;
  return (sessionCount * obsReturn + K * globalMean) / (sessionCount + K);
}

export function getSampleConfidence(sessionCount, targetSessions = 10) {
  if (!sessionCount || sessionCount <= 0) return { pct: 0, badge: 'UNSETTLED', label: 'Low Sample' };
  const pct = Math.min(100, Math.round((sessionCount / targetSessions) * 100));
  const badge = sessionCount >= targetSessions ? 'VERIFIED' : sessionCount >= 5 ? 'PROVISIONAL' : 'UNSETTLED';
  return { pct, badge, label: `${sessionCount} sessions (${pct}%)` };
}

export function rankModelsBayesian(modelStatsList, globalMean = -3.0, K = 5) {
  return modelStatsList.map(m => {
    const sessions = m.sessionsCount || m.sessions || m.sessionCount || 0;
    const obsReturn = typeof m.avgReturnPct === 'number' ? m.avgReturnPct : (typeof m.avgReturn === 'number' ? m.avgReturn : 0);
    const bayesRating = calculateBayesianRating(obsReturn, sessions, globalMean, K);
    const confidence = getSampleConfidence(sessions);
    return {
      ...m,
      bayesRating: parseFloat(bayesRating.toFixed(2)),
      obsReturn: parseFloat(obsReturn.toFixed(2)),
      confidence
    };
  }).sort((a, b) => b.bayesRating - a.bayesRating);
}
