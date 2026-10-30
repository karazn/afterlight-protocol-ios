from __future__ import annotations

from PySide6.QtCore import QRect, Qt, QThread, QTimer, Signal
from PySide6.QtGui import QColor, QImage, QKeyEvent, QPainter
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from .device import Device, DeviceProbe
from .stream import AudioWorker, ControlWorker, LatestFrame, StreamConfig, VideoWorker
from .tunnel import USBTunnel


class ScanWorker(QThread):
    found = Signal(object)

    def __init__(self, probe: DeviceProbe) -> None:
        super().__init__()
        self.probe = probe

    def run(self) -> None:
        self.found.emit(self.probe.scan())


class VideoCanvas(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.image: QImage | None = None
        self.setMinimumSize(640, 360)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

    def set_image(self, image: QImage) -> None:
        self.image = image
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#070a0f"))
        if not self.image:
            painter.setPen(QColor("#657084"))
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "Подключите iPhone и запустите трансляцию")
            return
        source = self.image.size()
        fitted = source.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatio)
        x = (self.width() - fitted.width()) // 2
        y = (self.height() - fitted.height()) // 2
        painter.drawImage(QRect(x, y, fitted.width(), fitted.height()), self.image)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("iPhone USB Mirror")
        self.resize(1240, 780)
        self.probe = DeviceProbe()
        self.tunnel = USBTunnel()
        self.frames = LatestFrame()
        self.devices: list[Device] = []
        self.desired = False
        self.scan_worker: ScanWorker | None = None
        self.video_worker: VideoWorker | None = None
        self.control_worker: ControlWorker | None = None
        self.audio_worker: AudioWorker | None = None
        self.frame_serial = 0
        self._build_ui()
        self._apply_style()

        self.scan_timer = QTimer(self)
        self.scan_timer.timeout.connect(self._start_scan)
        self.scan_timer.start(1500)
        self.retry_timer = QTimer(self)
        self.retry_timer.timeout.connect(self._ensure_connection)
        self.retry_timer.start(1000)
        self.frame_timer = QTimer(self)
        self.frame_timer.timeout.connect(self._present_frame)
        self.frame_timer.start(16)
        QTimer.singleShot(0, self._start_scan)

    def _build_ui(self) -> None:
        root = QWidget()
        layout = QVBoxLayout(root)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(12)

        top = QHBoxLayout()
        brand = QLabel("iPhone USB Mirror")
        brand.setObjectName("brand")
        top.addWidget(brand)
        top.addStretch()
        self.connection_badge = QLabel("●  Поиск iPhone")
        self.connection_badge.setObjectName("badge")
        top.addWidget(self.connection_badge)
        layout.addLayout(top)

        body = QHBoxLayout()
        body.setSpacing(12)
        self.canvas = VideoCanvas()
        body.addWidget(self.canvas, 1)

        panel = QFrame()
        panel.setObjectName("panel")
        panel.setFixedWidth(270)
        controls = QVBoxLayout(panel)
        controls.setContentsMargins(18, 18, 18, 18)
        controls.setSpacing(10)
        controls.addWidget(QLabel("УСТРОЙСТВО", objectName="section"))
        self.device_label = QLabel("iPhone не найден")
        self.device_label.setWordWrap(True)
        controls.addWidget(self.device_label)
        self.connect_button = QPushButton("Подключить")
        self.connect_button.clicked.connect(self._toggle_connection)
        controls.addWidget(self.connect_button)

        controls.addSpacing(10)
        controls.addWidget(QLabel("КАЧЕСТВО", objectName="section"))
        self.resolution = QComboBox()
        self.resolution.addItems(["720p", "1080p"])
        self.resolution.setCurrentText("1080p")
        self.resolution.currentIndexChanged.connect(self._config_changed)
        controls.addWidget(self.resolution)
        self.fps = QComboBox()
        self.fps.addItems(["30 FPS", "60 FPS"])
        self.fps.setCurrentText("60 FPS")
        self.fps.currentIndexChanged.connect(self._config_changed)
        controls.addWidget(self.fps)
        self.hardware = QCheckBox("Аппаратный декодер")
        self.hardware.setChecked(True)
        controls.addWidget(self.hardware)
        self.audio = QCheckBox("Звук iPhone")
        self.audio.setChecked(True)
        self.audio.stateChanged.connect(self._audio_changed)
        controls.addWidget(self.audio)

        controls.addSpacing(10)
        controls.addWidget(QLabel("ТЕЛЕМЕТРИЯ", objectName="section"))
        self.fps_label = QLabel("FPS: —")
        self.latency_label = QLabel("Задержка (оценка): —")
        self.decoder_label = QLabel("Декодер: —")
        controls.addWidget(self.fps_label)
        controls.addWidget(self.latency_label)
        controls.addWidget(self.decoder_label)
        controls.addStretch()
        fullscreen = QPushButton("На весь экран  ·  F11")
        fullscreen.clicked.connect(self._toggle_fullscreen)
        controls.addWidget(fullscreen)
        self.hint = QLabel("На iPhone откройте приложение и нажмите «Начать трансляцию».")
        self.hint.setObjectName("hint")
        self.hint.setWordWrap(True)
        controls.addWidget(self.hint)
        body.addWidget(panel)
        layout.addLayout(body, 1)

        self.status = QLabel("Проверка компонентов…")
        self.status.setObjectName("status")
        layout.addWidget(self.status)
        self.setCentralWidget(root)

    def _apply_style(self) -> None:
        self.setStyleSheet("""
            QWidget { background: #0b0f16; color: #e7ecf4; font: 10pt 'Segoe UI'; }
            #brand { font-size: 18pt; font-weight: 700; color: #f7f9fc; }
            #badge { background: #151c27; border: 1px solid #273244; border-radius: 12px; padding: 6px 11px; color: #93a4ba; }
            #panel { background: #111722; border: 1px solid #222c3b; border-radius: 14px; }
            #section { color: #71829a; font-size: 8pt; font-weight: 700; }
            #hint, #status { color: #75849a; font-size: 9pt; }
            QPushButton { background: #2563eb; border: 0; border-radius: 8px; padding: 9px; font-weight: 600; }
            QPushButton:hover { background: #3474f3; }
            QPushButton:pressed { background: #1e51c4; }
            QComboBox { background: #171f2c; border: 1px solid #2a3648; border-radius: 7px; padding: 8px; }
            QComboBox QAbstractItemView { background: #171f2c; selection-background-color: #2563eb; }
            QCheckBox { spacing: 8px; padding: 5px 0; }
        """)

    def _start_scan(self) -> None:
        if self.scan_worker and self.scan_worker.isRunning():
            return
        if not self.probe.available:
            self.status.setText("Не найдены libimobiledevice. Запустите scripts\\setup-windows.ps1")
            self.connection_badge.setText("●  Нет USB-компонентов")
            return
        self.scan_worker = ScanWorker(self.probe)
        self.scan_worker.found.connect(self._devices_found)
        self.scan_worker.start()

    def _devices_found(self, devices: list[Device]) -> None:
        self.devices = devices
        if not devices:
            self.device_label.setText("iPhone не найден")
            self.connection_badge.setText("●  Кабель не подключён")
            if self.tunnel.alive:
                self._stop_workers(keep_desired=True)
            return
        device = devices[0]
        trust = "Доверен" if device.trusted else "Требуется доверие"
        self.device_label.setText(f"{device.name}\n{device.udid[:16]}…\n{trust}")
        if not self.desired:
            self.connection_badge.setText("●  iPhone обнаружен")

    def _toggle_connection(self) -> None:
        if self.desired:
            self._stop_workers(keep_desired=False)
            return
        self.desired = True
        self.connect_button.setText("Отключить")
        self._ensure_connection()

    def _ensure_connection(self) -> None:
        if not self.desired or not self.devices:
            return
        device = self.devices[0]
        if not device.trusted:
            ok, message = self.probe.pair(device.udid)
            self.status.setText(message or "Разблокируйте iPhone и нажмите «Доверять»")
            if not ok:
                return
        if not self.tunnel.alive:
            ok, message = self.tunnel.start(device.udid)
            self.status.setText(message)
            if not ok:
                return
        if self.control_worker is None:
            control = ControlWorker(self._config())
            control.ready.connect(self._control_ready)
            control.latency.connect(lambda value: self.latency_label.setText(f"Задержка (оценка): {value:.0f} мс"))
            control.status.connect(self.status.setText)
            control.finished.connect(self._control_finished)
            self.control_worker = control
            control.start()
            self.connection_badge.setText("●  Ожидание трансляции")
        elif self.video_worker is None and self.control_worker.isRunning():
            # The control channel may survive a transient video decoder failure.
            self._control_ready()

    def _control_ready(self) -> None:
        self.connection_badge.setText("●  Подключено по USB")
        self.status.setText("Поток запущен. Устаревшие кадры не накапливаются.")
        if self.video_worker is None:
            video = VideoWorker(self.frames, self.hardware.isChecked())
            video.status.connect(self.status.setText)
            video.stats.connect(self._video_stats)
            video.disconnected.connect(self.status.setText)
            video.finished.connect(self._video_finished)
            self.video_worker = video
            video.start()
        self._start_audio_if_needed()

    def _control_finished(self) -> None:
        self.control_worker = None
        if self.desired:
            self.connection_badge.setText("●  Переподключение…")

    def _video_finished(self) -> None:
        self.video_worker = None

    def _video_stats(self, fps: float, decoder: str) -> None:
        self.fps_label.setText(f"FPS: {fps:.1f}")
        self.decoder_label.setText(f"Декодер: {decoder}")

    def _present_frame(self) -> None:
        self.frame_serial, image = self.frames.get_after(self.frame_serial)
        if image:
            self.canvas.set_image(image)

    def _config(self) -> StreamConfig:
        resolution = 720 if self.resolution.currentIndex() == 0 else 1080
        fps = 30 if self.fps.currentIndex() == 0 else 60
        bitrate = {(720, 30): 4_000_000, (720, 60): 6_000_000, (1080, 30): 8_000_000, (1080, 60): 12_000_000}[(resolution, fps)]
        return StreamConfig(resolution, fps, bitrate, self.audio.isChecked(), self.hardware.isChecked())

    def _config_changed(self) -> None:
        if self.control_worker:
            self.control_worker.set_config(self._config())

    def _audio_changed(self) -> None:
        if self.audio.isChecked():
            self._start_audio_if_needed()
        elif self.audio_worker:
            self.audio_worker.stop()
            self.audio_worker.wait(1500)
            self.audio_worker = None

    def _start_audio_if_needed(self) -> None:
        if self.audio.isChecked() and self.control_worker and self.audio_worker is None:
            audio = AudioWorker()
            audio.status.connect(self.status.setText)
            audio.finished.connect(lambda: setattr(self, "audio_worker", None))
            self.audio_worker = audio
            audio.start()

    def _stop_workers(self, keep_desired: bool) -> None:
        self.desired = keep_desired
        for worker in (self.video_worker, self.audio_worker, self.control_worker):
            if worker:
                worker.stop()
        for worker in (self.video_worker, self.audio_worker, self.control_worker):
            if worker:
                worker.wait(2000)
        self.video_worker = self.audio_worker = self.control_worker = None
        self.tunnel.stop()
        if not keep_desired:
            self.connect_button.setText("Подключить")
            self.connection_badge.setText("●  Отключено")
            self.status.setText("Соединение закрыто")

    def _toggle_fullscreen(self) -> None:
        self.showNormal() if self.isFullScreen() else self.showFullScreen()

    def keyPressEvent(self, event: QKeyEvent) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_F11 or (event.key() == Qt.Key.Key_Escape and self.isFullScreen()):
            self._toggle_fullscreen()
        else:
            super().keyPressEvent(event)

    def closeEvent(self, event) -> None:  # noqa: N802
        self.scan_timer.stop()
        self.retry_timer.stop()
        self._stop_workers(keep_desired=False)
        if self.scan_worker:
            self.scan_worker.wait(2000)
        event.accept()

