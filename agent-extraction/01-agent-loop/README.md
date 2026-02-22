# Agent-Schleifen in OpenClaw

## Übersicht

Eine **Agent-Schleife** (Agent Loop) ist der vollständige Durchlauf eines Agent-Runs, von der Nachrichtenverarbeitung bis zur Antwortgenerierung. Dies ist das Herzstück des OpenClaw-Systems.

## Was ist eine Agent-Schleife?

Eine Agent-Schleife ist ein einzelner, serialisierter Run pro Session, der folgende Phasen durchläuft:

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT-SCHLEIFE                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. EINGABE (Intake)                                        │
│     ↓ Nachricht vom Benutzer empfangen                     │
│     ↓ Session identifizieren                               │
│                                                             │
│  2. KONTEXT-AUFBAU (Context Assembly)                       │
│     ↓ Workspace vorbereiten                                │
│     ↓ Bootstrap-Dateien laden                              │
│     ↓ Skills laden                                         │
│     ↓ Session-Historie laden                               │
│     ↓ System-Prompt zusammenbauen                          │
│                                                             │
│  3. MODELL-INFERENZ (Model Inference)                       │
│     ↓ API-Request an LLM senden                            │
│     ↓ Streaming-Response empfangen                         │
│     ↓ Tool-Calls extrahieren                               │
│                                                             │
│  4. TOOL-AUSFÜHRUNG (Tool Execution)                        │
│     ↓ Tools sequenziell ausführen                          │
│     ↓ Ergebnisse sammeln                                   │
│     ↓ Zurück zu Schritt 3 wenn weitere Tools nötig         │
│                                                             │
│  5. ANTWORT-STREAMING (Reply Streaming)                     │
│     ↓ Antwort-Text an Benutzer senden                      │
│     ↓ Deltas streamen (wenn aktiviert)                     │
│                                                             │
│  6. PERSISTIERUNG (Persistence)                             │
│     ↓ Session-Historie speichern                           │
│     ↓ Metadaten aktualisieren                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Lebenszyklus im Detail

### Phase 1: Eingabe (Intake)

**Was passiert:**
- Eine Nachricht wird vom Messaging-Kanal empfangen (WhatsApp, Discord, Telegram, etc.)
- Die Session wird identifiziert mittels `sessionKey` (Format: `agent:<agentId>:<mainKey>`)
- Die Nachricht wird in die Warteschlange eingereiht

**Wichtige Dateien:**
- `src/agents/pi-embedded-runner/run.ts` - Haupteinstiegspunkt
- `src/routing/session-key.ts` - Session-Key-Verwaltung

### Phase 2: Kontext-Aufbau (Context Assembly)

**Was passiert:**
- **Workspace-Vorbereitung:** Agent-spezifisches Arbeitsverzeichnis wird als `cwd` gesetzt
- **Bootstrap-Dateien:** AGENTS.md, SOUL.md, TOOLS.md, USER.md werden geladen
- **Skills:** Verfügbare Skills werden aus drei Quellen geladen:
  1. Bundled (mitgeliefert)
  2. Managed (`~/.openclaw/skills`)
  3. Workspace-spezifisch (`<workspace>/skills`)
- **Session-Historie:** Vorherige Nachrichten werden aus JSONL-Datei geladen
- **System-Prompt:** Wird aus allen Komponenten zusammengebaut

**Wichtige Konfiguration:**
```typescript
// Workspace-Pfad (erforderlich)
agents.defaults.workspace = "~/.openclaw/workspace"

// Bootstrap-Dateien im Workspace:
// - AGENTS.md (Betriebsanweisungen + "Gedächtnis")
// - SOUL.md (Persona, Grenzen, Tonalität)
// - TOOLS.md (Benutzer-gepflegte Tool-Notizen)
// - BOOTSTRAP.md (Einmalige Ersteinrichtung, wird nach Abschluss gelöscht)
// - IDENTITY.md (Agent-Name/Vibe/Emoji)
// - USER.md (Benutzerprofil + bevorzugte Anrede)
```

