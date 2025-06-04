const SHIPS = [
    { name: 'Carrier', size: 5 },
    { name: 'Battleship', size: 4 },
    { name: 'Cruiser', size: 3 },
    { name: 'Submarine', size: 3 },
    { name: 'Destroyer', size: 2 }
];

const playerBoard = [];
const computerBoard = [];
let gameOver = false;

function createBoard(container, board, clickHandler) {
    container.innerHTML = '';
    for (let r = 0; r < 10; r++) {
        board[r] = [];
        for (let c = 0; c < 10; c++) {
            board[r][c] = { hasShip: false, hit: false };
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;
            container.appendChild(cell);
            if (clickHandler) {
                cell.addEventListener('click', clickHandler);
            }
        }
    }
}

function placeShipsRandomly(board) {
    for (const ship of SHIPS) {
        let placed = false;
        while (!placed) {
            const orientation = Math.random() < 0.5 ? 'H' : 'V';
            const row = Math.floor(Math.random() * 10);
            const col = Math.floor(Math.random() * 10);
            if (canPlaceShip(board, row, col, ship.size, orientation)) {
                for (let i = 0; i < ship.size; i++) {
                    const r = orientation === 'H' ? row : row + i;
                    const c = orientation === 'H' ? col + i : col;
                    board[r][c].hasShip = true;
                }
                placed = true;
            }
        }
    }
}

function canPlaceShip(board, row, col, size, orientation) {
    for (let i = 0; i < size; i++) {
        const r = orientation === 'H' ? row : row + i;
        const c = orientation === 'H' ? col + i : col;
        if (r >= 10 || c >= 10 || board[r][c].hasShip) return false;
    }
    return true;
}

function renderBoard(boardEl, board, revealShips = false) {
    const cells = boardEl.querySelectorAll('.cell');
    cells.forEach(cell => {
        const r = +cell.dataset.row;
        const c = +cell.dataset.col;
        const data = board[r][c];
        cell.classList.remove('player-ship', 'hit', 'miss');
        if (data.hasShip && revealShips) {
            cell.classList.add('player-ship');
        }
        if (data.hit) {
            cell.classList.add(data.hasShip ? 'hit' : 'miss');
        }
    });
}

function playerMove(e) {
    if (gameOver) return;
    const r = +e.target.dataset.row;
    const c = +e.target.dataset.col;
    const cell = computerBoard[r][c];
    if (cell.hit) return; // already hit
    cell.hit = true;
    renderBoard(computerBoardEl, computerBoard);
    if (checkWin(computerBoard)) {
        document.getElementById('status').innerText = 'You win!';
        endGame();
        return;
    }
    computerTurn();
}

function computerTurn() {
    let r, c, cell;
    do {
        r = Math.floor(Math.random() * 10);
        c = Math.floor(Math.random() * 10);
        cell = playerBoard[r][c];
    } while (cell.hit);
    cell.hit = true;
    renderBoard(playerBoardEl, playerBoard, true);
    if (checkWin(playerBoard)) {
        document.getElementById('status').innerText = 'Computer wins!';
        endGame();
    }
}

function checkWin(board) {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
            if (board[r][c].hasShip && !board[r][c].hit) {
                return false;
            }
        }
    }
    return true;
}

function endGame() {
    gameOver = true;
    document.getElementById('restart').style.display = 'inline-block';
    renderBoard(computerBoardEl, computerBoard, true);
}

function restartGame() {
    gameOver = false;
    document.getElementById('status').innerText = '';
    document.getElementById('restart').style.display = 'none';
    init();
}

function init() {
    createBoard(playerBoardEl, playerBoard);
    createBoard(computerBoardEl, computerBoard, playerMove);
    placeShipsRandomly(playerBoard);
    placeShipsRandomly(computerBoard);
    renderBoard(playerBoardEl, playerBoard, true);
    renderBoard(computerBoardEl, computerBoard);
}

const playerBoardEl = document.getElementById('player-board');
const computerBoardEl = document.getElementById('computer-board');

init();

document.getElementById('restart').addEventListener('click', restartGame);
