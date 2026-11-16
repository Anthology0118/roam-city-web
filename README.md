# 漫游城市 AI · RoamCity AI

> 从大一纯静态前端课设重构升级为 **AI 应用全栈工程项目**：**React 18 + TypeScript + Vite**（前端）+ **Python FastAPI + SQLAlchemy Async**（后端）+ **Hybrid RAG（BM25 + 向量 RRF）** + **2-opt TSP 路径规划算法**。

## 核心架构与技术亮点

1. **AI 行程规划 Agent（多轮记忆 + Query 改写 + 6 工具真流式调用 + Guardrail 自检）**
   - `backend/app/agent/planner_agent.py`：支持多轮会话管理（增删改查 `ChatTurn`）、多轮指代 Query 改写、否定词地区排除（如“不去西北”）、出发地锚定、游览节奏控制与预算/余票 Guardrail 自检。
   - 支持 `.env` 或前端「接入大模型 API」面板实时配置 OpenAI 兼容模型，启用 `stream: true` 真·首字流式 **Tool Calling**（`search_spots`、`hybrid_search_guides`、`optimize_route_2opt`、`prepare_booking_draft`、`manage_favorites`、`query_bookings`），异常时显式上报降级原因并切换本地兜底引擎。
   - `backend/eval/eval_agent.py`（6 组多轮与约束评测集）：**零幻觉落地率 100.0%（6/6）**、**总体约束遵循率 100.0%（6/6）**。
2. **3D 中国三级阶梯海拔/气候沙盘 + 确定性路径规划（Anti-Hallucination）**
   - `frontend/src/components/ChinaRouteMap.tsx` & `chinaTerrain.ts`：基于 `d3-geo` Mercator 投影与 **Three.js WebGL** 渲染 `122×90` 网格立体浮雕地形，支持 **⛰️ 三级阶梯海拔高度** 与 **🌦️ 五大气候环境带** GPU 瞬时切换、**36 个真实经纬度景区光柱** 及 **3D 二次贝塞尔航线飞线**。
   - `backend/app/algo/route_planner.py`：基于 WGS-84 经纬度计算 **Haversine 球面距离**，使用 **最近邻贪心 + 2-opt 局部搜索** 在预算与每日时长约束下求解最优顺序，量化对比并展示节省里程。
3. **Hybrid RAG 攻略检索与离线量化评测**
   - `backend/app/rag/retriever.py`：对 **8 篇攻略 / 17 个章节切片** 结合 **BM25 词法检索 + 384 维符号随机投影向量相似度** 并通过 **RRF（Reciprocal Rank Fusion）** 融合排序。
   - `backend/eval/eval_rag.py` 在 20 条评测集（`eval/qa_dataset.json`）上的实测消融结果：

| 检索模式 | Recall@1 | Recall@3 | Recall@5 | MRR@5 |
| --- | ---: | ---: | ---: | ---: |
| `bm25` | 100.0% | 100.0% | 100.0% | 1.0000 |
| `vector` | 80.0% | 95.0% | 100.0% | 0.8683 |
| `hybrid` (RRF) | 95.0% | 100.0% | 100.0% | 0.9750 |

4. **并发安全的乐观锁门票预约与心愿单**
   - `backend/app/api/routes.py`：通过版本号 `version` 实现分景点余票乐观锁扣减（单测覆盖 **8 并发请求不超卖**），订单取消自动回滚库存；支持 `/api/favorites` 心愿单持久化与图集灯箱浏览。

## 本地运行（前后端分离）

### 1. 启动后端（FastAPI）

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

如需接入真实大模型，复制 `backend/.env.example` 为 `backend/.env` 并填写 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`。

### 2. 启动前端（React + TypeScript + Vite）

```powershell
cd frontend
npm run dev
```

浏览器访问 `http://localhost:5173`（Vite 已配置 `/api` 反向代理至 `http://127.0.0.1:8000`）。

### 3. 运行测试与构建验证

```powershell
# 后端单元测试与并发/多轮集成测试
cd backend
.\.venv\Scripts\python.exe -m pytest -v

# RAG 离线量化评测（BM25 vs Vector vs Hybrid RRF）
cd backend
$env:PYTHONPATH="."; .\.venv\Scripts\python.exe -m eval.eval_rag

# AI Agent 多轮约束与零幻觉离线评测
cd backend
$env:PYTHONPATH="."; .\.venv\Scripts\python.exe -m eval.eval_agent

# 前端类型检查与生产构建
cd frontend
npm run build
```

## 目录结构

```text
.
├─ .github/workflows/       # GitHub Actions CI（pytest + RAG eval + Vite build）
├─ backend/                 # Python 3.13 + FastAPI 后端
│  ├─ app/
│  │  ├─ agent/             # 多轮记忆 + Tool Calling + SSE Agent 编排
│  │  ├─ algo/              # Haversine + 2-opt 路径规划算法
│  │  ├─ api/               # REST & SSE 路由（含心愿单与并发预约）
│  │  ├─ core/              # Pydantic Settings 配置
│  │  ├─ db/                # SQLAlchemy Async 模型与 36 景点/17 攻略切片种子数据
│  │  └─ rag/               # BM25 + Vector RRF 混合检索
│  ├─ eval/                 # RAG 离线量化评测集与消融脚本
│  └─ tests/                # Pytest 算法、并发防超卖与多轮接口测试
├─ frontend/                # React 18 + TypeScript + Vite 前端
│  ├─ public/scenes/        # 景区矢量插画资源
│  └─ src/
│     ├─ api/               # REST 客户端与 ReadableStream SSE 解析
│     └─ components/        # AI 工作台 / 中国地图排线 / 景点心愿单 / RAG 攻略 / 视觉图集 / 门票预约
└─ index.html ...           # 大一初版静态页面（已修复已知弹窗与 XSS 隐患）
```
