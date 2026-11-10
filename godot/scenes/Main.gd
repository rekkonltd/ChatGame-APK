extends Node2D
## THAN-DOR — сцена уровня: рисует состояние Sim и обрабатывает касания.
##
## Это «вид»: вся логика в res://core/sim.gd. Перенос с prototype/js/main.js.
## Рисование сделано примитивами (_draw_*), чтобы стиль совпадал с веб-прототипом
## и не требовал ассетов на этом этапе.

const C := preload("res://core/config.gd")
const SimScript := preload("res://core/sim.gd")

const TS := 48.0
const VW := 390.0
const VH := 844.0

# ── раскладка HUD (портрет) ─────────────────────────────────────────────────
const STATUS_H := 50.0
const CARD_H := 96.0
const TABS_H := 34.0
const GRID_H := 108.0
const ACTIONS_H := 52.0

var sim
var cam := Vector2(5 * TS, 34 * TS)
var zoom := 1.15

var tab := "units"
var tech_open := false
var attack_mode := false
var paused := false

var selected_id := -1
var multi_ids: Array = []
var toasts: Array = []
var announce_text := ""
var announce_life := 0.0

var dragging := false
var drag_moved := false
var press_pos := Vector2.ZERO
var last_pos := Vector2.ZERO

var field_rect := Rect2()
var _font: Font
var _time_acc := 0.0


func _ready() -> void:
	_font = ThemeDB.fallback_font
	sim = SimScript.new()
	_layout()
	_announce("start")


func _layout() -> void:
	field_rect = Rect2(0, STATUS_H, VW, VH - STATUS_H - CARD_H - TABS_H - GRID_H - ACTIONS_H)


func _announce(key: String) -> void:
	announce_text = C.ANNOUNCER.get(key, "")
	announce_life = 2.6


# ── ввод ────────────────────────────────────────────────────────────────────
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			dragging = true
			drag_moved = false
			press_pos = event.position
			last_pos = event.position
		else:
			if dragging and not drag_moved:
				_on_tap(event.position)
			dragging = false
	elif event is InputEventScreenDrag:
		if dragging:
			var d: Vector2 = event.position - last_pos
			if (event.position - press_pos).length() > 8.0:
				drag_moved = true
			if drag_moved and event.position.y >= _card_top():
				cam -= d / zoom
				_clamp_cam()
			last_pos = event.position
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
		zoom = clampf(zoom * 1.08, 0.55, 1.5)
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		zoom = clampf(zoom / 1.08, 0.55, 1.5)


func _card_top() -> float:
	return VH - CARD_H - TABS_H - GRID_H - ACTIONS_H


func _clamp_cam() -> void:
	var half := Vector2(VW, field_rect.size.y) / (2.0 * zoom)
	cam.x = clampf(cam.x, 0.0, SimScript.WORLD_W * TS)
	cam.y = clampf(cam.y, 0.0, SimScript.WORLD_H * TS)


func _world_of(screen: Vector2) -> Vector2:
	var local := screen - Vector2(VW / 2.0, field_rect.position.y + field_rect.size.y / 2.0)
	return local / zoom + cam


func _on_tap(p: Vector2) -> void:
	if sim.result != "playing":
		# кнопка «играть снова»
		if Rect2(40, field_rect.position.y + 300, VW - 80, 40).has_point(p):
			sim = SimScript.new()
			selected_id = -1
			multi_ids.clear()
			announce_life = 0.0
		return

	if tech_open:
		for node in _tech_nodes():
			if Rect2(node["pos"], Vector2(node["w"], node["h"])).has_point(p):
				sim.research("player", node["id"])
				return
		tech_open = false
		return

	if p.y < STATUS_H:
		if p.x > VW - 46:
			paused = not paused
		return

	if p.y >= VH - ACTIONS_H:
		if p.x < VW / 2.0:
			_select_all_army()
		else:
			attack_mode = not attack_mode
		return

	if p.y >= VH - ACTIONS_H - GRID_H:
		_on_tile_tap(p)
		return

	if p.y >= VH - ACTIONS_H - GRID_H - TABS_H:
		var idx := int(p.x / (VW / 3.0))
		if idx == 0:
			tab = "units"
		elif idx == 1:
			tab = "base"
		else:
			tech_open = true
		return

	if p.y >= _card_top():
		return

	# поле
	var w := _world_of(p)
	var e: Dictionary = _entity_at(w)
	if not e.is_empty():
		if e["team"] == "player":
			selected_id = e["id"]
			multi_ids.clear()
		elif selected_id >= 0:
			sim.order_attack_target("player", _active_ids(), e["id"])
		return

	if selected_id >= 0 and _active_ids().size() > 0:
		sim.issue_order("player", _active_ids(), w.x, w.y, "attack" if attack_mode else "move")
		attack_mode = false


