import json
import math
import re
import zlib
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import GuideChunk, Spot


def compute_char_ngram_embedding(text: str, dims: int = 384) -> list[float]:
    """Deterministic signed random-projection embedding (char 1/2/3-grams + words).

    Uses CRC32 + signed hashing (+1/-1) so vectors remain centered and cross-process
    deterministic. In production with an external embedding API + pgvector, replace
    this function with the remote call while keeping the 384-d interface.
    """
    vec = [0.0] * dims
    segments = re.findall(r"[\u4e00-\u9fffa-z0-9]+", text.lower())
    if not segments:
        return vec
    for seg in segments:
        if seg.isascii():
            # Index whole English/numeric token + 3-grams
            tokens = [seg] + [seg[i : i + 3] for i in range(max(0, len(seg) - 2))]
            for tok in tokens:
                h = zlib.crc32(tok.encode("utf-8"))
                bucket = h % dims
                sign = 1.0 if ((h >> 16) & 1) == 0 else -1.0
                vec[bucket] += sign * 1.4
        else:
            for n, weight in ((1, 0.35), (2, 1.2), (3, 1.6)):
                for i in range(max(0, len(seg) - n + 1)):
                    gram = seg[i : i + n]
                    h = zlib.crc32(f"{n}:{gram}".encode("utf-8"))
                    bucket = h % dims
                    sign = 1.0 if ((h >> 16) & 1) == 0 else -1.0
                    vec[bucket] += sign * weight
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


