"""
Storage layer for the Interview Research Tracker (Iteration 1).

Plain JSON files, one folder per company. No database, no installs.
All writes are atomic (temp file + os.replace) so a crash mid-write
never corrupts a file.

Enforces the no-dummy-data rule: any research item claiming to be a
fact about the company MUST carry a `source_url` and `fetched_at`, or
it is rejected before it can be saved.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import datetime as _dt
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent          # .../app
DATA = ROOT / "data"
COMPANIES = DATA / "companies"
JOBS_PENDING = DATA / "jobs" / "pending"
JOBS_DONE = DATA / "jobs" / "done"
JOBS_CANCELLED = DATA / "jobs" / "cancelled"
STORY_BANK = DATA / "story_bank.json"          # global, reusable across companies
ERRORS_LOG = DATA / "errors.log"

for _p in (COMPANIES, JOBS_PENDING, JOBS_DONE, JOBS_CANCELLED):
    _p.mkdir(parents=True, exist_ok=True)


# Filler words counted by the client-side delivery analytics (It.3). Kept here
# too so the server/prep-pack can reason about them consistently.
FILLER_WORDS = ["um", "uh", "er", "ah", "like", "you know", "basically",
                "actually", "literally", "sort of", "kind of", "i mean",
                "so yeah", "right"]


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(name: str) -> str:
    """Turn a company name or URL into a safe folder slug."""
    name = name.strip().lower()
    # strip protocol / www / trailing path if a URL was pasted
    name = re.sub(r"^https?://", "", name)
    name = re.sub(r"^www\.", "", name)
    name = name.split("/")[0]          # drop any path
    name = re.sub(r"\.(com|org|net|io|ai|co|in)$", "", name)  # drop common TLDs
    slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
    return slug or "company"


def read_json(path: Path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json_atomic(path: Path, obj) -> None:
    """Write JSON atomically: temp file in the same dir, then os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)          # atomic on Windows and POSIX
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def log_error(context: str, message: str) -> None:
    """NFR-6: no silent failures. Append to errors.log."""
    line = f"{now_iso()}\t{context}\t{message}\n"
    with open(ERRORS_LOG, "a", encoding="utf-8") as f:
        f.write(line)


def tail_errors(n: int = 30):
    try:
        with open(ERRORS_LOG, "r", encoding="utf-8") as f:
            lines = f.readlines()[-n:]
    except FileNotFoundError:
        return []
    out = []
    for ln in lines:
        parts = ln.rstrip("\n").split("\t")
        if len(parts) >= 3:
            out.append({"ts": parts[0], "context": parts[1], "message": parts[2]})
    return list(reversed(out))


# ---------------------------------------------------------------------------
# No-dummy-data enforcement
# ---------------------------------------------------------------------------

def validate_brief(brief: dict) -> list[str]:
    """
    Return a list of problems. Empty list == valid.
    Every item under recent_items / prep_sources that asserts a fact must
    trace to a real fetched URL. This is what stops fabricated ("dummy")
    data from being saved.
    """
    problems = []
    if not brief.get("company"):
        problems.append("brief.company is missing")

    for i, item in enumerate(brief.get("recent_items", [])):
        if not item.get("source_url"):
            problems.append(f"recent_items[{i}] has no source_url (would be dummy data)")
        if not item.get("fetched_at"):
            problems.append(f"recent_items[{i}] has no fetched_at timestamp")
        if not item.get("summary"):
            problems.append(f"recent_items[{i}] has no summary")

    for i, src in enumerate(brief.get("prep_sources", [])):
        if not src.get("url"):
            problems.append(f"prep_sources[{i}] has no url")

    return problems


# ---------------------------------------------------------------------------
# Company CRUD
# ---------------------------------------------------------------------------

def company_dir(slug: str) -> Path:
    return COMPANIES / slug


