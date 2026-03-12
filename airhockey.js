// ═══════════════════════════════════════════════════════════════
// AIR HOCKEY — Neon Ice Edition  (airhockey.js)
// Ported from the inline script.js block into a standalone module.
// Bugs fixed: ahGameOver closing brace, sub-step physics, dt-based
// everything, pointer velocity, stuck-puck rescue.
// ═══════════════════════════════════════════════════════════════

// ── Local Audio Engine (fallback when SoundManager is absent) ──
var ahAudio = (function () {
  var ctx = null;
  function gc() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function tone(freq, type, vol, dur, delay, freqEnd) {
    try {
      var c = gc(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type || 'sine';
      var t0 = c.currentTime + (delay || 0);
      o.frequency.setValueAtTime(freq, t0);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol || 0.15, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.12));
      o.start(t0); o.stop(t0 + (dur || 0.12) + 0.01);
    } catch (e) {}
  }
  function noise(vol, dur, delay, cutoff) {
    try {
      var c = gc();
      var bufSize = Math.floor(c.sampleRate * dur);
      var buf = c.createBuffer(1, bufSize, c.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      var src = c.createBufferSource(); src.buffer = buf;
      var gn = c.createGain();
      var flt = c.createBiquadFilter();
      flt.type = 'bandpass'; flt.frequency.value = cutoff || 1200;
      src.connect(flt); flt.connect(gn); gn.connect(c.destination);
      var t0 = c.currentTime + (delay || 0);
      gn.gain.setValueAtTime(vol, t0);
      gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.start(t0); src.stop(t0 + dur + 0.01);
    } catch (e) {}
  }
  return {
    paddleHit: function (spd) {
      var vol = Math.min(0.25, 0.08 + (spd || 0) * 0.006);
      tone(180 + (spd || 0) * 3, 'square', vol * 0.6, 0.06);
      noise(vol, 0.05, 0, 1200);
    },
    wallBounce: function () { tone(320, 'square', 0.07, 0.05); noise(0.05, 0.04, 0, 800); },
    goal: function (isP1) {
      var base = isP1 ? 523 : 392;
      [0, 0.12, 0.24, 0.38].forEach(function (d, i) {
        tone(base * [1, 1.25, 1.5, 2][i], 'sine', 0.2, 0.2, d);
      });
    },
    win:  function () { [523,659,784,1047,1319].forEach(function(f,i){ tone(f,'sine',0.18,0.22,i*0.1); }); },
    lose: function () { tone(440,'sawtooth',0.13,0.2); tone(330,'sawtooth',0.1,0.25,0.18); tone(220,'sawtooth',0.08,0.3,0.36); },
    puckStart: function () { tone(800, 'sine', 0.12, 0.15, 0, 400); },
    click: function () { tone(600, 'sine', 0.07, 0.06); }
  };
})();

// ── Safe sound wrapper — prefers SoundManager, falls back to ahAudio ──
var ahSnd = {
  paddleHit:  function(s)  { try { if(typeof SoundManager!=='undefined'&&SoundManager.ahPaddleHit){SoundManager.ahPaddleHit(s);return;}  }catch(e){} ahAudio.paddleHit(s); },
  wallBounce: function()   { try { if(typeof SoundManager!=='undefined'&&SoundManager.ahWallBounce){SoundManager.ahWallBounce();return;} }catch(e){} ahAudio.wallBounce(); },
  goal:       function(p1) { try { if(typeof SoundManager!=='undefined'&&SoundManager.ahGoal){SoundManager.ahGoal(p1);return;}           }catch(e){} ahAudio.goal(p1); },
  win:        function()   { try { if(typeof SoundManager!=='undefined'&&SoundManager.ahWin){SoundManager.ahWin();return;}                }catch(e){} ahAudio.win(); },
  lose:       function()   { try { if(typeof SoundManager!=='undefined'&&SoundManager.ahLose){SoundManager.ahLose();return;}              }catch(e){} ahAudio.lose(); },
  puckStart:  function()   { try { if(typeof SoundManager!=='undefined'&&SoundManager.ahPuckStart){SoundManager.ahPuckStart();return;}    }catch(e){} ahAudio.puckStart(); },
  click:      function()   { try { if(typeof SoundManager!=='undefined'&&SoundManager.click){SoundManager.click();return;}                }catch(e){} ahAudio.click(); }
};

// ── Bot difficulty configs ─────────────────────────────────────
var AH_BOT = {
  easy:   { reaction_time: 380, max_speed: 300,  error_margin: 65,  aggression: 0.25 },
  medium: { reaction_time: 160, max_speed: 520,  error_margin: 22,  aggression: 0.62 },
  hard:   { reaction_time: 40,  max_speed: 800,  error_margin: 5,   aggression: 0.92 }
};
AH_BOT.extreme = AH_BOT.hard;

// ── State ──────────────────────────────────────────────────────
var ahCanvas, ahCtx;
var ahW, ahH;
var ahRAF      = null;
var ahRunning  = false;
var ahPaused   = false;
var ahMode     = 'pvb';
var ahDiff     = 'easy';
var ahWinScore = 7;
var ahLastTime = 0;

var ahPuck = { x:0, y:0, vx:0, vy:0, r:0, vServe:null };
var ahPaddles = [
  { x:0, y:0, r:0, pvx:0, pvy:0, _hitThisFrame:false, key:{up:false,dn:false,lt:false,rt:false} },
  { x:0, y:0, r:0, pvx:0, pvy:0, _hitThisFrame:false, key:{up:false,dn:false,lt:false,rt:false} }
];

var ahBotTimer    = 0;
var ahBotTarget   = { x:0, y:0 };
var ahGoalFreezeMs = 0;
var ahServeWho    = 0;
var ahTrail       = [];
var ahParticles   = [];
var ahSpeedLines  = [];
var ahRings       = [];
var ahStuckTimer  = 0;
var ahP1Score = 0, ahP2Score = 0;
var ahMatchCount  = 0;

// ── Helpers ────────────────────────────────────────────────────
function ahStopLoop() {
  ahRunning = false;
  if (ahRAF) { cancelAnimationFrame(ahRAF); ahRAF = null; }
  window.removeEventListener('resize', ahResize);
}