func _entity_at(w: Vector2) -> Dictionary:
	var slop := 18.0 / zoom
	var best := {}
	var best_d := INF
	for u in sim.units:
		if not u["alive"]:
			continue
		if u["team"] != "player" and not sim.is_visible(u["x"], u["y"]):
			continue
		var d := w.distance_to(Vector2(u["x"], u["y"]))
		if d < float(u["radius"]) + slop and d < best_d:
			best_d = d
			best = u
	for b in sim.buildings:
		if not b["alive"]:
			continue
		if b["team"] != "player" and not sim.is_explored(b["x"], b["y"]):
			continue
		var d2 := w.distance_to(Vector2(b["x"], b["y"]))
		if d2 < float(b["radius"]) + slop * 0.6 and d2 < best_d:
			best_d = d2
			best = b
	return best


func _active_ids() -> Array:
	if multi_ids.size() > 0:
		return multi_ids
	if selected_id >= 0:
		return [selected_id]
	return []


func _select_all_army() -> void:
	multi_ids.clear()
	for u in sim.units:
		if u["team"] == "player" and u["alive"] and u["def"]["role"] != "worker":
			multi_ids.append(u["id"])
	if multi_ids.size() > 0:
		selected_id = multi_ids[0]


# ── нижняя панель ───────────────────────────────────────────────────────────
func _tiles() -> Array:
	if tab == "units":
		return ["rifleman", "hammer", "groza", "osa", "harvester"]
	if tab == "base":
		return ["factory", "turret", "radar"]
	return []


func _tile_rects() -> Array:
	var out: Array = []
	var list := _tiles()
	var cols := 3
	var gap := 6.0
	var pad := 8.0
	var grid_y := VH - ACTIONS_H - GRID_H
	var w := (VW - pad * 2.0 - gap * (cols - 1)) / cols
	var h := (GRID_H - gap - 6.0) / 2.0
	for i in list.size():
		var cx := i % cols
		var cy := int(i / cols)
		out.append({"type": list[i],
			"rect": Rect2(pad + cx * (w + gap), grid_y + 3.0 + cy * (h + gap), w, h)})
	return out


func _on_tile_tap(p: Vector2) -> void:
	for t in _tile_rects():
		if not t["rect"].has_point(p):
			continue
		var type: String = t["type"]
		if C.UNITS.has(type):
			var factory := {}
			for b in sim.buildings:
				if b["team"] == "player" and b["def"].get("produces", false) and b["built"]:
					factory = b
			if factory.is_empty():
				return
			var r: Dictionary = sim.train_unit("player", factory["id"], type)
			if not r["ok"]:
				toasts.append({"text": _reason_text(r["reason"]), "life": 1.8})
		else:
			var spot := _free_spot()
			if spot != Vector2.ZERO:
				sim.place_building("player", type, spot.x, spot.y)
		return


func _free_spot() -> Vector2:
	var cc := Vector2.ZERO
	for b in sim.buildings:
		if b["team"] == "player" and b["alive"]:
			cc = Vector2(b["x"], b["y"])
			break
	if cc == Vector2.ZERO:
		return Vector2.ZERO
	for ring in range(1, 9):
		for a in 16:
			var ang := (float(a) / 16.0) * TAU + ring
			var x := cc.x + cos(ang) * ring * TS
			var y := cc.y + sin(ang) * ring * TS
			var tx := int(x / TS)
			var ty := int(y / TS)
			if tx < 1 or ty < 1 or tx >= SimScript.WORLD_W - 1 or ty >= SimScript.WORLD_H - 1:
				continue
			var i := ty * SimScript.WORLD_W + tx
			if sim.tiles[i] != 0 or sim.occupied[i] != 0:
				continue
			if sim.within_build_radius("player", x, y):
				return Vector2(x, y)
	return Vector2.ZERO


func _reason_text(reason: String) -> String:
	var map := {
		"no-money": "Недостаточно ресурсов",
		"locked": "Нужна технология",
		"requires": "Сначала изучите предыдущее",
		"queue-full": "Очередь заполнена",
		"blocked": "Место занято",
		"radius": "Слишком далеко от базы"
	}
	return map.get(reason, "Невозможно")


func _tech_nodes() -> Array:
	var out: Array = []
	var col_w := (VW - 44.0) / 2.0
	var top := field_rect.position.y + 84.0
	for t in C.TECHS:
		var col := 0 if t["branch"] == "army" else 1
		var row: int = int(t["tier"]) - 1
		out.append({
			"id": t["id"], "tech": t, "w": col_w, "h": 50.0,
			"pos": Vector2(16.0 + col * (col_w + 12.0), top + row * 62.0 + 4.0)
		})
	return out


