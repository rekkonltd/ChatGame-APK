extends RefCounted
## THAN-DOR — конфигурация уровня и баланса.
##
## Перенос 1:1 из prototype/js/config.js. Здесь НЕЛЬЗЯ держать логику:
## только данные, чтобы баланс правился в одном месте для веб-прототипа и Godot.

const TITLE := "THAN-DOR"
const SUBTITLE := "ВТОРЖЕНИЕ"

# 0 — грунт, 1 — ксенит, 2 — скалы, 3 — вода (карта 40×40, по строке на ряд)
const MAP = [
	"0000000000000000000000000000000000000000",
	"0000000000000000000000000000000000000000",
	"0000000000000000000000000000000000000000",
	"0000000000000000000000000000000000000000",
	"0022000000000002200000000000000000000000",
	"0022000000000002200000000000000111000000",
	"0000000000000000000000000000000111000000",
	"0000000000000000000000000000000000000000",
	"0000000000000000000220000000000000000000",
	"0000000000022000000220000000000000000000",
	"0000000000022000000000000111000000000000",
	"0000000033000000000000000111000000000000",
	"0000220333300000000000000000000000000220",
	"0000220333300000000000000000000000000220",
	"0000000333300000001111000000000000000000",
	"0000000000000000001111000000000000000000",
	"0000000000000000000000000022000000000000",
	"0000000000000000000000000022000002220000",
	"0000000001110000000000000000000002220000",
	"0000000001110000000002200000000000000000",
	"0000000000002200000002200000000000000000",
	"0000000000002200000000000000000000000000",
	"0000000000000000000000001110000000000000",
	"0000000000000000000000001110000000000000",
	"0000002200000000000000000000333000000000",
	"0000002200000000000000000000333000022000",
	"0000000000000111000000000000333000022000",
	"0000000000000111000000000000000000000000",
	"0000000000000000000000220000000000000000",
	"0000000000000000000000220000000000000000",
	"0000000000000000000000000000222000000000",
	"0000000111000000000000000000222000000000",
	"0000000111000000000000000000000000000000",
	"0000000000000000000111000000000000000000",
	"0000000000000000000111000000000000000000",
	"0000000000000000000000000000000000000000",
	"0000000000000000220000000000002200000000",
	"0000000000000000220000000000002200000000",
	"0000000000000000000000000000000000000000",
	"0000000000000000000000000000000000000000"
]

const TILE := {"GROUND": 0, "XENITE": 1, "ROCK": 2, "WATER": 3}

const PALETTE := {
	"ground": {
		"a": "#6b7a3f",
		"b": "#61703a",
		"c": "#717f46",
		"dirt": "#7a5f42",
		"rockBase": "#5d5348",
		"sand": "#b8a179",
		"water": "#2e5a6b",
		"waterDeep": "#224553",
		"grid": "rgba(20,26,14,0.14)"
	},
	"player": {
		"main": "#4a6b8a",
		"dark": "#2d4457",
		"light": "#7ba3c4",
		"hp": "#6fdc4a"
	},
	"enemy": {
		"main": "#b8543f",
		"dark": "#7d3325",
		"light": "#e0906f",
		"hp": "#6fdc4a"
	},
	"xenite": {
		"core": "#e8b93f",
		"light": "#ffe79b",
		"dark": "#8f6a1c"
	},
	"fire": {
		"a": "#ff8a1e",
		"b": "#ffd35a",
		"smoke": "#2a2622"
	},
	"ui": {
		"panel": "#3a3f45",
		"panelDark": "#2c3035",
		"bevelLight": "#6a7078",
		"bevelDark": "#1d2126",
		"slot": "#262b31",
		"text": "#d9d3c4",
		"textDim": "#8e8c82",
		"green": "#7ddc3c",
		"amber": "#e8c020",
		"red": "#d9503f"
	},
	"fog": "#06080a"
}

const BALANCE := {
	"tickRate": 20,
	"tileSize": 48,
	"worldW": 40,
	"worldH": 40,
	"startXenite": 350,
	"enemyStartXenite": 360,
	"xenitePatch": 700,
	"harvestCarry": 8,
	"harvestTime": 0.9,
	"maxArmy": 30,
	"enemyMaxArmy": 22,
	"depositRange": 120,
	"buildRadius": 3.2,
	"loseOnCommandCenter": true
}

