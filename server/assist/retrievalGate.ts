export type DocsRetrievalMode = "auto" | "always" | "off";

// Direct references to uploaded material
const DOC_REFERENCE_RE = /\b(resume|cv|document|docs|notes|note|profile|screen|as per (the )?document|based on (our|your) notes|from (my|your) resume)\b/i;

// Questions needing specific facts/metrics from resume or notes
const FACT_HEAVY_RE = /\b(exact|specifically|metric|metrics|percentage|percent|%|date|year|timeline|project name|company|client|employer|achievement|numbers|figures)\b/i;

// Resume/background retrieval triggers
const RESUME_STYLE_RE = /\b(tell me about your experience with|experience with|have you worked with|have you used|what projects?.*with|where did you work on|tell me about yourself|introduce yourself|walk me through your background|your background|professional background|career summary|profile)\b/i;

// Behavioral questions — MUST retrieve STAR stories and personal context
const BEHAVIORAL_RE = /\b(tell me about (a time|yourself|your)|describe (a|an|your)|walk me through (a|your)|give me an example|strength|weakness|challenge|conflict|leadership|difficult situation|proudest|biggest achievement|impact you|situation where|project you|cross.functional|stakeholder|tight deadline|failure|mistake|accomplishment|initiative you)\b/i;

// Experience and background questions — need resume/work history
const EXPERIENCE_RE = /\b(your experience|how long|years of|background in|background with|have you (worked|built|designed|led|managed|implemented|deployed|used|handled|architected))\b/i;

// Company-specific intent — need company notes if uploaded
const COMPANY_RE = /\b(why (do you want|this company|us|here|join)|what (attracts|drew|interests) you|why (apply|applied)|excited about (this|the) (role|company|team|position))\b/i;

// Pure theory — never needs personal context
const PURE_THEORY_RE = /\b(what is|what's|how does|difference between|compare|define|algorithm|big ?o|time complexity)\b/i;

const SHORT_FOLLOW_UP_RE = /^(why|how|which one|how so|what now)\??$/i;

export function shouldRetrieveDocs(questionSpan: string, mode: DocsRetrievalMode = "auto"): boolean {
  if (mode === "always") return true;
  if (mode === "off") return false;

  const q = String(questionSpan || "").trim();
  if (!q) return false;
  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  if (words.length <= 3 && SHORT_FOLLOW_UP_RE.test(lower)) return false;

  // Hard retrieval triggers
  if (DOC_REFERENCE_RE.test(lower)) return true;
  if (FACT_HEAVY_RE.test(lower)) return true;
  if (RESUME_STYLE_RE.test(lower)) return true;
  if (BEHAVIORAL_RE.test(lower)) return true;   // STAR stories
  if (EXPERIENCE_RE.test(lower)) return true;   // resume/work history
  if (COMPANY_RE.test(lower)) return true;      // company notes

  // Pure theory — no personal grounding needed
  if (PURE_THEORY_RE.test(lower)) return false;

  return false;
}
