import json
import math
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import GuideChunk, Spot


def compute_char_ngram_embedding(text: str, dims: int = 64) -> list[float]:
    """Deterministic lightweight hash-projection embedding for zero-dependency local vector search.

    In production with an embedding API (e.g. text-embedding-3-small / bge-m3) + pgvector,
    replace this function with the external embedding call while keeping the same interface.
    """
    vec = [0.0] * dims
    cleaned = text.strip().lower()
    if not cleaned:
        return vec
    for n in (1, 2):
        for i in range(max(0, len(cleaned) - n + 1)):
            gram = cleaned[i : i + n]
            bucket = hash(gram) % dims
            vec[bucket] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


SEED_SPOTS = [
    {
        "id": "guilin", "name": "桂林 · 漓江", "en_name": "Guilin Li River", "city": "广西桂林",
        "category": "自然山水", "rating": 4.9, "price": 260, "days_label": "1天", "duration_hours": 6.0,
        "views": 98600, "scene": "guilin.svg",
        "description": "舟行碧波上，人在画中游。喀斯特峰林倒映漓江，乘竹筏赏山水甲天下。",
        "tags": ["喀斯特峰林", "竹筏漂流", "摄影胜地"], "lat": 25.2736, "lng": 110.2902, "daily_stock": 180,
    },
    {
        "id": "zhangjiajie", "name": "张家界 · 武陵源", "en_name": "Zhangjiajie", "city": "湖南张家界",
        "category": "自然山水", "rating": 4.8, "price": 248, "days_label": "2天", "duration_hours": 8.0,
        "views": 83200, "scene": "zhangjiajie.svg",
        "description": "三千奇峰拔地而起，《阿凡达》悬浮山的灵感原型，云雾缭绕宛如仙境。",
        "tags": ["奇峰云海", "玻璃栈道", "国家森林公园"], "lat": 29.3489, "lng": 110.5515, "daily_stock": 220,
    },
    {
        "id": "jiuzhaigou", "name": "九寨沟", "en_name": "Jiuzhaigou Valley", "city": "四川阿坝",
        "category": "自然山水", "rating": 5.0, "price": 335, "days_label": "1天", "duration_hours": 7.0,
        "views": 102400, "scene": "jiuzhaigou.svg",
        "description": "翠海、叠瀑、彩林、雪峰、藏情五绝俱全，是名副其实的人间仙境。",
        "tags": ["钙华彩池", "五花海", "藏族风情"], "lat": 33.2600, "lng": 103.9186, "daily_stock": 150,
    },
    {
        "id": "chaka", "name": "茶卡盐湖", "en_name": "Chaka Salt Lake", "city": "青海海西",
        "category": "自然山水", "rating": 4.6, "price": 160, "days_label": "1天", "duration_hours": 4.5,
        "views": 60100, "scene": "chaka.svg",
        "description": "天空之镜，湖面如镜倒映蓝天白云与雪山，穿红衣拍倒影超出片。",
        "tags": ["天空之镜", "小火车", "星空观测"], "lat": 36.7547, "lng": 99.0772, "daily_stock": 200,
    },
    {
        "id": "westlake", "name": "杭州 · 西湖", "en_name": "West Lake", "city": "浙江杭州",
        "category": "人文历史", "rating": 4.9, "price": 0, "days_label": "1天", "duration_hours": 5.0,
        "views": 110000, "scene": "westlake.svg",
        "description": "欲把西湖比西子，淡妆浓抹总相宜。十景环绕，四季皆有风情。",
        "tags": ["苏堤春晓", "雷峰塔", "断桥残雪", "亲子"], "lat": 30.2431, "lng": 120.1503, "daily_stock": 500,
    },
    {
        "id": "gugong", "name": "北京 · 故宫", "en_name": "The Forbidden City", "city": "北京",
        "category": "人文历史", "rating": 4.9, "price": 60, "days_label": "1天", "duration_hours": 5.5,
        "views": 120800, "scene": "gugong.svg",
        "description": "六百年紫禁城，红墙金瓦，穿越明清两朝感受皇家气象。",
        "tags": ["明清宫苑", "红墙金瓦", "纪录片同款"], "lat": 39.9163, "lng": 116.3972, "daily_stock": 120,
    },
    {
        "id": "xian", "name": "西安 · 古城墙", "en_name": "Xi'an City Wall", "city": "陕西西安",
        "category": "人文历史", "rating": 4.8, "price": 80, "days_label": "半天", "duration_hours": 3.0,
        "views": 78800, "scene": "xian.svg",
        "description": "现存最完整的古代城垣，入夜灯笼亮起，骑行城墙看长安灯火。",
        "tags": ["明城墙", "城墙骑行", "夜景"], "lat": 34.2594, "lng": 108.9470, "daily_stock": 240,
    },
    {
        "id": "lijiang", "name": "丽江古城", "en_name": "Lijiang Old Town", "city": "云南丽江",
        "category": "古城古镇", "rating": 4.7, "price": 100, "days_label": "2天", "duration_hours": 6.0,
        "views": 90300, "scene": "lijiang.svg",
        "description": "纳西族小桥流水人家，青瓦木楼与雪山相依，夜色里的民谣最动听。",
        "tags": ["纳西文化", "四方街", "民宿", "穷游"], "lat": 26.8721, "lng": 100.2330, "daily_stock": 300,
    },
    {
        "id": "wuzhen", "name": "乌镇 · 西栅", "en_name": "Wuzhen", "city": "浙江桐乡",
        "category": "古城古镇", "rating": 4.5, "price": 150, "days_label": "1天", "duration_hours": 5.0,
        "views": 66000, "scene": "wuzhen.svg",
        "description": "江南枕水人家，摇橹船穿过石桥，晨昏的水乡都温柔得不像话。",
        "tags": ["枕水人家", "摇橹船", "蓝印花布"], "lat": 30.7458, "lng": 120.4847, "daily_stock": 260,
    },
    {
        "id": "sanya", "name": "三亚 · 亚龙湾", "en_name": "Sanya Yalong Bay", "city": "海南三亚",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "3天", "duration_hours": 6.0,
        "views": 97000, "scene": "sanya.svg",
        "description": "碧海银沙椰风，东方夏威夷，潜水冲浪发呆一次满足。",
        "tags": ["椰林沙滩", "潜水", "海鲜", "亲子"], "lat": 18.2215, "lng": 109.6331, "daily_stock": 400,
    },
    {
        "id": "gulangyu", "name": "厦门 · 鼓浪屿", "en_name": "Gulangyu Island", "city": "福建厦门",
        "category": "海岛海滨", "rating": 4.6, "price": 90, "days_label": "1天", "duration_hours": 4.5,
        "views": 71000, "scene": "gulangyu.svg",
        "description": "万国建筑博览的琴岛，海浪、钢琴与老别墅，适合慢悠悠散步。",
        "tags": ["万国建筑", "钢琴之岛", "文艺小岛"], "lat": 24.4472, "lng": 118.0674, "daily_stock": 200,
    },
]

