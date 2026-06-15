"""Tactical action helpers exposed as trainable PPO primitives."""

from __future__ import annotations

MAP_W = 56
WALL = 0
LOCKED_DOOR = 4
DIR_TO_KEY = {
    (0, -1): "ArrowUp",
    (0, 1): "ArrowDown",
    (-1, 0): "ArrowLeft",
    (1, 0): "ArrowRight",
}


def visible_enemies(state):
    visible = state.get("visible", set())
    if isinstance(visible, list):
        visible = set(visible)
    return [
        enemy
        for enemy in state.get("enemies", [])
        if not enemy.get("dying")
        and not enemy.get("isPet")
        and (enemy.get("y", 0) * MAP_W + enemy.get("x", 0)) in visible
    ]


def is_line_clear(state, enemy):
    player = state.get("player", {})
    dx = enemy.get("x", 0) - player.get("x", 0)
    dy = enemy.get("y", 0) - player.get("y", 0)
    if not (dx == 0 or dy == 0 or abs(dx) == abs(dy)):
        return False

    step_x = 0 if dx == 0 else (1 if dx > 0 else -1)
    step_y = 0 if dy == 0 else (1 if dy > 0 else -1)
    x = player.get("x", 0) + step_x
    y = player.get("y", 0) + step_y
    map_data = state.get("map", [])

    while x != enemy.get("x", 0) or y != enemy.get("y", 0):
        if y < 0 or y >= len(map_data) or x < 0 or x >= len(map_data[y]):
            return False
        if map_data[y][x] == WALL:
            return False
        x += step_x
        y += step_y
    return True


def choose_line_clear_enemy(state, prefer="weak"):
    candidates = [enemy for enemy in visible_enemies(state) if is_line_clear(state, enemy)]
    if not candidates:
        return None
    player = state.get("player", {})
    px, py = player.get("x", 0), player.get("y", 0)
    if prefer == "nearest":
        return min(
            candidates,
            key=lambda enemy: (
                abs(enemy.get("x", 0) - px) + abs(enemy.get("y", 0) - py),
                enemy.get("hp", 0),
                str(enemy.get("id", "")),
            ),
        )
    return min(
        candidates,
        key=lambda enemy: (
            enemy.get("hp", 0),
            abs(enemy.get("x", 0) - px) + abs(enemy.get("y", 0) - py),
            str(enemy.get("id", "")),
        ),
    )


def safest_adjacent_move(state):
    player = state.get("player", {})
    map_data = state.get("map", [])
    enemies = [
        enemy
        for enemy in state.get("enemies", [])
        if not enemy.get("dying") and not enemy.get("isPet")
    ]
    occupied = {(enemy.get("x"), enemy.get("y")) for enemy in enemies}
    px, py = player.get("x", 0), player.get("y", 0)
    nearest = _nearest_enemy(player, enemies)
    best = None

    for dx, dy in DIR_TO_KEY:
        x, y = px + dx, py + dy
        if y < 0 or y >= len(map_data) or x < 0 or x >= len(map_data[y]):
            continue
        if map_data[y][x] == WALL:
            continue
        if map_data[y][x] == LOCKED_DOOR and not _has_key(state):
            continue
        if (x, y) in occupied:
            continue

        min_dist = min(
            (abs(enemy.get("x", 0) - x) + abs(enemy.get("y", 0) - y) for enemy in enemies),
            default=99,
        )
        away_score = _away_score(nearest, dx, dy, px, py)
        candidate = (min_dist, away_score, -abs(dx), -abs(dy), -dy, -dx)
        if best is None or candidate > best[0]:
            best = (candidate, {"type": "key", "val": DIR_TO_KEY[(dx, dy)]})
    return best[1] if best else None


def _nearest_enemy(player, enemies):
    if not enemies:
        return None
    px, py = player.get("x", 0), player.get("y", 0)
    return min(
        enemies,
        key=lambda enemy: (
            abs(enemy.get("x", 0) - px) + abs(enemy.get("y", 0) - py),
            str(enemy.get("id", "")),
        ),
    )


def _away_score(enemy, dx, dy, px, py):
    if enemy is None:
        return 0
    away_x = _sign(px - enemy.get("x", 0))
    away_y = _sign(py - enemy.get("y", 0))
    return dx * away_x + dy * away_y


def _has_key(state):
    return any(
        item.get("type") == "key" and item.get("carried")
        for item in state.get("items", [])
    )


def _sign(value):
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0
