"""
Interview Research Tracker — local dashboard server (Iteration 1).

Pure Python standard library. No installs, no external server, nothing
running in the background: it only does work while it is answering a
request you triggered from the browser.

Run:
    python server.py
Then open http://localhost:8756

The server NEVER calls an LLM or the internet itself. When you add a
company or start an interview turn, it drops a job file into
data/jobs/pending/. Claude Code (your interactive session, your
subscription) processes those jobs. See PROCESSING_GUIDE.md.
"""

from __future__ import annotations

import json
import time
import threading
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import storage as st   # noqa: E402

import os

WEB = Path(__file__).resolve().parent / "web"
PORT = int(os.environ.get("IRT_PORT", "8756"))

# --- Rate limiting ---------------------------------------------------------
# Sliding-window limiter, thread-safe (the server is multi-threaded).
# Two buckets: "read" is generous because the dashboard polls a few times a
# second; "write" is strict because those requests create job-queue files, and
# a runaway loop there is the thing worth guarding against.
# All three are env-overridable so the limits can be tuned (or set very high in
# tests) without editing code.
RATE_WINDOW_SEC = int(os.environ.get("IRT_RATE_WINDOW", "10"))
RATE_LIMITS = {
    "read": int(os.environ.get("IRT_RATE_READ", "200")),    # GET / static / polling
    "write": int(os.environ.get("IRT_RATE_WRITE", "20")),   # POST endpoints that enqueue jobs
}