function ahResize() {
  var field = document.getElementById('ah-canvas-field');
  if (!field || !ahCanvas) return;
  var fw = field.clientWidth  || 360;
  var fh = field.clientHeight || Math.round(fw * 1.55);
  ahW = Math.min(fw, 420);
  ahH = Math.max(Math.round(ahW * 1.5), Math.min(fh, 660));
  ahCanvas.width  = ahW;
  ahCanvas.height = ahH;
}

function ahGoalWidth() { return ahW * 0.42; }

function ahClampPaddle(p, idx) {
  var m = p.r, cy = ahH / 2;
  p.x = Math.max(m, Math.min(ahW - m, p.x));
  if (idx === 0) p.y = Math.max(cy + m * 0.25, Math.min(ahH - m, p.y));
  else           p.y = Math.max(m, Math.min(cy - m * 0.25, p.y));
}

// ── Init ───────────────────────────────────────────────────────
function ahInit() {
  ahCanvas = document.getElementById('ah-canvas');
  ahCtx    = ahCanvas.getContext('2d');
  ahResize();
  ahP1Score = ahP2Score = 0;
  ahPuck.r       = ahW * 0.055;
  ahPaddles[0].r = ahW * 0.09;
  ahPaddles[1].r = ahW * 0.09;
  ahTrail=[]; ahParticles=[]; ahSpeedLines=[]; ahRings=[];
  ahBotTimer=0; ahStuckTimer=0; ahGoalFreezeMs=0; ahBotPhase='defend';
  ahBotTarget.x = ahW / 2;
  ahBotTarget.y = ahH * 0.2;
  ahResetPositions(0);
  ahUpdateScoreUI();
  window.addEventListener('resize', ahResize);
}

function ahResetPositions(serveWho) {
  ahPuck.x = ahW/2; ahPuck.y = ahH/2; ahPuck.vx=0; ahPuck.vy=0;
  ahPaddles[0].x = ahW/2; ahPaddles[0].y = ahH*0.82; ahPaddles[0].pvx=0; ahPaddles[0].pvy=0;
  ahPaddles[1].x = ahW/2; ahPaddles[1].y = ahH*0.18; ahPaddles[1].pvx=0; ahPaddles[1].pvy=0;
  ahServeWho = serveWho;
  ahGoalFreezeMs = 1300;
  ahTrail=[]; ahSpeedLines=[];
  var dir = (serveWho === 0) ? -1 : 1;
  var serveVy = dir * ahW * 1.6;
  var serveVx = (Math.random() - 0.5) * Math.abs(serveVy) * 0.5;
  ahPuck.vServe = { vx: serveVx, vy: serveVy };
}

// ── Bot AI ─────────────────────────────────────────────────────
// ahBotPhase: 'defend' | 'windup' | 'strike'
var ahBotPhase = 'defend';

function ahPredictPuck(numSteps, dt_sub) {
  var x=ahPuck.x, y=ahPuck.y, vx=ahPuck.vx, vy=ahPuck.vy;
  var r=ahPuck.r, sec=dt_sub/1000;
  for (var s=0; s<numSteps; s++) {
    x+=vx*sec; y+=vy*sec;
    if (x-r<0)   { x=r;     vx= Math.abs(vx); }
    if (x+r>ahW) { x=ahW-r; vx=-Math.abs(vx); }
    if (vy>0 && y>ahH*0.5) break;
  }
  return { x:x, y:y };
}

function ahUpdateBot(dt) {
  if (ahMode!=='pvb') return;
  var cfg=AH_BOT[ahDiff]||AH_BOT.easy;
  ahBotTimer+=dt;
  if (ahBotTimer<cfg.reaction_time) return;
  ahBotTimer=0;

  var b=ahPaddles[1], pk=ahPuck;
  var err=(Math.random()-0.5)*cfg.error_margin*2;
  var puckInBotHalf = pk.y < ahH*0.5;
  var puckComingUp   = pk.vy < 0; // negative y = moving toward bot (top)

  if (puckInBotHalf) {
    // --- ATTACK phase: swing THROUGH the puck ---
    // Bot (idx=1) lives at top. To shoot puck DOWN toward player's goal,
    // bot must position ABOVE the puck and charge downward through it.

    var aimX = ahW/2 + err * (1 - cfg.aggression*0.6);

    // Wind-up: line up behind (above) the puck on the desired shot angle
    var swingOffset = (b.r + pk.r) * 1.8;
    var dx_lean = (pk.x - aimX) * 0.3;
    var tx = pk.x - dx_lean + err*0.15;
    var ty = pk.y - swingOffset;

    ahBotTarget.x = Math.max(b.r+1, Math.min(ahW-b.r-1, tx));
    ahBotTarget.y = Math.max(b.r+1, Math.min(ahH*0.5-b.r-1, ty));

    // Strike: once aligned above puck, charge THROUGH and past it
    var windupDx = b.x - ahBotTarget.x, windupDy = b.y - ahBotTarget.y;
    var alignedForStrike = (windupDx*windupDx + windupDy*windupDy) < (b.r*2.5)*(b.r*2.5);
    if (alignedForStrike || cfg.aggression > 0.85) {
      // Strike past puck toward the center line — the deeper the better
      var strikeY = pk.y + (b.r + pk.r) * (1.6 + cfg.aggression * 0.8);
      ahBotTarget.x = Math.max(b.r+1, Math.min(ahW-b.r-1, aimX));
      ahBotTarget.y = Math.min(ahH*0.5-b.r-1, strikeY);
    }

  } else if (puckComingUp) {
    // --- INTERCEPT: predict and get in the puck's path ---
    var lookSteps = Math.max(8, Math.round(20*cfg.aggression));
    var pred = ahPredictPuck(lookSteps, 14);
    ahBotTarget.x = Math.max(b.r+1, Math.min(ahW-b.r-1, pred.x + err));
    ahBotTarget.y = Math.max(b.r+1, Math.min(ahH*0.5-b.r-1, pred.y + err*0.2));

  } else {
    // --- DEFEND: puck going away, guard goal center ---
    // Track puck x loosely to stay between puck and goal
    var defX = pk.x*0.45 + ahW/2*0.55 + err*0.15;
    var defY = cfg.aggression>0.7 ? ahH*0.13 : cfg.aggression>0.4 ? ahH*0.11 : ahH*0.09;
    ahBotTarget.x = Math.max(b.r+1, Math.min(ahW-b.r-1, defX));
    ahBotTarget.y = Math.max(b.r+1, Math.min(ahH*0.5-b.r-1, defY));
  }
}

