extends RefCounted
## THAN-DOR — симуляция боя (перенос prototype/js/sim.js).
##
## Правила игры живут ТОЛЬКО здесь. Сцена (Main.gd) вызывает update(dt),
## читает массивы units/buildings и рисует. Так одну и ту же логику легко
## тестировать и переносить между прототипом и целевым движком.
##
## Логическая частота — 20 Гц (см. project.godot), но update() принимает dt
## и работает с любым шагом.

const C := preload("res://core/config.gd")

const TS := 48.0
const WORLD_W := 40
const WORLD_H := 40

var time := 0.0
var result := "playing"

var units: Array = []
var buildings: Array = []
var projectiles: Array = []
var effects: Array = []
var events: Array = []

var teams := {}
var tiles := PackedByteArray()
var xenite_left := PackedFloat32Array()
var occupied := PackedByteArray()
var visible := PackedByteArray()
var explored := PackedByteArray()

var ai := {}
var _next_id := 1


func _init() -> void:
	reset()


func reset() -> void:
	_next_id = 1
	time = 0.0
	result = "playing"
	units.clear()
	buildings.clear()
	projectiles.clear()
	effects.clear()
	events.clear()
	visible.resize(WORLD_W * WORLD_H)
	explored.resize(WORLD_W * WORLD_H)
	visible.fill(0)
	explored.fill(0)

	teams = {
		"player": {"xenite": C.BALANCE["startXenite"], "researched": {}, "techQueue": [], "buildQueue": [], "lost": 0},
		"enemy": {"xenite": C.BALANCE["enemyStartXenite"], "researched": {}, "techQueue": [], "buildQueue": [], "lost": 0},
	}

	tiles.resize(WORLD_W * WORLD_H)
	occupied.resize(WORLD_W * WORLD_H)
	occupied.fill(0)
	xenite_left.resize(WORLD_W * WORLD_H)
	for ty in WORLD_H:
		var row: String = C.MAP[ty]
		for tx in WORLD_W:
			var t := int(row[tx])
			var i := _idx(tx, ty)
			tiles[i] = t
			if t == C.TILE["XENITE"]:
				xenite_left[i] = float(C.BALANCE["xenitePatch"])

	ai = {"nextThink": 0.0, "waveIndex": 0, "nextWave": float(C.ENEMY_AI["firstWaveAt"])}

	_spawn_start()
	recompute_visibility()
	announce("start")


func _idx(tx: int, ty: int) -> int:
	return ty * WORLD_W + tx


# ── стартовая расстановка ────────────────────────────────────────────────────
func _spawn_start() -> void:
	var p: Dictionary = C.LEVEL["playerHC"]
	var e: Dictionary = C.LEVEL["enemyHC"]
	add_building("player", "commandCenter", p["tx"] * TS + TS / 2.0, p["ty"] * TS + TS / 2.0, true)
	add_building("player", "factory", (p["tx"] + 2) * TS + TS / 2.0, p["ty"] * TS + TS / 2.0, true)
	add_unit("player", "harvester", (p["tx"] + 1) * TS, (p["ty"] + 1) * TS)
	add_unit("player", "harvester", (p["tx"] + 2) * TS, (p["ty"] + 1) * TS)
	add_unit("player", "rifleman", (p["tx"] + 3) * TS, (p["ty"] + 1) * TS)

	add_building("enemy", "commandCenter", e["tx"] * TS + TS / 2.0, e["ty"] * TS + TS / 2.0, true)
	add_building("enemy", "factory", (e["tx"] - 2) * TS + TS / 2.0, e["ty"] * TS + TS / 2.0, true)
	add_unit("enemy", "harvester", (e["tx"] - 1) * TS, (e["ty"] + 1) * TS)
	add_unit("enemy", "harvester", (e["tx"] - 2) * TS, (e["ty"] + 1) * TS)
	add_unit("enemy", "rifleman", (e["tx"] - 3) * TS, (e["ty"] + 1) * TS)

	for i in int(C.ENEMY_AI["guardTurrets"]):
		add_building("enemy", "turret", (e["tx"] - 4 + i * 3) * TS + TS / 2.0,
			(e["ty"] + 3) * TS + TS / 2.0, true)


func add_unit(team: String, type: String, x: float, y: float) -> Dictionary:
	if not C.UNITS.has(type):
		return {}
	var def: Dictionary = C.UNITS[type]
	var mods := self.mods(team)
	var hp_mul := 1.0
	if def["role"] == "vehicle":
		hp_mul = 1.0 + float(mods["hpVehicle"])
	var hp_max := int(round(float(def["hp"]) * hp_mul))
	var u := {
		"id": _next_id, "kind": "unit", "team": team, "type": type, "def": def,
		"x": x, "y": y, "hpMax": hp_max, "hp": hp_max,
		"radius": float(def["radius"]), "cooldown": 0.0, "facing": 0.0,
		"order": {"type": "idle"}, "path": [], "pathIdx": 0, "repathIn": 0.0,
		"target": {}, "carrying": 0, "harvestTimer": 0.0,
		"homeX": x, "homeY": y, "alive": true, "hitFlash": 0.0, "muzzle": 0.0,
		"moving": false
	}
	_next_id += 1
	units.append(u)
	return u


