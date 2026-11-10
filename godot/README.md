# THAN-DOR — проект Godot 4

Основа для сборки APK. Логика — перенос `prototype/js/sim.js`, данные — из `prototype/js/config.js`.

## Что внутри

```
godot/
├── project.godot          портрет 390×844, mobile-рендерер, тач-ввод
├── export_presets.cfg     пресет Android (arm64 + armeabi-v7a)
├── core/
│   ├── config.gd          карта, юниты, здания, технологии, баланс (данные)
│   └── sim.gd             вся симуляция: экономика, A*, бой, ИИ, туман войны
└── scenes/
    ├── Main.tscn          единственная сцена уровня
    └── Main.gd            отрисовка состояния + обработка касаний
```

## Как открыть

1. Установить **Godot 4.3+** (стандартная сборка, не .NET).
2. Godot → **Import** → выбрать `godot/project.godot`.
3. **F5** — запуск на десктопе (мышь работает как палец — включено `emulate_touch_from_mouse`).

## Как собрать APK

1. **Editor → Editor Settings → Export → Android** — указать путь к Android SDK
   (нужны cmdline-tools, platform-tools, build-tools, NDK, JDK 17).
2. **Project → Install Android Build Template** (однократно).
3. **Project → Export → Android**:
   - Keystore → создать/указать debug или release ключ (без него APK не подпишется);
   - Architecture: **arm64-v8a** (обязательно) + armeabi-v7a (для старых устройств);
   - Export Project → получить `build/thandor.apk`.
4. Установка: `adb install -r build/thandor.apk`.

## Статус переноса

| Механика | В `sim.gd` | В `Main.gd` (вид) |
|---|---|---|
| Карта, ксенит, скалы, вода | ✅ | ✅ примитивами |
| Экономика: сборщик → база | ✅ | ✅ |
| Производство, очередь | ✅ | ✅ |
| Техтехнологии (10 узлов, 2 ветки) | ✅ | ✅ панель «ТЕХ» |
| Полуавтоматический бой | ✅ | ✅ |
| Туман войны | ✅ | ✅ (квадратами; в Godot лучше шейдером) |
| ИИ: экономика, армия, волны | ✅ | — |
| Победа/поражение, статистика | ✅ | ✅ |
| Звук и озвучка | — | — (следующий шаг, файлы из `prototype/audio/`) |
| Арт-спрайты | — | — (сейчас примитивы, заменяются в `_draw_*`) |

## Что улучшить при переносе на «настоящий» Godot

- туман войны — `CanvasModulate` + шейдер вместо сетки квадратов;
- 2D-камера — `Camera2D` с `zoom` вместо ручного `_s()`;
- ввод — `_unhandled_input` уже готов, добавить `InputEventScreenDrag` для пинча (`Input.is_action_pressed`);
- HUD — `Control`-ноды вместо `_draw` (проще локализовать и масштабировать);
- звук — `AudioStreamPlayer` с пулом для реплик юнитов.
