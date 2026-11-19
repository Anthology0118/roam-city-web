import { useEffect, useState } from "react";

interface GalleryItem {
  src: string;
  cat: string;
  title: string;
  note: string;
  likes: number;
}

const ITEMS: GalleryItem[] = [
  { src: "guilin.jpg", cat: "自然山水", title: "桂林漓江峰林", note: "广西阳朔 · 喀斯特画卷", likes: 2264 },
  { src: "jiuzhaigou.jpg", cat: "自然山水", title: "九寨沟五花海", note: "四川阿坝 · 钙华彩池", likes: 3488 },
  { src: "chaka.jpg", cat: "自然山水", title: "茶卡天空之镜", note: "青海海西 · 盐湖倒影", likes: 2810 },
  { src: "zhangjiajie.jpg", cat: "自然山水", title: "张家界武陵源", note: "湖南张家界 · 奇峰云海", likes: 1987 },
  { src: "huangshan.jpg", cat: "自然山水", title: "黄山云海奇松", note: "安徽黄山 · 天都奇观", likes: 2640 },
  { src: "danxia.jpg", cat: "自然山水", title: "张掖七彩丹霞", note: "甘肃张掖 · 丝路大地调色盘", likes: 2150 },
  { src: "daocheng.jpg", cat: "自然山水", title: "稻城亚丁牛奶海", note: "四川甘孜 · 川西雪山秘境", likes: 2930 },
  { src: "changbaishan.jpg", cat: "自然山水", title: "长白山天池", note: "吉林延边 · 火山雪峰蓝宝石", likes: 1845 },
  { src: "westlake.jpg", cat: "人文历史", title: "杭州西湖十景", note: "浙江杭州 · 湖光山色", likes: 2733 },
  { src: "gugong.jpg", cat: "人文历史", title: "紫禁城皇家宫苑", note: "北京中轴线 · 景山俯瞰", likes: 4045 },
  { src: "potala.jpg", cat: "人文历史", title: "拉萨布达拉宫", note: "西藏拉萨 · 雪域红白宫堡", likes: 3890 },
  { src: "terracotta.jpg", cat: "人文历史", title: "秦始皇兵马俑", note: "陕西西安 · 大秦地下军阵", likes: 3120 },
  { src: "mogaoku.jpg", cat: "人文历史", title: "敦煌莫高窟九层楼", note: "甘肃敦煌 · 千年丝路艺术", likes: 2580 },
  { src: "xian.jpg", cat: "人文历史", title: "长安古城墙", note: "陕西西安 · 永宁门城垣", likes: 1966 },
  { src: "yellowcrane.jpg", cat: "人文历史", title: "武汉黄鹤楼", note: "湖北武汉 · 江城千古名楼", likes: 1820 },
  { src: "harbinice.jpg", cat: "人文历史", title: "哈尔滨冰雪大世界", note: "黑龙江哈尔滨 · 琉璃冰雕奇观", likes: 2790 },
  { src: "lijiang.jpg", cat: "古城古镇", title: "丽江大研古城", note: "云南丽江 · 雪山下的青瓦古镇", likes: 2392 },
  { src: "wuzhen.jpg", cat: "古城古镇", title: "乌镇西栅水乡", note: "浙江桐乡 · 江南枕水人家", likes: 2618 },
  { src: "hongcun.jpg", cat: "古城古镇", title: "皖南水墨宏村", note: "安徽黄山 · 月沼白墙黛瓦", likes: 2450 },
  { src: "fenghuang.jpg", cat: "古城古镇", title: "湘西凤凰吊脚楼", note: "湖南湘西 · 沱江烟雨风情", likes: 2110 },
  { src: "kashgar.jpg", cat: "古城古镇", title: "喀什老城风情", note: "新疆喀什 · 丝路百年茶馆", likes: 1940 },
  { src: "sanya.jpg", cat: "海岛海滨", title: "三亚亚龙湾", note: "海南三亚 · 碧海银沙椰林", likes: 2934 },
  { src: "gulangyu.jpg", cat: "海岛海滨", title: "厦门琴岛鼓浪屿", note: "福建厦门 · 万国建筑博览", likes: 2120 },
  { src: "qingdao.jpg", cat: "海岛海滨", title: "青岛栈桥海湾", note: "山东青岛 · 红瓦绿树碧海", likes: 1889 },
];