func add_building(team: String, type: String, x: float, y: float, complete: bool) -> Dictionary:
	if not C.BUILDINGS.has(type):
		return {}
	var def: Dictionary = C.BUILDINGS[type]
	var hp_full := int(def["hp"])
	var b := {
		"id": _next_id, "kind": "building", "team": team, "type": type, "def": def,
		"x": x, "y": y, "hpMax": hp_full,
		"hp": hp_full if complete else int(round(hp_full * 0.35)),
		"radius": float(def["radius"]), "cooldown": 0.0, "facing": PI,
		"built": complete, "progress": 1.0 if complete else 0.0,
		"queue": [], "alive": true, "hitFlash": 0.0, "muzzle": 0.0, "target": {},
		"total": float(def.get("buildTime", 1.0))
	}
	_next_id += 1
	buildings.append(b)
	_mark_occupied(b, 1)
	return b


func _mark_occupied(b: Dictionary, v: int) -> void:
	var r := int(ceil(float(b["radius"]) / TS))
	var cx := int(b["x"] / TS)
	var cy := int(b["y"] / TS)
	for ty in range(cy - r, cy + r + 1):
		for tx in range(cx - r, cx + r + 1):
			if tx < 0 or ty < 0 or tx >= WORLD_W or ty >= WORLD_H:
				continue
			if _dist(tx * TS + TS / 2.0, ty * TS + TS / 2.0, b["x"], b["y"]) <= float(b["radius"]) + TS * 0.3:
				occupied[_idx(tx, ty)] = v


# ── модификаторы технологий ──────────────────────────────────────────────────
func mods(team: String) -> Dictionary:
	var set: Dictionary = teams[team]["researched"]
	var m := {"dmg": 0.0, "hpVehicle": 0.0, "speed": 0.0, "harvest": 0.0, "costMod": 0.0, "buildTime": 0.0}
	for t in C.TECHS:
		if not set.has(t["id"]):
			continue
		for key in ["dmg", "hpVehicle", "speed", "harvest", "costMod", "buildTime"]:
			if t.has(key):
				m[key] += float(t[key])
	return m


func has_tech(team: String, id: String) -> bool:
	return teams[team]["researched"].has(id)


func unit_cost(team: String, type: String) -> int:
	var def: Dictionary = C.UNITS[type]
	var m := mods(team)
	return max(10, int(round(float(def["cost"]) * (1.0 + float(m["costMod"])))))


func build_time(team: String, type: String) -> float:
	var def: Dictionary = C.UNITS[type] if C.UNITS.has(type) else C.BUILDINGS[type]
	var m := mods(team)
	return max(1.0, float(def["buildTime"]) * (1.0 + float(m["buildTime"])))


# ── проходимость и поиск пути ────────────────────────────────────────────────
func passable(tx: int, ty: int, hover: bool) -> bool:
	if tx < 0 or ty < 0 or tx >= WORLD_W or ty >= WORLD_H:
		return false
	var i := _idx(tx, ty)
	var t := tiles[i]
	if t == C.TILE["ROCK"] or t == C.TILE["WATER"]:
		return hover
	return occupied[i] == 0


func find_path(sx: float, sy: float, gx: float, gy: float, hover: bool) -> Array:
	var stx := clampi(int(sx / TS), 0, WORLD_W - 1)
	var sty := clampi(int(sy / TS), 0, WORLD_H - 1)
	var gtx := clampi(int(gx / TS), 0, WORLD_W - 1)
	var gty := clampi(int(gy / TS), 0, WORLD_H - 1)

	if not passable(gtx, gty, hover):
		var found_goal := _nearest_passable(gtx, gty, hover)
		if found_goal.size() == 0:
			return []
		gtx = found_goal[0]
		gty = found_goal[1]
	if not passable(stx, sty, hover):
		var found_start := _nearest_passable(stx, sty, hover)
		if found_start.size() == 0:
			return []
		stx = found_start[0]
		sty = found_start[1]

	if stx == gtx and sty == gty:
		return [{"tx": gtx, "ty": gty}]

	var start_i := _idx(stx, sty)
	var goal_i := _idx(gtx, gty)
	# открытый список: [f, index]; линейный поиск минимума — карта маленькая
	var open: Array = [[_h(start_i, gtx, gty), start_i]]
	var came := {}
	var cost := {start_i: 0.0}
	var visited := {}

	while open.size() > 0:
		# берём узел с минимальным f
		var best := 0
		for k in range(1, open.size()):
			if open[k][0] < open[best][0]:
				best = k
		var cur: int = open[best][1]
		open.remove_at(best)
		if cur == goal_i:
			break
		if visited.has(cur):
			continue
		visited[cur] = true
		var cx := cur % WORLD_W
		var cy := cur / WORLD_W
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				if dx == 0 and dy == 0:
					continue
				var nx := cx + dx
				var ny := cy + dy
				if not passable(nx, ny, hover):
					continue
				if dx != 0 and dy != 0:
					if not passable(cx + dx, cy, hover) or not passable(cx, cy + dy, hover):
						continue
				var ni := _idx(nx, ny)
				var ng: float = float(cost[cur]) + (1.41421356 if (dx != 0 and dy != 0) else 1.0)
				if not cost.has(ni) or ng < float(cost[ni]):
					cost[ni] = ng
					came[ni] = cur
					open.append([ng + _h(ni, gtx, gty), ni])

	if not came.has(goal_i):
		return []
	var out: Array = []
	var cur2 := goal_i
	while cur2 != start_i:
		out.append({"tx": cur2 % WORLD_W, "ty": cur2 / WORLD_W})
		if not came.has(cur2):
			return []
		cur2 = came[cur2]
	out.reverse()
	return out


