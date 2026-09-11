# Interview Research Tracker

A **local, private** tool that researches any company you're interviewing with and
helps you prepare — grounded in real, source-verified web data, running on your
own Claude subscription with **no hosting cost and no API-key billing**.

> Nothing runs in the background. The dashboard queues work; an interactive Claude
> Code session does the research on your subscription. Everything lives on your
> machine.

## Features

**Research & tracking**
- Add a company by name or URL, with an optional **role** and **region/country**
  (India vs. US get different processes, news, and prep sources)
- Discovery → a grounded company brief: official pages, inferred interview format,
  trailing-6-month news/deals, and prep sources
- **No-dummy-data rule, enforced in code** — every fact must carry a real
  `source_url` + `fetched_at`, or it is rejected. No fabricated "recent news."
- Run Update, plus **Past & Predicted Questions** (reported vs. news-grounded,
  with a likelihood + rationale)

**Mock interview**
- Adaptive text interviewer grounded in the brief, with **voice mode**
  (browser TTS + push-to-talk STT, typing fallback)
- Client-side **delivery analytics** (filler words, pace/WPM) + trends
- Interviewer **persona**, **difficulty**, and **multi-round loop**
- Rubric scoring + STAR feedback; session history

**Personalization**
- Resume/JD ingestion → gap analysis → gap-probing questions
- Reusable **STAR story bank** with per-company competency coverage
- One-page **prep-pack** export (print / save as PDF)

**Ops & UX**
- Live **stage-by-stage progress** with toast + desktop notifications
- Estimated **token-usage** counter, kill switch, rate limiting
- Errors surfaced on the dashboard, never swallowed

## Run it

Requires **Python 3** (standard library only — no installs, no database).

```bash
cd app
python server.py
```

Then open <http://localhost:8756>. See [`app/PROCESSING_GUIDE.md`](app/PROCESSING_GUIDE.md)
for how the job queue is processed by an interactive Claude Code session.

## Architecture

```
Dashboard (HTML/JS) → local Python server → job queue (files)
                                                  │
                          Claude Code (interactive, your subscription)
                          reads jobs → web search + fetch → writes grounded data
                                                  │
                          Local JSON storage (one folder per company)
```

The server never calls an LLM or the internet itself — it stores data and serves
the page. All reasoning happens in an interactive Claude Code session.

## Docs
- [`interview_research_tracker_spec.md`](interview_research_tracker_spec.md) — full requirements & design
- [`BUILD_ROADMAP.md`](BUILD_ROADMAP.md) — phased build plan
- [`COMPETITOR_ANALYSIS.md`](COMPETITOR_ANALYSIS.md) — market comparison

## Privacy
Your research and interview transcripts live in `app/data/`, which is
**git-ignored** — it never leaves your machine.
