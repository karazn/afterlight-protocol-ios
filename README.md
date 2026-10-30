# iPhone USB Mirror

Бесплатное приложение с открытым исходным кодом для вывода экрана iPhone на Windows 10/11 через USB. Без рекламы, подписки, водяных знаков, jailbreak и платных SDK.

> Это не AirPlay и не эмуляция. Экран действительно захватывает ReplayKit Broadcast Upload Extension на iPhone, аппаратно кодирует VideoToolbox в H.264 и передаёт по TCP через `usbmuxd/iproxy`. На Windows поток декодирует FFmpeg через PyAV.

## Что уже реализовано

- автоматическое обнаружение iPhone по USB и проверка pairing/trust;
- H.264-захват всего экрана через ReplayKit, включая другие приложения и игры;
- 720p/1080p и 30/60 FPS, переключаемые из Windows;
- аппаратное H.264-кодирование VideoToolbox;
- попытка аппаратного декодирования NVIDIA CUVID или Intel Quick Sync, затем автоматический fallback на программный FFmpeg;
- политика `latest frame`: GUI не создаёт очередь старых кадров;
- полноэкранный режим (F11), тёмный интерфейс, FPS и честно обозначенная оценка задержки;
- вывод системного/app audio, когда ReplayKit отдаёт незашифрованный звук игры;
- восстановление туннеля и потока после переподключения кабеля;
- GitHub Actions для Windows EXE и unsigned IPA.

## Реальные ограничения iOS

1. Пользователь обязан вручную подтвердить начало трансляции в системном ReplayKit picker. Публичного API для скрытого автоматического захвата всего экрана нет.
2. iOS-приложение и его Broadcast Extension должны быть подписаны. Официальная локальная сборка iOS требует macOS + Xcode. Если Mac отсутствует, workflow в этом репозитории собирает unsigned IPA на бесплатном macOS runner GitHub; подпишите его своим Apple ID через AltStore/SideStore. Бесплатная подпись обычно действует 7 дней и требует периодического обновления.
3. Нельзя обещать задержку менее 50 мс на любой системе. Значение в интерфейсе — модельная оценка (`RTT/2 + 1.5 кадра`), а не лабораторное измерение «фотон-в-фотон». На итог влияют ReplayKit, VideoToolbox, драйвер, декодер и частота монитора.
4. Некоторые приложения с защищённым видео/аудио могут отдавать чёрный кадр или тишину. Это ограничение iOS/DRM.
5. iPhone 15 Plus использует USB 2.0; выбранные битрейты 4–12 Мбит/с заметно ниже практической полосы USB 2.0, поэтому кабель не должен быть узким местом.

## Установка на Windows

### 1. Драйвер Apple

Установите **Apple Devices** из Microsoft Store (либо iTunes с сайта Apple). Это даёт Windows-драйвер Apple Mobile Device, который нужен `usbmuxd`.

### 2. USB-инструменты

Откройте PowerShell в корне проекта:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
```

Скрипт скачивает актуальную x64-сборку `libimobiledevice` из релизов `jrjr/libimobiledevice-windows` и кладёт `idevice_id`, `idevicepair`, `ideviceinfo`, `iproxy` и DLL рядом в `tools/libimobiledevice`. Эти GPL/LGPL-компоненты не вшиваются в наш MIT EXE.

Подключите разблокированный iPhone, нажмите **Доверять** и введите код-пароль.

### 3. Запуск из исходников

Нужен Python 3.11 или новее, x64:

```powershell
.\scripts\run-windows.ps1
```

### 4. EXE

```powershell
.\scripts\build-windows.ps1
```

Результат: `dist/iPhone-USB-Mirror/iPhone-USB-Mirror.exe`. Папку нужно переносить целиком. После сборки один раз выполните `setup-windows.ps1` или положите USB-инструменты в `tools/libimobiledevice` рядом с папкой приложения.

## Сборка и установка IPA без собственного Mac

1. Загрузите проект на GitHub.
2. Откройте **Actions → Build Windows and iOS → Run workflow**.
3. После успешной сборки скачайте artifact `iPhone-USB-Mirror-unsigned-IPA`.
4. На Windows установите AltServer с официального сайта AltStore, войдите своим Apple ID и установите/подпишите IPA. Альтернатива — SideStore. Не загружайте Apple ID, пароль, `.p12` или provisioning profile в публичный репозиторий.
5. На iOS 16+ при необходимости включите **Настройки → Конфиденциальность и безопасность → Режим разработчика**.
6. Откройте USB Mirror на iPhone, нажмите синюю кнопку, выберите **USB Mirror**, затем **Начать трансляцию**.
7. В Windows нажмите **Подключить**.

Bundle ID по умолчанию — `org.iphoneusbmirror.app`. Если инструмент подписи сообщает конфликт, замените оба идентификатора в `ios/project.yml`, сохранив суффикс `.broadcast` у extension, и также измените `preferredExtension` в `ios/iPhoneMirror/iPhoneMirrorApp.swift`.

## Сборка iOS на Mac (официальный путь)

```bash
brew install xcodegen
cd ios
xcodegen generate
open iPhoneMirror.xcodeproj
```

В Xcode выберите свою Team для обоих targets, задайте уникальные Bundle IDs, подключите iPhone и нажмите Run. Платная Apple Developer Program не обязательна для установки на собственное устройство через Personal Team, но бесплатная подпись ограничена по сроку.

## Использование

1. Подключите iPhone 15 Plus качественным USB-C data-кабелем.
2. Запустите iOS-приложение и ReplayKit-трансляцию.
3. Запустите Windows-клиент и нажмите **Подключить**.
4. Для игр выберите 720p/60 FPS, если GPU/CPU не успевает с 1080p/60. Для максимальной детализации — 1080p/60.
5. F11 включает полноэкранный режим; Escape возвращает окно.

## Протокол

`iproxy` пробрасывает три loopback-порта Windows в те же порты iPhone:

| Порт | Назначение | Формат |
|---:|---|---|
| 12005 | видео | raw H.264 Annex B, SPS/PPS перед каждым IDR |
| 12006 | звук | big-endian `uint32 length`, затем rate/channels/format + Float32 LE PCM |
| 12007 | управление | big-endian `uint32 length` + JSON request/response |

Управление поддерживает `ping` и `setConfig` (`resolution`, `fps`, `bitrate`). Все порты слушаются только на устройстве и локальном `127.0.0.1` со стороны Windows.

## Проверка

```powershell
py -3 -m venv .venv-test
.\.venv-test\Scripts\python -m pip install -e . pytest
.\.venv-test\Scripts\python -m pytest
```

Полевой тест всё равно обязателен: ReplayKit, VideoToolbox и USB pairing нельзя полноценно воспроизвести в CI без физического iPhone.

## Использованные открытые компоненты и исследование

- Apple ReplayKit `RPBroadcastSampleHandler` — системные video/app-audio sample buffers;
- Apple VideoToolbox — realtime H.264 hardware encoding;
- libimobiledevice/libusbmuxd `iproxy` — TCP forwarding по USB;
- FFmpeg через PyAV — H.264 decoding;
- PySide6 (Qt LGPL) — Windows GUI и аудиовывод.

Лицензия собственного кода: MIT. Лицензии зависимостей сохраняются отдельно и не перелицензируются.