function ahMoveBot(dt) {
  if (ahMode!=='pvb') return;
  var cfg=AH_BOT[ahDiff]||AH_BOT.easy, b=ahPaddles[1];
  var dx=ahBotTarget.x-b.x, dy=ahBotTarget.y-b.y;
  var dist=Math.sqrt(dx*dx+dy*dy);
  if (dist<0.5) { b.pvx=0; b.pvy=0; return; }
  var step=Math.min(cfg.max_speed*(dt/1000), dist);
  b.pvx=(dx/dist)*step/(dt/1000);
  b.pvy=(dy/dist)*step/(dt/1000);
  b.x+=(dx/dist)*step; b.y+=(dy/dist)*step;
  ahClampPaddle(b,1);
}

// ── Physics ─────────────────────────────────────────────────────
function ahCircleCollide(a,b) {
  var dx=b.x-a.x, dy=b.y-a.y;
  return dx*dx+dy*dy<(a.r+b.r)*(a.r+b.r);
}

function ahResolvePaddlePuck(paddle,puck) {
  var dx=puck.x-paddle.x, dy=puck.y-paddle.y;
  var d=Math.sqrt(dx*dx+dy*dy);
  if (d===0) { d=0.01; dx=1; dy=0; }
  var nx=dx/d, ny=dy/d;

  // Always push puck out of paddle to prevent embedding
  var overlap=(paddle.r+puck.r+2)-d;
  if (overlap>0) { puck.x+=nx*overlap; puck.y+=ny*overlap; }

  var relVx=puck.vx-paddle.pvx, relVy=puck.vy-paddle.pvy;
  var dot=relVx*nx+relVy*ny;
  if (dot>=0) return; // already separating in paddle's reference frame

  // Fully elastic collision
  var restitution=1.0;
  var tx=-ny, ty=nx;
  var tangDot=relVx*tx+relVy*ty;
  var spinFactor=(dx/(paddle.r+puck.r))*0.05;

  // Project paddle velocity onto NORMAL direction only (physically correct).
  // Adding raw paddle velocity in all directions caused erratic puck deflections.
  var paddleNormalVel=paddle.pvx*nx+paddle.pvy*ny;
  var paddleSpd=Math.sqrt(paddle.pvx*paddle.pvx+paddle.pvy*paddle.pvy);
  var paddleBoost=0.5+Math.min(0.45, paddleSpd/(ahW*1.1));

  puck.vx=(puck.vx-(1+restitution)*dot*nx) + nx*paddleNormalVel*paddleBoost + tangDot*tx*spinFactor;
  puck.vy=(puck.vy-(1+restitution)*dot*ny) + ny*paddleNormalVel*paddleBoost + tangDot*ty*spinFactor;

  // Enforce minimum separation speed so puck never sticks to paddle
  var sepVel=puck.vx*nx+puck.vy*ny;
  var minSep=Math.max(90, Math.abs(dot)*0.35);
  if (sepVel<minSep) {
    puck.vx+=nx*(minSep-sepVel);
    puck.vy+=ny*(minSep-sepVel);
  }

  var maxSpd=ahW*2.2;
  var spd=Math.sqrt(puck.vx*puck.vx+puck.vy*puck.vy);
  if (spd>maxSpd) { puck.vx*=maxSpd/spd; puck.vy*=maxSpd/spd; spd=maxSpd; }
  ahSpawnImpact(puck.x,puck.y);
  ahRings.push({x:puck.x,y:puck.y,r:paddle.r,life:1});
  ahSnd.paddleHit(spd/60);
}

function ahSpawnImpact(x,y) {
  var colors=['#00e5ff','#ffffff','#7effff','#b2ebf2'];
  for (var i=0;i<12;i++) {
    var a=Math.random()*Math.PI*2, spd=(Math.random()*4+1)*60;
    ahParticles.push({x:x,y:y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,
      life:1,color:colors[Math.floor(Math.random()*colors.length)],size:2+Math.random()*3});
  }
}

function ahSpawnWallSparks(x,y) {
  for (var i=0;i<6;i++) {
    var a=Math.random()*Math.PI*2, spd=(Math.random()*2.5+0.5)*60;
    ahParticles.push({x:x,y:y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,life:0.7,color:'#aae8ff',size:1.5});
  }
}

// Minimum puck speed — enforced unconditionally during live play
var AH_MIN_SPD = 0; // set dynamically from ahW in ahEnforceMinSpeed

function ahEnforceMinSpeed() {
  var minSpd = ahW * 0.50; // 50% of canvas width per second — never below this
  var spd2 = ahPuck.vx*ahPuck.vx + ahPuck.vy*ahPuck.vy;
  if (spd2 < minSpd*minSpd) {
    if (spd2 < 0.001) {
      // Truly stopped — give it a random kick toward center so game never freezes
      var ang = Math.atan2(ahH/2 - ahPuck.y, ahW/2 - ahPuck.x) + (Math.random()-0.5)*1.2;
      ahPuck.vx = Math.cos(ang) * minSpd;
      ahPuck.vy = Math.sin(ang) * minSpd;
    } else {
      var spd = Math.sqrt(spd2);
      ahPuck.vx = ahPuck.vx / spd * minSpd;
      ahPuck.vy = ahPuck.vy / spd * minSpd;
    }
  }
}