# ── цикл ────────────────────────────────────────────────────────────────────
func _process(delta: float) -> void:
	if not paused:
		_time_acc += delta
		while _time_acc >= 0.05:
			sim.update(0.05)
			_time_acc -= 0.05

	for e in sim.drain_events():
		if e["type"] == "toast":
			toasts.append({"text": e["text"], "life": 1.8})
		elif e["type"] == "announce":
			_announce(e["key"])

	var keep: Array = []
	for t in toasts:
		t["life"] = float(t["life"]) - delta
		if float(t["life"]) > 0.0:
			keep.append(t)
	toasts = keep
	announce_life = max(0.0, announce_life - delta)

	queue_redraw()


func _draw() -> void:
	_draw_ground()
	_draw_selection_lines()
	for b in sim.buildings:
		if b["team"] == "enemy" and not sim.is_explored(b["x"], b["y"]):
			continue
		_draw_building(b)
	for u in sim.units:
		if u["team"] == "enemy" and not sim.is_visible(u["x"], u["y"]):
			continue
		_draw_unit(u)
	_draw_projectiles()
	_draw_fog()
	_draw_status()
	_draw_card()
	_draw_tabs()
	_draw_tiles()
	_draw_actions()
	_draw_toasts()
	if tech_open:
		_draw_tech()
	if sim.result != "playing":
		_draw_result()
	elif paused:
		draw_rect(Rect2(0, 0, VW, VH), Color(0.02, 0.03, 0.04, 0.7))
		_text("ПАУЗА", Vector2(VW / 2.0, VH / 2.0), 30, Color("#d9d3c4"), true)


# ── рисование мира ──────────────────────────────────────────────────────────
func _s(w: Vector2) -> Vector2:
	return Vector2(
		(w.x - cam.x) * zoom + VW / 2.0,
		(w.y - cam.y) * zoom + field_rect.position.y + field_rect.size.y / 2.0
	)


func _draw_ground() -> void:
	var tile_px := TS * zoom
	var x0 := maxi(0, int((cam.x - VW / (2.0 * zoom)) / TS) - 1)
	var x1 := mini(SimScript.WORLD_W - 1, int((cam.x + VW / (2.0 * zoom)) / TS) + 1)
	var y0 := maxi(0, int((cam.y - field_rect.size.y / (2.0 * zoom)) / TS) - 1)
	var y1 := mini(SimScript.WORLD_H - 1, int((cam.y + field_rect.size.y / (2.0 * zoom)) / TS) + 1)

	draw_rect(field_rect, Color("#5f6d38"))

	for ty in range(y0, y1 + 1):
		for tx in range(x0, x1 + 1):
			var i := ty * SimScript.WORLD_W + tx
			var t: int = sim.tiles[i]
			var n := _hash(tx, ty)
			var p := _s(Vector2(tx * TS, ty * TS))
			var col: Color = Color("#6b7a3f")
			if t == C.TILE["WATER"]:
				col = Color("#2e5a6b")
			elif n > 0.82:
				col = Color("#7a5f42")
			elif n > 0.4:
				col = Color("#61703a")
			draw_rect(Rect2(p, Vector2(tile_px + 1.0, tile_px + 1.0)), col)

			if t == C.TILE["ROCK"]:
				draw_circle(p + Vector2(tile_px * 0.5, tile_px * 0.45), tile_px * 0.34, Color("#5d5348"))
			elif t == C.TILE["XENITE"]:
				var cx := p + Vector2(tile_px * 0.5, tile_px * 0.6)
				for k in 3:
					var off := Vector2((_hash(tx * 7 + k, ty * 3) - 0.5) * tile_px * 0.6,
						(_hash(tx * 3, ty * 7 + k) - 0.5) * tile_px * 0.3)
					var h := tile_px * 0.34
					var pts := PackedVector2Array([
						cx + off + Vector2(0, -h * 1.5), cx + off + Vector2(h * 0.6, -h * 0.1),
						cx + off + Vector2(0, h * 0.4), cx + off + Vector2(-h * 0.6, -h * 0.1)
					])
					draw_colored_polygon(pts, Color("#e8b93f"))
					draw_polyline(PackedVector2Array([pts[0], pts[1], pts[2], pts[3], pts[0]]),
						Color("#3b2c0c"), 1.0)


func _hash(x: int, y: int) -> float:
	var h := int(fmod(sin(float(x) * 127.1 + float(y) * 311.7) * 43758.5453, 1.0) * 100000.0)
	return float(absi(h) % 1000) / 1000.0