def list_companies() -> list[dict]:
    out = []
    for d in sorted(COMPANIES.iterdir() if COMPANIES.exists() else []):
        if not d.is_dir():
            continue
        meta = read_json(d / "meta.json", {})
        brief = read_json(d / "brief.json")
        out.append({
            "slug": d.name,
            "name": meta.get("name", d.name),
            "role": meta.get("role"),
            "region": meta.get("region"),
            "status": meta.get("status", "unknown"),
            "has_brief": brief is not None,
            "last_updated": (brief or {}).get("discovered_at") or meta.get("created_at"),
        })
    return out


def create_company(name_or_url: str, role: str | None, region: str | None = None) -> dict:
    region = (region or "").strip() or None
    # region makes the slug distinct, so "Accenture (India)" and "Accenture (US)"
    # are tracked separately.
    base = slugify(name_or_url)
    slug = f"{base}-{slugify(region)}" if region else base
    d = company_dir(slug)
    d.mkdir(parents=True, exist_ok=True)
    (d / "sessions").mkdir(exist_ok=True)

    meta = read_json(d / "meta.json", {})
    if not meta:
        meta = {
            "slug": slug,
            "name": name_or_url.strip(),
            "input_raw": name_or_url.strip(),
            "role": (role or "").strip() or None,
            "region": region,
            "status": "queued_discovery",
            "created_at": now_iso(),
        }
        write_json_atomic(d / "meta.json", meta)
    return meta


def get_company(slug: str) -> dict | None:
    d = company_dir(slug)
    if not d.exists():
        return None
    meta = read_json(d / "meta.json", {})
    brief = read_json(d / "brief.json")
    sessions = []
    sess_dir = d / "sessions"
    if sess_dir.exists():
        for sf in sorted(sess_dir.glob("*.json"), reverse=True):
            s = read_json(sf, {})
            sessions.append({
                "session_id": s.get("session_id", sf.stem),
                "started_at": s.get("started_at"),
                "status": s.get("status"),
                "turns": len(s.get("turns", [])),
                "has_feedback": bool(s.get("feedback")),
            })
    return {"meta": meta, "brief": brief, "sessions": sessions}


def set_company_status(slug: str, status: str) -> None:
    d = company_dir(slug)
    meta = read_json(d / "meta.json", {})
    meta["status"] = status
    meta["status_updated_at"] = now_iso()
    write_json_atomic(d / "meta.json", meta)


# ---------------------------------------------------------------------------
# Job queue (the trigger contract)
# ---------------------------------------------------------------------------

def enqueue_job(job_type: str, slug: str, extra: dict | None = None) -> dict:
    job_id = f"{_dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')}"
    job = {"id": job_id, "type": job_type, "slug": slug, "created_at": now_iso()}
    if extra:
        job.update(extra)
    write_json_atomic(JOBS_PENDING / f"{job_id}-{job_type}-{slug}.json", job)
    return job


def list_pending_jobs() -> list[dict]:
    out = []
    for jf in sorted(JOBS_PENDING.glob("*.json")):
        j = read_json(jf, {})
        j["_file"] = jf.name
        out.append(j)
    return out


# ---------------------------------------------------------------------------
# Kill switch: stop all pending/active work (non-destructive)
# ---------------------------------------------------------------------------

def cancel_all_pending_jobs() -> int:
    """Move every pending job to jobs/cancelled/ so Claude has nothing left to
    process. Non-destructive — the files are kept for audit, not deleted.
    Also clears any now-stale 'queued_*' status on the affected companies so the
    dashboard doesn't keep showing 'researching…' for a job that won't run."""
    n = 0
    for jf in JOBS_PENDING.glob("*.json"):
        job = read_json(jf, {})
        try:
            os.replace(jf, JOBS_CANCELLED / jf.name)
            n += 1
        except OSError as e:
            log_error("cancel_job", f"{jf.name}: {e}")
            continue
        slug = job.get("slug")
        if slug:
            meta = read_json(company_dir(slug) / "meta.json", {})
            if meta.get("status", "").startswith("queued_"):
                meta["status"] = "cancelled"
                meta["status_updated_at"] = now_iso()
                write_json_atomic(company_dir(slug) / "meta.json", meta)
    return n