function ahPhysicsStep(dt_sub,wallFlags) {
  var sec=dt_sub/1000, r=ahPuck.r, gw=ahGoalWidth()/2, cx=ahW/2;
  // NO friction, NO drag — air hockey table is frictionless by design.
  ahPuck.x+=ahPuck.vx*sec; ahPuck.y+=ahPuck.vy*sec;
  // Perfectly elastic walls — zero energy loss on bounce
  if (ahPuck.x-r<0) {
    ahPuck.x=r; ahPuck.vx=Math.abs(ahPuck.vx);
    if (!wallFlags.left) { wallFlags.left=true; ahSpawnWallSparks(r,ahPuck.y); ahSnd.wallBounce(); }
  }
  if (ahPuck.x+r>ahW) {
    ahPuck.x=ahW-r; ahPuck.vx=-Math.abs(ahPuck.vx);
    if (!wallFlags.right) { wallFlags.right=true; ahSpawnWallSparks(ahW-r,ahPuck.y); ahSnd.wallBounce(); }
  }
  if (ahPuck.y-r<0 && !(ahPuck.x>cx-gw&&ahPuck.x<cx+gw)) {
    ahPuck.y=r; ahPuck.vy=Math.abs(ahPuck.vy);
    if (!wallFlags.top) { wallFlags.top=true; ahSpawnWallSparks(ahPuck.x,r); ahSnd.wallBounce(); }
  }
  if (ahPuck.y+r>ahH && !(ahPuck.x>cx-gw&&ahPuck.x<cx+gw)) {
    ahPuck.y=ahH-r; ahPuck.vy=-Math.abs(ahPuck.vy);
    if (!wallFlags.bot) { wallFlags.bot=true; ahSpawnWallSparks(ahPuck.x,ahH-r); ahSnd.wallBounce(); }
  }
  for (var pi=0;pi<2;pi++) {
    if (ahCircleCollide(ahPaddles[pi],ahPuck)) {
      if (!ahPaddles[pi]._hitThisFrame) {
        // First collision this frame: full resolution (overlap + velocity)
        ahResolvePaddlePuck(ahPaddles[pi],ahPuck);
        ahPaddles[pi]._hitThisFrame=true;
      } else {
        // Already resolved this frame: only keep puck separated, no extra velocity change
        var _dx=ahPuck.x-ahPaddles[pi].x, _dy=ahPuck.y-ahPaddles[pi].y;
        var _d=Math.sqrt(_dx*_dx+_dy*_dy)||0.01;
        var _ov=(ahPaddles[pi].r+ahPuck.r+2)-_d;
        if (_ov>0) { ahPuck.x+=(_dx/_d)*_ov; ahPuck.y+=(_dy/_d)*_ov; }
      }
    }
  }
  // Goal: puck fully past end line inside goal zone
  if (ahPuck.y-r<0 && ahPuck.x>cx-gw && ahPuck.x<cx+gw) {
    ahP1Score++; ahSnd.goal(true); ahUpdateScoreUI(); ahShowGoalFlash(0);
    if (ahP1Score>=ahWinScore) { ahGameOver(0); return true; }
    ahResetPositions(1); return true;
  }
  if (ahPuck.y+r>ahH && ahPuck.x>cx-gw && ahPuck.x<cx+gw) {
    ahP2Score++; ahSnd.goal(false); ahUpdateScoreUI(); ahShowGoalFlash(1);
    if (ahP2Score>=ahWinScore) { ahGameOver(1); return true; }
    ahResetPositions(0); return true;
  }
  return false;
}

// ── Score UI ───────────────────────────────────────────────────
function ahUpdateScoreUI() {
  var e1=document.getElementById('ah-p1-val'), e2=document.getElementById('ah-p2-val');
  if (e1) e1.textContent=ahP1Score;
  if (e2) e2.textContent=ahP2Score;
  ahUpdatePips('ah-p1-pips',ahP1Score,ahWinScore,'#00e5ff');
  ahUpdatePips('ah-p2-pips',ahP2Score,ahWinScore,'#ff4081');
}

function ahUpdatePips(id,score,total,color) {
  var el=document.getElementById(id); if (!el) return;
  el.innerHTML='';
  var show=Math.min(total,10);
  for (var i=0;i<show;i++) {
    var pip=document.createElement('div');
    pip.className='ah-pip'+(i<score?' ah-pip--on':'');
    pip.style.setProperty('--pip-color',color);
    el.appendChild(pip);
  }
}

function ahShowGoalFlash(who) {
  var el=document.getElementById('ah-goal-flash'); if (!el) return;
  clearTimeout(el._t);
  // Strip all classes and hide first so the animation restarts cleanly
  el.style.display='none';
  el.className='ah-goal-flash';
  void el.offsetWidth; // force reflow — makes the browser re-trigger the CSS animation
  el.className='ah-goal-flash ah-goal-flash--'+(who===0?'p1':'p2');
  el.textContent='⚡ GOAL!';
  el.style.display='flex';
  el._t=setTimeout(function(){el.style.display='none';},1100);
}

function ahGameOver(winner) {
  ahStopLoop();
  ahMatchCount++;
  var label=winner===0?'PLAYER 1':(ahMode==='pvb'?'BOT':'PLAYER 2');
  var color=winner===0?'#00e5ff':(ahMode==='pvb'?'#ff4081':'#ff9100');
  // In PvP both players are human — play "win" for whoever won; only play "lose" in PvB
  if (winner===0) ahSnd.win(); else if (ahMode==='pvp') ahSnd.win(); else ahSnd.lose();
  var el=document.getElementById('ah-overlay-msg');
  if (!el) return;
  el.style.display='flex'; el.className='ah-overlay-msg';
  function showResult() {
    el.innerHTML=
      '<div class="ah-win-icon">'+(winner===0?'🏆':'😤')+'</div>'+
      '<div class="ah-win-title" style="color:'+color+'">'+label+' WINS!</div>'+
      '<div class="ah-win-score">'+ahP1Score+' \u2013 '+ahP2Score+'</div>'+
      '<button class="ah-win-btn" onclick="startAHGame()">\u21ba Play Again</button>'+
      '<button class="ah-win-btn ah-win-btn--sec" onclick="showAH()">\u2190 Menu</button>';
  }
  if (ahMatchCount%2===0 && window.show_9092988 && typeof window.show_9092988==='function') {
    el.innerHTML='<div style="color:#888;font-size:13px;letter-spacing:0.1em;">Loading\u2026</div>';
    try { window.show_9092988().then(showResult).catch(showResult); } catch(e){ showResult(); }
  } else { showResult(); }
}

