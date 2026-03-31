/**
 * Floor Rules engine. Checks text content against 3 floor rules.
 * Returns { triggered: boolean, rule: string|null, match: string|null }
 *
 * Rule 1: Destructive/irreversible operations
 * Rule 2: Approval moments (user asking for confirmation)
 * Rule 3: Unverified correctness claims (claiming success without evidence)
 */

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bdeploy\s+(to|--)\b/i,          // S5: require "deploy to" or "deploy --", not bare "deploy"
  /\bALTER\s+TABLE\b/i,
  // I6: CREATE TABLE removed — additive, not destructive per spec §3.2
  /\bchmod\s+[0-7]{3,4}\b/i,
  /\bchown\b/i,
  /\bmigrat(e|ion)\b/i,
];

const APPROVAL_PATTERNS = [
  /能.{0,10}吗[？?]/,
  /可以.{0,10}吗[？?]/,
  /\bsafe\b.*[?？]/i,               // I5: require question mark context
  /确认.{0,10}[？?]/,
  /\bconfirm\b/i,
  /是否可以/,
  /行不行/,
];

const CORRECTNESS_PATTERNS = [
  /测试会过/,
  /没有副作用/,
  /bug\s*已修复/i,
  /refactor.*安全/i,
  /tests?\s+(will|should)\s+pass/i,
  /no\s+side\s+effects?/i,
  /bug\s+(is\s+)?fixed/i,
  /safe\s+to\s+refactor/i,
];

export function checkFloorRules(text, context = {}) {
  // Rule 2: approval moments (checked first — questions about destructive ops are approvals)
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(text)) {
      return { triggered: true, rule: 'floor:approval', match: text.match(pattern)[0] };
    }
  }

  // Rule 1: destructive operations
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { triggered: true, rule: 'floor:destructive', match: text.match(pattern)[0] };
    }
  }

  // Rule 3: correctness claims without evidence
  if (!context.ranTestsThisTurn) {
    for (const pattern of CORRECTNESS_PATTERNS) {
      if (pattern.test(text)) {
        return { triggered: true, rule: 'floor:correctness', match: text.match(pattern)[0] };
      }
    }
  }

  return { triggered: false, rule: null, match: null };
}
