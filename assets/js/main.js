/* =============================================================
   「漫游城市 · CityRoam」全站共享脚本
   职责：
     1. 预加载动画、粘性导航、汉堡菜单（移动端）
     2. 滚动进度条 + 回到顶部 + 视差
     3. 滚动进场动画（IntersectionObserver）
     4. 本地收藏 localStorage 工具 + Toast 轻提示 + 数字滚动
   ============================================================= */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- 本地收藏工具（景点 / 图集共用） ---------- */
  var FAV_KEY = "roam_favs_v1";
  function readFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; }
  }
  function writeFavs(list) { localStorage.setItem(FAV_KEY, JSON.stringify(list)); }

  var Roam = {
    FAV_KEY: FAV_KEY,
    /* 切换收藏，返回收藏后是否为“已收藏” */
    toggleFav: function (id) {
      var list = readFavs();
      var idx = list.indexOf(id);
      var liked;
      if (idx > -1) { list.splice(idx, 1); liked = false; }
      else { list.unshift(id); liked = true; }
      writeFavs(list);
      return liked;
    },
    isFav: function (id) { return readFavs().indexOf(id) > -1; },
    favs: function () { return readFavs(); }
  };
  window.Roam = Roam;

  /* ---------- Toast 轻提示 ---------- */
  var toastTimer;
  function toast(msg, type) {
    var el = $("#toast");
    if (!el) return;
    el.className = "show " + (type || "");
    el.innerHTML = (type === "success" ? "✔ " : type === "error" ? "✖ " : "") + msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ""; }, 2400);
  }
  window.toast = toast;

  /* ---------- 页面通用初始化 ---------- */
  function init() {
    initPreloader();
    initHeader();
    initHamburger();
    initProgressBacktop();
    initReveal();
    initCountUp();
    initParallax();
    initTyped();
    initFooterYear();
    initSmoothAnchors();
    initFavDelegation();
  }

  /* 收藏按钮事件委托：只要页面出现 data-fav 元素即可点 ♥ 收藏
     （首页卡片 / 景点页卡片 / 图集缩略图共用同一套逻辑） */
  function initFavDelegation() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-fav]") : null;
      if (!btn) return;
      var id = btn.getAttribute("data-fav");
      var liked = Roam.toggleFav(id);
      btn.classList.toggle("liked", liked);
      btn.setAttribute("aria-pressed", String(liked));
      toast(liked ? "已收藏进心愿清单 ❤" : "已从心愿清单移除", liked ? "success" : "");
      /* 通知其它模块刷新“心愿清单”计数等 */
      window.dispatchEvent(new CustomEvent("roam:favchange", { detail: { id: id, liked: liked } }));
    });
  }

  /* 预加载动画：等 window 完全加载后淡出 */
  function initPreloader() {
    var pre = $("#preloader");
    if (!pre) return;
    window.addEventListener("load", function () {
      setTimeout(function () { pre.classList.add("done"); }, 350);
    });
    /* 兜底：最长 3 秒后必定消失，避免异常情况挡住页面 */
    setTimeout(function () { if (pre) pre.classList.add("done"); }, 3000);
  }

  /* 粘性导航：滚动超过阈值时加深背景 */
  function initHeader() {
    var header = $(".site-header");
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 24);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* 移动端汉堡菜单 */
  function initHamburger() {
    var btn = $(".hamburger");
    var nav = $(".site-nav");
    if (!btn || !nav) return;
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.classList.toggle("open", open);
      document.body.classList.toggle("menu-lock", open);
    });
    /* 点击导航项后自动收起（移动端） */
    $$(".site-nav a", nav).forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        btn.classList.remove("open");
        document.body.classList.remove("menu-lock");
      });
    });
  }

  /* 滚动进度条 + 返回顶部 */
  function initProgressBacktop() {
    var bar = $("#progress");
    var topBtn = $("#backtop");
    var ticking = false;
    function onScroll() {
      var y = window.scrollY;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
      if (topBtn) topBtn.classList.toggle("show", y > 480);
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    if (topBtn) topBtn.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    onScroll();
  }

  /* 滚动进场动画：为带 .reveal 的元素加上 .in */
  function initReveal() {
    var items = $$(".reveal");
    if (!items.length || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px" });
    items.forEach(function (el) { io.observe(el); });
  }

  /* 数字滚动：元素含 data-target 与可选 data-suffix */
  function initCountUp() {
    $$("[data-target]").forEach(function (el) {
      if (!("IntersectionObserver" in window)) { el.textContent = formatNum(+el.dataset.target) + (el.dataset.suffix || ""); return; }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          io.unobserve(el);
          var target = +el.dataset.target;
          var dur = 1600;
          var t0 = performance.now();
          (function frame(now) {
            var p = Math.min(1, (now - t0) / dur);
            /* easeOutCubic，让加速更自然 */
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = formatNum(Math.round(target * eased)) + (el.dataset.suffix || "");
            if (p < 1) requestAnimationFrame(frame);
          })(t0);
        });
      }, { threshold: 0.5 });
      io.observe(el);
    });
  }

  /* 千分位格式化 */
  function formatNum(n) {
    if (n < 1000) return String(n);
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* 首屏视差：滚动时背景图与前景位移速度不同，制造纵深 */
  function initParallax() {
    var bg = $(".hero-bg");
    var content = $(".hero-content");
    var hero = $(".hero");
    if (!hero) return;
    var ticking = false;
    function onScroll() {
      var y = Math.max(0, window.scrollY);
      if (bg) bg.style.transform = "translateY(" + y * 0.32 + "px)";
      if (content) content.style.opacity = Math.max(0, 1 - y / 520);
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
  }

  /* 首页打字机文案 */
  function initTyped() {
    var host = $("#typed");
    if (!host) return;
    var phrases = [
      "在山水间，找到向往的远方",
      "把周末，过成一场说走就走的旅行",
      "收藏 128 个目的地，今天出发吗？"
    ];
    var pi = 0, ci = 0, deleting = false;
    var delay = 90;
    function tick() {
      var cur = phrases[pi];
      host.textContent = cur.slice(0, ci);
      if (!deleting) {
        if (ci < cur.length) { ci++; delay = 90; }
        else { deleting = true; delay = 2200; }
      } else {
        if (ci > 0) { ci--; delay = 42; }
        else { deleting = false; pi = (pi + 1) % phrases.length; delay = 500; }
      }
      setTimeout(tick, delay);
    }
    tick();
  }

  /* 页脚年份 */
  function initFooterYear() {
    var el = $("#year");
    if (el) el.textContent = new Date().getFullYear();
  }

  /* 页面内锚点平滑滚动 */
  function initSmoothAnchors() {
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href");
        if (id.length < 2) return;
        var target = document.querySelector(id);
        if (target) { e.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
