#!/usr/bin/env python3
"""Упаковка APK без Gradle: собирает финальный zip с правильным выравниванием.

Зачем свой упаковщик:
  * zipalign в песочнице недоступен, а без выравнивания resources.arsc
    APK не установится на Android 11+ (targetSdk >= 30);
  * контроль над порядком и методом сжатия каждой записи.

Использование:
  python3 apk_pack.py base.apk out-unsigned.apk classes.dex assets www

Где base.apk — результат `aapt2 link` (манифест + ресурсы + resources.arsc),
а остальные аргументы — файлы/папки, которые нужно положить в корень APK.
"""
import os
import struct
import sys
import time
import zipfile
import zlib

ALIGN = 4


def _dos_time_date():
    now = time.localtime()
    d = ((now.tm_year - 1980) << 9) | (now.tm_mon << 5) | now.tm_mday
    t = (now.tm_hour << 11) | (now.tm_min << 5) | (now.tm_sec // 2)
    return t, d


def _collect(*paths):
    """Список (arcname, файл) для упаковки."""
    out = []
    for p in paths:
        if not os.path.exists(p):
            continue
        if os.path.isfile(p):
            out.append((os.path.basename(p), p))
            continue
        for root, _dirs, files in os.walk(p):
            for f in sorted(files):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, p)
                out.append((os.path.join(os.path.basename(p), rel).replace(os.sep, "/"), full))
    return out


def build(base_apk, out_apk, extras):
    with zipfile.ZipFile(base_apk) as z:
        base_entries = [(i.filename, z.read(i.filename), i.compress_type) for i in z.infolist()]

    entries = []
    # resources.arsc должен идти первым и без сжатия — так его читают все версии
    for name, data, comp in base_entries:
        if name == "resources.arsc":
            entries.append((name, data, zipfile.ZIP_STORED))
    for name, data, comp in base_entries:
        if name != "resources.arsc":
            entries.append((name, data, comp))

    for arcname, path in _collect(*extras):
        with open(path, "rb") as fh:
            raw = fh.read()
        # уже сжатые форматы не сжимаем повторно
        if arcname.endswith((".png", ".jpg", ".mp3", ".ogg")):
            entries.append((arcname, raw, zipfile.ZIP_STORED))
        else:
            entries.append((arcname, raw, zipfile.ZIP_DEFLATED))

    dt, dd = _dos_time_date()
    central = []
    with open(out_apk, "wb") as fh:
        for name, raw, method in entries:
            name_b = name.encode("utf-8")
            if method == zipfile.ZIP_DEFLATED:
                comp = zlib.compressobj(9, zlib.DEFLATED, -15)
                body = comp.compress(raw) + comp.flush()
            else:
                body = raw
            crc = zlib.crc32(raw) & 0xFFFFFFFF

            extra = b""
            if method == zipfile.ZIP_STORED:
                # padding через extra-field 0x0000, чтобы данные легли на границу 4 байт
                header_len = 30 + len(name_b) + 4
                offset = fh.tell()
                pad = (-(offset + header_len)) % ALIGN
                extra = struct.pack("<HH", 0x0000, pad) + b"\x00" * pad
            flags = 0x0800  # имена в UTF-8

            offset = fh.tell()
            fh.write(struct.pack(
                "<IHHHHHIIIHH", 0x04034B50, 20, flags, method, dt, dd,
                crc, len(body), len(raw), len(name_b), len(extra)))
            fh.write(name_b)
            fh.write(extra)
            fh.write(body)

            central.append((name_b, method, dt, dd, crc, len(body), len(raw), offset, flags))

        cd_offset = fh.tell()
        for name_b, method, dt, dd, crc, csize, usize, offset, flags in central:
            fh.write(struct.pack(
                "<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, flags, method, dt, dd,
                crc, csize, usize, len(name_b), 0, 0, 0, 0, 0, offset))
            fh.write(name_b)
        cd_size = fh.tell() - cd_offset
        fh.write(struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(central),
                             len(central), cd_size, cd_offset, 0))
    return out_apk


def check_alignment(path):
    """Проверяет, что STORED-записи выровнены на 4 байта."""
    bad = []
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if info.compress_type != zipfile.ZIP_STORED:
                continue
            with open(path, "rb") as fh:
                fh.seek(info.header_offset + 26)
                nlen = struct.unpack("<H", fh.read(2))[0]
                elen = struct.unpack("<H", fh.read(2))[0]
                data_off = info.header_offset + 30 + nlen + elen
            if data_off % ALIGN != 0:
                bad.append((info.filename, data_off))
    return bad


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    base, out = sys.argv[1], sys.argv[2]
    build(base, out, sys.argv[3:])
    problems = check_alignment(out)
    print("APK:", out, os.path.getsize(out), "байт")
    print("невыровненные записи:", problems if problems else "нет")
    sys.exit(1 if problems else 0)