func _draw_fog() -> void:
	# мягкий туман: сетка полупрозрачных квадратов по тайлам
	var fog_col := Color(0.02, 0.03, 0.04)
	var tile_px := TS * zoom
	var x0 := maxi(0, int((cam.x - VW / (2.0 * zoom)) / TS) - 1)
	var x1 := mini(SimScript.WORLD_W - 1, int((cam.x + VW / (2.0 * zoom)) / TS) + 1)
	var y0 := maxi(0, int((cam.y - field_rect.size.y / (2.0 * zoom)) / TS) - 1)
	var y1 := mini(SimScript.WORLD_H - 1, int((cam.y + field_rect.size.y / (2.0 * zoom)) / TS) + 1)
	for ty in range(y0, y1 + 1):
		for tx in range(x0, x1 + 1):
			var i := ty * SimScript.WORLD_W + tx
			var a := 0.0
			if sim.visible[i] == 0:
				a = 1.0 if sim.explored[i] == 0 else 0.62
			if a <= 0.0:
				continue
			var p := _s(Vector2(tx * TS, ty * TS))
			draw_rect(Rect2(p, Vector2(tile_px + 1.0, tile_px + 1.0)),
				Color(fog_col.r, fog_col.g, fog_col.b, a))


func _team_colors(team: String) -> Dictionary:
	if team == "player":
		return {"main": Color("#4a6b8a"), "dark": Color("#2d4457"), "light": Color("#7ba3c4")}
	return {"main": Color("#b8543f"), "dark": Color("#7d3325"), "light": Color("#e0906f")}


func _draw_unit(u: Dictionary) -> void:
	var c := _team_colors(u["team"])
	var p := _s(Vector2(u["x"], u["y"]))
	var r: float = float(u["radius"]) * zoom
	var body: Color = Color.WHITE if float(u["hitFlash"]) > 0.0 else c["main"]

	if u["team"] == "player":
		draw_circle(p + Vector2(0, r * 0.22), r * 1.1, Color(0.29, 0.42, 0.54, 0.34))
	else:
		draw_circle(p + Vector2(0, r * 0.22), r * 1.1, Color(0.64, 0.29, 0.23, 0.34))
	draw_circle(p + Vector2(r * 0.2, r * 0.32), r * 0.8, Color(0.06, 0.05, 0.04, 0.3))

	match u["type"]:
		"harvester":
			draw_rect(Rect2(p + Vector2(-r * 0.75, -r * 0.9), Vector2(r * 1.5, r * 1.8)), body)
			draw_rect(Rect2(p + Vector2(-r * 0.45, -r * 0.4), Vector2(r * 0.9, r * 0.9)),
				Color("#e8b93f") if int(u["carrying"]) > 0 else c["dark"])
		"rifleman":
			for k in 3:
				var off := Vector2((k - 1) * r * 0.8, -r * 0.5 if k == 1 else r * 0.3)
				draw_rect(Rect2(p + off + Vector2(-r * 0.32, -r * 0.36), Vector2(r * 0.64, r * 0.72)),
					c["light"] if k == 1 else body)
				draw_line(p + off + Vector2(0, -r * 0.4), p + off + Vector2(0, -r * 0.95),
					Color("#0d1116"), maxf(1.4, 1.9 * zoom))
		"hammer":
			draw_rect(Rect2(p + Vector2(-r * 0.9, -r * 0.8), Vector2(r * 0.34, r * 1.6)), Color("#2b2a26"))
			draw_rect(Rect2(p + Vector2(r * 0.56, -r * 0.8), Vector2(r * 0.34, r * 1.6)), Color("#2b2a26"))
			draw_rect(Rect2(p + Vector2(-r * 0.55, -r * 0.7), Vector2(r * 1.1, r * 1.5)), body)
			draw_circle(p + Vector2(0, -r * 0.05), r * 0.36, c["light"])
			draw_rect(Rect2(p + Vector2(-r * 0.1, -r * 1.3), Vector2(r * 0.2, r * 1.2)), Color("#37352f"))
		"groza":
			draw_rect(Rect2(p + Vector2(-r * 0.65, -r * 0.5), Vector2(r * 1.3, r * 1.4)), body)
			draw_rect(Rect2(p + Vector2(-r * 0.15, -r * 1.7), Vector2(r * 0.3, r * 1.3)), Color("#3a3830"))
		"osa":
			var pts := PackedVector2Array([
				p + Vector2(0, -r * 1.1), p + Vector2(r * 0.55, -r * 0.1),
				p + Vector2(r * 0.35, r * 0.75), p + Vector2(-r * 0.35, r * 0.75),
				p + Vector2(-r * 0.55, -r * 0.1)
			])
			draw_colored_polygon(pts, body)
		_:
			draw_circle(p, r, body)

	# HP
	if float(u["hp"]) < float(u["hpMax"]) or _is_selected(u["id"]):
		var bw := r * 2.2
		var frac: float = maxf(0.0, float(u["hp"]) / maxf(1.0, float(u["hpMax"])))
		draw_rect(Rect2(p + Vector2(-bw / 2.0, -r * 1.85), Vector2(bw, maxf(3.0, 3.5 * zoom))),
			Color(0.05, 0.06, 0.04, 0.72))
		draw_rect(Rect2(p + Vector2(-bw / 2.0, -r * 1.85), Vector2(bw * frac, maxf(3.0, 3.5 * zoom))),
			Color("#6fdc4a") if frac > 0.35 else Color("#d9503f"))

	if _is_selected(u["id"]):
		draw_rect(Rect2(p + Vector2(-r * 1.35, -r * 1.5), Vector2(r * 2.7, r * 2.7)),
			Color("#7ddc3c"), false, maxf(1.4, 1.8 * zoom))