func _h(i: int, gtx: int, gty: int) -> float:
	var tx := i % WORLD_W
	var ty := i / WORLD_W
	var dx := abs(tx - gtx)
	var dy := abs(ty - gty)
	return float(dx + dy) + (1.41421356 - 2.0) * float(mini(dx, dy))


func _nearest_passable(gtx: int, gty: int, hover: bool) -> Array:
	var best := []
	var best_d := INF
	for r in range(1, 6):
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				var tx := gtx + dx
				var ty := gty + dy
				if not passable(tx, ty, hover):
					continue
				var d := float(dx * dx + dy * dy)
				if d < best_d:
					best_d = d
					best = [tx, ty]
		if best.size() > 0:
			return best
	return best


func set_path_to(u: Dictionary, x: float, y: float) -> bool:
	var path := find_path(u["x"], u["y"], x, y, bool(u["def"].get("hover", false)))
	if path.size() == 0:
		u["path"] = []
		return false
	u["path"] = path
	u["pathIdx"] = 0
	u["goalX"] = x
	u["goalY"] = y
	return true


# ── команды ──────────────────────────────────────────────────────────────────
func issue_order(team: String, ids: Array, wx: float, wy: float, mode: String) -> int:
	var list: Array = []
	for u in units:
		if u["team"] == team and u["alive"] and ids.has(u["id"]):
			list.append(u)
	var n := 0
	for u in list:
		u["target"] = {}
		if u["def"]["role"] == "worker" and mode != "attack":
			u["order"] = {"type": "move", "x": wx, "y": wy}
		else:
			u["order"] = {"type": "attackMove" if mode == "attack" else "move", "x": wx, "y": wy}
		var angle := (float(n) / float(max(1, list.size()))) * TAU
		var spread := 0.0
		if list.size() > 1:
			spread = min(46.0, 12.0 + list.size() * 3.0)
		set_path_to(u, wx + cos(angle) * spread, wy + sin(angle) * spread)
		n += 1
	return n


func order_attack_target(team: String, ids: Array, target_id: int) -> void:
	var target := find_by_id(target_id)
	if target.is_empty():
		return
	for u in units:
		if u["team"] != team or not ids.has(u["id"]) or not u["alive"]:
			continue
		if u["def"]["role"] == "worker":
			continue
		u["target"] = target
		u["order"] = {"type": "attack", "targetId": target_id}
		u["path"] = []


func order_harvest(team: String, ids: Array, tx: int, ty: int) -> void:
	for u in units:
		if u["team"] != team or not ids.has(u["id"]) or not u["alive"]:
			continue
		if u["def"]["role"] != "worker":
			continue
		u["order"] = {"type": "harvest", "tx": tx, "ty": ty}
		u["target"] = {}
		u["path"] = []
		u["repathIn"] = 0.0
		set_path_to(u, tx * TS + TS / 2.0, ty * TS + TS / 2.0)


func set_rally(team: String, building_id: int, wx: float, wy: float) -> void:
	var b := find_by_id(building_id)
	if not b.is_empty() and b["team"] == team:
		b["rallyX"] = wx
		b["rallyY"] = wy


func train_unit(team: String, building_id: int, type: String, free := false) -> Dictionary:
	var b := find_by_id(building_id)
	var t: Dictionary = teams[team]
	if b.is_empty() or b["kind"] != "building" or b["team"] != team:
		return {"ok": false, "reason": "bad-building"}
	if not b["built"] or not b["def"]["produces"]:
		return {"ok": false, "reason": "not-factory"}
	if not C.UNITS.has(type):
		return {"ok": false, "reason": "bad-unit"}
	var def: Dictionary = C.UNITS[type]
	if def.has("tech") and not t["researched"].has(def["tech"]):
		return {"ok": false, "reason": "locked"}
	if b["queue"].size() >= 5:
		return {"ok": false, "reason": "queue-full"}
	var cost := 0 if free else unit_cost(team, type)
	if not free and t["xenite"] < cost:
		return {"ok": false, "reason": "no-money"}
	t["xenite"] -= cost
	b["queue"].append({"type": type, "progress": 0.0, "total": 0.6 if free else build_time(team, type)})
	return {"ok": true}


