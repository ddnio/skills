/**
 * Create a decision envelope. Only called when a Route is triggered.
 * Skipped turns (Gate says no) do not produce envelopes.
 */
export function createEnvelope({ turn, level, rule, route, evidence, conclusion, confidence, unverified }) {
  return {
    turn,
    level,
    rule,
    triggered: true,
    route,
    evidence,
    conclusion,
    ...(confidence && { confidence }),
    unverified: unverified || [],
  };
}
