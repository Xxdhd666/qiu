(function () {
  'use strict';
  var SHORT = { codex: 'Codex', gemini: 'Gemini', claude_gpt: 'Claude', argon: 'Argon' };
  var $ = function (id) { return document.getElementById(id); };
  var data = null, settings = { theme: 'auto', ballPool: 'codex' }, mode = { mode: 'full', side: null };
  var lastMainText = null, stripHovered = false;

  function color(v) { return v >= 50 ? 'var(--green)' : v >= 20 ? 'var(--amber)' : 'var(--red)'; }
  function toneKey(v) { return v == null ? 'none' : v >= 50 ? 'ok' : v >= 20 ? 'mid' : 'low'; }
  function ballText(v) { v = Math.max(0, v); return v >= 99.95 ? '100' : v.toFixed(1); }
  function stripText(v) {
    v = Math.max(0, v);
    return v >= 99.95 ? '100' : v <= 0.04 ? '0' : v >= 99.5 || v < 10 ? v.toFixed(1) : String(Math.round(v));
  }
  function pct2(v) { return Math.max(0, v).toFixed(2) + '%'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtReset(w) {
    if (!w || !w.resets_at) return '';
    var d = new Date(w.resets_at);
    if (isNaN(d)) return '';
    return '（刷新 ' + (w.resets_approx ? '约 ' : '') + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '）';
  }

  function applyTheme() {
    var dark = settings.theme === 'dark' ||
      (settings.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

    /* 5 小时为主、周为辅；没有 5 小时限额的池（Argon）只显示周 */
  function info(pool) {
    if (!pool || pool.status === 'no_data') return null;
    var f = pool.five_hour && pool.five_hour.remaining_pct != null ? pool.five_hour : null;
    var w = pool.weekly && pool.weekly.remaining_pct != null ? pool.weekly : null;
    if (f) return { main: f.remaining_pct, mainWin: f, aux: w ? w.remaining_pct : null, auxWin: w, mainLabel: '5 小时' };
    if (w) return { main: w.remaining_pct, mainWin: w, aux: null, auxWin: null, weeklyOnly: true, mainLabel: '周' };
    return null;
  }

  function setRing(id, v) {
    var el = $(id), C = 2 * Math.PI * parseFloat(el.getAttribute('r'));
    var pct = v == null ? 0 : Math.max(0, Math.min(100, v));
    el.style.strokeDasharray = C.toFixed(2);
    el.style.strokeDashoffset = (C * (1 - pct / 100)).toFixed(2);
    el.style.opacity = pct <= 0.05 ? '0' : '1';
    if (v != null) el.style.stroke = color(v);
  }

  function pulseNum(el, nextText) {
    if (lastMainText !== null && lastMainText !== nextText && !document.hidden) {
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    }
    lastMainText = nextText;
  }

  function render() {
    var pools = data ? data.pools : [];
    var pool = pools.filter(function (p) { return p.id === settings.ballPool; })[0] || pools[0];
    var bi = info(pool), hasAux = bi && bi.aux != null;
    var name = pool ? (SHORT[pool.id] || pool.name) : '额度';
    var ballEl = $('ball'), stripEl = $('strip'), numEl = $('ball-num');
    var worst = !bi ? null : hasAux ? Math.min(bi.main, bi.aux) : bi.main;
    var tk = toneKey(worst);
    ballEl.setAttribute('data-tone', tk);
    stripEl.setAttribute('data-tone', tk);

    /* 完整球：双环双数字 */
    $('ball-name').textContent = name;
    $('ring-aux').style.display = $('ring-aux-bg').style.display = hasAux ? '' : 'none';
    if (!bi) {
      pulseNum(numEl, '--');
      numEl.textContent = '--';
      numEl.classList.add('empty');
      $('ball-aux').textContent = pool && pool.status === 'no_data' ? '无数据' : '';
      setRing('ring-main', null);
    } else {
      var mt = ballText(bi.main);
      pulseNum(numEl, mt);
      numEl.textContent = mt;
      numEl.classList.remove('empty');
      setRing('ring-main', bi.main);
      if (hasAux) setRing('ring-aux', bi.aux);
      $('ball-aux').innerHTML = hasAux ? '周 <b>' + ballText(bi.aux) + '</b>' : (bi.weeklyOnly ? '周限额' : '');
    }

    /* 收起态：固定两行，零垂直跳动；悬停在双窗口池上时第一行平滑切换池名缩写 */
    stripEl.classList.toggle('only', !!(bi && !hasAux));
    var s1El = $('s1'), sFill = $('s-fill');
    if (!bi) {
      var emptyTxt = pool && pool.status === 'no_data' ? '无数据' : '--';
      s1El.textContent = emptyTxt;
      s1El.dataset.defaultText = emptyTxt;
      s1El.dataset.hoverText = emptyTxt;
      $('s2').textContent = name;
      $('s-edge').style.background = '';
      if (sFill) { sFill.style.width = '0%'; }
    } else if (hasAux) {
      var defS1 = '5h ' + stripText(bi.main) + '%';
      var hovS1 = name + ' ' + stripText(bi.main) + '%';
      s1El.dataset.defaultText = defS1;
      s1El.dataset.hoverText = hovS1;
      s1El.textContent = stripHovered ? hovS1 : defS1;
      $('s2').textContent = '周 ' + stripText(bi.aux) + '%';
      $('s-edge').style.background = color(worst);
      if (sFill) {
        sFill.style.width = Math.max(0, Math.min(100, worst)).toFixed(1) + '%';
        sFill.style.background = color(worst);
      }
    } else {
      var singleS1 = '周 ' + stripText(bi.main) + '%';
      s1El.dataset.defaultText = singleS1;
      s1El.dataset.hoverText = singleS1;
      s1El.textContent = singleS1;
      $('s2').textContent = name;
      $('s-edge').style.background = color(bi.main);
      if (sFill) {
        sFill.style.width = Math.max(0, Math.min(100, bi.main)).toFixed(1) + '%';
        sFill.style.background = color(bi.main);
      }
    }
    var tip = pool && bi
      ? pool.name + ' · ' + bi.mainLabel + '剩余 ' + pct2(bi.main) + fmtReset(bi.mainWin) +
        (hasAux ? ' · 周剩余 ' + pct2(bi.aux) + fmtReset(bi.auxWin) : '')
      : '暂无数据';
    ballEl.title = tip;
    stripEl.title = tip;
  }

  $('strip').addEventListener('pointerenter', function () {
    stripHovered = true;
    if ($('strip').classList.contains('dragging')) return;
    var s1 = $('s1');
    if (s1 && s1.dataset.hoverText) s1.textContent = s1.dataset.hoverText;
  });
  $('strip').addEventListener('pointerleave', function () {
    stripHovered = false;
    var s1 = $('s1');
    if (s1 && s1.dataset.defaultText) s1.textContent = s1.dataset.defaultText;
  });

  function applyMode() {
    var strip = mode.mode === 'strip';
    var f = $('full'), s = $('strip');
    var wasHidden = strip ? s.hidden : f.hidden;
    f.hidden = strip;
    s.hidden = !strip;
    var cls = 'strip ' + (mode.side === 'right' ? 'right' : 'left') + (s.classList.contains('only') ? ' only' : '');
    s.className = cls;
    if (wasHidden && !document.hidden) {
      var target = strip ? s : f;
      target.classList.remove('mode-enter');
      void target.offsetWidth;
      target.classList.add('mode-enter');
    }
  }

  /* 判断拖动时是否接近当前屏幕左右边缘（给出贴边吸附视觉预告） */
  function updateSnapHint(el, screenX) {
    if (el.id !== 'ball') return;
    var availLeft = typeof window.screen.availLeft === 'number' ? window.screen.availLeft : 0;
    var availW = window.screen.availWidth || window.screen.width || 1920;
    var nearLeft = (screenX - availLeft) <= 56;
    var nearRight = (availLeft + availW - screenX) <= 56;
    el.classList.toggle('snap-near-left', nearLeft && !nearRight);
    el.classList.toggle('snap-near-right', nearRight && !nearLeft);
  }

  /* 拖动：渲染进程只上报屏幕坐标位移，主进程移动窗口并在松手时判断贴边 */
  function wire(el) {
    var down = false, moved = false, sx = 0, sy = 0;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      down = true; moved = false; sx = e.screenX; sy = e.screenY;
      el.classList.remove('clicked');
      el.classList.add('pressing');
      el.setPointerCapture(e.pointerId);
      window.QF.ball.dragStart();
    });
    el.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.screenX - sx, dy = e.screenY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true;
        el.classList.remove('pressing');
        el.classList.add('dragging');
      }
      updateSnapHint(el, e.screenX);
      window.QF.ball.dragMove(dx, dy);
    });
    function end(e) {
      if (!down) return;
      down = false;
      el.classList.remove('pressing', 'dragging', 'snap-near-left', 'snap-near-right');
      try { el.releasePointerCapture(e.pointerId); } catch (x) { /* 忽略 */ }
      window.QF.ball.dragEnd();
      if (!moved && e.type === 'pointerup') {
        el.classList.remove('clicked');
        void el.offsetWidth;
        el.classList.add('clicked');
        window.QF.ball.click();
      }
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  wire($('ball'));
  wire($('strip'));

  window.QF.onData(function (d) { data = d; render(); });
  window.QF.onSettings(function (s) { settings = s; applyTheme(); render(); });
  window.QF.onBallMode(function (m) { mode = m; render(); applyMode(); });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', applyTheme);
  }
  Promise.all([window.QF.getData(), window.QF.getSettings(), window.QF.getBallMode()]).then(function (r) {
    data = r[0]; settings = r[1]; mode = r[2]; applyTheme(); render(); applyMode();
  });
})();
