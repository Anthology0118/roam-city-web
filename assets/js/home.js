/* =============================================================
   「漫游城市」首页脚本 index 专属
   职责：
     1. 渲染热门目的地卡片（支持收藏 ♥）
     2. 渲染主题分类并联动景点页筛选
     3. 大图焦点轮播（自动播放 / 箭头 / 圆点 / 触摸 / 悬停暂停）
     4. 经典路线 Tab 切换
     5. 旅友评价轮播
     6. 订阅表单校验 + 邮箱本地存储
     7. 首页搜索跳转
   ============================================================= */
(function () {
  "use strict";

  var TRAVEL = window.TRAVEL;
  if (!TRAVEL) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- 工具：星级字符串 ---------- */
  function stars(rating) {
    var full = Math.round(rating);
    return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
  }

  /* ---------- 1. 渲染热门目的地卡片 ---------- */
  function renderSpots() {
    var grid = $("#spotGrid");
    if (!grid) return;
    var html = TRAVEL.spots.slice(0, 6).map(function (s) {
      var liked = window.Roam && window.Roam.isFav(s.id);
      return (
        '<article class="spot-card reveal" data-id="' + s.id + '">' +
          '<div class="spot-media">' +
            '<img src="' + TRAVEL.SCENES_BASE + s.scene + '" alt="' + s.name + ' 风景插画" loading="lazy">' +
            '<div class="spot-badges">' +
              '<span class="badge">' + s.cat + '</span>' +
              (s.rating >= 4.9 ? '<span class="badge hot">🔥 热门</span>' : '') +
            '</div>' +
            '<span class="spot-price">¥' + s.price + '<small> 起</small></span>' +
          '</div>' +
          '<div class="spot-body">' +
            '<div class="spot-title-row"><h3 class="spot-title">' + s.name + '</h3><span class="spot-en">' + s.en + '</span></div>' +
            '<div class="spot-meta">' +
              '<span>📍 ' + s.city + '</span>' +
              '<span class="stars" title="评分 ' + s.rating + '">' + stars(s.rating) + '</span>' +
              '<span>' + s.rating + '</span>' +
            '</div>' +
            '<p class="spot-desc">' + s.desc + '</p>' +
            '<div class="spot-actions">' +
              '<a class="btn btn-outline btn-sm" href="scenic.html?spot=' + s.id + '">查看详情</a>' +
              '<button class="icon-heart' + (liked ? ' liked' : '') + '" data-fav="' + s.id + '" aria-label="收藏" aria-pressed="' + liked + '">♥</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join("");
    grid.innerHTML = html;
  }

  /* ---------- 2. 渲染主题分类 ---------- */
  function renderThemes() {
    var wrap = $("#themeGrid");
    if (!wrap) return;
    var emojiMap = { "自然山水": "🏔️", "人文历史": "🏛️", "古城古镇": "🏘️", "海岛海滨": "🏝️" };
    var descMap = { "自然山水": "峰林湖泊，鬼斧神工", "人文历史": "行走在时间深处", "古城古镇": "枕水江南慢生活", "海岛海滨": "把烦恼留在沙滩" };
    var html = TRAVEL.cats.map(function (cat, i) {
      var count = TRAVEL.spots.filter(function (s) { return s.cat === cat; }).length;
      return (
        '<a class="feature reveal" style="transition-delay:' + (i * 0.08) + 's" href="scenic.html?cat=' + encodeURIComponent(cat) + '">' +
          '<span class="emoji">' + (emojiMap[cat] || "🗺️") + '</span>' +
          '<h3>' + cat + '</h3>' +
          '<p>' + (descMap[cat] || "") + ' · 共 ' + count + ' 处</p>' +
        '</a>'
      );
    }).join("");
    wrap.innerHTML = html;
  }

  /* ---------- 3. 大图焦点轮播 ---------- */
  var scTimer = null;
  function initCarousel() {
    var track = $("#scTrack"), dots = $("#scDots"), count = $("#scCount");
    var carousel = $("#spotCarousel");
    if (!track || !carousel) return;

    track.innerHTML = TRAVEL.slides.map(function (s) {
      return (
        '<div class="sc-slide">' +
          '<img src="' + TRAVEL.SCENES_BASE + s.scene + '" alt="' + s.title + '">' +
          '<div class="sc-info">' +
            '<span class="sc-tag">' + s.kicker + ' · EDITOR’S PICK</span>' +
            '<h3>' + s.title + '</h3>' +
            '<p>' + s.desc + '</p>' +
            '<a class="btn btn-primary btn-sm" href="scenic.html?spot=' + s.id + '">查看景点详情 →</a>' +
          '</div>' +
        '</div>'
      );
    }).join("");

    var total = TRAVEL.slides.length;
    var idx = 0;

    function goTo(n, auto) {
      idx = (n + total) % total;
      track.style.transform = "translateX(-" + idx * 100 + "%)";
      Array.prototype.forEach.call(dots.children, function (d, i) {
        d.classList.toggle("on", i === idx);
      });
      if (count) count.textContent = (idx + 1) + " / " + total;
    }

    dots.innerHTML = TRAVEL.slides.map(function (_, i) {
      return '<span data-i="' + i + '"></span>';
    }).join("");
    Array.prototype.forEach.call(dots.children, function (d) {
      d.addEventListener("click", function () { goTo(+d.dataset.i); restart(); });
    });

    function play() { scTimer = setInterval(function () { goTo(idx + 1); }, 5000); }
    function restart() { clearInterval(scTimer); play(); }
    function stop() { clearInterval(scTimer); }

    $("#scPrev").addEventListener("click", function () { goTo(idx - 1); restart(); });
    $("#scNext").addEventListener("click", function () { goTo(idx + 1); restart(); });

    carousel.addEventListener("mouseenter", stop);
    carousel.addEventListener("mouseleave", play);

    /* 触摸滑动 */
    var x0 = null;
    carousel.addEventListener("pointerdown", function (e) { x0 = e.clientX; });
    carousel.addEventListener("pointerup", function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0;
      if (Math.abs(dx) > 40) { goTo(idx + (dx < 0 ? 1 : -1)); restart(); }
      x0 = null;
    });

    goTo(0);
    play();
  }

  /* ---------- 4. 经典路线 Tab ---------- */
  function initRoutes() {
    var tabs = $("#routeTabs"), area = $("#routeArea");
    if (!tabs || !area) return;

    var sceneMap = { gui: "guilin", xi: "wuzhen", yu: "sanya" };

    tabs.innerHTML = TRAVEL.routes.map(function (r) {
      return '<button class="tab" data-key="' + r.key + '">' + r.name + '</button>';
    }).join("");

    area.innerHTML = TRAVEL.routes.map(function (r) {
      var mapScene = sceneMap[r.key] || "hero-city";
      return (
        '<div class="route-panel" data-panel="' + r.key + '">' +
          '<div class="route-map" style="position:relative">' +
            '<img src="' + TRAVEL.SCENES_BASE + mapScene + '.svg" alt="' + r.name + '" style="width:100%;height:100%;object-fit:cover;min-height:260px">' +
            '<span style="position:absolute;left:14px;top:14px">' +
              '<span class="badge">🗓 ' + r.days + '</span>&nbsp;' +
              '<span class="badge hot">★ 编辑推荐</span>' +
            '</span>' +
            '<a class="btn btn-primary btn-sm" style="position:absolute;right:14px;bottom:14px" href="booking.html">立即规划行程 →</a>' +
          '</div>' +
          '<div class="timeline">' +
            '<h3>' + r.name + '</h3>' +
            '<ol>' + r.stops.map(function (st) {
              return '<li><span class="t-day">' + st.day + '</span> <span class="t-txt">' + st.txt + '</span></li>';
            }).join("") + '</ol>' +
            '<a class="btn btn-outline btn-sm" href="scenic.html?cat=' + encodeURIComponent(TRAVEL.cats[0]) + '">沿路看看景点 →</a>' +
          '</div>' +
        '</div>'
      );
    }).join("");

    var panels = area.children;
    var first = tabs.children[0];
    first.classList.add("on");
    var findPanel = function (key) { return $('[data-panel="' + key + '"]', area); };
    findPanel(first.dataset.key).classList.add("on");

    Array.prototype.forEach.call(tabs.children, function (btn) {
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs.children, function (b) { b.classList.remove("on"); });
        Array.prototype.forEach.call(panels, function (p) { p.classList.remove("on"); });
        btn.classList.add("on");
        findPanel(btn.dataset.key).classList.add("on");
      });
    });
  }

  /* ---------- 5. 旅友评价轮播（自动切换，悬停暂停） ---------- */
  function initVoices() {
    var track = $("#tTrack");
    if (!track) return;
    track.innerHTML = TRAVEL.testimonials.map(function (t) {
      return (
        '<div class="t-slide"><div class="t-card">' +
          '<span class="quote">“</span>' +
          '<p class="t-text">' + t.text + '</p>' +
          '<div class="t-avatar" style="background:' + t.color + '">' + t.name.charAt(0) + '</div>' +
          '<div class="t-name">' + t.name + '</div>' +
          '<div class="t-role">' + t.role + '</div>' +
        '</div></div>'
      );
    }).join("");

    var idx = 0, total = TRAVEL.testimonials.length, timer;
    var unit = 100 / total;
    function go(n) { idx = (n + total) % total; track.style.transform = "translateX(-" + (idx * unit) + "%)"; }
    function play() { timer = setInterval(function () { go(idx + 1); }, 5000); }
    function stop() { clearInterval(timer); }
    var wrap = track.parentElement;
    wrap.addEventListener("mouseenter", stop);
    wrap.addEventListener("mouseleave", play);
    go(0); play();
  }

  /* ---------- 6. 订阅表单：邮箱正则校验 + localStorage ---------- */
  function initNewsletter() {
    var form = $("#nlForm");
    if (!form) return;
    var tip = $("#nlTip");
    var EMAIL_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("#nlEmail");
      var val = input.value.trim();
      tip.className = "form-tip";

      if (!val) { tip.textContent = "请先填写邮箱地址哦"; tip.classList.add("err"); input.classList.add("err"); return; }
      if (!EMAIL_RE.test(val)) {
        tip.textContent = "邮箱格式不正确，请检查后重试（示例 you@example.com）";
        tip.classList.add("err"); input.classList.add("err"); return;
      }
      /* 本地去重存储 */
      var list = [];
      try { list = JSON.parse(localStorage.getItem("roam_subscribers") || "[]"); } catch (ex) {}
      if (list.indexOf(val) === -1) list.unshift(val);
      localStorage.setItem("roam_subscribers", JSON.stringify(list));

      input.classList.remove("err");
      input.value = "";
      tip.textContent = "🎉 订阅成功！欢迎来到漫游城市，下一期刊已装入行囊。";
      tip.classList.add("ok");
      window.toast && window.toast("订阅成功，感谢关注", "success");
    });

    $("#nlEmail").addEventListener("input", function (e) {
      e.target.classList.remove("err");
      var tip = $("#nlTip"); tip.className = "form-tip"; tip.textContent = "";
    });
  }

  /* ---------- 7. 首页搜索：跳转景点页自动筛选 ---------- */
  function initHeroSearch() {
    var form = $("#heroSearch");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = form.q.value.trim();
      if (!q) { window.toast && window.toast("先告诉我你想去哪儿~", "error"); form.q.focus(); return; }
      location.href = "scenic.html?keyword=" + encodeURIComponent(q);
    });
  }

  /* ---------- 初始化 ----------
     注意：本脚本位于 <body> 末尾且相关 DOM 已存在，
     因此直接同步执行渲染 —— 保证 main.js 的进场动画
     （DOMContentLoaded 后才观察 .reveal）能看到动态插入的卡片。 */
  renderSpots();
  renderThemes();
  initCarousel();
  initRoutes();
  initVoices();
  initNewsletter();
  initHeroSearch();
})();
