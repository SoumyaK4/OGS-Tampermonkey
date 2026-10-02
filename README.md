# OGS Custom Cosmetics + UI/UX

A Tampermonkey userscript that restores a compact, board-focused layout on Online-Go.com game, review, and demo pages.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the [raw userscript](https://raw.githubusercontent.com/SoumyaK4/OGS-Tampermonkey/main/OGS-Cosmetic.user.js).
3. Confirm the installation in Tampermonkey.

You can download the board theme from [SoumyaK4-OGS-Theme.json](https://github.com/SoumyaK4/OGS-Tampermonkey/blob/main/SoumyaK4-OGS-Theme.json).

The script runs on:

- `https://online-go.com/game/*`
- `https://online-go.com/review/*`
- `https://online-go.com/demo/*`

## Feature switches

Open the script in Tampermonkey's editor. The first code block after the required userscript metadata contains the `FEATURES` switches. Change any `true` to `false`, save, and reload OGS. To disable the whole script, use Tampermonkey's own enable/disable control.

| Switch | Controls |
| --- | --- |
| `compactLayout` | Compact desktop board/sidebar and status banner |
| `logoNavigation` | Replacement logo menu; disable to keep the OGS navbar |
| `goTVIndicator` | Live GoTV count beside the logo; requires `logoNavigation` |
| `customDock` | Right Dock; disable to keep the native toolbar or Dock |
| `customBackground` | Saved background image and Dock background picker |
| `leftAIReview` | AI in the left column, or bottom right when chat is on the left; requires `compactLayout` and a wide desktop window |
| `compactAnalysis` | Aligned analysis tools and one-line move comments |
| `hideMoveControls` | Hide desktop move controls; requires `wheelNavigation` |
| `hideRematch` | Hide the sidebar Rematch button |
| `aiSensei` | Dock's AI Sensei link, on game pages only |
| `tsumegoDragon` | Dock's Tsumego Dragon review link, on game pages only |
| `kifubara` | Dock's Kifubara SGF import button, on game pages only |
| `moveTiming` | Dock's timing chart |
| `wheelNavigation` | Mouse-wheel move navigation and modifiers |
| `altClickNavigation` | Alt + left-click a stone to jump to the node where it was placed |

All switches default to `true`. Dock buttons require `customDock`; turning it off also removes access to its custom actions. Portrait/mobile layouts keep native navigation and controls. Background preferences remain saved when their feature is disabled; choosing **Use OGS Default** restores OGS's own background styling.


## Features

### Board-focused layout

- Restores a wide, compact desktop layout after the OGS GobanView redesign.
- Keeps the Go board horizontally centered between the left analysis area and right game sidebar.
- Uses transparent empty areas so the selected background remains visible.
- Places the compact result or turn banner directly below the player cards.
- Optionally hides desktop top navigation, bottom move controls, and the sidebar Rematch button.
- Leaves clearance for the collapsed right Dock so analysis tools, the game tree, move comments, and variation controls remain usable.
- When chat is on the left, places the game tree and variation sharing controls above it, below the OGS logo.
- Gives the main analysis toolbar rows a consistent width and alignment.
- Reduces move comments to a one-line default while retaining horizontal and vertical resizing.
- Uses fire as the default last-move marker, with a fire-specific upward offset that aligns the flame's base with the stone. Change `BOARD_EFFECTS.marker` to select crab, ladybug, sakura, or a custom image URL.

### OGS logo navigation

- Hover the OGS logo in the upper-left corner to open the replacement navigation menu.
- The GoTV icon beside the logo mirrors OGS's live stream count and links to GoTV. It follows the native indicator's visibility and stream preferences, appearing when OGS shows it for your account.
- Includes nested Play, Learn, Watch, Community, Tools, and account menus.
- Mirrors the live OGS navbar when available, preserving account- and permission-dependent actions.

### Compact right Dock

The Dock expands on hover or keyboard focus and exposes these controls:

- Master sound volume
- Enable AI review
- Download SGF
- Estimate score
- Review this game, conditional moves, and other native actions when OGS makes them available (excluding Analyze, Link to game, Fork game, Call moderator, and Add to library)
- Set Background
- Open the current game in AI Sensei, Tsumego Dragon, or Kifubara (game pages only)
- Full-width Move Timing chart
- Full native Settings and More Actions menus, including Fork game, Call moderator, links, library actions, SGF with comments, and keyboard shortcuts when available

Dock actions delegate to OGS wherever possible, so native dialogs and game behavior remain intact.

Fork game, Call moderator, and Add to library shortcuts are also hidden when using the native desktop right Dock.

The custom Dock always includes **More actions**. It opens OGS's native menu when available; in native Dock mode, it lists OGS's current dock actions, including the three shortcuts hidden above.

Kifubara loads the current game's SGF from OGS and submits it to Kifubara using Tampermonkey's request API with a POST containing `sgf`, `source=OGS-Tampermonkey`, and `platform=ogs`. The SGF travels in the request body to avoid URL-length limits. The script reads the returned review URL and opens that review in the new tab. Tampermonkey may(?) prompt for the Kifubara connection permission.

### Background choices

Set Background offers four persistent choices:

- Repository default: [`wall.png`](./wall.png)
- Original OGS background
- Any image URL
- A local image uploaded from your computer

Background preferences are saved in browser local storage. Very large uploaded images can exceed the browser storage limit; use a smaller image if that happens.

### AI review layout

- Places the native AI win-rate graph, key moves, toggles, and score-type summary in the left column on wide screens. When left-side chat is enabled, AI review sits at the bottom of the right sidebar, below the game and analysis controls.
- Left-side chat shares its column with the game tree and variation sharing controls during analysis. The right sidebar scrolls when the AI graph and summary table need more room.
- Centers the Win % and Score controls.
- Keeps unused parts of the analysis panel transparent.
- Preserves the native AI review controls and data.

### Move Timing

- Uses timing data already loaded by OGS when available.
- Falls back to the matching OGS game or review API record.
- Shows every move in a full-width bar chart at the bottom of the page.
- Highlights the currently displayed move and shows its duration.
- Lets you click a bar to jump directly to that move.

### Mouse-wheel move navigation

Use the mouse wheel over the board:

| Input | Action |
| --- | --- |
| Wheel | Previous or next move |
| Shift + wheel | Back or forward 10 moves |
| Ctrl + wheel | First or last move |

### Alt-click stone navigation

Hold **Alt** and **left-click a stone** to jump to the game-tree node where that stone was placed. The shortcut follows the currently displayed variation and handles stones played again after a capture. Setup stones jump to the position where they were added. Alt-clicking an empty intersection does nothing.

The shortcut is disabled during conditional-move editing and stone removal.

## Screenshots

A lil outdated, but mostly accurate upto 99% of current version.

### Game page with right Dock, and Move Timing

![Game page showing the centered board, AI review panel, expanded right Dock, and full-width Move Timing chart](./fullView.png)

### Review/Analysis/Demo page with left hover menu

![Review page showing the centered board, aligned analysis toolbar, game tree, move comments, and variation controls](./reView.png)

## Notes

- The custom Dock is hidden when OGS switches the board to its portrait/mobile layout.
- Move Timing depends on per-move timing information being present in the OGS record.
- OGS is a frequently updated single-page application. If its internal markup changes, a userscript update may be required.

## Credits

- Mouse-wheel navigation was inspired by [kvwu](https://kvwu.io/).
- The userscript’s Move Timing display replaces the older embedded timing interface; the original integration referenced [ogs-move-timing](https://psalaets.github.io/ogs-move-timing/).

## License

Do whatever you want, IDC. I've tried to include simple comments in the code itself

## My Other Projects

[https://soumyak4.in](https://soumyak4.in)