def stop_active_sessions() -> int:
    """Mark any in-progress interview session as stopped."""
    n = 0
    if not COMPANIES.exists():
        return 0
    for d in COMPANIES.iterdir():
        sess_dir = d / "sessions"
        if not sess_dir.exists():
            continue
        for sf in sess_dir.glob("*.json"):
            s = read_json(sf, {})
            if s.get("status") in ("active", "ending"):
                s["status"] = "stopped"
                s["ended_at"] = now_iso()
                s["awaiting"] = "interviewer"
                write_json_atomic(sf, s)
                n += 1
    return n


# ---------------------------------------------------------------------------
# Interview sessions
# ---------------------------------------------------------------------------

def session_path(slug: str, session_id: str) -> Path:
    return company_dir(slug) / "sessions" / f"{session_id}.json"


def get_session(slug: str, session_id: str) -> dict | None:
    return read_json(session_path(slug, session_id))


def append_turn(slug: str, session_id: str, role: str, text: str,
                analytics: dict | None = None) -> dict:
    s = get_session(slug, session_id)
    if s is None:
        raise FileNotFoundError("session not found")
    turn = {"role": role, "text": text, "ts": now_iso()}
    if analytics:
        turn["analytics"] = analytics          # delivery metrics for a spoken/typed answer
    s["turns"].append(turn)
    s["awaiting"] = "candidate" if role == "interviewer" else "interviewer"
    write_json_atomic(session_path(slug, session_id), s)
    return s


def start_session(slug: str, role: str | None, config: dict | None = None) -> dict:
    """Overrides the earlier simple start_session — now carries interview config
    (persona, difficulty, rounds, whether resume/JD gap questions are in play)."""
    session_id = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    session = {
        "session_id": session_id,
        "slug": slug,
        "role": role,
        "started_at": now_iso(),
        "ended_at": None,
        "status": "active",
        "awaiting": "interviewer",
        "config": config or {"persona": "neutral", "difficulty": "medium",
                             "rounds": ["mixed"]},
        "turns": [],
        "feedback": None,
    }
    write_json_atomic(session_path(slug, session_id), session)
    return session


# ===========================================================================
# It.2 — Past / predicted questions store
# ===========================================================================

def get_questions(slug: str) -> dict:
    """Questions grouped by round type. Written by Claude (questions/predict
    jobs); read by the dashboard. Shape:
        {"rounds": {"case": [ {question, source, source_url, confidence,
                               likelihood, rationale} ], ...},
         "updated_at": iso}"""
    return read_json(company_dir(slug) / "questions.json",
                     {"rounds": {}, "updated_at": None})


# ===========================================================================
# It.4 — Resume / JD + gap analysis
# ===========================================================================

def save_resume(slug: str, resume_text: str, jd_text: str) -> None:
    d = company_dir(slug)
    d.mkdir(parents=True, exist_ok=True)
    write_json_atomic(d / "resume.json", {
        "resume_text": resume_text or "",
        "jd_text": jd_text or "",
        "saved_at": now_iso(),
        "gap_analysis": read_json(d / "resume.json", {}).get("gap_analysis"),
    })


def get_resume(slug: str) -> dict:
    return read_json(company_dir(slug) / "resume.json",
                     {"resume_text": "", "jd_text": "", "gap_analysis": None})


# ===========================================================================
# It.4 — STAR story bank (global, reusable across every company)
# ===========================================================================

def read_story_bank() -> list[dict]:
    return read_json(STORY_BANK, [])


def _write_story_bank(stories: list[dict]) -> None:
    write_json_atomic(STORY_BANK, stories)


def add_story(title: str, competencies: list[str], situation: str, task: str,
              action: str, result: str) -> dict:
    stories = read_story_bank()
    story = {
        "id": _dt.datetime.now().strftime("%Y%m%d%H%M%S%f"),
        "title": title.strip(),
        "competencies": [c.strip() for c in competencies if c.strip()],
        "situation": situation.strip(),
        "task": task.strip(),
        "action": action.strip(),
        "result": result.strip(),
        "created_at": now_iso(),
    }
    stories.append(story)
    _write_story_bank(stories)
    return story


def delete_story(story_id: str) -> bool:
    stories = read_story_bank()
    new = [s for s in stories if s.get("id") != story_id]
    if len(new) == len(stories):
        return False
    _write_story_bank(new)
    return True