class RateLimiter:
    def __init__(self):
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, client: str, bucket: str) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds)."""
        limit = RATE_LIMITS[bucket]
        now = time.monotonic()
        cutoff = now - RATE_WINDOW_SEC
        with self._lock:
            dq = self._hits[(client, bucket)]
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= limit:
                retry = max(1, int(RATE_WINDOW_SEC - (now - dq[0])) + 1)
                return False, retry
            dq.append(now)
            return True, 0


rate_limiter = RateLimiter()


class Handler(BaseHTTPRequestHandler):
    # HTTP/1.1 enables keep-alive so the browser reuses one connection for its
    # frequent polling instead of paying full TCP setup on every request. We
    # always send Content-Length, so keep-alive is safe.
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        try:
            import socket
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

    # ----- helpers ---------------------------------------------------------
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path):
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }.get(path.suffix, "application/octet-stream")
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _rate_ok(self, bucket: str) -> bool:
        """Enforce the rate limit. On breach, reply 429 and return False."""
        client = self.client_address[0] if self.client_address else "unknown"
        allowed, retry = rate_limiter.check(client, bucket)
        if allowed:
            return True
        body = json.dumps({
            "error": "rate limit exceeded",
            "bucket": bucket,
            "retry_after": retry,
        }).encode("utf-8")
        self.send_response(429)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Retry-After", str(retry))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return False

    def log_message(self, *args):
        pass  # quiet

    # ----- GET -------------------------------------------------------------
    def do_GET(self):
        if not self._rate_ok("read"):
            return
        parsed = urlparse(self.path)
        path = parsed.path
        parts = [p for p in path.split("/") if p]

        # static
        if path == "/" or path == "/index.html":
            return self._send_file(WEB / "index.html")
        if parts and parts[0] in ("app.js", "style.css"):
            return self._send_file(WEB / parts[0])

        # api
        if path == "/api/companies":
            return self._send_json({"companies": st.list_companies()})
        if path == "/api/jobs":
            return self._send_json({"jobs": st.list_pending_jobs()})
        if path == "/api/errors":
            return self._send_json({"errors": st.tail_errors()})

        if path == "/api/story-bank":
            return self._send_json({"stories": st.read_story_bank()})

        if path == "/api/usage":
            return self._send_json(st.usage_summary())

        if len(parts) == 3 and parts[0] == "api" and parts[1] == "companies":
            company = st.get_company(parts[2])
            if company is None:
                return self._send_json({"error": "not found"}, 404)
            return self._send_json(company)

        # GET /api/companies/<slug>/<resource>
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "companies":
            slug, resource = parts[2], parts[3]
            if resource == "questions":
                return self._send_json(st.get_questions(slug))
            if resource == "resume":
                return self._send_json(st.get_resume(slug))
            if resource == "story-coverage":
                return self._send_json(st.story_coverage(slug))
            if resource == "prep-pack":
                return self._send_json(st.assemble_prep_pack(slug))
            if resource == "delivery-trends":
                return self._send_json({"points": st.delivery_trends(slug)})
            if resource == "weak":
                return self._send_json({"weak": st.weak_categories(slug)})
            if resource == "progress":
                return self._send_json(st.get_progress(slug))

        # GET /api/companies/<slug>/interview/<session_id>  (poll)
        if (len(parts) == 5 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "interview"):
            s = st.get_session(parts[2], parts[4])
            if s is None:
                return self._send_json({"error": "not found"}, 404)
            return self._send_json(s)

        self.send_error(404)

    # ----- POST ------------------------------------------------------------
    def do_POST(self):
        if not self._rate_ok("write"):
            return
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]
        data = self._body_json()

        # POST /api/kill  -> KILL SWITCH: cancel all work + shut the server down
        if parsed.path == "/api/kill":
            cancelled = st.cancel_all_pending_jobs()
            stopped = st.stop_active_sessions()
            self._send_json({
                "ok": True,
                "cancelled_jobs": cancelled,
                "stopped_sessions": stopped,
                "shutting_down": True,
            })
            print(f"[KILL SWITCH] {cancelled} job(s) cancelled, "
                  f"{stopped} session(s) stopped. Shutting down.")

            # Shut down AFTER this response has been flushed. shutdown() must be
            # called from a different thread than serve_forever(), so use a
            # short-lived thread.
            def _shutdown():
                time.sleep(0.8)
                srv = globals().get("HTTP_SERVER")
                if srv is not None:
                    srv.shutdown()
            threading.Thread(target=_shutdown, daemon=True).start()
            return

        # POST /api/companies  -> add company + enqueue discovery
        if parsed.path == "/api/companies":
            name = (data.get("name_or_url") or "").strip()
            if not name:
                return self._send_json({"error": "name_or_url required"}, 400)
            meta = st.create_company(name, data.get("role"), data.get("region"))
            st.enqueue_job("discover", meta["slug"],
                           {"role": meta.get("role"), "region": meta.get("region"),
                            "input_raw": meta.get("input_raw")})
            return self._send_json({"ok": True, "slug": meta["slug"], "meta": meta})

        # POST /api/companies/<slug>/run-update
        if (len(parts) == 4 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "run-update"):
            slug = parts[2]
            if st.get_company(slug) is None:
                return self._send_json({"error": "not found"}, 404)
            st.set_company_status(slug, "queued_update")
            st.enqueue_job("update", slug)
            return self._send_json({"ok": True})

        # POST /api/companies/<slug>/resume  -> save resume+JD, enqueue gap analysis
        if (len(parts) == 4 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "resume"):
            slug = parts[2]
            if st.get_company(slug) is None:
                return self._send_json({"error": "not found"}, 404)
            st.save_resume(slug, data.get("resume_text", ""), data.get("jd_text", ""))
            st.enqueue_job("resume_gap", slug)
            return self._send_json({"ok": True})

        # POST /api/companies/<slug>/questions/refresh -> discover past questions
        if (len(parts) == 5 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "questions" and parts[4] == "refresh"):
            slug = parts[2]
            if st.get_company(slug) is None:
                return self._send_json({"error": "not found"}, 404)
            st.enqueue_job("questions", slug)
            return self._send_json({"ok": True})

        # POST /api/companies/<slug>/predict -> generate predicted questions
        if (len(parts) == 4 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "predict"):
            slug = parts[2]
            if st.get_company(slug) is None:
                return self._send_json({"error": "not found"}, 404)
            st.enqueue_job("predict", slug)
            return self._send_json({"ok": True})

        # POST /api/story-bank  -> add a STAR story (global)
        if parsed.path == "/api/story-bank":
            title = (data.get("title") or "").strip()
            if not title:
                return self._send_json({"error": "title required"}, 400)
            story = st.add_story(
                title, data.get("competencies", []),
                data.get("situation", ""), data.get("task", ""),
                data.get("action", ""), data.get("result", ""))
            return self._send_json({"ok": True, "story": story})

        # POST /api/story-bank/<id>/delete
        if (len(parts) == 4 and parts[0] == "api" and parts[1] == "story-bank"
                and parts[3] == "delete"):
            ok = st.delete_story(parts[2])
            return self._send_json({"ok": ok})

        # POST /api/companies/<slug>/interview/start  (accepts interview config)
        if (len(parts) == 5 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "interview" and parts[4] == "start"):
            slug = parts[2]
            company = st.get_company(slug)
            if company is None:
                return self._send_json({"error": "not found"}, 404)
            role = (company.get("meta") or {}).get("role")
            config = {
                "persona": data.get("persona", "neutral"),
                "difficulty": data.get("difficulty", "medium"),
                "rounds": data.get("rounds") or ["mixed"],
                "use_gap": bool(data.get("use_gap")),
            }
            session = st.start_session(slug, role, config)
            st.enqueue_job("interview_turn", slug, {"session_id": session["session_id"]})
            return self._send_json({"ok": True, "session_id": session["session_id"]})

        # POST /api/companies/<slug>/interview/<session>/answer (+delivery analytics)
        if (len(parts) == 6 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "interview" and parts[5] == "answer"):
            slug, session_id = parts[2], parts[4]
            text = (data.get("text") or "").strip()
            if not text:
                return self._send_json({"error": "empty answer"}, 400)
            try:
                st.append_turn(slug, session_id, "candidate", text,
                               analytics=data.get("analytics"))
            except FileNotFoundError:
                return self._send_json({"error": "session not found"}, 404)
            st.enqueue_job("interview_turn", slug, {"session_id": session_id})
            return self._send_json({"ok": True})

        # POST /api/companies/<slug>/interview/<session>/end
        if (len(parts) == 6 and parts[0] == "api" and parts[1] == "companies"
                and parts[3] == "interview" and parts[5] == "end"):
            slug, session_id = parts[2], parts[4]
            s = st.get_session(slug, session_id)
            if s is None:
                return self._send_json({"error": "session not found"}, 404)
            s["status"] = "ending"
            s["awaiting"] = "interviewer"
            st.write_json_atomic(st.session_path(slug, session_id), s)
            st.enqueue_job("feedback", slug, {"session_id": session_id})
            return self._send_json({"ok": True})

        self.send_error(404)


HTTP_SERVER = None   # set in main(); used by the kill switch to shut down


def main():
    global HTTP_SERVER
    HTTP_SERVER = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Interview Research Tracker running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop, or use the Kill switch in the dashboard.")
    try:
        HTTP_SERVER.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        HTTP_SERVER.server_close()
        print("Server closed. Nothing is running. Restart with: python server.py")


if __name__ == "__main__":
    main()
