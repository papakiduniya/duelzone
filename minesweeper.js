// ═══════════════════════════════════════════════════════════════
// DuelZone · Minesweeper Duel  (minesweeper.js)  — TURN-BASED
// Both players share ONE grid. Take turns revealing cells.
// Hit a mine = -1 life, opponent +2pts. Safe cell = +1pt.
// Most points when board cleared = winner.
// Uses ONLY the existing HTML elements (no new DOM needed).
// ═══════════════════════════════════════════════════════════════
(function(){
  'use strict';

  var CONFIGS={
    easy:   {cols:9, rows:9, mines:10},
    medium: {cols:12,rows:10,mines:20},
    hard:   {cols:16,rows:12,mines:40},
  };

  var MS={
    mode:'pvp', diff:'easy', over:false, botDiff:'medium',
    grid:null,
    currentTurn:0,
    scores:[0,0],
    lives:[3,3],
    flagMode:[false,false],
    botInterval:null,
    firstClick:false,
  };

  var _wired=false;
  var _bot=null;

  // Repurpose tab buttons as turn indicator
  window.mineShowTab=function(pid){ /* no-op in turn-based */ };

  window.mineInit=function(){
    if(!_wired){mineWireUI();_wired=true;}
    mineShowHome();
  };
  window.mineDestroy=function(){ mineClearTimers(); };

  function el(id){return document.getElementById(id);}
  function on(id,fn){var e=el(id);if(e)e.addEventListener('click',fn);}
  function setText(id,v){var e=el(id);if(e)e.textContent=v;}

  function mineShowHome(){
    window.scrollTo(0,0);
    el('mine-home').classList.remove('hidden');
    el('mine-play').classList.add('hidden');
    // Hide the fixed back button when not in game
    var backBtn=el('mine-back-play'); if(backBtn) backBtn.style.display='none';
  }

  function mineWireUI(){
    on('mine-back-hub',   function(){mineClearTimers();showHub();});
    on('mine-back-play',  function(){mineClearTimers();mineShowHome();});
    on('mine-again',      function(){mineStartGame();});
    on('mine-result-hub', function(){mineClearTimers();showHub();});

    on('mine-mode-pvp', function(){
      MS.mode='pvp';
      el('mine-mode-pvp').classList.add('active');
      el('mine-mode-bot').classList.remove('active');
      var bs=el('mine-bot-settings'); if(bs) bs.classList.add('hidden');
    });
    on('mine-mode-bot', function(){
      MS.mode='bot';
      el('mine-mode-bot').classList.add('active');
      el('mine-mode-pvp').classList.remove('active');
      var bs=el('mine-bot-settings'); if(bs) bs.classList.remove('hidden');
    });
    on('mine-start-btn', function(){mineStartGame();});

    document.querySelectorAll('.mine-diff').forEach(function(b){
      b.addEventListener('click',function(){
        document.querySelectorAll('.mine-diff').forEach(function(x){x.classList.remove('active');});
        b.classList.add('active'); MS.diff=b.dataset.diff;
      });
    });
    document.querySelectorAll('.mine-bot-diff').forEach(function(b){
      b.addEventListener('click',function(){
        document.querySelectorAll('.mine-bot-diff').forEach(function(x){x.classList.remove('active');});
        b.classList.add('active'); MS.botDiff=b.dataset.bdiff||'medium';
      });
    });

    on('mine-flag-p1',function(){
      if(MS.currentTurn!==0||MS.over) return;
      MS.flagMode[0]=!MS.flagMode[0]; updateFlagBtn(0);
    });
    on('mine-flag-p2',function(){
      if(MS.currentTurn!==1||MS.over||MS.mode==='bot') return;
      MS.flagMode[1]=!MS.flagMode[1]; updateFlagBtn(1);
    });
  }

  function mineClearTimers(){
    if(MS.botInterval){ clearTimeout(MS.botInterval); clearInterval(MS.botInterval); MS.botInterval=null; }
    if(_bot&&_bot.stepTimer){ clearTimeout(_bot.stepTimer); _bot.stepTimer=null; }
    _bot=null;
  }

  function mineStartGame(){
    mineClearTimers();
    window.scrollTo(0,0);
    var playEl=el('mine-play');
    if(playEl){ playEl.classList.remove('hidden'); playEl.scrollTop=0; }
    el('mine-home').classList.add('hidden');
    el('mine-result').classList.add('hidden');
    // Show the fixed back button
    var backBtn=el('mine-back-play'); if(backBtn) backBtn.style.display='block';

    MS.over=false; MS.currentTurn=0; MS.scores=[0,0]; MS.lives=[3,3];
    MS.flagMode=[false,false]; MS.firstClick=false;

    // Hide P2 grid section — single shared grid in P1 container
    var p2sec=el('mine-p2-section'); if(p2sec) p2sec.style.display='none';
    // Hide mobile tabs (not needed in turn-based)
    var tabs=document.querySelector('.mine-tabs'); if(tabs) tabs.style.display='none';

    var cfg=CONFIGS[MS.diff];
    var mineSet=generateMines(cfg.cols,cfg.rows,cfg.mines);
    MS.grid=buildGrid(cfg.cols,cfg.rows,mineSet);

    // Repurpose P2 name label
    setText('mine-p2-name', MS.mode==='bot'?'🤖 Bot':'Player 2');

    updateFlagBtn(0); updateFlagBtn(1);
    updateTurnIndicator();
    updateScoreDisplay();
    renderGrid();

    if(MS.mode==='bot'&&MS.currentTurn===1) scheduleBotTurn();
  }

  // ── Grid generation ──────────────────────────────────────────

  function generateMines(cols,rows,count){
    var all=[];
    for(var r=0;r<rows;r++) for(var c=0;c<cols;c++) all.push({r:r,c:c});
    shuffle(all);
    var mines={};
    all.slice(0,count).forEach(function(m){mines[m.r+','+m.c]=true;});
    return mines;
  }

  function buildGrid(cols,rows,mineSet){
    var cfg=CONFIGS[MS.diff];
    var cells=[];
    for(var r=0;r<rows;r++){
      cells[r]=[];
      for(var c=0;c<cols;c++){
        cells[r][c]={mine:!!mineSet[r+','+c],revealed:false,flagged:false,adj:0};
      }
    }
    for(var r2=0;r2<rows;r2++) for(var c2=0;c2<cols;c2++){
      if(cells[r2][c2].mine) continue;
      var cnt=0;
      forNeighbors(r2,c2,rows,cols,function(nr,nc){if(cells[nr][nc].mine)cnt++;});
      cells[r2][c2].adj=cnt;
    }
    return{cells:cells,rows:rows,cols:cols,mines:cfg.mines,flagCount:0,
           totalSafe:cols*rows-cfg.mines,clearedSafe:0};
  }

  function forNeighbors(r,c,rows,cols,fn){
    for(var dr=-1;dr<=1;dr++) for(var dc=-1;dc<=1;dc++){
      if(dr===0&&dc===0) continue;
      var nr=r+dr,nc=c+dc;
      if(nr>=0&&nr<rows&&nc>=0&&nc<cols) fn(nr,nc);
    }
  }

  // ── Display helpers using existing elements ───────────────────

  function getPlayerName(pid){
    return pid===0?'Player 1':(MS.mode==='bot'?'Bot':'Player 2');
  }

  // Repurpose tab buttons as turn indicator
  function updateTurnIndicator(){
    var t1=el('mine-tab-p1'), t2=el('mine-tab-p2');
    if(t1){
      t1.textContent='🔵 P1'+(MS.currentTurn===0?' ← TURN':'');
      t1.style.background=MS.currentTurn===0?'rgba(0,229,255,0.25)':'rgba(255,255,255,0.04)';
      t1.style.borderColor=MS.currentTurn===0?'rgba(0,229,255,0.7)':'rgba(255,255,255,0.1)';
      t1.style.color=MS.currentTurn===0?'#00e5ff':'rgba(255,255,255,0.35)';
    }
    if(t2){
      var p2n=MS.mode==='bot'?'🤖 Bot':'🔴 P2';
      t2.textContent=p2n+(MS.currentTurn===1?' ← TURN':'');
      t2.style.background=MS.currentTurn===1?'rgba(245,0,87,0.2)':'rgba(255,255,255,0.04)';
      t2.style.borderColor=MS.currentTurn===1?'rgba(245,0,87,0.6)':'rgba(255,255,255,0.1)';
      t2.style.color=MS.currentTurn===1?'#f50057':'rgba(255,255,255,0.35)';
    }
    // Show tabs
    var tabs=document.querySelector('.mine-tabs'); if(tabs) tabs.style.display='flex';
  }

  function updateScoreDisplay(){
    // P1: mines-p1 = lives+score, pct-p1 = score, prog-p1 = board progress
    setText('mine-mines-p1','❤️ '+MS.lives[0]+'  ⭐ '+MS.scores[0]);
    setText('mine-pct-p1','⭐ '+MS.scores[0]);
    // P2: mines-p2 = lives+score, pct-p2 = score
    setText('mine-mines-p2','❤️ '+MS.lives[1]+'  ⭐ '+MS.scores[1]);
    setText('mine-pct-p2','⭐ '+MS.scores[1]);
    // Progress bar = board cleared %
    var g=MS.grid;
    var pct=g?Math.round(g.clearedSafe/g.totalSafe*100):0;
    var b1=el('mine-prog-p1'); if(b1) b1.style.width=pct+'%';
    var b2=el('mine-prog-p2'); if(b2) b2.style.width=(MS.lives[1]/3*100)+'%';
  }

  function updateFlagBtn(pid){
    var btn=el('mine-flag-p'+(pid+1)); if(!btn) return;
    btn.textContent=(MS.flagMode[pid]?'🚩 Flag: ON':'🚩 Flag: OFF');
    btn.classList.toggle('mine-flag-active',!!MS.flagMode[pid]);
    btn.disabled=(MS.currentTurn!==pid||MS.over||(pid===1&&MS.mode==='bot'));
  }

  // ── Render shared grid in P1 container ───────────────────────

  function renderGrid(){
    var g=MS.grid; if(!g) return;
    var container=el('mine-grid-p1'); if(!container) return;
    container.innerHTML='';
    container.style.gridTemplateColumns='repeat('+g.cols+',1fr)';

    var botsTurn=MS.mode==='bot'&&MS.currentTurn===1;
    var locked=MS.over||botsTurn;

    for(var r=0;r<g.rows;r++) for(var c=0;c<g.cols;c++){
      (function(row,col){
        var cell=document.createElement('button');
        cell.className='mine-cell';
        var d=g.cells[row][col];
        if(d.revealed){
          cell.classList.add('mine-revealed');
          if(d.mine){ cell.textContent='💣'; cell.classList.add('mine-hit'); }
          else if(d.adj>0){ cell.textContent=d.adj; cell.classList.add('mine-n'+d.adj); }
        } else if(d.flagged){
          cell.textContent='🚩'; cell.classList.add('mine-flagged');
        }
        if(locked||d.revealed) cell.disabled=true;
        cell.addEventListener('click',function(e){
          e.preventDefault();
          if(MS.over||locked) return;
          var pid=MS.currentTurn;
          if(MS.flagMode[pid]) toggleFlag(row,col);
          else revealCell(pid,row,col);
        });
        cell.addEventListener('contextmenu',function(e){
          e.preventDefault();
          if(MS.over||locked) return;
          toggleFlag(row,col);
        });
        container.appendChild(cell);
      })(r,c);
    }
  }

  // ── Turn switching ────────────────────────────────────────────

  function switchTurn(){
    MS.currentTurn=MS.currentTurn===0?1:0;
    MS.flagMode=[false,false];
    updateFlagBtn(0); updateFlagBtn(1);
    updateTurnIndicator();
    renderGrid();
    if(MS.mode==='bot'&&MS.currentTurn===1&&!MS.over) scheduleBotTurn();
  }

  function showTempMsg(msg){
    var t1=el('mine-tab-p1'),t2=el('mine-tab-p2');
    var prev1=t1?t1.textContent:'',prev2=t2?t2.textContent:'';
    if(t1){ t1.textContent=msg; t1.style.color='#facc15'; }
    if(t2){ t2.textContent=''; }
    setTimeout(function(){
      if(!MS.over) updateTurnIndicator();
    },1100);
  }

  // ── Reveal logic ─────────────────────────────────────────────

  function revealCell(pid,r,c){
    var g=MS.grid;
    var d=g.cells[r][c];
    if(d.revealed||d.flagged||MS.over) return;

    if(!MS.firstClick){
      if(d.mine) moveMine(g,r,c);
      MS.firstClick=true;
    }

    d.revealed=true;

    if(d.mine){
      MS.lives[pid]--;
      MS.scores[1-pid]+=2;
      // Briefly show all mines then re-hide them
      revealAllMines();
      renderGrid(); updateScoreDisplay();
      if(typeof SoundManager!=='undefined'&&SoundManager.lose) SoundManager.lose();

      if(MS.lives[pid]<=0){
        endGame(1-pid,'💣 '+getPlayerName(pid)+' is out of lives!');
        return;
      }
      showTempMsg('💥 '+getPlayerName(pid)+' hit a mine!');
      setTimeout(function(){
        if(MS.over) return;
        // Re-hide mines
        for(var rr=0;rr<g.rows;rr++) for(var cc=0;cc<g.cols;cc++){
          if(g.cells[rr][cc].mine) g.cells[rr][cc].revealed=false;
        }
        switchTurn();
      },1200);
      return;
    }

    MS.scores[pid]++;
    if(d.adj===0) floodReveal(pid,r,c);
    g.clearedSafe=countCleared();
    renderGrid(); updateScoreDisplay();

    if(g.clearedSafe>=g.totalSafe){
      var w=MS.scores[0]>MS.scores[1]?0:(MS.scores[1]>MS.scores[0]?1:-1);
      endGame(w,'All cells cleared!');
      return;
    }
    setTimeout(function(){ if(!MS.over) switchTurn(); },300);
  }

  function moveMine(g,r,c){
    for(var nr=0;nr<g.rows;nr++) for(var nc=0;nc<g.cols;nc++){
      if(!g.cells[nr][nc].mine&&!(nr===r&&nc===c)){
        g.cells[r][c].mine=false; g.cells[nr][nc].mine=true; recalcAdj(g); return;
      }
    }
  }

  function recalcAdj(g){
    for(var r=0;r<g.rows;r++) for(var c=0;c<g.cols;c++){
      if(g.cells[r][c].mine){g.cells[r][c].adj=0;continue;}
      var cnt=0;
      forNeighbors(r,c,g.rows,g.cols,function(nr,nc){if(g.cells[nr][nc].mine)cnt++;});
      g.cells[r][c].adj=cnt;
    }
  }

  function floodReveal(pid,r,c){
    var g=MS.grid;
    var queue=[{r:r,c:c}];
    while(queue.length){
      var cur=queue.shift();
      forNeighbors(cur.r,cur.c,g.rows,g.cols,function(nr,nc){
        var nd=g.cells[nr][nc];
        if(!nd.revealed&&!nd.mine&&!nd.flagged){
          nd.revealed=true; MS.scores[pid]++; g.clearedSafe++;
          if(nd.adj===0) queue.push({r:nr,c:nc});
        }
      });
    }
  }

  function toggleFlag(r,c){
    var g=MS.grid; var d=g.cells[r][c];
    if(d.revealed) return;
    d.flagged=!d.flagged; g.flagCount+=d.flagged?1:-1;
    renderGrid();
  }

  function countCleared(){
    var g=MS.grid,cnt=0;
    for(var r=0;r<g.rows;r++) for(var c=0;c<g.cols;c++) if(g.cells[r][c].revealed&&!g.cells[r][c].mine) cnt++;
    return cnt;
  }

  function revealAllMines(){
    var g=MS.grid;
    for(var r=0;r<g.rows;r++) for(var c=0;c<g.cols;c++) if(g.cells[r][c].mine) g.cells[r][c].revealed=true;
  }

  // ── End game ─────────────────────────────────────────────────

  function endGame(winner,detail){
    if(MS.over) return;
    MS.over=true; mineClearTimers();
    var icon=winner===-1?'🤝':'🏆';
    var wname=winner===-1?'Draw':getPlayerName(winner);
    el('mine-result-title').textContent=icon+' '+wname+(winner>=0?' Wins!':'');
    el('mine-result-detail').textContent=(detail||'')+' | Final: ⭐'+MS.scores[0]+' – ⭐'+MS.scores[1];
    var mw=el('mine-mock-wrap'),tc=el('mine-tip-card');
    if(mw) mw.classList.add('hidden');
    if(tc) tc.classList.add('hidden');
    el('mine-result').classList.remove('hidden');
    if(typeof SoundManager!=='undefined'&&SoundManager.win) SoundManager.win();
  }

  // ── Bot ───────────────────────────────────────────────────────

  function scheduleBotTurn(){
    if(MS.over||MS.currentTurn!==1) return;
    var delay={easy:1200,medium:800,hard:350}[MS.botDiff]||800;
    MS.botInterval=setTimeout(function(){
      if(!MS.over&&MS.currentTurn===1) doBotTurn();
    },delay+Math.random()*250);
  }

  function doBotTurn(){
    if(MS.over||MS.currentTurn!==1) return;
    var g=MS.grid;
    _bot={knownMines:{},safeQueue:[],stepTimer:null};
    botSolve(g);
    var choice=_bot.safeQueue.length>0?_bot.safeQueue.shift():botPickGuess(g);
    if(!choice){ endGame(MS.scores[0]>MS.scores[1]?0:1,'No moves left'); return; }
    revealCell(1,choice.r,choice.c);
  }

  function botSolve(g){
    var changed=true;
    while(changed){
      changed=false;
      var constraints=[];
      for(var r=0;r<g.rows;r++) for(var c=0;c<g.cols;c++){
        var d=g.cells[r][c];
        if(!d.revealed||d.mine||d.adj===0) continue;
        var unk=[],flagged=0;
        forNeighbors(r,c,g.rows,g.cols,function(nr,nc){
          var nd=g.cells[nr][nc]; if(nd.revealed) return;
          var key=nr+','+nc;
          if(nd.flagged||_bot.knownMines[key]){flagged++;return;}
          unk.push({r:nr,c:nc,key:key});
        });
        var rem=d.adj-flagged;
        if(rem<=0&&unk.length>0) unk.forEach(function(cell){if(!botInSafeQueue(cell)){_bot.safeQueue.push(cell);changed=true;}});
        if(rem>0&&rem===unk.length) unk.forEach(function(cell){if(!_bot.knownMines[cell.key]){_bot.knownMines[cell.key]=true;changed=true;}});
        if(rem>0&&unk.length>0) constraints.push({cells:unk,mines:rem});
      }
      if(MS.botDiff!=='easy'){
        for(var i=0;i<constraints.length;i++) for(var j=0;j<constraints.length;j++){
          if(i===j) continue;
          var A=constraints[i],B=constraints[j];
          if(A.cells.length>=B.cells.length) continue;
          var aKeys={};
          A.cells.forEach(function(x){aKeys[x.key]=true;});
          if(!A.cells.every(function(x){return B.cells.some(function(y){return y.key===x.key;});})) continue;
          var diff2=B.cells.filter(function(x){return !aKeys[x.key];});
          var dm=B.mines-A.mines;
          if(dm<0||dm>diff2.length) continue;
          if(dm===0) diff2.forEach(function(cell){if(!botInSafeQueue(cell)){_bot.safeQueue.push(cell);changed=true;}});
          if(dm===diff2.length) diff2.forEach(function(cell){if(!_bot.knownMines[cell.key]){_bot.knownMines[cell.key]=true;changed=true;}});
        }
      }
    }
  }

  function botInSafeQueue(cell){
    for(var i=0;i<_bot.safeQueue.length;i++) if(_bot.safeQueue[i].r===cell.r&&_bot.safeQueue[i].c===cell.c) return true;
    return false;
  }

  function botPickGuess(g){
    var cands=[];
    for(var r=0;r<g.rows;r++) for(var c=0;c<g.cols;c++){
      var d=g.cells[r][c];
      if(!d.revealed&&!d.flagged&&!_bot.knownMines[r+','+c]) cands.push({r:r,c:c});
    }
    if(!cands.length) return null;
    if(MS.botDiff==='easy') return cands[Math.floor(Math.random()*cands.length)];
    if(MS.botDiff==='hard'){
      var safe=cands.filter(function(cell){return !g.cells[cell.r][cell.c].mine;});
      if(safe.length){
        safe.forEach(function(cell){
          var s=0,n=0;
          forNeighbors(cell.r,cell.c,g.rows,g.cols,function(nr,nc){var nd=g.cells[nr][nc];if(nd.revealed&&!nd.mine&&nd.adj>0){s+=nd.adj;n++;}});
          cell.danger=n>0?s/n:0;
        });
        safe.sort(function(a,b){return a.danger-b.danger;});
        var pool=safe.slice(0,Math.max(1,Math.ceil(safe.length*0.2)));
        return pool[Math.floor(Math.random()*pool.length)];
      }
      return null;
    }
    cands.forEach(function(cell){
      var s=0,n=0,f=false;
      forNeighbors(cell.r,cell.c,g.rows,g.cols,function(nr,nc){var nd=g.cells[nr][nc];if(nd.revealed&&!nd.mine&&nd.adj>0){s+=nd.adj;n++;f=true;}});
      cell.frontier=f; cell.danger=n>0?s/n:0;
    });
    var interior=cands.filter(function(c){return !c.frontier;});
    var pool2=interior.length>0?interior:cands;
    return pool2[Math.floor(Math.random()*pool2.length)];
  }

  function shuffle(arr){for(var i=arr.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}

})();