func _is_selected(id: int) -> bool:
	if selected_id == id:
		return true
	return multi_ids.has(id)


func _draw_building(b: Dictionary) -> void:
	var c := _team_colors(b["team"])
	var p := _s(Vector2(b["x"], b["y"]))
	var r: float = float(b["radius"]) * zoom
	var body: Color = Color.WHITE if float(b["hitFlash"]) > 0.0 else c["main"]

	draw_circle(p + Vector2(r * 0.28, r * 0.3), r * 1.05, Color(0.06, 0.05, 0.04, 0.3))

	match b["type"]:
		"commandCenter":
			draw_rect(Rect2(p + Vector2(-r, -r * 0.1), Vector2(r * 2.0, r * 0.6)), c["dark"])
			draw_rect(Rect2(p + Vector2(-r * 0.82, -r * 0.55), Vector2(r * 1.64, r * 0.5)), body)
			draw_rect(Rect2(p + Vector2(-r * 0.6, -r * 0.8), Vector2(r * 1.2, r * 0.3)), c["light"])
			draw_line(p + Vector2(r * 0.2, -r * 0.8), p + Vector2(r * 0.2, -r * 1.4),
				Color("#2a2420"), 1.4)
			draw_circle(p + Vector2(r * 0.2, -r * 1.4), r * 0.16, Color("#8d9095"))
		"factory":
			draw_rect(Rect2(p + Vector2(-r * 0.9, -r * 0.3), Vector2(r * 1.8, r * 0.85)), body)
			draw_rect(Rect2(p + Vector2(r * 0.3, -r * 1.1), Vector2(r * 0.22, r * 0.8)), Color("#4a4440"))
			draw_rect(Rect2(p + Vector2(-r * 0.55, -r * 0.1), Vector2(r * 0.6, r * 0.4)), Color("#20262a"))
		"turret":
			draw_circle(p + Vector2(0, r * 0.15), r * 0.9, c["dark"])
			draw_circle(p + Vector2(0, -r * 0.2), r * 0.5, body)
			var dir := Vector2(cos(float(b["facing"])), sin(float(b["facing"])))
			draw_line(p + Vector2(0, -r * 0.2), p + Vector2(0, -r * 0.2) + dir * r * 1.2,
				Color("#3b3a35"), maxf(2.0, r * 0.22))
		"radar":
			draw_rect(Rect2(p + Vector2(-r * 0.8, -r * 0.1), Vector2(r * 1.6, r * 0.7)), c["dark"])
			draw_line(p + Vector2(0, -r * 0.1), p + Vector2(0, -r * 1.1), Color("#5c5850"), 2.0)
			draw_circle(p + Vector2(0, -r * 1.1), r * 0.4, c["light"])

	if not b["built"]:
		var frac: float = clampf(float(b["progress"]), 0.0, 1.0)
		draw_rect(Rect2(p + Vector2(-r, -r * 1.15), Vector2(r * 2.0, maxf(4.0, 5.0 * zoom))),
			Color(0.08, 0.09, 0.07, 0.8))
		draw_rect(Rect2(p + Vector2(-r, -r * 1.15), Vector2(r * 2.0 * frac, maxf(4.0, 5.0 * zoom))),
			Color("#e8c020"))

	if b["built"] and float(b["hp"]) < float(b["hpMax"]):
		var bw := r * 2.0
		var frac2: float = maxf(0.0, float(b["hp"]) / maxf(1.0, float(b["hpMax"])))
		draw_rect(Rect2(p + Vector2(-bw / 2.0, -r * 1.45), Vector2(bw, maxf(3.0, 4.0 * zoom))),
			Color(0.05, 0.06, 0.04, 0.75))
		draw_rect(Rect2(p + Vector2(-bw / 2.0, -r * 1.45), Vector2(bw * frac2, maxf(3.0, 4.0 * zoom))),
			Color("#6fdc4a") if frac2 > 0.35 else Color("#d9503f"))

	if _is_selected(b["id"]):
		draw_rect(Rect2(p + Vector2(-r * 1.1, -r * 1.7), Vector2(r * 2.2, r * 2.4)),
			Color("#7ddc3c"), false, maxf(1.4, 1.8 * zoom))


func _draw_selection_lines() -> void:
	for id in _active_ids():
		var e: Dictionary = sim.find_by_id(id)
		if e.is_empty() or e["kind"] != "unit":
			continue
		var path: Array = e["path"]
		if path.is_empty():
			continue
		var last: Dictionary = path[path.size() - 1]
		var a := _s(Vector2(e["x"], e["y"]))
		var b := _s(Vector2(last["tx"] * TS + TS / 2.0, last["ty"] * TS + TS / 2.0))
		draw_dashed_line(a, b, Color(0.49, 0.86, 0.24, 0.35), 1.2, 5.0)