SEED_SPOTS = [
    # ---- 自然山水 (11) ----
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
        "id": "huangshan", "name": "安徽 · 黄山", "en_name": "Mount Huangshan", "city": "安徽黄山",
        "category": "自然山水", "rating": 4.9, "price": 190, "days_label": "2天", "duration_hours": 7.5,
        "views": 95400, "scene": "zhangjiajie.svg",
        "description": "奇松、怪石、云海、温泉四绝闻名，五岳归来不看山，黄山归来不看岳。",
        "tags": ["迎客松", "日出云海", "徒步登山"], "lat": 30.1325, "lng": 118.1749, "daily_stock": 240,
    },
    {
        "id": "taishan", "name": "山东 · 泰山", "en_name": "Mount Tai", "city": "山东泰安",
        "category": "自然山水", "rating": 4.7, "price": 115, "days_label": "1天", "duration_hours": 6.5,
        "views": 88300, "scene": "zhangjiajie.svg",
        "description": "五岳之首，夜爬十八盘登玉皇顶看云海日出，感受会当凌绝顶的豪迈。",
        "tags": ["五岳之首", "夜爬日出", "摩崖石刻"], "lat": 36.2561, "lng": 117.1008, "daily_stock": 300,
    },
    {
        "id": "changbaishan", "name": "吉林 · 长白山", "en_name": "Changbai Mountain", "city": "吉林延边",
        "category": "自然山水", "rating": 4.8, "price": 225, "days_label": "2天", "duration_hours": 6.0,
        "views": 74500, "scene": "chaka.svg",
        "description": "火山口湖天池宛如蓝宝石镶嵌雪峰之间，冬季粉雪滑雪与温泉体验一绝。",
        "tags": ["天池", "滑雪", "火山温泉", "冬季"], "lat": 42.0061, "lng": 128.0554, "daily_stock": 180,
    },
    {
        "id": "danxia", "name": "张掖七彩丹霞", "en_name": "Zhangye Danxia", "city": "甘肃张掖",
        "category": "自然山水", "rating": 4.8, "price": 93, "days_label": "半天", "duration_hours": 3.5,
        "views": 67200, "scene": "chaka.svg",
        "description": "亿万年地质褶皱染出赤橙黄青灰的色彩波浪，日落前两小时色彩最震撼。",
        "tags": ["丹霞地貌", "丝绸之路", "日落摄影"], "lat": 38.9125, "lng": 100.1322, "daily_stock": 260,
    },
    {
        "id": "emeishan", "name": "四川 · 峨眉山", "en_name": "Mount Emei", "city": "四川乐山",
        "category": "自然山水", "rating": 4.8, "price": 160, "days_label": "2天", "duration_hours": 7.0,
        "views": 76800, "scene": "guilin.svg",
        "description": "金顶十方普贤像耸立云海之上，冬季滑雪赏雾凇，山林还能偶遇灵猴。",
        "tags": ["金顶云海", "佛教名山", "巴蜀风光"], "lat": 29.5245, "lng": 103.3372, "daily_stock": 210,
    },
    {
        "id": "hulunbuir", "name": "呼伦贝尔大草原", "en_name": "Hulunbuir Grassland", "city": "内蒙古呼伦贝尔",
        "category": "自然山水", "rating": 4.9, "price": 0, "days_label": "3天", "duration_hours": 6.0,
        "views": 71400, "scene": "chaka.svg",
        "description": "莫日格勒河蜿蜒如带，风吹草低见牛羊，夏季避暑与自驾露营的天堂。",
        "tags": ["草原自驾", "避暑", "亲子露营"], "lat": 49.2153, "lng": 119.7589, "daily_stock": 350,
    },
    {
        "id": "daocheng", "name": "稻城亚丁", "en_name": "Daocheng Yading", "city": "四川甘孜",
        "category": "自然山水", "rating": 4.9, "price": 266, "days_label": "2天", "duration_hours": 7.5,
        "views": 81900, "scene": "jiuzhaigou.svg",
        "description": "三座雪山守护牛奶海与五色海，被誉为蓝色星球上的最后一片净土。",
        "tags": ["高海拔徒步", "雪山海子", "川西秘境"], "lat": 28.4586, "lng": 100.3408, "daily_stock": 140,
    },
    # ---- 人文历史 (11) ----
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
        "id": "terracotta", "name": "西安 · 兵马俑", "en_name": "Terracotta Army", "city": "陕西西安",
        "category": "人文历史", "rating": 4.9, "price": 120, "days_label": "半天", "duration_hours": 4.0,
        "views": 108500, "scene": "xian.svg",
        "description": "世界第八大奇迹，千人千面的大秦军阵，感受两千年前帝国雄风。",
        "tags": ["大秦军阵", "历史研学", "世界遗产"], "lat": 34.3841, "lng": 109.2785, "daily_stock": 260,
    },
    {
        "id": "mogaoku", "name": "敦煌 · 莫高窟", "en_name": "Mogao Caves", "city": "甘肃敦煌",
        "category": "人文历史", "rating": 5.0, "price": 238, "days_label": "1天", "duration_hours": 4.5,
        "views": 92300, "scene": "gugong.svg",
        "description": "跨越千年的东方艺术宝库，数字球幕电影加实地洞窟讲解令人屏息。",
        "tags": ["丝路壁画", "飞天艺术", "预约制"], "lat": 40.0359, "lng": 94.8091, "daily_stock": 100,
    },
    {
        "id": "potala", "name": "拉萨 · 布达拉宫", "en_name": "Potala Palace", "city": "西藏拉萨",
        "category": "人文历史", "rating": 5.0, "price": 200, "days_label": "半天", "duration_hours": 3.5,
        "views": 96400, "scene": "gugong.svg",
        "description": "雪域高原的红白宫堡，世界海拔最高的宫殿群，朝圣者的精神地标。",
        "tags": ["雪域高原", "世界遗产", "人文摄影"], "lat": 29.6555, "lng": 91.1185, "daily_stock": 90,
    },
    {
        "id": "zhuozhengyuan", "name": "苏州 · 拙政园", "en_name": "Humble Administrator's Garden", "city": "江苏苏州",
        "category": "人文历史", "rating": 4.8, "price": 80, "days_label": "半天", "duration_hours": 3.0,
        "views": 84100, "scene": "westlake.svg",
        "description": "中国四大名园之首，一步一景移步换景，尽显江南私家园林雅韵。",
        "tags": ["江南园林", "苏式建筑", "亲子研学"], "lat": 31.3242, "lng": 120.6290, "daily_stock": 220,
    },
    {
        "id": "fuzimiao", "name": "南京 · 夫子庙秦淮河", "en_name": "Confucius Temple", "city": "江苏南京",
        "category": "人文历史", "rating": 4.6, "price": 0, "days_label": "半天", "duration_hours": 3.5,
        "views": 79200, "scene": "westlake.svg",
        "description": "十里秦淮灯火璀璨，画舫游船配金陵小吃，读懂六朝古都烟火气。",
        "tags": ["夜游秦淮", "六朝古都", "小吃街"], "lat": 32.0209, "lng": 118.7890, "daily_stock": 400,
    },
    {
        "id": "yellowcrane", "name": "武汉 · 黄鹤楼", "en_name": "Yellow Crane Tower", "city": "湖北武汉",
        "category": "人文历史", "rating": 4.7, "price": 70, "days_label": "半天", "duration_hours": 2.5,
        "views": 75600, "scene": "gugong.svg",
        "description": "昔人已乘黄鹤去，登楼远眺万里长江与武汉长江大桥同框。",
        "tags": ["江南三大名楼", "长江大桥", "诗词打卡"], "lat": 30.5446, "lng": 114.3025, "daily_stock": 280,
    },
    {
        "id": "longmen", "name": "洛阳 · 龙门石窟", "en_name": "Longmen Grottoes", "city": "河南洛阳",
        "category": "人文历史", "rating": 4.8, "price": 90, "days_label": "半天", "duration_hours": 3.5,
        "views": 72100, "scene": "xian.svg",
        "description": "伊水两岸石窟林立，卢舍那大佛微笑千年，夜游灯光尤为壮观。",
        "tags": ["石刻艺术", "盛唐气象", "夜游"], "lat": 34.5558, "lng": 112.4697, "daily_stock": 230,
    },
    {
        "id": "harbinice", "name": "哈尔滨 · 冰雪大世界", "en_name": "Harbin Ice-Snow World", "city": "黑龙江哈尔滨",
        "category": "人文历史", "rating": 4.8, "price": 328, "days_label": "1天", "duration_hours": 5.0,
        "views": 91200, "scene": "chaka.svg",
        "description": "松花江冰块雕琢出童话冰城堡，霓虹亮起宛如北国琉璃幻境。",
        "tags": ["冰雕奇观", "冬季必去", "北方滑雪"], "lat": 45.7785, "lng": 126.5567, "daily_stock": 200,
    },
    # ---- 古城古镇 (7) ----
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
        "id": "dali", "name": "大理古城 · 洱海", "en_name": "Dali Erhai", "city": "云南大理",
        "category": "古城古镇", "rating": 4.8, "price": 0, "days_label": "2天", "duration_hours": 6.0,
        "views": 89500, "scene": "lijiang.svg",
        "description": "苍山雪洱海月，生态廊道骑行吹海风，感受慢节奏的风花雪月。",
        "tags": ["洱海骑行", "慢生活", "穷游"], "lat": 25.6929, "lng": 100.1610, "daily_stock": 400,
    },
    {
        "id": "pingyao", "name": "山西 · 平遥古城", "en_name": "Pingyao Ancient City", "city": "山西晋中",
        "category": "古城古镇", "rating": 4.7, "price": 125, "days_label": "1天", "duration_hours": 5.0,
        "views": 63800, "scene": "xian.svg",
        "description": "保存最完好的明清县城格局，日昇昌票号带你追溯中国金融雏形。",
        "tags": ["晋商票号", "明清古城", "实景演艺"], "lat": 37.2044, "lng": 112.1763, "daily_stock": 220,
    },
    {
        "id": "fenghuang", "name": "湘西 · 凤凰古城", "en_name": "Fenghuang Ancient Town", "city": "湖南湘西",
        "category": "古城古镇", "rating": 4.6, "price": 0, "days_label": "1天", "duration_hours": 4.5,
        "views": 74100, "scene": "wuzhen.svg",
        "description": "沱江两岸吊脚楼倒映碧水，晨雾轻舟与苗寨银饰极具风情。",
        "tags": ["吊脚楼", "沱江夜景", "苗族风情"], "lat": 27.9483, "lng": 109.5990, "daily_stock": 350,
    },
    {
        "id": "hongcun", "name": "皖南 · 宏村", "en_name": "Hongcun Village", "city": "安徽黄山",
        "category": "古城古镇", "rating": 4.8, "price": 104, "days_label": "1天", "duration_hours": 4.0,
        "views": 69800, "scene": "wuzhen.svg",
        "description": "中国画里的乡村，南湖画桥与月沼白墙黛瓦，徽派水墨意境拉满。",
        "tags": ["徽派建筑", "写生摄影", "水墨江南"], "lat": 30.0029, "lng": 117.9866, "daily_stock": 240,
    },
    {
        "id": "kashgar", "name": "新疆 · 喀什古城", "en_name": "Kashgar Old City", "city": "新疆喀什",
        "category": "古城古镇", "rating": 4.9, "price": 0, "days_label": "2天", "duration_hours": 5.5,
        "views": 70200, "scene": "lijiang.svg",
        "description": "迷宫般的土黄巷弄与百年老茶馆，丝路重镇充满异域烟火与歌声。",
        "tags": ["老茶馆", "西域风情", "美食摄影"], "lat": 39.4704, "lng": 75.9897, "daily_stock": 300,
    },
    # ---- 海岛海滨 (7) ----
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
    {
        "id": "qingdao", "name": "青岛 · 八大关栈桥", "en_name": "Qingdao Badaguan", "city": "山东青岛",
        "category": "海岛海滨", "rating": 4.7, "price": 0, "days_label": "2天", "duration_hours": 5.0,
        "views": 82400, "scene": "gulangyu.svg",
        "description": "红瓦绿树碧海蓝天，欧式老洋房与海滨木栈道，吹海风喝原浆。",
        "tags": ["海滨漫步", "欧式建筑", "避暑"], "lat": 36.0570, "lng": 120.3435, "daily_stock": 450,
    },
    {
        "id": "beihai", "name": "北海 · 涠洲岛", "en_name": "Weizhou Island", "city": "广西北海",
        "category": "海岛海滨", "rating": 4.7, "price": 98, "days_label": "2天", "duration_hours": 6.0,
        "views": 64900, "scene": "sanya.svg",
        "description": "中国最年轻的火山岛，鳄鱼山海蚀地貌与五彩滩日出绝美。",
        "tags": ["火山海岛", "海鲜自由", "电动环岛"], "lat": 21.0369, "lng": 109.1157, "daily_stock": 180,
    },
    {
        "id": "dalian", "name": "大连 · 星海滨海路", "en_name": "Dalian Binhai Road", "city": "辽宁大连",
        "category": "海岛海滨", "rating": 4.6, "price": 0, "days_label": "1天", "duration_hours": 4.0,
        "views": 59300, "scene": "gulangyu.svg",
        "description": "跨海大桥与悬崖海景木栈道交织，北方浪漫海滨徒步圣地。",
        "tags": ["跨海大桥", "海滨徒步", "喂海鸥"], "lat": 38.8825, "lng": 121.5897, "daily_stock": 350,
    },
    {
        "id": "pingtan", "name": "平潭岛 · 蓝眼泪", "en_name": "Pingtan Island", "city": "福建福州",
        "category": "海岛海滨", "rating": 4.7, "price": 0, "days_label": "2天", "duration_hours": 5.0,
        "views": 68100, "scene": "sanya.svg",
        "description": "春夏之交海岸荧光蓝眼泪如星河坠海，北部风车海岸线极为出片。",
        "tags": ["蓝眼泪", "风车海", "环岛骑行"], "lat": 25.5037, "lng": 119.7913, "daily_stock": 320,
    },
    {
        "id": "sunmoonlake", "name": "台湾 · 日月潭", "en_name": "Sun Moon Lake", "city": "台湾南投",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "1天", "duration_hours": 5.0,
        "views": 77300, "scene": "westlake.svg",
        "description": "群山环抱的碧绿高山湖泊，全球十大最美自行车道之一环湖骑行超治愈。",
        "tags": ["环湖骑行", "宝岛风光", "游船"], "lat": 23.8583, "lng": 120.9163, "daily_stock": 300,
    },
]

