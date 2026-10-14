# Codex_experiment

## Battleship

A single-player Battleship game for the browser, in plain HTML, CSS and JavaScript with no build step.

Open `battleship/index.html` in a browser to play.

### How a game goes

The game opens on a title screen: a moonlit sea with your battleship and enemy gunfire on the horizon. Press **Set sail** to begin, or **How to play** for the rules.

1. **Deploy your fleet.** Place the Carrier (5), Battleship (4), Cruiser (3), Submarine (3) and Destroyer (2) on your grid. Pick a ship, then click a square to place it. You can drag ships to move them, and press <kbd>R</kbd> or right-click to rotate. **Random fleet** places everything for you, or fills in the ships you haven't placed yet.
2. **Choose your opponent and rules.**
   - **Cadet** fires at random.
   - **Captain** searches in a checkerboard pattern and hunts down ships it has hit.
   - **Admiral** works out where your ships can still be and fires at the most likely square.
   - **Ships may touch** (off by default): when it is off, ships need a square of open water around them, and sinking a ship reveals that water.
   - **A hit earns another shot** (off by default).
3. **Battle.** Take turns firing at enemy waters, either by clicking or with the arrow keys and <kbd>Enter</kbd>. Hits, misses and sunk ships appear on both grids, in the fleet status lists and in the captain's log. Sink all five enemy ships to win.

Your win/loss record, your best win (fewest shots) and your settings are saved in the browser.

### Music and sound

All music and sound effects are synthesized live with the Web Audio API, so the game has no audio files. There is a calm shanty with waves and a ship's bell while you deploy, a march during battle, and fanfares for victory and defeat. Sound starts on your first click, because browsers block audio until the page is used. The buttons in the top corner turn music and effects on or off.

### Code layout

| File | What it does |
| --- | --- |
| `battleship/js/rules.js` | Board, ship placement and firing rules (no DOM, so it also loads in Node) |
| `battleship/js/ai.js` | The three computer opponents |
| `battleship/js/audio.js` | Synthesized music and sound effects |
| `battleship/js/title.js` | Animated title screen scene (canvas) |
| `battleship/js/game.js` | Screens, input, turn flow and rendering |
| `battleship/style.css` | Styling |
