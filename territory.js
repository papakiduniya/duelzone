// ═══════════════════════════════════════════════════════════════
// DuelZone · Territory Wars  (territory.js)  — v2 FIXED
//
// FIXES vs v1:
//  1. Player with NO MOVES is immediately defeated (not just board-full check)
//  2. After each turn, check if next player is stuck → end game immediately
//  3. isBoardFull() renamed to noMovesLeft(player) — used correctly per-player
//  4. twCapture: removed dead/broken nc2 variable (was `col` instead of `nc`)
//  5. twFloodCapture: was correct but now only runs after own placement (not per-cell loop)
//  6. twEndTurn: checks if NEXT player has moves; if not, they lose
//  7. Bot: if bot has no moves, ends game as defeat for bot
//  8. Turn indicator correctly shows "Bot" in bot mode
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var GRID_W = 16, GRID_H = 12;
  var CELL   = 38;

  function calcCellSize() {
    var availW = Math.floor((window.innerWidth - 20) / GRID_W);
    var availH = Math.floor((window.innerHeight - 120) / GRID_H);
    CELL = Math.max(22, Math.min(38, availW, availH));
  }
  var EMPTY  = 0, P1 = 1, P2 = 2;

  var TW = {
    mode: 'pvp', diff: 'medium', over: false,
    grid: [], turn: 1,
    scores: [0, 0],
    botTimer: null,
    _wired: false,
    cursor: { r: 0, c: 0 },   // joystick-driven grid cursor
  };

  window.territoryInit    = function () { if (!TW._wired) { twWireUI(); TW._wired = true; } twShowHome(); };
  window.territoryDestroy = function () { twStop(); };

  function el(id)         { return document.getElementById(id); }
  function on(id, fn)     { var e = el(id); if (e) e.addEventListener('click', fn); }
  function setText(id, v) { var e = el(id); if (e) e.textContent = v; }

  function twShowHome() {
    twStop();
    window.scrollTo(0, 0);
    el('tw-home').classList.remove('hidden');
    el('tw-play').classList.add('hidden');
    var backBtn = el('tw-back-play'); if (backBtn) backBtn.style.display = 'none';
  }

  function twWireUI() {
    on('tw-back-hub',   function () { twStop(); showHub(); if (typeof window.dzCheckOrientation==='function') window.dzCheckOrientation(); });
    on('tw-back-play',  function () { twStop(); twShowHome(); });
    on('tw-again',      function () { twStartGame(); });
    on('tw-result-hub', function () { twStop(); showHub(); });
    on('tw-start-btn',  function () { twStartGame(); });

    on('tw-mode-pvp', function () {
      TW.mode = 'pvp';
      el('tw-mode-pvp').classList.add('active');
      el('tw-mode-bot').classList.remove('active');
      var bs = el('tw-bot-settings'); if (bs) bs.classList.add('hidden');
    });
    on('tw-mode-bot', function () {
      TW.mode = 'bot';
      el('tw-mode-bot').classList.add('active');
      el('tw-mode-pvp').classList.remove('active');
      var bs = el('tw-bot-settings'); if (bs) bs.classList.remove('hidden');
    });

    document.querySelectorAll('.tw-diff').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.tw-diff').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active'); TW.diff = b.dataset.diff;
      });
    });

    on('tw-end-turn', function () { twEndTurn(); });

    // Build mobile controls (joystick + CLAIM) on touch devices
    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) {
      buildTwControls();
    }
  }

  function twStop() {
    TW.over = true;
    if (TW.botTimer) { clearTimeout(TW.botTimer); TW.botTimer = null; }
  }

  // ── Grid setup ────────────────────────────────────────────────
  function makeGrid() {
    var g = [];
    for (var r = 0; r < GRID_H; r++) {
      g[r] = [];
      for (var c = 0; c < GRID_W; c++) { g[r][c] = EMPTY; }
    }
    // 2×2 corners
    for (var dr = 0; dr < 2; dr++) {
      for (var dc = 0; dc < 2; dc++) {
        g[dr][dc]                     = P1;
        g[GRID_H-1-dr][GRID_W-1-dc]  = P2;
      }
    }
    return g;
  }

  function twStartGame() {
    twStop();
    TW.over  = false;
    TW.grid  = makeGrid();
    TW.turn  = 1;
    TW.scores = [countCells(P1), countCells(P2)];
    window.scrollTo(0, 0);

    el('tw-home').classList.add('hidden');
    var playEl = el('tw-play');
    if (playEl) { playEl.classList.remove('hidden'); playEl.scrollTop = 0; }
    el('tw-result').classList.add('hidden');
    var backBtn = el('tw-back-play'); if (backBtn) backBtn.style.display = 'block';
    calcCellSize();

    setText('tw-p2-name', TW.mode === 'bot' ? '🤖 Bot' : 'Player 2');

    // Place cursor on first capturable cell for current player
    TW.cursor = twFindFirstCapturableCell(TW.turn) || { r: 0, c: 0 };

    twRenderGrid();
    twUpdateUI();

    // Show mobile controls
    var mCtrl = el('tw-mobile-controls');
    if (mCtrl && (('ontouchstart' in window) || navigator.maxTouchPoints > 0)) {
      twUpdateMobileControls();
      mCtrl.style.display = 'flex';
    }

    // Request landscape orientation when game starts
    if (typeof window.dzLockLandscape    === 'function') window.dzLockLandscape();
    if (typeof window.dzCheckOrientation === 'function') window.dzCheckOrientation();
  }

  // ── Render ────────────────────────────────────────────────────
  function twRenderGrid() {
    var container = el('tw-grid');
    if (!container) return;
    container.innerHTML = '';
    container.style.gridTemplateColumns = 'repeat(' + GRID_W + ', ' + CELL + 'px)';
    container.style.gridTemplateRows    = 'repeat(' + GRID_H + ', ' + CELL + 'px)';

    var isCursorActive = !TW.over && !(TW.mode === 'bot' && TW.turn === P2);

    for (var r = 0; r < GRID_H; r++) {
      for (var c = 0; c < GRID_W; c++) {
        (function (row, col) {
          var cell  = document.createElement('div');
          var owner = TW.grid[row][col];
          var isCapturable = !TW.over && owner === EMPTY && isAdjacent(row, col, TW.turn);
          var isCursor     = isCursorActive && TW.cursor.r === row && TW.cursor.c === col;

          cell.className = 'tw-cell';
          if      (owner === P1) { cell.className += ' tw-cell-p1'; }
          else if (owner === P2) { cell.className += ' tw-cell-p2'; }
          else if (isCapturable) {
            cell.className  += ' tw-cell-capturable';
            cell.style.cursor = 'pointer';
          }

          // Joystick cursor highlight ring
          if (isCursor && isCapturable) {
            var col2 = TW.turn === P1 ? '#00e5ff' : '#f50057';
            cell.style.outline       = '2.5px solid ' + col2;
            cell.style.outlineOffset = '-2px';
            cell.style.background    = TW.turn === P1 ? 'rgba(0,229,255,0.25)' : 'rgba(245,0,87,0.25)';
            cell.style.zIndex        = '2';
          }

          cell.addEventListener('click', function () { twClickCell(row, col); });
          container.appendChild(cell);
        })(r, c);
      }
    }
  }

  function isAdjacent(row, col, player) {
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    return dirs.some(function (d) {
      var nr = row + d[0], nc = col + d[1];
      return nr >= 0 && nr < GRID_H && nc >= 0 && nc < GRID_W && TW.grid[nr][nc] === player;
    });
  }

  // ── Click handler ─────────────────────────────────────────────
  function twClickCell(row, col) {
    if (TW.over) return;
    if (TW.mode === 'bot' && TW.turn === P2) return;  // bot's turn
    if (TW.grid[row][col] !== EMPTY) return;
    if (!isAdjacent(row, col, TW.turn)) return;

    twCapture(row, col, TW.turn);
    twUpdateScores();

    // Move cursor to next capturable cell after claiming
    var next = twFindFirstCapturableCell(TW.turn);
    if (next) TW.cursor = next;

    twRenderGrid();
    twUpdateUI();

    // Check end conditions right after move
    if (twCheckEndConditions()) return;

    // Auto-advance turn (1 move per turn)
    setTimeout(twEndTurn, 300);
  }

  // ── Capture cell + flip surrounded opponent cells ─────────────
  function twCapture(row, col, player) {
    TW.grid[row][col] = player;
    // FIX: removed the broken nc2 = col+dd[1] dead code block
    // Flip any opponent cells that are now fully surrounded on all 4 sides
    twFloodCapture(player);
  }

  function twFloodCapture(player) {
    var opponent = player === P1 ? P2 : P1;
    var dirs     = [[-1,0],[1,0],[0,-1],[0,1]];
    // Keep scanning until no more flips happen (chain reactions)
    var flipped  = true;
    while (flipped) {
      flipped = false;
      for (var r = 0; r < GRID_H; r++) {
        for (var c = 0; c < GRID_W; c++) {
          if (TW.grid[r][c] !== opponent) continue;
          var allPlayer = dirs.every(function (d) {
            var nr = r + d[0], nc = c + d[1];
            // Border edges count as player's wall (can't escape grid edge)
            if (nr < 0 || nr >= GRID_H || nc < 0 || nc >= GRID_W) return true;
            return TW.grid[nr][nc] === player;
          });
          if (allPlayer) { TW.grid[r][c] = player; flipped = true; }
        }
      }
    }
  }

  // ── FIX: check if a player has ANY available move ─────────────
  function hasMovesFor(player) {
    for (var r = 0; r < GRID_H; r++) {
      for (var c = 0; c < GRID_W; c++) {
        if (TW.grid[r][c] === EMPTY && isAdjacent(r, c, player)) return true;
      }
    }
    return false;
  }

  // ── FIX: Check end conditions after every move ────────────────
  // Returns true if game ended
  function twCheckEndConditions() {
    var p1Moves = hasMovesFor(P1);
    var p2Moves = hasMovesFor(P2);

    if (!p1Moves && !p2Moves) {
      // Board fully locked — count score
      twEndGame(null, 'No moves left for either player!');
      return true;
    }

    if (!p1Moves) {
      // P1 is trapped — P2 wins
      twEndGame(P2, 'Player 1 has no moves left!');
      return true;
    }

    if (!p2Moves) {
      var defeatedName = TW.mode === 'bot' ? 'Bot' : 'Player 2';
      twEndGame(P1, defeatedName + ' has no moves left!');
      return true;
    }

    return false;
  }

  // ── End turn ──────────────────────────────────────────────────
  function twEndTurn() {
    if (TW.over) return;
    TW.turn = TW.turn === P1 ? P2 : P1;

    // Move cursor to first capturable cell for new player
    TW.cursor = twFindFirstCapturableCell(TW.turn) || TW.cursor;

    twUpdateUI();
    twRenderGrid();
    twUpdateMobileControls();

    // FIX: immediately check if the player whose turn just started has any moves
    if (twCheckEndConditions()) return;

    // Bot's turn
    if (TW.mode === 'bot' && TW.turn === P2) {
      var delay = { easy: 950, medium: 520, hard: 60 }[TW.diff] || 520;
      TW.botTimer = setTimeout(twBotMove, delay);
    }
  }

  // ── Scores ────────────────────────────────────────────────────
  function countCells(player) {
    var count = 0;
    for (var r = 0; r < GRID_H; r++)
      for (var c = 0; c < GRID_W; c++)
        if (TW.grid[r][c] === player) count++;
    return count;
  }

  function twUpdateScores() {
    TW.scores = [countCells(P1), countCells(P2)];
  }

  function twUpdateUI() {
    twUpdateScores();
    setText('tw-score-p1', '🟦 ' + TW.scores[0]);
    setText('tw-score-p2', '🟥 ' + TW.scores[1]);

    // FIX: correct name in indicator for bot mode
    var p2label = TW.mode === 'bot' ? '🤖 Bot' : 'Player 2';
    var turnLabel = TW.turn === P1 ? '🔵 Player 1' : '🔴 ' + p2label;
    setText('tw-turn-indicator', turnLabel + '\'s Turn');

    var endBtn = el('tw-end-turn');
    if (endBtn) endBtn.style.display = (TW.mode === 'bot' && TW.turn === P2) ? 'none' : '';

    var total = GRID_W * GRID_H;
    setText('tw-total', TW.scores[0] + TW.scores[1] + '/' + total + ' cells claimed');

    twUpdateMobileControls();
  }

  // ── End game ──────────────────────────────────────────────────
  // forcedWinner: P1, P2, or null (count scores)
  // reason: optional flavour text shown in detail
  function twEndGame(forcedWinner, reason) {
    if (TW.over) return;
    TW.over = true;
    if (TW.botTimer) { clearTimeout(TW.botTimer); TW.botTimer = null; }

    twUpdateScores();
    var names  = ['Player 1', TW.mode === 'bot' ? 'Bot' : 'Player 2'];
    var winner;

    if (forcedWinner === P1)      { winner = 0; }
    else if (forcedWinner === P2) { winner = 1; }
    else {
      winner = TW.scores[0] > TW.scores[1] ? 0 : TW.scores[1] > TW.scores[0] ? 1 : -1;
    }

    el('tw-result-title').textContent  = winner >= 0 ? '🏆 ' + names[winner] + ' Wins!' : '🤝 It\'s a Tie!';
    el('tw-result-detail').textContent =
      (reason ? reason + '  ' : '') +
      'P1: ' + TW.scores[0] + ' cells  |  ' + names[1] + ': ' + TW.scores[1] + ' cells';
    el('tw-result').classList.remove('hidden');
    if (typeof SoundManager !== 'undefined' && SoundManager.win) SoundManager.win();
  }

  // ── Bot AI ────────────────────────────────────────────────────
  function twBotMove() {
    if (TW.over) return;

    var best = null, bestScore = -Infinity;

    if (TW.diff === 'hard') {
      // Minimax with depth 8 for hard - essentially unbeatable
      var result = twMinimax(TW.grid, 8, -Infinity, Infinity, true);
      best = result.move;
    } else {
      for (var r = 0; r < GRID_H; r++) {
        for (var c = 0; c < GRID_W; c++) {
          if (TW.grid[r][c] === EMPTY && isAdjacent(r, c, P2)) {
            var score = evalMove(r, c, P2);
            if (score > bestScore) { bestScore = score; best = {r:r, c:c}; }
          }
        }
      }
    }

    if (best) {
      twCapture(best.r, best.c, P2);
      twUpdateScores();
      twRenderGrid();
      twUpdateUI();
      if (twCheckEndConditions()) return;
      setTimeout(twEndTurn, 400);
    } else {
      twEndGame(P1, 'Bot has no moves left!');
    }
  }

  function twCloneGrid(grid) {
    return grid.map(function(row){ return row.slice(); });
  }

  function twCountCellsInGrid(grid, player) {
    var count = 0;
    for (var r=0; r<GRID_H; r++) for (var c=0; c<GRID_W; c++) if (grid[r][c]===player) count++;
    return count;
  }

  function twHasMovesInGrid(grid, player) {
    for (var r=0; r<GRID_H; r++) for (var c=0; c<GRID_W; c++) {
      if (grid[r][c]===EMPTY && isAdjacentInGrid(grid, r, c, player)) return true;
    }
    return false;
  }

  function isAdjacentInGrid(grid, row, col, player) {
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    return dirs.some(function(d){
      var nr=row+d[0], nc=col+d[1];
      return nr>=0&&nr<GRID_H&&nc>=0&&nc<GRID_W&&grid[nr][nc]===player;
    });
  }

  function twApplyCapture(grid, row, col, player) {
    grid[row][col] = player;
    var opponent = player===P1?P2:P1;
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    var flipped = true;
    while (flipped) {
      flipped = false;
      for (var r=0; r<GRID_H; r++) for (var c=0; c<GRID_W; c++) {
        if (grid[r][c]!==opponent) continue;
        var allP = dirs.every(function(d){
          var nr=r+d[0],nc=c+d[1];
          if (nr<0||nr>=GRID_H||nc<0||nc>=GRID_W) return true;
          return grid[nr][nc]===player;
        });
        if (allP) { grid[r][c]=player; flipped=true; }
      }
    }
  }

  function twMinimax(grid, depth, alpha, beta, maximizing) {
    var player = maximizing ? P2 : P1;
    var moves = [];
    for (var r=0; r<GRID_H; r++) for (var c=0; c<GRID_W; c++) {
      if (grid[r][c]===EMPTY && isAdjacentInGrid(grid, r, c, player)) moves.push({r:r,c:c});
    }

    if (depth === 0 || moves.length === 0) {
      var p2score = twCountCellsInGrid(grid, P2);
      var p1score = twCountCellsInGrid(grid, P1);
      return { score: p2score - p1score, move: null };
    }

    // Sort moves by immediate score for better pruning
    moves.sort(function(a,b){ return evalMoveInGrid(grid,b.r,b.c,player)-evalMoveInGrid(grid,a.r,a.c,player); });

    var bestMove = null;
    if (maximizing) {
      var best = -Infinity;
      for (var i=0; i<moves.length; i++) {
        var ng = twCloneGrid(grid);
        twApplyCapture(ng, moves[i].r, moves[i].c, P2);
        var child = twMinimax(ng, depth-1, alpha, beta, false);
        if (child.score > best) { best=child.score; bestMove=moves[i]; }
        alpha = Math.max(alpha, best);
        if (beta<=alpha) break;
      }
      return { score: best, move: bestMove };
    } else {
      var best2 = Infinity;
      for (var j=0; j<moves.length; j++) {
        var ng2 = twCloneGrid(grid);
        twApplyCapture(ng2, moves[j].r, moves[j].c, P1);
        var child2 = twMinimax(ng2, depth-1, alpha, beta, true);
        if (child2.score < best2) { best2=child2.score; bestMove=moves[j]; }
        beta = Math.min(beta, best2);
        if (beta<=alpha) break;
      }
      return { score: best2, move: bestMove };
    }
  }

  function evalMoveInGrid(grid, row, col, player) {
    var opponent = player===P1?P2:P1;
    var score = 0;
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    dirs.forEach(function(d){
      var nr=row+d[0], nc=col+d[1];
      if (nr>=0&&nr<GRID_H&&nc>=0&&nc<GRID_W) {
        if (grid[nr][nc]===opponent) score+=3;
        if (grid[nr][nc]===player) score+=1;
      }
    });
    score -= (Math.abs(row-GRID_H/2)+Math.abs(col-GRID_W/2))*0.05;
    return score;
  }

  function evalMove(row, col, player) {
    var opponent = player === P1 ? P2 : P1;
    var score    = 0;
    var dirs     = [[-1,0],[1,0],[0,-1],[0,1]];
    dirs.forEach(function (d) {
      var nr = row + d[0], nc = col + d[1];
      if (nr >= 0 && nr < GRID_H && nc >= 0 && nc < GRID_W) {
        if (TW.grid[nr][nc] === opponent) score += 3;  // block opponent
        if (TW.grid[nr][nc] === player)   score += 1;  // extend own territory
      }
    });
    // Slight bias toward centre
    score -= (Math.abs(row - GRID_H/2) + Math.abs(col - GRID_W/2)) * 0.05;
    return score;
  }

  // ── Helper: find first capturable cell for a player ──────────
  function twFindFirstCapturableCell(player) {
    for (var r = 0; r < GRID_H; r++) {
      for (var c = 0; c < GRID_W; c++) {
        if (TW.grid[r][c] === EMPTY && isAdjacent(r, c, player)) return { r: r, c: c };
      }
    }
    return null;
  }

  // ── Mobile joystick controls ──────────────────────────────────
  /*
   * Joystick navigates a cursor around the grid.
   * Analog drag → discrete step every REPEAT_MS when held past THRESHOLD.
   * CLAIM button calls twClickCell at cursor position.
   * In PvP both players get a stick; only active player's stick moves cursor.
   * Bot mode shows P1 stick only.
   */
  var twJoyRepeatTimer = null;
  var twJoyDir = { dx: 0, dy: 0, active: false };

  function buildTwControls() {
    var container = document.getElementById('tw-mobile-controls');
    if (!container) return;
    container.innerHTML = '';

    var isLandscape = window.innerWidth > window.innerHeight && window.innerHeight < 520;
    var joySize  = isLandscape ? 76 : 90;
    var claimH   = isLandscape ? 38 : 48;
    var gap      = isLandscape ? 4  : 8;
    var padding  = isLandscape ? '3px 12px' : '8px 14px';

    container.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;'
      + 'gap:12px;padding:' + padding + ';box-sizing:border-box;width:100%;'
      + 'background:rgba(7,8,15,0.94);border-top:1px solid rgba(255,214,0,0.12);'
      + 'user-select:none;-webkit-user-select:none;';

    var isPvP = TW.mode === 'pvp';

    if (isPvP) {
      // P1 stick (left)
      container.appendChild(mkTwJoySet('🔵 P1', '#00e5ff', 1, joySize, claimH, gap));
      // Centre divider
      var divEl = document.createElement('div');
      divEl.style.cssText = 'width:1px;height:60px;background:rgba(255,255,255,0.07);flex-shrink:0;';
      container.appendChild(divEl);
      // P2 stick (right)
      container.appendChild(mkTwJoySet('🔴 P2', '#f50057', 2, joySize, claimH, gap));
    } else {
      // Bot mode: one centred stick
      var inner = document.createElement('div');
      inner.style.cssText = 'flex:1;display:flex;justify-content:center;';
      inner.appendChild(mkTwJoySet('🔵 P1', '#00e5ff', 1, joySize, claimH, gap));
      container.appendChild(inner);
    }
  }

  function mkTwJoySet(label, color, playerNum, joySize, claimH, gap) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:' + gap + 'px;';

    // Label
    var lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText =
      'font-family:Rajdhani,sans-serif;font-size:10px;color:' + color
      + ';letter-spacing:1.5px;text-transform:uppercase;';
    wrap.appendChild(lbl);

    // Row: joystick + CLAIM button
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;';

    // Joystick base
    var knobSize = Math.round(joySize * 0.42);
    var base = document.createElement('div');
    base.style.cssText =
      'position:relative;width:' + joySize + 'px;height:' + joySize + 'px;border-radius:50%;'
      + 'border:2.5px solid ' + color + '55;background:' + color + '08;'
      + 'touch-action:none;cursor:pointer;flex-shrink:0;';

    var knob = document.createElement('div');
    knob.style.cssText =
      'position:absolute;top:50%;left:50%;'
      + 'transform:translate(-50%,-50%);'
      + 'width:' + knobSize + 'px;height:' + knobSize + 'px;border-radius:50%;pointer-events:none;'
      + 'background:radial-gradient(circle at 38% 36%,' + color + 'bb,' + color + '33);'
      + 'border:2px solid ' + color + '99;'
      + 'box-shadow:0 0 10px ' + color + '55;';
    base.appendChild(knob);
    wireTwJoystick(base, knob, playerNum, joySize, color);

    // CLAIM button
    var claim = document.createElement('button');
    claim.textContent = '✔ CLAIM';
    claim.style.cssText =
      'height:' + claimH + 'px;padding:0 14px;'
      + 'background:' + color + '18;border:2px solid ' + color + '77;border-radius:10px;'
      + 'color:' + color + ';font-family:Rajdhani,sans-serif;font-weight:700;'
      + 'font-size:13px;cursor:pointer;touch-action:none;'
      + 'user-select:none;-webkit-tap-highlight-color:transparent;'
      + 'transition:background 0.08s,transform 0.08s;flex-shrink:0;';
    claim.addEventListener('contextmenu', function(e){ e.preventDefault(); });

    // CLAIM fires only on the active player's button
    claim.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      if (TW.over) return;
      if (TW.mode === 'bot' && TW.turn === P2) return;
      if (TW.turn !== playerNum) return;
      var cr = TW.cursor.r, cc = TW.cursor.c;
      if (TW.grid[cr][cc] === EMPTY && isAdjacent(cr, cc, TW.turn)) {
        claim.style.background = color + '33';
        claim.style.transform  = 'scale(0.93)';
        twClickCell(cr, cc);
      }
    }, {passive:false});
    claim.addEventListener('pointerup',     function(){ claim.style.background=color+'18'; claim.style.transform='scale(1)'; }, {passive:false});
    claim.addEventListener('pointercancel', function(){ claim.style.background=color+'18'; claim.style.transform='scale(1)'; }, {passive:false});

    row.appendChild(base);
    row.appendChild(claim);
    wrap.appendChild(row);
    return wrap;
  }

  function wireTwJoystick(base, knob, playerNum, joySize, color) {
    var RADIUS    = joySize * 0.36;
    var THRESHOLD = 0.45;   // fraction of RADIUS to trigger a step
    var REPEAT_MS = 180;    // ms between repeated steps when held

    var active = false, pointerId = -1, cx = 0, cy = 0;
    var lastDir = { dr: 0, dc: 0 };

    function stepCursor(dr, dc) {
      // Only move cursor if this player's turn
      if (TW.over) return;
      if (TW.mode === 'bot' && TW.turn === P2) return;
      if (TW.turn !== playerNum) return;

      var nr = TW.cursor.r + dr;
      var nc = TW.cursor.c + dc;
      // Clamp to grid
      nr = Math.max(0, Math.min(GRID_H - 1, nr));
      nc = Math.max(0, Math.min(GRID_W  - 1, nc));
      if (nr !== TW.cursor.r || nc !== TW.cursor.c) {
        TW.cursor.r = nr;
        TW.cursor.c = nc;
        twRenderGrid();
        // Auto-scroll cursor cell into view
        var gridEl = document.getElementById('tw-grid');
        if (gridEl) {
          var idx = nr * GRID_W + nc;
          var cellEl = gridEl.children[idx];
          if (cellEl && cellEl.scrollIntoView) {
            cellEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }
        }
      }
    }

    function startRepeat(dr, dc) {
      clearInterval(twJoyRepeatTimer);
      lastDir = { dr: dr, dc: dc };
      stepCursor(dr, dc);
      twJoyRepeatTimer = setInterval(function() {
        if (!active) { clearInterval(twJoyRepeatTimer); return; }
        stepCursor(lastDir.dr, lastDir.dc);
      }, REPEAT_MS);
    }

    function stopRepeat() {
      clearInterval(twJoyRepeatTimer);
      twJoyRepeatTimer = null;
    }

    function getDir(dx, dy) {
      var dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < RADIUS * THRESHOLD) return { dr: 0, dc: 0 };
      // Pick strongest axis
      if (Math.abs(dx) >= Math.abs(dy)) {
        return { dr: 0, dc: dx > 0 ? 1 : -1 };
      } else {
        return { dr: dy > 0 ? 1 : -1, dc: 0 };
      }
    }

    function updateKnob(dx, dy) {
      var dist  = Math.sqrt(dx*dx + dy*dy);
      var clamp = Math.min(dist, RADIUS);
      var kx = dist > 0 ? (dx/dist)*clamp : 0;
      var ky = dist > 0 ? (dy/dist)*clamp : 0;
      knob.style.transform = 'translate(calc(-50% + ' + kx + 'px), calc(-50% + ' + ky + 'px))';
    }

    base.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      base.setPointerCapture(e.pointerId);
      active = true; pointerId = e.pointerId;
      var r = base.getBoundingClientRect();
      cx = r.left + r.width/2;
      cy = r.top  + r.height/2;
      updateKnob(0, 0);
    }, {passive:false});

    base.addEventListener('pointermove', function(e) {
      if (!active || e.pointerId !== pointerId) return;
      e.preventDefault();
      var dx = e.clientX - cx, dy = e.clientY - cy;
      updateKnob(dx, dy);
      var dir = getDir(dx, dy);
      if (dir.dr !== lastDir.dr || dir.dc !== lastDir.dc) {
        stopRepeat();
        if (dir.dr !== 0 || dir.dc !== 0) startRepeat(dir.dr, dir.dc);
        else lastDir = { dr: 0, dc: 0 };
      }
    }, {passive:false});

    function endJoy(e) {
      if (e.pointerId !== pointerId) return;
      active = false; pointerId = -1;
      knob.style.transform = 'translate(-50%,-50%)';
      lastDir = { dr: 0, dc: 0 };
      stopRepeat();
    }
    base.addEventListener('pointerup',     endJoy, {passive:false});
    base.addEventListener('pointercancel', endJoy, {passive:false});
  }

  // Show/hide & dim inactive player's controls
  function twUpdateMobileControls() {
    var container = document.getElementById('tw-mobile-controls');
    if (!container || container.style.display === 'none') return;
    var isBotTurn = TW.mode === 'bot' && TW.turn === P2;
    // Dim entire panel during bot turn
    container.style.opacity = isBotTurn ? '0.35' : '1';
    container.style.pointerEvents = isBotTurn ? 'none' : '';
  }

})();