def story_coverage(slug: str) -> dict:
    """FR-15: which of the company's likely competencies have a prepared story,
    and which don't. Likely competencies come from the brief."""
    brief = read_json(company_dir(slug) / "brief.json", {}) or {}
    needed = brief.get("competencies") or []
    covered = set()
    for s in read_story_bank():
        for c in s.get("competencies", []):
            covered.add(c.lower())
    have, missing = [], []
    for c in needed:
        (have if c.lower() in covered else missing).append(c)
    return {"needed": needed, "have": have, "missing": missing}


# ===========================================================================
# It.5 — Spaced repetition: which categories the user is weakest on
# ===========================================================================

def weak_categories(slug: str, threshold: int = 3) -> list[dict]:
    """Scan past sessions' rubric scores; return dimensions the user tends to
    score at/below `threshold`, weakest first — for the interviewer to target."""
    sums: dict[str, list] = {}
    d = company_dir(slug) / "sessions"
    if d.exists():
        for sf in d.glob("*.json"):
            s = read_json(sf, {})
            rub = (s.get("feedback") or {}).get("rubric") or {}
            for dim, score in rub.items():
                try:
                    sums.setdefault(dim, []).append(float(score))
                except (TypeError, ValueError):
                    pass
    out = []
    for dim, scores in sums.items():
        avg = sum(scores) / len(scores)
        if avg <= threshold:
            out.append({"dimension": dim, "avg": round(avg, 1), "n": len(scores)})
    return sorted(out, key=lambda x: x["avg"])


# ===========================================================================
# It.3 — delivery-analytics aggregation across a company's sessions
# ===========================================================================

def delivery_trends(slug: str) -> list[dict]:
    """One point per session (oldest→newest) with aggregate delivery metrics,
    for the trend charts."""
    d = company_dir(slug) / "sessions"
    points = []
    if d.exists():
        for sf in sorted(d.glob("*.json")):
            s = read_json(sf, {})
            answers = [t for t in s.get("turns", []) if t.get("role") == "candidate"]
            metrics = [t.get("analytics") for t in answers if t.get("analytics")]
            if not metrics:
                continue
            def avg(key):
                vals = [m[key] for m in metrics if m.get(key) is not None]
                return round(sum(vals) / len(vals), 1) if vals else None
            points.append({
                "session_id": s.get("session_id"),
                "started_at": s.get("started_at"),
                "avg_wpm": avg("wpm"),
                "avg_filler_rate": avg("filler_rate"),
                "avg_words": avg("word_count"),
                "answers": len(answers),
            })
    return points


# ===========================================================================
# It.5 — assemble the pre-interview prep pack (one-pager data)
# ===========================================================================

# ===========================================================================
# Stage-by-stage progress (so the dashboard can "intimate" the user as each
# research stage completes, instead of one opaque "researching…" state).
# ===========================================================================

# Canonical stage lists per job type. Claude marks each done as it works.
PROGRESS_STAGES = {
    "discover": [
        "Resolving company identity",
        "Finding official pages (newsroom / careers / investor)",
        "Checking for a first-party interview-prep page",
        "Inferring interview format",
        "Searching recent 6-month news & deals",
        "Selecting prep sources",
        "Writing & validating brief",
    ],
    "update": [
        "Re-checking known sources",
        "Judging what's new",
        "Appending new items",
    ],
    "questions": [
        "Searching public interview-experience sources",
        "Extracting reported questions",
        "Grouping by round type",
    ],
    "predict": [
        "Reading the company brief",
        "Generating grounded questions",
        "Attaching likelihood & rationale",
    ],
    "resume_gap": [
        "Reading resume & job description",
        "Comparing against role competencies",
        "Writing gap-probing questions",
    ],
}


def start_progress(slug: str, job: str, stage_names: list[str] | None = None) -> dict:
    stages = stage_names or PROGRESS_STAGES.get(job, ["Working"])
    items = [{"name": n, "status": "pending", "ts": None} for n in stages]
    if items:
        items[0]["status"] = "active"
    p = {"job": job, "stages": items, "started_at": now_iso(),
         "updated_at": now_iso(), "done": False}
    write_json_atomic(company_dir(slug) / "progress.json", p)
    return p


