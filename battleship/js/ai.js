/*
 * Computer opponent. It only uses what a real player would know:
 * where it has hit or missed, and which ship sank.
 *
 *   cadet   - fires at random and only sometimes follows up on a hit
 *   captain - searches in a checkerboard pattern and hunts down damaged ships
 *   admiral - counts every way the remaining ships could still fit and fires
 *             at the square most likely to hold one
 */
const AI = (() => {
    const UNKNOWN = 0;
    const EMPTY = 1;
    const HIT = 2;
    const SUNK = 3;
    const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    const pick = list => list[Math.floor(Math.random() * list.length)];

    function create(level, { allowTouch = false } = {}) {
        const size = Rules.SIZE;
        const known = Array.from({ length: size }, () => Array(size).fill(UNKNOWN));
        const remaining = Rules.FLEET.map(s => s.size);
        const parity = Math.random() < 0.5 ? 0 : 1;

        const state = (r, c) => (Rules.inBounds(r, c) ? known[r][c] : EMPTY);
        const isUnknown = (r, c) => state(r, c) === UNKNOWN;
        const isHit = (r, c) => state(r, c) === HIT;

        function cellsWith(value) {
            const out = [];
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (known[r][c] === value) out.push([r, c]);
                }
            }
            return out;
        }

        function adjacentUnknown(cells) {
            const out = [];
            for (const [r, c] of cells) {
                for (const [dr, dc] of ORTHOGONAL) {
                    if (isUnknown(r + dr, c + dc)) out.push([r + dr, c + dc]);
                }
            }
            return out;
        }

        // Could a ship of `len` still lie across (r, c)?
        function fits(r, c, len) {
            for (const [dr, dc] of [[0, 1], [1, 0]]) {
                let run = 1;
                for (let i = 1; i < len && [UNKNOWN, HIT].includes(state(r + dr * i, c + dc * i)); i++) run++;
                for (let i = 1; i < len && [UNKNOWN, HIT].includes(state(r - dr * i, c - dc * i)); i++) run++;
                if (run >= len) return true;
            }
            return false;
        }

        function cadetShot() {
            const hits = cellsWith(HIT);
            if (hits.length && Math.random() < 0.5) {
                const near = adjacentUnknown(hits);
                if (near.length) return pick(near);
            }
            return pick(cellsWith(UNKNOWN));
        }

        // Follow up on damaged ships: extend a line of hits, or probe around a single hit.
        function targetShot() {
            const hits = cellsWith(HIT);
            if (!hits.length) return null;
            const lineEnds = [];
            for (const [r, c] of hits) {
                for (const [dr, dc] of [[0, 1], [1, 0]]) {
                    if (!isHit(r + dr, c + dc) && !isHit(r - dr, c - dc)) continue;
                    let r1 = r, c1 = c, r0 = r, c0 = c;
                    while (isHit(r1 + dr, c1 + dc)) { r1 += dr; c1 += dc; }
                    while (isHit(r0 - dr, c0 - dc)) { r0 -= dr; c0 -= dc; }
                    if (isUnknown(r1 + dr, c1 + dc)) lineEnds.push([r1 + dr, c1 + dc]);
                    if (isUnknown(r0 - dr, c0 - dc)) lineEnds.push([r0 - dr, c0 - dc]);
                }
            }
            if (lineEnds.length) return pick(lineEnds);
            const near = adjacentUnknown(hits);
            return near.length ? pick(near) : null;
        }

        function huntShot() {
            const smallest = Math.min(...remaining);
            const open = cellsWith(UNKNOWN).filter(([r, c]) => fits(r, c, smallest));
            const checkered = open.filter(([r, c]) => (r + c) % 2 === parity);
            return pick(checkered.length ? checkered : open.length ? open : cellsWith(UNKNOWN));
        }

        function densityShot() {
            const hits = cellsWith(HIT);
            const targeting = hits.length > 0;
            const score = Array.from({ length: size }, () => Array(size).fill(0));
            for (const len of remaining) {
                for (const dir of ['H', 'V']) {
                    for (let r = 0; r < size; r++) {
                        for (let c = 0; c < size; c++) {
                            const cells = Rules.shipCells(r, c, len, dir);
                            if (cells.some(([cr, cc]) => [EMPTY, SUNK].includes(state(cr, cc)))) continue;
                            const covered = cells.filter(([cr, cc]) => isHit(cr, cc)).length;
                            // While a damaged ship is afloat, only placements that explain the hits count.
                            if (targeting && !covered) continue;
                            const weight = targeting ? Math.pow(6, covered) : 1;
                            for (const [cr, cc] of cells) {
                                if (known[cr][cc] === UNKNOWN) score[cr][cc] += weight;
                            }
                        }
                    }
                }
            }
            let best = 0;
            let choices = [];
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (score[r][c] > best) {
                        best = score[r][c];
                        choices = [[r, c]];
                    } else if (score[r][c] === best && best > 0) {
                        choices.push([r, c]);
                    }
                }
            }
            if (choices.length) return pick(choices);
            return targetShot() || huntShot();
        }

        function nextShot() {
            if (level === 'cadet') return cadetShot();
            if (level === 'admiral') return densityShot();
            return targetShot() || huntShot();
        }

        // result: 'miss' | 'hit' | 'sunk'; shipCells is given when a ship sinks.
        function record(r, c, result, shipCells = []) {
            if (result === 'miss') {
                known[r][c] = EMPTY;
                return;
            }
            known[r][c] = HIT;
            // Ships can't touch, so the diagonal squares next to a hit must be water.
            if (!allowTouch && level !== 'cadet') {
                for (const [nr, nc] of Rules.neighbors(r, c)) {
                    if (nr !== r && nc !== c && known[nr][nc] === UNKNOWN) known[nr][nc] = EMPTY;
                }
            }
            if (result !== 'sunk') return;
            for (const [sr, sc] of shipCells) known[sr][sc] = SUNK;
            const index = remaining.indexOf(shipCells.length);
            if (index !== -1) remaining.splice(index, 1);
            if (!allowTouch) {
                for (const [sr, sc] of shipCells) {
                    for (const [nr, nc] of Rules.neighbors(sr, sc)) {
                        if (known[nr][nc] === UNKNOWN) known[nr][nc] = EMPTY;
                    }
                }
            }
        }

        return { nextShot, record };
    }

    return { create };
})();

if (typeof module !== 'undefined') module.exports = AI;
