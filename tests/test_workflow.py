"""Exercise the handoff and score gate with a local fake Codex executable."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
FAKE_CODEX = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
prompt = sys.stdin.read()
stage = prompt.split("[HARNESS_STAGE:", 1)[1].split("]", 1)[0]
answer = Path(args[args.index("--output-last-message") + 1])
with open(os.environ["FAKE_CODEX_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"stage": stage, "pid": os.getpid(), "args": args, "prompt": prompt}) + "\n")

if stage == "REVIEW-0":
    output = {"summary": "Two required bugs and one minor bug", "findings": [
        {"file": "game.js", "line": 3, "score": 2, "issue": "Small edge case", "evidence": "Example", "suggested_change": "Adjust edge case"},
        {"file": "game.js", "line": 5, "score": 3, "issue": "Movement fails", "evidence": "Example", "suggested_change": "Fix movement"},
        {"file": "game.js", "line": 8, "score": 5, "issue": "Game crashes", "evidence": "Example", "suggested_change": "Fix crash"}
    ]}
elif stage == "REVIEW-1":
    findings = []
    if os.environ.get("FAKE_REPAIR_MODE") == "persistent":
        findings = [{"file": "game.js", "line": 8, "score": 5, "issue": "Game still crashes", "evidence": "Example", "suggested_change": "Fix crash"}]
    output = {"summary": "Verification review", "findings": findings}
elif stage == "REPAIR-1":
    ids = ["R0-F2", "R0-F3"]
    if os.environ.get("FAKE_REPAIR_MODE") == "missing":
        ids = ["R0-F2"]
    output = {"summary": "Repairs made", "addressed_ids": ids, "blocked_ids": [], "checks": ["fake check passed"]}
else:
    output = f"Completed {stage}"

answer.write_text(json.dumps(output) if isinstance(output, dict) else output, encoding="utf-8")
'''


class WorkflowTests(unittest.TestCase):
    def run_fake_workflow(self, mode: str = "", max_fix_rounds: int = 3):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        folder = Path(temp.name)
        fake = folder / "codex"
        fake.write_text(FAKE_CODEX, encoding="utf-8")
        fake.chmod(0o755)
        log = folder / "calls.jsonl"
        environment = os.environ.copy()
        environment["FAKE_CODEX_LOG"] = str(log)
        environment["FAKE_REPAIR_MODE"] = mode
        result = subprocess.run(
            [sys.executable, str(ROOT / "workflow.py"), "Build the game", "--codex-bin", str(fake), "--runs-dir", str(folder / "runs"), "--max-fix-rounds", str(max_fix_rounds)],
            cwd=ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
        run_dir = next((folder / "runs").iterdir())
        return result, calls, run_dir

    def test_every_handoff_is_new_and_required_scores_are_routed(self):
        result, calls, run_dir = self.run_fake_workflow()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            [call["stage"] for call in calls],
            ["PLAN", "IMPLEMENT", "REVIEW-0", "REPAIR-1", "REVIEW-1", "ARCHITECT"],
        )
        self.assertEqual(len({call["pid"] for call in calls}), len(calls))
        self.assertTrue(all(call["args"][0] == "exec" and "--ephemeral" in call["args"] and "resume" not in call["args"] for call in calls))
        self.assertTrue(all("agents.enabled=false" in call["args"] for call in calls))
        self.assertTrue(all(any(arg.startswith("developer_instructions=") for arg in call["args"]) for call in calls))
        self.assertTrue(all("loadable Chrome extension is the extension/ directory" in call["prompt"] for call in calls))
        self.assertTrue(all("Do not launch Google Chrome or another browser" in call["prompt"] for call in calls))
        repair_prompt = next(call["prompt"] for call in calls if call["stage"] == "REPAIR-1")
        required = json.loads(repair_prompt.split("Required findings (score >= 3):\n", 1)[1])
        self.assertEqual([finding["score"] for finding in required], [3, 5])
        self.assertEqual([finding["id"] for finding in required], ["R0-F2", "R0-F3"])
        self.assertEqual(json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))["status"], "complete")

    def test_missing_required_fix_stops_before_architecture(self):
        result, calls, run_dir = self.run_fake_workflow("missing")
        self.assertEqual(result.returncode, 1)
        self.assertIn("R0-F3", result.stderr)
        self.assertEqual([call["stage"] for call in calls], ["PLAN", "IMPLEMENT", "REVIEW-0", "REPAIR-1"])
        self.assertFalse((run_dir / "05-architecture.md").exists())

    def test_persistent_required_bug_stops_before_architecture(self):
        result, calls, run_dir = self.run_fake_workflow("persistent", max_fix_rounds=1)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Required findings remain", result.stderr)
        self.assertEqual([call["stage"] for call in calls], ["PLAN", "IMPLEMENT", "REVIEW-0", "REPAIR-1", "REVIEW-1"])
        self.assertFalse((run_dir / "05-architecture.md").exists())


if __name__ == "__main__":
    unittest.main()