func place_building(team: String, type: String, wx: float, wy: float, free := false) -> Dictionary:
	if not C.BUILDINGS.has(type):
		return {"ok": false, "reason": "bad-type"}
	var def: Dictionary = C.BUILDINGS[type]
	var t: Dictionary = teams[team]
	var tx := int(wx / TS)
	var ty := int(wy / TS)
	if tx < 1 or ty < 1 or tx >= WORLD_W - 1 or ty >= WORLD_H - 1:
		return {"ok": false, "reason": "outside"}
	if tiles[_idx(tx, ty)] != C.TILE["GROUND"] or occupied[_idx(tx, ty)] != 0:
		return {"ok": false, "reason": "blocked"}
	if not within_build_radius(team, wx, wy):
		return {"ok": false, "reason": "radius"}
	var cost := 0 if free else int(def["cost"])
	if not free and t["xenite"] < cost:
		return {"ok": false, "reason": "no-money"}
	if free:
		add_building(team, type, wx, wy, true)
		return {"ok": true}
	t["xenite"] -= cost
	t["buildQueue"].append({"type": type, "x": wx, "y": wy, "progress": 0.0, "total": float(def["buildTime"])})
	return {"ok": true, "queued": true}


func within_build_radius(team: String, wx: float, wy: float) -> bool:
	var r := float(C.BALANCE["buildRadius"]) * TS
	for b in buildings:
		if b["team"] == team and b["alive"] and _dist(b["x"], b["y"], wx, wy) < r:
			return true
	return false


func research(team: String, tech_id: String, free := false) -> Dictionary:
	var t: Dictionary = teams[team]
	var tech: Dictionary = {}
	for x in C.TECHS:
		if x["id"] == tech_id:
			tech = x
			break
	if tech.is_empty():
		return {"ok": false, "reason": "bad-tech"}
	if t["researched"].has(tech_id):
		return {"ok": false, "reason": "done"}
	for q in t["techQueue"]:
		if q["id"] == tech_id:
			return {"ok": false, "reason": "queued"}
	for r in tech["requires"]:
		if not t["researched"].has(r):
			return {"ok": false, "reason": "requires"}
	var cost := 0 if free else int(tech["cost"])
	if not free and t["xenite"] < cost:
		return {"ok": false, "reason": "no-money"}
	t["xenite"] -= cost
	t["techQueue"].append({"id": tech_id, "progress": 0.0, "total": 0.5 if free else float(tech["time"])})
	return {"ok": true}


func find_by_id(id: int) -> Dictionary:
	for b in buildings:
		if b["id"] == id:
			return b
	for u in units:
		if u["id"] == id:
			return u
	return {}


# ── урон ─────────────────────────────────────────────────────────────────────
func damage(target: Dictionary, amount: float, attacker_team: String) -> void:
	if target.is_empty() or not target["alive"]:
		return
	var armor := float(target["def"].get("armor", 0))
	var dmg := max(1.0, amount - armor * 2.0)
	target["hp"] -= dmg
	target["hitFlash"] = 0.18
	effects.append({"type": "hit", "x": target["x"], "y": target["y"] - float(target["radius"]),
		"life": 0.6, "max": 0.6, "text": "-" + str(int(round(dmg))), "team": attacker_team})
	if target["hp"] <= 0.0:
		_kill(target)


func _kill(e: Dictionary) -> void:
	if not e["alive"]:
		return
	e["alive"] = false
	effects.append({"type": "boom", "x": e["x"], "y": e["y"], "life": 0.6, "max": 0.6,
		"big": e["kind"] == "building"})
	if e["kind"] == "building":
		_mark_occupied(e, 0)
	if e["team"] == "player":
		teams["player"]["lost"] += 1
	if e["type"] == "commandCenter":
		_finish("win" if e["team"] == "enemy" else "lose")


func _finish(res: String) -> void:
	if result != "playing":
		return
	result = res
	announce("victory" if res == "win" else "defeat")


func announce(key: String) -> void:
	events.append({"type": "announce", "key": key, "text": C.ANNOUNCER.get(key, "")})


func toast(text: String, kind := "info") -> void:
	events.append({"type": "toast", "text": text, "kind": kind})


func drain_events() -> Array:
	var e := events.duplicate()
	events.clear()
	return e


# ── цели ─────────────────────────────────────────────────────────────────────
func nearest_enemy(u: Dictionary, max_range: float) -> Dictionary:
	var best := {}
	var best_d := max_range
	for b in buildings:
		if b["team"] == u["team"] or not b["alive"]:
			continue
		var d := _dist(u["x"], u["y"], b["x"], b["y"]) - float(b["radius"])
		if d < best_d:
			best_d = d
			best = b
	for e in units:
		if e["team"] == u["team"] or not e["alive"]:
			continue
		var d2 := _dist(u["x"], u["y"], e["x"], e["y"])
		if d2 < best_d:
			best_d = d2
			best = e
	return best