def complete_stage(slug: str, name: str, note: str = "") -> dict | None:
    p = read_json(company_dir(slug) / "progress.json")
    if not p:
        return None
    for i, s in enumerate(p["stages"]):
        if s["name"] == name and s["status"] != "done":
            s["status"] = "done"
            s["ts"] = now_iso()
            if note:
                s["note"] = note
            for s2 in p["stages"][i + 1:]:
                if s2["status"] == "pending":
                    s2["status"] = "active"
                    break
            break
    p["updated_at"] = now_iso()
    p["done"] = all(s["status"] == "done" for s in p["stages"])
    write_json_atomic(company_dir(slug) / "progress.json", p)
    return p


def get_progress(slug: str) -> dict:
    return read_json(company_dir(slug) / "progress.json", {}) or {}


def estimate_tokens(text: str) -> int:
    """Rough token estimate (~4 chars/token). Approximation, not billing."""
    return (len(text or "") + 3) // 4


def usage_summary() -> dict:
    """Estimated token footprint of all generated/stored content, by category.

    IMPORTANT: this is an *estimate of content the app stored*, not your actual
    Claude subscription usage. The app never calls the model — Claude Code does,
    in your interactive session. Real usage is higher (it also includes the web
    searches, fetched page text, and prompts on the input side, which aren't
    stored here). For exact usage, check your Claude Code session.
    """
    cats = {"research": 0, "questions": 0, "resume_gap": 0,
            "interviews": 0, "stories": 0}

    for stry in read_story_bank():
        cats["stories"] += estimate_tokens(json.dumps(stry, ensure_ascii=False))

    if COMPANIES.exists():
        for d in COMPANIES.iterdir():
            if not d.is_dir():
                continue
            brief = read_json(d / "brief.json")
            if brief:
                cats["research"] += estimate_tokens(json.dumps(brief, ensure_ascii=False))
            q = read_json(d / "questions.json")
            if q:
                cats["questions"] += estimate_tokens(json.dumps(q, ensure_ascii=False))
            r = read_json(d / "resume.json", {})
            if r.get("gap_analysis"):
                cats["resume_gap"] += estimate_tokens(json.dumps(r["gap_analysis"], ensure_ascii=False))
            sess = d / "sessions"
            if sess.exists():
                for sf in sess.glob("*.json"):
                    s = read_json(sf, {})
                    for t in s.get("turns", []):
                        cats["interviews"] += estimate_tokens(t.get("text", ""))
                    if s.get("feedback"):
                        cats["interviews"] += estimate_tokens(json.dumps(s["feedback"], ensure_ascii=False))

    total = sum(cats.values())
    return {"categories": cats, "total": total,
            "note": "Estimate of generated content stored locally (~4 chars/token). "
                    "Actual Claude subscription usage is higher and only visible in "
                    "your Claude Code session."}


def assemble_prep_pack(slug: str) -> dict:
    brief = read_json(company_dir(slug) / "brief.json", {}) or {}
    questions = get_questions(slug)
    # top predicted questions across all rounds, by likelihood
    order = {"high": 0, "medium": 1, "low": 2, None: 3}
    all_q = []
    for rnd, qs in (questions.get("rounds") or {}).items():
        for q in qs:
            all_q.append({**q, "round": rnd})
    all_q.sort(key=lambda q: order.get((q.get("likelihood") or "").lower(), 3))

    last_weak = weak_categories(slug)
    coverage = story_coverage(slug)
    matched_stories = read_story_bank()

    return {
        "company": brief.get("company", slug),
        "role": (read_json(company_dir(slug) / "meta.json", {}) or {}).get("role"),
        "interview_format": brief.get("interview_format"),
        "top_news": (brief.get("recent_items") or [])[:5],
        "top_questions": all_q[:8],
        "stories": matched_stories,
        "story_gaps": coverage.get("missing", []),
        "weak_spots": last_weak,
        "generated_at": now_iso(),
    }
