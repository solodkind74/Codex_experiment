/*
 * Screens, input and turn flow.
 * Rules live in rules.js, the computer opponent in ai.js and all audio in audio.js.
 */
(() => {
    const { SIZE, FLEET } = Rules;
    const SETTINGS_KEY = 'battleship.settings';
    const RECORD_KEY = 'battleship.record';
    const LEVELS = { cadet: 'Cadet', captain: 'Captain', admiral: 'Admiral' };
    const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    const $ = id => document.getElementById(id);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const sameCell = (a, b) => (a && b ? a[0] === b[0] && a[1] === b[1] : a === b);
    const fleetDef = id => FLEET.find(d => d.id === id);
    const pct = (hits, shots) => (shots ? `${Math.round((hits / shots) * 100)}%` : '–');

    function load(key, fallback) {
        try {
            return { ...fallback, ...JSON.parse(localStorage.getItem(key)) };
        } catch (e) {
            return { ...fallback };
        }
    }

    function save(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    }

    const state = {
        phase: 'setup',         // 'setup' | 'battle' | 'over'
        settings: load(SETTINGS_KEY, { level: 'captain', allowTouch: false, bonusShot: false }),
        record: load(RECORD_KEY, { wins: 0, losses: 0, best: 0 }),
        onTitle: true,          // the title screen is showing
        home: Rules.createBoard(),
        enemy: null,
        ai: null,
        turn: null,             // 'player' | 'enemy' during battle
        locked: false,          // a shell is in the air
        game: 0,                // bumped on every new game so stale timers stop
        held: null,             // ship in hand during setup: { def, dir, grab, origin }
        hover: null,            // [row, col] under the pointer on your grid
        dir: 'H',               // orientation for the next ship picked from the dock
        drag: null,
        pointerType: 'mouse',
        aim: null,              // [row, col] of the reticle on the enemy grid
        stats: null,
        turnNo: 0
    };

    if (!LEVELS[state.settings.level]) state.settings.level = 'captain';

    /* ---------- board view ---------- */

    class BoardView {
        constructor(el) {
            this.el = el;
            this.cells = [];
            this.rowLabels = [];
            this.colLabels = [];
            this.ghost = null;
            this.marked = null;
            const add = (className, row, col, text = '') => {
                const node = document.createElement('div');
                node.className = className;
                node.style.gridRow = row;
                node.style.gridColumn = col;
                node.textContent = text;
                el.appendChild(node);
                return node;
            };
            add('corner', 1, 1);
            for (let c = 0; c < SIZE; c++) this.colLabels.push(add('label', 1, c + 2, c + 1));
            for (let r = 0; r < SIZE; r++) this.rowLabels.push(add('label', r + 2, 1, Rules.ROWS[r]));
            add('water', '2 / 12', '2 / 12');
            for (let r = 0; r < SIZE; r++) {
                const row = [];
                for (let c = 0; c < SIZE; c++) {
                    const cell = add('cell', r + 2, c + 2);
                    cell.dataset.r = r;
                    cell.dataset.c = c;
                    row.push(cell);
                }
                this.cells.push(row);
            }
        }

        cellAt(target) {
            const cell = target && target.closest ? target.closest('.cell') : null;
            if (!cell || !this.el.contains(cell)) return null;
            return [Number(cell.dataset.r), Number(cell.dataset.c)];
        }

        cellAtPoint(x, y) {
            return this.cellAt(document.elementFromPoint(x, y));
        }

        static place(node, row, col, size, dir) {
            node.style.gridRow = `${row + 2} / span ${dir === 'V' ? size : 1}`;
            node.style.gridColumn = `${col + 2} / span ${dir === 'H' ? size : 1}`;
        }

        drawShips(ships, classFor = () => '') {
            this.el.querySelectorAll('.ship').forEach(node => node.remove());
            for (const ship of ships) {
                const node = document.createElement('div');
                node.className = `ship ${ship.dir === 'H' ? 'h' : 'v'} ${classFor(ship)}`.trim();
                node.dataset.type = ship.id;
                BoardView.place(node, ship.row, ship.col, ship.size, ship.dir);
                this.el.insertBefore(node, this.cells[0][0]);
            }
        }

        syncCells(board, showShips = false) {
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    const cell = board.grid[r][c];
                    const { classList } = this.cells[r][c];
                    classList.toggle('shot', cell.shot);
                    classList.toggle('miss', cell.shot && !cell.ship && !cell.cleared);
                    classList.toggle('cleared', cell.cleared);
                    classList.toggle('hit', cell.shot && !!cell.ship);
                    classList.toggle('sunk', cell.shot && !!cell.ship && cell.ship.sunk);
                    classList.toggle('has-ship', showShips && !!cell.ship);
                }
            }
        }

        showGhost(row, col, size, dir, valid) {
            if (!this.ghost) {
                this.ghost = document.createElement('div');
                this.el.appendChild(this.ghost);
            }
            this.ghost.className = `ghost ${valid ? 'ok' : 'bad'}`;
            BoardView.place(this.ghost, row, col, size, dir);
            this.ghost.hidden = false;
        }

        hideGhost() {
            if (this.ghost) this.ghost.hidden = true;
        }

        // Highlights one square (aim reticle or incoming fire) and its row and column labels.
        mark(pos, kind = 'aim') {
            if (this.marked) {
                const [r, c] = this.marked.pos;
                this.cells[r][c].classList.remove(this.marked.kind);
                this.rowLabels[r].classList.remove('lit');
                this.colLabels[c].classList.remove('lit');
                this.marked = null;
            }
            if (!pos) return;
            const [r, c] = pos;
            this.cells[r][c].classList.add(kind);
            this.rowLabels[r].classList.add('lit');
            this.colLabels[c].classList.add('lit');
            this.marked = { pos, kind };
        }

        impact(r, c, kind) {
            const cell = this.cells[r][c];
            const fx = document.createElement('span');
            fx.className = `fx ${kind}`;
            cell.classList.add('fx-host');
            cell.appendChild(fx);
            const done = () => {
                fx.remove();
                if (!cell.querySelector('.fx')) cell.classList.remove('fx-host');
            };
            fx.addEventListener('animationend', e => { if (e.target === fx) done(); });
            setTimeout(done, 1200);
        }

        shake() {
            this.el.classList.remove('shake');
            void this.el.offsetWidth;
            this.el.classList.add('shake');
        }
    }

    const homeView = new BoardView($('home-board'));
    const enemyView = new BoardView($('enemy-board'));

    function banner(el, text, tone = '') {
        el.textContent = text;
        el.className = `banner ${tone}`;
        void el.offsetWidth;
        el.classList.add('show');
    }

    function setSignal(kind, title, detail) {
        $('signal').dataset.state = kind;
        $('signal-title').textContent = title;
        $('signal-detail').textContent = detail;
    }

    /* ---------- layout ---------- */

    function layout() {
        const { phase } = state;
        $('theatre').dataset.phase = phase;
        $('theatre').dataset.turn = phase === 'battle' && state.turn ? state.turn : '';
        $('enemy-plate').hidden = phase === 'setup';
        $('deploy').hidden = phase !== 'setup';
        $('orders').hidden = phase !== 'setup';
        $('launch').hidden = phase !== 'setup';
        $('log-panel').hidden = phase === 'setup';
        $('home-fleet').hidden = phase === 'setup';
        $('retreat').hidden = phase !== 'battle';
        if (phase !== 'battle') disarmRetreat();
        $('new-battle').hidden = phase !== 'over';
        $('home-board').tabIndex = phase === 'setup' ? 0 : -1;
        $('enemy-board').tabIndex = phase === 'battle' ? 0 : -1;
        if (phase !== 'setup') homeView.hideGhost();
    }

    function renderRecord() {
        const { wins, losses, best } = state.record;
        const text = wins + losses
            ? `Record: ${wins} won, ${losses} lost${best ? ` · Best win: ${best} shots` : ''}`
            : 'No battles fought yet';
        $('record').textContent = text;
        $('title-record').textContent = text;
    }

    /* ---------- title screen ---------- */

    function renderTitleSound() {
        const { music, sfx } = Sound.prefs;
        $('title-sound').textContent = music || sfx
            ? `${music ? 'Music' : 'Sound effects'} will start when you set sail.`
            : 'Music and sound effects are off. You can turn them on in the top corner after you set sail.';
    }

    function setSail() {
        if (!state.onTitle) return;
        state.onTitle = false;
        $('app').inert = false;
        Sound.unlock();
        Sound.horn();
        Sound.music('harbor');
        const screen = $('title-screen');
        screen.classList.add('leaving');
        setTimeout(() => {
            screen.hidden = true;
            TitleScene.stop();
        }, 750);
    }

    function toggleHowTo() {
        const open = $('how-to').hidden;
        $('how-to').hidden = !open;
        $('how-to-toggle').setAttribute('aria-expanded', String(open));
        $('how-to-toggle').textContent = open ? 'Hide rules' : 'How to play';
    }

    function renderSoundControls() {
        const prefs = Sound.prefs;
        $('music-toggle').setAttribute('aria-pressed', String(prefs.music));
        $('sfx-toggle').setAttribute('aria-pressed', String(prefs.sfx));
        $('volume').value = Math.round(prefs.volume * 100);
    }

    /* ---------- setup ---------- */

    function buildDock() {
        const dock = $('dock');
        for (const def of FLEET) {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dock-ship';
            btn.dataset.id = def.id;
            btn.innerHTML = `
                <span class="silhouette" style="--len:${def.size}"></span>
                <span class="dock-name">${def.name}</span>
                <span class="dock-state"></span>`;
            btn.addEventListener('pointerdown', e => onDockPointerDown(e, def.id));
            btn.addEventListener('click', e => {
                // Pointer clicks are handled on pointerdown/up; this is for keyboard users.
                if (e.detail !== 0) return;
                if (state.held && state.held.def.id === def.id) returnHeld();
                else {
                    holdFromDock(def.id);
                    state.hover = state.hover || [0, 0];
                    $('home-board').focus();
                }
                renderSetup();
            });
            li.appendChild(btn);
            dock.appendChild(li);
        }
    }

    function conflicts() {
        return state.settings.allowTouch ? new Set() : Rules.touchingShipIds(state.home);
    }

    function renderSetup() {
        const clash = conflicts();
        homeView.drawShips(state.home.ships, ship => (clash.has(ship.id) ? 'conflict' : ''));
        homeView.syncCells(state.home, true);
        renderGhost();

        for (const btn of document.querySelectorAll('.dock-ship')) {
            const def = fleetDef(btn.dataset.id);
            const held = !!state.held && state.held.def.id === def.id;
            const placed = state.home.ships.some(s => s.id === def.id);
            btn.classList.toggle('held', held);
            btn.classList.toggle('placed', placed);
            btn.setAttribute('aria-pressed', String(held));
            btn.querySelector('.dock-state').textContent = held ? 'In hand' : placed ? 'Placed' : `${def.size} squares`;
        }

        const placed = state.home.ships.length;
        const complete = placed === FLEET.length;
        const ready = complete && !clash.size;
        $('start').disabled = !ready;
        const inHand = state.held && state.held.origin ? 1 : 0;
        $('randomize').textContent = placed && placed + inHand < FLEET.length ? 'Place the rest' : 'Random fleet';
        const vertical = (state.held ? state.held.dir : state.dir) === 'V';
        $('dir-badge').textContent = vertical ? '↕' : '↔';
        $('rotate').setAttribute('aria-label', `Rotate, currently ${vertical ? 'vertical' : 'horizontal'}`);

        const status = $('deploy-status');
        status.classList.toggle('warn', clash.size > 0);
        status.textContent = clash.size
            ? 'Some ships are touching. Move them apart, or allow ships to touch.'
            : complete ? 'Fleet ready.' : `${placed} of ${FLEET.length} ships placed`;

        $('touch-note').textContent = state.settings.allowTouch
            ? 'Ships can sit side by side, as in the original board game.'
            : 'Ships need a square of open water around them. Sinking a ship reveals that water.';

        if (ready) setSignal('setup', 'Fleet ready', 'Start the battle when you are ready.');
        else if (state.held) setSignal('setup', 'Deploy your fleet', `Place your ${state.held.def.name.toLowerCase()} (${state.held.def.size} squares).`);
        else setSignal('setup', 'Deploy your fleet', 'Place all five ships on your grid.');
    }

    // Where the ship in hand would land, kept on the board and anchored on the square that was grabbed.
    function ghostPlacement() {
        const { held, hover } = state;
        if (!held || !hover) return null;
        let [row, col] = hover;
        if (held.dir === 'H') col -= held.grab;
        else row -= held.grab;
        [row, col] = Rules.clampStart(row, col, held.def.size, held.dir);
        const valid = Rules.canPlace(state.home, row, col, held.def.size, held.dir, { allowTouch: state.settings.allowTouch });
        return { row, col, valid };
    }

    function renderGhost() {
        const spot = ghostPlacement();
        if (!spot) homeView.hideGhost();
        else homeView.showGhost(spot.row, spot.col, state.held.def.size, state.held.dir, spot.valid);
    }

    function hold(def, { dir = state.dir, grab = 0, origin = null } = {}) {
        state.held = { def, dir, grab: Math.min(grab, def.size - 1), origin };
    }

    // Puts a ship that was picked up from the grid back where it came from.
    function returnHeld() {
        const held = state.held;
        state.held = null;
        if (held && held.origin) {
            const { row, col, dir } = held.origin;
            if (Rules.canPlace(state.home, row, col, held.def.size, dir, { allowTouch: true })) {
                Rules.placeShip(state.home, held.def, row, col, dir);
            }
        }
    }

    function holdFromDock(id) {
        returnHeld();
        const placed = Rules.removeShip(state.home, id);
        hold(fleetDef(id), placed
            ? { dir: placed.dir, origin: { row: placed.row, col: placed.col, dir: placed.dir } }
            : { dir: state.dir });
        Sound.pickup();
    }

    function pickUp(ship, [r, c]) {
        returnHeld();
        const grab = ship.dir === 'H' ? c - ship.col : r - ship.row;
        Rules.removeShip(state.home, ship.id);
        hold(fleetDef(ship.id), { dir: ship.dir, grab, origin: { row: ship.row, col: ship.col, dir: ship.dir } });
        Sound.pickup();
    }

    function holdNextShip() {
        const next = FLEET.find(def => !state.home.ships.some(s => s.id === def.id));
        if (next) hold(next);
    }

    function placeHeld() {
        const spot = ghostPlacement();
        if (!spot) return false;
        if (!spot.valid) {
            Sound.invalid();
            return false;
        }
        Rules.placeShip(state.home, state.held.def, spot.row, spot.col, state.held.dir);
        state.dir = state.held.dir;
        state.held = null;
        Sound.place();
        // Hand over the next ship so the whole fleet can go down with one tap each.
        holdNextShip();
        if (state.pointerType === 'touch') state.hover = null;
        renderSetup();
        return true;
    }

    function rotate() {
        if (state.held) state.held.dir = state.held.dir === 'H' ? 'V' : 'H';
        state.dir = state.held ? state.held.dir : state.dir === 'H' ? 'V' : 'H';
        Sound.rotate();
        renderSetup();
    }

    // Right-clicking a placed ship turns it in place when there is room.
    function rotatePlaced(ship) {
        const dir = ship.dir === 'H' ? 'V' : 'H';
        const def = fleetDef(ship.id);
        Rules.removeShip(state.home, ship.id);
        const [row, col] = Rules.clampStart(ship.row, ship.col, ship.size, dir);
        if (Rules.canPlace(state.home, row, col, ship.size, dir, { allowTouch: state.settings.allowTouch })) {
            Rules.placeShip(state.home, def, row, col, dir);
            Sound.rotate();
        } else {
            Rules.placeShip(state.home, def, ship.row, ship.col, ship.dir);
            Sound.invalid();
        }
        renderSetup();
    }

    function onDockPointerDown(e, id) {
        if (state.phase !== 'setup' || e.button !== 0) return;
        e.preventDefault();
        const wasHeld = !!state.held && state.held.def.id === id;
        if (!wasHeld) holdFromDock(id);
        state.pointerType = e.pointerType;
        state.drag = { id: e.pointerId, from: 'dock', x: e.clientX, y: e.clientY, moved: false, wasHeld };
        renderSetup();
    }

    function onBoardPointerDown(e) {
        if (state.phase !== 'setup' || e.button !== 0) return;
        const pos = homeView.cellAt(e.target);
        if (!pos) return;
        e.preventDefault();
        state.pointerType = e.pointerType;
        state.hover = pos;
        const ship = state.home.grid[pos[0]][pos[1]].ship;
        if (ship) pickUp(ship, pos);
        state.drag = { id: e.pointerId, from: 'board', start: pos, moved: false, pickedUp: !!ship };
        renderSetup();
    }

    function onPointerMove(e) {
        if (state.phase !== 'setup') return;
        const pos = homeView.cellAtPoint(e.clientX, e.clientY);
        const drag = state.drag;
        if (drag && drag.id === e.pointerId) {
            if (drag.from === 'dock' && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
            if (drag.from === 'board' && pos && !sameCell(pos, drag.start)) drag.moved = true;
        }
        if (!sameCell(pos, state.hover)) {
            state.hover = pos;
            renderGhost();
        }
    }

    function onPointerUp(e) {
        const drag = state.drag;
        if (!drag || drag.id !== e.pointerId || state.phase !== 'setup') return;
        state.drag = null;
        const pos = homeView.cellAtPoint(e.clientX, e.clientY);
        if (!state.held) return renderSetup();

        if (drag.from === 'dock') {
            if (pos && drag.moved) {
                state.hover = pos;
                placeHeld();
            } else if (!drag.moved && drag.wasHeld) {
                // A second tap on the ship in hand puts it down again.
                returnHeld();
                renderSetup();
            }
            return;
        }

        // A plain click on a placed ship picks it up; it then follows the pointer until the next click.
        if (drag.pickedUp && !drag.moved) return renderSetup();
        if (pos) {
            state.hover = pos;
            if (placeHeld()) return;
        }
        // A dragged ship dropped somewhere it can't go returns to where it was.
        if (drag.pickedUp) {
            returnHeld();
            renderSetup();
        }
    }

    function onPointerCancel(e) {
        const drag = state.drag;
        if (!drag || drag.id !== e.pointerId) return;
        state.drag = null;
        if (drag.pickedUp) returnHeld();
        if (state.phase === 'setup') renderSetup();
    }

    function onSetupKey(e) {
        const onBoard = document.activeElement === $('home-board');
        if ((e.code === 'KeyR' || e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            rotate();
        } else if (e.key === 'Escape' && state.held) {
            returnHeld();
            renderSetup();
        } else if (onBoard && ARROWS[e.key]) {
            e.preventDefault();
            if (!state.held) holdNextShip();
            const [dr, dc] = ARROWS[e.key];
            const [r, c] = state.hover || [0, 0];
            state.hover = [Math.max(0, Math.min(SIZE - 1, r + dr)), Math.max(0, Math.min(SIZE - 1, c + dc))];
            renderSetup();
        } else if (onBoard && (e.key === 'Enter' || e.key === ' ') && state.held) {
            e.preventDefault();
            state.hover = state.hover || [0, 0];
            placeHeld();
        }
    }

    function randomFleet() {
        returnHeld();
        const allowTouch = state.settings.allowTouch;
        const placed = state.home.ships.length;
        if (placed && placed < FLEET.length && !conflicts().size) Rules.completeFleet(state.home, { allowTouch });
        else Rules.placeFleet(state.home, { allowTouch });
        Sound.place();
        renderSetup();
    }

    function clearFleet() {
        returnHeld();
        Rules.clearShips(state.home);
        hold(FLEET[0]);
        Sound.rotate();
        renderSetup();
    }

    /* ---------- battle ---------- */

    function startBattle() {
        if (state.phase !== 'setup' || $('start').disabled) return;
        const { level, allowTouch } = state.settings;
        state.phase = 'battle';
        state.game++;
        state.held = null;
        state.hover = null;
        state.drag = null;
        state.aim = null;
        state.locked = false;
        state.turnNo = 0;
        Rules.resetBoard(state.home);
        state.enemy = Rules.createBoard();
        Rules.placeFleet(state.enemy, { allowTouch });
        state.ai = AI.create(level, { allowTouch });
        state.stats = { shots: 0, hits: 0, enemyShots: 0, enemyHits: 0, started: Date.now() };
        $('log').innerHTML = '';
        $('home-banner').className = 'banner';
        $('enemy-banner').className = 'banner';
        $('rules-summary').textContent = [
            `vs ${LEVELS[level]}`,
            allowTouch ? 'ships may touch' : 'ships kept apart',
            state.settings.bonusShot ? 'hits fire again' : ''
        ].filter(Boolean).join(' · ');
        setTurn('player');
        renderBattle();
        log('bridge', 'Battle stations. You have the first shot.');
        Sound.ping();
        Sound.music('battle');
        const top = $('signal').getBoundingClientRect().top;
        if (top < 0) $('signal').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function setTurn(turn, detail) {
        state.turn = turn;
        layout();
        if (turn === 'player') setSignal('you', 'Your shot', detail || 'Pick a square in enemy waters.');
        else setSignal('enemy', 'Incoming fire', detail || 'The enemy is choosing a target.');
    }

    function renderBattle() {
        const reveal = state.phase === 'over';
        homeView.drawShips(state.home.ships, ship => (ship.sunk ? 'sunk' : ''));
        homeView.syncCells(state.home);
        enemyView.drawShips(state.enemy.ships.filter(ship => ship.sunk || reveal), ship => (ship.sunk ? 'wreck' : 'revealed'));
        enemyView.syncCells(state.enemy);
        renderFleet($('home-fleet'), state.home, true);
        renderFleet($('enemy-fleet'), state.enemy, false);
        const afloat = board => board.ships.filter(s => !s.sunk).length;
        $('home-meta').textContent = `${afloat(state.home)} of ${FLEET.length} afloat`;
        $('enemy-meta').textContent = `${afloat(state.enemy)} of ${FLEET.length} afloat`;
        renderTally();
    }

    // Your own damage is shown square by square; for the enemy you only learn when a ship sinks.
    function renderFleet(list, board, own) {
        list.innerHTML = '';
        for (const def of FLEET) {
            const ship = board.ships.find(s => s.id === def.id);
            const damage = ship.sunk ? def.size : own ? ship.hits : 0;
            const li = document.createElement('li');
            li.className = `fleet-item${ship.sunk ? ' sunk' : ''}`;
            const pips = Array.from({ length: def.size }, (_, i) => `<i class="${i < damage ? 'hit' : ''}"></i>`).join('');
            li.innerHTML = `
                <span class="fleet-name">${def.name}${ship.sunk ? '<span class="sunk-tag">Sunk</span>' : ''}</span>
                <span class="pips" aria-label="${damage} of ${def.size} squares hit">${pips}</span>`;
            list.appendChild(li);
        }
    }

    function renderTally() {
        const s = state.stats;
        $('tally').innerHTML = `
            <thead><tr><th></th><th>Shots</th><th>Hits</th><th>Accuracy</th></tr></thead>
            <tbody>
                <tr><th>You</th><td>${s.shots}</td><td>${s.hits}</td><td>${pct(s.hits, s.shots)}</td></tr>
                <tr><th>Enemy</th><td>${s.enemyShots}</td><td>${s.enemyHits}</td><td>${pct(s.enemyHits, s.enemyShots)}</td></tr>
            </tbody>`;
    }

    function log(who, text, tone = '') {
        const list = $('log');
        const li = document.createElement('li');
        li.className = `entry ${who} ${tone}`.trim();
        const label = { you: 'You', enemy: 'Enemy', bridge: 'Bridge' }[who];
        li.innerHTML = `<span class="turn">${String(state.turnNo).padStart(2, '0')}</span><span class="who">${label}</span><span class="what"></span>`;
        li.querySelector('.what').textContent = text;
        list.prepend(li);
        while (list.children.length > 120) list.lastChild.remove();
    }

    async function playerFire([r, c]) {
        if (state.phase !== 'battle' || state.turn !== 'player' || state.locked) return;
        if (state.enemy.grid[r][c].shot) {
            Sound.invalid();
            return;
        }
        const game = state.game;
        const ref = Rules.coord(r, c);
        state.locked = true;
        state.turnNo++;
        enemyView.mark([r, c]);
        setSignal('you', 'Shot away', `Firing at ${ref}.`);
        Sound.cannon();
        Sound.whistle();
        await sleep(520);
        if (game !== state.game) return;

        const shot = Rules.fire(state.enemy, r, c);
        state.stats.shots++;
        if (shot.result === 'miss') {
            enemyView.impact(r, c, 'splash');
            Sound.splash();
            log('you', `${ref}. Miss.`);
        } else {
            state.stats.hits++;
            enemyView.impact(r, c, 'blast');
            Sound.explosion();
            if (shot.result === 'sunk') {
                Sound.sink();
                log('you', `${ref}. Hit. Enemy ${shot.ship.name.toLowerCase()} sunk!`, 'sunk');
                if (shot.ship.id === 'battleship') log('enemy', '“You sank my battleship!”', 'quote');
                banner($('enemy-banner'), `${shot.ship.name} sunk`);
                if (!state.settings.allowTouch) Rules.clearAround(state.enemy, shot.ship);
            } else {
                log('you', `${ref}. Hit!`, 'hit');
            }
        }
        renderBattle();
        if (Rules.allSunk(state.enemy)) return endGame(true);

        state.locked = false;
        if (shot.result !== 'miss' && state.settings.bonusShot) {
            setTurn('player', 'Hit! Take another shot.');
            return;
        }
        enemyTurn(game, shot.result === 'sunk' ? 900 : 0);
    }

    async function enemyTurn(game, pause = 0) {
        setTurn('enemy');
        await sleep(pause);
        for (;;) {
            await sleep(550 + Math.random() * 450);
            if (game !== state.game) return;
            let [r, c] = state.ai.nextShot();
            if (state.home.grid[r][c].shot) [r, c] = randomOpenSquare(state.home);
            const ref = Rules.coord(r, c);
            homeView.mark([r, c], 'incoming');
            setSignal('enemy', 'Incoming fire', `Shell inbound at ${ref}.`);
            Sound.cannon(true);
            Sound.whistle(true);
            await sleep(600);
            if (game !== state.game) return;

            homeView.mark(null);
            const shot = Rules.fire(state.home, r, c);
            state.ai.record(r, c, shot.result, shot.ship ? shot.ship.cells : []);
            state.stats.enemyShots++;
            if (shot.result === 'miss') {
                homeView.impact(r, c, 'splash');
                Sound.splash();
                log('enemy', `${ref}. Miss.`);
            } else {
                state.stats.enemyHits++;
                homeView.impact(r, c, 'blast');
                homeView.shake();
                Sound.explosion();
                const name = shot.ship.name.toLowerCase();
                if (shot.result === 'sunk') {
                    Sound.sink();
                    log('enemy', `${ref}. Your ${name} is sunk.`, 'sunk');
                    banner($('home-banner'), `${shot.ship.name} lost`, 'loss');
                    if (!state.settings.allowTouch) Rules.clearAround(state.home, shot.ship);
                } else {
                    log('enemy', `${ref}. Your ${name} is hit.`, 'hit');
                }
            }
            renderBattle();
            if (Rules.allSunk(state.home)) return endGame(false);
            if (shot.result === 'miss' || !state.settings.bonusShot) break;
            setSignal('enemy', 'Incoming fire', 'The enemy scored a hit and fires again.');
            await sleep(shot.result === 'sunk' ? 900 : 0);
        }
        setTurn('player');
    }

    function randomOpenSquare(board) {
        const open = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) if (!board.grid[r][c].shot) open.push([r, c]);
        }
        return open[Math.floor(Math.random() * open.length)];
    }

    function onTargetKey(e) {
        if (state.phase !== 'battle') return;
        if (ARROWS[e.key]) {
            e.preventDefault();
            const [dr, dc] = ARROWS[e.key];
            const [r, c] = state.aim || [4, 4];
            state.aim = [Math.max(0, Math.min(SIZE - 1, r + dr)), Math.max(0, Math.min(SIZE - 1, c + dc))];
            enemyView.mark(state.aim);
        } else if ((e.key === 'Enter' || e.key === ' ') && state.aim) {
            e.preventDefault();
            playerFire(state.aim);
        }
    }

    function endGame(won) {
        state.phase = 'over';
        state.turn = null;
        state.locked = false;
        const newBest = won && (!state.record.best || state.stats.shots < state.record.best);
        if (won) state.record.wins++;
        else state.record.losses++;
        if (newBest) state.record.best = state.stats.shots;
        state.newBest = newBest;
        save(RECORD_KEY, state.record);
        renderRecord();
        enemyView.mark(null);
        homeView.mark(null);
        layout();
        renderBattle();
        setSignal(won ? 'won' : 'lost', won ? 'Victory' : 'Defeat',
            won ? 'The enemy fleet is on the bottom of the sea.' : 'Your fleet has been sunk. The enemy ships still afloat are now shown.');
        log('bridge', won ? 'All enemy ships sunk. Victory.' : 'Our last ship is gone. Defeat.', 'sunk');
        Sound.stinger(won ? 'victory' : 'defeat');
        const game = state.game;
        setTimeout(() => {
            if (state.game === game && state.phase === 'over') showDebrief(won);
        }, 1600);
    }

    function showDebrief(won) {
        const s = state.stats;
        const seconds = Math.round((Date.now() - s.started) / 1000);
        const lost = state.home.ships.filter(ship => ship.sunk).length;
        const left = state.enemy.ships.filter(ship => !ship.sunk).length;
        $('debrief').dataset.result = won ? 'won' : 'lost';
        $('debrief-title').textContent = won ? 'Victory' : 'Defeat';
        $('debrief-text').textContent = won
            ? `You sank the enemy fleet in ${s.shots} shots${lost ? ` and lost ${lost} ${lost === 1 ? 'ship' : 'ships'}` : ' without losing a ship'}.${state.newBest && state.record.wins > 1 ? ' That is your best win yet.' : ''}`
            : `The ${LEVELS[state.settings.level].toLowerCase()} sank your fleet in ${s.enemyShots} shots. ${left} enemy ${left === 1 ? 'ship was' : 'ships were'} still afloat.`;
        const stats = [
            ['Shots', s.shots],
            ['Hits', s.hits],
            ['Accuracy', pct(s.hits, s.shots)],
            ['Enemy sunk', `${FLEET.length - left}/${FLEET.length}`],
            ['Ships lost', `${lost}/${FLEET.length}`],
            ['Time', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`]
        ];
        $('debrief-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
        $('debrief').hidden = false;
        $('app').inert = true;
        $('play-again').focus();
    }

    function hideDebrief() {
        $('debrief').hidden = true;
        $('app').inert = false;
    }

    // Back to the deployment screen, keeping the fleet where it was.
    function toSetup() {
        state.game++;
        state.phase = 'setup';
        state.enemy = null;
        state.ai = null;
        state.turn = null;
        state.locked = false;
        state.aim = null;
        hideDebrief();
        enemyView.mark(null);
        homeView.mark(null);
        Rules.resetBoard(state.home);
        state.held = null;
        holdNextShip();
        layout();
        renderSetup();
        Sound.music('harbor');
    }

    /* ---------- wiring ---------- */

    let retreatTimer = null;
    function disarmRetreat() {
        clearTimeout(retreatTimer);
        delete $('retreat').dataset.confirm;
        $('retreat').textContent = 'Retreat';
    }

    function onRetreat() {
        const btn = $('retreat');
        if (btn.dataset.confirm) {
            disarmRetreat();
            toSetup();
            return;
        }
        btn.dataset.confirm = '1';
        btn.textContent = 'Tap again to retreat';
        retreatTimer = setTimeout(disarmRetreat, 3000);
    }

    function wire() {
        buildDock();
        const homeBoard = $('home-board');
        const enemyBoard = $('enemy-board');

        // Browsers only allow audio after the first interaction.
        document.addEventListener('pointerdown', () => Sound.unlock(), true);
        document.addEventListener('keydown', () => Sound.unlock(), true);

        homeBoard.addEventListener('pointerdown', onBoardPointerDown);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerCancel);
        homeBoard.addEventListener('contextmenu', e => {
            if (state.phase !== 'setup') return;
            e.preventDefault();
            const pos = homeView.cellAt(e.target);
            const ship = pos && state.home.grid[pos[0]][pos[1]].ship;
            if (!state.held && ship) rotatePlaced(ship);
            else rotate();
        });
        homeBoard.addEventListener('focus', () => {
            if (state.phase === 'setup' && state.held && !state.hover && homeBoard.matches(':focus-visible')) {
                state.hover = [0, 0];
                renderGhost();
            }
        });

        enemyBoard.addEventListener('pointermove', e => {
            if (state.phase !== 'battle' || state.locked) return;
            const pos = enemyView.cellAt(e.target);
            if (pos && !sameCell(pos, state.aim)) {
                state.aim = pos;
                enemyView.mark(pos);
            }
        });
        enemyBoard.addEventListener('pointerleave', () => {
            if (state.phase !== 'battle' || state.locked) return;
            state.aim = null;
            enemyView.mark(null);
        });
        enemyBoard.addEventListener('click', e => {
            const pos = enemyView.cellAt(e.target);
            if (pos) {
                state.aim = pos;
                playerFire(pos);
            }
        });
        enemyBoard.addEventListener('keydown', onTargetKey);
        enemyBoard.addEventListener('focus', () => {
            if (state.phase === 'battle' && enemyBoard.matches(':focus-visible')) {
                state.aim = state.aim || [4, 4];
                enemyView.mark(state.aim);
            }
        });

        $('set-sail').addEventListener('click', setSail);
        $('how-to-toggle').addEventListener('click', toggleHowTo);

        document.addEventListener('keydown', e => {
            if (state.onTitle) {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === document.body) {
                    e.preventDefault();
                    setSail();
                }
                return;
            }
            if (e.target.matches('input, select, textarea')) return;
            if (state.phase === 'setup') onSetupKey(e);
            else if (e.key === 'Escape' && !$('debrief').hidden) hideDebrief();
        });

        $('rotate').addEventListener('click', rotate);
        $('randomize').addEventListener('click', randomFleet);
        $('clear').addEventListener('click', clearFleet);
        $('start').addEventListener('click', startBattle);
        $('retreat').addEventListener('click', onRetreat);
        $('new-battle').addEventListener('click', toSetup);
        $('play-again').addEventListener('click', toSetup);
        $('view-boards').addEventListener('click', hideDebrief);
        $('debrief').addEventListener('click', e => { if (e.target === $('debrief')) hideDebrief(); });

        for (const input of document.querySelectorAll('input[name="level"]')) {
            input.checked = input.value === state.settings.level;
            input.addEventListener('change', () => {
                state.settings.level = input.value;
                save(SETTINGS_KEY, state.settings);
                Sound.tick();
            });
        }
        $('allow-touch').checked = state.settings.allowTouch;
        $('allow-touch').addEventListener('change', e => {
            state.settings.allowTouch = e.target.checked;
            save(SETTINGS_KEY, state.settings);
            Sound.tick();
            renderSetup();
        });
        $('bonus-shot').checked = state.settings.bonusShot;
        $('bonus-shot').addEventListener('change', e => {
            state.settings.bonusShot = e.target.checked;
            save(SETTINGS_KEY, state.settings);
            Sound.tick();
        });

        $('music-toggle').addEventListener('click', () => {
            Sound.setMusic(!Sound.prefs.music);
            renderSoundControls();
            renderTitleSound();
        });
        $('sfx-toggle').addEventListener('click', () => {
            Sound.setSfx(!Sound.prefs.sfx);
            renderSoundControls();
            renderTitleSound();
        });
        $('volume').addEventListener('input', e => Sound.setVolume(Number(e.target.value) / 100, false));
        $('volume').addEventListener('change', e => Sound.setVolume(Number(e.target.value) / 100));
    }

    wire();
    renderRecord();
    renderSoundControls();
    renderTitleSound();
    $('app').inert = true;
    TitleScene.init($('title-scene'));
    hold(FLEET[0]);
    layout();
    renderSetup();
})();
