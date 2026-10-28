(function () {
  'use strict';

  var QF = window.QF;
  var NO_TOKENS = '—';
  var PAGE_SIZE = 8;
  var DAILY_PAGE_SIZE = 7;

  var data = null;
  var loadError = null;
  var prefs = { ballPool: 'codex', theme: 'auto', autostart: false };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 偏好（保存在主进程的 settings.json） ---------- */
  var SHORT = { codex: 'Codex', gemini: 'Gemini', claude_gpt: 'Claude', argon: 'Argon' };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function applyPrefs(p) {
    if (!p) return;
    prefs.ballPool = p.ballPool || 'codex';
    prefs.theme = p.theme || 'auto';
    prefs.autostart = !!p.autostart;
  }

  var toastEl = null, toastTimer = 0;
  function toast(msg, isErr) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = 'toast' + (isErr ? ' err' : '');
    }, 1600);
  }

  function updateDetailBallBadge() {
    var el = $('view-detail');
    if (!el || !data) return false;
    var cards = el.querySelectorAll('.card[data-card-pool]');
    if (!cards.length) return false;
    var curBallId = (poolById(prefs.ballPool) || data.pools[0] || {}).id;
    cards.forEach(function (card) {
      var pid = card.getAttribute('data-card-pool');
      var isBall = pid === curBallId;
      card.classList.toggle('is-ball', isBall);
      var slot = card.querySelector('.ball-badge-slot');
      if (slot) {
        slot.innerHTML = isBall
          ? '<span class="badge-ball active" title="当前悬浮球显示此额度池">悬浮球显示中</span>'
          : '<button type="button" class="badge-ball switch" data-pick-ball="' + esc(pid) + '" title="点击切换悬浮球显示此池">设为悬浮球</button>';
      }
    });
    return true;
  }

  function savePrefs(patch, okMsg) {
    QF.saveSettings(patch).then(function (p) {
      applyPrefs(p);
      applyTheme();
      if (!updateDetailBallBadge()) renderDetail();
      renderSelect();
      renderSettings();
      toast(okMsg || '已保存');
    }).catch(function () {
      toast('保存失败，请重试', true);
    });
  }

  var scan = { busy: false, done: false };

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct2(v) { return Math.max(0, v).toFixed(2) + '%'; }
  function signed(v) {
    if (v == null || Math.abs(v) < 0.005) return '0.00%';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
  }
  function ballText(v) { v = Math.max(0, v); return v >= 99.95 ? '100' : v.toFixed(1); }
  function stripText(v) {
    v = Math.max(0, v);
    return v >= 99.95 ? '100' : v <= 0.04 ? '0' : v >= 99.5 || v < 10 ? v.toFixed(1) : String(Math.round(v));
  }
  function color(v) { return v >= 50 ? 'var(--green)' : v >= 20 ? 'var(--amber)' : 'var(--red)'; }
  function tone(v) { return v >= 50 ? 'tone-ok' : v >= 20 ? 'tone-mid' : 'tone-low'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(iso, withYear) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return (withYear ? d.getFullYear() + '-' : '') + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function relTime(iso, nowMs) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var diff = t - (nowMs || Date.now());
    if (diff <= 0) return '已到点';
    var mins = Math.round(diff / 60000);
    if (mins < 60) return mins + ' 分钟后';
    var hrs = Math.floor(mins / 60), remM = mins % 60;
    if (hrs < 24) return hrs + ' 小时' + (remM > 0 ? ' ' + remM + ' 分' : '') + '后';
    var days = Math.floor(hrs / 24), remH = hrs % 24;
    return days + ' 天' + (remH > 0 ? ' ' + remH + ' 小时' : '') + '后';
  }

  function dayOf(iso) {
    var d = iso instanceof Date ? iso : new Date(iso);
    return isNaN(d) ? null : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dayTag(dayStr) {
    if (!dayStr) return '';
    var now = new Date();
    if (dayStr === dayOf(now)) return '今日';
    var yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayStr === dayOf(yest)) return '昨日';
    var parts = dayStr.split('-');
    if (parts.length === 3) {
      var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(dt)) return WEEKDAYS[dt.getDay()];
    }
    return '';
  }

  function fmtInt(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function short(n) {
    if (n == null) return '—';
    n = Math.abs(n);
    return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
  }
  function poolById(id) { return data && data.pools.filter(function (p) { return p.id === id; })[0]; }

  /* 某池的两个窗口（用于详情页：始终显示全部池） */
  function windowsOf(pool) {
    var out = [];
    if (pool.status === 'no_data') return out;
    if (pool.five_hour && pool.five_hour.remaining_pct != null) out.push({ label: '5 小时', w: pool.five_hour });
    if (pool.weekly && pool.weekly.remaining_pct != null) out.push({ label: '周', w: pool.weekly });
    return out;
  }
  function lowest(wins) {
    var m = null;
    wins.forEach(function (x) { if (m === null || x.w.remaining_pct < m.w.remaining_pct) m = x; });
    return m;
  }
  /* 5 小时为主、周为辅；没有 5 小时限额的池（Argon）只显示周 */
  function ballInfo(pool) {
    if (!pool || pool.status === 'no_data') return null;
    var f = pool.five_hour && pool.five_hour.remaining_pct != null ? pool.five_hour : null;
    var w = pool.weekly && pool.weekly.remaining_pct != null ? pool.weekly : null;
    if (f) return { main: f.remaining_pct, mainLabel: '5 小时', aux: w ? w.remaining_pct : null };
    if (w) return { main: w.remaining_pct, mainLabel: '周', aux: null, weeklyOnly: true };
    return null;
  }

  /* ---------- 按天汇总聚合逻辑（基于已有 data.usage） ---------- */
  function buildDailySummary(rows) {
    var map = {}, order = [];
    (rows || []).forEach(function (r) {
      var d = dayOf(r.time);
      if (!d) return;
      if (!map[d]) {
        map[d] = {
          day: d,
          sessions: 0,
          tokSessions: 0,
          input: 0,
          output: 0,
          total: 0,
          maxSingle: 0,
          pct: 0,
          hasPct: false,
          pools: [],
          models: []
        };
        order.push(d);
      }
      var item = map[d];
      item.sessions += 1;
      if (r.total_tokens != null) {
        item.tokSessions += 1;
        item.input += (r.input_tokens || 0);
        item.output += (r.output_tokens || 0);
        item.total += (r.total_tokens || 0);
        if ((r.total_tokens || 0) > item.maxSingle) item.maxSingle = r.total_tokens || 0;
      }
      if (r.pct_change != null) {
        item.pct += r.pct_change;
        item.hasPct = true;
      }
      var pName = SHORT[r.pool_id] || r.pool;
      if (pName && item.pools.indexOf(pName) < 0) item.pools.push(pName);
      if (r.model && r.model !== '—' && item.models.indexOf(r.model) < 0) item.models.push(r.model);
    });
    order.sort(function (a, b) { return a < b ? 1 : -1; });
    return order.map(function (k) { return map[k]; });
  }

  /* ---------- 详情页 ---------- */
  var prevPoolPct = {};
  function poolSourceTag(p) {
    var asOfTxt = p.as_of ? ' · 采集于 ' + fmtTime(p.as_of, true) : '';
    if (p.status === 'no_data') {
      return '<span class="tag tag-muted" title="本地与实时接口均未读取到该额度池数据">无数据</span>';
    }
    if (p.id === 'codex') {
      return data && data.codexSource === 'live'
        ? '<span class="tag tag-ok" title="' + esc('来源：Codex 实时接口查询' + asOfTxt) + '">实时</span>'
        : '<span class="tag tag-muted" title="' + esc('来源：本机 Codex 会话文件快照' + asOfTxt) + '">本地</span>';
    }
    return p.status === 'auto'
      ? '<span class="tag tag-ok" title="' + esc('来源：agy /usage 自动采集' + asOfTxt) + '">自动</span>'
      : '<span class="tag tag-muted" title="' + esc('来源：上次采集快照' + asOfTxt) + '">快照</span>';
  }

  function barLine(label, w, isMissingWindow, nowMs) {
    if (isMissingWindow) {
      return '<div class="card-line" title="该额度池仅设周限额，无 5 小时滑动限额"><span class="cl-label">' + label + '</span>' +
        '<span class="mini-track empty"></span><span class="cl-val muted">仅周限额</span></div>';
    }
    var has = w && w.remaining_pct != null;
    var pct = has ? Math.max(0, Math.min(100, w.remaining_pct)) : 0;
    var tCls = has ? tone(pct) : '';
    var tip = label + '：' + (has ? pct2(w.remaining_pct) : '暂无数据');
    var lineAttr = '';
    if (has && w.resets_at) {
      var basePrefix = tip + ' · 刷新：' + (w.resets_approx ? '约 ' : '') + fmtTime(w.resets_at);
      var rRel = relTime(w.resets_at, nowMs);
      tip = basePrefix + (rRel ? '（' + rRel + '）' : '');
      lineAttr = ' data-line-resets="' + esc(w.resets_at) + '" data-line-prefix="' + esc(basePrefix) + '"';
    }
    return '<div class="card-line"' + lineAttr + ' title="' + esc(tip) + '"><span class="cl-label">' + label + '</span>' +
      '<span class="mini-track"><i class="mini-fill ' + tCls + '" style="width:' + pct.toFixed(1) + '%"></i></span>' +
      '<span class="cl-val num">' + (has ? pct2(w.remaining_pct) : '—') + '</span></div>';
  }

  function renderDetail() {
    var el = $('view-detail');
    if (!data) { el.innerHTML = '<div class="empty">' + esc(loadError || '加载中…') + '</div>'; return; }
    var now = Date.now();
    var curBallId = (poolById(prefs.ballPool) || data.pools[0] || {}).id;

    var cardsHtml = '<div class="cards">' + data.pools.map(function (p) {
      var isBall = p.id === curBallId;
      var ballBadge = isBall
        ? '<span class="badge-ball active" title="当前悬浮球显示此额度池">悬浮球显示中</span>'
        : '<button type="button" class="badge-ball switch" data-pick-ball="' + esc(p.id) + '" title="点击切换悬浮球显示此池">设为悬浮球</button>';
      var head = '<div class="card-top"><div class="card-title-wrap"><span class="card-name clickable-pool" data-open-pool="' + esc(p.id) + '" title="点击查看 ' + esc(p.name) + ' 的用量统计">' + esc(p.name) + '</span>' +
        poolSourceTag(p) + '</div><span class="ball-badge-slot">' + ballBadge + '</span></div>';

      if (p.status === 'no_data') {
        return '<div class="card' + (isBall ? ' is-ball' : '') + '" data-card-pool="' + esc(p.id) + '">' + head +
          '<div class="card-hero"><div class="card-big nodata">暂无数据</div></div>' +
          '<div class="card-bars">' + barLine('5 小时限额', null, false) + barLine('周限额', null, false) + '</div>' +
          '<div class="card-reset"><span>刷新：—</span></div></div>';
      }

      var wins = windowsOf(p);
      var m = lowest(wins);
      var pctKey = m ? m.w.remaining_pct.toFixed(2) : '--';
      var changed = prevPoolPct[p.id] !== undefined && prevPoolPct[p.id] !== pctKey;
      prevPoolPct[p.id] = pctKey;
      var big = m
        ? '<div class="card-hero"><div class="card-big num ' + tone(m.w.remaining_pct) + (changed ? ' pulse' : '') + '">' +
          pctKey + '<span class="unit">%</span></div>' +
          '<span class="card-win-label">' + esc(m.label) + '最低剩余</span></div>'
        : '<div class="card-hero"><div class="card-big nodata">—</div></div>';

      var lines = '<div class="card-bars">' +
        barLine('5 小时限额', p.five_hour, !p.five_hour, now) +
        barLine('周限额', p.weekly, false, now) +
        '</div>';

      var reset = '刷新：—', rel = '', cls = 'card-reset', fullResetTip = '';
      if (m && m.w.resets_at) {
        reset = m.label + '刷新 ' + (m.w.resets_approx ? '约 ' : '') + fmtTime(m.w.resets_at);
        if (new Date(m.w.resets_at).getTime() < now) {
          reset = m.label + '已过刷新点，数据可能过期';
          cls += ' stale';
        } else {
          rel = relTime(m.w.resets_at, now);
        }
        var allTips = wins.filter(function (x) { return x.w && x.w.resets_at; }).map(function (x) {
          var rStr = relTime(x.w.resets_at, now);
          return x.label + '刷新：' + (x.w.resets_approx ? '约 ' : '') + fmtTime(x.w.resets_at) + (rStr ? '（' + rStr + '）' : '');
        });
        fullResetTip = allTips.join(' ｜ ');
      } else if (m) {
        reset = m.label + '刷新：未记录';
        fullResetTip = reset;
      }
      var resetAttr = m && m.w.resets_at ? ' data-resets-at="' + esc(m.w.resets_at) + '" data-win-label="' + esc(m.label) + '"' : '';
      return '<div class="card' + (isBall ? ' is-ball' : '') + '" data-card-pool="' + esc(p.id) + '">' + head + big + lines +
        '<div class="' + cls + '"' + resetAttr + ' title="' + esc(fullResetTip || reset) + '">' +
        '<span class="reset-main">' + esc(reset) + '</span>' +
        (rel ? '<span class="reset-rel num">' + esc(rel) + '</span>' : '') +
        '</div></div>';
    }).join('') + '</div>';

    /* 详情页底部：按天汇总速览条 */
    var daily = buildDailySummary(data.usage || []);
    var latest = daily[0] || null;
    var recent7 = daily.slice(0, 7).reverse();
    var maxDayTok = 0, maxDaySes = 0;
    recent7.forEach(function (d) {
      if (d.total > maxDayTok) maxDayTok = d.total;
      if (d.sessions > maxDaySes) maxDaySes = d.sessions;
    });

    var sparkHtml = '';
    if (recent7.length) {
      sparkHtml = '<div class="mini-spark" title="最近活跃日用度趋势（点击柱条定位至该日汇总）">' +
        recent7.map(function (d) {
          var isToday = dayTag(d.day) === '今日';
          var h = (d.tokSessions && maxDayTok > 0)
            ? Math.max(20, Math.round(d.total / maxDayTok * 100))
            : Math.max(20, Math.round(d.sessions / Math.max(1, maxDaySes) * 75));
          var colCls = 'spark-col' + (isToday ? ' is-today' : '') + (!d.tokSessions ? ' no-tok' : '');
          var metricTip = d.tokSessions
            ? fmtInt(d.total) + ' token'
            : (d.hasPct ? '消耗变化 ' + signed(d.pct) : '无公开 token');
          return '<div class="' + colCls + '" data-goto-day="' + esc(d.day) + '" title="' +
            esc(d.day + (isToday ? ' (今日)' : '') + '：' + metricTip + '（' + d.sessions + ' 次记录）') + '">' +
            '<span class="spark-bar" style="height:' + h + '%"></span>' +
            '<span class="spark-d num">' + esc(d.day.slice(5)) + '</span></div>';
        }).join('') + '</div>';
    }

    var summaryStrip = '<div class="detail-daily">' +
      '<div class="dd-head">' +
        '<div class="dd-title"><span class="dd-dot"></span><span>按天汇总速览</span>' +
        (latest ? '<span class="dd-sub">最近活跃：' + esc(latest.day) + '（' + esc(dayTag(latest.day)) + '）</span>' : '<span class="dd-sub">暂无会话记录</span>') +
        '</div>' +
        '<button type="button" class="dd-more" data-open-daily="1">按天汇总详情 ▸</button>' +
      '</div>';

    if (latest) {
      var totalDays = daily.length;
      var tokDays = daily.filter(function (d) { return d.tokSessions > 0; });
      var allTok = tokDays.reduce(function (a, d) { return a + d.total; }, 0);
      var avgDayTok = tokDays.length ? Math.round(allTok / tokDays.length) : null;
      var sesTip = latest.day + ' 共 ' + latest.sessions + ' 次会话记录（涉及：' + (latest.pools.join('、') || '—') + '），点击定位至该日汇总';
      var tokTip = latest.tokSessions
        ? latest.day + ' 合计：' + fmtInt(latest.total) + ' token（输入 ' + fmtInt(latest.input) + ' / 输出 ' + fmtInt(latest.output) + '），点击定位至该日汇总'
        : latest.day + ' 所涉额度池官方不公开 token 数，点击定位至该日汇总';
      var pctTip = latest.hasPct
        ? latest.day + ' 累计消耗变化：' + signed(latest.pct) + '，点击定位至该日汇总'
        : latest.day + ' 无额度变化记录';
      var avgTip = '累计活跃 ' + totalDays + ' 天' + (tokDays.length ? ' · 含 Token 记录 ' + tokDays.length + ' 天 · 累计 ' + fmtInt(allTok) + ' token · 日均 ' + fmtInt(avgDayTok) + ' token' : '') + '（点击进入按天汇总）';
      summaryStrip += '<div class="dd-body">' +
        '<div class="dd-kpis">' +
          '<div class="dd-kpi" data-goto-day="' + esc(latest.day) + '" title="' + esc(sesTip) + '"><span class="dd-k">当日记录</span><span class="dd-v num">' + latest.sessions + ' <small>次</small></span></div>' +
          '<div class="dd-kpi" data-goto-day="' + esc(latest.day) + '" title="' + esc(tokTip) + '"><span class="dd-k">当日合计 Token</span><span class="dd-v num">' + (latest.tokSessions ? short(latest.total) : '—') + '</span></div>' +
          '<div class="dd-kpi" data-goto-day="' + esc(latest.day) + '" title="' + esc(pctTip) + '"><span class="dd-k">当日额度变化</span><span class="dd-v num">' + (latest.hasPct ? signed(latest.pct) : '—') + '</span></div>' +
          '<div class="dd-kpi" data-open-daily="1" title="' + esc(avgTip) + '"><span class="dd-k">累计活跃 / 日均</span><span class="dd-v num">' + totalDays + '天 <small>· ' + (avgDayTok != null ? short(avgDayTok) : '—') + '</small></span></div>' +
        '</div>' + sparkHtml + '</div>';
    } else {
      summaryStrip += '<div class="dd-empty">本地尚无会话统计记录</div>';
    }
    summaryStrip += '</div>';

    el.innerHTML = cardsHtml + summaryStrip;
  }

  /* ---------- 悬浮球显示（选择页：支持原地平滑过渡双环与进度条） ---------- */
  var lastSpNumText = null;
  function renderSelect() {
    var el = $('view-select');
    if (!data) { el.innerHTML = ''; lastSpNumText = null; return; }
    var cur = poolById(prefs.ballPool) || data.pools[0];
    var cb = ballInfo(cur);
    var hasAux = cb && cb.aux != null;
    var mainPct = cb ? Math.max(0, Math.min(100, cb.main)) : 0;
    var auxPct = hasAux ? Math.max(0, Math.min(100, cb.aux)) : 0;
    var worstPct = !cb ? 0 : hasAux ? Math.min(mainPct, auxPct) : mainPct;
    var mainC = cb ? color(cb.main) : 'var(--seg)';
    var auxC = hasAux ? color(cb.aux) : 'var(--seg)';
    var edgeC = cb ? color(hasAux ? Math.min(cb.main, cb.aux) : cb.main) : 'var(--seg)';
    var c1 = 2 * Math.PI * 39;
    var c2 = 2 * Math.PI * 33.5;
    var off1 = cb ? c1 * (1 - mainPct / 100) : c1;
    var off2 = hasAux ? c2 * (1 - auxPct / 100) : c2;
    var shortName = cur ? (SHORT[cur.id] || cur.name) : '额度';
    var numTxt = cb ? ballText(cb.main) : '--';
    var auxHtml = hasAux ? '周 <b>' + ballText(cb.aux) + '</b>' : (cb && cb.weeklyOnly ? '周限额' : '');
    var s1Txt = !cb ? '无数据' : hasAux ? '5h ' + stripText(cb.main) + '%' : '周 ' + stripText(cb.main) + '%';
    var s1HoverTxt = !cb ? '无数据' : hasAux ? shortName + ' ' + stripText(cb.main) + '%' : '周 ' + stripText(cb.main) + '%';
    var s2Txt = !cb ? shortName : hasAux ? '周 ' + stripText(cb.aux) + '%' : shortName;

    if (!$('sp-ring-main')) {
      el.innerHTML = '<div class="select-preview">' +
        '<div class="sp-visuals">' +
          '<div class="sp-ball-wrap">' +
            '<div class="ball sp-ball" id="sp-ball">' +
              '<svg viewBox="0 0 84 84" class="ring" aria-hidden="true">' +
                '<circle class="ring-bg" cx="42" cy="42" r="39"></circle>' +
                '<circle id="sp-ring-main" class="ring-fg" cx="42" cy="42" r="39"></circle>' +
                '<circle id="sp-ring-aux-bg" class="ring-bg thin" cx="42" cy="42" r="33.5"></circle>' +
                '<circle id="sp-ring-aux" class="ring-fg thin" cx="42" cy="42" r="33.5"></circle>' +
              '</svg>' +
              '<span class="ball-in">' +
                '<span id="sp-ball-name" class="ball-name"></span>' +
                '<span id="sp-ball-num" class="ball-num"></span>' +
                '<span id="sp-ball-aux" class="ball-aux"></span>' +
              '</span>' +
            '</div>' +
            '<span class="sp-cap">完整态（双环）</span>' +
          '</div>' +
          '<div class="sp-strip-wrap">' +
            '<div class="sp-strip" id="sp-strip">' +
              '<span id="sp-edge" class="sp-edge"></span>' +
              '<span id="sp-s1" class="sp-s1 num"></span>' +
              '<span id="sp-s2" class="sp-s2 num"></span>' +
              '<span class="sp-strip-track" aria-hidden="true"><i id="sp-strip-fill" class="sp-strip-fill"></i></span>' +
            '</div>' +
            '<span class="sp-cap">贴边收起态（窄条）</span>' +
          '</div>' +
        '</div>' +
        '<div class="sp-info">' +
          '<div class="sp-title">当前显示：<b id="sp-cur-name"></b></div>' +
          '<p class="sp-desc">大号数字与外圈表示 <b>5 小时剩余</b>，内圈与底部小字表示 <b>周剩余</b>；仅含周限额的池（如 Argon）自动切换为单环显示。拖拽悬浮球至屏幕左右边缘可自动收起为窄条。</p>' +
        '</div>' +
      '</div>' +
      '<div id="sp-group" class="group"></div>';
      var spStripEl = $('sp-strip'), spBallEl = $('sp-ball');
      spStripEl.addEventListener('pointerenter', function () {
        var s1 = $('sp-s1');
        if (s1 && s1.dataset.hoverText) s1.textContent = s1.dataset.hoverText;
      });
      spStripEl.addEventListener('pointerleave', function () {
        var s1 = $('sp-s1');
        if (s1 && s1.dataset.defaultText) s1.textContent = s1.dataset.defaultText;
      });
      [spBallEl, spStripEl].forEach(function (node) {
        node.addEventListener('click', function () {
          node.classList.remove('clicked');
          void node.offsetWidth;
          node.classList.add('clicked');
          if (!data || !data.pools || !data.pools.length) return;
          var pIds = data.pools.map(function (p) { return p.id; });
          var cIdx = Math.max(0, pIds.indexOf(prefs.ballPool));
          var nextPool = data.pools[(cIdx + 1) % data.pools.length];
          if (nextPool) savePrefs({ ballPool: nextPool.id }, '悬浮球已切换：' + nextPool.name);
        });
      });
    }

    var rm = $('sp-ring-main'), ra = $('sp-ring-aux'), rab = $('sp-ring-aux-bg');
    rm.style.strokeDasharray = c1.toFixed(2);
    rm.style.strokeDashoffset = off1.toFixed(2);
    rm.style.stroke = mainC;
    rm.style.opacity = mainPct <= 0.05 ? '0' : '1';
    rab.style.display = ra.style.display = hasAux ? '' : 'none';
    ra.style.strokeDasharray = c2.toFixed(2);
    ra.style.strokeDashoffset = off2.toFixed(2);
    ra.style.stroke = auxC;
    ra.style.opacity = (!hasAux || auxPct <= 0.05) ? '0' : '1';

    $('sp-ball-name').textContent = shortName;
    var spNumEl = $('sp-ball-num');
    if (lastSpNumText !== null && lastSpNumText !== numTxt) {
      spNumEl.classList.remove('pulse');
      void spNumEl.offsetWidth;
      spNumEl.classList.add('pulse');
    }
    lastSpNumText = numTxt;
    spNumEl.textContent = numTxt;
    spNumEl.classList.toggle('empty', !cb);
    var spTone = !cb ? 'none' : worstPct >= 50 ? 'ok' : worstPct >= 20 ? 'mid' : 'low';
    $('sp-ball').setAttribute('data-tone', spTone);
    $('sp-strip').setAttribute('data-tone', spTone);
    $('sp-ball-aux').innerHTML = auxHtml;
    $('sp-edge').style.background = edgeC;
    var spS1 = $('sp-s1');
    spS1.textContent = s1Txt;
    spS1.dataset.defaultText = s1Txt;
    spS1.dataset.hoverText = s1HoverTxt;
    $('sp-s2').textContent = s2Txt;
    var sf = $('sp-strip-fill');
    sf.style.width = worstPct.toFixed(1) + '%';
    sf.style.background = edgeC;
    $('sp-cur-name').textContent = cur ? cur.name : '—';
    var spTip = (cur && cb
      ? cur.name + ' · ' + cb.mainLabel + '剩余 ' + pct2(cb.main) + (hasAux ? ' · 周剩余 ' + pct2(cb.aux) : '')
      : '暂无数据') + '（点击可切换下一个额度池）';
    $('sp-ball').title = spTip;
    $('sp-strip').title = spTip;

    var nowMs = Date.now();
    var winTip = function (lbl, w) {
      if (!w || w.remaining_pct == null) return '';
      var s = lbl + '剩余 ' + pct2(w.remaining_pct);
      if (w.resets_at) {
        var r = relTime(w.resets_at, nowMs);
        s += ' · 刷新：' + (w.resets_approx ? '约 ' : '') + fmtTime(w.resets_at) + (r ? '（' + r + '）' : '');
      }
      return s;
    };
    $('sp-group').innerHTML = '<h3><span>选择悬浮球要显示的额度池</span><span class="h3-hint">支持 ↑ / ↓ 键快速切换</span></h3>' +
      data.pools.map(function (p) {
        var b = ballInfo(p);
        var isSel = p.id === cur.id;
        var chips = '';
        if (p.status === 'no_data' || !b) {
          chips = '<span class="p-chip muted">暂无数据</span>';
        } else if (b.aux != null) {
          chips = '<span class="p-chip" title="' + esc(winTip('5 小时限额', p.five_hour)) + '"><i class="dot ' + tone(b.main) + '"></i>5h ' + b.main.toFixed(1) + '%</span>' +
            '<span class="p-chip" title="' + esc(winTip('周限额', p.weekly)) + '"><i class="dot ' + tone(b.aux) + '"></i>周 ' + b.aux.toFixed(1) + '%</span>';
        } else {
          var singleW = p.five_hour && p.five_hour.remaining_pct != null ? p.five_hour : p.weekly;
          chips = '<span class="p-chip" title="' + esc(winTip(b.mainLabel + '限额', singleW)) + '"><i class="dot ' + tone(b.main) + '"></i>' + esc(b.mainLabel) + ' ' + b.main.toFixed(1) + '%</span>';
        }
        return '<label class="row pool-row' + (isSel ? ' selected' : '') + '">' +
          '<input type="radio" name="ballpool" data-pool="' + esc(p.id) + '"' + (isSel ? ' checked' : '') + '>' +
          '<span class="pool-row-name">' + esc(p.name) + '</span>' +
          poolSourceTag(p) +
          '<span class="hint num pool-chips">' + chips + '</span></label>';
      }).join('');
  }

  /* ---------- 设置页 ---------- */
  var THEMES = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '暗色']];
  function fmtPctCell(v, missingLabel) {
    if (v == null) return '<span class="muted">' + (missingLabel || '—') + '</span>';
    return '<span class="m-pct num"><i class="m-dot ' + tone(v) + '"></i>' + v.toFixed(2) + '%</span>';
  }
  function renderSettings() {
    if (!data) { $('view-settings').innerHTML = ''; return; }
    var ag = data.pools.filter(function (p) { return p.id !== 'codex'; });
    var agRows = ag.map(function (p) {
      var w = p.weekly && p.weekly.remaining_pct, f = p.five_hour && p.five_hour.remaining_pct;
      return '<div class="manual row-link" data-open-pool="' + esc(p.id) + '" title="点击查看 ' + esc(p.name) + ' 的用量统计"><span class="m-name">' + esc(p.name) + '</span>' +
        fmtPctCell(f, '仅周限额') +
        fmtPctCell(w, '—') +
        '<span class="asof num">' + fmtTime(p.as_of, true) + '</span></div>';
    }).join('');
    var diag = data.antigravityDiag || {};
    var agNote = data.antigravityStatus === 'auto'
      ? '来源：agy /usage 自动采集' + (diag.agyPath ? '（' + diag.agyPath + '）' : '')
      : '采集失败' + (diag.lastError ? '：' + diag.lastError : (data.antigravityStatus === 'not_logged_in' ? '：agy 未登录' : '：未检测到 agy')) + '（显示上次快照）';
    var cx = data.pools.filter(function (p) { return p.id === 'codex'; })[0];
    var cxW = cx && cx.weekly && cx.weekly.remaining_pct, cxF = cx && cx.five_hour && cx.five_hour.remaining_pct;
    var cxRow = cx ? '<div class="manual head"><span>额度池</span><span>5 小时剩余</span><span>周剩余</span><span class="asof">采集时间</span></div>' +
      '<div class="manual row-link" data-open-pool="' + esc(cx.id) + '" title="点击查看 ' + esc(cx.name) + ' 的用量统计"><span class="m-name">' + esc(cx.name) + '</span>' +
      fmtPctCell(cxF, '—') +
      fmtPctCell(cxW, '—') +
      '<span class="asof num">' + fmtTime(cx.as_of, true) + '</span></div>' : '';
    var cxDiag = data.codexLiveDiag || {};
    var cxNote = data.codexSource === 'live'
      ? '来源：实时查询' + (cxDiag.cmd ? '（' + cxDiag.cmd + '）' : '') + ' · ' + fmtTime(cx && cx.as_of, true)
      : '实时查询失败，显示本地最后会话（' + fmtTime(cx && cx.as_of, true) + '）' + (data.codexLiveError ? '：' + data.codexLiveError : '');
    $('view-settings').innerHTML =
      '<div class="group"><h3>外观</h3><div class="seg">' + THEMES.map(function (t) {
        return '<button type="button" data-theme="' + t[0] + '" class="' + (prefs.theme === t[0] ? 'active' : '') + '">' + t[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="group"><h3>后台运行</h3><label class="switch-row"><span>开机自启</span>' +
      '<input type="checkbox" id="autostart"' + (prefs.autostart ? ' checked' : '') + '></label>' +
      '</div>' +
      '<div class="group"><h3>Codex 额度（自动同步）</h3>' + cxRow +
      '<p class="setting-note" title="' + esc(cxNote) + '">' + esc(cxNote) + '</p></div>' +
      '<div class="group"><h3>Antigravity 额度（自动同步）</h3>' +
      '<div class="manual head"><span>额度池</span><span>5 小时剩余</span><span>周剩余</span><span class="asof">采集时间</span></div>' + agRows +
      '<p class="setting-note" title="' + esc(agNote) + '">' + esc(agNote) + '</p></div>';
  }

  function applyTheme() {
    var dark = prefs.theme === 'dark' ||
      (prefs.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  /* ---------- 仪表盘 ---------- */
  var METRICS = [['total', '合计 token'], ['input', '输入 token'], ['output', '输出 token'], ['pct', '百分比变化']];
  var dash = { pool: 'all', model: 'all', day: 'all', metric: 'total', view: 'overview', page: 0, dailyPage: 0, dailySort: 'day', dailyAsc: false, tableSort: 'time', tableAsc: false };
  var PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c5)', 'var(--c4)', 'var(--c6)'];

  function hasTokens(r) { return r.total_tokens != null; }
  function val(r, m) {
    return m === 'input' ? r.input_tokens : m === 'output' ? r.output_tokens : m === 'total' ? r.total_tokens : r.pct_change;
  }
  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (x != null && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }
  function sel(id, label, opts, cur) {
    return '<label class="f"><span>' + label + '</span><select id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function group(rows, keyFn, m) {
    var map = {}, order = [];
    rows.forEach(function (r) {
      var v = val(r, m);
      if (v == null) return;
      var k = keyFn(r);
      if (k == null) return;
      if (!(k in map)) { map[k] = 0; order.push(k); }
      map[k] += v;
    });
    return order.map(function (k) { return { k: k, v: map[k] }; });
  }
  function fmtVal(v, m) { return m === 'pct' ? signed(v) : fmtInt(v); }

  /* 环形图：按占比；纯 SVG（圆周长归一为 100），中央展示总计，图例支持点击筛选模型 */
  function donut(items, m, title) {
    var total = items.reduce(function (a, x) { return a + Math.abs(x.v); }, 0);
    if (!items.length || total <= 0) {
      return '<div class="chart"><h4>' + title + '</h4><div class="bar-empty">' +
        (items.length ? '所选范围内该指标均为 0，无占比可画' : '该指标下暂无记录') + '</div></div>';
    }
    var off = 0, segs = '', legend = '';
    items.forEach(function (x, i) {
      var share = Math.abs(x.v) / total * 100, c = PALETTE[i % PALETTE.length];
      segs += '<circle cx="21" cy="21" r="15.9155" stroke="' + c + '" stroke-dasharray="' + share.toFixed(3) + ' ' + (100 - share).toFixed(3) +
        '" stroke-dashoffset="' + (-off).toFixed(3) + '"></circle>';
      off += share;
      var poolMatch = null;
      Object.keys(SHORT).forEach(function (pid) { if (SHORT[pid] === x.k) poolMatch = pid; });
      var filterAttr = poolMatch
        ? ' data-filter-pool="' + esc(poolMatch) + '"'
        : (x.k !== '其他' ? ' data-filter-model="' + esc(x.k) + '"' : '');
      var canFilter = !!filterAttr;
      var isAct = (poolMatch && dash.pool === poolMatch) || (!poolMatch && dash.model === x.k);
      legend += '<div class="lg-row' + (canFilter ? ' clickable' : '') + (isAct ? ' active' : '') + '"' + filterAttr + ' title="' + esc(x.k + (isAct ? '（当前已筛选，点击取消）' : canFilter ? '（点击筛选）' : '')) + '"><span class="lg-dot" style="background:' + c + '"></span><span class="lg-k">' + esc(x.k) +
        '</span><span class="lg-v num">' + fmtVal(x.v, m) + '</span><span class="lg-p num">' + share.toFixed(1) + '%</span></div>';
    });
    var centerVal = m === 'pct' ? signed(items.reduce(function (a, x) { return a + x.v; }, 0)) : short(total);
    return '<div class="chart"><h4>' + title + '</h4><div class="donut-wrap"><div class="donut-box"><svg class="donut" viewBox="0 0 42 42" role="img" aria-label="' + esc(title) + '">' +
      '<circle class="track" cx="21" cy="21" r="15.9155"></circle>' + segs + '</svg>' +
      '<span class="donut-center num">' + esc(centerVal) + '</span></div><div class="legend">' + legend + '</div></div></div>';
  }

  /* 柱状图：items = [{k, v, rawDay}] 或堆叠 [{k, a, b}]；修复小比例被 -16px 压扁的问题 */
  function columns(title, sub, items, m, stacked) {
    var max = 0;
    items.forEach(function (x) { max = Math.max(max, stacked ? x.a + x.b : Math.abs(x.v)); });
    if (!items.length) return '<div class="chart"><h4>' + title + '</h4><div class="bar-empty">该指标下暂无记录</div></div>';
    var cols = items.map(function (x) {
      var tot = stacked ? x.a + x.b : x.v;
      var h = max > 0 ? Math.abs(tot) / max * 100 : 0;
      var barPct = max > 0 && Math.abs(tot) > 0 ? Math.max(5, h * 0.76) : 0;
      var inner = stacked
        ? '<span class="seg-in" style="height:' + (tot > 0 ? x.a / tot * 100 : 0).toFixed(1) + '%"></span><span class="seg-out" style="height:' + (tot > 0 ? x.b / tot * 100 : 0).toFixed(1) + '%"></span>'
        : '';
      var actAttr = x.rawDay
        ? ' data-filter-day="' + esc(x.rawDay) + '"'
        : (x.drillDay ? ' data-drill-day="' + esc(x.drillDay) + '"' : '');
      var isClick = !!(x.rawDay || x.drillDay);
      var tipPrefix = x.tip || x.rawDay || x.k;
      var tipBody = stacked
        ? '合计 ' + fmtInt(tot) + '（输入 ' + fmtInt(x.a) + ' / 输出 ' + fmtInt(x.b) + '）'
        : fmtVal(x.v, m);
      var tipSuffix = x.rawDay ? '（点击定位该日汇总）' : (x.drillDay ? '（点击查看当日明细）' : '');
      var barToneCls = m === 'pct' ? (tot > 0.005 ? ' pos' : ' neg') : '';
      return '<div class="col' + (isClick ? ' clickable' : '') + '"' + actAttr + ' title="' + esc(tipPrefix + '：' + tipBody + tipSuffix) + '">' +
        '<span class="col-val num">' + (m === 'pct' ? signed(tot) : short(tot)) + '</span>' +
        '<span class="col-bar' + barToneCls + '" style="height:' + barPct.toFixed(1) + '%">' + inner + '</span></div>';
    }).join('');
    var xs = items.map(function (x) { return '<span>' + esc(x.k) + '</span>'; }).join('');
    return '<div class="chart"><h4>' + title + '</h4>' + (sub ? '<div class="chart-sub">' + sub + '</div>' : '') +
      '<div class="cols">' + cols + '</div><div class="col-x">' + xs + '</div>' +
      (stacked ? '<div class="key"><span><i style="background:var(--c1)"></i>输入</span><span><i style="background:var(--c2)"></i>输出</span></div>' : '') + '</div>';
  }

  function statCard(label, v, tip) {
    return '<div class="stat"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><div class="stat-k">' + label + '</div><div class="stat-v num">' + v + '</div></div>';
  }

  var lastUsageView = null;
  function renderUsage() {
    var el = $('view-usage');
    if (!data) { el.innerHTML = ''; lastUsageView = null; return; }
    var viewChanged = lastUsageView !== dash.view;
    lastUsageView = dash.view;
    var bodyCls = 'usage-body' + (viewChanged ? ' sub-enter' : '');
    var all = data.usage || [];
    var poolScoped = dash.pool === 'all' ? all : all.filter(function (r) { return r.pool_id === dash.pool; });
    var models = uniq(poolScoped.map(function (r) { return r.model; }).filter(function (x) { return x && x !== '—'; })).sort();
    if (dash.model !== 'all' && models.indexOf(dash.model) < 0) dash.model = 'all';
    var modelScoped = dash.model === 'all' ? poolScoped : poolScoped.filter(function (r) { return r.model === dash.model; });
    var days = uniq(modelScoped.map(function (r) { return dayOf(r.time); })).sort().reverse();
    if (dash.day !== 'all' && days.indexOf(dash.day) < 0) dash.day = 'all';

    var rows = all.filter(function (r) {
      return (dash.pool === 'all' || r.pool_id === dash.pool) &&
        (dash.model === 'all' || r.model === dash.model) &&
        (dash.day === 'all' || dayOf(r.time) === dash.day);
    });

    var dailyRows = buildDailySummary(rows);

    var hasActiveFilter = dash.pool !== 'all' || dash.model !== 'all' || dash.day !== 'all';
    var filterParts = [];
    if (dash.pool !== 'all') {
      var pObj = poolById(dash.pool);
      filterParts.push(pObj ? (SHORT[pObj.id] || pObj.name) : dash.pool);
    }
    if (dash.model !== 'all') filterParts.push(dash.model);
    if (dash.day !== 'all') filterParts.push(dash.day);

    var filterChip = '<div class="subtabs-right">' +
      '<span class="subtabs-meta num">共 ' + rows.length + ' 条 · ' + dailyRows.length + ' 天</span>' +
      (dash.view === 'table' && dash.day !== 'all'
        ? '<button type="button" class="chip-back" data-back-daily="1" title="返回按天汇总视图 (快捷键 Backspace)">‹ 返回按天汇总</button>'
        : '') +
      (hasActiveFilter
        ? '<button type="button" class="chip-clear" data-reset-filters="1" title="点击清除当前筛选条件（' + esc(filterParts.join(' / ')) + '）">' +
          esc(dash.day !== 'all' && filterParts.length === 1 ? '仅看 ' + dash.day : '筛选中 (' + filterParts.length + ')') + ' ×</button>'
        : '') +
      '</div>';

    var html = '<div class="filters">' +
      sel('f-pool', '额度池', [['all', '全部']].concat(data.pools.map(function (p) { return [p.id, p.name]; })), dash.pool) +
      sel('f-model', '模型', [['all', '全部模型']].concat(models.map(function (x) { return [x, x]; })), dash.model) +
      sel('f-day', '日期', [['all', '全部日期']].concat(days.map(function (x) { return [x, x + ' (' + dayTag(x) + ')']; })), dash.day) +
      sel('f-metric', '指标', METRICS, dash.metric) + '</div>' +
      '<div class="subtabs"><div class="seg">' +
      [['overview', '概览'], ['daily', '按天汇总'], ['table', '明细']].map(function (v) {
        return '<button type="button" data-view="' + v[0] + '" class="' + (dash.view === v[0] ? 'active' : '') + '">' + v[1] + '</button>';
      }).join('') + '</div>' + filterChip + '</div>';

    if (!rows.length) {
      el.innerHTML = html + '<div class="' + bodyCls + '"><div class="empty"><p>该筛选组合下暂无记录</p>' +
        (hasActiveFilter ? '<button type="button" class="btn empty-reset" data-reset-filters="1">重置全部筛选条件</button>' : '') +
        '</div></div>';
      return;
    }

    html += '<div class="' + bodyCls + '">';

    /* 子视图 1：按天汇总 */
    if (dash.view === 'daily') {
      var tokDays = dailyRows.filter(function (d) { return d.tokSessions > 0; });
      var totalTokAll = tokDays.reduce(function (a, d) { return a + d.total; }, 0);
      var avgDay = tokDays.length ? totalTokAll / tokDays.length : null;
      var peakDay = null;
      tokDays.forEach(function (d) { if (!peakDay || d.total > peakDay.total) peakDay = d; });
      var pctDays = dailyRows.filter(function (d) { return d.hasPct; });
      var totalPctAll = pctDays.reduce(function (a, d) { return a + d.pct; }, 0);
      var peakPctDay = null;
      pctDays.forEach(function (d) { if (!peakPctDay || Math.abs(d.pct) > Math.abs(peakPctDay.pct)) peakPctDay = d; });

      if (tokDays.length) {
        var peakSpan = peakDay
          ? '<b class="num link-day" data-filter-day="' + esc(peakDay.day) + '" title="点击在表中定位至峰值日 ' + esc(peakDay.day) + '">' + esc(peakDay.day) + '</b>'
          : '<b class="num">—</b>';
        html += '<div class="stats">' +
          statCard('活跃天数', dailyRows.length + ' 天', '共 ' + dailyRows.length + ' 个活跃日（其中 ' + tokDays.length + ' 天含公开 Token 记录）') +
          statCard('日均合计 Token', avgDay != null ? short(avgDay) : '—', avgDay != null ? '日均合计：' + fmtInt(avgDay) + ' token（累计 ' + fmtInt(totalTokAll) + ' token）' : '') +
          statCard('单日最高 Token', peakDay ? short(peakDay.total) : '—', peakDay ? '峰值日 ' + peakDay.day + '：' + fmtInt(peakDay.total) + ' token' : '') +
          statCard('累计消耗变化', pctDays.length ? signed(totalPctAll) : '—', pctDays.length ? '含消耗变化记录共 ' + pctDays.length + ' 天' : '') +
        '</div>' +
        '<div class="stat-sub">' +
          '<span>峰值日期 ' + peakSpan + '</span>' +
          '<span>总会话数 <b class="num">' + fmtInt(rows.length) + '</b></span>' +
          '<span class="daily-tip">点击任意日期行可查看当日会话明细</span>' +
        '</div>';
      } else {
        var avgPctDay = pctDays.length ? totalPctAll / pctDays.length : null;
        var peakPctSpan = peakPctDay
          ? '<b class="num link-day" data-filter-day="' + esc(peakPctDay.day) + '" title="点击在表中定位至最大变化日 ' + esc(peakPctDay.day) + '">' + esc(peakPctDay.day) + '</b>'
          : '<b class="num">—</b>';
        html += '<div class="stats">' +
          statCard('活跃天数', dailyRows.length + ' 天') +
          statCard('日均消耗变化', avgPctDay != null ? signed(avgPctDay) : '—') +
          statCard('单日最大变化', peakPctDay ? signed(peakPctDay.pct) : '—') +
          statCard('累计消耗变化', pctDays.length ? signed(totalPctAll) : '—') +
        '</div>' +
        '<div class="stat-sub">' +
          '<span>最大变化日 ' + peakPctSpan + '</span>' +
          '<span>总会话数 <b class="num">' + fmtInt(rows.length) + '</b></span>' +
          '<span class="daily-tip">点击任意日期行可查看当日会话明细</span>' +
        '</div>';
      }

      var sortedDaily = dailyRows.slice().sort(function (a, b) {
        var dir = dash.dailyAsc ? 1 : -1;
        if (dash.dailySort === 'sessions') return (a.sessions - b.sessions) * dir || (a.day < b.day ? 1 : -1);
        if (dash.dailySort === 'total') return (a.total - b.total) * dir || (a.day < b.day ? 1 : -1);
        if (dash.dailySort === 'pct') return (Math.abs(a.pct) - Math.abs(b.pct)) * dir || (a.day < b.day ? 1 : -1);
        return (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) * dir;
      });
      var dPages = Math.max(1, Math.ceil(sortedDaily.length / DAILY_PAGE_SIZE));
      if (dash.highlightDay) {
        for (var hi = 0; hi < sortedDaily.length; hi++) {
          if (sortedDaily[hi].day === dash.highlightDay) {
            dash.dailyPage = Math.floor(hi / DAILY_PAGE_SIZE);
            break;
          }
        }
      }
      if (dash.dailyPage >= dPages) dash.dailyPage = dPages - 1;
      var dSlice = sortedDaily.slice(dash.dailyPage * DAILY_PAGE_SIZE, dash.dailyPage * DAILY_PAGE_SIZE + DAILY_PAGE_SIZE);
      var maxTokRef = peakDay && peakDay.total > 0 ? peakDay.total : 1;
      var maxPctRef = peakPctDay && Math.abs(peakPctDay.pct) > 0 ? Math.abs(peakPctDay.pct) : 1;
      var sortArrow = function (k) {
        return dash.dailySort === k ? ' <span class="sort-ind">' + (dash.dailyAsc ? '▴' : '▾') + '</span>' : '';
      };

      html += '<div class="table-wrap daily-wrap"><table class="' + (dSlice.length >= DAILY_PAGE_SIZE ? 'is-full' : '') + '"><thead><tr>' +
        '<th class="col-d-date sortable' + (dash.dailySort === 'day' ? ' sorted' : '') + '" data-daily-sort="day" title="点击按日期排序">日期' + sortArrow('day') + '</th>' +
        '<th class="col-d-cnt r sortable' + (dash.dailySort === 'sessions' ? ' sorted' : '') + '" data-daily-sort="sessions" title="点击按会话数排序">会话' + sortArrow('sessions') + '</th>' +
        '<th class="col-d-model">池 / 模型</th>' +
        '<th class="col-d-io">输入 / 输出构成</th>' +
        '<th class="col-d-tot r sortable' + (dash.dailySort === 'total' ? ' sorted' : '') + '" data-daily-sort="total" title="点击按当日合计 Token 排序">当日合计 Token' + sortArrow('total') + '</th>' +
        '<th class="col-d-pct r sortable' + (dash.dailySort === 'pct' ? ' sorted' : '') + '" data-daily-sort="pct" title="点击按消耗变化幅度排序">当日消耗变化' + sortArrow('pct') + '</th>' +
      '</tr></thead><tbody>' +
      dSlice.map(function (d) {
        var tag = dayTag(d.day);
        var pillCls = tag === '今日' ? 'day-pill today' : 'day-pill';
        var modelInfo = d.pools.join('、') + (d.models.length ? ' · ' + d.models.join(', ') : '');
        var ioCell = '';
        if (!d.tokSessions) {
          ioCell = '<td class="plain">官方不公开 token</td><td class="r plain">—</td>';
        } else {
          var inPct = d.total > 0 ? (d.input / d.total * 100) : 50;
          var sharePct = Math.max(4, Math.min(100, d.total / maxTokRef * 100));
          var isPeak = peakDay && dailyRows.length > 1 && d.day === peakDay.day;
          var ioTip = d.day + ' 输入：' + fmtInt(d.input) + '（' + inPct.toFixed(1) + '%） · 输出：' + fmtInt(d.output) + '（' + (100 - inPct).toFixed(1) + '%）';
          var totTip = d.day + ' 合计：' + fmtInt(d.total) + ' token · 单次最高：' + fmtInt(d.maxSingle) + ' token';
          ioCell = '<td title="' + esc(ioTip) + '"><div class="io-cell"><div class="io-bar"><i class="io-in" style="width:' + inPct.toFixed(1) + '%"></i></div>' +
            '<span class="io-txt num">入 ' + short(d.input) + ' · 出 ' + short(d.output) + '</span></div></td>' +
            '<td class="r" title="' + esc(totTip) + '"><div class="tot-cell' + (isPeak ? ' is-peak' : '') + '"><span class="num">' + fmtInt(d.total) + '</span>' +
            '<span class="tot-mini"><i style="width:' + sharePct.toFixed(1) + '%"></i></span></div></td>';
        }
        var pctTxt = d.hasPct ? signed(d.pct) : '—';
        var pctCls = !d.hasPct ? '' : d.pct > 0.005 ? ' pct-pos' : d.pct <= -20 ? ' pct-warn' : '';
        var pctShare = d.hasPct && Math.abs(d.pct) > 0 ? Math.max(5, Math.min(100, Math.abs(d.pct) / maxPctRef * 100)) : 0;
        var pctCellInner = d.hasPct
          ? '<div class="tot-cell"><span class="num">' + pctTxt + '</span>' +
            '<span class="tot-mini pct-mini"><i class="' + (d.pct > 0.005 ? 'pos' : 'neg') + '" style="width:' + pctShare.toFixed(1) + '%"></i></span></div>'
          : pctTxt;
        var isTarget = dash.highlightDay === d.day;
        return '<tr class="daily-row' + (isTarget ? ' is-target' : '') + '" data-drill-day="' + esc(d.day) + '" title="点击查看 ' + esc(d.day) + ' 的会话明细">' +
          '<td class="num col-d-date"><div class="date-cell"><span>' + esc(d.day) + '</span>' + (tag ? '<span class="' + pillCls + '">' + esc(tag) + '</span>' : '') + '</div></td>' +
          '<td class="r num col-d-cnt">' + d.sessions + '</td>' +
          '<td class="col-d-model" title="' + esc(modelInfo) + '">' + esc(modelInfo) + '</td>' +
          ioCell +
          '<td class="r num' + pctCls + '">' + pctCellInner + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pager"><span>共 ' + dailyRows.length + ' 个活跃日（含 ' + rows.length + ' 条记录）</span><span class="pager-ctrls">' +
      '<button type="button" class="btn" data-daily-page="-1"' + (dash.dailyPage <= 0 ? ' disabled' : '') + '>上一页</button>' +
      '<span class="num pager-idx">' + (dash.dailyPage + 1) + ' / ' + dPages + '</span>' +
      '<button type="button" class="btn" data-daily-page="1"' + (dash.dailyPage >= dPages - 1 ? ' disabled' : '') + '>下一页</button></span></div></div>';

      el.innerHTML = html;
      return;
    }

    /* 子视图 2：会话明细 */
    if (dash.view === 'table') {
      var tTokRows = rows.filter(hasTokens);
      var tPctRows = rows.filter(function (r) { return r.pct_change != null; });
      var tSumPct = tPctRows.reduce(function (a, r) { return a + (r.pct_change || 0); }, 0);
      var scopeSpan = dash.day !== 'all'
        ? '<span>当前日期 <b class="num">' + esc(dash.day) + '</b>（' + esc(dayTag(dash.day)) + '）</span>'
        : '<span>覆盖活跃日 <b class="num">' + dailyRows.length + ' 天</b></span>';

      if (tTokRows.length) {
        var tTot = tTokRows.reduce(function (a, r) { return a + (r.total_tokens || 0); }, 0);
        var tIn = tTokRows.reduce(function (a, r) { return a + (r.input_tokens || 0); }, 0);
        var tOut = tTokRows.reduce(function (a, r) { return a + (r.output_tokens || 0); }, 0);
        var tMax = Math.max.apply(null, tTokRows.map(function (r) { return r.total_tokens || 0; }));
        html += '<div class="stats">' +
          statCard('会话记录', fmtInt(rows.length) + ' 条', '当前筛选范围内共 ' + fmtInt(rows.length) + ' 条记录') +
          statCard('合计 Token', short(tTot), '合计 Token：' + fmtInt(tTot)) +
          statCard('输入 / 输出', short(tIn) + ' / ' + short(tOut), '输入 ' + fmtInt(tIn) + ' token · 输出 ' + fmtInt(tOut) + ' token') +
          statCard('累计消耗变化', tPctRows.length ? signed(tSumPct) : '—', tPctRows.length ? '含消耗变化记录共 ' + tPctRows.length + ' 条' : '') +
        '</div>' +
        '<div class="stat-sub">' +
          scopeSpan +
          '<span>单次最高 <b class="num">' + fmtInt(tMax) + '</b></span>' +
          '<span>平均每会话 <b class="num">' + fmtInt(tTot / tTokRows.length) + '</b></span>' +
          '<span class="daily-tip">点击表头可按时间或数值排序</span>' +
        '</div>';
      } else {
        var tMaxDrop = 0;
        tPctRows.forEach(function (r) { if (Math.abs(r.pct_change || 0) > Math.abs(tMaxDrop)) tMaxDrop = r.pct_change || 0; });
        html += '<div class="stats">' +
          statCard('会话记录', fmtInt(rows.length) + ' 条') +
          statCard('累计消耗变化', tPctRows.length ? signed(tSumPct) : '—') +
          statCard('单次最大变化', tPctRows.length ? signed(tMaxDrop) : '—') +
          statCard('覆盖天数', dailyRows.length + ' 天') +
        '</div>' +
        '<div class="stat-sub">' +
          scopeSpan +
          '<span>所选范围官方不公开 token 数</span>' +
          '<span class="daily-tip">点击表头可按时间或变化幅度排序</span>' +
        '</div>';
      }

      var sortedRows = rows.slice().sort(function (a, b) {
        var dir = dash.tableAsc ? 1 : -1;
        if (dash.tableSort === 'input') return ((a.input_tokens || -1) - (b.input_tokens || -1)) * dir;
        if (dash.tableSort === 'output') return ((a.output_tokens || -1) - (b.output_tokens || -1)) * dir;
        if (dash.tableSort === 'total') return ((a.total_tokens || -1) - (b.total_tokens || -1)) * dir;
        if (dash.tableSort === 'pct') return (Math.abs(a.pct_change || 0) - Math.abs(b.pct_change || 0)) * dir;
        return (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) * dir;
      });
      var pages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
      if (dash.page >= pages) dash.page = pages - 1;
      var slice = sortedRows.slice(dash.page * PAGE_SIZE, dash.page * PAGE_SIZE + PAGE_SIZE);
      var tSortArrow = function (k) {
        return dash.tableSort === k ? ' <span class="sort-ind">' + (dash.tableAsc ? '▴' : '▾') + '</span>' : '';
      };
      html += '<div class="table-wrap"><table class="' + (slice.length >= PAGE_SIZE ? 'is-full' : '') + '"><thead><tr>' +
        '<th class="col-time sortable' + (dash.tableSort === 'time' ? ' sorted' : '') + '" data-table-sort="time" title="点击按日期时间排序">日期时间' + tSortArrow('time') + '</th>' +
        '<th class="col-pool">额度池</th><th class="col-model">模型</th>' +
        '<th class="col-in r sortable' + (dash.tableSort === 'input' ? ' sorted' : '') + '" data-table-sort="input" title="点击按输入 token 排序">输入' + tSortArrow('input') + '</th>' +
        '<th class="col-out r sortable' + (dash.tableSort === 'output' ? ' sorted' : '') + '" data-table-sort="output" title="点击按输出 token 排序">输出' + tSortArrow('output') + '</th>' +
        '<th class="col-tot r sortable' + (dash.tableSort === 'total' ? ' sorted' : '') + '" data-table-sort="total" title="点击按合计 token 排序">合计 token' + tSortArrow('total') + '</th>' +
        '<th class="col-pct r sortable' + (dash.tableSort === 'pct' ? ' sorted' : '') + '" data-table-sort="pct" title="点击按消耗变化幅度排序">消耗变化' + tSortArrow('pct') + '</th></tr></thead><tbody>' +
        slice.map(function (r) {
          var cells = !hasTokens(r)
            ? '<td colspan="3" class="plain">' + esc(r.tokens_note || NO_TOKENS) + '</td>'
            : '<td class="r">' + fmtInt(r.input_tokens) + '</td><td class="r">' + fmtInt(r.output_tokens) +
              '</td><td class="r">' + fmtInt(r.total_tokens) + '</td>';
          var pc = r.pct_change == null ? '—' : signed(r.pct_change) + (r.pct_basis ? ' <span class="basis">' + esc(r.pct_basis) + '</span>' : '');
          var rPctCls = r.pct_change == null ? '' : r.pct_change > 0.005 ? ' pct-pos' : r.pct_change <= -20 ? ' pct-warn' : '';
          var hasMod = r.model && r.model !== '—';
          var poolTip = r.pool + (dash.pool === r.pool_id ? '（当前已筛选，点击恢复全部）' : '（点击仅看此额度池）');
          var modTip = hasMod ? r.model + (dash.model === r.model ? '（当前已筛选，点击恢复全部）' : '（点击仅看此模型）') : r.model;
          return '<tr><td class="num" title="' + esc(fmtTime(r.time, true)) + '">' + fmtTime(r.time) + '</td>' +
            '<td class="cell-filter' + (dash.pool === r.pool_id ? ' is-filtered' : '') + '" data-filter-pool="' + esc(r.pool_id) + '" title="' + esc(poolTip) + '">' + esc(r.pool) + '</td>' +
            '<td' + (hasMod ? ' class="cell-filter' + (dash.model === r.model ? ' is-filtered' : '') + '" data-filter-model="' + esc(r.model) + '"' : '') + ' title="' + esc(modTip) + '">' + esc(r.model) + '</td>' +
            cells + '<td class="r' + rPctCls + '">' + pc + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="pager"><span>共 ' + rows.length + ' 条会话记录</span><span class="pager-ctrls">' +
        '<button type="button" class="btn" data-page="-1"' + (dash.page <= 0 ? ' disabled' : '') + '>上一页</button>' +
        '<span class="num pager-idx">' + (dash.page + 1) + ' / ' + pages + '</span>' +
        '<button type="button" class="btn" data-page="1"' + (dash.page >= pages - 1 ? ' disabled' : '') + '>下一页</button></span></div></div>';
      el.innerHTML = html;
      return;
    }

    /* 子视图 3：概览图表 */
    var tokRows = rows.filter(hasTokens);
    var sum = function (f) { return tokRows.reduce(function (a, r) { return a + (r[f] || 0); }, 0); };
    var n = tokRows.length;
    if (n) {
      var tot = sum('total_tokens'), sumIn = sum('input_tokens'), sumOut = sum('output_tokens');
      var maxS = Math.max.apply(null, tokRows.map(function (r) { return r.total_tokens || 0; }));
      var activeTokDays = uniq(tokRows.map(function (r) { return dayOf(r.time); })).length || 1;
      html += '<div class="stats">' +
        statCard('合计 token', short(tot), '合计 Token：' + fmtInt(tot)) +
        statCard('输入 token', short(sumIn), '输入 Token：' + fmtInt(sumIn)) +
        statCard('输出 token', short(sumOut), '输出 Token：' + fmtInt(sumOut)) +
        statCard('会话数', fmtInt(n), '含公开 Token 记录的会话共 ' + fmtInt(n) + ' 次') + '</div>' +
        '<div class="stat-sub">' +
          '<span>平均每会话 <b class="num">' + fmtInt(tot / n) + '</b></span>' +
          '<span>最大单会话 <b class="num">' + fmtInt(maxS) + '</b></span>' +
          '<span>日均 token <b class="num">' + fmtInt(tot / activeTokDays) + '</b>（共 ' + activeTokDays + ' 天）</span>' +
        '</div>';
    } else {
      var pctOnlyRows = rows.filter(function (r) { return r.pct_change != null; });
      var sumPct = pctOnlyRows.reduce(function (a, r) { return a + (r.pct_change || 0); }, 0);
      var maxPctDrop = 0;
      pctOnlyRows.forEach(function (r) { if (Math.abs(r.pct_change || 0) > Math.abs(maxPctDrop)) maxPctDrop = r.pct_change || 0; });
      html += '<div class="stats">' +
        statCard('累计消耗变化', pctOnlyRows.length ? signed(sumPct) : '—') +
        statCard('单次最大变化', pctOnlyRows.length ? signed(maxPctDrop) : '—') +
        statCard('活跃天数', dailyRows.length + ' 天') +
        statCard('会话数', fmtInt(rows.length)) + '</div>' +
        '<div class="stat-sub"><span>所选范围官方不公开 token 数，已自动按 <b class="num">百分比变化</b> 汇总展示</span></div>';
    }

    var m = (!tokRows.length && rows.length) ? 'pct' : dash.metric;
    var useRows = m === 'pct' ? rows : tokRows;
    var mLabel = METRICS.filter(function (x) { return x[0] === m; })[0][1];
    var allModels = group(useRows, function (r) { return r.model && r.model !== '—' ? r.model : (m === 'pct' ? (SHORT[r.pool_id] || r.pool || '其他') : null); }, m)
      .sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    var byModel = allModels.length <= 4 ? allModels : allModels.slice(0, 3).concat([{
      k: '其他',
      v: allModels.slice(3).reduce(function (a, x) { return a + x.v; }, 0)
    }]);
    var byDay = group(useRows, function (r) { return dayOf(r.time); }, m).sort(function (a, b) { return a.k < b.k ? -1 : 1; })
      .slice(-7).map(function (x) { return { k: x.k.slice(5), v: x.v, rawDay: x.k }; });
    var donutTitle = (m === 'pct' ? '池 / 模型占比 · ' : '模型占比 · ') + mLabel;
    html += '<div class="viz">' + donut(byModel, m, donutTitle) + columns('按天汇总趋势 · ' + mLabel + '（最近 7 天）', '', byDay, m, false);
    if (m !== 'pct' && tokRows.length) {
      var ses = tokRows.slice().sort(function (a, b) { return a.time < b.time ? -1 : 1; }).slice(-10).map(function (r) {
        var ft = fmtTime(r.time);
        return { k: ft.length >= 11 ? ft.slice(6) : ft, drillDay: dayOf(r.time), tip: fmtTime(r.time, true) + (r.model && r.model !== '—' ? ' · ' + r.model : ''), a: r.input_tokens || 0, b: r.output_tokens || 0 };
      });
      html += columns('最近会话的输入 / 输出 token', '', ses, m, true).replace('class="chart"', 'class="chart wide"');
    } else if (m === 'pct' && rows.length) {
      var pctSes = rows.filter(function (r) { return r.pct_change != null; }).slice().sort(function (a, b) { return a.time < b.time ? -1 : 1; }).slice(-10).map(function (r) {
        var ft2 = fmtTime(r.time);
        return { k: ft2.length >= 11 ? ft2.slice(6) : ft2, drillDay: dayOf(r.time), tip: fmtTime(r.time, true) + ' · ' + (r.pool || ''), v: r.pct_change };
      });
      html += columns('最近会话的单次消耗百分比变化', '', pctSes, 'pct', false).replace('class="chart"', 'class="chart wide"');
    }
    html += '</div></div>';
    el.innerHTML = html;
  }

  function renderFoot() {
    var f = $('panel-foot');
    if (!data) { f.textContent = loadError ? '数据未加载' : ''; return; }
    var codex = data.pools.filter(function (p) { return p.id === 'codex' && p.status === 'ok'; })[0];
    var parts = [], fullParts = [];
    if (codex) {
      var cxTag = data.codexSource === 'live' ? 'Codex 实时 ' : 'Codex 本地 ';
      parts.push(cxTag + fmtTime(codex.as_of));
      fullParts.push(cxTag + fmtTime(codex.as_of, true));
    } else {
      parts.push('Codex：暂无数据');
      fullParts.push('Codex：暂无数据');
    }
    var man = data.pools.filter(function (p) { return p.id !== 'codex' && p.as_of; })[0];
    if (man) {
      var agTag = data.antigravityStatus === 'auto' ? 'Antigravity 自动 ' : 'Antigravity 快照 ';
      parts.push(agTag + fmtTime(man.as_of));
      fullParts.push(agTag + fmtTime(man.as_of, true));
    }
    if (data.generated_at) {
      parts.push('刷新 ' + fmtTime(data.generated_at));
      fullParts.push('上次刷新 ' + fmtTime(data.generated_at, true));
    }
    var shortJoined = parts.join(' · ');
    var fullJoined = fullParts.join(' · ');
    f.innerHTML = '<span class="foot-main" title="' + esc(fullJoined) + '">' + esc(shortJoined) + '</span>' +
      '<span class="foot-keys" title="快捷键：数字键 1-3 切换顶栏标签，S 打开/关闭设置，R 刷新数据，[ / ] 切换仪表盘子视图，← / → 翻页，Esc 隐藏窗口">1-3 切页 · S 设置 · R 刷新</span>';
  }

  function renderAll() { renderDetail(); renderSelect(); renderUsage(); renderSettings(); renderFoot(); }

  /* ---------- 标签页 ---------- */
  var activeTab = 'detail', prevTab = 'detail';
  function setTab(t) {
    if (t !== 'settings') prevTab = t;
    activeTab = t;
    document.querySelectorAll('.tab').forEach(function (b) {
      var isAct = b.dataset.tab === t;
      b.classList.toggle('active', isAct);
      b.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });
    ['detail', 'select', 'usage', 'settings'].forEach(function (k) {
      var v = $('view-' + k), show = (k === t);
      if (show && v.hidden) {
        v.hidden = false;
        v.classList.remove('enter');
        void v.offsetWidth;
        v.classList.add('enter');
      } else if (!show) {
        v.hidden = true;
        v.classList.remove('enter');
      }
    });
    $('open-settings').classList.toggle('active', t === 'settings');
  }

  /* ---------- 事件 ---------- */
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b) setTab(b.dataset.tab);
  });
  $('open-settings').addEventListener('click', function () {
    setTab(activeTab === 'settings' ? prevTab : 'settings');
  });

  /* 详情页内快捷交互：一键设为悬浮球、跳到按天汇总 */
  $('view-detail').addEventListener('click', function (e) {
    var pick = e.target.closest('[data-pick-ball]');
    if (pick) {
      var pid = pick.dataset.pickBall;
      var pObj = poolById(pid);
      savePrefs({ ballPool: pid }, '已设为悬浮球：' + (pObj ? pObj.name : pid));
      return;
    }
    var openPool = e.target.closest('[data-open-pool]');
    if (openPool) {
      var poolId = openPool.dataset.openPool;
      var poolObj = poolById(poolId);
      dash.pool = poolId;
      dash.model = 'all';
      dash.day = 'all';
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
      setTab('usage');
      toast('正在查看 ' + (poolObj ? poolObj.name : poolId) + ' 统计');
      return;
    }
    var openDaily = e.target.closest('[data-open-daily]');
    if (openDaily) {
      dash.view = 'daily';
      dash.day = 'all';
      dash.highlightDay = null;
      dash.dailyPage = 0;
      renderUsage();
      setTab('usage');
      return;
    }
    var gotoDay = e.target.closest('[data-goto-day]');
    if (gotoDay) {
      var targetDay = gotoDay.dataset.gotoDay;
      dash.view = 'daily';
      dash.day = 'all';
      dash.highlightDay = targetDay || null;
      renderUsage();
      setTab('usage');
      if (targetDay) toast('已在按天汇总中定位至 ' + targetDay);
    }
  });

  $('view-select').addEventListener('change', function (e) {
    var id = e.target.dataset.pool;
    if (id) {
      var pObj = poolById(id);
      savePrefs({ ballPool: id }, '悬浮球已切换：' + (pObj ? pObj.name : id));
    }
  });
  $('view-settings').addEventListener('click', function (e) {
    var t = e.target.closest('[data-theme]');
    if (t) {
      if (t.dataset.theme !== prefs.theme) savePrefs({ theme: t.dataset.theme }, '外观已切换：' + t.textContent);
      return;
    }
    var openPool = e.target.closest('[data-open-pool]');
    if (openPool) {
      var poolId = openPool.dataset.openPool;
      var poolObj = poolById(poolId);
      dash.pool = poolId;
      dash.model = 'all';
      dash.day = 'all';
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
      setTab('usage');
      toast('正在查看 ' + (poolObj ? poolObj.name : poolId) + ' 统计');
    }
  });

  function paintRefresh() {
    var b = $('refresh-btn');
    b.className = 'pill-btn refresh' + (scan.busy ? ' busy' : scan.done ? ' done' : '');
    b.textContent = scan.busy ? '刷新中…' : scan.done ? '已刷新' : '刷新数据';
  }
  function triggerRefresh() {
    if (scan.busy) return;
    scan.busy = true;
    scan.done = false;
    paintRefresh();
    var t0 = Date.now();
    QF.refresh().then(function (d) {
      data = d;
      loadError = null;
      setTimeout(function () {
        scan.busy = false;
        scan.done = true;
        renderAll();
        paintRefresh();
        toast('数据已刷新');
        setTimeout(function () { scan.done = false; paintRefresh(); }, 1800);
      }, Math.max(0, 500 - (Date.now() - t0)));
    }).catch(function () {
      scan.busy = false;
      paintRefresh();
      toast('刷新失败，请重试', true);
    });
  }
  $('refresh-btn').addEventListener('click', triggerRefresh);

  $('view-settings').addEventListener('change', function (e) {
    if (e.target.id === 'autostart') {
      savePrefs({ autostart: e.target.checked }, e.target.checked ? '已开启开机自启' : '已关闭开机自启');
    }
  });
  $('view-usage').addEventListener('change', function (e) {
    var m = { 'f-pool': 'pool', 'f-model': 'model', 'f-day': 'day', 'f-metric': 'metric' }[e.target.id];
    if (m) {
      dash[m] = e.target.value;
      dash.highlightDay = null;
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
    }
  });
  $('view-usage').addEventListener('click', function (e) {
    var v = e.target.closest('[data-view]');
    if (v) {
      dash.view = v.dataset.view;
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
      return;
    }
    var backDaily = e.target.closest('[data-back-daily]');
    if (backDaily) {
      dash.view = 'daily';
      dash.day = 'all';
      renderUsage();
      toast('已返回按天汇总');
      return;
    }
    var resetBtn = e.target.closest('[data-reset-filters], [data-clear-day]');
    if (resetBtn) {
      dash.pool = 'all';
      dash.model = 'all';
      dash.day = 'all';
      dash.highlightDay = null;
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
      toast('已重置筛选条件');
      return;
    }
    var filterPool = e.target.closest('[data-filter-pool]');
    if (filterPool) {
      var targetPool = filterPool.dataset.filterPool;
      dash.pool = dash.pool === targetPool ? 'all' : targetPool;
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
      var pMatched = poolById(dash.pool);
      toast(dash.pool === 'all' ? '已恢复全部额度池' : '已筛选额度池：' + (pMatched ? pMatched.name : dash.pool));
      return;
    }
    var filterModel = e.target.closest('[data-filter-model]');
    if (filterModel) {
      var targetModel = filterModel.dataset.filterModel;
      dash.model = dash.model === targetModel ? 'all' : targetModel;
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
      toast(dash.model === 'all' ? '已恢复全部模型' : '已筛选模型：' + dash.model);
      return;
    }
    var filterDay = e.target.closest('[data-filter-day]');
    if (filterDay) {
      dash.highlightDay = filterDay.dataset.filterDay;
      dash.day = 'all';
      dash.view = 'daily';
      renderUsage();
      toast('已在按天汇总中定位至 ' + dash.highlightDay);
      return;
    }
    var sortTh = e.target.closest('[data-daily-sort]');
    if (sortTh) {
      var sk = sortTh.dataset.dailySort;
      if (dash.dailySort === sk) dash.dailyAsc = !dash.dailyAsc;
      else { dash.dailySort = sk; dash.dailyAsc = false; }
      dash.highlightDay = null;
      dash.dailyPage = 0;
      renderUsage();
      return;
    }
    var tSortTh = e.target.closest('[data-table-sort]');
    if (tSortTh) {
      var tsk = tSortTh.dataset.tableSort;
      if (dash.tableSort === tsk) dash.tableAsc = !dash.tableAsc;
      else { dash.tableSort = tsk; dash.tableAsc = false; }
      dash.page = 0;
      renderUsage();
      return;
    }
    var drillDay = e.target.closest('[data-drill-day]');
    if (drillDay) {
      dash.day = drillDay.dataset.drillDay;
      dash.highlightDay = dash.day;
      dash.view = 'table';
      dash.page = 0;
      renderUsage();
      toast('正在查看 ' + dash.day + ' 明细');
      return;
    }
    var dp = e.target.closest('[data-daily-page]');
    if (dp && !dp.disabled) {
      dash.highlightDay = null;
      dash.dailyPage += Number(dp.dataset.dailyPage);
      renderUsage();
      return;
    }
    var p = e.target.closest('[data-page]');
    if (p && !p.disabled) {
      dash.page += Number(p.dataset.page);
      renderUsage();
    }
  });

  /* 键盘快捷键支持：1-3 切页，S 设置，R 刷新，Esc 关闭或返回 */
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = (e.target && e.target.tagName) || '';
    var inType = (e.target && e.target.type) || '';
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && inType !== 'radio' && inType !== 'checkbox')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (tag === 'SELECT') {
      if (e.key === 'Escape') { e.target.blur(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    }
    if (e.key === '1') { setTab('detail'); }
    else if (e.key === '2') { setTab('select'); }
    else if (e.key === '3') { setTab('usage'); }
    else if (e.key === 's' || e.key === 'S') { setTab(activeTab === 'settings' ? prevTab : 'settings'); }
    else if (e.key === 'r' || e.key === 'R') { triggerRefresh(); }
    else if (activeTab === 'select' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && data && data.pools && data.pools.length) {
      e.preventDefault();
      var pIds = data.pools.map(function (p) { return p.id; });
      var cIdx = Math.max(0, pIds.indexOf(prefs.ballPool));
      var nIdx = (cIdx + (e.key === 'ArrowDown' ? 1 : pIds.length - 1)) % pIds.length;
      var nextPool = data.pools[nIdx];
      if (nextPool) savePrefs({ ballPool: nextPool.id }, '悬浮球已切换：' + nextPool.name);
    }
    else if (activeTab === 'usage' && e.key === 'Backspace' && dash.view === 'table' && dash.day !== 'all') {
      e.preventDefault();
      dash.view = 'daily';
      dash.day = 'all';
      renderUsage();
      toast('已返回按天汇总');
    }
    else if (activeTab === 'usage' && (e.key === '[' || e.key === ']')) {
      var views = ['overview', 'daily', 'table'];
      var curIdx = views.indexOf(dash.view);
      var nextIdx = (curIdx + (e.key === ']' ? 1 : 2)) % 3;
      dash.view = views[nextIdx];
      dash.page = 0;
      dash.dailyPage = 0;
      renderUsage();
    }
    else if (activeTab === 'usage' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      var step = e.key === 'ArrowLeft' ? -1 : 1;
      var btnSel = dash.view === 'daily' ? '[data-daily-page="' + step + '"]' : dash.view === 'table' ? '[data-page="' + step + '"]' : null;
      if (btnSel) {
        var pgBtn = $('view-usage').querySelector(btnSel);
        if (pgBtn && !pgBtn.disabled) pgBtn.click();
      }
    }
    else if (e.key === 'Escape') {
      if (activeTab === 'settings') setTab(prevTab);
      else if (QF && QF.hideDashboard) QF.hideDashboard();
    }
  });

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { if (prefs.theme === 'auto') applyTheme(); });
  }
  QF.onData(function (d) {
    data = d;
    loadError = null;
    if (!scan.busy) renderAll();
  });
  QF.onSettings(function (p) {
    applyPrefs(p);
    applyTheme();
    if (!updateDetailBallBadge()) renderDetail();
    renderSelect();
    renderSettings();
  });

  /* 窗口可见时每 60 秒及唤醒瞬间原地刷新详情卡片的相对倒计时胶囊（零重排、后台零开销） */
  function tickDetailCountdowns() {
    if (document.hidden || activeTab !== 'detail' || !data) return;
    var now = Date.now();
    var nodes = $('view-detail').querySelectorAll('.card-reset[data-resets-at]');
    nodes.forEach(function (node) {
      var iso = node.getAttribute('data-resets-at');
      var lbl = node.getAttribute('data-win-label') || '';
      var t = new Date(iso).getTime();
      var relEl = node.querySelector('.reset-rel');
      var mainEl = node.querySelector('.reset-main');
      if (isNaN(t)) return;
      if (t < now) {
        node.classList.add('stale');
        if (mainEl) mainEl.textContent = lbl + '已过刷新点，数据可能过期';
        if (relEl) relEl.remove();
      } else if (relEl) {
        relEl.textContent = relTime(iso, now);
      }
    });
    var lines = $('view-detail').querySelectorAll('.card-line[data-line-resets]');
    lines.forEach(function (ln) {
      var lIso = ln.getAttribute('data-line-resets');
      var pref = ln.getAttribute('data-line-prefix') || '';
      var lRel = relTime(lIso, now);
      ln.title = pref + (lRel ? '（' + lRel + '）' : '');
    });
  }
  setInterval(tickDetailCountdowns, 60000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tickDetailCountdowns();
  });

  /* ---------- 初始化 ---------- */
  setTab('detail');
  Promise.all([QF.getSettings(), QF.getData()]).then(function (r) {
    applyPrefs(r[0]); data = r[1]; applyTheme(); renderAll();
  }).catch(function (e) { loadError = '读取数据失败：' + e.message; renderAll(); });
})();