// ── Main Loop ──────────────────────────────────────────────────
function ahLoop(ts) {
  if (!ahRunning) return;
  if (document.hidden) { ahLastTime=ts; ahRAF=requestAnimationFrame(ahLoop); return; }
  var dt=ahLastTime===0?16:Math.min(ts-ahLastTime,50);
  ahLastTime=ts;
  if (ahPaused) { ahDraw(); ahRAF=requestAnimationFrame(ahLoop); return; }

  if (ahGoalFreezeMs>0) {
    ahGoalFreezeMs-=dt;
    ahClampPaddle(ahPaddles[0],0);
    ahClampPaddle(ahPaddles[1],1); // clamp bot/P2 regardless of mode
    if (ahGoalFreezeMs<=0) {
      ahGoalFreezeMs=0;
      if (ahPuck.vServe) {
        ahPuck.vx=ahPuck.vServe.vx; ahPuck.vy=ahPuck.vServe.vy;
        ahPuck.vServe=null; ahSnd.puckStart();
      }
    }
    ahDraw(); ahRAF=requestAnimationFrame(ahLoop); return;
  }

  ahUpdateBot(dt);
  ahMoveBot(dt);

  // Keyboard P1
  var kSpd=ahW*1.35*(dt/1000), p0=ahPaddles[0];
  if (p0.key.up) { p0.pvy=-kSpd/(dt/1000); p0.y-=kSpd; }
  else if (p0.key.dn) { p0.pvy=kSpd/(dt/1000); p0.y+=kSpd; } else p0.pvy=0;
  if (p0.key.lt) { p0.pvx=-kSpd/(dt/1000); p0.x-=kSpd; }
  else if (p0.key.rt) { p0.pvx=kSpd/(dt/1000); p0.x+=kSpd; } else p0.pvx=0;
  ahClampPaddle(p0,0);

  // Keyboard P2 (PvP)
  if (ahMode==='pvp') {
    var p1=ahPaddles[1];
    if (p1.key.up) { p1.pvy=-kSpd/(dt/1000); p1.y-=kSpd; }
    else if (p1.key.dn) { p1.pvy=kSpd/(dt/1000); p1.y+=kSpd; } else p1.pvy=0;
    if (p1.key.lt) { p1.pvx=-kSpd/(dt/1000); p1.x-=kSpd; }
    else if (p1.key.rt) { p1.pvx=kSpd/(dt/1000); p1.x+=kSpd; } else p1.pvx=0;
    ahClampPaddle(p1,1);
  }

  // Sub-step physics
  var puckSpd=Math.sqrt(ahPuck.vx*ahPuck.vx+ahPuck.vy*ahPuck.vy);
  var subSteps=Math.max(1,Math.min(10,Math.ceil(puckSpd*(dt/1000)/(ahPuck.r*0.4))));
  var dt_sub=dt/subSteps;
  var wallFlags={left:false,right:false,top:false,bot:false};
  // Reset per-frame collision flags before sub-steps (prevents multi-hit energy exploit)
  ahPaddles[0]._hitThisFrame=false;
  ahPaddles[1]._hitThisFrame=false;
  var goalScored=false;
  for (var s=0;s<subSteps&&!goalScored;s++) goalScored=ahPhysicsStep(dt_sub,wallFlags);
  if (goalScored) { ahDraw(); ahRAF=requestAnimationFrame(ahLoop); return; }

  // Enforce min speed and global cap AFTER all sub-steps, not inside them
  ahEnforceMinSpeed();
  var _gsCap=ahW*2.2, _gsSpd=Math.sqrt(ahPuck.vx*ahPuck.vx+ahPuck.vy*ahPuck.vy);
  if (_gsSpd>_gsCap) { ahPuck.vx*=_gsCap/_gsSpd; ahPuck.vy*=_gsCap/_gsSpd; }

  // Stuck rescue — fires if puck stays suspiciously slow despite min-speed enforcement
  var curSpd=Math.sqrt(ahPuck.vx*ahPuck.vx+ahPuck.vy*ahPuck.vy);
  ahStuckTimer+=dt;
  if (curSpd>ahW*0.30) ahStuckTimer=0;
  if (ahStuckTimer>2500) {
    ahStuckTimer=0;
    ahPuck.vx=(Math.random()-0.5)*ahW*1.1;
    ahPuck.vy=(ahPuck.y<ahH/2?1:-1)*ahW*1.3;
    ahSnd.puckStart();
  }

  // Trail
  ahTrail.push({x:ahPuck.x,y:ahPuck.y});
  var maxTrail=Math.max(8,Math.round(350/Math.max(dt,8)));
  if (ahTrail.length>maxTrail) ahTrail.shift();

  // Speed lines
  if (puckSpd>ahW*1.5&&Math.random()<0.4) {
    var angle=Math.atan2(ahPuck.vy,ahPuck.vx)+Math.PI;
    ahSpeedLines.push({x:ahPuck.x,y:ahPuck.y,angle:angle+(Math.random()-0.5)*0.5,
      len:8+Math.random()*20,life:1});
  }
  var slDecay=9.0*(dt/1000);
  for (var i=ahSpeedLines.length-1;i>=0;i--) {
    ahSpeedLines[i].life-=slDecay; if (ahSpeedLines[i].life<=0) ahSpeedLines.splice(i,1);
  }

  // Particles
  var pDecay=2.2*(dt/1000), drag=Math.pow(0.88,dt/1000*60);
  for (var i=ahParticles.length-1;i>=0;i--) {
    var p=ahParticles[i];
    p.x+=p.vx*(dt/1000); p.y+=p.vy*(dt/1000);
    p.life-=pDecay; p.vx*=drag; p.vy*=drag;
    if (p.life<=0) ahParticles.splice(i,1);
  }

  // Rings
  var rGrow=180*(dt/1000), rDecay=5.0*(dt/1000);
  for (var i=ahRings.length-1;i>=0;i--) {
    ahRings[i].r+=rGrow; ahRings[i].life-=rDecay;
    if (ahRings[i].life<=0) ahRings.splice(i,1);
  }

  ahDraw();
  ahRAF=requestAnimationFrame(ahLoop);
}