func in_range(a: Dictionary, b: Dictionary) -> bool:
	var reach := float(a["def"].get("range", 0)) + float(b["radius"])
	return _dist(a["x"], a["y"], b["x"], b["y"]) <= reach


# ── движение ─────────────────────────────────────────────────────────────────
func move_unit(u: Dictionary, dt: float, speed_mul: float) -> bool:
	var path: Array = u["path"]
	if path.is_empty() or int(u["pathIdx"]) >= path.size():
		u["moving"] = false
		return true
	var node: Dictionary = path[int(u["pathIdx"])]
	var tx: float = node["tx"] * TS + TS / 2.0
	var ty: float = node["ty"] * TS + TS / 2.0
	var d := _dist(u["x"], u["y"], tx, ty)
	if d < 6.0:
		u["pathIdx"] = int(u["pathIdx"]) + 1
		if int(u["pathIdx"]) >= path.size():
			u["moving"] = false
			u["path"] = []
			return true
		return false
	var speed := float(u["def"]["speed"]) * speed_mul
	var step := min(d, speed * dt)
	u["x"] += ((tx - u["x"]) / d) * step
	u["y"] += ((ty - u["y"]) / d) * step
	u["facing"] = atan2(ty - u["y"], tx - u["x"])
	u["moving"] = true
	return false


func separate() -> void:
	var n := units.size()
	for i in n:
		var a: Dictionary = units[i]
		if not a["alive"]:
			continue
		for j in range(i + 1, n):
			var b: Dictionary = units[j]
			if not b["alive"]:
				continue
			var dx: float = b["x"] - a["x"]
			var dy: float = b["y"] - a["y"]
			var d2 := dx * dx + dy * dy
			var min_d: float = float(a["radius"]) + float(b["radius"])
			if d2 > min_d * min_d or d2 < 0.0001:
				continue
			var d := sqrt(d2)
			var push := (min_d - d) * 0.5
			var nx := dx / d
			var ny := dy / d
			a["x"] -= nx * push
			a["y"] -= ny * push
			b["x"] += nx * push
			b["y"] += ny * push


func keep_in_bounds(u: Dictionary) -> void:
	var r: float = u["radius"]
	u["x"] = clampf(u["x"], r, WORLD_W * TS - r)
	u["y"] = clampf(u["y"], r, WORLD_H * TS - r)


# ── сборщики ─────────────────────────────────────────────────────────────────
func update_harvester(u: Dictionary, dt: float, m: Dictionary) -> void:
	var t: Dictionary = teams[u["team"]]
	var o: Dictionary = u["order"]
	var otype: String = o["type"]

	if otype == "harvest":
		if int(u["carrying"]) > 0:
			var dep: Dictionary = nearest_deposit(u)
			if dep.is_empty():
				u["order"] = {"type": "idle"}
				return
			var dr := float(C.BALANCE["depositRange"])
			if dep["def"].has("depositRange"):
				dr = float(dep["def"]["depositRange"])
			if _dist(u["x"], u["y"], dep["x"], dep["y"]) <= dr:
				t["xenite"] += int(u["carrying"])
				u["carrying"] = 0
				u["harvestTimer"] = 0.0
			elif u["path"].is_empty():
				set_path_to(u, dep["x"], dep["y"])
			else:
				move_unit(u, dt, 1.0)
			return

		var i := _idx(o["tx"], o["ty"])
		if tiles[i] != C.TILE["XENITE"] or xenite_left[i] <= 0.0:
			var found := find_nearest_xenite(o["tx"], o["ty"])
			if found.is_empty():
				u["order"] = {"type": "idle"}
				return
			o["tx"] = found["tx"]
			o["ty"] = found["ty"]
			u["path"] = []
			set_path_to(u, o["tx"] * TS + TS / 2.0, o["ty"] * TS + TS / 2.0)
			return
		var px: float = o["tx"] * TS + TS / 2.0
		var py: float = o["ty"] * TS + TS / 2.0
		if _dist(u["x"], u["y"], px, py) > TS * 0.95:
			if u["path"].is_empty():
				set_path_to(u, px, py)
			else:
				move_unit(u, dt, 1.0)
			return
		u["path"] = []
		u["harvestTimer"] = float(u["harvestTimer"]) + dt
		if float(u["harvestTimer"]) >= float(C.BALANCE["harvestTime"]):
			u["harvestTimer"] = 0.0
			var amount := mini(
				int(round(float(C.BALANCE["harvestCarry"]) * (1.0 + float(m["harvest"])))),
				int(xenite_left[i])
			)
			xenite_left[i] -= amount
			u["carrying"] = amount
			if xenite_left[i] <= 0.0:
				effects.append({"type": "depleted", "x": px, "y": py, "life": 1.0, "max": 1.0})
		return

	if otype == "idle" and int(u["carrying"]) == 0:
		var found2 := find_nearest_xenite(int(u["x"] / TS), int(u["y"] / TS))
		if not found2.is_empty():
			u["order"] = {"type": "harvest", "tx": found2["tx"], "ty": found2["ty"]}
			set_path_to(u, found2["tx"] * TS + TS / 2.0, found2["ty"] * TS + TS / 2.0)
	elif otype == "move":
		if not u["path"].is_empty():
			if move_unit(u, dt, 1.0):
				u["order"] = {"type": "idle"}
		elif _dist(u["x"], u["y"], o["x"], o["y"]) > 18.0:
			set_path_to(u, o["x"], o["y"])
		else:
			u["order"] = {"type": "idle"}


