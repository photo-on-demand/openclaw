# OpenClaw Agent System - Vollständige Extraktion

Dieses Verzeichnis enthält eine vollständige, menschenverständliche Dokumentation des OpenClaw Agent-Systems, einschließlich:

1. **Agent-Schleifen** - Wie Agenten iterativ arbeiten
2. **Tool-System** - Wie Agenten Tools nutzen können
3. **Prompt-Injection & System-Prompt** - Wie Prompts aufgebaut und injiziert werden
4. **Sicherheitsvorkehrungen** - Welche Sicherheitsmaßnahmen implementiert sind

## Struktur

```
agent-extraction/
├── README.md                           (diese Datei)
├── 01-agent-loop/                      (Agent-Schleifen Dokumentation)
│   ├── README.md                       (Übersicht der Agent-Schleifen)
│   ├── lifecycle.md                    (Lebenszyklus eines Agent-Runs)
│   ├── queueing.md                     (Warteschlangen-System)
│   └── code/                           (Extrahierte Code-Beispiele)
├── 02-tools/                           (Tool-System Dokumentation)
│   ├── README.md                       (Tool-System Übersicht)
│   ├── tool-execution.md               (Wie Tools ausgeführt werden)
│   ├── tool-registration.md            (Wie Tools registriert werden)
│   ├── model-requirements.md           (Anforderungen an Modelle)
│   └── code/                           (Extrahierte Code-Beispiele)
├── 03-prompt-injection/                (Prompt & Context Injection)
│   ├── README.md                       (Prompt-System Übersicht)
│   ├── system-prompt.md                (System-Prompt Aufbau)
│   ├── bootstrap-files.md              (Bootstrap-Dateien)
│   └── code/                           (Extrahierte Code-Beispiele)
├── 04-security/                        (Sicherheitsvorkehrungen)
│   ├── README.md                       (Sicherheits-Übersicht)
│   ├── tool-policies.md                (Tool-Richtlinien)
│   ├── sandbox.md                      (Sandbox-System)
│   ├── loop-detection.md               (Schleifen-Erkennung)
│   └── code/                           (Extrahierte Code-Beispiele)
└── original-docs/                      (Originale Dokumentation)
    └── links.md                        (Links zu Original-Dokumenten)
```

## Verwendung

Jeder Ordner enthält:
- Eine README.md mit der Hauptdokumentation
- Zusätzliche Markdown-Dateien für Teilthemen
- Ein `code/` Unterverzeichnis mit extrahierten, kommentierten Code-Beispielen

Alle Dokumentation ist in deutscher Sprache verfasst und für menschliches Verständnis optimiert.

## Zielgruppe

Diese Dokumentation richtet sich an:
- Entwickler, die das OpenClaw Agent-System verstehen wollen
- Personen, die eigene Agent-Systeme entwickeln möchten
- Alle, die verstehen wollen, wie moderne AI-Agenten implementiert werden

## Wichtige Konzepte

### Agent
Ein Agent ist eine vollständig isolierte KI-Instanz mit eigenem:
- Workspace (Arbeitsverzeichnis)
- Session-Store (Chat-Historie)
- Auth-Profilen (API-Schlüssel)

### Tool
Ein Tool ist eine Funktion, die der Agent aufrufen kann, um:
- Dateien zu lesen/schreiben
- Code auszuführen
- Mit externen Systemen zu interagieren

### Loop (Schleife)
Eine Agent-Schleife ist ein vollständiger Run:
Nachricht empfangen → Kontext aufbauen → Modell-Inferenz → Tools ausführen → Antwort senden

## Autoren & Quellen

Basierend auf dem OpenClaw-Projekt:
- Repository: https://github.com/openclaw/openclaw
- Dokumentation: https://docs.openclaw.ai
- Lizenz: siehe LICENSE im Hauptverzeichnis

Extrahiert und dokumentiert: Februar 2026
