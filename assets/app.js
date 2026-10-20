/* Dev Terminology - 前端逻辑
 * 数据流: data/domains.json (索引) -> data/<domain>.csv (按需下载并解析)
 */
(function () {
  "use strict";

  var state = {
    domains: [],        // 领域元数据
    cache: {},          // id -> 术语数组
    current: "all",     // 当前领域 id 或 "all"
    query: "",
    category: "all",
  };

  var $ = function (id) { return document.getElementById(id); };
  var tbody = $("tbody");

  /* ---------- 标记（★ 加星 / ✓ 已掌握）· localStorage 持久化 ---------- */
  var LS_KEY = "devterm.marks.v1";
  var MARK_VIEWS = ["starred", "mastered", "unmarked"];
  var MARK_META = {
    starred:  { title: "★ 已加星", desc: "跨领域汇总你加星的术语，可继续用搜索与分类缩小范围" },
    mastered: { title: "✓ 已掌握", desc: "跨领域汇总你标记为已掌握的术语" },
    unmarked: { title: "○ 未标记", desc: "既未加星也未标记掌握的术语，适合继续扫盲" },
  };
  var marks = {}; // key = "<domain>::<term>" -> { s:1, m:1 }

  function isMarkView(id) { return MARK_VIEWS.indexOf(id) !== -1; }
  function markKey(item) { return item.domain + "::" + item.term; }
  function getMark(key) { return marks[key] || {}; }

  function loadMarks() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY));
      marks = (raw && typeof raw === "object") ? raw : {};
    } catch (e) { marks = {}; }
  }

  function saveMarks() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(marks)); }
    catch (e) { showToast("标记保存失败：本地存储不可用"); }
  }

  function toggleMark(key, field) {
    var m = marks[key] || {};
    if (m[field]) delete m[field]; else m[field] = 1;
    if (m.s || m.m) marks[key] = m; else delete marks[key];
    saveMarks();
  }

  function countMark(field) {
    var n = 0;
    for (var k in marks) { if (marks[k] && marks[k][field]) n++; }
    return n;
  }

  function countMarkedAny() {
    var n = 0;
    for (var k in marks) { var m = marks[k]; if (m && (m.s || m.m)) n++; }
    return n;
  }

  function totalTerms() {
    return state.domains.reduce(function (s, d) { return s + d.count; }, 0);
  }

  function updateMarkStats() {
    var el = $("markStats");
    if (!el) return;
    var total = totalTerms();
    var pct = total ? Math.round(countMark("m") / total * 1000) / 10 : 0;
    el.innerHTML = '<b class="mk-star">★ ' + countMark("s") + "</b>" +
      '<b class="mk-done">✓ ' + countMark("m") + "</b>" +
      '<span class="mk-pct">掌握 ' + pct + "%</span>";
  }

  function setNavCount(id, n) {
    var el = document.querySelector('.nav-item[data-id="' + id + '"] .count');
    if (el) el.textContent = n;
  }

  function updateNavCounts() {
    setNavCount("starred", countMark("s"));
    setNavCount("mastered", countMark("m"));
    setNavCount("unmarked", Math.max(0, totalTerms() - countMarkedAny()));
  }

  /* ---------- CSV 解析（支持引号包裹、"" 转义、CRLF） ---------- */
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;
    var len = text.length;

    // 去掉 BOM
    if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); len--; }

    while (i < len) {
      var c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < len && text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  function splitRelated(s) {
    if (!s) return [];
    return s.split(/[,，、;；\/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------- 数据加载 ---------- */
  function loadDomain(id) {
    if (state.cache[id]) return Promise.resolve(state.cache[id]);
    var meta = null;
    for (var i = 0; i < state.domains.length; i++) {
      if (state.domains[i].id === id) { meta = state.domains[i]; break; }
    }
    if (!meta) return Promise.resolve([]);
    return fetch("data/" + meta.file).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " - " + meta.file);
      return res.text();
    }).then(function (text) {
      var rows = parseCSV(text);
      rows.shift(); // 表头
      var items = rows.filter(function (r) { return r.length >= 6 && r[0]; }).map(function (r) {
        return {
          domain: meta.id,
          domainName: meta.name,
          term: r[0].trim(),
          en: r[1].trim(),
          category: r[2].trim(),
          definition: r[3].trim(),
          scenario: r[4].trim(),
          related: splitRelated(r[5]),
        };
      });
      state.cache[id] = items;
      return items;
    });
  }

  function loadCurrent() {
    var view = tbody.parentNode;
    var old = view.querySelector(".loading");
    if (old) old.remove();
    var loading = document.createElement("div");
    loading.className = "loading";
    loading.textContent = "正在下载并解析 CSV";
    view.appendChild(loading);
    tbody.innerHTML = "";

    var jobs;
    if (state.current === "all" || isMarkView(state.current)) {
      // 标记视图跨领域，需要全部数据
      jobs = state.domains.map(function (d) { return loadDomain(d.id); });
    } else {
      jobs = [loadDomain(state.current)];
    }
    return Promise.all(jobs).then(function () {
      loading.remove();
      render();
    }).catch(function (err) {
      loading.textContent = "数据加载失败: " + err.message;
    });
  }

  /* ---------- 过滤 ---------- */
  function currentItems() {
    var items = [];
    if (state.current === "all" || isMarkView(state.current)) {
      state.domains.forEach(function (d) {
        items = items.concat(state.cache[d.id] || []);
      });
    } else {
      items = state.cache[state.current] || [];
    }
    if (isMarkView(state.current)) {
      var v = state.current;
      items = items.filter(function (it) {
        var m = getMark(markKey(it));
        if (v === "starred") return !!m.s;
        if (v === "mastered") return !!m.m;
        return !m.s && !m.m;
      });
    }
    return items;
  }

  function matches(item) {
    if (state.category !== "all" && item.category !== state.category) return false;
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    var hay = (item.term + " " + item.en + " " + item.definition + " " + item.scenario + " " + item.category + " " + item.domainName + " " + item.related.join(" ")).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  /* ---------- 渲染 ---------- */
  function renderStats() {
    var total = state.domains.reduce(function (s, d) { return s + d.count; }, 0);
    $("stats").innerHTML =
      '<span class="stat-pill"><b>' + state.domains.length + '</b>个领域</span>' +
      '<span class="stat-pill"><b>' + total + '</b>条术语</span>' +
      '<span class="stat-pill" id="markStats"></span>' +
      '<span class="stat-pill">数据格式 <b>CSV</b></span>';
    updateMarkStats();
  }

  function renderNav() {
    var nav = $("domainNav");
    var html = "";
    var total = state.domains.reduce(function (s, d) { return s + d.count; }, 0);

    html += '<div class="nav-group-title">总览</div>';
    html += navItem("all", "全部术语", total);

    html += '<div class="nav-group-title">我的标记</div>';
    html += navItem("starred", "★ 已加星", countMark("s"));
    html += navItem("mastered", "✓ 已掌握", countMark("m"));
    html += navItem("unmarked", "○ 未标记", Math.max(0, total - countMarkedAny()));

    var groups = {};
    var order = [];
    state.domains.forEach(function (d) {
      if (!groups[d.group]) { groups[d.group] = []; order.push(d.group); }
      groups[d.group].push(d);
    });
    order.forEach(function (g) {
      html += '<div class="nav-group-title">' + escapeHTML(g) + "</div>";
      groups[g].forEach(function (d) {
        html += navItem(d.id, d.name, d.count);
      });
    });
    nav.innerHTML = html;

    Array.prototype.forEach.call(nav.querySelectorAll(".nav-item"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (id === state.current) return;
        state.current = id;
        state.category = "all";
        state.query = "";
        $("search").value = "";
        location.hash = id === "all" ? "" : id;
        syncNavActive();
        loadCurrent();
      });
    });
  }

  function navItem(id, name, count) {
    var active = state.current === id ? " active" : "";
    return '<button class="nav-item' + active + '" data-id="' + id + '">' +
      "<span>" + escapeHTML(name) + "</span>" +
      '<span class="count">' + count + "</span></button>";
  }

  function syncNavActive() {
    Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-id") === state.current);
    });
  }

  function renderHead() {
    var items = currentItems();
    var shown = items.filter(matches);
    if (isMarkView(state.current)) {
      var mm = MARK_META[state.current];
      $("domainTitle").textContent = mm.title;
      $("domainDesc").textContent = mm.desc;
    } else if (state.current === "all") {
      $("domainTitle").textContent = "全部术语";
      $("domainDesc").textContent = "跨 " + state.domains.length + " 个领域的完整术语集合，支持关键词搜索";
    } else {
      for (var i = 0; i < state.domains.length; i++) {
        if (state.domains[i].id === state.current) {
          $("domainTitle").textContent = state.domains[i].name;
          $("domainDesc").textContent = state.domains[i].desc;
          break;
        }
      }
    }
    $("resultCount").innerHTML = "显示 <b>" + shown.length + "</b> / " + items.length + " 条";
    renderCategories(items);
  }

  function renderCategories(items) {
    var bar = $("categoryBar");
    var counts = {};
    items.forEach(function (it) { counts[it.category] = (counts[it.category] || 0) + 1; });
    var cats = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

    var html = '<button class="chip' + (state.category === "all" ? " active" : "") + '" data-cat="all">全部<span class="n">' + items.length + "</span></button>";
    cats.forEach(function (c) {
      html += '<button class="chip' + (state.category === c ? " active" : "") + '" data-cat="' + escapeHTML(c) + '">' +
        escapeHTML(c) + '<span class="n">' + counts[c] + "</span></button>";
    });
    bar.innerHTML = html;

    Array.prototype.forEach.call(bar.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.category = chip.getAttribute("data-cat");
        render();
      });
    });
  }

  function markBtn(kind, key, field, on, glyph, title) {
    return '<button type="button" class="mark-btn ' + kind + (on ? " on" : "") +
      '" data-k="' + key + '" data-f="' + field +
      '" aria-pressed="' + (on ? "true" : "false") + '" title="' + title + '">' + glyph + "</button>";
  }

  function renderTable(items) {
    var shown = items.filter(matches);
    $("empty").hidden = shown.length > 0;
    var showDomain = state.current === "all";
    $("thDomain").hidden = !showDomain; // 仅“全部术语”视图显示领域列
    var html = "";
    shown.forEach(function (it) {
      var rel = it.related.map(function (r) {
        return '<button class="rel-chip" data-rel="' + escapeHTML(r) + '">' + escapeHTML(r) + "</button>";
      }).join("");
      var domainCell = showDomain
        ? '<td class="cell-domain"><span class="domain-tag">' + escapeHTML(it.domainName) + "</span></td>"
        : "";
      var key = escapeHTML(markKey(it));
      var m = getMark(markKey(it));
      var rowCls = [];
      if (m.s) rowCls.push("is-starred");
      if (m.m) rowCls.push("is-mastered");
      var markCell = '<td class="cell-mark">' +
        markBtn("star", key, "s", !!m.s, "★", "加星：重点复习") +
        markBtn("done", key, "m", !!m.m, "✓", "标记：已掌握") +
        "</td>";
      html += '<tr class="' + rowCls.join(" ") + '">' +
        markCell +
        '<td><span class="term-name" title="点击复制">' + escapeHTML(it.term) + "</span></td>" +
        domainCell +
        '<td><span class="term-en">' + escapeHTML(it.en) + "</span></td>" +
        '<td><span class="term-cat">' + escapeHTML(it.category) + "</span></td>" +
        '<td class="term-def">' + escapeHTML(it.definition) + "</td>" +
        '<td class="term-scene">' + escapeHTML(it.scenario) + "</td>" +
        '<td><div class="term-rel">' + rel + "</div></td>" +
        "</tr>";
    });
    tbody.innerHTML = html;

    Array.prototype.forEach.call(tbody.querySelectorAll(".term-name"), function (el) {
      el.addEventListener("click", function () {
        var text = el.textContent.trim();
        copyText(text);
      });
    });
    Array.prototype.forEach.call(tbody.querySelectorAll(".rel-chip"), function (el) {
      el.addEventListener("click", function () {
        var q = el.getAttribute("data-rel");
        $("search").value = q;
        state.query = q;
        state.category = "all";
        render();
      });
    });
  }

  function render() {
    renderHead();
    renderTable(currentItems());
  }

  /* ---------- 复制 ---------- */
  var toastTimer = null;
  function copyText(text) {
    function done() { showToast("已复制: " + text); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text); done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function showToast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1600);
  }

  /* ---------- hash 路由（支持浏览器前进/后退与分享链接） ---------- */
  function isKnownView(id) {
    if (!id) return false;
    return id === "all" || isMarkView(id) || state.domains.some(function (d) { return d.id === id; });
  }

  window.addEventListener("hashchange", function () {
    var h = location.hash.replace("#", "");
    var id = isKnownView(h) ? h : "all";
    if (id === state.current) return;
    state.current = id;
    state.category = "all";
    state.query = "";
    $("search").value = "";
    syncNavActive();
    loadCurrent();
  });

  /* ---------- 搜索 ---------- */
  var searchTimer = null;
  $("search").addEventListener("input", function (e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = e.target.value;
      render();
    }, 120);
  });

  /* ---------- 启动 ---------- */
  function initFromHash() {
    var h = location.hash.replace("#", "");
    if (isKnownView(h)) state.current = h;
  }

  /* ---------- 标记交互（事件委托） ---------- */
  tbody.addEventListener("click", function (e) {
    var el = e.target;
    var btn = (el && el.closest) ? el.closest(".mark-btn") : null;
    if (!btn) return;
    var key = btn.getAttribute("data-k");
    var field = btn.getAttribute("data-f");
    toggleMark(key, field);
    var m = getMark(key);
    btn.classList.toggle("on", !!m[field]);
    btn.setAttribute("aria-pressed", m[field] ? "true" : "false");
    var tr = btn.parentNode.parentNode;
    tr.classList.toggle("is-starred", !!m.s);
    tr.classList.toggle("is-mastered", !!m.m);
    updateMarkStats();
    updateNavCounts();
    // 在标记视图下，取消标记后该行应移出列表
    if (isMarkView(state.current)) render();
  });

  $("resetMarks").addEventListener("click", function () {
    if (!countMarkedAny()) { showToast("还没有任何标记"); return; }
    if (!window.confirm("确定清空全部加星 / 已掌握标记？该操作不可撤销。")) return;
    marks = {};
    saveMarks();
    updateMarkStats();
    updateNavCounts();
    render();
    showToast("已清空全部标记");
  });

  fetch("data/domains.json").then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (domains) {
    state.domains = domains;
    loadMarks();
    initFromHash();
    renderStats();
    renderNav();
    loadCurrent();
  }).catch(function (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">索引加载失败: ' + escapeHTML(err.message) + "</td></tr>";
  });
})();