const UNITS := {
	"harvester": {
		"id": "harvester",
		"name": "Сборщик",
		"code": "ПИОНЕР",
		"role": "worker",
		"cost": 60,
		"buildTime": 4,
		"hp": 120,
		"armor": 0,
		"speed": 96,
		"radius": 12,
		"sight": 3.2,
		"damage": 0,
		"range": 0,
		"cooldown": 1,
		"splash": 0,
		"desc": "Добывает ксенит и возит его на базу."
	},
	"rifleman": {
		"id": "rifleman",
		"name": "Стрелок",
		"code": "ПЕХОТА",
		"role": "infantry",
		"cost": 80,
		"buildTime": 5,
		"hp": 150,
		"armor": 0,
		"speed": 104,
		"radius": 11,
		"sight": 4.2,
		"damage": 9,
		"range": 96,
		"cooldown": 0.75,
		"splash": 0,
		"desc": "Дешёвый и быстрый. Хорош против техники."
	},
	"hammer": {
		"id": "hammer",
		"name": "Молот",
		"code": "ТАНК",
		"role": "vehicle",
		"cost": 140,
		"buildTime": 7.5,
		"hp": 320,
		"armor": 2,
		"speed": 82,
		"radius": 15,
		"sight": 4.6,
		"damage": 22,
		"range": 128,
		"cooldown": 1.3,
		"splash": 0,
		"desc": "Бронированная машина. Медленная, но пробивает всё."
	},
	"groza": {
		"id": "groza",
		"name": "Гроза",
		"code": "САУ",
		"role": "vehicle",
		"cost": 190,
		"buildTime": 9,
		"hp": 180,
		"armor": 1,
		"speed": 62,
		"radius": 15,
		"sight": 4.8,
		"damage": 40,
		"range": 260,
		"cooldown": 2.5,
		"splash": 48,
		"tech": "A1",
		"desc": "Дальний залп по площади. Хрупкая и медленная."
	},
	"osa": {
		"id": "osa",
		"name": "Оса",
		"code": "ГЛИССЕР",
		"role": "vehicle",
		"cost": 210,
		"buildTime": 9.5,
		"hp": 200,
		"armor": 0,
		"speed": 190,
		"radius": 13,
		"sight": 5,
		"damage": 16,
		"range": 120,
		"cooldown": 1,
		"splash": 0,
		"tech": "A4",
		"hover": true,
		"desc": "Быстрый налёт, проходит над водой и скалами."
	}
}

const ENEMY_UNITS := {
	"harvester": {
		"name": "Копатель",
		"code": "ГОЛРАТ",
		"hp": 110
	},
	"rifleman": {
		"name": "Стрелок",
		"code": "ГОЛРАТ",
		"hp": 140,
		"damage": 8
	},
	"hammer": {
		"name": "Голем",
		"code": "ГОЛРАТ",
		"hp": 300
	},
	"groza": {
		"name": "Дробилка",
		"code": "ГОЛРАТ",
		"hp": 170
	},
	"osa": {
		"name": "Скользящий",
		"code": "ГОЛРАТ",
		"hp": 190
	}
}

const BUILDINGS := {
	"commandCenter": {
		"id": "commandCenter",
		"name": "Командный центр",
		"code": "ЦЕНТР",
		"cost": 0,
		"buildTime": 0,
		"hp": 1400,
		"armor": 6,
		"radius": 30,
		"sight": 5,
		"deposit": true,
		"produces": false,
		"desc": "Сдаёт ресурсы, исследует технологии."
	},
	"factory": {
		"id": "factory",
		"name": "Завод",
		"code": "ЗАВОД",
		"cost": 250,
		"buildTime": 10,
		"hp": 900,
		"armor": 5,
		"radius": 26,
		"sight": 4,
		"deposit": true,
		"produces": true,
		"desc": "Производит войска. Принимает ксенит."
	},
	"turret": {
		"id": "turret",
		"name": "Страж",
		"code": "ТУРЕЛЬ",
		"cost": 110,
		"buildTime": 6,
		"hp": 420,
		"armor": 4,
		"radius": 16,
		"sight": 4.8,
		"damage": 15,
		"range": 150,
		"cooldown": 1.1,
		"desc": "Стационарная защита базы."
	},
	"radar": {
		"id": "radar",
		"name": "Радар",
		"code": "РАДАР",
		"cost": 180,
		"buildTime": 8,
		"hp": 500,
		"armor": 3,
		"radius": 18,
		"sight": 5,
		"visionBonus": 0.4,
		"desc": "+40% обзора, показывает волны врага."
	}
}