func _draw_projectiles() -> void:
	for p in sim.projectiles:
		var a := _s(Vector2(p["x"], p["y"]))
		var b := _s(Vector2(p["tx"], p["ty"]))
		var k: float = 1.0 - float(p["life"]) / float(p["max"])
		var pos := a.lerp(b, k)
		draw_line(pos - (b - a) * 0.08, pos, Color(1.0, 0.91, 0.59, 0.95), maxf(1.5, 2.2 * zoom))
		draw_circle(pos, maxf(1.5, 2.0 * zoom), Color("#ffd35a"))

	for e in sim.effects:
		var p2 := _s(Vector2(e["x"], e["y"]))
		var k2: float = 1.0 - float(e["life"]) / float(e["max"])
		if e["type"] == "boom":
			var r: float = (46.0 if e.get("big", false) else 26.0) * zoom * (0.45 + k2 * 0.9)
			draw_circle(p2, r, Color(1.0, 0.54, 0.12, (0.9 - k2 * 0.8) * 0.8))
			draw_circle(p2, r * 0.55, Color(1.0, 0.83, 0.35, (1.0 - k2) * 0.9))
		elif e["type"] == "hit":
			_text(e["text"], p2 + Vector2(0, -k2 * 18.0), 11 * zoom, Color(1.0, 0.86, 0.55, 1.0 - k2), true)


# ── HUD ─────────────────────────────────────────────────────────────────────
func _panel(rect: Rect2, top := "#41474e", bottom := "#2c3035") -> void:
	draw_rect(rect, Color(bottom))
	draw_rect(rect, Color("#6a7078"), false, 1.0)
	# «миллиметровая» сетка
	var x := rect.position.x + 2.0
	while x < rect.position.x + rect.size.x:
		draw_line(Vector2(x, rect.position.y), Vector2(x, rect.position.y + rect.size.y),
			Color(1, 1, 1, 0.035))
		x += 8.0


func _text(s: String, pos: Vector2, size: int, col: Color, centered := false, right := false) -> void:
	var w := _font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var p := pos
	if centered:
		p.x -= w / 2.0
	elif right:
		p.x -= w
	draw_string(_font, p, s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)


func _draw_status() -> void:
	_panel(Rect2(0, 0, VW, STATUS_H))
	var cy := STATUS_H - 14.0
	_text(str(int(sim.teams["player"]["xenite"])), Vector2(24, cy + 7), 20, Color("#ffe79b"))

	var army := 0
	for u in sim.units:
		if u["team"] == "player" and u["def"]["role"] != "worker":
			army += 1
	_text("АРМИЯ", Vector2(96, cy - 9), 9, Color("#8e8c82"))
	var bar := Rect2(96, cy - 3, 44, 6)
	draw_rect(bar, Color("#171a1d"))
	draw_rect(Rect2(bar.position, Vector2(bar.size.x * float(army) / float(C.BALANCE["maxArmy"]), bar.size.y)),
		Color("#7ddc3c"))
	_text("%d/%d" % [army, int(C.BALANCE["maxArmy"])], Vector2(144, cy + 6), 11, Color("#c9c4b6"))

	var t := int(sim.time)
	_text("%02d:%02d" % [int(t / 60), t % 60], Vector2(VW - 74, cy + 6), 15, Color("#c9c4b6"), false, true)

	draw_rect(Rect2(VW - 40, 11, 30, 28), Color("#4a5058"))
	if paused:
		draw_colored_polygon(PackedVector2Array([
			Vector2(VW - 29, 16), Vector2(VW - 19, 25), Vector2(VW - 29, 34)]), Color("#d9d3c4"))
	else:
		draw_rect(Rect2(VW - 30, 17, 4, 16), Color("#d9d3c4"))
		draw_rect(Rect2(VW - 22, 17, 4, 16), Color("#d9d3c4"))


func _draw_card() -> void:
	var y := _card_top()
	_panel(Rect2(0, y, VW, CARD_H))
	var sel: Dictionary = sim.find_by_id(selected_id) if selected_id >= 0 else {}
	if sel.is_empty():
		_text("ВЫБЕРИТЕ ЮНИТ ИЛИ ЗДАНИЕ", Vector2(VW / 2.0, y + 44), 14, Color("#8e8c82"), true)
		_text("тап по карте — выбор · тап по земле — приказ", Vector2(VW / 2.0, y + 64), 11,
			Color(0.56, 0.55, 0.51, 0.8), true)
		return
	# превью-«чертёж»
	var box := Rect2(8, y + 8, 78, CARD_H - 16)
	draw_rect(box, Color("#1b1f23"))
	draw_rect(box, Color(0.47, 0.67, 0.75, 0.2), false, 1.0)
	_text(sel["def"]["name"].substr(0, 2).to_upper(), Vector2(box.position.x + box.size.x / 2.0, y + 56),
		22, Color("#7ba3c4"), true)
	_text(sel["def"]["name"].to_upper(), Vector2(96, y + 24), 16, Color("#d9d3c4"))
	_text("HP %d/%d" % [int(sel["hp"]), int(sel["hpMax"])], Vector2(96, y + 42), 11, Color("#8e8c82"))
	var frac: float = float(sel["hp"]) / maxf(1.0, float(sel["hpMax"]))
	draw_rect(Rect2(96, y + 48, 150, 7), Color("#171a1d"))
	draw_rect(Rect2(96, y + 48, 150 * frac, 7), Color("#6fdc4a"))


