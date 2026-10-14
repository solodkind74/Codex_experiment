/*
 * Game rules: boards, ship placement and firing.
 * Pure logic with no DOM access, so it can be loaded in Node for testing.
 */
const Rules = (() => {
    const SIZE = 10;
    const ROWS = 'ABCDEFGHIJ';

    const FLEET = [
        { id: 'carrier', name: 'Carrier', size: 5 },
        { id: 'battleship', name: 'Battleship', size: 4 },
        { id: 'cruiser', name: 'Cruiser', size: 3 },
        { id: 'submarine', name: 'Submarine', size: 3 },
        { id: 'destroyer', name: 'Destroyer', size: 2 }
    ];

    function createBoard() {
        const grid = [];
        for (let r = 0; r < SIZE; r++) {
            const row = [];
            for (let c = 0; c < SIZE; c++) {
                row.push({ ship: null, shot: false, cleared: false });
            }
            grid.push(row);
        }
        return { grid, ships: [] };
    }

    function inBounds(r, c) {
        return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
    }

    // Grid reference as printed on the board, e.g. row 1, col 4 -> "B5".
    function coord(r, c) {
        return ROWS[r] + (c + 1);
    }

    function shipCells(row, col, size, dir) {
        const cells = [];
        for (let i = 0; i < size; i++) {
            cells.push(dir === 'H' ? [row, col + i] : [row + i, col]);
        }
        return cells;
    }

    function neighbors(r, c, diagonals = true) {
        const out = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                if (!diagonals && dr && dc) continue;
                if (inBounds(r + dr, c + dc)) out.push([r + dr, c + dc]);
            }
        }
        return out;
    }

    // Keeps a ship of `size` starting near (row, col) fully on the board.
    function clampStart(row, col, size, dir) {
        const maxRow = dir === 'V' ? SIZE - size : SIZE - 1;
        const maxCol = dir === 'H' ? SIZE - size : SIZE - 1;
        return [Math.max(0, Math.min(row, maxRow)), Math.max(0, Math.min(col, maxCol))];
    }

    function canPlace(board, row, col, size, dir, { allowTouch = false } = {}) {
        for (const [r, c] of shipCells(row, col, size, dir)) {
            if (!inBounds(r, c) || board.grid[r][c].ship) return false;
            if (!allowTouch && neighbors(r, c).some(([nr, nc]) => board.grid[nr][nc].ship)) return false;
        }
        return true;
    }

    function placeShip(board, def, row, col, dir) {
        const ship = {
            id: def.id,
            name: def.name,
            size: def.size,
            row,
            col,
            dir,
            cells: shipCells(row, col, def.size, dir),
            hits: 0,
            sunk: false
        };
        for (const [r, c] of ship.cells) board.grid[r][c].ship = ship;
        board.ships.push(ship);
        return ship;
    }

    function removeShip(board, id) {
        const ship = board.ships.find(s => s.id === id);
        if (!ship) return null;
        for (const [r, c] of ship.cells) board.grid[r][c].ship = null;
        board.ships = board.ships.filter(s => s !== ship);
        return ship;
    }

    function clearShips(board) {
        for (const ship of [...board.ships]) removeShip(board, ship.id);
    }

    // Places the given ship at a uniformly random legal position.
    function placeRandomly(board, def, allowTouch) {
        const options = [];
        for (const dir of ['H', 'V']) {
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    if (canPlace(board, r, c, def.size, dir, { allowTouch })) options.push([r, c, dir]);
                }
            }
        }
        if (!options.length) return null;
        const [r, c, dir] = options[Math.floor(Math.random() * options.length)];
        return placeShip(board, def, r, c, dir);
    }

    // Places every ship not yet on the board, keeping the ones already placed when possible.
    function completeFleet(board, { allowTouch = false } = {}) {
        const missing = FLEET.filter(def => !board.ships.some(s => s.id === def.id));
        if (missing.every(def => placeRandomly(board, def, allowTouch))) return board;
        return placeFleet(board, { allowTouch });
    }

    function placeFleet(board, { allowTouch = false } = {}) {
        for (let attempt = 0; attempt < 100; attempt++) {
            clearShips(board);
            if (FLEET.every(def => placeRandomly(board, def, allowTouch))) return board;
        }
        throw new Error('Could not fit the fleet on the board');
    }

    // Ships that break the "keep one square of water between ships" rule.
    function touchingShipIds(board) {
        const ids = new Set();
        for (const ship of board.ships) {
            for (const [r, c] of ship.cells) {
                for (const [nr, nc] of neighbors(r, c)) {
                    const other = board.grid[nr][nc].ship;
                    if (other && other !== ship) {
                        ids.add(ship.id);
                        ids.add(other.id);
                    }
                }
            }
        }
        return ids;
    }

    function fire(board, r, c) {
        const cell = board.grid[r][c];
        if (cell.shot) return { result: 'repeat' };
        cell.shot = true;
        const ship = cell.ship;
        if (!ship) return { result: 'miss' };
        ship.hits++;
        if (ship.hits === ship.size) {
            ship.sunk = true;
            return { result: 'sunk', ship };
        }
        return { result: 'hit', ship };
    }

    // When ships may not touch, the water around a sunk ship is known to be empty.
    function clearAround(board, ship) {
        const cleared = [];
        for (const [r, c] of ship.cells) {
            for (const [nr, nc] of neighbors(r, c)) {
                const cell = board.grid[nr][nc];
                if (!cell.shot && !cell.ship) {
                    cell.shot = true;
                    cell.cleared = true;
                    cleared.push([nr, nc]);
                }
            }
        }
        return cleared;
    }

    // Removes all shots and damage but keeps the ships where they are.
    function resetBoard(board) {
        for (const row of board.grid) {
            for (const cell of row) {
                cell.shot = false;
                cell.cleared = false;
            }
        }
        for (const ship of board.ships) {
            ship.hits = 0;
            ship.sunk = false;
        }
    }

    function allSunk(board) {
        return board.ships.length > 0 && board.ships.every(s => s.sunk);
    }

    return {
        SIZE,
        ROWS,
        FLEET,
        createBoard,
        inBounds,
        coord,
        shipCells,
        neighbors,
        clampStart,
        canPlace,
        placeShip,
        removeShip,
        clearShips,
        completeFleet,
        placeFleet,
        touchingShipIds,
        fire,
        clearAround,
        resetBoard,
        allSunk
    };
})();

if (typeof module !== 'undefined') module.exports = Rules;
