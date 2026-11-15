import json
import math
import re
from dataclasses import dataclass
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import GuideChunk
from app.db.seed import compute_char_ngram_embedding


@dataclass
class RetrievedChunk:
    id: str
    guide_id: str
    guide_title: str
    category: str
    section_title: str
    content: str
    metadata: dict
    bm25_score: float
    vector_score: float
    rrf_score: float


def _tokenize_cn_en(text: str) -> list[str]:
    """Mixed Chinese character/bigram + English word tokenizer without heavy native deps."""
    text = text.lower()
    words = re.findall(r"[a-z0-9]+", text)
    cn_chars = re.findall(r"[\u4e00-\u9fff]", text)
    cn_bigrams = [cn_chars[i] + cn_chars[i + 1] for i in range(len(cn_chars) - 1)]
    return words + cn_chars + cn_bigrams


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _bm25_scores(query_tokens: list[str], docs_tokens: list[list[str]], k1: float = 1.5, b: float = 0.75) -> list[float]:
    n_docs = len(docs_tokens)
    if n_docs == 0:
        return []
    avgdl = sum(len(d) for d in docs_tokens) / n_docs or 1.0
    df: dict[str, int] = {}
    for doc in docs_tokens:
        for t in set(doc):
            df[t] = df.get(t, 0) + 1

    scores: list[float] = []
    q_set = set(query_tokens)
    for doc in docs_tokens:
        dl = len(doc)
        tf: dict[str, int] = {}
        for t in doc:
            tf[t] = tf.get(t, 0) + 1
        score = 0.0
        for q in q_set:
            if q not in tf:
                continue
            idf = math.log(1 + (n_docs - df[q] + 0.5) / (df[q] + 0.5))
            freq = tf[q]
            score += idf * (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * dl / avgdl))
        scores.append(score)
    return scores


async def hybrid_search_guides(
    session: AsyncSession,
    query: str,
    category: str | None = None,
    top_k: int = 3,
    rrf_k: int = 60,
) -> list[RetrievedChunk]:
    """Hybrid Retrieval (BM25 Lexical + Dense Vector Cosine) merged via Reciprocal Rank Fusion (RRF)."""
    stmt = select(GuideChunk)
    if category:
        stmt = stmt.where(GuideChunk.category == category)
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []

    q_tokens = _tokenize_cn_en(query)
    q_vec = compute_char_ngram_embedding(query)

    docs_tokens = [_tokenize_cn_en(f"{r.guide_title} {r.section_title} {r.content}") for r in rows]
    bm25 = _bm25_scores(q_tokens, docs_tokens)

    vec_scores: list[float] = []
    for r in rows:
        try:
            emb = json.loads(r.embedding_json)
        except Exception:
            emb = []
        vec_scores.append(_cosine(q_vec, emb))

    bm25_rank = {idx: rank + 1 for rank, idx in enumerate(sorted(range(len(rows)), key=lambda i: -bm25[i]))}
    vec_rank = {idx: rank + 1 for rank, idx in enumerate(sorted(range(len(rows)), key=lambda i: -vec_scores[i]))}

    results: list[RetrievedChunk] = []
    for idx, r in enumerate(rows):
        rrf = 1.0 / (rrf_k + bm25_rank[idx]) + 1.0 / (rrf_k + vec_rank[idx])
        try:
            meta = json.loads(r.metadata_json)
        except Exception:
            meta = {}
        results.append(
            RetrievedChunk(
                id=r.id,
                guide_id=r.guide_id,
                guide_title=r.guide_title,
                category=r.category,
                section_title=r.section_title,
                content=r.content,
                metadata=meta,
                bm25_score=round(bm25[idx], 4),
                vector_score=round(vec_scores[idx], 4),
                rrf_score=round(rrf, 6),
            )
        )

    results.sort(key=lambda item: -item.rrf_score)
    return results[:top_k]