### Phase 3: Modell-Inferenz (Model Inference)

**Was passiert:**
- Ein API-Request wird an das konfigurierte LLM gesendet (z.B. Claude, GPT-4)
- Der Request enthält:
  - System-Prompt
  - Conversation-Historie
  - Tool-Definitionen
  - Konfigurationsparameter (temperature, max_tokens, etc.)
- Die Response wird als Stream empfangen
- Tool-Calls werden extrahiert und zur Ausführung vorbereitet

**Unterstützte Modell-Anbieter:**
- Anthropic (Claude)
- OpenAI
- Google (Gemini)
- Ollama (lokal)
- Viele weitere via Unified-API

### Phase 4: Tool-Ausführung (Tool Execution)

**Was passiert:**
- Extrahierte Tool-Calls werden **sequenziell** ausgeführt
- Jedes Tool erhält seine Parameter vom Modell
- Tool-Ergebnisse werden gesammelt
- Bei Bedarf wird zurück zu Phase 3 gegangen (weitere Modell-Inferenz)
- Dies wiederholt sich bis:
  - Das Modell keine weiteren Tools aufruft
  - Ein Timeout erreicht wird
  - Eine Fehler-Bedingung eintritt

**Tool-Ausführungs-Pipeline:**
```
Tool-Call vom Modell
    ↓
Tool-Policy prüfen (erlaubt/verboten?)
    ↓
Before-Tool-Call Hook ausführen
    ↓
Tool-Implementierung aufrufen
    ↓
After-Tool-Call Hook ausführen
    ↓
Ergebnis an Modell zurückgeben
```

### Phase 5: Antwort-Streaming (Reply Streaming)

**Was passiert:**
- Der generierte Antwort-Text wird an den Benutzer gesendet
- **Block Streaming (optional):** Teilantworten werden gesendet, sobald sie fertig sind
  - Standard: Aus (`agents.defaults.blockStreamingDefault: "off"`)
  - Boundary: `text_end` vs `message_end`
  - Chunking: 800-1200 Zeichen, bevorzugt Absatz-Grenzen
- **Reasoning Streaming (optional):** Denkprozesse können separat gestreamt werden
- Tool-Summaries werden bei Bedarf eingefügt (wenn verbose aktiviert)

### Phase 6: Persistierung (Persistence)

**Was passiert:**
- Die gesamte Konversation (User-Message + Assistant-Response + Tool-Calls) wird gespeichert
- Format: JSONL (eine Zeile pro Message)
- Speicherort: `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`
- Metadaten werden aktualisiert (Timestamps, Token-Usage, etc.)

## Warteschlangen-System (Queueing)

### Warum Warteschlangen?

**Problem:** Mehrere gleichzeitige Nachrichten an denselben Agenten würden zu:
- Race Conditions in der Session-Historie
- Inkonsistenten Tool-Ausführungen
- Durcheinander in der Konversation

**Lösung:** Serialisierung durch zwei Queue-Ebenen:

1. **Session Lane:** Pro Session (verhindert Session-interne Races)
2. **Global Lane:** Über alle Sessions (optional, verhindert Ressourcen-Überlastung)

### Queue-Modi

OpenClaw unterstützt drei Modi für die Nachrichtenverarbeitung:

#### 1. Collect Mode (Standard)
```
Nachricht 1 → Wartet bis Run fertig
Nachricht 2 → Wartet bis Run fertig
Nachricht 3 → Wartet bis Run fertig
             ↓
Alle drei Nachrichten werden kombiniert → Ein neuer Run startet
```

**Verwendung:** Standard-Modus für Chat-Konversationen

#### 2. Steer Mode
```
Nachricht 1 → Run startet
   ↓ Tool A wird ausgeführt
   ↓ Tool B wird ausgeführt
Nachricht 2 kommt rein → INTERRUPT!
   → Restliche Tools werden übersprungen
   → Neue Nachricht wird injiziert
   → Run geht weiter mit neuer Nachricht
```