const CATS = ["全部", "自然山水", "人文历史", "古城古镇", "海岛海滨"];

export function GalleryView() {
  const [cat, setCat] = useState("全部");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [likedSet, setLikedSet] = useState<Record<string, boolean>>({});

  const visible = cat === "全部" ? ITEMS : ITEMS.filter((i) => i.cat === cat);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lightboxIdx === null) return;
      if (e.key === "Escape") setLightboxIdx(null);
      else if (e.key === "ArrowRight") setLightboxIdx((i) => (i === null ? null : (i + 1) % visible.length));
      else if (e.key === "ArrowLeft")
        setLightboxIdx((i) => (i === null ? null : (i - 1 + visible.length) % visible.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, visible.length]);

  const activeItem = lightboxIdx !== null ? visible[lightboxIdx] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="hero-banner">
        <h1>山河实景视觉图集 · 24 帧高光印记</h1>
        <p>
          精选中国自然奇观、千年人文古迹、水墨古镇与海岸风光实景影像；支持分类过滤与键盘方向键（← / → / Esc）全屏灯箱沉浸浏览。
        </p>
      </div>

      <div className="panel">
        <div className="chips" style={{ marginBottom: 0 }}>
          {CATS.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${cat === c ? "active" : ""}`}
              onClick={() => {
                setCat(c);
                setLightboxIdx(null);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="card-grid">
        {visible.map((item, idx) => {
          const liked = !!likedSet[item.src];
          return (
            <article className="spot-card" key={item.src} style={{ cursor: "pointer" }}>
              <div className="spot-media" onClick={() => setLightboxIdx(idx)}>
                <img src={`/scenes/${item.src}`} alt={item.title} loading="lazy" />
                <div className="spot-media-overlay" />
                <div className="spot-media-top">
                  <span className="spot-glass-badge">{item.cat}</span>
                </div>
                <div className="spot-media-bottom">
                  <span>📍 {item.note}</span>
                </div>
              </div>
              <div className="spot-card-body" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontSize: "1.06rem" }} onClick={() => setLightboxIdx(idx)}>
                    {item.title}
                  </h3>
                  <button
                    type="button"
                    className="chip"
                    style={{
                      padding: "3px 10px",
                      fontSize: "0.78rem",
                      color: liked ? "#e11d48" : undefined,
                      borderColor: liked ? "#fda4af" : undefined,
                      background: liked ? "#fff1f2" : undefined,
                    }}
                    onClick={() => setLikedSet((prev) => ({ ...prev, [item.src]: !prev[item.src] }))}
                  >
                    ♥ {item.likes + (liked ? 1 : 0)}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {activeItem && (
        <div className="modal-backdrop" onClick={() => setLightboxIdx(null)}>
          <div className="modal-card" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
            <img
              src={`/scenes/${activeItem.src}`}
              alt={activeItem.title}
              style={{ width: "100%", maxHeight: 500, objectFit: "cover", display: "block" }}
            />
            <div
              style={{
                padding: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3 style={{ fontSize: "1.2rem" }}>{activeItem.title}</h3>
                <div style={{ fontSize: "0.88rem", color: "var(--ink-soft)", marginTop: 2 }}>
                  {activeItem.cat} · {activeItem.note} · 支持方向键 ← / → 切换，Esc 关闭
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() =>
                    setLightboxIdx((i) => (i === null ? null : (i - 1 + visible.length) % visible.length))
                  }
                >
                  ← 上一张
                </button>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setLightboxIdx((i) => (i === null ? null : (i + 1) % visible.length))}
                >
                  下一张 →
                </button>
                <button className="btn btn-primary" type="button" onClick={() => setLightboxIdx(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
