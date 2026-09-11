# How to process the job queue (read this)

The dashboard **never** calls an LLM or the internet itself. When you click
"Add company", "Run Update", "Start interview", or "Send answer", the server
drops a small job file into `data/jobs/pending/`. The actual thinking is done by
**Claude Code — this interactive session, on your subscription.** That is what
keeps it free, private, and honest about "no unattended execution": nothing
happens until you ask Claude to process the queue.

## The loop, in practice

1. Start the dashboard:
   ```bash
   python app/server.py
   ```
   Open http://localhost:8756

2. Do something on the dashboard (add a company, start an interview, send an
   answer). A job appears in the "Job queue" box.

3. In your Claude Code session, say:

   > Process the interview-tracker job queue.

   Claude will:
   - list `data/jobs/pending/`,
   - for each job, follow `prompts/discovery.md` (for `discover`/`update`) or
     `prompts/interview.md` (for `interview_turn`/`feedback`),
   - write results with the storage helpers,
   - move the job file to `data/jobs/done/`.

4. The dashboard polls every few seconds and updates on its own — the brief
   fills in, or the interviewer's next question appears.

## During a live interview

Each answer you send creates one `interview_turn` job. So the rhythm is:
answer in the browser → ask Claude "process the queue" → the next question
appears → repeat. To make an interview feel continuous, tell Claude:

> Watch the interview-tracker queue and process interview_turn jobs as they
> arrive until I end the session.

Claude then keeps processing new turns as you send them (this is still
"attended" — you started it, it's your interactive session). End the session
from the browser to get feedback.

## Jobs
| type | prompt | writes |
|------|--------|--------|
| `discover` | discovery.md | `companies/<slug>/brief.json` |
| `update` | discovery.md | appends new items to `brief.json` |
| `interview_turn` | interview.md | appends interviewer turn to the session |
| `feedback` | interview.md | writes rubric feedback, ends session |

## Guardrails (do not skip)
- No item saved without a real `source_url` + `fetched_at`.
- Only fetch URLs found via search for this company this run; respect robots.txt.
- No login-walled scraping.
- Log every failure to `data/errors.log` (shown as a red bar on the dashboard).
