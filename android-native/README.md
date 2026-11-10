# THAN-DOR — тестовый APK (нативная оболочка)

Готовый файл: **`artifacts/thandor-debug-0.1.0.apk`** (226 КБ).

Это не Godot-сборка, а нативная оболочка на WebView: внутрь APK упакован тот же
HTML5-прототип из `prototype/`. Сделано так потому, что Godot-экспорт требует
полного Android SDK (Gradle, NDK), а этот APK собирается напрямую через
`aapt2` + `javac` + `d8` + `apksigner` и весит в 100 раз меньше.

---

## Что внутри APK

| Файл | Что это |
|---|---|
| `classes.dex` | `MainActivity` — полноэкранный WebView, портрет, перехват ассетов |
| `www/index.html`, `www/css`, `www/js` | игровой прототип целиком |
| `www/audio/*.mp3` | 8 реплик: командир-анонсер + юниты |
| `res/mipmap-*` | иконка THAN-DOR (5 плотностей) |
| `AndroidManifest.xml` | package `com.thandor.vtorzhenie`, minSdk 21, targetSdk 33 |

**Параметры:**

| | |
|---|---|
| Package | `com.thandor.vtorzhenie` |
| Название | THAN-DOR |
| Версия | 0.1.0 (code 1) |
| minSdk | 21 (Android 5.0) |
| targetSdk | 33 (Android 13) |
| Ориентация | портрет, зафиксирована |
| Подпись | debug keystore, схемы v1 + v2 + v3 |
| Размер | 226 КБ |

---

## Как установить на телефон

### Способ 1: через adb (быстрее)

```bash
adb install -r artifacts/thandor-debug-0.1.0.apk
```

Если ругается на установку из неизвестного источника — включить
«Установка из неизвестных источников» в настройках для adb/файлового менеджера.

### Способ 2: файлом

1. Скинуть APK на телефон (Telegram «Избранное», облако, USB).
2. Открыть файл через файловый менеджер.
3. Разрешить установку из этого источника, если система попросит.

> Это debug-сборка для теста, не для Google Play. Ключ подписи — стандартный
> отладочный, поэтому обновление поверх другой сборки потребует переустановки.

---

## Как пересобрать

Нужны инструменты (на обычной машине — из Android SDK):

```bash
export JAVA_HOME=/путь/к/jdk
export AAPT2=$ANDROID_HOME/build-tools/34.0.0/aapt2
export ANDROID_JAR=$ANDROID_HOME/platforms/android-34/android.jar
export D8_JAR=$ANDROID_HOME/build-tools/34.0.0/lib/d8.jar
export APKSIGNER_JAR=$ANDROID_HOME/build-tools/34.0.0/lib/apksigner.jar
export ECJ_JAR=/путь/к/ecj.jar          # компилятор Java, если нет полного JDK

./tools/build-apk.sh
```

Скрипт сам: компилирует ресурсы, компилирует Java, делает dex, копирует
прототип в `assets/www`, упаковывает с выравниванием на 4 байта, подписывает
debug-ключом (создаёт его при первом запуске) и проверяет подпись.

Переменные: `VERSION_NAME`, `VERSION_CODE`. Для своего ключа:

```bash
export THANDOR_KEYSTORE=/путь/release.jks THANDOR_ALIAS=thandor \
       THANDOR_STOREPASS=... THANDOR_KEYPASS=...
./tools/build-apk.sh --release
```

---

## Структура

```
android-native/
├── AndroidManifest.xml          манифест приложения
├── src/com/thandor/vtorzhenie/
│   └── MainActivity.java        WebView + перехват ассетов
├── res/
│   ├── mipmap-*/ic_launcher.png иконка
│   └── values/strings.xml       название
└── build/                       промежуточные файлы (в git не нужны)

tools/
├── build-apk.sh                 сборка одной командой
└── apk_pack.py                  упаковка + выравнивание (замена zipalign)
```

---

## Почему ассеты через `shouldInterceptRequest`

Игра грузится с `http://thandor.local/index.html`, а `MainActivity` отдаёт файлы
из `assets/www/`. Альтернатива — `file:///android_asset/...`, но тогда у страницы
непрозрачный origin, и `fetch()` за озвучкой блокируется политикой CORS.
С перехватом запросов страница ведёт себя как обычный сайт: `fetch`, `decodeAudioData`
и `AudioContext` работают без костылей.

---

## Ограничения тестовой сборки

- **WebView, а не Godot.** Производительность зависит от системного WebView телефона.
  Для реальной игры целевой путь — `godot/` (см. `godot/README.md`), это отдельная сборка.
- **Нет интернета** — и не нужен: все ассеты внутри, внешние ссылки вырезаны при сборке.
- **Debug-подпись** — не подходит для публикации.
- **Ориентация только портретная**, как в ТЗ.
- Проверено статически: подпись, манифест, целостность zip, раздача всех ассетов
  с правильными MIME. На реальном устройстве не запускалось — устройства в среде сборки нет.