func _draw_tabs() -> void:
	var y := VH - ACTIONS_H - GRID_H - TABS_H
	var names := ["ВОЙСКА", "БАЗА", "ТЕХ"]
	var w := VW / 3.0
	for i in 3:
		var active := (i == 0 and tab == "units" and not tech_open) \
			or (i == 1 and tab == "base" and not tech_open) or (i == 2 and tech_open)
		var x := i * w
		draw_rect(Rect2(x, y, w - 1.0, TABS_H), Color("#4b525a") if active else Color("#2b2f34"))
		_text(names[i], Vector2(x + w / 2.0, y + 22), 12,
			Color("#d9d3c4") if active else Color("#8e8c82"), true)
		if active:
			draw_line(Vector2(x + 4, y + 1), Vector2(x + w - 5, y + 1), Color("#e8c020"), 2.0)


func _draw_tiles() -> void:
	var grid_y := VH - ACTIONS_H - GRID_H
	draw_rect(Rect2(0, grid_y, VW, GRID_H), Color("#2c3035"))
	for t in _tile_rects():
		var type: String = t["type"]
		var rect: Rect2 = t["rect"]
		var def: Dictionary = C.UNITS[type] if C.UNITS.has(type) else C.BUILDINGS[type]
		var locked: bool = def.has("tech") and not sim.has_tech("player", def["tech"])
		var cost: int = sim.unit_cost("player", type) if C.UNITS.has(type) else int(def["cost"])
		var afford: bool = int(sim.teams["player"]["xenite"]) >= cost

		draw_rect(rect, Color("#202327") if (locked or not afford) else Color("#363b41"))
		draw_rect(rect, Color("#3c4147") if (locked or not afford) else Color("#6a7078"), false, 1.0)

		var icon_c := Color("#5b6167") if (locked or not afford) else Color("#4a6b8a")
		draw_circle(rect.position + Vector2(rect.size.x / 2.0, rect.size.y * 0.42),
			minf(rect.size.x, rect.size.y) * 0.24, icon_c)

		_text(def["name"], Vector2(rect.position.x + rect.size.x / 2.0, rect.position.y + rect.size.y - 14),
			10, Color("#8a8578") if (locked or not afford) else Color("#d9d3c4"), true)
		_text("ЗАКРЫТО" if locked else "%d КС" % cost,
			Vector2(rect.position.x + rect.size.x / 2.0, rect.position.y + rect.size.y - 3),
			10, Color("#7a7d80") if locked else (Color("#b06a4a") if not afford else Color("#e8b93f")), true)


func _draw_actions() -> void:
	var y := VH - ACTIONS_H
	draw_rect(Rect2(0, y, VW, ACTIONS_H), Color("#2c3035"))
	var w := (VW - 16.0) / 2.0
	draw_rect(Rect2(8, y + 4, w, 42), Color("#4a5058"))
	_text("ВСЕ ВОЙСКА", Vector2(28, y + 30), 13, Color("#d9d3c4"))
	draw_rect(Rect2(8 + w, y + 4, w, 42), Color("#e8c020") if attack_mode else Color("#4a5058"))
	_text("ВЫБЕРИТЕ ЦЕЛЬ" if attack_mode else "АТАКА", Vector2(8 + w + w / 2.0, y + 30), 14,
		Color("#241f14") if attack_mode else Color("#d9d3c4"), true)