func nearest_deposit(u: Dictionary) -> Dictionary:
	var best := {}
	var best_d := INF
	for b in buildings:
		if b["team"] != u["team"] or not b["alive"] or not b["built"]:
			continue
		if not bool(b["def"].get("deposit", false)):
			continue
		var d := _dist(u["x"], u["y"], b["x"], b["y"])
		if d < best_d:
			best_d = d
			best = b
	return best


func find_nearest_xenite(ctx: int, cty: int) -> Dictionary:
	var best := {}
	var best_d := INF
	for ty in WORLD_H:
		for tx in WORLD_W:
			var i := _idx(tx, ty)
			if tiles[i] != C.TILE["XENITE"] or xenite_left[i] <= 0.0:
				continue
			var d := (tx - ctx) * (tx - ctx) + (ty - cty) * (ty - cty)
			if d < best_d:
				best_d = d
				best = {"tx": tx, "ty": ty}
	return best


# ── боевые юниты ─────────────────────────────────────────────────────────────
func update_combat_unit(u: Dictionary, dt: float, m: Dictionary) -> void:
	var speed_mul := 1.0 + float(m["speed"])
	var dmg_mul := 1.0 + float(m["dmg"])
	var o: Dictionary = u["order"]

	if not u["target"].is_empty() and not u["target"]["alive"]:
		u["target"] = {}

	if u["target"].is_empty() and o.has("targetId"):
		var tgt := find_by_id(int(o["targetId"]))
		if not tgt.is_empty() and tgt["alive"]:
			u["target"] = tgt

	if u["target"].is_empty() and (o["type"] == "idle" or o["type"] == "attackMove" or o["type"] == "attack"):
		var found := nearest_enemy(u, float(u["def"]["sight"]) * TS)
		if not found.is_empty():
			if o["type"] != "idle" or _dist(u["x"], u["y"], u["homeX"], u["homeY"]) < float(u["def"]["sight"]) * TS * 0.8:
				u["target"] = found

	u["cooldown"] = max(0.0, float(u["cooldown"]) - dt)
	if not u["target"].is_empty() and u["target"]["alive"] and float(u["def"]["damage"]) > 0.0:
		if in_range(u, u["target"]):
			u["path"] = []
			u["facing"] = atan2(u["target"]["y"] - u["y"], u["target"]["x"] - u["x"])
			if float(u["cooldown"]) <= 0.0:
				u["cooldown"] = float(u["def"]["cooldown"])
				u["muzzle"] = 0.12
				projectiles.append({
					"x": u["x"], "y": u["y"] - 6.0,
					"tx": u["target"]["x"], "ty": u["target"]["y"],
					"life": 0.16, "max": 0.16, "team": u["team"],
					"splash": float(u["def"].get("splash", 0)),
					"target": u["target"], "dmg": float(u["def"]["damage"]) * dmg_mul
				})
				if float(u["def"].get("splash", 0)) > 0.0:
					effects.append({"type": "boom", "x": u["target"]["x"], "y": u["target"]["y"],
						"life": 0.4, "max": 0.4})
			return
		u["repathIn"] = float(u["repathIn"]) - dt
		if float(u["repathIn"]) <= 0.0 or u["path"].is_empty():
			u["repathIn"] = 0.6
			set_path_to(u, u["target"]["x"], u["target"]["y"])

	if not u["path"].is_empty():
		if move_unit(u, dt, speed_mul):
			if o["type"] == "move" or o["type"] == "attackMove":
				if o["type"] == "move":
					u["order"] = {"type": "idle"}
				u["homeX"] = u["x"]
				u["homeY"] = u["y"]
	elif o["type"] == "move" or o["type"] == "attackMove":
		if _dist(u["x"], u["y"], o["x"], o["y"]) > 18.0:
			set_path_to(u, o["x"], o["y"])
		elif o["type"] == "move":
			u["order"] = {"type": "idle"}
			u["homeX"] = u["x"]
			u["homeY"] = u["y"]