SEED_CHUNKS = [
    {
        "id": "lj-1", "guide_id": "lj", "guide_title": "丽江&大理 3 日自由行攻略 · 学生党穷游版",
        "category": "穷游", "section_title": "出行前准备",
        "content": "最佳季节为 4-6 月与 9-11 月，天气晴好且游客相对较少。务必提前预订古城区客栈，旺季价格翻倍。建议提前下载离线地图、带好防晒霜与墨镜，身份证随身携带。",
        "metadata": {"city": "丽江", "budget": 1240, "tags": ["防晒", "离线地图", "淡季"]},
    },
    {
        "id": "lj-2", "guide_id": "lj", "guide_title": "丽江&大理 3 日自由行攻略 · 学生党穷游版",
        "category": "穷游", "section_title": "交通方式怎么选",
        "content": "飞抵丽江三义机场后，推荐乘机场大巴（20元，约50分钟）进市区，性价比最高；滴滴打车约70元；包车直达约120元。从丽江到大理推荐乘动车，最快1小时出头。",
        "metadata": {"city": "丽江", "tags": ["机场大巴", "动车", "交通"]},
    },
    {
        "id": "lj-3", "guide_id": "lj", "guide_title": "丽江&大理 3 日自由行攻略 · 学生党穷游版",
        "category": "穷游", "section_title": "住宿与美食避坑",
        "content": "预算有限首选古城外围客栈，比核心区便宜30%且安静。美食推荐鸡豆凉粉、腊排骨火锅和纳西烤肉，尽量避开四方街主街高价网红餐厅，建议看本地人排队的小店，人均参考总预算约1240元。",
        "metadata": {"city": "丽江", "budget": 1240, "tags": ["避坑", "客栈", "美食"]},
    },
    {
        "id": "sanya-1", "guide_id": "sanya", "guide_title": "三亚亲子 5 日游 · 带娃不累的海岛指南",
        "category": "亲子", "section_title": "Day 1-2 亚龙湾与蜈支洲岛亲子潜水",
        "content": "带娃出门每天只安排一个大项。Day1入住亚龙湾酒店沙滩堆城堡看落日。Day2提前一天在官方小程序购票可省20元，蜈支洲岛设有儿童浅水区，6岁以上可一对一体验潜水，需自备泳镜与防寒泳衣。",
        "metadata": {"city": "三亚", "tags": ["亲子", "潜水", "亚龙湾"]},
    },
    {
        "id": "sanya-2", "guide_id": "sanya", "guide_title": "三亚亲子 5 日游 · 带娃不累的海岛指南",
        "category": "亲子", "section_title": "Day 3 免税海鲜与安全贴士",
        "content": "上午逛免税城提前领券，中午去本地海鲜市场现买现加工。防晒霜每2小时补涂一次，沙滩活动避开正午12-15点高温时段，水上项目务必选择持证且配备救生员的场所。",
        "metadata": {"city": "三亚", "tags": ["防晒", "安全", "海鲜"]},
    },
    {
        "id": "qing-1", "guide_id": "qing", "guide_title": "青海湖+茶卡 4 日 · 拍出天空之镜",
        "category": "摄影", "section_title": "黄金拍摄时间与装备清单",
        "content": "6:00-8:00 青海湖东岸拍日出剪影；13:00-15:00 茶卡湖心光线最强倒影最清晰；19:00-20:30 湖西岸拍日落。装备建议带偏振镜 CPF 压暗水面反光、三脚架防风，穿红色或黄色亮色服装对比更强，无人机需提前报备。",
        "metadata": {"city": "青海", "tags": ["茶卡盐湖", "CPF偏振镜", "摄影"]},
    },
    {
        "id": "qing-2", "guide_id": "qing", "guide_title": "青海湖+茶卡 4 日 · 拍出天空之镜",
        "category": "摄影", "section_title": "茶卡盐湖避坑条件",
        "content": "茶卡盐湖只有无风、晴天、水位浅三条件齐备才有天空之镜效果。出发前看天气预报，风速小于 3m/s 且云量低于 30% 时出片率最高，否则容易拍到浑浊盐滩。",
        "metadata": {"city": "青海", "tags": ["天气", "避坑", "茶卡盐湖"]},
    },
]


