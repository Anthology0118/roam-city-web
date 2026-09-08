/* =============================================================
   「漫游城市」门票预约页脚本 booking.js
   职责：
     1. 渲染景区下拉 / 快捷日期
     2. 人数步进器 + 实时计价
     3. 完整的表单校验（姓名/手机/身份证/邮箱 正则）
     4. 提交后生成订单 → 存入 localStorage，右侧订单列表可“取消”
   ============================================================= */
(function () {
  "use strict";

  var TRAVEL = window.TRAVEL;
  if (!TRAVEL) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var ORDER_KEY = "roam_orders_v1";

  var fSpot = $("#fSpot"), fDate = $("#fDate"), fSession = $("#fSession"), fType = $("#fType");
  var fCount = 1;
  var dateChips = $("#dateChips");

  /* ---------- 工具 ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fmtCN(d) {
    var week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + week;
  }
  function nowStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
           pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch (e) { return []; }
  }
  function writeOrders(list) { localStorage.setItem(ORDER_KEY, JSON.stringify(list)); }

  /* ---------- 单价 / 总额 ---------- */
  function currentUnit() {
    var s = TRAVEL.spotById(fSpot.value);
    if (!s) return 0;
    var rate = parseFloat(fType.options[fType.selectedIndex].dataset.rate || "1");
    return Math.round(s.price * rate);
  }
  function refreshSum() {
    var unit = currentUnit();
    var total = unit * fCount;
    $("#sumUnit").textContent = "¥" + unit;
    $("#sumCount").textContent = fCount;
    $("#sumTotal").textContent = "¥" + total.toLocaleString();
  }

  /* 步进器：数量限制 1 - 9 */
  function setCount(n) {
    fCount = Math.min(9, Math.max(1, n));
    $("#fCountOut").textContent = fCount;
    clearErr("eCount");
    refreshSum();
  }

  /* ---------- 渲染景区下拉 ---------- */
  function renderSpotSelect() {
    var html = TRAVEL.spots.map(function (s) {
      return '<option value="' + s.id + '" data-price="' + s.price + '">' +
        s.name + "（¥" + s.price + (s.price === 0 ? " 免费" : " 起") + "）</option>";
    }).join("");
    fSpot.innerHTML = html;
    /* 从其它页面跳转携带 ?spot=xxx 时自动选中 */
    var want = new URLSearchParams(location.search).get("spot");
    if (want && TRAVEL.spotById(want)) fSpot.value = want;
  }

  /* ---------- 快捷日期 chips ---------- */
  function renderDateChips() {
    var today = new Date();
    /* 取“未来第一个周六”作为周末档：今天恰好是周六则顺延到下周 */
    var diff = (6 - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    var sat = new Date(+today + diff * 86400000);

    var items = [
      { label: "今天", d: new Date(today) },
      { label: "明天", d: new Date(+today + 86400000) },
      { label: "后天", d: new Date(+today + 2 * 86400000) },
      { label: "本周末", d: new Date(sat) }
    ];
    dateChips.innerHTML = items.map(function (it) {
      return '<button type="button" class="date-chip" data-val="' + iso(it.d) + '">' +
        '<b>' + it.label + '</b>' + fmtCN(it.d).split(" ")[0] + '</button>';
    }).join("");
  }

  /* ---------- 订单列表 ---------- */
  function renderOrders() {
    var orders = readOrders();
    var box = $("#orderList");
    $("#orderCount").textContent = orders.length ? "（共 " + orders.length + " 笔）" : "";

    var active = orders.filter(function (o) { return o.status === "ok"; });
    var totalMoney = active.reduce(function (s, o) { return s + o.total; }, 0);
    $("#orderTotal").textContent = totalMoney ? "合计 ¥" + totalMoney.toLocaleString() : "";

    if (!orders.length) {
      box.innerHTML = '<div class="order-empty"><span class="emoji">🧾</span>还没有订单<br>先在左侧预约一单试试吧～</div>';
      return;
    }
    box.innerHTML = orders.map(function (o, idx) {
      var cancelled = o.status === "cancel";
      return (
        '<div class="order-item">' +
          '<div class="o-top">' +
            '<div><div class="o-name">' + o.spotName + '</div>' +
            '<div class="o-id">订单号 ' + o.id + ' · 下单于 ' + o.time + '</div></div>' +
            '<div class="o-total">¥' + o.total.toLocaleString() + '</div>' +
          '</div>' +
          '<div class="o-row">' +
            '<span>🗓 ' + o.date + '</span>' +
            '<span>🕘 ' + o.session + '</span>' +
            '<span>🎫 ' + o.type + ' × ' + o.count + '</span>' +
            '<span>👤 ' + o.name + ' · ' + o.phone + '</span>' +
          '</div>' +
          '<span class="o-status ' + (cancelled ? "cancel" : "ok") + '">' + (cancelled ? "已取消" : "预约成功") + '</span>' +
          (cancelled
            ? '<button class="btn-cancel" data-del="' + idx + '">🗑 删除记录</button>'
            : '<button class="btn-cancel" data-cancel="' + idx + '">取消预约</button>') +
        '</div>'
      );
    }).join("");
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    /* 人数步进（1 - 9） */
    $("#fMinus").addEventListener("click", function () { setCount(fCount - 1); });
    $("#fPlus").addEventListener("click", function () { setCount(fCount + 1); });

    /* 计价联动 */
    fSpot.addEventListener("change", refreshSum);
    fType.addEventListener("change", refreshSum);

    /* 快捷日期 */
    dateChips.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-val]");
      if (!chip) return;
      fDate.value = chip.dataset.val;
      Array.prototype.forEach.call(dateChips.children, function (c) { c.classList.remove("on"); });
      chip.classList.add("on");
      clearErr("eDate");
    });

    /* 输入时即时清除错误样式 */
    $("#bkForm").addEventListener("input", function (e) {
      var map = {
        fName: "eName", fPhone: "ePhone", fId: "eId", fEmail: "eEmail",
        fDate: "eDate", fSpot: "eSpot", fAgree: "eAgree"
      };
      if (map[e.target.id]) clearErr(map[e.target.id]);
    });

    /* 提交 */
    $("#bkForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (validate()) submitOrder();
    });

    /* 订单取消 / 删除（事件委托） */
    $("#orderList").addEventListener("click", function (e) {
      var cancelBtn = e.target.closest("[data-cancel]");
      var delBtn = e.target.closest("[data-del]");
      var orders = readOrders();
      if (cancelBtn) {
        orders[+cancelBtn.dataset.cancel].status = "cancel";
        writeOrders(orders);
        renderOrders();
        window.toast && window.toast("已取消该笔预约", "");
      }
      if (delBtn) {
        orders.splice(+delBtn.dataset.del, 1);
        writeOrders(orders);
        renderOrders();
        window.toast && window.toast("记录已删除", "");
      }
    });

    /* 清空重填 */
    $("#bkForm").addEventListener("reset", function () {
      setTimeout(function () {
        fDate.value = iso(new Date());
        setCount(1);
        refreshSum();
        Array.prototype.forEach.call(dateChips.children, function (c) { c.classList.remove("on"); });
      }, 0);
    });

    $("#againBtn").addEventListener("click", function () {
      $("#bkSuccess").style.display = "none";
      $("#bkFields").style.display = "";
      $("#bkForm").reset();
      refreshSum();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- 校验 ---------- */
  function fail(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; }
    return false;
  }
  function clearErr(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = "";
  }

  function validate() {
    var ok = true;
    /* 景区 */
    if (!fSpot.value) ok = fail("eSpot", "请选择要预约的景区");
    /* 日期 */
    var today = iso(new Date());
    if (!fDate.value) ok = fail("eDate", "请选择游玩日期") && ok;
    else if (fDate.value < today) ok = fail("eDate", "不能预约过去的日期") && ok;
    else clearErr("eDate");
    /* 姓名 */
    var name = $("#fName").value.trim();
    if (!name) ok = fail("eName", "请填写出行人姓名") && ok;
    else if (!/^[一-龥A-Za-z·\s]{2,20}$/.test(name)) ok = fail("eName", "姓名需 2-20 位中英文") && ok;
    else clearErr("eName");
    /* 手机号 */
    var phone = $("#fPhone").value.trim();
    if (!phone) ok = fail("ePhone", "请填写手机号码") && ok;
    else if (!/^1[3-9]\d{9}$/.test(phone)) ok = fail("ePhone", "手机号格式不正确（应为 1 开头的 11 位数字）") && ok;
    else clearErr("ePhone");
    /* 身份证（选填但需格式正确） */
    var idc = $("#fId").value.trim();
    if (idc && !/^\d{17}[\dXx]$/.test(idc)) ok = fail("eId", "身份证应为 18 位（末位可为 X）") && ok;
    else clearErr("eId");
    /* 邮箱（选填） */
    var mail = $("#fEmail").value.trim();
    if (mail && !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(mail)) ok = fail("eEmail", "邮箱格式不正确") && ok;
    else clearErr("eEmail");
    /* 数量 */
    if (fCount < 1 || fCount > 9) ok = fail("eCount", "数量需在 1 - 9 张之间") && ok;
    else clearErr("eCount");
    /* 勾选 */
    if (!$("#fAgree").checked) ok = fail("eAgree", "请先阅读并勾选《预约须知》") && ok;
    else clearErr("eAgree");

    /* 失败时把输入框标红 */
    var inputs = { fSpot: "eSpot", fDate: "eDate", fName: "eName", fPhone: "ePhone", fId: "eId", fEmail: "eEmail" };
    for (var k in inputs) {
      var errText = document.getElementById(inputs[k]).textContent;
      var inp = document.getElementById(k);
      if (k === "fSpot") inp.classList.toggle("err", !!errText);
      else if (k === "fDate") inp.classList.toggle("err", !!errText);
      else inp.classList.toggle("err", !!errText);
    }
    return ok;
  }

  /* ---------- 提交订单 ---------- */
  function submitOrder() {
    var s = TRAVEL.spotById(fSpot.value);
    var unit = currentUnit();
    var order = {
      id: "RC" + Date.now().toString().slice(-7),
      spotId: s.id,
      spotName: s.name,
      date: fDate.value,
      session: fSession.value,
      type: fType.value,
      count: fCount,
      name: $("#fName").value.trim(),
      phone: $("#fPhone").value.trim(),
      idcard: $("#fId").value.trim(),
      email: $("#fEmail").value.trim(),
      total: unit * fCount,
      time: nowStr(),
      status: "ok"
    };
    var list = readOrders();
    list.unshift(order);
    writeOrders(list);
    renderOrders();

    /* 展示成功卡 */
    $("#bkFields").style.display = "none";
    $("#bkSuccess").style.display = "block";
    $("#successMsg").innerHTML =
      '【' + order.spotName + '】' + order.date + ' ' + order.session +
      ' · ' + order.type + '×' + order.count + '，共 <b style="color:#f2601e">¥' + order.total.toLocaleString() + '</b>' +
      '。<br>订单号 <b>' + order.id + '</b> 已存入「我的订单」，可在右侧取消。';
    window.toast && window.toast("预约成功！订单已保存", "success");
  }

  /* ---------- 启动（同步渲染） ---------- */
  renderSpotSelect();
  renderDateChips();
  fDate.min = iso(new Date());
  fDate.value = iso(new Date());
  setCount(1);
  refreshSum();
  renderOrders();
  bindEvents();
})();