const TECHS := [
	{
		"id": "A1",
		"branch": "army",
		"tier": 1,
		"name": "Улучшенные орудия",
		"cost": 150,
		"time": 15,
		"requires": [],
		"effect": "Открывает САУ «Гроза», +10% урона",
		"unlock": "groza",
		"dmg": 0.1
	},
	{
		"id": "A2",
		"branch": "army",
		"tier": 2,
		"name": "Плазма I",
		"cost": 180,
		"time": 18,
		"requires": ["A1"],
		"effect": "+15% урона всем войскам",
		"dmg": 0.15
	},
	{
		"id": "A3",
		"branch": "army",
		"tier": 2,
		"name": "Композитная броня",
		"cost": 160,
		"time": 16,
		"requires": ["A1"],
		"effect": "+25% HP техники",
		"hpVehicle": 0.25
	},
	{
		"id": "A4",
		"branch": "army",
		"tier": 3,
		"name": "Ионный двигатель",
		"cost": 220,
		"time": 22,
		"requires": ["A2"],
		"effect": "Открывает глиссер «Оса», +10% скорости",
		"unlock": "osa",
		"speed": 0.1
	},
	{
		"id": "A5",
		"branch": "army",
		"tier": 4,
		"name": "Плазма II",
		"cost": 260,
		"time": 26,
		"requires": ["A4"],
		"effect": "Ещё +25% урона",
		"dmg": 0.25
	},
	{
		"id": "E1",
		"branch": "eco",
		"tier": 1,
		"name": "Экстракторы I",
		"cost": 140,
		"time": 14,
		"requires": [],
		"effect": "+25% добыча сборщика",
		"harvest": 0.25
	},
	{
		"id": "E2",
		"branch": "eco",
		"tier": 2,
		"name": "Конвейер",
		"cost": 170,
		"time": 16,
		"requires": ["E1"],
		"effect": "−15% цена войск",
		"costMod": -0.15
	},
	{
		"id": "E3",
		"branch": "eco",
		"tier": 2,
		"name": "Логистика",
		"cost": 150,
		"time": 15,
		"requires": ["E1"],
		"effect": "+20% скорость всех юнитов",
		"speed": 0.2
	},
	{
		"id": "E4",
		"branch": "eco",
		"tier": 3,
		"name": "Экстракторы II",
		"cost": 210,
		"time": 20,
		"requires": ["E3"],
		"effect": "Ещё +35% добыча",
		"harvest": 0.35
	},
	{
		"id": "E5",
		"branch": "eco",
		"tier": 4,
		"name": "Автосборка",
		"cost": 240,
		"time": 24,
		"requires": ["E4"],
		"effect": "−25% время производства",
		"buildTime": -0.25
	}
]

const TEAMS := {
	"player": {"id": "player", "name": "Альянс Аварес", "short": "АЛЬЯНС", "color": "#4a6b8a"},
	"enemy": {"id": "enemy", "name": "Голраты", "short": "ГОЛРАТ", "color": "#8a3f34"}
}

const ENEMY_AI := {
	"thinkInterval": 1.5,
	"firstWaveAt": 55,
	"waveInterval": 42,
	"waveGrowth": 1,
	"guardTurrets": 2
}

const LEVEL := {
	"id": "level-01",
	"name": "Плацдарм «Гелиос»",
	"objective": "Уничтожьте Командный центр Голратов",
	"playerHC": {
		"tx": 5,
		"ty": 34
	},
	"enemyHC": {
		"tx": 33,
		"ty": 4
	}
}

const ANNOUNCER := {
	"baseUnderAttack": "База атакована",
	"notEnough": "Недостаточно ресурсов",
	"buildDone": "Строительство завершено",
	"unitReady": "Подразделение готово",
	"techDone": "Технология исследована",
	"waveIncoming": "Обнаружено движение противника",
	"contact": "Контакт с противником",
	"unitLost": "Мы потеряли подразделение",
	"targetDamaged": "Цель повреждена",
	"victory": "Голраты отступают. Победа за нами",
	"defeat": "Командный центр потерян",
	"start": "Высадка завершена. Начинаем операцию"
}