**Verwendung:** Für interaktive Steuerung während laufender Runs

#### 3. Followup Mode
```
Nachricht 1 → Run 1 startet und endet
Nachricht 2 → Run 2 startet sofort (mit Nachricht 2 allein)
Nachricht 3 → Run 3 startet sofort (mit Nachricht 3 allein)
```

**Verwendung:** Für unabhängige, sequenzielle Befehle

### Implementierung

**Warteschlangen-Implementierung:**
- `src/process/command-queue.ts` - Command Queue System
- `src/agents/pi-embedded-runner/lanes.ts` - Lane Resolution

**Queue-Konfiguration:**
```typescript
// Pro-Kanal Queue-Modus
channels.whatsapp.queueMode = "collect" | "steer" | "followup"

// Debounce (für collect mode)
channels.whatsapp.queueDebounceMs = 500  // Wartezeit vor Kombinierung

// Cap (maximale Nachrichten pro Batch)
channels.whatsapp.queueCap = 10
```

## Timeout & Abbruch

### Timeouts

**Agent Runtime Timeout:**
- Standard: 600 Sekunden (10 Minuten)
- Konfigurierbar: `agents.defaults.timeoutSeconds`
- Durchgesetzt in: `runEmbeddedPiAgent` via AbortSignal

**Wait Timeout:**
- `agent.wait` hat eigenen Timeout (Standard 30s)
- Stoppt **nicht** den Agent, nur das Warten

### Abbruch-Mechanismen

**AbortSignal:**
- Kann von außen gesetzt werden (z.B. bei Gateway-Disconnect)
- Wird durch den gesamten Call-Stack propagiert
- Tools sollten den AbortSignal respektieren

**Implementierung:**
```typescript
// Timeout Timer
const timeoutMs = timeoutSeconds * 1000
const abortTimer = setTimeout(() => {
  controller.abort(new TimeoutError("Agent timeout"))
}, timeoutMs)

// Cleanup
try {
  // ... Agent Run ...
} finally {
  clearTimeout(abortTimer)
}
```

## Concurrency Control

### Session-Level Locking

**Problem:** Gleichzeitige Schreibzugriffe auf dieselbe Session-Datei

**Lösung:** Session Write Lock
- Wird vor dem Run erworben
- Wird nach dem Run freigegeben
- Maximale Hold-Zeit basierend auf Timeout

**Implementierung:** `src/agents/session-write-lock.ts`

### Tool-Level Synchronisation

Bestimmte Tools haben zusätzliche Synchronisations-Mechanismen:
- **Bash-Tools:** Process Registry verhindert PID-Kollisionen
- **File-Tools:** Atomare Operationen wo möglich
- **Browser-Tools:** Ein Browser-Kontext pro Session

## Lifecycle Events

Das System emittiert Events für verschiedene Phasen:

### Event-Typen

**Lifecycle Stream:**
```typescript
{ stream: "lifecycle", phase: "start", timestamp }
{ stream: "lifecycle", phase: "end", timestamp, usage, payloads }
{ stream: "lifecycle", phase: "error", timestamp, error }
```

**Assistant Stream:**
```typescript
{ stream: "assistant", delta: "Teiltext...", index: 0 }
{ stream: "assistant", done: true }
```

**Tool Stream:**
```typescript
{ stream: "tool", event: "start", toolName, params }
{ stream: "tool", event: "update", toolName, status }
{ stream: "tool", event: "end", toolName, result }
```

### Plugin Hooks

Plugins können in verschiedenen Punkten der Schleife eingreifen:

**Pre-Run Hooks:**
- `before_model_resolve` - Vor Modell-Auswahl
- `before_prompt_build` - Vor Prompt-Zusammenbau
- `before_agent_start` - Vor Agent-Start

