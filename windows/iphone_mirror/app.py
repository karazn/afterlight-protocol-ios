from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from iphone_mirror.ui import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("iPhone USB Mirror")
    app.setOrganizationName("iPhone USB Mirror")
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
