import asyncio
import json
from pathlib import Path
from app.main import app, lifespan
from app.db.session import AsyncSessionLocal
from app.rag.retriever import hybrid_search_guides


async def evaluate() -> None:
    dataset_path = Path(__file__).parent / "qa_dataset.json"
    cases = json.loads(dataset_path.read_text(encoding="utf-8"))

    async with lifespan(app):
        async with AsyncSessionLocal() as session:
            print(f"Loaded {len(cases)} evaluation queries.\n")
            print(f"{'Mode':<10} | {'Recall@1':>9} | {'Recall@3':>9} | {'Recall@5':>9} | {'MRR@5':>9}")
            print("-" * 58)

            for mode in ("bm25", "vector", "hybrid"):
                r1 = r3 = r5 = mrr = 0.0
                for item in cases:
                    expected = set(item["expected_chunk_ids"])
                    hits = await hybrid_search_guides(session, query=item["query"], top_k=5, mode=mode)  # type: ignore[arg-type]
                    hit_ids = [h.id for h in hits]

                    if any(cid in expected for cid in hit_ids[:1]):
                        r1 += 1
                    if any(cid in expected for cid in hit_ids[:3]):
                        r3 += 1
                    if any(cid in expected for cid in hit_ids[:5]):
                        r5 += 1
                    for rank, cid in enumerate(hit_ids[:5], start=1):
                        if cid in expected:
                            mrr += 1.0 / rank
                            break

                n = len(cases)
                print(
                    f"{mode:<10} | {r1 / n * 100:>8.1f}% | {r3 / n * 100:>8.1f}% | "
                    f"{r5 / n * 100:>8.1f}% | {mrr / n:>9.4f}"
                )


if __name__ == "__main__":
    asyncio.run(evaluate())
