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
    mark: "all",        // 标记筛选: all | starred | mastered | unmarked
  };

  var $ = function (id) { return document.getElementById(id); };
  var tbody = $("tbody");

  /* ---------- 标记（★ 加星 / ✕ 已掌握）· localStorage 持久化 ---------- */
  var LS_KEY = "devterm.marks.v1";
  var MARK_FILTERS = [
    { id: "all", label: "全部", cls: "" },
    { id: "starred", label: "★ 已加星", cls: "mk-star" },
    { id: "mastered", label: "✕ 已掌握", cls: "mk-done" },
    { id: "unmarked", label: "○ 未标记", cls: "" },
  ];
  var marks = {}; // key = "<domain>::<term>" -> { s:1, m:1 }

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
      '<b class="mk-done">✕ ' + countMark("m") + "</b>" +
      '<span class="mk-pct">掌握 ' + pct + "%</span>";
  }

  // 在当前范围（某个领域或全部）内统计各标记的数量
  function markCounts(items) {
    var c = { all: items.length, starred: 0, mastered: 0, unmarked: 0 };
    items.forEach(function (it) {
      var m = getMark(markKey(it));
      if (m.s) c.starred++;
      if (m.m) c.mastered++;
      if (!m.s && !m.m) c.unmarked++;
    });
    return c;
  }

  /* ---------- 主题切换（深色 / 浅色），同样存 localStorage ---------- */
  var THEME_KEY = "devterm.theme.v1";
  var THEME_ICON = { dark: "☾", light: "☀" };

  function currentTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    return t === "light" ? "light" : "dark";
  }

  function applyTheme(theme, persist) {
    document.documentElement.setAttribute("data-theme", theme);
    var btn = $("themeToggle");
    if (btn) {
      btn.textContent = THEME_ICON[theme];
      btn.title = theme === "light" ? "切换到深色主题" : "切换到浅色主题";
    }
    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 忽略 */ }
    }
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
    if (state.current === "all") {
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
    if (state.current === "all") {
      state.domains.forEach(function (d) {
        items = items.concat(state.cache[d.id] || []);
      });
    } else {
      items = state.cache[state.current] || [];
    }
    return items;
  }

  function matches(item) {
    if (state.category !== "all" && item.category !== state.category) return false;
    if (state.mark !== "all") {
      var m = getMark(markKey(item));
      if (state.mark === "starred") { if (!m.s) return false; }
      else if (state.mark === "mastered") { if (!m.m) return false; }
      else if (m.s || m.m) return false; // unmarked
    }
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
        state.mark = "all";
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
    if (state.current === "all") {
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
    renderMarkBar(items);
  }

  /* 标记筛选条：位于分类之下，与分类 / 搜索叠加生效 */
  function renderMarkBar(items) {
    var bar = $("markBar");
    var c = markCounts(items);
    var html = '<span class="mark-bar-label">标记</span>';
    MARK_FILTERS.forEach(function (f) {
      html += '<button type="button" class="chip mark-chip ' + f.cls +
        (state.mark === f.id ? " active" : "") + '" data-mark="' + f.id + '">' +
        f.label + '<span class="n">' + c[f.id] + "</span></button>";
    });
    bar.innerHTML = html;

    Array.prototype.forEach.call(bar.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.mark = chip.getAttribute("data-mark");
        render();
      });
    });
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
        markBtn("done", key, "m", !!m.m, "✕", "标记：已掌握（划掉，再点取消）") +
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

  /* ---------- hash 路由（支持浏览器前进/后退与分享链接） ---------- */  window.addEventListener("hashchange", function () {
    var h = location.hash.replace("#", "");
    var id = (h && state.domains.some(function (d) { return d.id === h; })) ? h : "all";
    if (id === state.current) return;
    state.current = id;
    state.category = "all";
    state.mark = "all";
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
    if (h && state.domains.some(function (d) { return d.id === h; })) {
      state.current = h;
    }
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
    // 重渲染以更新筛选条计数，并在标记筛选生效时把该行移出列表
    render();
  });

  $("themeToggle").addEventListener("click", function () {
    applyTheme(currentTheme() === "light" ? "dark" : "light", true);
  });
  // 与内联脚本保持一致：图标随当前主题
  applyTheme(currentTheme(), false);

  $("resetMarks").addEventListener("click", function () {
    if (!countMarkedAny()) { showToast("还没有任何标记"); return; }
    if (!window.confirm("确定清空全部加星 / 已掌握标记？该操作不可撤销。")) return;
    marks = {};
    saveMarks();
    updateMarkStats();
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
