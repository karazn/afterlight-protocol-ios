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

