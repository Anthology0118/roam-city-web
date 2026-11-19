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
        "views": 98600, "scene": "guilin.jpg",
        "description": "舟行碧波上，人在画中游。喀斯特峰林倒映漓江，乘竹筏赏山水甲天下。",
        "tags": ["喀斯特峰林", "竹筏漂流", "摄影胜地"], "lat": 25.2736, "lng": 110.2902, "daily_stock": 180,
    },
    {
        "id": "zhangjiajie", "name": "张家界 · 武陵源", "en_name": "Zhangjiajie", "city": "湖南张家界",
        "category": "自然山水", "rating": 4.8, "price": 248, "days_label": "2天", "duration_hours": 8.0,
        "views": 83200, "scene": "zhangjiajie.jpg",
        "description": "三千奇峰拔地而起，《阿凡达》悬浮山的灵感原型，云雾缭绕宛如仙境。",
        "tags": ["奇峰云海", "玻璃栈道", "国家森林公园"], "lat": 29.3489, "lng": 110.5515, "daily_stock": 220,
    },
    {
        "id": "jiuzhaigou", "name": "九寨沟", "en_name": "Jiuzhaigou Valley", "city": "四川阿坝",
        "category": "自然山水", "rating": 5.0, "price": 335, "days_label": "1天", "duration_hours": 7.0,
        "views": 102400, "scene": "jiuzhaigou.jpg",
        "description": "翠海、叠瀑、彩林、雪峰、藏情五绝俱全，是名副其实的人间仙境。",
        "tags": ["钙华彩池", "五花海", "藏族风情"], "lat": 33.2600, "lng": 103.9186, "daily_stock": 150,
    },
    {
        "id": "chaka", "name": "茶卡盐湖", "en_name": "Chaka Salt Lake", "city": "青海海西",
        "category": "自然山水", "rating": 4.6, "price": 160, "days_label": "1天", "duration_hours": 4.5,
        "views": 60100, "scene": "chaka.jpg",
        "description": "天空之镜，湖面如镜倒映蓝天白云与雪山，穿红衣拍倒影超出片。",
        "tags": ["天空之镜", "小火车", "星空观测"], "lat": 36.7547, "lng": 99.0772, "daily_stock": 200,
    },
    {
        "id": "huangshan", "name": "安徽 · 黄山", "en_name": "Mount Huangshan", "city": "安徽黄山",
        "category": "自然山水", "rating": 4.9, "price": 190, "days_label": "2天", "duration_hours": 7.5,
        "views": 95400, "scene": "huangshan.jpg",
        "description": "奇松、怪石、云海、温泉四绝闻名，五岳归来不看山，黄山归来不看岳。",
        "tags": ["迎客松", "日出云海", "徒步登山"], "lat": 30.1325, "lng": 118.1749, "daily_stock": 240,
    },
    {
        "id": "taishan", "name": "山东 · 泰山", "en_name": "Mount Tai", "city": "山东泰安",
        "category": "自然山水", "rating": 4.7, "price": 115, "days_label": "1天", "duration_hours": 6.5,
        "views": 88300, "scene": "taishan.jpg",
        "description": "五岳之首，夜爬十八盘登玉皇顶看云海日出，感受会当凌绝顶的豪迈。",
        "tags": ["五岳之首", "夜爬日出", "摩崖石刻"], "lat": 36.2561, "lng": 117.1008, "daily_stock": 300,
    },
    {
        "id": "changbaishan", "name": "吉林 · 长白山", "en_name": "Changbai Mountain", "city": "吉林延边",
        "category": "自然山水", "rating": 4.8, "price": 225, "days_label": "2天", "duration_hours": 6.0,
        "views": 74500, "scene": "changbaishan.jpg",
        "description": "火山口湖天池宛如蓝宝石镶嵌雪峰之间，冬季粉雪滑雪与温泉体验一绝。",
        "tags": ["天池", "滑雪", "火山温泉", "冬季"], "lat": 42.0061, "lng": 128.0554, "daily_stock": 180,
    },
    {
        "id": "danxia", "name": "张掖七彩丹霞", "en_name": "Zhangye Danxia", "city": "甘肃张掖",
        "category": "自然山水", "rating": 4.8, "price": 93, "days_label": "半天", "duration_hours": 3.5,
        "views": 67200, "scene": "danxia.jpg",
        "description": "亿万年地质褶皱染出赤橙黄青灰的色彩波浪，日落前两小时色彩最震撼。",
        "tags": ["丹霞地貌", "丝绸之路", "日落摄影"], "lat": 38.9125, "lng": 100.1322, "daily_stock": 260,
    },
    {
        "id": "emeishan", "name": "四川 · 峨眉山", "en_name": "Mount Emei", "city": "四川乐山",
        "category": "自然山水", "rating": 4.8, "price": 160, "days_label": "2天", "duration_hours": 7.0,
        "views": 76800, "scene": "emeishan.jpg",
        "description": "金顶十方普贤像耸立云海之上，冬季滑雪赏雾凇，山林还能偶遇灵猴。",
        "tags": ["金顶云海", "佛教名山", "巴蜀风光"], "lat": 29.5245, "lng": 103.3372, "daily_stock": 210,
    },
    {
        "id": "hulunbuir", "name": "呼伦贝尔大草原", "en_name": "Hulunbuir Grassland", "city": "内蒙古呼伦贝尔",
        "category": "自然山水", "rating": 4.9, "price": 0, "days_label": "3天", "duration_hours": 6.0,
        "views": 71400, "scene": "hulunbuir.jpg",
        "description": "莫日格勒河蜿蜒如带，风吹草低见牛羊，夏季避暑与自驾露营的天堂。",
        "tags": ["草原自驾", "避暑", "亲子露营"], "lat": 49.2153, "lng": 119.7589, "daily_stock": 350,
    },
    {
        "id": "daocheng", "name": "稻城亚丁", "en_name": "Daocheng Yading", "city": "四川甘孜",
        "category": "自然山水", "rating": 4.9, "price": 266, "days_label": "2天", "duration_hours": 7.5,
        "views": 81900, "scene": "daocheng.jpg",
        "description": "三座雪山守护牛奶海与五色海，被誉为蓝色星球上的最后一片净土。",
        "tags": ["高海拔徒步", "雪山海子", "川西秘境"], "lat": 28.4586, "lng": 100.3408, "daily_stock": 140,
    },
    # ---- 人文历史 (11) ----
    {
        "id": "westlake", "name": "杭州 · 西湖", "en_name": "West Lake", "city": "浙江杭州",
        "category": "人文历史", "rating": 4.9, "price": 0, "days_label": "1天", "duration_hours": 5.0,
        "views": 110000, "scene": "westlake.jpg",
        "description": "欲把西湖比西子，淡妆浓抹总相宜。十景环绕，四季皆有风情。",
        "tags": ["苏堤春晓", "雷峰塔", "断桥残雪", "亲子"], "lat": 30.2431, "lng": 120.1503, "daily_stock": 500,
    },
    {
        "id": "gugong", "name": "北京 · 故宫", "en_name": "The Forbidden City", "city": "北京",
        "category": "人文历史", "rating": 4.9, "price": 60, "days_label": "1天", "duration_hours": 5.5,
        "views": 120800, "scene": "gugong.jpg",
        "description": "六百年紫禁城，红墙金瓦，穿越明清两朝感受皇家气象。",
        "tags": ["明清宫苑", "红墙金瓦", "纪录片同款"], "lat": 39.9163, "lng": 116.3972, "daily_stock": 120,
    },
    {
        "id": "xian", "name": "西安 · 古城墙", "en_name": "Xi'an City Wall", "city": "陕西西安",
        "category": "人文历史", "rating": 4.8, "price": 80, "days_label": "半天", "duration_hours": 3.0,
        "views": 78800, "scene": "xian.jpg",
        "description": "现存最完整的古代城垣，入夜灯笼亮起，骑行城墙看长安灯火。",
        "tags": ["明城墙", "城墙骑行", "夜景"], "lat": 34.2594, "lng": 108.9470, "daily_stock": 240,
    },
    {
        "id": "terracotta", "name": "西安 · 兵马俑", "en_name": "Terracotta Army", "city": "陕西西安",
        "category": "人文历史", "rating": 4.9, "price": 120, "days_label": "半天", "duration_hours": 4.0,
        "views": 108500, "scene": "terracotta.jpg",
        "description": "世界第八大奇迹，千人千面的大秦军阵，感受两千年前帝国雄风。",
        "tags": ["大秦军阵", "历史研学", "世界遗产"], "lat": 34.3841, "lng": 109.2785, "daily_stock": 260,
    },
    {
        "id": "mogaoku", "name": "敦煌 · 莫高窟", "en_name": "Mogao Caves", "city": "甘肃敦煌",
        "category": "人文历史", "rating": 5.0, "price": 238, "days_label": "1天", "duration_hours": 4.5,
        "views": 92300, "scene": "mogaoku.jpg",
        "description": "跨越千年的东方艺术宝库，数字球幕电影加实地洞窟讲解令人屏息。",
        "tags": ["丝路壁画", "飞天艺术", "预约制"], "lat": 40.0359, "lng": 94.8091, "daily_stock": 100,
    },
    {
        "id": "potala", "name": "拉萨 · 布达拉宫", "en_name": "Potala Palace", "city": "西藏拉萨",
        "category": "人文历史", "rating": 5.0, "price": 200, "days_label": "半天", "duration_hours": 3.5,
        "views": 96400, "scene": "potala.jpg",
        "description": "雪域高原的红白宫堡，世界海拔最高的宫殿群，朝圣者的精神地标。",
        "tags": ["雪域高原", "世界遗产", "人文摄影"], "lat": 29.6555, "lng": 91.1185, "daily_stock": 90,
    },
    {
        "id": "zhuozhengyuan", "name": "苏州 · 拙政园", "en_name": "Humble Administrator's Garden", "city": "江苏苏州",
        "category": "人文历史", "rating": 4.8, "price": 80, "days_label": "半天", "duration_hours": 3.0,
        "views": 84100, "scene": "zhuozhengyuan.jpg",
        "description": "中国四大名园之首，一步一景移步换景，尽显江南私家园林雅韵。",
        "tags": ["江南园林", "苏式建筑", "亲子研学"], "lat": 31.3242, "lng": 120.6290, "daily_stock": 220,
    },
    {
        "id": "fuzimiao", "name": "南京 · 夫子庙秦淮河", "en_name": "Confucius Temple", "city": "江苏南京",
        "category": "人文历史", "rating": 4.6, "price": 0, "days_label": "半天", "duration_hours": 3.5,
        "views": 79200, "scene": "fuzimiao.jpg",
        "description": "十里秦淮灯火璀璨，画舫游船配金陵小吃，读懂六朝古都烟火气。",
        "tags": ["夜游秦淮", "六朝古都", "小吃街"], "lat": 32.0209, "lng": 118.7890, "daily_stock": 400,
    },
    {
        "id": "yellowcrane", "name": "武汉 · 黄鹤楼", "en_name": "Yellow Crane Tower", "city": "湖北武汉",
        "category": "人文历史", "rating": 4.7, "price": 70, "days_label": "半天", "duration_hours": 2.5,
        "views": 75600, "scene": "yellowcrane.jpg",
        "description": "昔人已乘黄鹤去，登楼远眺万里长江与武汉长江大桥同框。",
        "tags": ["江南三大名楼", "长江大桥", "诗词打卡"], "lat": 30.5446, "lng": 114.3025, "daily_stock": 280,
    },
    {
        "id": "longmen", "name": "洛阳 · 龙门石窟", "en_name": "Longmen Grottoes", "city": "河南洛阳",
        "category": "人文历史", "rating": 4.8, "price": 90, "days_label": "半天", "duration_hours": 3.5,
        "views": 72100, "scene": "longmen.jpg",
        "description": "伊水两岸石窟林立，卢舍那大佛微笑千年，夜游灯光尤为壮观。",
        "tags": ["石刻艺术", "盛唐气象", "夜游"], "lat": 34.5558, "lng": 112.4697, "daily_stock": 230,
    },
    {
        "id": "harbinice", "name": "哈尔滨 · 冰雪大世界", "en_name": "Harbin Ice-Snow World", "city": "黑龙江哈尔滨",
        "category": "人文历史", "rating": 4.8, "price": 328, "days_label": "1天", "duration_hours": 5.0,
        "views": 91200, "scene": "harbinice.jpg",
        "description": "松花江冰块雕琢出童话冰城堡，霓虹亮起宛如北国琉璃幻境。",
        "tags": ["冰雕奇观", "冬季必去", "北方滑雪"], "lat": 45.7785, "lng": 126.5567, "daily_stock": 200,
    },
    # ---- 古城古镇 (7) ----
    {
        "id": "lijiang", "name": "丽江古城", "en_name": "Lijiang Old Town", "city": "云南丽江",
        "category": "古城古镇", "rating": 4.7, "price": 100, "days_label": "2天", "duration_hours": 6.0,
        "views": 90300, "scene": "lijiang.jpg",
        "description": "纳西族小桥流水人家，青瓦木楼与雪山相依，夜色里的民谣最动听。",
        "tags": ["纳西文化", "四方街", "民宿", "穷游"], "lat": 26.8721, "lng": 100.2330, "daily_stock": 300,
    },
    {
        "id": "wuzhen", "name": "乌镇 · 西栅", "en_name": "Wuzhen", "city": "浙江桐乡",
        "category": "古城古镇", "rating": 4.5, "price": 150, "days_label": "1天", "duration_hours": 5.0,
        "views": 66000, "scene": "wuzhen.jpg",
        "description": "江南枕水人家，摇橹船穿过石桥，晨昏的水乡都温柔得不像话。",
        "tags": ["枕水人家", "摇橹船", "蓝印花布"], "lat": 30.7458, "lng": 120.4847, "daily_stock": 260,
    },
    {
        "id": "dali", "name": "大理古城 · 洱海", "en_name": "Dali Erhai", "city": "云南大理",
        "category": "古城古镇", "rating": 4.8, "price": 0, "days_label": "2天", "duration_hours": 6.0,
        "views": 89500, "scene": "dali.jpg",
        "description": "苍山雪洱海月，生态廊道骑行吹海风，感受慢节奏的风花雪月。",
        "tags": ["洱海骑行", "慢生活", "穷游"], "lat": 25.6929, "lng": 100.1610, "daily_stock": 400,
    },
    {
        "id": "pingyao", "name": "山西 · 平遥古城", "en_name": "Pingyao Ancient City", "city": "山西晋中",
        "category": "古城古镇", "rating": 4.7, "price": 125, "days_label": "1天", "duration_hours": 5.0,
        "views": 63800, "scene": "pingyao.jpg",
        "description": "保存最完好的明清县城格局，日昇昌票号带你追溯中国金融雏形。",
        "tags": ["晋商票号", "明清古城", "实景演艺"], "lat": 37.2044, "lng": 112.1763, "daily_stock": 220,
    },
    {
        "id": "fenghuang", "name": "湘西 · 凤凰古城", "en_name": "Fenghuang Ancient Town", "city": "湖南湘西",
        "category": "古城古镇", "rating": 4.6, "price": 0, "days_label": "1天", "duration_hours": 4.5,
        "views": 74100, "scene": "fenghuang.jpg",
        "description": "沱江两岸吊脚楼倒映碧水，晨雾轻舟与苗寨银饰极具风情。",
        "tags": ["吊脚楼", "沱江夜景", "苗族风情"], "lat": 27.9483, "lng": 109.5990, "daily_stock": 350,
    },
    {
        "id": "hongcun", "name": "皖南 · 宏村", "en_name": "Hongcun Village", "city": "安徽黄山",
        "category": "古城古镇", "rating": 4.8, "price": 104, "days_label": "1天", "duration_hours": 4.0,
        "views": 69800, "scene": "hongcun.jpg",
        "description": "中国画里的乡村，南湖画桥与月沼白墙黛瓦，徽派水墨意境拉满。",
        "tags": ["徽派建筑", "写生摄影", "水墨江南"], "lat": 30.0029, "lng": 117.9866, "daily_stock": 240,
    },
    {
        "id": "kashgar", "name": "新疆 · 喀什古城", "en_name": "Kashgar Old City", "city": "新疆喀什",
        "category": "古城古镇", "rating": 4.9, "price": 0, "days_label": "2天", "duration_hours": 5.5,
        "views": 70200, "scene": "kashgar.jpg",
        "description": "迷宫般的土黄巷弄与百年老茶馆，丝路重镇充满异域烟火与歌声。",
        "tags": ["老茶馆", "西域风情", "美食摄影"], "lat": 39.4704, "lng": 75.9897, "daily_stock": 300,
    },
    # ---- 海岛海滨 (7) ----
    {
        "id": "sanya", "name": "三亚 · 亚龙湾", "en_name": "Sanya Yalong Bay", "city": "海南三亚",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "3天", "duration_hours": 6.0,
        "views": 97000, "scene": "sanya.jpg",
        "description": "碧海银沙椰风，东方夏威夷，潜水冲浪发呆一次满足。",
        "tags": ["椰林沙滩", "潜水", "海鲜", "亲子"], "lat": 18.2215, "lng": 109.6331, "daily_stock": 400,
    },
    {
        "id": "gulangyu", "name": "厦门 · 鼓浪屿", "en_name": "Gulangyu Island", "city": "福建厦门",
        "category": "海岛海滨", "rating": 4.6, "price": 90, "days_label": "1天", "duration_hours": 4.5,
        "views": 71000, "scene": "gulangyu.jpg",
        "description": "万国建筑博览的琴岛，海浪、钢琴与老别墅，适合慢悠悠散步。",
        "tags": ["万国建筑", "钢琴之岛", "文艺小岛"], "lat": 24.4472, "lng": 118.0674, "daily_stock": 200,
    },
    {
        "id": "qingdao", "name": "青岛 · 八大关栈桥", "en_name": "Qingdao Badaguan", "city": "山东青岛",
        "category": "海岛海滨", "rating": 4.7, "price": 0, "days_label": "2天", "duration_hours": 5.0,
        "views": 82400, "scene": "qingdao.jpg",
        "description": "红瓦绿树碧海蓝天，欧式老洋房与海滨木栈道，吹海风喝原浆。",
        "tags": ["海滨漫步", "欧式建筑", "避暑"], "lat": 36.0570, "lng": 120.3435, "daily_stock": 450,
    },
    {
        "id": "beihai", "name": "北海 · 涠洲岛", "en_name": "Weizhou Island", "city": "广西北海",
        "category": "海岛海滨", "rating": 4.7, "price": 98, "days_label": "2天", "duration_hours": 6.0,
        "views": 64900, "scene": "beihai.jpg",
        "description": "中国最年轻的火山岛，鳄鱼山海蚀地貌与五彩滩日出绝美。",
        "tags": ["火山海岛", "海鲜自由", "电动环岛"], "lat": 21.0369, "lng": 109.1157, "daily_stock": 180,
    },
    {
        "id": "dalian", "name": "大连 · 星海滨海路", "en_name": "Dalian Binhai Road", "city": "辽宁大连",
        "category": "海岛海滨", "rating": 4.6, "price": 0, "days_label": "1天", "duration_hours": 4.0,
        "views": 59300, "scene": "dalian.jpg",
        "description": "跨海大桥与悬崖海景木栈道交织，北方浪漫海滨徒步圣地。",
        "tags": ["跨海大桥", "海滨徒步", "喂海鸥"], "lat": 38.8825, "lng": 121.5897, "daily_stock": 350,
    },
    {
        "id": "pingtan", "name": "平潭岛 · 蓝眼泪", "en_name": "Pingtan Island", "city": "福建福州",
        "category": "海岛海滨", "rating": 4.7, "price": 0, "days_label": "2天", "duration_hours": 5.0,
        "views": 68100, "scene": "pingtan.jpg",
        "description": "春夏之交海岸荧光蓝眼泪如星河坠海，北部风车海岸线极为出片。",
        "tags": ["蓝眼泪", "风车海", "环岛骑行"], "lat": 25.5037, "lng": 119.7913, "daily_stock": 320,
    },
    {
        "id": "sunmoonlake", "name": "台湾 · 日月潭", "en_name": "Sun Moon Lake", "city": "台湾南投",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "1天", "duration_hours": 5.0,
        "views": 77300, "scene": "sunmoonlake.jpg",
        "description": "群山环抱的碧绿高山湖泊，全球十大最美自行车道之一环湖骑行超治愈。",
        "tags": ["环湖骑行", "宝岛风光", "游船"], "lat": 23.8583, "lng": 120.9163, "daily_stock": 300,
    },
    # ---- 新增自然山水 (12) ----
    {
        "id": "kanas", "name": "新疆 · 喀纳斯湖", "en_name": "Kanas Lake", "city": "新疆阿勒泰",
        "category": "自然山水", "rating": 5.0, "price": 230, "days_label": "2天", "duration_hours": 7.5,
        "views": 96500, "scene": "kanas.jpg",
        "description": "阿尔泰山深处的变色冰川湖泊，神仙湾晨雾与秋日金黄白桦林宛如油画。",
        "tags": ["秋景天花板", "冰川湖", "北疆自驾"], "lat": 48.7167, "lng": 87.0167, "daily_stock": 180,
    },
    {
        "id": "sayram", "name": "新疆 · 赛里木湖", "en_name": "Sayram Lake", "city": "新疆博尔塔拉",
        "category": "自然山水", "rating": 4.9, "price": 145, "days_label": "1天", "duration_hours": 5.5,
        "views": 91800, "scene": "sayram.jpg",
        "description": "大西洋最后一滴眼泪，湛蓝湖水与天山雪峰相映，环湖自驾步步皆景。",
        "tags": ["环湖自驾", "雪山蓝湖", "天鹅"], "lat": 44.6000, "lng": 81.1667, "daily_stock": 220,
    },
    {
        "id": "namtso", "name": "西藏 · 纳木错", "en_name": "Namtso Lake", "city": "西藏拉萨",
        "category": "自然山水", "rating": 4.9, "price": 120, "days_label": "1天", "duration_hours": 5.0,
        "views": 84200, "scene": "namtso.jpg",
        "description": "海拔4718米的雪域圣湖，念青唐古拉雪山倒映在宝石蓝湖面，纯净震撼。",
        "tags": ["高原圣湖", "雪山倒影", "星空"], "lat": 30.7167, "lng": 90.5333, "daily_stock": 150,
    },
    {
        "id": "huangguoshu", "name": "贵州 · 黄果树瀑布", "en_name": "Huangguoshu Waterfall", "city": "贵州安顺",
        "category": "自然山水", "rating": 4.8, "price": 220, "days_label": "1天", "duration_hours": 6.0,
        "views": 88900, "scene": "huangguoshu.jpg",
        "description": "亚洲第一大瀑布，穿越水帘洞近距离感受飞瀑轰鸣与漫天彩虹水雾。",
        "tags": ["大瀑布", "水帘洞", "避暑"], "lat": 25.9917, "lng": 105.6667, "daily_stock": 260,
    },
    {
        "id": "wuyishan", "name": "福建 · 武夷山", "en_name": "Wuyi Mountains", "city": "福建南平",
        "category": "自然山水", "rating": 4.8, "price": 140, "days_label": "2天", "duration_hours": 6.5,
        "views": 76300, "scene": "wuyishan.jpg",
        "description": "世界文化与自然双遗产，九曲溪竹筏漂流赏丹霞碧水，品正宗大红袍岩茶。",
        "tags": ["九曲溪竹筏", "丹霞地貌", "岩茶文化"], "lat": 27.6500, "lng": 117.9500, "daily_stock": 240,
    },
    {
        "id": "yulong", "name": "丽江 · 玉龙雪山", "en_name": "Jade Dragon Snow Mountain", "city": "云南丽江",
        "category": "自然山水", "rating": 4.9, "price": 240, "days_label": "1天", "duration_hours": 6.5,
        "views": 99400, "scene": "yulong.jpg",
        "description": "北半球最南端终年积雪的冰川雪山，乘索道直达4680米冰川公园与蓝月谷。",
        "tags": ["冰川公园", "蓝月谷", "日照金山"], "lat": 27.1000, "lng": 100.1833, "daily_stock": 180,
    },
    {
        "id": "huashan", "name": "陕西 · 华山", "en_name": "Mount Hua", "city": "陕西渭南",
        "category": "自然山水", "rating": 4.9, "price": 160, "days_label": "2天", "duration_hours": 7.5,
        "views": 87600, "scene": "huashan.jpg",
        "description": "奇险天下第一山，长空栈道与鹞子翻身惊心动魄，东峰观日出云海绝美。",
        "tags": ["奇险五岳", "长空栈道", "徒步登山"], "lat": 34.4833, "lng": 110.0833, "daily_stock": 260,
    },
    {
        "id": "fanjingshan", "name": "贵州 · 梵净山", "en_name": "Fanjingshan", "city": "贵州铜仁",
        "category": "自然山水", "rating": 4.8, "price": 240, "days_label": "1天", "duration_hours": 6.5,
        "views": 82500, "scene": "fanjingshan.jpg",
        "description": "天空之城红云金顶孤峰耸立云端，奇石蘑菇石与原始冷杉林令人叹为观止。",
        "tags": ["天空之城", "红云金顶", "世界遗产"], "lat": 27.9083, "lng": 108.6983, "daily_stock": 170,
    },
    {
        "id": "detian", "name": "广西 · 德天跨国瀑布", "en_name": "Detian Transnational Waterfall", "city": "广西崇左",
        "category": "自然山水", "rating": 4.8, "price": 115, "days_label": "1天", "duration_hours": 4.5,
        "views": 73100, "scene": "detian.jpg",
        "description": "亚洲第一大跨国瀑布，三级跌落气势磅礴，乘竹筏畅游中越界河归春河。",
        "tags": ["跨国瀑布", "中越边境", "喀斯特"], "lat": 22.8556, "lng": 106.7222, "daily_stock": 250,
    },
    {
        "id": "lugu", "name": "川滇 · 泸沽湖", "en_name": "Lugu Lake", "city": "云南丽江/四川凉山",
        "category": "自然山水", "rating": 4.9, "price": 70, "days_label": "2天", "duration_hours": 6.0,
        "views": 83700, "scene": "lugu.jpg",
        "description": "高原明珠东方女儿国，猪槽船划过清澈水性杨花湖面，里格半岛晨雾如诗。",
        "tags": ["摩梭风情", "猪槽船", "环湖慢游"], "lat": 27.7167, "lng": 100.7833, "daily_stock": 280,
    },
    {
        "id": "enshi", "name": "湖北 · 恩施大峡谷", "en_name": "Enshi Grand Canyon", "city": "湖北恩施",
        "category": "自然山水", "rating": 4.8, "price": 245, "days_label": "1天", "duration_hours": 6.5,
        "views": 75400, "scene": "enshi.jpg",
        "description": "喀斯特绝壁长廊与一炷香奇峰并立，云龙地缝暗河飞瀑，夏季清凉避暑。",
        "tags": ["绝壁栈道", "一炷香", "地缝奇观"], "lat": 30.4333, "lng": 109.1667, "daily_stock": 230,
    },
    {
        "id": "siguniang", "name": "川西 · 四姑娘山", "en_name": "Mount Siguniang", "city": "四川阿坝",
        "category": "自然山水", "rating": 4.9, "price": 150, "days_label": "2天", "duration_hours": 6.5,
        "views": 86400, "scene": "siguniang.jpg",
        "description": "东方阿尔卑斯，双桥沟雪山草甸与红杉林触手可及，川西轻徒步入门首选。",
        "tags": ["东方阿尔卑斯", "雪山草甸", "川西轻徒步"], "lat": 31.1167, "lng": 102.9000, "daily_stock": 210,
    },
    # ---- 新增人文历史 (12) ----
    {
        "id": "greatwall", "name": "北京 · 八达岭长城", "en_name": "Badaling Great Wall", "city": "北京",
        "category": "人文历史", "rating": 4.9, "price": 40, "days_label": "半天", "duration_hours": 4.5,
        "views": 135200, "scene": "greatwall.jpg",
        "description": "不到长城非好汉，明长城最精华雄伟的一段，登北八楼俯瞰群山巨龙盘踞。",
        "tags": ["世界奇迹", "明长城", "必打卡"], "lat": 40.3597, "lng": 116.0144, "daily_stock": 400,
    },
    {
        "id": "summerpalace", "name": "北京 · 颐和园", "en_name": "Summer Palace", "city": "北京",
        "category": "人文历史", "rating": 4.9, "price": 30, "days_label": "半天", "duration_hours": 4.0,
        "views": 112600, "scene": "summerpalace.jpg",
        "description": "中国保存最完整的皇家园林博物馆，昆明湖泛舟赏佛香阁与十七孔桥金光穿洞。",
        "tags": ["皇家园林", "十七孔桥", "昆明湖"], "lat": 39.9999, "lng": 116.2755, "daily_stock": 380,
    },
    {
        "id": "tiantan", "name": "北京 · 天坛公园", "en_name": "Temple of Heaven", "city": "北京",
        "category": "人文历史", "rating": 4.9, "price": 34, "days_label": "半天", "duration_hours": 3.0,
        "views": 98400, "scene": "tiantan.jpg",
        "description": "明清帝王祭天祈谷圣地，祈年殿三重蓝瓦金顶尽显东方天圆地方建筑美学。",
        "tags": ["祈年殿", "回音壁", "古建摄影"], "lat": 39.8822, "lng": 116.4066, "daily_stock": 350,
    },
    {
        "id": "bund", "name": "上海 · 外滩万国建筑", "en_name": "The Bund Shanghai", "city": "上海",
        "category": "人文历史", "rating": 4.9, "price": 0, "days_label": "半天", "duration_hours": 3.5,
        "views": 142000, "scene": "bund.jpg",
        "description": "黄浦江畔百年万国建筑博览群与陆家嘴摩天 skyline 隔江相望，魔都夜景天花板。",
        "tags": ["万国建筑", "魔都夜景", "Citywalk"], "lat": 31.2397, "lng": 121.4905, "daily_stock": 600,
    },
    {
        "id": "hongyadong", "name": "重庆 · 洪崖洞", "en_name": "Hongyadong Chongqing", "city": "重庆",
        "category": "人文历史", "rating": 4.8, "price": 0, "days_label": "半天", "duration_hours": 3.0,
        "views": 131500, "scene": "hongyadong.jpg",
        "description": "依山就势的11层巴渝吊脚楼群，入夜华灯齐放宛如《千与千寻》魔幻8D山城。",
        "tags": ["8D魔幻山城", "赛博夜景", "火锅美食"], "lat": 29.5624, "lng": 106.5789, "daily_stock": 500,
    },
    {
        "id": "panda", "name": "成都 · 大熊猫繁育基地", "en_name": "Chengdu Panda Base", "city": "四川成都",
        "category": "人文历史", "rating": 4.9, "price": 55, "days_label": "半天", "duration_hours": 4.0,
        "views": 128400, "scene": "panda.jpg",
        "description": "近距离看顶流国宝花花啃竹子滚草坪，竹林清幽，亲子家庭与动物爱好者必去。",
        "tags": ["国宝熊猫", "亲子必去", "成都名片"], "lat": 30.7380, "lng": 104.1456, "daily_stock": 320,
    },
    {
        "id": "leshan", "name": "四川 · 乐山大佛", "en_name": "Leshan Giant Buddha", "city": "四川乐山",
        "category": "人文历史", "rating": 4.8, "price": 80, "days_label": "半天", "duration_hours": 3.5,
        "views": 91300, "scene": "leshan.jpg",
        "description": "通高71米的唐代摩崖石刻弥勒坐佛，三江汇流处乘船仰望山是一尊佛的震撼。",
        "tags": ["唐代石刻", "三江游船", "乐山美食"], "lat": 29.5469, "lng": 103.7736, "daily_stock": 280,
    },
    {
        "id": "yungang", "name": "大同 · 云冈石窟", "en_name": "Yungang Grottoes", "city": "山西大同",
        "category": "人文历史", "rating": 4.9, "price": 120, "days_label": "半天", "duration_hours": 4.0,
        "views": 84600, "scene": "yungang.jpg",
        "description": "中国四大石窟之一，北魏皇家开凿的五万余尊佛像气势恢宏，第20窟露天大佛极具神韵。",
        "tags": ["北魏石窟", "世界遗产", "古建巡礼"], "lat": 40.1097, "lng": 113.1333, "daily_stock": 240,
    },
    {
        "id": "tengwangge", "name": "南昌 · 滕王阁", "en_name": "Pavilion of Prince Teng", "city": "江西南昌",
        "category": "人文历史", "rating": 4.7, "price": 50, "days_label": "半天", "duration_hours": 2.5,
        "views": 78900, "scene": "tengwangge.jpg",
        "description": "江南三大名楼之首，背诵《滕王阁序》可免票登阁，赣江落日与孤鹜齐飞。",
        "tags": ["背序免票", "江南名楼", "赣江夜景"], "lat": 28.6814, "lng": 115.8812, "daily_stock": 280,
    },
    {
        "id": "shaolin", "name": "登封 · 嵩山少林寺", "en_name": "Shaolin Monastery", "city": "河南郑州",
        "category": "人文历史", "rating": 4.7, "price": 80, "days_label": "1天", "duration_hours": 5.0,
        "views": 86200, "scene": "shaolin.jpg",
        "description": "禅宗祖庭、天下功夫出少林，探访千年塔林与常住院，欣赏震撼少林武术演艺。",
        "tags": ["少林功夫", "千年塔林", "禅宗祖庭"], "lat": 34.5081, "lng": 112.9358, "daily_stock": 260,
    },
    {
        "id": "sanxingdui", "name": "广汉 · 三星堆博物馆", "en_name": "Sanxingdui Museum", "city": "四川德阳",
        "category": "人文历史", "rating": 5.0, "price": 72, "days_label": "半天", "duration_hours": 4.0,
        "views": 114800, "scene": "sanxingdui.jpg",
        "description": "沉睡三千年一醒惊天下，青铜大立人、黄金面具与青铜神树揭开神秘古蜀文明。",
        "tags": ["古蜀文明", "青铜神树", "顶流博物馆"], "lat": 31.0022, "lng": 104.2194, "daily_stock": 200,
    },
    {
        "id": "cantontower", "name": "广州 · 广州塔珠江夜游", "en_name": "Canton Tower", "city": "广东广州",
        "category": "人文历史", "rating": 4.8, "price": 150, "days_label": "半天", "duration_hours": 3.0,
        "views": 109300, "scene": "cantontower.jpg",
        "description": "600米小蛮腰城市地标，登450米高空摩天轮俯瞰珠江新城霓虹璀璨与广府风情。",
        "tags": ["小蛮腰", "高空摩天轮", "珠江夜景"], "lat": 23.1065, "lng": 113.3245, "daily_stock": 300,
    },
    # ---- 新增古城古镇 (7) ----
    {
        "id": "zhouzhuang", "name": "昆山 · 周庄古镇", "en_name": "Zhouzhuang Water Town", "city": "江苏苏州",
        "category": "古城古镇", "rating": 4.7, "price": 100, "days_label": "1天", "duration_hours": 4.5,
        "views": 83400, "scene": "zhouzhuang.jpg",
        "description": "中国第一水乡，双桥流水摇橹船与沈厅万三蹄，浓缩九百年江南古韵。",
        "tags": ["第一水乡", "双桥摇橹船", "水乡夜景"], "lat": 31.1167, "lng": 120.8500, "daily_stock": 280,
    },
    {
        "id": "xijiang", "name": "贵州 · 西江千户苗寨", "en_name": "Xijiang Miao Village", "city": "贵州黔东南",
        "category": "古城古镇", "rating": 4.8, "price": 110, "days_label": "1天", "duration_hours": 5.5,
        "views": 95200, "scene": "xijiang.jpg",
        "description": "世界最大苗族聚居村寨，千余座木质吊脚楼依山叠建，入夜万家灯火如繁星坠谷。",
        "tags": ["万家灯火", "长桌宴", "苗族银饰"], "lat": 26.4944, "lng": 108.1778, "daily_stock": 260,
    },
    {
        "id": "furong", "name": "湘西 · 芙蓉镇", "en_name": "Furong Ancient Town", "city": "湖南湘西",
        "category": "古城古镇", "rating": 4.7, "price": 108, "days_label": "半天", "duration_hours": 4.0,
        "views": 79600, "scene": "furong.jpg",
        "description": "挂在瀑布上的千年土家古镇，穿行大瀑布水帘之下赏灯火璀璨的吊脚楼群。",
        "tags": ["瀑布古镇", "土家风情", "绝美夜景"], "lat": 28.7433, "lng": 109.9467, "daily_stock": 250,
    },
    {
        "id": "nanxun", "name": "湖州 · 南浔古镇", "en_name": "Nanxun Ancient Town", "city": "浙江湖州",
        "category": "古城古镇", "rating": 4.8, "price": 0, "days_label": "1天", "duration_hours": 4.5,
        "views": 76800, "scene": "nanxun.jpg",
        "description": "永久免门票的宝藏江南水乡，百间楼清晨倒影与中西合璧民国豪宅静谧典雅。",
        "tags": ["免费水乡", "百间楼", "小莲庄"], "lat": 30.8781, "lng": 120.4272, "daily_stock": 400,
    },
    {
        "id": "tulou", "name": "福建 · 南靖云水谣土楼", "en_name": "Fujian Tulou", "city": "福建漳州",
        "category": "古城古镇", "rating": 4.8, "price": 90, "days_label": "1天", "duration_hours": 5.0,
        "views": 81200, "scene": "tulou.jpg",
        "description": "《大鱼海棠》灵感原型，百年圆形夯土建筑与千年古榕鹅卵石古道相映成趣。",
        "tags": ["大鱼海棠", "世界遗产", "客家土楼"], "lat": 24.6611, "lng": 117.0750, "daily_stock": 240,
    },
    {
        "id": "langzhong", "name": "四川 · 阆中古城", "en_name": "Langzhong Ancient City", "city": "四川南充",
        "category": "古城古镇", "rating": 4.7, "price": 0, "days_label": "1天", "duration_hours": 4.5,
        "views": 69400, "scene": "langzhong.jpg",
        "description": "中国四大古城之一、春节发源地，嘉陵江三面环绕的风水古城，古街醋香四溢。",
        "tags": ["四大古城", "嘉陵江畔", "三国文化"], "lat": 31.5583, "lng": 105.9750, "daily_stock": 350,
    },
    {
        "id": "wuyuan", "name": "江西 · 婺源篁岭", "en_name": "Wuyuan Huangling", "city": "江西上饶",
        "category": "古城古镇", "rating": 4.9, "price": 145, "days_label": "1天", "duration_hours": 5.0,
        "views": 93100, "scene": "wuyuan.jpg",
        "description": "中国最美乡村挂崖古村，春季万亩梯田油菜花海，秋季红椒皇菊晒秋闻名世界。",
        "tags": ["篁岭晒秋", "梯田花海", "徽派古村"], "lat": 29.3278, "lng": 118.1222, "daily_stock": 260,
    },
    # ---- 新增海岛海滨 (5) ----
    {
        "id": "zhoushan", "name": "舟山 · 普陀山海岛", "en_name": "Mount Putuo Zhoushan", "city": "浙江舟山",
        "category": "海岛海滨", "rating": 4.9, "price": 160, "days_label": "2天", "duration_hours": 6.5,
        "views": 94500, "scene": "zhoushan.jpg",
        "description": "海天佛国南海观音圣地，百步沙金滩听涛，古寺禅意与东海海景交融。",
        "tags": ["海天佛国", "海岛祈福", "金沙海滩"], "lat": 29.9833, "lng": 122.3833, "daily_stock": 260,
    },
    {
        "id": "weihai", "name": "威海 · 火炬八街环海路", "en_name": "Weihai Coastline", "city": "山东威海",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "2天", "duration_hours": 5.5,
        "views": 89700, "scene": "weihai.jpg",
        "description": "北方绝美治愈系海滨小城，火炬八街尽头直面蔚蓝大海，猫头山环海自驾超惬意。",
        "tags": ["漫画海街", "环海自驾", "北方看海"], "lat": 37.5300, "lng": 122.0550, "daily_stock": 420,
    },
    {
        "id": "victoria", "name": "香港 · 维多利亚港", "en_name": "Victoria Harbour", "city": "香港",
        "category": "海岛海滨", "rating": 4.9, "price": 0, "days_label": "1天", "duration_hours": 4.5,
        "views": 138600, "scene": "victoria.jpg",
        "description": "世界三大夜景之一，乘天星小轮穿越维港海风，星光大道赏幻彩咏香江灯光秀。",
        "tags": ["世界级夜景", "天星小轮", "大湾区"], "lat": 22.2889, "lng": 114.1700, "daily_stock": 500,
    },
    {
        "id": "meizhou", "name": "莆田 · 湄洲岛", "en_name": "Meizhou Island", "city": "福建莆田",
        "category": "海岛海滨", "rating": 4.7, "price": 125, "days_label": "1天", "duration_hours": 5.0,
        "views": 67800, "scene": "meizhou.jpg",
        "description": "妈祖文化发源地，鹅尾海蚀地质公园奇礁嶙峋，租电瓶车环彩虹公路追海边日落。",
        "tags": ["彩虹海路", "海蚀奇观", "海岛日落"], "lat": 25.0667, "lng": 119.1333, "daily_stock": 240,
    },
    {
        "id": "shenzhen", "name": "深圳 · 深圳湾海滨长廊", "en_name": "Shenzhen Bay Coastal Park", "city": "广东深圳",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "半天", "duration_hours": 3.5,
        "views": 96200, "scene": "shenzhen.jpg",
        "description": "13公里绝美滨海骑行栈道，冬季漫天候鸟翩跹，出地铁即看海与现代都市天际线。",
        "tags": ["出地铁看海", "海滨骑行", "大湾区日落"], "lat": 22.5150, "lng": 113.9500, "daily_stock": 500,
    },
    # ---- 第三批扩充：自然山水 (22) ----
    {
        "id": "lushan", "name": "江西 · 庐山", "en_name": "Mount Lu", "city": "江西九江",
        "category": "自然山水", "rating": 4.8, "price": 160, "days_label": "2天", "duration_hours": 7.0,
        "views": 91400, "scene": "lushan.jpg",
        "description": "匡庐奇秀甲天下，含鄱口云海日出、三叠泉飞瀑与牯岭镇百年老别墅避暑绝佳。",
        "tags": ["避暑胜地", "三叠泉", "云海日出"], "lat": 29.5667, "lng": 115.9833, "daily_stock": 260,
    },
    {
        "id": "sanqingshan", "name": "江西 · 三清山", "en_name": "Mount Sanqing", "city": "江西上饶",
        "category": "自然山水", "rating": 4.9, "price": 245, "days_label": "1天", "duration_hours": 6.5,
        "views": 82300, "scene": "sanqingshan.jpg",
        "description": "东方女神与巨蟒出山花岗岩峰林奇观，高空绝壁栈道穿行云海仙雾之间。",
        "tags": ["花岗岩峰林", "高空栈道", "道教名山"], "lat": 28.9167, "lng": 118.0667, "daily_stock": 220,
    },
    {
        "id": "qinghaihu", "name": "青海 · 青海湖", "en_name": "Qinghai Lake", "city": "青海海南",
        "category": "自然山水", "rating": 4.9, "price": 90, "days_label": "2天", "duration_hours": 6.0,
        "views": 103400, "scene": "qinghaihu.jpg",
        "description": "中国最大内陆咸水湖，盛夏金黄油菜花海紧邻蔚蓝湖水，环湖骑行心旷神怡。",
        "tags": ["油菜花海", "环湖骑行", "高原蓝海"], "lat": 36.8833, "lng": 100.2000, "daily_stock": 300,
    },
    {
        "id": "yamdrok", "name": "西藏 · 羊卓雍错", "en_name": "Yamdrok Lake", "city": "西藏山南",
        "category": "自然山水", "rating": 5.0, "price": 60, "days_label": "1天", "duration_hours": 5.0,
        "views": 95800, "scene": "yamdrok.jpg",
        "description": "西藏三大圣湖之一，宛如散落高原的碧绿珊瑚枝，岗巴拉山口俯瞰绝美蒂芙尼蓝。",
        "tags": ["西藏圣湖", "蒂芙尼蓝", "自驾摄影"], "lat": 28.9333, "lng": 90.7167, "daily_stock": 180,
    },
    {
        "id": "everest", "name": "西藏 · 珠峰大本营", "en_name": "Mount Everest Base Camp", "city": "西藏日喀则",
        "category": "自然山水", "rating": 5.0, "price": 160, "days_label": "2天", "duration_hours": 6.0,
        "views": 112000, "scene": "everest.jpg",
        "description": "仰望海拔8848.86米世界之巅，在5200米绒布寺看日照金山与璀璨银河。",
        "tags": ["世界之巅", "日照金山", "人生必去"], "lat": 28.1411, "lng": 86.8517, "daily_stock": 120,
    },
    {
        "id": "tianchi_xj", "name": "新疆 · 天山天池", "en_name": "Heavenly Lake of Tianshan", "city": "新疆昌吉",
        "category": "自然山水", "rating": 4.8, "price": 155, "days_label": "1天", "duration_hours": 5.0,
        "views": 88400, "scene": "tianchi_xj.jpg",
        "description": "博格达雪峰倒映在半山碧绿瑶池，云杉环抱，乘画舫游湖远眺千年冰川。",
        "tags": ["博格达峰", "西王母瑶池", "乌鲁木齐周边"], "lat": 43.8861, "lng": 88.1333, "daily_stock": 260,
    },
    {
        "id": "nalati", "name": "新疆 · 那拉提空中草原", "en_name": "Nalati Grassland", "city": "新疆伊犁",
        "category": "自然山水", "rating": 4.9, "price": 135, "days_label": "2天", "duration_hours": 6.5,
        "views": 94200, "scene": "nalati.jpg",
        "description": "世界四大河谷草原之一，雪山、雪岭云杉、野花与毡房构成极致治愈的立体画卷。",
        "tags": ["空中草原", "伊犁自驾", "避暑骑马"], "lat": 43.2500, "lng": 84.0167, "daily_stock": 240,
    },
    {
        "id": "turpan", "name": "吐鲁番 · 火焰山峡谷", "en_name": "Flaming Mountains", "city": "新疆吐鲁番",
        "category": "自然山水", "rating": 4.6, "price": 40, "days_label": "半天", "duration_hours": 3.0,
        "views": 71200, "scene": "turpan.jpg",
        "description": "《西游记》经典取景地，赤红砂岩褶皱在烈日下如烈焰升腾，顺游葡萄沟吃甜瓜。",
        "tags": ["西游记同款", "赤红峡谷", "丝路奇观"], "lat": 42.8833, "lng": 89.6333, "daily_stock": 300,
    },
    {
        "id": "shapotou", "name": "宁夏 · 沙坡头", "en_name": "Shapotou Desert", "city": "宁夏中卫",
        "category": "自然山水", "rating": 4.8, "price": 80, "days_label": "1天", "duration_hours": 5.5,
        "views": 78500, "scene": "shapotou.jpg",
        "description": "腾格里沙漠与奔腾黄河在此交汇，体验大漠孤烟、滑沙、羊皮筏子与沙漠观星。",
        "tags": ["大漠黄河", "滑沙骑骆驼", "星星酒店"], "lat": 37.4567, "lng": 105.0022, "daily_stock": 260,
    },
    {
        "id": "hukou", "name": "晋陕 · 黄河壶口瀑布", "en_name": "Hukou Waterfall", "city": "陕西延安/山西临汾",
        "category": "自然山水", "rating": 4.8, "price": 100, "days_label": "半天", "duration_hours": 3.5,
        "views": 86900, "scene": "hukou.jpg",
        "description": "中国最大黄色瀑布，千里黄河一壶收，涛声如雷水雾漫天，尽显母亲河磅礴气势。",
        "tags": ["黄河奇观", "金色巨瀑", "水底冒烟"], "lat": 36.1489, "lng": 110.4439, "daily_stock": 280,
    },
    {
        "id": "laojunshan", "name": "洛阳 · 老君山", "en_name": "Laojun Mountain", "city": "河南洛阳",
        "category": "自然山水", "rating": 4.9, "price": 100, "days_label": "1天", "duration_hours": 6.5,
        "views": 108600, "scene": "laojunshan.jpg",
        "description": "远赴人间惊鸿宴，一睹人间盛世颜。十里画屏与云海雪中亮灯的金顶道观群美如仙宫。",
        "tags": ["金顶亮灯", "十里画屏", "冬季雪景"], "lat": 33.7200, "lng": 111.6400, "daily_stock": 240,
    },
    {
        "id": "yuntaishan", "name": "焦作 · 云台山红石峡", "en_name": "Yuntai Mountain", "city": "河南焦作",
        "category": "自然山水", "rating": 4.8, "price": 180, "days_label": "2天", "duration_hours": 6.5,
        "views": 83100, "scene": "yuntaishan.jpg",
        "description": "南太行山水精华，红石峡丹崖碧水一线天，潭瀑峡三步一泉五步一瀑清凉宜人。",
        "tags": ["红石峡", "太行山水", "玻璃栈道"], "lat": 35.4367, "lng": 113.3811, "daily_stock": 260,
    },
    {
        "id": "shennongjia", "name": "湖北 · 神农架秘境", "en_name": "Shennongjia", "city": "湖北神农架",
        "category": "自然山水", "rating": 4.8, "price": 269, "days_label": "2天", "duration_hours": 7.0,
        "views": 77400, "scene": "shennongjia.jpg",
        "description": "华中屋脊原始森林与大九湖高山湿地晨雾，还能偶遇可爱的金丝猴家族。",
        "tags": ["原始森林", "大九湖晨雾", "金丝猴"], "lat": 31.4667, "lng": 110.3000, "daily_stock": 220,
    },
    {
        "id": "threegorges", "name": "渝鄂 · 长江三峡夔门", "en_name": "Three Gorges", "city": "重庆奉节/湖北宜昌",
        "category": "自然山水", "rating": 4.9, "price": 100, "days_label": "2天", "duration_hours": 6.0,
        "views": 92500, "scene": "threegorges.jpg",
        "description": "十元人民币背面取景地夔门雄姿，乘游轮穿行瞿塘峡巫峡，深秋漫山红叶映江水。",
        "tags": ["10元人民币同款", "三峡红叶", "游轮观光"], "lat": 31.0417, "lng": 109.5667, "daily_stock": 300,
    },
    {
        "id": "wulong", "name": "重庆 · 武隆天生三桥", "en_name": "Wulong Karst", "city": "重庆武隆",
        "category": "自然山水", "rating": 4.8, "price": 125, "days_label": "1天", "duration_hours": 5.0,
        "views": 87200, "scene": "wulong.jpg",
        "description": "世界最大天生桥群，天龙桥、青龙桥、黑龙桥气势磅礴，《满城尽带黄金甲》驿站隐于谷底。",
        "tags": ["世界遗产", "天坑地缝", "电影取景地"], "lat": 29.4294, "lng": 107.8047, "daily_stock": 260,
    },
    {
        "id": "libo", "name": "贵州 · 荔波小七孔", "en_name": "Libo Xiaoqikong", "city": "贵州黔南",
        "category": "自然山水", "rating": 4.9, "price": 170, "days_label": "1天", "duration_hours": 6.0,
        "views": 96800, "scene": "libo.jpg",
        "description": "地球腰带上的绿宝石，卧龙潭蓝绿碧水、水上森林踏溪与古石桥宛如童话秘境。",
        "tags": ["地球绿宝石", "水上森林", "卧龙潭"], "lat": 25.2583, "lng": 107.7217, "daily_stock": 240,
    },
    {
        "id": "shilin", "name": "昆明 · 云南石林", "en_name": "Shilin Stone Forest", "city": "云南昆明",
        "category": "自然山水", "rating": 4.7, "price": 130, "days_label": "1天", "duration_hours": 4.5,
        "views": 79800, "scene": "shilin.jpg",
        "description": "世界喀斯特地貌精华，亿万年剑状石灰岩拔地而起，探访阿诗玛传说与撒尼族歌舞。",
        "tags": ["喀斯特奇观", "阿诗玛", "地质公园"], "lat": 24.8125, "lng": 103.3242, "daily_stock": 300,
    },
    {
        "id": "shangrila", "name": "香格里拉 · 普达措", "en_name": "Potatso National Park", "city": "云南迪庆",
        "category": "自然山水", "rating": 4.8, "price": 138, "days_label": "1天", "duration_hours": 5.5,
        "views": 88100, "scene": "shangrila.jpg",
        "description": "中国大陆首个国家公园，属都湖高原明镜、原始冷杉林与牧场牦牛构成心中的日月。",
        "tags": ["高原草甸", "属都湖", "徒步吸氧"], "lat": 27.8286, "lng": 99.9617, "daily_stock": 220,
    },
    {
        "id": "xishuangbanna", "name": "西双版纳 · 热带植物园", "en_name": "Xishuangbanna Tropical Garden", "city": "云南西双版纳",
        "category": "自然山水", "rating": 4.9, "price": 80, "days_label": "2天", "duration_hours": 5.5,
        "views": 93600, "scene": "xishuangbanna.jpg",
        "description": "中科院热带植物王国，王莲载人奇观、夜晚萤火虫秘境与星光夜市傣族美食风情。",
        "tags": ["热带雨林", "萤火虫", "冬季避寒"], "lat": 21.9292, "lng": 101.2533, "daily_stock": 320,
    },
    {
        "id": "qiandaohu", "name": "杭州 · 千岛湖", "en_name": "Qiandao Lake", "city": "浙江杭州",
        "category": "自然山水", "rating": 4.8, "price": 130, "days_label": "2天", "duration_hours": 6.0,
        "views": 84700, "scene": "qiandaohu.jpg",
        "description": "天下第一秀水，1078座翠绿岛屿星罗棋布，环湖绿道骑行配鲜美有机鱼头汤。",
        "tags": ["环湖骑行", "千岛鱼头", "周末度假"], "lat": 29.6042, "lng": 119.0417, "daily_stock": 300,
    },
    {
        "id": "jingpohu", "name": "牡丹江 · 镜泊湖瀑布", "en_name": "Jingpo Lake", "city": "黑龙江牡丹江",
        "category": "自然山水", "rating": 4.7, "price": 100, "days_label": "1天", "duration_hours": 5.0,
        "views": 68400, "scene": "jingpohu.jpg",
        "description": "世界最大火山熔岩堰塞湖，吊水楼瀑布夏季飞流直下、冬季冰瀑跳水堪称一绝。",
        "tags": ["火山堰塞湖", "吊水楼瀑布", "东北避暑"], "lat": 44.0333, "lng": 128.9500, "daily_stock": 240,
    },
    {
        "id": "wudalianchi", "name": "黑河 · 五大连池火山", "en_name": "Wudalianchi Geopark", "city": "黑龙江黑河",
        "category": "自然山水", "rating": 4.7, "price": 130, "days_label": "2天", "duration_hours": 6.0,
        "views": 61200, "scene": "wudalianchi.jpg",
        "description": "打开的火山教科书，14座新老火山与五座串珠状堰塞湖相连，可直饮天然冷矿泉。",
        "tags": ["世界地质公园", "火山地貌", "天然冷泉"], "lat": 48.7167, "lng": 126.1500, "daily_stock": 220,
    },
    # ---- 第三批扩充：人文历史 (16) ----
    {
        "id": "yuanmingyuan", "name": "北京 · 圆明园遗址", "en_name": "Old Summer Palace", "city": "北京",
        "category": "人文历史", "rating": 4.8, "price": 25, "days_label": "半天", "duration_hours": 4.0,
        "views": 96500, "scene": "yuanmingyuan.jpg",
        "description": "万园之园历史遗迹，西洋楼大水法残垣诉说沧桑历史，盛夏千亩荷花与黑天鹅相伴。",
        "tags": ["历史研学", "西洋楼遗址", "夏日赏荷"], "lat": 40.0081, "lng": 116.2981, "daily_stock": 400,
    },
    {
        "id": "chengde", "name": "承德 · 避暑山庄", "en_name": "Chengde Mountain Resort", "city": "河北承德",
        "category": "人文历史", "rating": 4.8, "price": 130, "days_label": "1天", "duration_hours": 5.5,
        "views": 83900, "scene": "chengde.jpg",
        "description": "清代皇帝夏宫，集江南水乡与塞外草原于一园，外八庙小布达拉宫金碧辉煌。",
        "tags": ["皇家夏宫", "世界遗产", "塞外避暑"], "lat": 40.9894, "lng": 117.9378, "daily_stock": 280,
    },
    {
        "id": "qufu", "name": "济宁 · 曲阜三孔", "en_name": "Temple of Confucius Qufu", "city": "山东济宁",
        "category": "人文历史", "rating": 4.8, "price": 140, "days_label": "1天", "duration_hours": 5.0,
        "views": 81500, "scene": "qufu.jpg",
        "description": "孔庙、孔府、孔林三大古建群，千年古柏参天，沉浸式体验儒家文化与晨钟开城仪式。",
        "tags": ["儒家圣地", "世界遗产", "亲子研学"], "lat": 35.5967, "lng": 116.9867, "daily_stock": 300,
    },
    {
        "id": "baotu", "name": "济南 · 趵突泉", "en_name": "Baotu Spring", "city": "山东济南",
        "category": "人文历史", "rating": 4.7, "price": 40, "days_label": "半天", "duration_hours": 2.5,
        "views": 89200, "scene": "baotu.jpg",
        "description": "天下第一泉，三股清泉昼夜喷涌不息，打卡胖锦鲤与李清照纪念堂，顺游大明湖。",
        "tags": ["天下第一泉", "泉城济南", "李清照"], "lat": 36.6611, "lng": 117.0161, "daily_stock": 360,
    },
    {
        "id": "zhongshanling", "name": "南京 · 中山陵钟山", "en_name": "Sun Yat-sen Mausoleum", "city": "江苏南京",
        "category": "人文历史", "rating": 4.9, "price": 0, "days_label": "半天", "duration_hours": 4.0,
        "views": 115200, "scene": "zhongshanling.jpg",
        "description": "紫金山南麓392级博爱石阶庄严肃穆，秋季梧桐大道金黄璀璨，顺游美龄宫与明孝陵。",
        "tags": ["梧桐大道", "免费预约", "民国建筑"], "lat": 32.0644, "lng": 118.8483, "daily_stock": 450,
    },
    {
        "id": "lingyin", "name": "杭州 · 灵隐寺飞来峰", "en_name": "Lingyin Temple", "city": "浙江杭州",
        "category": "人文历史", "rating": 4.8, "price": 75, "days_label": "半天", "duration_hours": 3.5,
        "views": 104300, "scene": "lingyin.jpg",
        "description": "始建于东晋的江南千年古刹，飞来峰五代至元代石窟造像精美，古木幽深禅意十足。",
        "tags": ["千年古刹", "飞来峰石刻", "祈福静心"], "lat": 30.2408, "lng": 120.1014, "daily_stock": 350,
    },
    {
        "id": "dujiangyan", "name": "成都 · 都江堰水利", "en_name": "Dujiangyan Irrigation", "city": "四川成都",
        "category": "人文历史", "rating": 4.9, "price": 80, "days_label": "1天", "duration_hours": 4.5,
        "views": 97600, "scene": "dujiangyan.jpg",
        "description": "两千两百年仍在使用的无坝引水奇迹，走安澜索桥看鱼嘴分水，夜晚南桥蓝眼泪超惊艳。",
        "tags": ["世界遗产", "南桥蓝眼泪", "古人智慧"], "lat": 31.0006, "lng": 103.6083, "daily_stock": 300,
    },
    {
        "id": "jiayuguan", "name": "甘肃 · 嘉峪关关城", "en_name": "Jiayu Pass", "city": "甘肃嘉峪关",
        "category": "人文历史", "rating": 4.8, "price": 110, "days_label": "半天", "duration_hours": 3.5,
        "views": 78400, "scene": "jiayuguan.jpg",
        "description": "明代万里长城西端起点、天下第一雄关，背靠祁连雪山与戈壁大漠，丝路沧桑感拉满。",
        "tags": ["天下第一雄关", "丝绸之路", "大漠雪山"], "lat": 39.8017, "lng": 98.2156, "daily_stock": 260,
    },
    {
        "id": "maijishan", "name": "天水 · 麦积山石窟", "en_name": "Maijishan Grottoes", "city": "甘肃天水",
        "category": "人文历史", "rating": 4.9, "price": 80, "days_label": "半天", "duration_hours": 3.5,
        "views": 81900, "scene": "maijishan.jpg",
        "description": "东方雕塑陈列馆，悬崖峭壁上的凌空栈道串联起十六国至明清的泥塑佛像，东方微笑动人。",
        "tags": ["东方微笑", "悬崖栈道", "四大石窟"], "lat": 34.3506, "lng": 106.0044, "daily_stock": 220,
    },
    {
        "id": "dazu", "name": "重庆 · 大足石刻", "en_name": "Dazu Rock Carvings", "city": "重庆大足",
        "category": "人文历史", "rating": 4.9, "price": 115, "days_label": "1天", "duration_hours": 4.5,
        "views": 74500, "scene": "dazu.jpg",
        "description": "世界石窟艺术最后一座丰碑，宝顶山千手观音金光璀璨，释迦涅槃卧佛宏伟震撼。",
        "tags": ["千手观音", "世界遗产", "宋代石刻"], "lat": 29.7486, "lng": 105.7928, "daily_stock": 240,
    },
    {
        "id": "shenyangpalace", "name": "沈阳 · 沈阳故宫", "en_name": "Mukden Palace", "city": "辽宁沈阳",
        "category": "人文历史", "rating": 4.8, "price": 50, "days_label": "半天", "duration_hours": 3.0,
        "views": 89100, "scene": "shenyangpalace.jpg",
        "description": "清入关前皇宫，大政殿八角重檐与红墙冬雪别具满族特色，出宫即逛中街尝老边饺子。",
        "tags": ["满清皇宫", "红墙拍雪", "沈阳必去"], "lat": 41.7961, "lng": 123.4500, "daily_stock": 300,
    },
    {
        "id": "yueyang", "name": "岳阳 · 岳阳楼洞庭湖", "en_name": "Yueyang Tower", "city": "湖南岳阳",
        "category": "人文历史", "rating": 4.8, "price": 70, "days_label": "半天", "duration_hours": 3.0,
        "views": 82400, "scene": "yueyang.jpg",
        "description": "先天下之忧而忧，江南三大名楼中唯一保持纯木盔顶结构的古楼，登楼远眺八百里洞庭。",
        "tags": ["背记免票", "八百里洞庭", "纯木古建"], "lat": 29.3811, "lng": 113.0956, "daily_stock": 280,
    },
    {
        "id": "yuelu", "name": "长沙 · 岳麓书院橘子洲", "en_name": "Yuelu Academy", "city": "湖南长沙",
        "category": "人文历史", "rating": 4.9, "price": 40, "days_label": "1天", "duration_hours": 5.0,
        "views": 118400, "scene": "yuelu.jpg",
        "description": "千年学府惟楚有材，爱晚亭深秋红枫似火，下山即游橘子洲头与五一广场烟火夜市。",
        "tags": ["千年学府", "爱晚亭赏枫", "长沙美食"], "lat": 28.1806, "lng": 112.9375, "daily_stock": 360,
    },
    {
        "id": "kaiping", "name": "江门 · 开平碉楼村落", "en_name": "Kaiping Diaolou", "city": "广东江门",
        "category": "人文历史", "rating": 4.8, "price": 78, "days_label": "1天", "duration_hours": 4.5,
        "views": 71300, "scene": "kaiping.jpg",
        "description": "广东首个世界文化遗产，《让子弹飞》取景地自力村，稻田间中西合璧的百年侨乡堡垒。",
        "tags": ["让子弹飞", "侨乡文化", "稻田城堡"], "lat": 22.3711, "lng": 112.5789, "daily_stock": 240,
    },
    {
        "id": "macau_ruins", "name": "澳门 · 大三巴历史城区", "en_name": "Ruins of St. Paul's", "city": "澳门",
        "category": "人文历史", "rating": 4.9, "price": 0, "days_label": "1天", "duration_hours": 4.5,
        "views": 124500, "scene": "macau_ruins.jpg",
        "description": "四百年巴洛克式教堂前壁与葡式碎石路，恋爱巷打卡配刚出炉的葡挞与猪扒包。",
        "tags": ["世界遗产", "葡式风情", "大湾区Citywalk"], "lat": 22.1975, "lng": 113.5408, "daily_stock": 500,
    },
    {
        "id": "taipei101", "name": "台北 · 台北101观景台", "en_name": "Taipei 101", "city": "台湾台北",
        "category": "人文历史", "rating": 4.8, "price": 135, "days_label": "半天", "duration_hours": 3.0,
        "views": 102800, "scene": "taipei101.jpg",
        "description": "508米竹节式摩天地标，37秒超高速电梯直达89层俯瞰台北盆地日落与万家灯火。",
        "tags": ["城市地标", "高空夜景", "宝岛必去"], "lat": 25.0339, "lng": 121.5645, "daily_stock": 300,
    },
    # ---- 第三批扩充：古城古镇 (10) ----
    {
        "id": "tongli", "name": "苏州 · 同里古镇", "en_name": "Tongli Water Town", "city": "江苏苏州",
        "category": "古城古镇", "rating": 4.7, "price": 100, "days_label": "1天", "duration_hours": 4.5,
        "views": 77600, "scene": "tongli.jpg",
        "description": "东方小威尼斯，世界遗产退思园精巧绝伦，走太平吉利长庆三桥祈福，慢享水乡评弹。",
        "tags": ["退思园", "走三桥", "江南水乡"], "lat": 31.1583, "lng": 120.7167, "daily_stock": 280,
    },
    {
        "id": "xitang", "name": "嘉兴 · 西塘古镇", "en_name": "Xitang Ancient Town", "city": "浙江嘉兴",
        "category": "古城古镇", "rating": 4.7, "price": 95, "days_label": "1天", "duration_hours": 5.0,
        "views": 84300, "scene": "xitang.jpg",
        "description": "生活着的千年古镇，两千米临河烟雨长廊雨天不湿鞋，汉服旅拍与水乡夜色极佳。",
        "tags": ["烟雨长廊", "汉服旅拍", "水乡夜景"], "lat": 30.9439, "lng": 120.8886, "daily_stock": 300,
    },
    {
        "id": "xidi", "name": "皖南 · 西递古村", "en_name": "Xidi Ancient Village", "city": "安徽黄山",
        "category": "古城古镇", "rating": 4.8, "price": 104, "days_label": "半天", "duration_hours": 3.5,
        "views": 68900, "scene": "xidi.jpg",
        "description": "明清徽商古民居博物馆，胡文光牌楼气势非凡，比宏村更清静原生态的桃花源人家。",
        "tags": ["世界遗产", "徽派砖雕", "原生态古村"], "lat": 29.9036, "lng": 117.9886, "daily_stock": 240,
    },
    {
        "id": "shaxi", "name": "大理 · 沙溪古镇", "en_name": "Shaxi Ancient Town", "city": "云南大理",
        "category": "古城古镇", "rating": 4.9, "price": 0, "days_label": "1天", "duration_hours": 5.0,
        "views": 86400, "scene": "shaxi.jpg",
        "description": "茶马古道唯一幸存的古集市，玉津桥晨雾与先锋书局麦田书香，《去有风的地方》治愈同款。",
        "tags": ["有风的地方", "茶马古道", "治愈慢旅"], "lat": 26.3167, "lng": 99.8500, "daily_stock": 320,
    },
    {
        "id": "zengcuoan", "name": "厦门 · 曾厝垵环岛路", "en_name": "Zengcuoan Xiamen", "city": "福建厦门",
        "category": "古城古镇", "rating": 4.6, "price": 0, "days_label": "半天", "duration_hours": 3.5,
        "views": 91200, "scene": "zengcuoan.jpg",
        "description": "中国最文艺渔村，红砖闽南古厝与海滨环岛路骑行相连，沙茶面与海蛎煎逛吃不停。",
        "tags": ["文艺渔村", "闽南小吃", "环岛路看海"], "lat": 24.4267, "lng": 118.1211, "daily_stock": 450,
    },
    {
        "id": "zhenyuan", "name": "贵州 · 镇远古镇", "en_name": "Zhenyuan Ancient Town", "city": "贵州黔东南",
        "category": "古城古镇", "rating": 4.8, "price": 0, "days_label": "1天", "duration_hours": 5.0,
        "views": 78200, "scene": "zhenyuan.jpg",
        "description": "两千多年历史的水墨太极古城，舞阳河S形穿城而过，青龙洞悬崖古建倒映碧波。",
        "tags": ["太极古城", "免门票", "舞阳河夜景"], "lat": 27.0494, "lng": 108.4239, "daily_stock": 380,
    },
    {
        "id": "ciqikou", "name": "重庆 · 磁器口古镇", "en_name": "Ciqikou Old Town", "city": "重庆",
        "category": "古城古镇", "rating": 4.6, "price": 0, "days_label": "半天", "duration_hours": 3.5,
        "views": 94300, "scene": "ciqikou.jpg",
        "description": "一条石板路千年磁器口，嘉陵江畔巴渝老茶馆听川剧变脸，现炸陈麻花香气扑鼻。",
        "tags": ["巴渝古镇", "川剧变脸", "地道小吃"], "lat": 29.5786, "lng": 106.4500, "daily_stock": 450,
    },
    {
        "id": "taierzhuang", "name": "枣庄 · 台儿庄古城", "en_name": "Taierzhuang Ancient City", "city": "山东枣庄",
        "category": "古城古镇", "rating": 4.8, "price": 118, "days_label": "1天", "duration_hours": 5.5,
        "views": 81700, "scene": "taierzhuang.jpg",
        "description": "天下第一庄、大运河活化石，融合北方豪迈与江南灵秀，夜晚非遗打铁花璀璨夺目。",
        "tags": ["京杭大运河", "非遗打铁花", "江北水乡"], "lat": 34.5583, "lng": 117.7367, "daily_stock": 280,
    },
    {
        "id": "yaoli", "name": "景德镇 · 陶溪川古窑", "en_name": "Jingdezhen Porcelain Town", "city": "江西景德镇",
        "category": "古城古镇", "rating": 4.9, "price": 0, "days_label": "2天", "duration_hours": 5.5,
        "views": 98700, "scene": "yaoli.jpg",
        "description": "千年瓷都文艺天花板，老瓷厂红砖市集淘原创手作陶瓷，亲手拉坯烧制专属青花瓷。",
        "tags": ["千年瓷都", "陶溪川市集", "手作拉坯"], "lat": 29.2933, "lng": 117.2144, "daily_stock": 400,
    },
    {
        "id": "gubei", "name": "北京 · 古北水镇司马台", "en_name": "Gubei Water Town", "city": "北京密云",
        "category": "古城古镇", "rating": 4.8, "price": 140, "days_label": "1天", "duration_hours": 6.0,
        "views": 95100, "scene": "gubei.jpg",
        "description": "长城脚下的北方星空小镇，乘摇橹船赏红叶，提灯夜游司马台长城与无人机孔明灯秀。",
        "tags": ["夜游长城", "长城温泉", "无人机星空秀"], "lat": 40.6461, "lng": 117.2722, "daily_stock": 260,
    },
    # ---- 第三批扩充：海岛海滨 (6) ----
    {
        "id": "wuzhizhou", "name": "三亚 · 蜈支洲岛", "en_name": "Wuzhizhou Island", "city": "海南三亚",
        "category": "海岛海滨", "rating": 4.9, "price": 144, "days_label": "1天", "duration_hours": 6.0,
        "views": 106400, "scene": "wuzhizhou.jpg",
        "description": "中国马尔代夫玻璃海，能见度超20米绝佳珊瑚礁潜水胜地，情人桥与观日岩绝美出片。",
        "tags": ["玻璃海潜水", "水上项目", "海岛蜜月"], "lat": 18.3125, "lng": 109.7633, "daily_stock": 280,
    },
    {
        "id": "tianya", "name": "三亚 · 天涯海角", "en_name": "Tianya Haijiao", "city": "海南三亚",
        "category": "海岛海滨", "rating": 4.6, "price": 0, "days_label": "半天", "duration_hours": 3.0,
        "views": 87500, "scene": "tianya.jpg",
        "description": "现已全面免门票的南海浪漫地标，椰风海韵巨石刻字，紧邻天涯小镇蓝白海边咖啡馆。",
        "tags": ["免门票看海", "浪漫地标", "蓝白小镇"], "lat": 18.2939, "lng": 109.3511, "daily_stock": 500,
    },
    {
        "id": "nanao", "name": "汕头 · 南澳岛", "en_name": "Nan'ao Island", "city": "广东汕头",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "2天", "duration_hours": 6.0,
        "views": 92300, "scene": "nanao.jpg",
        "description": "穿越11公里跨海大桥登北回归线海岛，三座红白网红灯塔、青澳湾日出与潮汕生腌美食。",
        "tags": ["网红灯塔", "环岛自驾", "潮汕美食"], "lat": 23.4217, "lng": 117.0233, "daily_stock": 380,
    },
    {
        "id": "penglai", "name": "烟台 · 蓬莱阁仙境", "en_name": "Penglai Pavilion", "city": "山东烟台",
        "category": "海岛海滨", "rating": 4.8, "price": 100, "days_label": "1天", "duration_hours": 4.5,
        "views": 83600, "scene": "penglai.jpg",
        "description": "八仙过海神话发源地、中国古代四大名楼之一，登丹崖山远眺黄渤海分界线与海市蜃楼。",
        "tags": ["八仙过海", "黄渤海分界", "山海古楼"], "lat": 37.8267, "lng": 120.7511, "daily_stock": 280,
    },
    {
        "id": "beidaihe", "name": "秦皇岛 · 阿那亚北戴河", "en_name": "Beidaihe & Aranya", "city": "河北秦皇岛",
        "category": "海岛海滨", "rating": 4.8, "price": 0, "days_label": "2天", "duration_hours": 5.5,
        "views": 95800, "scene": "beidaihe.jpg",
        "description": "京津冀周末看海后花园，鸽子窝观湿地日出，阿那亚孤独图书馆与海边礼堂极具文艺氛围。",
        "tags": ["孤独图书馆", "海边礼堂", "京津冀看海"], "lat": 39.8350, "lng": 119.4867, "daily_stock": 420,
    },
    {
        "id": "kenting", "name": "屏东 · 垦丁鹅銮鼻", "en_name": "Kenting National Park", "city": "台湾屏东",
        "category": "海岛海滨", "rating": 4.9, "price": 0, "days_label": "2天", "duration_hours": 6.5,
        "views": 91400, "scene": "kenting.jpg",
        "description": "太平洋与巴士海峡交汇的南国海岸，纯白鹅銮鼻灯塔、龙磐草原海崖与垦丁大街夜市。",
        "tags": ["太平洋海岸", "鹅銮鼻灯塔", "机车环海"], "lat": 21.9022, "lng": 120.8522, "daily_stock": 350,
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
    existing_spots = {s.id: s for s in (await session.execute(select(Spot))).scalars().all()}
    for item in SEED_SPOTS:
        if item["id"] in existing_spots:
            row = existing_spots[item["id"]]
            if row.scene != item["scene"]:
                row.scene = item["scene"]
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
