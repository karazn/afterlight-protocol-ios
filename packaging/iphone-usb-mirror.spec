from pathlib import Path

import PySide6
from PyInstaller.utils.hooks import collect_all

av_datas, av_binaries, av_hidden = collect_all("av")

a = Analysis(
    ["../windows/iphone_mirror/app.py"],
    pathex=["../windows"],
    binaries=av_binaries,
    datas=av_datas,
    hiddenimports=av_hidden + ["PySide6.QtMultimedia"],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

# Qt 6.12 wheels carry a newer MSVC runtime than some Python distributions.
# The root DLL wins Windows' search order, so make it the matching Qt version.
qt_dir = Path(PySide6.__file__).resolve().parent
msvc_runtime = {
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
}
a.binaries = [
    entry for entry in a.binaries
    if entry[0].lower() not in msvc_runtime
    and not (
        entry[0].lower() in {"icuuc.dll", "icudt78.dll"}
        and "poppler" in entry[1].lower()
    )
]
for dll_name in sorted(msvc_runtime):
    dll_path = qt_dir / dll_name
    if dll_path.is_file():
        a.binaries.append((dll_name, str(dll_path), "BINARY"))

pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="iPhone-USB-Mirror",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    name="iPhone-USB-Mirror",
)

