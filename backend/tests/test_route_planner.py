from app.algo.route_planner import SpotNode, build_itinerary, haversine_km, solve_tsp_2opt


def _node(id_: str, lat: float, lng: float, price: int = 100, rating: float = 4.8) -> SpotNode:
    return SpotNode(
        id=id_,
        name=id_,
        city="Test",
        category="自然山水",
        price=price,
        rating=rating,
        duration_hours=3.0,
        lat=lat,
        lng=lng,
        scene="guilin.svg",
    )


def test_haversine_known_distance():
    # Beijing (39.9042, 116.4074) to Hangzhou (30.2741, 120.1551) ~ 1123 km
    dist = haversine_km(39.9042, 116.4074, 30.2741, 120.1551)
    assert 1100 < dist < 1150


def test_2opt_improves_or_matches_greedy():
    nodes = [
        _node("a", 30.0, 120.0, rating=5.0),
        _node("b", 30.8, 120.4, rating=4.7),
        _node("c", 30.2, 120.1, rating=4.6),
        _node("d", 31.5, 121.0, rating=4.5),
    ]
    ordered, greedy_km, optimized_km = solve_tsp_2opt(nodes)
    assert len(ordered) == 4
    assert optimized_km <= greedy_km


def test_build_itinerary_respects_budget():
    nodes = [
        _node("expensive", 30.0, 120.0, price=500, rating=5.0),
        _node("cheap1", 30.1, 120.1, price=80, rating=4.8),
        _node("cheap2", 30.2, 120.2, price=100, rating=4.7),
    ]
    plan = build_itinerary(nodes, days=2, budget=200)
    assert plan["total_ticket_cost"] <= 200
    spot_ids = [s["spot_id"] for d in plan["days"] for s in d["stops"]]
    assert "expensive" not in spot_ids
    assert set(spot_ids) == {"cheap1", "cheap2"}
