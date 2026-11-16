"""Offline quantitative evaluation benchmark for the Travel AI Agent pipeline.

Usage (from backend/):
  PYTHONPATH=. python -m eval.eval_agent
"""

import asyncio
import json
from pathlib import Path
import uuid

from sqlalchemy import delete, select
from app.agent.planner_agent import stream_travel_agent
from app.db.models import ChatTurn, Spot
from app.db.session import AsyncSessionLocal
from app.main import app, lifespan


def _parse_sse_events(raw_chunks: list[str]) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    buf = "".join(raw_chunks)
    for block in buf.split("\n\n"):
        if not block.strip():
            continue
        ev_name = "message"
        data_line = ""
        for line in block.splitlines():
            if line.startswith("event:"):
                ev_name = line[6:].strip()
            elif line.startswith("data:"):
                data_line += line[5:].strip()
        if data_line:
            events.append((ev_name, json.loads(data_line)))
    return events


async def run_eval() -> None:
    async with lifespan(app):
        async with AsyncSessionLocal() as db:
            spot_map = {s.id: s for s in (await db.execute(select(Spot))).scalars().all()}

        ds_path = Path(__file__).with_name("agent_eval_dataset.json")
        cases = json.loads(ds_path.read_text(encoding="utf-8"))

        total = len(cases)
        pass_count = 0
        zero_hallucination = 0
        budget_ok = 0
        exclusion_ok = 0
        booking_ok = 0
        eval_sids: list[str] = []

        for case in cases:
            sid = f"eval-{case['id']}-{uuid.uuid4().hex[:6]}"
            eval_sids.append(sid)
            last_events: list[tuple[str, dict]] = []
            async with AsyncSessionLocal() as db:
                for turn_query in case["turns"]:
                    chunks = [chunk async for chunk in stream_travel_agent(turn_query, db, session_id=sid)]
                    last_events = _parse_sse_events(chunks)

            plan = next((p for ev, p in last_events if ev == "plan"), None)
            draft = next((p for ev, p in last_events if ev == "booking_draft"), None)
            cites = next((p.get("items", []) for ev, p in last_events if ev == "citations"), [])

            # Check zero hallucination: every stop exists in DB and prices match DB exactly
            stops = [st for d in (plan or {}).get("days", []) for st in d.get("stops", [])]
            hallucinated = False
            if not stops:
                hallucinated = True
            else:
                computed_cost = 0
                for st in stops:
                    db_spot = spot_map.get(st["spot_id"])
                    if not db_spot or db_spot.price != st["price"]:
                        hallucinated = True
                        break
                    computed_cost += db_spot.price
                if computed_cost != plan["total_ticket_cost"]:
                    hallucinated = True
            if not hallucinated:
                zero_hallucination += 1

            # Budget compliance
            b_ok = case["max_budget"] is None or (plan is not None and plan["total_ticket_cost"] <= case["max_budget"])
            if b_ok:
                budget_ok += 1

            # Exclusion compliance
            ex_provs = case.get("must_exclude_provinces", [])
            ex_ok = True
            for st in stops:
                if any(p in st["city"] for p in ex_provs):
                    ex_ok = False
                    break
            if ex_ok:
                exclusion_ok += 1

            # Booking draft & count compliance
            bk_ok = (draft is not None) == bool(case["expect_booking_draft"])
            if bk_ok and draft is not None and "expected_count" in case:
                bk_ok = draft["suggested_count"] == case["expected_count"]
            if bk_ok:
                booking_ok += 1

            # Pace / start city check
            start_ok = True
            if case.get("expected_start_city") and stops:
                start_ok = case["expected_start_city"] in stops[0]["city"] or case["expected_start_city"] in stops[0]["name"]

            pace_ok = True
            if case.get("max_hours_per_day") and plan:
                pace_ok = all(d["total_hours"] <= case["max_hours_per_day"] + 2.0 for d in plan["days"])

            days_ok = plan is not None and plan.get("days_requested") == case["expected_days"]
            cites_ok = len(cites) > 0

            if not hallucinated and b_ok and ex_ok and bk_ok and start_ok and pace_ok and days_ok and cites_ok:
                pass_count += 1
            else:
                print(
                    f"FAILED {case['id']}: hal={hallucinated} b={b_ok} ex={ex_ok} "
                    f"bk={bk_ok} start={start_ok} pace={pace_ok} days={days_ok} cites={cites_ok}"
                )

        # Clean up ephemeral evaluation turns
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ChatTurn).where(ChatTurn.session_id.in_(eval_sids)))
            await db.commit()

        print(f"Loaded {total} multi-turn & constraint Agent cases.")
        print(f"Overall Constraint Pass Rate : {pass_count}/{total} ({pass_count / total * 100:.1f}%)")
        print(f"Zero-Hallucination Grounding : {zero_hallucination}/{total} ({zero_hallucination / total * 100:.1f}%)")
        print(f"Budget Compliance            : {budget_ok}/{total} ({budget_ok / total * 100:.1f}%)")
        print(f"Negative Exclusion Accuracy  : {exclusion_ok}/{total} ({exclusion_ok / total * 100:.1f}%)")
        print(f"Booking Draft Trigger Rate   : {booking_ok}/{total} ({booking_ok / total * 100:.1f}%)")


if __name__ == "__main__":
    asyncio.run(run_eval())