**During-Run Hooks:**
- `before_tool_call` - Vor jedem Tool-Call
- `after_tool_call` - Nach jedem Tool-Call
- `tool_result_persist` - Vor Persistierung des Tool-Ergebnisses

**Post-Run Hooks:**
- `agent_end` - Nach Agent-Ende
- `before_compaction` / `after_compaction` - Bei Context-Compaction

Siehe: `docs/plugins.md` für vollständige Hook-Dokumentation

## Compaction & Retries

### Was ist Compaction?

**Problem:** Context Window Overflow - zu viele Nachrichten/Tokens

**Lösung:** Automatische Komprimierung alter Nachrichten
- Entfernt ältere Nachrichten
- Behält wichtige System-Informationen
- Erstellt Summary der entfernten Nachrichten

### Auto-Compaction

**Trigger:**
- Context Window zu voll (< CONTEXT_WINDOW_HARD_MIN_TOKENS frei)
- Model returned "context_overflow" Error

**Ablauf:**
1. Compaction wird ausgeführt
2. `compaction` Stream Event wird emittiert
3. Agent-Run wird **retried** mit komprimierter Historie
4. In-Memory Buffers werden resettet (verhindert doppelte Ausgabe)

**Implementierung:**
- `src/agents/pi-embedded-runner/compact.ts` - Compaction Logic
- `src/agents/context-window-guard.ts` - Context Window Monitoring

## Fehlerbehandlung

### Fehler-Kategorien

**Auth Errors:**
- Invalid API Key
- Rate Limits
- Billing Issues

**Context Errors:**
- Context Overflow
- Invalid Input Format

**Tool Errors:**
- Tool Execution Failed
- Tool Timeout
- Tool Permission Denied

**Timeout Errors:**
- Agent Timeout
- Tool Timeout

### Failover

**Automatic Failover:** Bei bestimmten Fehlern wird automatisch ein anderes Modell/Provider versucht

**Failover-Bedingungen:**
- Auth Errors (API Key ungültig)
- Rate Limit Errors
- Billing Errors
- Timeout Errors (unter bestimmten Bedingungen)

**Implementierung:** `src/agents/failover-error.ts`

## Performance-Optimierungen

### Caching

**Session Manager Cache:**
- Session-Dateien werden gecached
- Prewarming für häufig genutzte Sessions
- TTL-basierte Invalidierung

**Model Response Cache:**
- Bei unterstützten Providern (z.B. Anthropic)
- Cache-TTL wird zu Prompt-Blöcken hinzugefügt
- Spart Tokens bei wiederholten Anfragen

### Streaming

**Warum Streaming?**
- Niedrigere Latenz (erste Tokens kommen früher)
- Bessere User Experience
- Möglichkeit für Block Streaming

**Block Streaming:**
- Sendet fertige Textblöcke sofort
- Chunking: 800-1200 Zeichen
- Bevorzugt natürliche Grenzen (Absätze > Newlines > Sätze)

## Zusammenfassung

Die Agent-Schleife in OpenClaw ist ein robustes, serialisiertes System mit:

✅ **Klarer Phasentrennung:** Intake → Context → Inference → Tools → Reply → Persist

✅ **Warteschlangen:** Verhindert Race Conditions und Ressourcen-Überlastung

✅ **Lifecycle Events:** Vollständige Observability durch Event Streams

✅ **Fehlerbehandlung:** Automatic Failover, Retries, Graceful Degradation

✅ **Performance:** Caching, Streaming, Optimierte Context Windows

✅ **Erweiterbarkeit:** Plugin Hooks an allen wichtigen Punkten

✅ **Sicherheit:** Tool Policies, Sandbox, Loop Detection (siehe Kapitel 04)

## Nächste Schritte

- Lesen Sie [lifecycle.md](lifecycle.md) für detaillierte Ablaufdiagramme
- Lesen Sie [queueing.md](queueing.md) für Queue-System Details
- Siehe Code-Beispiele in [code/](code/) Verzeichnis