# ── постройки ────────────────────────────────────────────────────────────────
func update_building(b: Dictionary, dt: float, m: Dictionary) -> void:
	if not b["alive"]:
		return

	if not b["built"]:
		b["progress"] = float(b["progress"]) + dt / max(1.0, float(b["total"]))
		b["hp"] = min(float(b["hpMax"]), float(b["hpMax"]) * (0.35 + 0.65 * float(b["progress"])))
		if float(b["progress"]) >= 1.0:
			b["built"] = true
			b["progress"] = 1.0
			if b["team"] == "player":
				announce("buildDone")
		return

	if bool(b["def"].get("produces", false)) and b["queue"].size() > 0:
		var job: Dictionary = b["queue"][0]
		job["progress"] = float(job["progress"]) + dt
		if float(job["progress"]) >= float(job["total"]):
			b["queue"].pop_front()
			var u := add_unit(b["team"], job["type"], b["x"], b["y"] + float(b["radius"]) + 16.0)
			if not u.is_empty():
				var rx: float = b.get("rallyX", b["x"])
				var ry: float = b.get("rallyY", b["y"] + 90.0)
				u["order"] = {"type": "move", "x": rx, "y": ry}
				set_path_to(u, rx, ry)
				if b["team"] == "player":
					announce("unitReady")

	b["cooldown"] = max(0.0, float(b["cooldown"]) - dt)
	if float(b["def"].get("damage", 0)) > 0.0:
		if b["target"].is_empty() or not b["target"]["alive"]:
			b["target"] = nearest_enemy(b, float(b["def"]["sight"]) * TS)
		if not b["target"].is_empty() and b["target"]["alive"]:
			if in_range(b, b["target"]):
				b["facing"] = atan2(b["target"]["y"] - b["y"], b["target"]["x"] - b["x"])
				if float(b["cooldown"]) <= 0.0:
					b["cooldown"] = float(b["def"]["cooldown"])
					b["muzzle"] = 0.12
					projectiles.append({
						"x": b["x"], "y": b["y"] - 10.0,
						"tx": b["target"]["x"], "ty": b["target"]["y"],
						"life": 0.16, "max": 0.16, "team": b["team"], "splash": 0.0,
						"target": b["target"], "dmg": float(b["def"]["damage"]) * (1.0 + float(m["dmg"]))
					})
			else:
				b["target"] = {}


# ── снаряды ──────────────────────────────────────────────────────────────────
func update_projectiles(dt: float) -> void:
	var keep: Array = []
	for p in projectiles:
		p["life"] = float(p["life"]) - dt
		if float(p["life"]) > 0.0:
			keep.append(p)
			continue
		var tgt: Dictionary = p["target"]
		if not tgt.is_empty() and tgt["alive"]:
			damage(tgt, float(p["dmg"]), p["team"])
			if float(p["splash"]) > 0.0:
				var pool: Array = []
				pool.append_array(units)
				pool.append_array(buildings)
				for e in pool:
					if e.is_empty() or not e["alive"] or e["id"] == tgt["id"] or e["team"] == p["team"]:
						continue
					if _dist(e["x"], e["y"], tgt["x"], tgt["y"]) <= float(p["splash"]):
						damage(e, float(p["dmg"]) * 0.45, p["team"])
	projectiles = keep


# ── ИИ противника ────────────────────────────────────────────────────────────
func update_enemy_ai(dt: float) -> void:
	ai["nextThink"] = float(ai["nextThink"]) - dt
	if float(ai["nextThink"]) > 0.0:
		return
	ai["nextThink"] = float(C.ENEMY_AI["thinkInterval"])

	var t: Dictionary = teams["enemy"]
	var cc: Dictionary = {}
	var factory: Dictionary = {}
	for b in buildings:
		if b["team"] != "enemy" or not b["alive"]:
			continue
		if b["type"] == "commandCenter":
			cc = b
		if b["type"] == "factory":
			factory = b
	if cc.is_empty():
		return

	var workers := 0
	var army: Array = []
	for u in units:
		if u["team"] != "enemy" or not u["alive"]:
			continue
		if u["def"]["role"] == "worker":
			workers += 1
		else:
			army.append(u)

	if not factory.is_empty() and workers < 3 and int(t["xenite"]) >= 60:
		train_unit("enemy", factory["id"], "harvester")

	if not factory.is_empty() and army.size() < int(C.BALANCE["enemyMaxArmy"]) \
			and int(t["xenite"]) >= 150 and factory["queue"].is_empty():
		var pick := "rifleman"
		if army.size() >= 4:
			pick = "hammer" if randf() < 0.5 else "rifleman"
		train_unit("enemy", factory["id"], pick)

	if time >= float(ai["nextWave"]):
		ai["waveIndex"] = int(ai["waveIndex"]) + 1
		ai["nextWave"] = time + float(C.ENEMY_AI["waveInterval"])
		var size := 2 + int(ai["waveIndex"]) * int(C.ENEMY_AI["waveGrowth"])
		var pcc := {}
		for b in buildings:
			if b["team"] == "player" and b["type"] == "commandCenter" and b["alive"]:
				pcc = b
		var idle: Array = []
		for u in army:
			if idle.size() >= size:
				break
			idle.append(u["id"])
		if idle.size() > 0 and not pcc.is_empty():
			issue_order("enemy", idle, pcc["x"], pcc["y"], "attack")
		if int(ai["waveIndex"]) == 1:
			announce("waveIncoming")


