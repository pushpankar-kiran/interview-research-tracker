# Contributing

Thanks for your interest! This is a personal project, but contributions and
suggestions are welcome.

## Getting started

Requires **Python 3.9+** (standard library only — no dependencies to install).

```bash
git clone https://github.com/pushpankar-kiran/interview-research-tracker.git
cd interview-research-tracker/app
python server.py
```

Open <http://localhost:8756>. See [`app/PROCESSING_GUIDE.md`](app/PROCESSING_GUIDE.md)
for how the job queue is processed.

## Project layout

```
app/
├── server.py            # local HTTP server (stdlib only)
├── lib/storage.py       # JSON storage, validation, path-safety
├── web/                 # dashboard (HTML/CSS/vanilla JS)
├── prompts/             # instructions Claude follows per job type
└── data/                # local user data (git-ignored)
```

## Guidelines

- **No external dependencies.** Keep it standard-library only.
- **No secrets.** Never commit tokens, keys, or anything from `app/data/`.
- **Keep the no-dummy-data rule.** Any stored research fact must carry a real
  `source_url` + `fetched_at`; `storage.validate_brief()` enforces this.
- **Localhost only.** Don't change the bind address without adding auth.
- Match the existing style; keep the UI dependency-free.

## Pull requests

1. Fork and create a feature branch.
2. Keep changes focused; describe what and why.
3. Make sure `python -c "import ast; ast.parse(open('app/server.py').read())"`
   passes and the app still boots.