// ── Drawing ────────────────────────────────────────────────────
function ahDraw() {
  var ctx=ahCtx, W=ahW, H=ahH;

  // Background
  var bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#020c18'); bg.addColorStop(0.5,'#040f20'); bg.addColorStop(1,'#020c18');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  var shimmer=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W*0.7);
  shimmer.addColorStop(0,'rgba(0,229,255,0.04)');
  shimmer.addColorStop(0.6,'rgba(0,100,180,0.02)');
  shimmer.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=shimmer; ctx.fillRect(0,0,W,H);

  // Table border
  ctx.save();
  var brd=6;
  ctx.shadowColor='#00e5ff'; ctx.shadowBlur=24;
  ctx.strokeStyle='#00e5ff'; ctx.lineWidth=3;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(brd,brd,W-brd*2,H-brd*2,12); else ctx.rect(brd,brd,W-brd*2,H-brd*2);
  ctx.stroke();
  ctx.shadowBlur=8; ctx.strokeStyle='rgba(0,229,255,0.2)'; ctx.lineWidth=1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(brd+6,brd+6,W-brd*2-12,H-brd*2-12,8); else ctx.rect(brd+6,brd+6,W-brd*2-12,H-brd*2-12);
  ctx.stroke();
  ctx.restore();

  // Goals
  var gw=ahGoalWidth(), gx=(W-gw)/2, gDepth=ahPuck.r*2.2;
  ctx.save();
  var tgg=ctx.createLinearGradient(0,0,0,gDepth);
  tgg.addColorStop(0,'rgba(0,229,255,0.5)'); tgg.addColorStop(1,'rgba(0,229,255,0.02)');
  ctx.fillStyle=tgg; ctx.fillRect(gx,0,gw,gDepth);
  ctx.shadowColor='#00e5ff'; ctx.shadowBlur=16; ctx.strokeStyle='#00e5ff'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(gx,gDepth); ctx.lineTo(gx,3); ctx.lineTo(gx+gw,3); ctx.lineTo(gx+gw,gDepth); ctx.stroke();
  ctx.fillStyle='#00e5ff'; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.arc(gx,gDepth,5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(gx+gw,gDepth,5,0,Math.PI*2); ctx.fill();
  var bgg=ctx.createLinearGradient(0,H,0,H-gDepth);
  bgg.addColorStop(0,'rgba(255,64,129,0.5)'); bgg.addColorStop(1,'rgba(255,64,129,0.02)');
  ctx.fillStyle=bgg; ctx.fillRect(gx,H-gDepth,gw,gDepth);
  ctx.shadowColor='#ff4081'; ctx.strokeStyle='#ff4081';
  ctx.beginPath(); ctx.moveTo(gx,H-gDepth); ctx.lineTo(gx,H-3); ctx.lineTo(gx+gw,H-3); ctx.lineTo(gx+gw,H-gDepth); ctx.stroke();
  ctx.fillStyle='#ff4081'; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.arc(gx,H-gDepth,5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(gx+gw,H-gDepth,5,0,Math.PI*2); ctx.fill();
  ctx.restore();

  // Centre markings
  ctx.save();
  ctx.shadowColor='rgba(0,229,255,0.3)'; ctx.shadowBlur=10;
  ctx.strokeStyle='rgba(0,229,255,0.25)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(W/2,H/2,W*0.16,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle='rgba(0,229,255,0.12)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(W/2,H/2,W*0.06,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle='rgba(0,229,255,0.18)'; ctx.lineWidth=1.5;
  ctx.setLineDash([10,7]);
  ctx.beginPath(); ctx.moveTo(brd+8,H/2); ctx.lineTo(W-brd-8,H/2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowColor='#00e5ff'; ctx.shadowBlur=14;
  var cdg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,6);
  cdg.addColorStop(0,'rgba(0,229,255,0.9)'); cdg.addColorStop(1,'rgba(0,229,255,0)');
  ctx.fillStyle=cdg; ctx.beginPath(); ctx.arc(W/2,H/2,6,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0; ctx.strokeStyle='rgba(0,229,255,0.1)'; ctx.lineWidth=1;
  [H*0.25,H*0.75].forEach(function(fy){[W*0.25,W*0.75].forEach(function(fx){
    ctx.beginPath(); ctx.arc(fx,fy,W*0.06,0,Math.PI*2); ctx.stroke();
  });});
  ctx.restore();

  // Speed lines
  ctx.save();
  for (var i=0;i<ahSpeedLines.length;i++) {
    var sl=ahSpeedLines[i];
    ctx.globalAlpha=sl.life*0.6; ctx.strokeStyle='rgba(120,220,255,0.8)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(sl.x,sl.y);
    ctx.lineTo(sl.x+Math.cos(sl.angle)*sl.len,sl.y+Math.sin(sl.angle)*sl.len); ctx.stroke();
  }
  ctx.restore();

  // Trail
  ctx.save();
  for (var i=0;i<ahTrail.length;i++) {
    var frac=i/ahTrail.length, r2=ahPuck.r*frac*0.7; if (r2<0.5) continue;
    var tg=ctx.createRadialGradient(ahTrail[i].x,ahTrail[i].y,0,ahTrail[i].x,ahTrail[i].y,r2);
    tg.addColorStop(0,'rgba(0,229,255,'+(frac*0.55)+')'); tg.addColorStop(1,'rgba(0,229,255,0)');
    ctx.fillStyle=tg; ctx.beginPath(); ctx.arc(ahTrail[i].x,ahTrail[i].y,r2,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // Puck
  ctx.save();
  var puckSpd=Math.sqrt(ahPuck.vx*ahPuck.vx+ahPuck.vy*ahPuck.vy);
  var sFrac=Math.min(1,puckSpd/(ahW*2.4));
  ctx.shadowColor=sFrac>0.5?'rgba(255,120,0,0.9)':'#00e5ff';
  ctx.shadowBlur=Math.min(48,14+puckSpd*0.018);
  var pg=ctx.createRadialGradient(ahPuck.x-ahPuck.r*0.35,ahPuck.y-ahPuck.r*0.35,ahPuck.r*0.05,ahPuck.x,ahPuck.y,ahPuck.r);
  pg.addColorStop(0,'rgb('+Math.round(232+23*sFrac)+','+Math.round(248-100*sFrac)+','+Math.round(255-80*sFrac)+')');
  pg.addColorStop(0.3,'#70d8ff'); pg.addColorStop(0.7,'#0099cc'); pg.addColorStop(1,'#003355');
  ctx.beginPath(); ctx.arc(ahPuck.x,ahPuck.y,ahPuck.r,0,Math.PI*2); ctx.fillStyle=pg; ctx.fill();
  ctx.strokeStyle=sFrac>0.6?'rgba(255,'+Math.round(100*(1-sFrac))+',80,0.85)':'rgba(150,220,255,0.7)';
  ctx.lineWidth=2; ctx.stroke();
  ctx.shadowBlur=0; ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1.2;
  ctx.beginPath();
  ctx.moveTo(ahPuck.x-ahPuck.r*0.3,ahPuck.y); ctx.lineTo(ahPuck.x+ahPuck.r*0.3,ahPuck.y);
  ctx.moveTo(ahPuck.x,ahPuck.y-ahPuck.r*0.3); ctx.lineTo(ahPuck.x,ahPuck.y+ahPuck.r*0.3);
  ctx.stroke(); ctx.restore();

  // Rings
  ctx.save();
  for (var i=0;i<ahRings.length;i++) {
    var ring=ahRings[i];
    ctx.globalAlpha=ring.life*0.6; ctx.strokeStyle='#00e5ff'; ctx.lineWidth=2*ring.life;
    ctx.shadowColor='#00e5ff'; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.arc(ring.x,ring.y,ring.r,0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();

  // Paddles
  var pColors=['#00e5ff',ahMode==='pvb'?'#ff4081':'#ff9100'];
  var pDark=['#003344',ahMode==='pvb'?'#440022':'#442200'];
  var pGlow=['rgba(0,229,255,0.9)',ahMode==='pvb'?'rgba(255,64,129,0.9)':'rgba(255,145,0,0.9)'];
  var pLabels=['1',ahMode==='pvb'?'🤖':'2'];
  for (var pi=0;pi<2;pi++) {
    var pad=ahPaddles[pi]; ctx.save();
    ctx.shadowColor=pGlow[pi]; ctx.shadowBlur=26;
    var glowR=ctx.createRadialGradient(pad.x,pad.y,pad.r*0.5,pad.x,pad.y,pad.r*1.8);
    glowR.addColorStop(0,'rgba(255,255,255,0.06)'); glowR.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glowR; ctx.beginPath(); ctx.arc(pad.x,pad.y,pad.r*1.8,0,Math.PI*2); ctx.fill();
    var rg=ctx.createRadialGradient(pad.x-pad.r*0.3,pad.y-pad.r*0.35,pad.r*0.04,pad.x,pad.y,pad.r);
    rg.addColorStop(0,'#ffffff'); rg.addColorStop(0.35,pColors[pi]);
    rg.addColorStop(0.75,pColors[pi]+'99'); rg.addColorStop(1,pDark[pi]);
    ctx.beginPath(); ctx.arc(pad.x,pad.y,pad.r,0,Math.PI*2); ctx.fillStyle=rg; ctx.fill();
    ctx.strokeStyle=pColors[pi]; ctx.lineWidth=2.5; ctx.stroke();
    ctx.shadowBlur=0; ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(pad.x,pad.y,pad.r*0.62,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle=pDark[pi]; ctx.shadowColor=pColors[pi]; ctx.shadowBlur=4;
    ctx.beginPath(); ctx.arc(pad.x,pad.y,pad.r*0.22,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.font='bold '+Math.round(pad.r*0.28)+'px Orbitron,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.shadowBlur=0;
    ctx.fillText(pLabels[pi],pad.x,pad.y); ctx.restore();
  }

  // Particles
  ctx.save();
  for (var i=0;i<ahParticles.length;i++) {
    var p=ahParticles[i]; ctx.globalAlpha=p.life;
    ctx.shadowColor=p.color; ctx.shadowBlur=8; ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // Serve hint
  if (ahGoalFreezeMs>250) {
    var servingP1=ahServeWho===0;
    ctx.save();
    ctx.globalAlpha=Math.min(1,(ahGoalFreezeMs-250)/350);
    ctx.font='bold '+Math.round(W*0.042)+'px Orbitron,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.shadowColor='#00e5ff'; ctx.shadowBlur=16;
    var serveLabel = servingP1 ? '\u25b2 YOUR SERVE' : (ahMode==='pvp' ? '\u25bc P2 SERVE' : '\u25bc BOT SERVE');
    ctx.fillText(serveLabel,W/2,servingP1?H*0.73:H*0.27);
    ctx.restore();
  }

  // Pause
  if (ahPaused) {
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,W,H);
    ctx.font='bold '+Math.round(W*0.1)+'px Orbitron,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#00e5ff'; ctx.shadowColor='#00e5ff'; ctx.shadowBlur=30;
    ctx.fillText('PAUSED',W/2,H/2); ctx.restore();
  }
}

// ── Touch / Pointer ─────────────────────────────────────────────
(function(){
  var active={}, prevPos={}, prevTime={};
  function setup() {
    var canvas=document.getElementById('ah-canvas'); if (!canvas) return;
    function getScaled(e) {
      var rect=canvas.getBoundingClientRect();
      return {x:(e.clientX-rect.left)*(ahW/rect.width),y:(e.clientY-rect.top)*(ahH/rect.height)};
    }
    canvas.addEventListener('pointerdown',function(e){
      e.preventDefault();
      var s=getScaled(e);
      var pi=s.y>ahH/2?0:(ahMode==='pvp'?1:-1);
      if (pi>=0) { active[e.pointerId]=pi; prevPos[e.pointerId]=s; prevTime[e.pointerId]=performance.now(); }
    },{passive:false});
    canvas.addEventListener('pointermove',function(e){
      e.preventDefault();
      if (!(e.pointerId in active)) return;
      var s=getScaled(e), pi=active[e.pointerId];
      var now=performance.now(), prev=prevPos[e.pointerId]||s, pt=prevTime[e.pointerId]||now;
      var dtT=Math.max(1,now-pt);
      var rawVx=(s.x-prev.x)/(dtT/1000), rawVy=(s.y-prev.y)/(dtT/1000);
      var maxV=ahW*4.5, mag=Math.sqrt(rawVx*rawVx+rawVy*rawVy);
      if (mag>maxV){rawVx=rawVx/mag*maxV;rawVy=rawVy/mag*maxV;}
      ahPaddles[pi].x=s.x; ahPaddles[pi].y=s.y;
      ahClampPaddle(ahPaddles[pi],pi);
      ahPaddles[pi].pvx=rawVx; ahPaddles[pi].pvy=rawVy;
      prevPos[e.pointerId]=s; prevTime[e.pointerId]=now;
    },{passive:false});
    function onEnd(e){
      if (e.pointerId in active){var pi=active[e.pointerId];ahPaddles[pi].pvx=0;ahPaddles[pi].pvy=0;}
      delete active[e.pointerId];delete prevPos[e.pointerId];delete prevTime[e.pointerId];
    }
    canvas.addEventListener('pointerup',onEnd);
    canvas.addEventListener('pointercancel',onEnd);
  }
  setup();
})();

// ── Keyboard ───────────────────────────────────────────────────
(function(){
  var keyMap={
    'KeyW':{p:0,dir:'up'},'ArrowUp':{p:0,dir:'up'},
    'KeyS':{p:0,dir:'dn'},'ArrowDown':{p:0,dir:'dn'},
    'KeyA':{p:0,dir:'lt'},'ArrowLeft':{p:0,dir:'lt'},
    'KeyD':{p:0,dir:'rt'},'ArrowRight':{p:0,dir:'rt'},
    'KeyI':{p:1,dir:'up'},'KeyK':{p:1,dir:'dn'},
    'KeyJ':{p:1,dir:'lt'},'KeyL':{p:1,dir:'rt'}
  };
  function isActive(){
    var pp=document.getElementById('ah-play-panel');
    return ahRunning&&!ahPaused&&pp&&!pp.classList.contains('hidden');
  }
  document.addEventListener('keydown',function(e){
    if (!isActive()) return;
    var k=keyMap[e.code]; if (k){ahPaddles[k.p].key[k.dir]=true;e.preventDefault();}
  });
  document.addEventListener('keyup',function(e){
    var k=keyMap[e.code]; if (k) ahPaddles[k.p].key[k.dir]=false;
  });
})();

// ── Home page wiring ───────────────────────────────────────────
var ahHPMode='pvb', ahHPDiff='easy', ahHPWinScore=7;
(function(){
  function q(id){return document.getElementById(id);}
  ['ah-mode-pvb','ah-mode-pvp'].forEach(function(id){
    var el=q(id); if (!el) return;
    el.addEventListener('click',function(){
      ahHPMode=el.getAttribute('data-mode');
      document.querySelectorAll('#ah-home .ah-pill[data-mode]').forEach(function(b){b.classList.remove('active');});
      el.classList.add('active');
      var dr=q('ah-diff-row'); if (dr) dr.style.display=ahHPMode==='pvb'?'':'none';
      ahSnd.click();
    });
  });
  ['ah-diff-easy','ah-diff-medium','ah-diff-hard'].forEach(function(id){
    var el=q(id); if (!el) return;
    el.addEventListener('click',function(){
      ahHPDiff=el.getAttribute('data-diff');
      document.querySelectorAll('#ah-home .ah-pill[data-diff]').forEach(function(b){b.classList.remove('active');});
      el.classList.add('active'); ahSnd.click();
    });
  });
  ['ah-score-5','ah-score-7','ah-score-10'].forEach(function(id){
    var el=q(id); if (!el) return;
    el.addEventListener('click',function(){
      ahHPWinScore=parseInt(el.getAttribute('data-val'));
      document.querySelectorAll('#ah-home .ah-pill[data-val]').forEach(function(b){b.classList.remove('active');});
      el.classList.add('active'); ahSnd.click();
    });
  });
  var mb=q('ah-main-back');   if (mb) mb.addEventListener('click',function(){if(typeof showHub==='function')showHub();});
  var bb=q('ah-back-to-home');if (bb) bb.addEventListener('click',function(){if(typeof showAH==='function')showAH();});
  var sb=q('ah-hp-start');    if (sb) sb.addEventListener('click',startAHGame);
  var pb=q('ah-pause-btn');
  if (pb) pb.addEventListener('click',function(){
    ahPaused=!ahPaused; this.textContent=ahPaused?'▶':'⏸'; ahSnd.click();
  });
})();

function startAHGame(){
  ahMode=ahHPMode; ahDiff=ahHPDiff; ahWinScore=ahHPWinScore;
  var homeEl=document.getElementById('ah-home'), playEl=document.getElementById('ah-play-panel');
  if (homeEl) homeEl.classList.add('hidden');
  if (playEl) playEl.classList.remove('hidden');
  var p2l=document.getElementById('ah-p2-label'); if (p2l) p2l.textContent=ahMode==='pvb'?'BOT':'P2';
  var ol=document.getElementById('ah-overlay-msg');
  if (ol){ol.style.display='none';ol.className='ah-overlay-msg hidden';}
  var gf=document.getElementById('ah-goal-flash'); if (gf) gf.style.display='none';
  ahPaused=false;
  var pb=document.getElementById('ah-pause-btn'); if (pb) pb.textContent='⏸';
  ahInit();
  ahRunning=true; ahLastTime=0;
  ahRAF=requestAnimationFrame(ahLoop);
  ahUpdatePips('ah-p1-pips',0,ahWinScore,'#00e5ff');
  ahUpdatePips('ah-p2-pips',0,ahWinScore,'#ff4081');
  ahSnd.puckStart();
}