# ── туман войны ──────────────────────────────────────────────────────────────
func recompute_visibility() -> void:
	visible.fill(0)
	var bonus := 0.0
	for b in buildings:
		if b["team"] == "player" and b["alive"] and b["def"].has("visionBonus"):
			bonus = max(bonus, float(b["def"]["visionBonus"]))
	for b in buildings:
		if b["team"] == "player" and b["alive"]:
			_stamp(b["x"], b["y"], float(b["def"]["sight"]) * (1.0 + bonus))
	for u in units:
		if u["team"] == "player" and u["alive"]:
			_stamp(u["x"], u["y"], float(u["def"]["sight"]))


func _stamp(x: float, y: float, r_tiles: float) -> void:
	var cx := int(x / TS)
	var cy := int(y / TS)
	var r := int(ceil(r_tiles))
	for ty in range(cy - r, cy + r + 1):
		for tx in range(cx - r, cx + r + 1):
			if tx < 0 or ty < 0 or tx >= WORLD_W or ty >= WORLD_H:
				continue
			if _dist(tx, ty, cx, cy) > r_tiles:
				continue
			var i := _idx(tx, ty)
			visible[i] = 1
			explored[i] = 1


func is_visible(x: float, y: float) -> bool:
	var tx := int(x / TS)
	var ty := int(y / TS)
	if tx < 0 or ty < 0 or tx >= WORLD_W or ty >= WORLD_H:
		return false
	return visible[_idx(tx, ty)] == 1


func is_explored(x: float, y: float) -> bool:
	var tx := int(x / TS)
	var ty := int(y / TS)
	if tx < 0 or ty < 0 or tx >= WORLD_W or ty >= WORLD_H:
		return false
	return explored[_idx(tx, ty)] == 1


# ── шаг симуляции ────────────────────────────────────────────────────────────
func update(dt: float) -> void:
	if result != "playing":
		projectiles.clear()
		return
	dt = min(dt, 0.1)
	time += dt

	var mods_p := mods("player")
	var mods_e := mods("enemy")

	for team in ["player", "enemy"]:
		var t: Dictionary = teams[team]
		if t["techQueue"].size() > 0:
			var job: Dictionary = t["techQueue"][0]
			job["progress"] = float(job["progress"]) + dt
			if float(job["progress"]) >= float(job["total"]):
				t["techQueue"].pop_front()
				t["researched"][job["id"]] = true
				var tech := {}
				for x in C.TECHS:
					if x["id"] == job["id"]:
						tech = x
						break
				if not tech.is_empty() and tech.has("hpVehicle"):
					for u in units:
						if u["team"] == team and u["alive"] and u["def"]["role"] == "vehicle":
							u["hpMax"] = int(round(float(u["hpMax"]) * (1.0 + float(tech["hpVehicle"]))))
							u["hp"] = int(round(float(u["hp"]) * (1.0 + float(tech["hpVehicle"]))))
				if team == "player":
					announce("techDone")
		if t["buildQueue"].size() > 0:
			var job2: Dictionary = t["buildQueue"][0]
			job2["progress"] = float(job2["progress"]) + dt
			if float(job2["progress"]) >= float(job2["total"]):
				t["buildQueue"].pop_front()
				var b := add_building(team, job2["type"], job2["x"], job2["y"], false)
				if not b.is_empty():
					b["total"] = 0.75
					b["progress"] = 0.0
					b["built"] = false

	for u in units:
		if not u["alive"]:
			continue
		u["hitFlash"] = max(0.0, float(u["hitFlash"]) - dt)
		u["muzzle"] = max(0.0, float(u["muzzle"]) - dt)
		var m: Dictionary = mods_p if u["team"] == "player" else mods_e
		if u["def"]["role"] == "worker":
			update_harvester(u, dt, m)
		else:
			update_combat_unit(u, dt, m)
		keep_in_bounds(u)
	separate()

	for b in buildings:
		if not b["alive"]:
			continue
		b["hitFlash"] = max(0.0, float(b["hitFlash"]) - dt)
		b["muzzle"] = max(0.0, float(b["muzzle"]) - dt)
		update_building(b, dt, mods_p if b["team"] == "player" else mods_e)

	update_projectiles(dt)
	update_enemy_ai(dt)

	var fx: Array = []
	for e in effects:
		e["life"] = float(e["life"]) - dt
		if float(e["life"]) > 0.0:
			fx.append(e)
	effects = fx

	var alive_units: Array = []
	for u in units:
		if u["alive"]:
			alive_units.append(u)
	units = alive_units
	var alive_buildings: Array = []
	for b in buildings:
		if b["alive"]:
			alive_buildings.append(b)
	buildings = alive_buildings

	if int(time * 10.0) % 3 == 0:
		recompute_visibility()


# ── утилиты ──────────────────────────────────────────────────────────────────
func _dist(ax: float, ay: float, bx: float, by: float) -> float:
	return sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))


func snapshot() -> Dictionary:
	var enemy_units := 0
	for u in units:
		if u["team"] == "enemy":
			enemy_units += 1
	return {
		"time": time,
		"result": result,
		"xenite": teams["player"]["xenite"],
		"units": units.size(),
		"enemyUnits": enemy_units,
		"researched": teams["player"]["researched"].keys(),
		"lost": teams["player"]["lost"]
	}