func _draw_toasts() -> void:
	var y := field_rect.position.y + 46.0
	for t in toasts:
		var w := minf(VW - 24.0, maxf(140.0, _font.get_string_size(t["text"], HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 28.0))
		var rect := Rect2(VW / 2.0 - w / 2.0, y, w, 30)
		draw_rect(rect, Color(0.09, 0.11, 0.13, 0.92))
		draw_rect(rect, Color("#5c646c"), false, 1.0)
		_text(t["text"], Vector2(VW / 2.0, y + 20), 12, Color("#d9d3c4"), true)
		y += 36.0

	if announce_life > 0.0:
		var a := clampf(announce_life / 0.6, 0.0, 1.0)
		var w2 := minf(VW - 40.0, 320.0)
		var rect2 := Rect2(VW / 2.0 - w2 / 2.0, field_rect.position.y + field_rect.size.y - 92.0, w2, 44)
		draw_rect(rect2, Color(0.05, 0.06, 0.07, 0.88 * a))
		draw_rect(rect2, Color(0.91, 0.75, 0.13, a), false, 1.5)
		_text(announce_text, Vector2(VW / 2.0, rect2.position.y + 27), 14,
			Color(0.94, 0.9, 0.82, a), true)


func _draw_tech() -> void:
	draw_rect(field_rect, Color(0.02, 0.03, 0.04, 0.94))
	_text("ТЕХНОЛОГИИ", Vector2(20, field_rect.position.y + 32), 18, Color("#d9d3c4"))
	var queue: Array = sim.teams["player"]["techQueue"]
	var status := "свободно"
	if queue.size() > 0:
		var job: Dictionary = queue[0]
		status = "ИССЛЕДОВАНИЕ: %s %d%%" % [job["id"], int(float(job["progress"]) / float(job["total"]) * 100.0)]
	_text(status, Vector2(20, field_rect.position.y + 50), 11, Color("#8e8c82"))

	for node in _tech_nodes():
		var t: Dictionary = node["tech"]
		var rect := Rect2(node["pos"], Vector2(node["w"], node["h"]))
		var done: bool = sim.teams["player"]["researched"].has(t["id"])
		var queued := false
		for q in queue:
			if q["id"] == t["id"]:
				queued = true
		var can_req := true
		for r in t["requires"]:
			if not sim.teams["player"]["researched"].has(r):
				can_req = false
		var can_money: bool = int(sim.teams["player"]["xenite"]) >= int(t["cost"])

		var bg: Color = Color("#2a2e33")
		if done:
			bg = Color("#26301f")
		elif queued:
			bg = Color("#332e22")
		elif can_req and can_money:
			bg = Color("#2e343a")
		draw_rect(rect, bg)
		draw_rect(rect, Color("#6f9b52") if done else (Color("#e8c020") if queued
			else (Color("#4a5058") if (can_req and can_money) else Color("#3a3f45"))), false, 1.4)

		_text(t["name"], rect.position + Vector2(8, 18), 12,
			Color("#a8c48f") if done else Color("#d9d3c4"))
		_text(t["effect"], rect.position + Vector2(8, 32), 9,
			Color("#8fa87c") if done else Color("#a3a29a"))
		var st := "ИЗУЧЕНО" if done else ("В РАБОТЕ" if queued else
			("НУЖНА " + "/".join(t["requires"]) if not can_req else
			("%d КС · %dс" % [int(t["cost"]), int(t["time"])] if can_money else "НЕТ КС")))
		_text(st, rect.position + Vector2(rect.size.x - 8, rect.size.y - 6), 9,
			Color("#7ddc3c") if done else (Color("#e8c020") if queued else Color("#8a887e")), false, true)

	draw_rect(Rect2(VW - 108, field_rect.position.y + 12, 96, 30), Color("#4a5058"))
	_text("ЗАКРЫТЬ", Vector2(VW - 60, field_rect.position.y + 32), 11, Color("#d9d3c4"), true)


func _draw_result() -> void:
	draw_rect(Rect2(0, 0, VW, VH), Color(0.02, 0.03, 0.04, 0.9))
	var win := sim.result == "win"
	var panel_h := 266.0
	var py := field_rect.position.y + maxf(6.0, (field_rect.size.y - panel_h) / 2.0 - 20.0)
	_panel(Rect2(24, py, VW - 48, panel_h))
	_text("ПОБЕДА" if win else "ПОРАЖЕНИЕ", Vector2(VW / 2.0, py + 56), 36,
		Color("#7ddc3c") if win else Color("#d9503f"), true)
	_text("Командный центр Голратов уничтожен" if win else "Наш командный центр потерян",
		Vector2(VW / 2.0, py + 84), 12, Color("#d9d3c4"), true)

	var t := int(sim.time)
	var rows := [
		["Время боя", "%02d:%02d" % [int(t / 60), t % 60]],
		["Потеряно единиц", str(int(sim.teams["player"]["lost"]))],
		["Технологий изучено", "%d / %d" % [sim.teams["player"]["researched"].size(), C.TECHS.size()]]
	]
	var y := py + 122.0
	for r in rows:
		_text(r[0], Vector2(44, y), 12, Color("#8e8c82"))
		_text(r[1], Vector2(VW - 44, y), 12, Color("#d9d3c4"), false, true)
		y += 22.0

	var btn := Rect2(40, py + panel_h - 52, VW - 80, 40)
	draw_rect(btn, Color("#4a5058"))
	draw_rect(btn, Color("#6a7078"), false, 1.0)
	_text("ИГРАТЬ СНОВА", Vector2(VW / 2.0, py + panel_h - 26), 14, Color("#d9d3c4"), true)