SEED_CHUNKS = [
    # 1. 丽江 & 大理 (穷游)
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
    # 2. 三亚亲子
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
    # 3. 青海湖 + 茶卡 (摄影)
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
    # 4. 北京故宫 & 西安古都深度游
    {
        "id": "beijing-1", "guide_id": "beijing", "guide_title": "北京故宫+西安古都 4 日历史研学攻略",
        "category": "人文", "section_title": "故宫抢票与动线技巧",
        "content": "故宫门票需提前 7 天晚 20:00 在官方小程序实名预约，周一闭馆。建议上午 8:30 从午门入园，沿中轴线太和殿-乾清宫游览后走珍宝馆，最后从神武门出，直奔景山公园俯瞰紫禁城全景。",
        "metadata": {"city": "北京", "tags": ["故宫", "预约", "中轴线"]},
    },
    {
        "id": "beijing-2", "guide_id": "beijing", "guide_title": "北京故宫+西安古都 4 日历史研学攻略",
        "category": "人文", "section_title": "西安城墙骑行与兵马俑避坑",
        "content": "西安古城墙推荐傍晚 17:30 从永宁门上城墙租单人自行车（45元/3小时），刚好看到日落和灯笼亮起。兵马俑务必请官方持证讲解员或租耳麦，一号坑最为震撼，不要轻信景区外拉客的一日游黑车。",
        "metadata": {"city": "西安", "tags": ["古城墙", "兵马俑", "骑行"]},
    },
    # 5. 江南水乡慢生活
    {
        "id": "jiangnan-1", "guide_id": "jiangnan", "guide_title": "杭州西湖+乌镇+宏村 4 日水墨江南线",
        "category": "休闲", "section_title": "西湖不绕路游览顺序",
        "content": "西湖免费入园但面积大，不建议全程步行。推荐早 7:00 从断桥出发走白堤至孤山，乘手划船游湖心亭，下午前往雷峰塔看夕照。周末地铁比打车快，尽量避开南山路拥堵。",
        "metadata": {"city": "杭州", "tags": ["西湖", "手划船", "错峰"]},
    },
    {
        "id": "jiangnan-2", "guide_id": "jiangnan", "guide_title": "杭州西湖+乌镇+宏村 4 日水墨江南线",
        "category": "休闲", "section_title": "乌镇西栅夜宿与宏村晨雾",
        "content": "乌镇分东栅和西栅，时间有限只去西栅即可，夜景最美且建议住景区内民宿，能独享次日 7:00-8:30 无游客的清晨水乡。去皖南宏村写生拍照建议清晨在南湖画桥和月沼拍水墨倒影。",
        "metadata": {"city": "乌镇", "tags": ["乌镇西栅", "宏村", "夜景"]},
    },
    # 6. 丝绸之路敦煌+张掖
    {
        "id": "silkroad-1", "guide_id": "silkroad", "guide_title": "河西走廊 5 日：莫高窟与七彩丹霞全攻略",
        "category": "摄影", "section_title": "莫高窟 A 类票预约策略",
        "content": "莫高窟旺季 A 类票（238元，含两场数字电影和8个实体洞窟）至少提前 15-30 天在官网预约，仅售应急票时只有 4 个窟且无电影体验。洞窟内严禁拍照和开闪光灯，注意带保温水壶应对西北干燥气候。",
        "metadata": {"city": "敦煌", "tags": ["莫高窟", "预约", "丝绸之路"]},
    },
    {
        "id": "silkroad-2", "guide_id": "silkroad", "guide_title": "河西走廊 5 日：莫高窟与七彩丹霞全攻略",
        "category": "摄影", "section_title": "张掖丹霞最佳光线与穿衣",
        "content": "张掖七彩丹霞最推荐下午 16:30 入园，依次乘坐景区观光车游览 4 号观景台（七彩云海）和 5 号观景台等待日落。刚下过雨的晴天色彩饱和度最高，沙漠地区昼夜温差超过 15°C 需备防风冲锋衣。",
        "metadata": {"city": "张掖", "tags": ["七彩丹霞", "日落", "防风衣"]},
    },
    # 7. 东北冰雪指南
    {
        "id": "northeast-1", "guide_id": "northeast", "guide_title": "哈尔滨+长白山 5 日冬季保暖与防冻攻略",
        "category": "冬季", "section_title": "零下二十度穿衣与手机防关机",
        "content": "东北冬季穿衣遵循三层法则：速干保暖内衣 + 抓绒衣或羊绒衫 + 长款高充绒羽绒服，切忌穿全棉内衣出汗后变凉。手机低温极易掉电关机，务必在手机背面贴暖宝宝，相机备好两块备用电池贴身存放。",
        "metadata": {"city": "哈尔滨", "tags": ["保暖", "暖宝宝", "冬季"]},
    },
    {
        "id": "northeast-2", "guide_id": "northeast", "guide_title": "哈尔滨+长白山 5 日冬季保暖与防冻攻略",
        "category": "冬季", "section_title": "冰雪大世界大滑梯与长白山天池",
        "content": "哈尔滨冰雪大世界建议 15:00 入园拍蓝调时刻冰雕，进园先在微信小程序预约超级冰滑梯和雪花摩天轮。长白山北坡天池是否开放视山顶风雪而定，出发前晚关注官方公众号，带好防滑冰爪和护目墨镜防雪盲。",
        "metadata": {"city": "长白山", "tags": ["冰雪大世界", "天池", "冰爪"]},
    },
    # 8. 川西高海拔与优惠政策
    {
        "id": "chuanxi-1", "guide_id": "chuanxi", "guide_title": "九寨沟+稻城亚丁高反预防与门票优惠指南",
        "category": "自然", "section_title": "高反预防与九寨沟游览路线",
        "content": "初上川西高原前两天不要洗头洗澡、不要剧烈奔跑，稻城亚丁海拔超 4400 米需自备便携氧气瓶与葡萄糖口服液。九寨沟建议早上乘观光车直达最高点长海或原始森林，再一路向下步行游览五花海和诺日朗瀑布。",
        "metadata": {"city": "九寨沟", "tags": ["高原反应", "五花海", "氧气瓶"]},
    },
    {
        "id": "chuanxi-2", "guide_id": "chuanxi", "guide_title": "九寨沟+稻城亚丁高反预防与门票优惠指南",
        "category": "穷游", "section_title": "学生证与老人半价免票通用规则",
        "content": "国内绝大多数 5A 景区对全日制本科及以下在校学生凭有效学生证实行门票半价，60-64 周岁老人多为半价、65 周岁以上及现役军人凭有效证件免门票；注意景区内观光车和索道通常不享受半价优惠。",
        "metadata": {"city": "通用", "tags": ["学生票", "老人优惠", "半价"]},
    },
]


async def seed_database(session: AsyncSession) -> None:
    existing_spot_ids = set((await session.execute(select(Spot.id))).scalars().all())
    for item in SEED_SPOTS:
        if item["id"] in existing_spot_ids:
            continue
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

    existing_chunks = {
        c.id: c for c in (await session.execute(select(GuideChunk))).scalars().all()
    }
    for chunk in SEED_CHUNKS:
        tags_text = " ".join(chunk["metadata"].get("tags", []))
        full_text = f"{chunk['guide_title']} {chunk['section_title']} {tags_text} {chunk['content']}"
        emb_json = json.dumps(compute_char_ngram_embedding(full_text))
        if chunk["id"] in existing_chunks:
            row = existing_chunks[chunk["id"]]
            if row.embedding_json != emb_json:
                row.embedding_json = emb_json
            continue
        session.add(
            GuideChunk(
                id=chunk["id"],
                guide_id=chunk["guide_id"],
                guide_title=chunk["guide_title"],
                category=chunk["category"],
                section_title=chunk["section_title"],
                content=chunk["content"],
                metadata_json=json.dumps(chunk["metadata"], ensure_ascii=False),
                embedding_json=emb_json,
            )
        )

    await session.commit()
