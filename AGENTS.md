# Project goal

Build the browser extension game described in `game.md`. Treat `game.md` as the source of truth for game behavior and constraints.

This project uses the role instructions in `.codex/agents/` and the workflow in `workflow.py`. Keep implementations readable and verify the behavior you change.

The loadable Chrome extension is the `extension/` directory. Keep Python files, tests, workflow outputs, caches, and documentation outside it. Tell users to select `extension/` with Chrome's **Load unpacked** action.

Do not launch Chrome or another browser from an agent session, including headless mode. Browser launches in this macOS agent environment abort during app registration and create crash dialogs. Use the Node gameplay smoke checks and workflow tests here; leave rendered browser checks as manual steps for the user.
