import { useEffect, useState } from "react";

interface GalleryItem {
  src: string;
  cat: string;
  title: string;
  note: string;
  likes: number;
}

const ITEMS: GalleryItem[] = [
  { src: "guilin.svg", cat: "自然山水", title: "漓江竹筏", note: "阳朔兴坪段", likes: 1264 },
  { src: "jiuzhaigou.svg", cat: "自然山水", title: "九寨五花海", note: "四川阿坝", likes: 1488 },
  { src: "chaka.svg", cat: "自然山水", title: "茶卡天空之镜", note: "青海海西", likes: 2210 },
  { src: "zhangjiajie.svg", cat: "自然山水", title: "张家界云海", note: "袁家界", likes: 987 },
  { src: "westlake.svg", cat: "人文历史", title: "西湖晨雾", note: "断桥残雪", likes: 1733 },
  { src: "gugong.svg", cat: "人文历史", title: "紫禁城雪景", note: "北京中轴线", likes: 3045 },
  { src: "xian.svg", cat: "人文历史", title: "长安灯火", note: "西安古城墙", likes: 1966 },
  { src: "lijiang.svg", cat: "古城古镇", title: "丽江慢时光", note: "四方街夜色", likes: 1392 },
  { src: "wuzhen.svg", cat: "古城古镇", title: "乌镇枕水人家", note: "西栅清晨", likes: 1618 },
  { src: "sanya.svg", cat: "海岛海滨", title: "亚龙湾落日", note: "海南三亚", likes: 2334 },
  { src: "gulangyu.svg", cat: "海岛海滨", title: "琴岛鼓浪屿", note: "福建厦门", likes: 1120 },
  { src: "hero-city.svg", cat: "海岛海滨", title: "山海之夜", note: "湾区夜色", likes: 1589 },
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
    <div>
      <div className="panel" style={{ marginBottom: 20 }}>
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
              <img
                src={`/scenes/${item.src}`}
                alt={item.title}
                loading="lazy"
                onClick={() => setLightboxIdx(idx)}
              />
              <div className="spot-card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="badge">{item.cat}</span>
                  <button
                    type="button"
                    className="chip"
                    style={{
                      padding: "2px 10px",
                      fontSize: "0.78rem",
                      color: liked ? "#d63b2f" : undefined,
                      borderColor: liked ? "#d63b2f" : undefined,
                    }}
                    onClick={() => setLikedSet((prev) => ({ ...prev, [item.src]: !prev[item.src] }))}
                  >
                    ♥ {item.likes + (liked ? 1 : 0)}
                  </button>
                </div>
                <h3 onClick={() => setLightboxIdx(idx)}>{item.title}</h3>
                <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{item.note}</div>
              </div>
            </article>
          );
        })}
      </div>

      {activeItem && (
        <div className="modal-backdrop" onClick={() => setLightboxIdx(null)}>
          <div className="modal-card" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <img
              src={`/scenes/${activeItem.src}`}
              alt={activeItem.title}
              style={{ width: "100%", height: 340, objectFit: "cover" }}
            />
            <div style={{ padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <h3>{activeItem.title}</h3>
                <div style={{ fontSize: "0.88rem", color: "var(--ink-soft)" }}>
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
                  ←
                </button>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setLightboxIdx((i) => (i === null ? null : (i + 1) % visible.length))}
                >
                  →
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
