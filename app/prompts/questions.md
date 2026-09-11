# Past & Predicted Questions Prompt (jobs: `questions`, `predict`)

Writes `data/companies/<slug>/questions.json`, grouped by round type. Same hard
rules as discovery: **no dummy data** — anything reported as a real, previously
asked question must carry a real `source_url` you fetched this run; anything you
generate is clearly labeled as generated. Public, search-visible content only;
no login-walled scraping (NFR-4a).

## questions.json schema
```json
{
  "updated_at": "2026-08-31T...",
  "rounds": {
    "case":       [ { "question": "...", "type": "reported|generated",
                      "source": "Glassdoor (search snippet)",
                      "source_url": "https://...", "fetched_at": "...",
                      "likelihood": "high|medium|low",
                      "rationale": "why this is likely (for generated/predicted)" } ],
    "behavioral": [ ... ],
    "hr_fit":     [ ... ],
    "technical":  [ ... ]
  }
}
```

## Job: `questions`  (discover REPORTED past questions)
1. Search public interview-experience content for `<company> <role> interview
   questions` (Glassdoor, AmbitionBox, public Reddit/LinkedIn threads) — via
   search results only. Fetch the pages you're allowed to.
2. Extract genuinely reported questions. Each becomes a `type: "reported"` entry
   with its `source`, `source_url`, `fetched_at`. Group by round type.
3. Drop thin/duplicate items (a one-liner with no round type, or a near-duplicate
   of one already stored). Append, don't duplicate, on re-runs.
4. If a platform blocks unauthenticated access, skip it and `log_error`.

## Job: `predict`  (GENERATE likely questions, grounded in the brief)
1. Load `brief.json`. Using `interview_format` + the trailing-6-month
   `recent_items`, generate on-theme questions a real interviewer might ask.
2. Each is `type: "generated"` with a `likelihood` and a `rationale` that ties to
   a REAL brief item (cite its `source_url` in `source_url`). Example:
   likelihood "high", rationale "They acquired X last quarter — integration risk
   is a natural probe", source_url = that news item's URL.
3. Merge into the same `rounds` structure. Keep reported + generated distinct via
   the `type` field so the UI can label them honestly.

Finish: write `questions.json` atomically, move the job to `jobs/done/`.
