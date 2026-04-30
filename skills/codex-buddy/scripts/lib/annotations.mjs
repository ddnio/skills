/**
 * annotations.mjs — single source of truth for buddy probe annotation policy.
 *
 * Annotation = post-hoc metadata Claude attaches to a verification probe after
 * synthesis. Examples: did the probe surface anything new? Did the user adopt
 * the suggestion?
 *
 * Producer: buddy-runtime.mjs:actionAnnotate (writes annotate events to session-log)
 * Consumer: lib/metrics.mjs (reads + merges annotate events into probe rates)
 *
 * Both sides MUST refer to ANNOTATION_FIELDS here, never hard-code their own list.
 *
 * Design (CloudEvents/OTel semantic-convention style): metric attribute names
 * are stable convention; arbitrary session-log payload fields are NOT metrics.
 */

export const ANNOTATION_FIELDS = Object.freeze(['probe_found_new', 'user_adopted']);

// CLI flag → annotation field name. Add new fields here and ANNOTATION_FIELDS together.
export const ANNOTATION_FLAG_MAP = Object.freeze({
  'probe-found-new': 'probe_found_new',
  'user-adopted':    'user_adopted',
});

/**
 * Parse CLI args into an annotation field bag.
 * Only known flags become fields; unknown flags are ignored (caller decides if that's an error).
 * Returns: { fields: { probe_found_new?: bool, user_adopted?: bool }, unknown: string[] }
 */
export function parseAnnotationFlags(args) {
  const fields = {};
  const unknown = [];
  for (const [flag, fieldName] of Object.entries(ANNOTATION_FLAG_MAP)) {
    if (args[flag] !== undefined) {
      fields[fieldName] = args[flag] === 'true';
    }
  }
  return { fields, unknown };
}

/**
 * Merge a new annotate event into a per-task accumulator.
 * Later events override the SAME field; never erase fields they didn't touch.
 * Returns the merged object (mutated in place if provided).
 */
export function mergeAnnotation(accum, event) {
  const out = accum || {};
  for (const f of ANNOTATION_FIELDS) {
    if (event[f] !== undefined) out[f] = event[f];
  }
  return out;
}
