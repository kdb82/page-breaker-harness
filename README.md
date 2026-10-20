# Page Siege

Page Siege is a dependency-free Chrome extension game based on [`game.md`](game.md). A pixel soldier runs and jumps across text, images, and other visible page content. Shots cut holes in those elements. Damage earns points, and ammo crates replenish the selected weapon. All visuals and sounds are generated locally.

## Load and play

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select **`Browser-extension-harness/extension`** (the folder containing `manifest.json`). Do not select the parent project folder, which contains Python workflow files and caches that Chrome cannot package.
3. Open a regular webpage and click the **Page Siege** toolbar icon to start. Click it again or press **Esc** to stop. The extension can be pinned to make its icon easy to find.

Chrome does not permit extension injection into browser internal pages or the Chrome Web Store. The game runs only in the tab where you activate it, until you stop it or navigate away. While it is active, page clicks become shots; wheel scrolling still works. Stopping restores the page's original element styles and click behavior.

| Input | Action |
| --- | --- |
| A / D | Move left / right |
| W | Jump |
| S | Crouch |
| 1 / 2 / 3 / 4 | Pistol / AR / rocket / laser |
| Mouse | Aim |
| Click | Shoot (hold for automatic AR fire) |
| Esc or toolbar icon | Stop |

The pistol and AR hit the pointed location. Rockets damage nearby page elements with a wide blast. The laser cuts a narrow line from the soldier to the pointer. Each weapon has its own ammo supply and generated sound. A glowing ammo crate appears near the soldier periodically; touch it to refill the currently selected weapon if its ammo is low.

## Test range

The local fixture contains text, images, a button, several mask targets, and content below the fold. Serve it so Chrome grants the extension normal page access:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/tests/game-fixture.html`. The button counter is useful for checking cleanup: clicks fire while the game runs and increment the counter after it stops. Try landing on the low and middle labels, then the image, scrolling to lower content, firing every weapon, and shooting an existing hole again. The fading mask target should keep its fade after taking damage. The orange repeating mask target should get one hole at the shot location. The blue luminance mask target should keep its undamaged area visible after a shot. Shoot the padded yellow target to check hole placement with a content-box mask, and the small image near it to check targeting through `pointer-events: none`. Fresh damage increases the score; an identical shot into an empty hole should not.

## Checks

```sh
node --check extension/background.js
node --check extension/content.js
node tests/game-smoke.cjs
python3 -m json.tool extension/manifest.json >/dev/null
python3 -m unittest discover -s tests -v
```

## Agent workflow

[`workflow.py`](workflow.py) runs the project-scoped roles in `.codex/agents/` using the Codex CLI. It creates independent sessions for planning, implementation, scored bug review, repairs, and architecture review. Run `python3 workflow.py --check` to validate its setup or `python3 workflow.py "Build the extension from game.md"` to run the workflow. Run records are saved under `.harness/runs/`.
