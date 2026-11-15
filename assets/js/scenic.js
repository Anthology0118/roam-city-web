/* =============================================================
   「漫游城市」景点页脚本 scenic.js
   职责：
     1. 渲染分类筛选 chips + 全部景点卡片
     2. 分类 / 关键词搜索（支持 URL 参数 ?cat= & ?keyword= 联动）
     3. 详情弹窗（?spot=xxx 可直接定位）
     4. 心愿清单计数实时联动（监听 roam:favchange）
   ============================================================= */
(function () {
  "use strict";

  var TRAVEL = window.TRAVEL;
  if (!TRAVEL) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var grid = $("#scenicGrid");
  var emptyBox = $("#emptyBox");
  var chipsBox = $("#catChips");
  var kwInput = $("#kw");
  var favCountEl = $("#favCount");

  /* 当前筛选状态 */
  var state = { cat: "全部", kw: "" };

  function stars(r) { var f = Math.round(r); return "★".repeat(f) + "☆".repeat(Math.max(0, 5 - f)); }

  /* ---------- 卡片模板 ---------- */
  function cardHTML(s) {
    var liked = window.Roam && window.Roam.isFav(s.id);
    return (
      '<article class="spot-card" data-id="' + s.id + '">' +
        '<div class="spot-media">' +
          '<img src="' + TRAVEL.SCENES_BASE + s.scene + '" alt="' + s.name + ' 风景插画" loading="lazy">' +
          '<div class="spot-badges">' +
            '<span class="badge">' + s.cat + '</span>' +
            (s.price === 0 ? '<span class="badge new">🆓 免费</span>' : '') +
          '</div>' +
          '<span class="spot-price">¥' + s.price + '<small> 起</small></span>' +
        '</div>' +
        '<div class="spot-body">' +
          '<div class="spot-title-row"><h3 class="spot-title">' + s.name + '</h3><span class="spot-en">' + s.en + '</span></div>' +
          '<div class="spot-meta">' +
            '<span>📍 ' + s.city + '</span>' +
            '<span class="stars" title="评分 ' + s.rating + '">' + stars(s.rating) + '</span>' +
            '<span>' + s.rating + '</span>' +
            '<span>🗓 ' + s.days + '</span>' +
          '</div>' +
          '<p class="spot-desc">' + s.desc + '</p>' +
          '<div class="spot-actions">' +
            '<a class="btn btn-outline btn-sm" data-open-spot="' + s.id + '" href="javascript:void(0)">查看详情</a>' +
            '<button class="icon-heart' + (liked ? ' liked' : '') + '" data-fav="' + s.id + '" aria-label="收藏" aria-pressed="' + liked + '">♥</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  /* ---------- 应用筛选并渲染 ---------- */
  function applyFilters(animate) {
    var list = TRAVEL.spots.filter(function (s) {
      var okCat = state.cat === "全部" || s.cat === state.cat;
      if (!okCat) return false;
      if (!state.kw) return true;
      var hay = (s.name + s.city + s.cat + s.desc + s.tags.join("")).toLowerCase();
      return hay.indexOf(state.kw.toLowerCase()) > -1;
    });

    grid.innerHTML = list.map(function (s) {
      return cardHTML(s);
    }).join("");

    /* 首次渲染允许出场动画（main.js 的滚动观察器此时尚未注册，
       因此能捕捉到动态卡片；后续筛选直接更新，不再重复动画） */
    if (animate) {
      Array.prototype.forEach.call(grid.children, function (c) { c.classList.add("reveal"); });
    }

    emptyBox.style.display = list.length ? "none" : "block";
  }

  /* ---------- 渲染分类 chips ---------- */
  function renderChips() {
    var cats = ["全部"].concat(TRAVEL.cats);
    chipsBox.innerHTML = cats.map(function (c) {
      return '<button class="chip' + (c === state.cat ? " on" : "") + '" data-cat="' + c + '">' + c + '</button>';
    }).join("");
  }

  /* ---------- 心愿清单计数 ---------- */
  function updateFavCount() {
    if (favCountEl) favCountEl.textContent = (window.Roam.favs() || []).length;
  }

  /* ---------- 详情弹窗 ---------- */
  var modal = $("#spotModal");
  var currentSpot = null;

  function fillModal(s) {
    currentSpot = s;
    $("#dImg").src = TRAVEL.SCENES_BASE + s.scene;
    $("#dImg").alt = s.name;
    $("#dName").textContent = s.name;
    $("#dStars").textContent = stars(s.rating) + "  " + s.rating + " / 5";
    $("#dDesc").textContent = s.desc;
    $("#dBook").href = "booking.html?spot=" + s.id;
    var favBtn = $("#dFav");
    favBtn.dataset.fav = s.id;
    favBtn.classList.toggle("liked", window.Roam.isFav(s.id));

    $("#dTags").innerHTML = (s.tags || []).map(function (t) {
      return '<span class="badge">' + t + '</span>';
    }).join("");

    var info = [
      ["📍 所在城市", s.city],
      ["🗓 建议游玩", s.days],
      ["🎫 参考门票", s.price === 0 ? "免费入园" : "¥" + s.price + " 起"],
      ["⭐ 综合评分", s.rating + " / 5"],
      ["🔖 景点类型", s.cat],
      ["👀 本站热度", s.views.toLocaleString() + " 人浏览"]
    ];
    $("#dInfo").innerHTML = info.map(function (row) {
      return "<li><b>" + row[0] + "</b><span>" + row[1] + "</span></li>";
    }).join("");
  }

  function openModal(s) {
    fillModal(s);
    modal.classList.add("on");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modal.classList.remove("on");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  function initModalEvents() {
    modal.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("on")) closeModal();
    });
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    /* 分类点击 */
    chipsBox.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-cat]");
      if (!chip) return;
      state.cat = chip.dataset.cat;
      renderChips();
      applyFilters(false);
      updateUrl();
    });

    /* 搜索按钮 */
    $("#kwBtn").addEventListener("click", function () { doSearch(); });
    kwInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
    kwInput.addEventListener("input", function () {
      state.kw = kwInput.value.trim();
      applyFilters(false);
      updateUrl();
    });

    function doSearch() {
      state.kw = kwInput.value.trim();
      applyFilters(false);
      updateUrl();
      if (!state.kw) kwInput.focus();
    }

    /* 卡片“查看详情”委托 */
    grid.addEventListener("click", function (e) {
      var opener = e.target.closest("[data-open-spot]");
      if (opener) {
        e.preventDefault();
        var s = TRAVEL.spotById(opener.dataset.openSpot);
        if (s) openModal(s);
      }
    });

    /* 心愿清单数量变化 + 同步卡片/弹窗收藏态 */
    window.addEventListener("roam:favchange", function (e) {
      updateFavCount();
      if (!e.detail) return;
      var btns = document.querySelectorAll('[data-fav="' + e.detail.id + '"]');
      Array.prototype.forEach.call(btns, function (b) {
        b.classList.toggle("liked", e.detail.liked);
        b.setAttribute("aria-pressed", String(e.detail.liked));
      });
    });
  }

  /* ---------- URL 参数支持（?cat= ?keyword= ?spot=） ---------- */
  function applyUrlParams() {
    var qs = new URLSearchParams(location.search);
    if (qs.get("cat")) state.cat = qs.get("cat");
    if (qs.has("keyword")) { state.kw = qs.get("keyword").trim(); if (kwInput) kwInput.value = state.kw; }
    return qs;
  }

  /* 把当前筛选写入地址栏（方便分享/刷新保持）；file:// 下可能被浏览器拦截，故 try 包裹 */
  function updateUrl() {
    try {
      var params = new URLSearchParams();
      if (state.cat !== "全部") params.set("cat", state.cat);
      if (state.kw) params.set("keyword", state.kw);
      var qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
    } catch (e) { /* 本地文件协议下忽略 */ }
  }

  /* ---------- 启动 ---------- */
  var qs = applyUrlParams();
  renderChips();
  applyFilters(true);       /* 首次带出场动画 */
  updateFavCount();
  bindEvents();
  initModalEvents();

  /* 首页/页脚带 ?spot=xxx 跳转进来时，自动弹出详情 */
  if (qs.get("spot")) {
    var s = TRAVEL.spotById(qs.get("spot"));
    if (s) openModal(s);
  }
})();