async def seed_database(session: AsyncSession) -> None:
    existing_spots = (await session.execute(select(Spot.id))).scalars().all()
    if not existing_spots:
        for item in SEED_SPOTS:
            session.add(
                Spot(
                    id=item["id"],
                    name=item["name"],
                    en_name=item["en_name"],
                    city=item["city"],
                    category=item["category"],
                    rating=item["rating"],
                    price=item["price"],
                    days_label=item["days_label"],
                    duration_hours=item["duration_hours"],
                    views=item["views"],
                    scene=item["scene"],
                    description=item["description"],
                    tags_json=json.dumps(item["tags"], ensure_ascii=False),
                    lat=item["lat"],
                    lng=item["lng"],
                    daily_stock=item["daily_stock"],
                    version=1,
                )
            )

    existing_chunks = (await session.execute(select(GuideChunk.id))).scalars().all()
    if not existing_chunks:
        for chunk in SEED_CHUNKS:
            full_text = f"{chunk['guide_title']} {chunk['section_title']} {chunk['content']}"
            session.add(
                GuideChunk(
                    id=chunk["id"],
                    guide_id=chunk["guide_id"],
                    guide_title=chunk["guide_title"],
                    category=chunk["category"],
                    section_title=chunk["section_title"],
                    content=chunk["content"],
                    metadata_json=json.dumps(chunk["metadata"], ensure_ascii=False),
                    embedding_json=json.dumps(compute_char_ngram_embedding(full_text)),
                )
            )

    await session.commit()
