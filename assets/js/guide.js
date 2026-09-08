/* =============================================================
   「漫游城市」攻略页脚本 guide.js
   职责：
     1. 用数据渲染多篇文章（段落 / 清单 / 提示框 / 表格）
     2. 左侧“攻略合集”切换文章（支持 ?g=id 直接定位）
     3. 右侧“本文目录”TOC：点击跳转 + 滚动阅读进度高亮
     4. FAQ 折叠面板
   ============================================================= */
(function () {
  "use strict";

  var TRAVEL = window.TRAVEL;
  if (!TRAVEL) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var postArea = $("#postArea");
  var articleList = $("#articleList");
  var tocBox = $("#toc");
  var faqBox = $("#faqBox");
  var activeId = null;
  var headings = [];   /* 当前可见文章的小标题节点 */

  /* ---------- 单个数据块 -> HTML ---------- */
  function blockHTML(block) {
    if (block.p) return "<p>" + block.p + "</p>";
    if (block.tips) {
      return '<ul class="tips">' + block.tips.map(function (t) {
        return "<li>" + t + "</li>";
      }).join("") + "</ul>";
    }
    if (block.note) {
      return '<div class="note-box"><b>💡 温馨提示：</b>' + block.note + "</div>";
    }
    if (block.table) {
      var tb = block.table;
      var head = "<tr>" + tb.head.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr>";
      var rows = tb.rows.map(function (r) {
        return "<tr>" + r.map(function (c, i) {
          /* 末列若为“合计 / 推荐度”类，加粗强调 */
          var strong = i === r.length - 1 && /推荐度|合计|总价/.test(tb.head[i] || "");
          return strong ? "<td><b>" + c + "</b></td>" : "<td>" + c + "</td>";
        }).join("") + "</tr>";
      }).join("");
      return '<div class="table-wrap"><table class="guide-table"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>";
    }
    return "";
  }

  /* ---------- 估算阅读时长 ---------- */
  function readMinutes(g) {
    var chars = 0;
    g.sections.forEach(function (sec) {
      sec.blocks.forEach(function (b) {
        if (b.p) chars += b.p.length;
        if (b.tips) b.tips.forEach(function (t) { chars += t.length; });
        if (b.note) chars += b.note.length;
        if (b.table) b.table.rows.forEach(function (r) { r.forEach(function (c) { chars += String(c).length; }); });
      });
    });
    return Math.max(1, Math.round(chars / 320));
  }

  /* ---------- 渲染一篇文章 ---------- */
  function postHTML(g) {
    var inner = g.sections.map(function (sec, i) {
      var body = sec.blocks.map(blockHTML).join("");
      return '<h3 id="' + g.id + '-s' + (i + 1) + '">' + sec.h + "</h3>" + body;
    }).join("");

    return (
      '<article class="guide-post reveal" id="post-' + g.id + '">' +
        '<div class="post-hero-info">' +
          '<span class="badge">' + g.cat + '</span> <span class="badge hot">★ 亲测有效</span>' +
          '<h2>' + g.title + '</h2>' +
          '<div class="post-toolbar">' +
            '<span>🕒 ' + g.date + '</span>' +
            '<span>👀 ' + g.views.toLocaleString() + ' 次阅读</span>' +
            '<span>⏱ 约 ' + readMinutes(g) + ' 分钟</span>' +
            '<span style="margin-left:auto;color:#f6a821">★★★★★ ' + (4.5 + (g.id.charCodeAt(1) % 5) * 0.1).toFixed(1) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="post-hero-banner"><img src="' + TRAVEL.SCENES_BASE + g.hero + '" alt="' + g.title + '"></div>' +
        '<p style="color:var(--ink-soft);font-size:.98rem;border-left:4px solid var(--teal-100);padding:4px 0 4px 14px">' + g.intro + '</p>' +
        '<article>' + inner + '</article>' +
        '<div class="note-box" style="background:#eef8f5;border-left-color:var(--teal-500)">' +
          '<b>📖 未完待续：</b>想要更完整路线的同学，可点击右上角「门票预约」顺手把行程安排上。</div>' +
      '</article>'
    );
  }

  /* ---------- 展示某篇文章 ---------- */
  function showPost(id) {
    var g = TRAVEL.guides.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    activeId = id;

    /* 只显示目标文章 */
    Array.prototype.forEach.call(postArea.children, function (post) {
      post.classList.toggle("hidden", post.id !== "post-" + id);
    });

    /* 左侧列表高亮 */
    Array.prototype.forEach.call(articleList.children, function (li) {
      li.classList.toggle("on", li.dataset.id === id);
    });

    rebuildToc();
    /* 阅读位置回到文章顶部 */
    var target = document.getElementById("post-" + id);
    if (target) {
      var y = target.getBoundingClientRect().top + window.pageYOffset - 110;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    }
  }

  /* ---------- 重建本文目录 ---------- */
  function rebuildToc() {
    var post = $("#postArea .guide-post:not(.hidden)");
    headings = post ? post.querySelectorAll("article h3") : [];
    tocBox.innerHTML = Array.prototype.map.call(headings, function (h, i) {
      return '<li data-i="' + i + '">' + h.textContent + "</li>";
    }).join("");
    highlightToc();
  }

  function highlightToc() {
    var onIdx = -1;
    Array.prototype.forEach.call(headings, function (h, i) {
      if (h.getBoundingClientRect().top <= 150) onIdx = i;
    });
    /* 若全文读毕，锁定最后一节 */
    var post = $("#postArea .guide-post:not(.hidden)");
    if (post && onIdx === -1 && headings.length) {
      var last = headings[headings.length - 1];
      if (last.getBoundingClientRect().bottom <= window.innerHeight && last.getBoundingClientRect().top < window.innerHeight) {
        onIdx = headings.length - 1;
      }
    }
    Array.prototype.forEach.call(tocBox.children, function (li, i) {
      li.classList.toggle("on", i === onIdx);
    });
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    /* 切换文章 */
    articleList.addEventListener("click", function (e) {
      var li = e.target.closest("li[data-id]");
      if (li) { showPost(li.dataset.id); updateUrl(); }
    });

    /* 点击目录跳转 */
    tocBox.addEventListener("click", function (e) {
      var li = e.target.closest("li[data-i]");
      if (!li || !headings.length) return;
      var target = headings[+li.dataset.i];
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    /* FAQ 折叠 */
    faqBox.addEventListener("click", function (e) {
      var q = e.target.closest(".faq-q");
      if (!q) return;
      var item = q.parentElement;
      var wasOpen = item.classList.contains("open");
      Array.prototype.forEach.call(faqBox.children, function (c) { c.classList.remove("open"); });
      if (!wasOpen) item.classList.add("open");
    });

    /* 滚动高亮目录 */
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(function () { highlightToc(); ticking = false; }); }
    }, { passive: true });
  }

  function updateUrl() {
    try { history.replaceState(null, "", "guide.html?g=" + activeId); } catch (e) {}
  }

  /* ---------- 启动 ---------- */
  /* 渲染文章与 FAQ（同步执行，保证 main.js 能观察到进场动画） */
  postArea.innerHTML = TRAVEL.guides.map(postHTML).join("");

  articleList.innerHTML = TRAVEL.guides.map(function (g) {
    return (
      '<li data-id="' + g.id + '">' +
        '<img class="a-thumb" src="' + TRAVEL.SCENES_BASE + g.thumb + '" alt="">' +
        '<div><div class="a-name">' + g.title + '</div>' +
        '<div class="a-meta">🕒 ' + g.date + ' · 👀 ' + g.views.toLocaleString() + '</div></div>' +
      '</li>'
    );
  }).join("");

  faqBox.innerHTML = TRAVEL.faqs.map(function (f, i) {
    return (
      '<div class="faq-item' + (i === 0 ? " open" : "") + '">' +
        '<button class="faq-q">' + f.q + '<span class="arr">▼</span></button>' +
        '<div class="faq-a">' + f.a + '</div>' +
      '</div>'
    );
  }).join("");

  bindEvents();

  var want = new URLSearchParams(location.search).get("g");
  var firstId = TRAVEL.guides.some(function (g) { return g.id === want; }) ? want : TRAVEL.guides[0].id;
  showPost(firstId);
})();
