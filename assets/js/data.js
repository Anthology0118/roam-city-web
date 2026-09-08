/* =============================================================
   「漫游城市 · CityRoam」数据文件
   作用：集中存放全站内容数据（景点 / 轮播 / 路线 / 攻略 / 图集等），
         各页面 JS 从这里读取并渲染 DOM。
   说明：不使用 JSON 文件而用 JS 全局对象，是为了让项目在本地
         file:// 协议下双击即可运行（fetch 读取本地 JSON 会被浏览器拦截）。
   ============================================================= */

window.TRAVEL = (function () {

  /* ---- 1. 景区列表（首页卡片 / 景点页共用） ---- */
  var SCENES_BASE = "assets/images/scenes/";

  var spots = [
    { id: "guilin",      name: "桂林 · 漓江",   en: "Guilin Li River",   city: "广西桂林",   cat: "自然山水", rating: 4.9, price: 260, days: "1天",  views: 98600, scene: "guilin.svg",      desc: "舟行碧波上，人在画中游。喀斯特峰林倒映漓江，乘竹筏赏山水甲天下。", tags: ["喀斯特峰林", "竹筏漂流", "摄影胜地"] },
    { id: "zhangjiajie", name: "张家界 · 武陵源", en: "Zhangjiajie",      city: "湖南张家界", cat: "自然山水", rating: 4.8, price: 248, days: "2天",  views: 83200, scene: "zhangjiajie.svg", desc: "三千奇峰拔地而起，《阿凡达》悬浮山的灵感原型，云雾缭绕宛如仙境。", tags: ["奇峰云海", "玻璃栈道", "国家森林公园"] },
    { id: "jiuzhaigou",  name: "九寨沟",          en: "Jiuzhaigou Valley", city: "四川阿坝",   cat: "自然山水", rating: 5.0, price: 335, days: "1天",  views: 102400, scene: "jiuzhaigou.svg", desc: "翠海、叠瀑、彩林、雪峰、藏情五绝俱全，是名副其实的『人间仙境』。", tags: ["钙华彩池", "五花海", "藏族风情"] },
    { id: "chaka",       name: "茶卡盐湖",        en: "Chaka Salt Lake",  city: "青海海西",   cat: "自然山水", rating: 4.6, price: 160, days: "1天",  views: 60100, scene: "chaka.svg",       desc: "天空之镜，湖面如镜倒映蓝天白云与雪山，穿红衣拍倒影超出片。", tags: ["天空之镜", "小火车", "星空观测"] },
    { id: "westlake",    name: "杭州 · 西湖",     en: "West Lake",        city: "浙江杭州",   cat: "人文历史", rating: 4.9, price: 0,   days: "1天",  views: 110000, scene: "westlake.svg",   desc: "欲把西湖比西子，淡妆浓抹总相宜。十景环绕，四季皆有风情。", tags: ["苏堤春晓", "雷峰塔", "断桥残雪"] },
    { id: "gugong",      name: "北京 · 故宫",     en: "The Forbidden City", city: "北京",     cat: "人文历史", rating: 4.9, price: 60,  days: "1天",  views: 120800, scene: "gugong.svg",     desc: "六百年紫禁城，红墙金瓦，穿越明清两朝感受皇家气象。", tags: ["明清宫苑", "红墙金瓦", "纪录片同款"] },
    { id: "xian",        name: "西安 · 古城墙",   en: "Xi'an City Wall",  city: "陕西西安",   cat: "人文历史", rating: 4.8, price: 80,  days: "半天", views: 78800, scene: "xian.svg",       desc: "现存最完整的古代城垣，入夜灯笼亮起，骑行城墙看长安灯火。", tags: ["明城墙", "城墙骑行", "夜景"] },
    { id: "lijiang",     name: "丽江古城",        en: "Lijiang Old Town", city: "云南丽江",   cat: "古城古镇", rating: 4.7, price: 100, days: "2天",  views: 90300, scene: "lijiang.svg",    desc: "纳西族小桥流水人家，青瓦木楼与雪山相依，夜色里的民谣最动听。", tags: ["纳西文化", "四方街", "民宿"] },
    { id: "wuzhen",      name: "乌镇 · 西栅",     en: "Wuzhen",           city: "浙江桐乡",   cat: "古城古镇", rating: 4.5, price: 150, days: "1天",  views: 66000, scene: "wuzhen.svg",     desc: "江南枕水人家，摇橹船穿过石桥，晨昏的水乡都温柔得不像话。", tags: ["枕水人家", "摇橹船", "蓝印花布"] },
    { id: "sanya",       name: "三亚 · 亚龙湾",   en: "Sanya Yalong Bay", city: "海南三亚",   cat: "海岛海滨", rating: 4.8, price: 0,   days: "3天",  views: 97000, scene: "sanya.svg",      desc: "碧海银沙椰风，『东方夏威夷』，潜水冲浪发呆一次满足。", tags: ["椰林沙滩", "潜水", "海鲜"] },
    { id: "gulangyu",    name: "厦门 · 鼓浪屿",   en: "Gulangyu Island",  city: "福建厦门",   cat: "海岛海滨", rating: 4.6, price: 90,  days: "1天",  views: 71000, scene: "gulangyu.svg",  desc: "万国建筑博览的琴岛，海浪、钢琴与老别墅，适合慢悠悠散步。", tags: ["万国建筑", "钢琴之岛", "文艺小岛"] }
  ];

  /* ---- 2. 首页大图焦点轮播 ---- */
  var slides = [
    { id: "guilin",      kicker: "山水甲天下", title: "桂林漓江 · 竹筏轻舟入画", desc: "乘一叶竹筏，看喀斯特峰林缓缓在江面铺开，体验“人在画中游”。", scene: "guilin.svg" },
    { id: "jiuzhaigou",  kicker: "人间仙境",   title: "九寨沟 · 九月的层林尽染", desc: "十月的九寨沟是上帝打翻的调色盘，五花海倒影迷离梦幻。", scene: "jiuzhaigou.svg" },
    { id: "gugong",      kicker: "千年古都",   title: "北京故宫 · 一入宫门深似海", desc: "漫步六百年紫禁城中轴线，看红墙映雪、琉璃生辉。", scene: "gugong.svg" },
    { id: "chaka",       kicker: "天空之镜",   title: "茶卡盐湖 · 天空跌落进湖面", desc: "赤脚踩上盐滩，云朵与雪山在脚下翻涌，随手一拍就是大片。", scene: "chaka.svg" },
    { id: "sanya",       kicker: "热带海岛",   title: "三亚 · 把夏天还给大海", desc: "椰林、白沙、晚霞与海鲜，不出国门享受热带度假氛围。", scene: "sanya.svg" }
  ];

  /* ---- 3. 统计数字（数字滚动动画） ---- */
  var stats = [
    { num: 128, suffix: "个", label: "精选目的地" },
    { num: 860, suffix: "万", label: "旅友累计出行" },
    { num: 4200, suffix: "+", label: "条真实点评" },
    { num: 24, suffix: "h", label: "贴心旅行顾问" }
  ];

  /* ---- 4. 经典路线 Tab ---- */
  var routes = [
    {
      key: "gui", name: "漓江·山水精华线", days: "3天2晚",
      stops: [
        { day: "D1", txt: "桂林市区 · 象鼻山 / 两江四湖夜游" },
        { day: "D2", txt: "漓江竹筏精华段 → 阳朔西街" },
        { day: "D3", txt: "十里画廊骑行 → 遇龙河 · 返程" }
      ]
    },
    {
      key: "xi", name: "江南·水乡古镇线", days: "4天3晚",
      stops: [
        { day: "D1", txt: "杭州西湖十景环湖一日" },
        { day: "D2", txt: "乌镇西栅 · 夜宿枕水人家" },
        { day: "D3", txt: "南浔 / 周庄二选一慢逛" },
        { day: "D4", txt: "杭州西溪湿地 → 返程" }
      ]
    },
    {
      key: "yu", name: "海南·海岛度假线", days: "5天4晚",
      stops: [
        { day: "D1", txt: "三亚抵达 · 亚龙湾沙滩日落" },
        { day: "D2", txt: "蜈支洲岛潜水一日" },
        { day: "D3", txt: "免税店买买买 + 海鲜市场" },
        { day: "D4", txt: "椰梦长廊骑行 · 游艇出海" },
        { day: "D5", txt: "自由活动 → 返程" }
      ]
    }
  ];

  /* ---- 5. 旅友评价 ---- */
  var testimonials = [
    { name: "林小满", role: "自由行爱好者 · 深圳", color: "#17a2a8", text: "网站里的攻略太实用了！漓江竹筏那段避坑提示帮我省了四百块，截图按路线走完全不迷路，九张图都发不下。" },
    { name: "陈默",   role: "摄影博主 · 成都",   color: "#f2601e", text: "图集质量很高，茶卡盐湖的机位时间写得很清楚。按推荐的时间去拍到了镜面效果，张张都是壁纸，已安利给整个摄影群。" },
    { name: "苏苏妈", role: "亲子游家长 · 上海", color: "#126e72", text: "三亚亲子路线节奏安排得刚好，不会赶行程，孩子玩得开心。门票预约在手机上操作也很方便，实名信息一次填好。" },
    { name: "阿哲",   role: "大学生 · 武汉",     color: "#b07d12", text: "预算友好的穷游方案对我这种学生党太友好了！乌镇+西湖三天两晚人均不到一千，评论区还有同好组队，体验感满分。" }
  ];

  /* ---- 6. 图集数据 ---- */
  var galleryImages = [
    { src: "guilin.svg",      cat: "自然山水", title: "漓江竹筏",       note: "阳朔兴坪段", likes: 1264 },
    { src: "jiuzhaigou.svg",  cat: "自然山水", title: "九寨五花海",     note: "四川阿坝",   likes: 1488 },
    { src: "chaka.svg",       cat: "自然山水", title: "茶卡天空之镜",   note: "青海海西",   likes: 2210 },
    { src: "zhangjiajie.svg", cat: "自然山水", title: "张家界云海",     note: "袁家界",     likes: 987 },
    { src: "westlake.svg",    cat: "人文历史", title: "西湖晨雾",       note: "断桥残雪",   likes: 1733 },
    { src: "gugong.svg",      cat: "人文历史", title: "紫禁城雪景",     note: "北京中轴线", likes: 3045 },
    { src: "xian.svg",        cat: "人文历史", title: "长安灯火",       note: "西安古城墙", likes: 1966 },
    { src: "lijiang.svg",     cat: "古城古镇", title: "丽江慢时光",     note: "四方街夜色", likes: 1392 },
    { src: "wuzhen.svg",      cat: "古城古镇", title: "乌镇枕水人家",   note: "西栅清晨",   likes: 1618 },
    { src: "sanya.svg",       cat: "海岛海滨", title: "亚龙湾落日",     note: "海南三亚",   likes: 2334 },
    { src: "gulangyu.svg",    cat: "海岛海滨", title: "琴岛鼓浪屿",     note: "福建厦门",   likes: 1120 },
    { src: "hero-city.svg",   cat: "海岛海滨", title: "山海之夜",       note: "湾区夜色",   likes: 1589 }
  ];

  /* ---- 7. 攻略文章 ---- */
  var guides = [
    {
      id: "lj", title: "丽江&大理 3 日自由行攻略 · 学生党穷游版", date: "2026-06-12", views: 12400,
      thumb: "lijiang.svg", hero: "lijiang.svg", cat: "穷游",
      intro: "丽江不是一个走马观花的地方，慢下来才有味道。这份攻略把交通、住宿、门票和避坑全部拆开讲，全程人均预算约 1200 元。",
      sections: [
        { h: "出行前准备", blocks: [
          { p: "最佳季节为 4-6 月与 9-11 月，天气晴好且游客相对较少。务必提前预订古城区客栈，旺季（节假日）价格翻倍仍一房难求。" },
          { tips: ["提前下载离线地图（古城内小路多）", "带好防晒霜与墨镜，高原紫外线强", "身份证随身携带，进古城部分小景点需查验"] }
        ]},
        { h: "交通方式怎么选", blocks: [
          { p: "飞抵丽江三义机场后，可乘机场大巴（20元）进市区，再打车（约10元）到古城口。从丽江到大理推荐乘动车，最快 1 小时出头。" },
          { table: { head: ["方式", "耗时", "参考价", "推荐度"], rows: [["机场大巴", "约50分钟", "20元", "★★★★"], ["滴滴打车", "约35分钟", "70元", "★★★"], ["包车直达", "约40分钟", "120元", "★★"] ] } }
        ]},
        { h: "住宿与美食清单", blocks: [
          { p: "预算有限首选古城外围的客栈，比核心区便宜 30% 且安静。美食一定别错过鸡豆凉粉、腊排骨火锅和纳西烤肉，别在四方街主街吃（贵且普通）。" },
          { note: "注意：古城内部分“网红餐厅”可以刷好评，建议看本地人排队多的小店，用点评排序按“人均从低到高”筛选更靠谱。" }
        ]},
        { h: "预算明细参考", blocks: [
          { table: { head: ["项目", "金额(元)", "备注"], rows: [["往返高铁", "约500", "按出发地浮动"], ["住宿 2 晚", "约260", "古城外围客栈"], ["门票合计", "约180", "含古城维护费"], ["餐饮 3 天", "约300", "小吃为主"], ["合计", "约1240", "人均参考"] ] } }
        ]}
      ]
    },
    {
      id: "sanya", title: "三亚亲子 5 日游 · 带娃不累的海岛指南", date: "2026-07-03", views: 9860,
      thumb: "sanya.svg", hero: "sanya.svg", cat: "亲子",
      intro: "带娃出门最怕“赶行程”。这条路线每天只安排一个大项，午睡自由、沙滩自由，妈妈也能躺平度假。",
      sections: [
        { h: "Day 1 抵达与适应", blocks: [
          { p: "下午抵达三亚，入住亚龙湾酒店。傍晚带孩子去沙滩堆城堡，看落日，让节奏慢下来。" }
        ]},
        { h: "Day 2 蜈支洲岛亲子潜水", blocks: [
          { p: "提前一天在官方小程序购票可省 20 元。岛上设有儿童浅水区，教练一对一带潜，6 岁以上就能玩。全程约半天，下午回酒店午休。" },
          { note: "一定要给孩子带泳镜和防寒泳衣，岛上租借不便宜且码数不全。" }
        ]},
        { h: "Day 3 免税与海鲜", blocks: [
          { p: "上午逛免税城（提前做攻略领券，可省大几百），中午去本地海鲜市场现买现加工，带娃看海胆和龙虾也是一种“自然课”。" }
        ]},
        { h: "出行安全贴士", blocks: [
          { tips: ["防晒霜每 2 小时补涂一次", "沙滩活动避开正午 12-15 点", "水上项目务必选持证经营场所，看有无救生员"] }
        ]}
      ]
    },
    {
      id: "qing", title: "青海湖+茶卡 4 日 · 拍出天空之镜", date: "2026-08-20", views: 11200,
      thumb: "chaka.svg", hero: "chaka.svg", cat: "摄影",
      intro: "大西北的辽阔是镜头装不下的，但总有几个瞬间值得定格。这篇专为摄影爱好者写的机位与时间攻略，请收好。",
      sections: [
        { h: "黄金时间表", blocks: [
          { table: { head: ["时间段", "机位建议", "说明"], rows: [["6:00-8:00", "青海湖东岸", "日出剪影，游客最少"], ["13:00-15:00", "茶卡湖心", "正午光线最强，倒影最清晰"], ["19:00-20:30", "湖西岸", "日落染金，出氛围大片"] ] } }
        ]},
        { h: "摄影装备清单", blocks: [
          { tips: ["偏振镜 CPF：压暗水面反光", "三脚架必备，盐湖风大", "穿亮色（红/黄）服装，倒影对比更强", "无人机需提前报备"] }
        ]},
        { h: "必须知道的坑", blocks: [
          { p: "茶卡盐湖对天气要求极高：只有“无风+晴天+水位浅”三条件齐备才有镜面效果。出发前看准预报，否则大概率拍到一片浑浊的盐滩。" },
          { note: "晴天判断小技巧：看预报风速 < 3m/s、云量 < 30% 再冲，命中率会高很多。" }
        ]}
      ]
    }
  ];

  /* ---- 8. 常见问题 FAQ ---- */
  var faqs = [
    { q: "门票需要提前多久预约？", a: "热门景区（故宫、九寨沟等）建议提前 7 天在官方渠道预约；一般景区提前 1-3 天即可。本站首页与景点详情页均可一键跳转预约表单。" },
    { q: "临时有事可以取消订单吗？", a: "可以。在「门票预约」页的“我的订单”中点击取消即可；预约成功后 2 小时内取消不收取手续费。" },
    { q: "学生证 / 老年证有优惠吗？", a: "绝大多数景区对学生（全日制本科及以下）、60 岁以上老人实行半价或免票，请在入园时出示有效证件。" },
    { q: "页面数据会保存到哪里？", a: "收藏、订单与留言保存在你浏览器本地的 localStorage 中，关闭页面后依然存在，仅用于演示，不会上传到任何服务器。" },
    { q: "为什么部分预览图是插画风格？", a: "为了离线也能完美展示、避免网络图片加载失败，本站使用了本地矢量插画作为景区主图，答辩时也可现场演示。" }
  ];

  /* ---- 9. 根据 id 查找景点 ---- */
  function spotById(id) {
    for (var i = 0; i < spots.length; i++) {
      if (spots[i].id === id) return spots[i];
    }
    return null;
  }

  return {
    SCENES_BASE: SCENES_BASE,
    spots: spots,
    slides: slides,
    stats: stats,
    routes: routes,
    testimonials: testimonials,
    galleryImages: galleryImages,
    guides: guides,
    faqs: faqs,
    spotById: spotById,
    cats: ["自然山水", "人文历史", "古城古镇", "海岛海滨"]
  };
})();
