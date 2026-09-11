# Resume / JD Gap Analysis Prompt (job: `resume_gap`)

Reads `data/companies/<slug>/resume.json` (`resume_text`, `jd_text`) and the
company `brief.json`, then writes a gap analysis back into `resume.json` under
`gap_analysis`.

This drives FR-14: generate questions that probe the candidate's weak or
under-evidenced areas, so the mock interview targets real gaps.

## Steps
1. Compare the resume against the job description and the role's likely
   competencies (from the brief, if present).
2. Identify: (a) required skills/competencies in the JD that are absent or thin
   in the resume; (b) claims in the resume with no supporting evidence/metrics;
   (c) strengths worth leaning into.
3. Produce 4–8 **gap-probing questions** an interviewer would ask to test the
   weak areas.

## Write into resume.json -> gap_analysis
```json
"gap_analysis": {
  "generated_at": "2026-08-31T...",
  "missing_from_resume": ["stakeholder management at scale", "SQL"],
  "unevidenced_claims": ["'led a team' — no size/outcome given"],
  "strengths": ["quantified impact in 2 roles"],
  "gap_questions": [
    { "question": "The role needs SQL-heavy analysis — walk me through the most
                    complex query work you've done.",
      "targets": "SQL (absent from resume)" }
  ]
}
```
Do NOT invent resume content. Base everything on the provided text. Move the job
to `jobs/done/` when finished.

## Note for the interviewer (`interview_turn`)
When a session's `config.use_gap` is true and `gap_analysis.gap_questions` exist,
weave those questions into the interview so it targets the candidate's real gaps.
