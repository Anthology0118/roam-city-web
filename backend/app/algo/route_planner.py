from dataclasses import dataclass
import math


@dataclass(frozen=True)
class SpotNode:
    id: str
    name: str
    city: str
    category: str
    price: int
    rating: float
    duration_hours: float
    lat: float
    lng: float
    scene: str


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Compute great-circle distance in kilometers between two WGS-84 coordinates."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _total_path_km(order: list[SpotNode]) -> float:
    if len(order) < 2:
        return 0.0
    return sum(
        haversine_km(order[i].lat, order[i].lng, order[i + 1].lat, order[i + 1].lng)
        for i in range(len(order) - 1)
    )


def solve_tsp_2opt(nodes: list[SpotNode]) -> tuple[list[SpotNode], float, float]:
    """Order nodes using Greedy Nearest Neighbor followed by 2-opt local improvement.

    Returns (ordered_nodes, initial_greedy_km, optimized_km).
    """
    if len(nodes) <= 2:
        dist = _total_path_km(nodes)
        return list(nodes), round(dist, 2), round(dist, 2)

    # Start from the highest-rated spot to keep the opening anchor strong
    remaining = sorted(nodes, key=lambda n: (-n.rating, n.price))
    route = [remaining.pop(0)]
    while remaining:
        last = route[-1]
        nearest_idx = min(
            range(len(remaining)),
            key=lambda idx: haversine_km(last.lat, last.lng, remaining[idx].lat, remaining[idx].lng),
        )
        route.append(remaining.pop(nearest_idx))

    greedy_km = _total_path_km(route)

    # Open-path 2-opt improvement (keep start fixed, reverse sub-segments if shorter)
    improved = True
    while improved:
        improved = False
        n = len(route)
        for i in range(1, n - 1):
            for k in range(i + 1, n):
                candidate = route[:i] + list(reversed(route[i : k + 1])) + route[k + 1 :]
                if _total_path_km(candidate) + 1e-6 < _total_path_km(route):
                    route = candidate
                    improved = True
                    break
            if improved:
                break

    optimized_km = _total_path_km(route)
    return route, round(greedy_km, 2), round(optimized_km, 2)


def build_itinerary(
    candidates: list[SpotNode],
    days: int = 3,
    budget: int | None = None,
    max_hours_per_day: float = 8.0,
) -> dict:
    """Select budget-feasible spots and partition the 2-opt optimized sequence across days."""
    # Greedy selection prioritizing rating & value within ticket budget
    selected: list[SpotNode] = []
    ticket_cost = 0
    for node in sorted(candidates, key=lambda n: (-n.rating, n.price)):
        if len(selected) >= max(1, days * 2):
            break
        if budget is not None and ticket_cost + node.price > budget:
            continue
        selected.append(node)
        ticket_cost += node.price

    if not selected and candidates:
        cheapest = min(candidates, key=lambda n: n.price)
        selected = [cheapest]
        ticket_cost = cheapest.price

    ordered, greedy_km, optimized_km = solve_tsp_2opt(selected)

    # Partition ordered stops into daily buckets respecting max_hours_per_day
    day_buckets: list[list[dict]] = [[] for _ in range(max(1, days))]
    day_hours = [0.0 for _ in range(max(1, days))]
    cur_day = 0

    for idx, spot in enumerate(ordered):
        if day_buckets[cur_day] and day_hours[cur_day] + spot.duration_hours > max_hours_per_day and cur_day < len(day_buckets) - 1:
            cur_day += 1
        leg_km = (
            round(haversine_km(ordered[idx - 1].lat, ordered[idx - 1].lng, spot.lat, spot.lng), 1)
            if idx > 0
            else 0.0
        )
        day_buckets[cur_day].append(
            {
                "spot_id": spot.id,
                "name": spot.name,
                "city": spot.city,
                "category": spot.category,
                "price": spot.price,
                "duration_hours": spot.duration_hours,
                "lat": spot.lat,
                "lng": spot.lng,
                "scene": spot.scene,
                "distance_from_prev_km": leg_km,
            }
        )
        day_hours[cur_day] += spot.duration_hours

    days_plan = [
        {"day": f"D{i + 1}", "total_hours": round(day_hours[i], 1), "stops": stops}
        for i, stops in enumerate(day_buckets)
        if stops
    ]

    return {
        "days_requested": days,
        "budget": budget,
        "total_ticket_cost": ticket_cost,
        "greedy_distance_km": greedy_km,
        "optimized_distance_km": optimized_km,
        "distance_saved_km": round(max(0.0, greedy_km - optimized_km), 2),
        "days": days_plan,
    }
