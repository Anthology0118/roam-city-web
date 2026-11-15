# 漫游城市 AI · RoamCity AI

> 从大一纯静态前端课设重构升级为 **AI 应用全栈工程项目**：**React 18 + TypeScript + Vite**（前端）+ **Python FastAPI + SQLAlchemy Async**（后端）+ **Hybrid RAG（BM25 + 向量 RRF）** + **2-opt TSP 路径规划算法**。

## 核心架构与技术亮点

1. **AI 行程规划 Agent（SSE 多阶段流式编排）**
   - `backend/app/agent/planner_agent.py`：解析自然语言出行约束（天数、预算、主题、购票意图），透明推送 `status -> tool_call -> tool_result -> plan -> citations -> booking_draft -> token -> done` 多阶段 SSE 事件流。
   - 支持配置任意兼容 OpenAI 协议的模型（DeepSeek / Qwen / OpenAI），未配置 Key 时自动降级到本地确定性合成模式，保证零门槛可运行演示。
2. **确定性路径规划算法（Anti-Hallucination）**
   - `backend/app/algo/route_planner.py`：基于景点 WGS-84 经纬度计算 **Haversine 球面距离**，使用 **最近邻贪心 + 2-opt 局部搜索** 在预算与每日时长约束下求解最优游览顺序，避免大模型直接排线带来的地理绕路与价格幻觉。
3. **Hybrid RAG 攻略检索与溯源**
   - `backend/app/rag/retriever.py`：对攻略按章节切片，结合 **BM25 词法检索 + 向量余弦相似度** 并通过 **RRF（Reciprocal Rank Fusion）** 融合排序，支持前端点击跳转原文。
4. **数据库事务与乐观锁门票预约**
   - `backend/app/api/routes.py`：通过版本号 `version` 实现分景点余票乐观锁扣减，订单取消自动回滚库存。

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
# 后端单元测试与接口集成测试
cd backend
.\.venv\Scripts\python.exe -m pytest -v

# 前端类型检查与生产构建
cd frontend
npm run build
```

## 目录结构

```text
.
├─ backend/                 # Python 3.13 + FastAPI 后端
│  ├─ app/
│  │  ├─ agent/             # SSE Agent 编排与 Tool Calling
│  │  ├─ algo/              # Haversine + 2-opt 路径规划算法
│  │  ├─ api/               # REST & SSE 路由
│  │  ├─ core/              # Pydantic Settings 配置
│  │  ├─ db/                # SQLAlchemy Async 模型与种子数据
│  │  └─ rag/               # BM25 + Vector RRF 混合检索
│  └─ tests/                # Pytest 算法与接口测试
├─ frontend/                # React 18 + TypeScript + Vite 前端
│  ├─ public/scenes/        # 景区矢量插画资源
│  └─ src/
│     ├─ api/               # REST 客户端与 ReadableStream SSE 解析
│     └─ components/        # AI 工作台 / 景点检索 / RAG 攻略 / 门票预约
└─ index.html ...           # 大一初版静态页面（已修复已知弹窗与 XSS 隐患）
```
