/* =============================================================
   「漫游城市」图集页脚本 gallery.js
   职责：
     1. CSS 多列瀑布流渲染 + 分类筛选
     2. Lightbox 灯箱：放大 / 左右切换 / 键盘 / 计数
     3. 每张图可 ♥ 收藏（与全站共用 localStorage）
   ============================================================= */
(function () {
  "use strict";

  var TRAVEL = window.TRAVEL;
  if (!TRAVEL) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var chips = $("#galChips");
  var masonry = $("#masonry");
  var galCount = $("#galCount");
  var stateCat = "全部";
  var list = [];          /* 当前筛选后的图集数组 */
  var lightbox = $("#lightbox");

  /* 瀑布流用到的“长短不一”高度（单位 px），循环取用让版面错落 */
  var H = [240, 320, 272, 360, 300, 252, 340, 296, 332, 276, 316, 356];

  function imgId(img) { return img.src.replace(/\.svg$/i, ""); }

  /* ---------- 渲染 ---------- */
  function render(animate) {
    list = TRAVEL.galleryImages.filter(function (g) {
      return stateCat === "全部" || g.cat === stateCat;
    });

    var html = list.map(function (g, i) {
      var id = imgId(g);
      var liked = window.Roam && window.Roam.isFav(id);
      var h = H[i % H.length];
      return (
        '<figure class="g-item' + (animate ? " reveal" : "") + '" style="height:' + h + 'px" data-i="' + i + '">' +
          '<img src="' + TRAVEL.SCENES_BASE + g.src + '" alt="' + g.title + '" loading="lazy">' +
          '<figcaption class="g-cap">' +
            '<h4>' + g.title + '</h4>' +
            '<span>📍 ' + g.note + ' · ' + g.cat + ' · 👍 ' + g.likes.toLocaleString() + '</span>' +
          '</figcaption>' +
          '<button class="g-like' + (liked ? " liked" : "") + '" data-fav="' + id + '" aria-label="收藏" aria-pressed="' + liked + '">♥</button>' +
        '</figure>'
      );
    }).join("");

    masonry.innerHTML = html;
    galCount.textContent = "共展示 " + list.length + " 张 · 点击 ♥ 收藏你喜欢的画面";
  }

  /* ---------- Lightbox ---------- */
  var cur = 0;
  var imgEl = $("#lbImg"), capEl = $("#lbCap"), countEl = $("#lbCount");

  function show(n) {
    if (!list.length) return;
    cur = (n + list.length) % list.length;
    var g = list[cur];
    imgEl.src = TRAVEL.SCENES_BASE + g.src;
    imgEl.alt = g.title;
    capEl.innerHTML = g.title + '<small>📍 ' + g.note + ' · ' + g.cat + '</small>';
    countEl.textContent = (cur + 1) + " / " + list.length;
  }
  function openLB(n) {
    show(n);
    lightbox.classList.add("on");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeLB() {
    lightbox.classList.remove("on");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  /* ---------- 事件 ---------- */
  chips.addEventListener("click", function (e) {
    var c = e.target.closest("[data-cat]");
    if (!c) return;
    stateCat = c.dataset.cat;
    renderChips();
    render(false);
  });

  /* 点击缩略图打开灯箱；♥ 按钮不触发 */
  masonry.addEventListener("click", function (e) {
    if (e.target.closest(".g-like")) return;
    var fig = e.target.closest(".g-item");
    if (fig) openLB(+fig.dataset.i);
  });

  $("#lbClose").addEventListener("click", closeLB);
  $("#lbPrev").addEventListener("click", function () { show(cur - 1); });
  $("#lbNext").addEventListener("click", function () { show(cur + 1); });

  document.addEventListener("keydown", function (e) {
    if (!lightbox.classList.contains("on")) return;
    if (e.key === "Escape") closeLB();
    if (e.key === "ArrowLeft") show(cur - 1);
    if (e.key === "ArrowRight") show(cur + 1);
  });

  /* 点击灯箱暗区关闭 */
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) closeLB();
  });

  /* ---------- chips ---------- */
  function renderChips() {
    var cats = ["全部"].concat(TRAVEL.cats);
    chips.innerHTML = cats.map(function (c) {
      return '<button class="chip' + (c === stateCat ? " on" : "") + '" data-cat="' + c + '">' + c + '</button>';
    }).join("");
  }

  renderChips();
  render(true);   /* 首次渲染，带出场动画 */
})();
