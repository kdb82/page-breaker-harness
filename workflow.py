#!/usr/bin/env python3
"""Run a fresh Codex session for each stage of the game development workflow."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
SPEC = ROOT / "game.md"
AGENTS = ROOT / ".codex" / "agents"
ROLE_FILES = {
    "planner": AGENTS / "planner.toml",
    "implementer": AGENTS / "implementer.toml",
    "bug_reviewer": AGENTS / "bug_reviewer.toml",
    "architect": AGENTS / "architect.toml",
}

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "file": {"type": "string"},
                    "line": {"type": "integer"},
                    "score": {"type": "integer"},
                    "issue": {"type": "string"},
                    "evidence": {"type": "string"},
                    "suggested_change": {"type": "string"},
                },
                "required": ["file", "line", "score", "issue", "evidence", "suggested_change"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "findings"],
    "additionalProperties": False,
}

REPAIR_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "addressed_ids": {"type": "array", "items": {"type": "string"}},
        "blocked_ids": {"type": "array", "items": {"type": "string"}},
        "checks": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "addressed_ids", "blocked_ids", "checks"],
    "additionalProperties": False,
}


class WorkflowError(Exception):
    """A stage failed or returned a handoff the next stage cannot trust."""


def load_roles() -> dict[str, dict]:
    roles = {}
    for role, path in ROLE_FILES.items():
        if not path.is_file():
            raise WorkflowError(f"Missing role file: {path}")
        with path.open("rb") as file:
            data = tomllib.load(file)
        for field in ("name", "description", "developer_instructions"):
            if not isinstance(data.get(field), str) or not data[field].strip():
                raise WorkflowError(f"{path}: {field} must be a nonempty string")
        roles[role] = data
    return roles


def codex_path(candidate: str) -> str:
    found = shutil.which(candidate)
    if not found:
        raise WorkflowError(f"Codex CLI not found: {candidate}. Install and sign in to Codex first.")
    return found


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def stage(
    *,
    codex: str,
    role: dict,
    label: str,
    prompt: str,
    run_dir: Path,
    writable: bool,
    timeout_seconds: int,
    schema: dict | None = None,
) -> Path:
    """Start one independent, ephemeral Codex session and save its handoff."""
    suffix = ".json" if schema else ".md"
    answer = run_dir / f"{label}{suffix}"
    (run_dir / f"{label}.prompt.md").write_text(prompt, encoding="utf-8")

    command = [
        codex,
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--cd",
        str(ROOT),
        "--sandbox",
        "workspace-write" if writable else "read-only",
        "--output-last-message",
        str(answer),
        "-c",
        "developer_instructions=" + json.dumps(role["developer_instructions"], ensure_ascii=False),
        "-c",
        "agents.enabled=false",
    ]
    if isinstance(role.get("model"), str) and role["model"].strip():
        command.extend(["--model", role["model"]])
    if isinstance(role.get("model_reasoning_effort"), str) and role["model_reasoning_effort"].strip():
        command.extend(["-c", "model_reasoning_effort=" + json.dumps(role["model_reasoning_effort"])])
    if schema is not None:
        schema_file = run_dir / f"{label}.schema.json"
        write_json(schema_file, schema)
        command.extend(["--output-schema", str(schema_file)])
    command.append("-")  # Read the task from stdin; never put user context in shell arguments.

    print(f"Running {label} as a new {role['name']} agent...", flush=True)
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            input=prompt,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise WorkflowError(f"{label} timed out after {timeout_seconds} seconds") from error
    (run_dir / f"{label}.stdout.log").write_text(result.stdout, encoding="utf-8")
    (run_dir / f"{label}.stderr.log").write_text(result.stderr, encoding="utf-8")
    if result.returncode != 0:
        raise WorkflowError(
            f"{label} exited with code {result.returncode}; see {run_dir / f'{label}.stderr.log'}"
        )
    if not answer.is_file() or not answer.read_text(encoding="utf-8").strip():
        raise WorkflowError(f"{label} produced no handoff at {answer}")
    return answer


def validate_review(path: Path, round_number: int) -> list[dict]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise WorkflowError(f"Invalid reviewer JSON in {path}: {error}") from error
    if not isinstance(document, dict) or not isinstance(document.get("findings"), list):
        raise WorkflowError(f"Reviewer output must contain a findings list: {path}")
    if not isinstance(document.get("summary"), str):
        raise WorkflowError(f"Reviewer output must contain a summary string: {path}")
    findings = document["findings"]
    for index, finding in enumerate(findings, start=1):
        if not isinstance(finding, dict):
            raise WorkflowError(f"Finding {index} in {path} is not an object")
        score = finding.get("score")
        if type(score) is not int or not 1 <= score <= 5:
            raise WorkflowError(f"Finding {index} in {path} must have a score from 1 to 5")
        for field in ("file", "issue", "evidence", "suggested_change"):
            if not isinstance(finding.get(field), str) or not finding[field].strip():
                raise WorkflowError(f"Finding {index} in {path} is missing {field}")
        if type(finding.get("line")) is not int or finding["line"] < 0:
            raise WorkflowError(f"Finding {index} in {path} needs a nonnegative line number")
        finding["id"] = f"R{round_number}-F{index}"
    write_json(path, document)
    return findings


def validate_repair(path: Path, required: list[dict]) -> None:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise WorkflowError(f"Invalid implementation repair JSON in {path}: {error}") from error
    if not isinstance(report, dict):
        raise WorkflowError(f"Repair report must be a JSON object: {path}")
    if not isinstance(report.get("summary"), str):
        raise WorkflowError(f"Repair report must contain a summary string: {path}")
    for field in ("addressed_ids", "blocked_ids", "checks"):
        if not isinstance(report.get(field), list) or not all(isinstance(item, str) for item in report[field]):
            raise WorkflowError(f"Repair report must contain a string list for {field}: {path}")
    required_ids = {finding["id"] for finding in required}
    addressed = set(report["addressed_ids"])
    blocked = set(report["blocked_ids"])
    missing = required_ids - addressed
    if missing or required_ids & blocked:
        raise WorkflowError(
            "The implementation agent did not report every required fix as addressed: "
            + ", ".join(sorted(missing | (required_ids & blocked)))
        )


def common_prompt(context: str, spec: str) -> str:
    return (
        f"Project root: {ROOT}\n"
        f"Source of truth: {SPEC}\n\n"
        "The loadable Chrome extension is the extension/ directory. Keep "
        "Python files, tests, caches, and workflow outputs outside it.\n\n"
        "Do not launch Google Chrome or another browser from this workflow, including "
        "headless mode. Browser launches in this macOS agent environment abort "
        "during app registration and create crash dialogs. Verify with the Node "
        "gameplay smoke checks and workflow tests; report rendered browser checks "
        "as manual steps for the user.\n\n"
        f"Game specification:\n{spec}\n\n"
        f"Caller context:\n{context}\n"
    )


def run_workflow(args: argparse.Namespace) -> Path:
    roles = load_roles()
    if not SPEC.is_file():
        raise WorkflowError(f"Missing project specification: {SPEC}")
    codex = codex_path(args.codex_bin)
    if args.context_file and args.context:
        raise WorkflowError("Use either a context argument or --context-file, not both")
    if args.context_file:
        context = Path(args.context_file).expanduser().read_text(encoding="utf-8")
    elif args.context == "-":
        context = sys.stdin.read()
    else:
        context = args.context or ""
    if not context.strip():
        raise WorkflowError("Provide task context as an argument, with --context-file, or on stdin using '-'")

    run_dir = Path(args.runs_dir).expanduser().resolve() / (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    )
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "context.md").write_text(context, encoding="utf-8")
    spec = SPEC.read_text(encoding="utf-8")
    base = common_prompt(context, spec)

    plan = stage(
        codex=codex, role=roles["planner"], label="01-plan", run_dir=run_dir,
        prompt="[HARNESS_STAGE:PLAN]\nMake the actionable plan.\n\n" + base,
        writable=False, timeout_seconds=args.timeout_minutes * 60,
    )
    implementation = stage(
        codex=codex, role=roles["implementer"], label="02-implementation", run_dir=run_dir,
        prompt=("[HARNESS_STAGE:IMPLEMENT]\nImplement the complete plan in this project.\n\n"
                + base + "\nPlanning handoff:\n" + plan.read_text(encoding="utf-8")),
        writable=True, timeout_seconds=args.timeout_minutes * 60,
    )

    review_paths: list[Path] = []
    repair_paths: list[Path] = []
    review_round = 0
    prior_repair = ""
    while True:
        review = stage(
            codex=codex, role=roles["bug_reviewer"],
            label=f"03-review-{review_round}", run_dir=run_dir,
            prompt=(
                f"[HARNESS_STAGE:REVIEW-{review_round}]\n"
                "Review the current code for correctness bugs. Score every suggested change 1–5. "
                "Use line 0 if a precise line is unavailable. Return only the requested JSON.\n\n"
                + base + "\nPlanning handoff:\n" + plan.read_text(encoding="utf-8")
                + "\nImplementation handoff:\n" + implementation.read_text(encoding="utf-8")
                + prior_repair
            ),
            writable=False, timeout_seconds=args.timeout_minutes * 60,
            schema=REVIEW_SCHEMA,
        )
        review_paths.append(review)
        findings = validate_review(review, review_round)
        required = [finding for finding in findings if finding["score"] >= 3]

        # Always hand the first review to a new implementer, even when it is clean.
        if review_round > 0 and not required:
            break
        if review_round >= args.max_fix_rounds:
            raise WorkflowError(
                f"Required findings remain after {args.max_fix_rounds} fix rounds; "
                f"architecture stage was not started. See {review}"
            )

        repair_number = review_round + 1
        repair = stage(
            codex=codex, role=roles["implementer"],
            label=f"04-repair-{repair_number}", run_dir=run_dir,
            prompt=(
                f"[HARNESS_STAGE:REPAIR-{repair_number}]\n"
                "You are a NEW implementation agent. Fix every required finding below, then return "
                "the requested JSON. Report an ID in addressed_ids only after actually fixing it. "
                "If there are no required findings, make no changes and report empty ID lists.\n\n"
                + base + "\nPlanning handoff:\n" + plan.read_text(encoding="utf-8")
                + "\nAll reviewer findings:\n" + json.dumps(findings, indent=2)
                + "\nRequired findings (score >= 3):\n" + json.dumps(required, indent=2)
            ),
            writable=True, timeout_seconds=args.timeout_minutes * 60,
            schema=REPAIR_SCHEMA,
        )
        repair_paths.append(repair)
        validate_repair(repair, required)
        if not required:
            break
        prior_repair = (
            "\nPrevious review and repair handoffs:\n"
            + review.read_text(encoding="utf-8")
            + "\n"
            + repair.read_text(encoding="utf-8")
        )
        review_round += 1

    history = "\n".join(
        f"{path.name}:\n{path.read_text(encoding='utf-8')}"
        for path in [*review_paths, *repair_paths]
    )
    architecture = stage(
        codex=codex, role=roles["architect"], label="05-architecture", run_dir=run_dir,
        prompt=(
            "[HARNESS_STAGE:ARCHITECT]\nPerform the final architecture quality assurance. "
            "Restructure only where warranted, preserve behavior, and verify your changes.\n\n"
            + base + "\nPlanning handoff:\n" + plan.read_text(encoding="utf-8")
            + "\nImplementation handoff:\n" + implementation.read_text(encoding="utf-8")
            + "\nReview and repair history:\n" + history
        ),
        writable=True, timeout_seconds=args.timeout_minutes * 60,
    )
    write_json(run_dir / "summary.json", {
        "status": "complete",
        "plan": plan.name,
        "implementation": implementation.name,
        "reviews": [path.name for path in review_paths],
        "repairs": [path.name for path in repair_paths],
        "architecture": architecture.name,
    })
    return run_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("context", nargs="?", help="Task context, or '-' to read it from stdin")
    parser.add_argument("--context-file", help="Read task context from a UTF-8 file")
    parser.add_argument("--check", action="store_true", help="Check local setup without running agents")
    parser.add_argument("--codex-bin", default="codex", help="Codex CLI executable")
    parser.add_argument("--runs-dir", default=str(ROOT / ".harness" / "runs"), help="Where to save handoffs")
    parser.add_argument("--max-fix-rounds", type=int, default=3, help="Maximum repair and verification rounds")
    parser.add_argument("--timeout-minutes", type=int, default=60, help="Timeout per agent session")
    args = parser.parse_args()
    try:
        load_roles()
        if not (ROOT / "AGENTS.md").is_file():
            raise WorkflowError(f"Missing project instructions: {ROOT / 'AGENTS.md'}")
        if not SPEC.is_file():
            raise WorkflowError(f"Missing project specification: {SPEC}")
        codex = codex_path(args.codex_bin)
        if args.max_fix_rounds < 1 or args.timeout_minutes < 1:
            raise WorkflowError("--max-fix-rounds and --timeout-minutes must be positive")
        if args.check:
            print(f"Ready: {ROOT}\nSpecification: {SPEC}\nCodex CLI: {codex}\nRoles: 4")
            return 0
        run_dir = run_workflow(args)
        print(f"Workflow complete. Handoffs: {run_dir}")
        return 0
    except (WorkflowError, OSError, UnicodeError) as error:
        print(f"Workflow stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
