# Tool-System in OpenClaw

## Übersicht

Das **Tool-System** ermöglicht es dem Agenten, mit der Außenwelt zu interagieren. Tools sind Funktionen, die der Agent aufrufen kann, um Aufgaben auszuführen, die über reine Textgenerierung hinausgehen.

## Was ist ein Tool?

Ein Tool ist eine strukturierte Funktion mit:
- **Name:** Eindeutiger Identifier (z.B. `read`, `exec`, `browser`)
- **Schema:** JSON Schema für Parameter (definiert was das Tool erwartet)
- **Execute:** Implementierung der Funktionalität
- **Beschreibung:** Erklärt dem Modell, was das Tool macht

### Tool-Anatomie

```typescript
interface AgentTool {
  name: string;                    // Tool-Name (eindeutig)
  description: string;             // Was macht das Tool?
  parameters: JSONSchema;          // Welche Parameter benötigt es?
  execute: (params) => Promise<ToolResult>;  // Implementierung
  ownerOnly?: boolean;            // Nur für Owner-Benutzer?
  sandbox?: {                     // Sandbox-Verhalten
    mode: "host" | "sandbox";
    allowHostFallback?: boolean;
  };
}

interface ToolResult {
  content: Array<{               // Ergebnis-Content
    type: "text" | "image";
    text?: string;
    image?: ImageContent;
  }>;
  details?: Record<string, any>; // Zusätzliche Metadaten
}
```

## Kern-Tools (Built-in)

OpenClaw kommt mit essentiellen Tools out-of-the-box:

### 1. **File System Tools**

#### `read` - Datei/Verzeichnis lesen
```typescript
{
  name: "read",
  description: "Read file contents or list directory",
  parameters: {
    path: string,          // Absoluter Pfad
    view_range?: [number, number]  // Optional: Zeilen-Bereich
  }
}
```

**Beispiel-Verwendung:**
```typescript
// Datei lesen
await read({ path: "/workspace/AGENTS.md" })

// Verzeichnis listen
await read({ path: "/workspace/src" })

// Zeilen 10-20 lesen
await read({ path: "/workspace/app.js", view_range: [10, 20] })
```

#### `write` - Datei erstellen
```typescript
{
  name: "write",
  description: "Create a new file",
  parameters: {
    path: string,
    file_text: string
  }
}
```

**Wichtig:** `write` kann keine existierenden Dateien überschreiben!

#### `edit` - Datei bearbeiten
```typescript
{
  name: "edit",
  description: "Replace text in existing file",
  parameters: {
    path: string,
    old_str: string,      // Exakter Text zum Ersetzen
    new_str: string       // Neuer Text
  }
}
```

**Wichtig:** `old_str` muss **exakt** übereinstimmen (inklusive Whitespace!)

### 2. **Command Execution Tools**

#### `exec` - Befehl ausführen
```typescript
{
  name: "exec",
  description: "Execute shell command",
  parameters: {
    command: string,           // Shell-Befehl
    description: string,       // Was macht der Befehl?
    mode?: "sync" | "async",  // Ausführungs-Modus
    initial_wait?: number,    // Wartezeit (Sekunden)
    shellId?: string          // Session-ID für async
  }
}
```

**Modi:**

**Sync Mode:** 
```typescript
// Für schnelle Befehle (<10 Sekunden)
exec({ 
  command: "ls -la", 
  description: "List files",
  mode: "sync"
})
```

**Async Mode:**
```typescript
// Für lange Befehle oder interaktive Prozesse
const result = exec({ 
  command: "npm run build", 
  description: "Build project",
  mode: "async",
  initial_wait: 60,
  shellId: "build-session"
})

// Später Output lesen
read_bash({ shellId: "build-session", delay: 30 })
```

#### `process` - Prozess-Management
```typescript
{
  name: "process",
  description: "Manage long-running processes",
  parameters: {
    action: "poll" | "log" | "stop",
    shellId: string
  }
}
```

### 3. **Advanced Tools**

#### `browser` - Web-Browser Automation
- Playwright-basiert
- Vollständige Browser-Kontrolle
- Screenshots, Scraping, Form-Ausfüllung

#### `canvas` - Visual Code Editor
- A2UI-basierte visuelle Code-Bearbeitung
- Für komplexe Multi-File Refactorings

#### `memory_search` / `memory_get` - Memory System
- Suche in persistenten Notizen
- Abruf von gespeichertem Wissen

#### `sessions_spawn` - Sub-Agents
- Spawnt untergeordnete Agent-Sessions
- Für Task-Delegation und Parallelisierung

## Wie Agenten Tools nutzen

### Tool Calling Mechanism

Der Prozess läuft in mehreren Schritten ab:

```
┌────────────────────────────────────────────────────┐
│  1. TOOL-DISCOVERY                                 │
│     Agent erhält Tool-Liste im System-Prompt       │
└────────────────────────────────────────────────────┘
                      ↓
┌────────────────────────────────────────────────────┐
│  2. TOOL-SELECTION                                 │
│     Modell entscheidet, welche Tools zu nutzen     │
│     Basierend auf Aufgabe und verfügbaren Tools    │
└────────────────────────────────────────────────────┘
                      ↓
┌────────────────────────────────────────────────────┐
│  3. PARAMETER-GENERATION                           │
│     Modell generiert Parameter für Tool-Call       │
│     Muss JSON Schema des Tools folgen              │
└────────────────────────────────────────────────────┘
                      ↓
┌────────────────────────────────────────────────────┐
│  4. TOOL-EXECUTION                                 │
│     OpenClaw führt Tool mit Parametern aus         │
│     Tool-Result wird zurückgegeben                 │
└────────────────────────────────────────────────────┘
                      ↓
┌────────────────────────────────────────────────────┐
│  5. RESULT-PROCESSING                              │
│     Modell erhält Tool-Result                      │
│     Kann weitere Tools aufrufen oder antworten     │
└────────────────────────────────────────────────────┘
```

### Tool Definition Format

Tools werden dem Modell als JSON Schema präsentiert:

```json
{
  "name": "read",
  "description": "Read file contents or list directory. Use this to view files before editing.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute path to file or directory"
      },
      "view_range": {
        "type": "array",
        "items": { "type": "integer" },
        "description": "Optional [start_line, end_line] range"
      }
    },
    "required": ["path"]
  }
}
```

### Modell-Anforderungen

Nicht alle Modelle unterstützen Tool Calling! Erforderliche Fähigkeiten:

#### 1. **Function Calling Support**

**Minimum:** Modell muss strukturierte Function Calls generieren können

**Unterstützt:**
- ✅ Claude (Anthropic) - alle Versionen
- ✅ GPT-4/GPT-3.5 (OpenAI) 
- ✅ Gemini (Google)
- ✅ Groq Models
- ✅ Viele OpenRouter Models
- ❌ Basic GPT-3 (zu alt)
- ❌ Einfache Chat Models ohne Function Calling

#### 2. **Schema Compliance**

Das Modell muss:
- JSON Schema verstehen und befolgen
- Korrekte Parameter-Typen generieren
- Required Fields immer ausfüllen

**Problem bei schwachen Modellen:**
```javascript
// Modell sollte generieren:
{ "path": "/workspace/file.txt", "view_range": [1, 10] }

// Schwaches Modell generiert:
{ "file": "/workspace/file.txt" }  // ❌ Falscher Parameter-Name!
```

#### 3. **Multi-Step Reasoning**

Das Modell muss:
- Mehrere Tool-Calls planen können
- Tool-Results interpretieren können
- Basierend auf Results weitere Tools aufrufen

**Beispiel-Sequenz:**
```
1. read({ path: "/workspace" })           → Liste der Dateien
2. read({ path: "/workspace/app.js" })    → Datei-Inhalt analysieren
3. edit({ path: "/workspace/app.js", ... }) → Änderung vornehmen
4. exec({ command: "npm test" })          → Tests ausführen
5. Antwort mit Ergebnis senden
```

#### 4. **Error Handling**

Das Modell sollte:
- Tool-Errors verstehen und darauf reagieren
- Alternative Ansätze versuchen bei Fehlern
- Nicht in Loops stecken bleiben

### Provider-Spezifische Implementierungen

OpenClaw adaptiert Tool-Definitionen pro Provider:

#### Anthropic (Claude)
```typescript
// Native Tool Use API
{
  "name": "read",
  "description": "...",
  "input_schema": { ... }
}
```

#### OpenAI
```typescript
// Function Calling API
{
  "type": "function",
  "function": {
    "name": "read",
    "description": "...",
    "parameters": { ... }
  }
}
```

#### Google (Gemini)
```typescript
// Function Declaration
{
  "name": "read",
  "description": "...",
  "parameters": {
    "type": "OBJECT",
    "properties": { ... }
  }
}
```

**Implementierung:** `src/agents/pi-tool-definition-adapter.ts`

## Tool-Registrierung

### Built-in Tools

Built-in Tools werden in `createOpenClawCodingTools()` registriert:

```typescript
// src/agents/pi-tools.ts
export function createOpenClawCodingTools(params: {
  cfg?: OpenClawConfig;
  sessionKey?: string;
  agentId?: string;
  // ... weitere Params
}): AnyAgentTool[] {
  
  const tools: AnyAgentTool[] = [];
  
  // File System Tools
  tools.push(createReadTool(...));
  tools.push(createWriteTool(...));
  tools.push(createEditTool(...));
  
  // Execution Tools
  tools.push(createExecTool(...));
  tools.push(createProcessTool(...));
  
  // Advanced Tools (conditional)
  if (allowBrowser) {
    tools.push(createBrowserTool(...));
  }
  
  if (allowCanvas) {
    tools.push(createCanvasTool(...));
  }
  
  // OpenClaw-specific Tools
  tools.push(...createOpenClawTools(...));
  
  return tools;
}
```

### Plugin Tools

Plugins können eigene Tools hinzufügen:

```typescript
// In einem Plugin
export const tools = [
  {
    name: "custom_tool",
    description: "My custom tool",
    parameters: {
      type: "object",
      properties: {
        param1: { type: "string" }
      }
    },
    execute: async (params) => {
      // Tool-Implementierung
      return {
        content: [{ type: "text", text: "Result" }]
      };
    }
  }
];
```

**Plugin-Tools werden automatisch geladen aus:**
- Core Extensions: `extensions/*/src/index.ts`
- Externe Plugins: Via Plugin API

### Tool-Filterung

Nicht alle Tools sind immer verfügbar! Filterung passiert durch:

1. **Tool Policy** (siehe Kapitel 04-security)
2. **Sandbox Mode** (host vs. sandbox)
3. **Agent-Konfiguration** (per-agent allow/deny)
4. **Owner-Only Flag** (nur für autorisierte Benutzer)

## Tool-Ausführungs-Pipeline

Die vollständige Pipeline für Tool-Calls:

```typescript
async function executeToolCall(
  toolName: string,
  params: unknown,
  context: ExecutionContext
): Promise<ToolResult> {
  
  // 1. Loop Detection Check
  const loopCheck = detectToolCallLoop(context.sessionState, toolName, params);
  if (loopCheck.stuck) {
    throw new Error(loopCheck.message);
  }
  
  // 2. Tool Policy Check
  if (!isToolAllowedByPolicies(toolName, context)) {
    throw new Error(`Tool ${toolName} is not allowed by policy`);
  }
  
  // 3. Before-Tool-Call Hook
  const hookResult = await runBeforeToolCallHook(toolName, params, context);
  if (hookResult.skip) {
    return hookResult.syntheticResult;
  }
  
  // 4. Parameter Normalization
  const normalizedParams = normalizeToolParams(params, tool.parameters);
  
  // 5. Tool Execution
  let result: ToolResult;
  try {
    result = await tool.execute(normalizedParams);
  } catch (error) {
    result = {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      details: { error: true }
    };
  }
  
  // 6. Result Sanitization
  result = sanitizeToolResult(result, context);
  
  // 7. After-Tool-Call Hook
  await runAfterToolCallHook(toolName, params, result, context);
  
  // 8. Record for Loop Detection
  recordToolCallOutcome(context.sessionState, {
    toolName,
    toolParams: params,
    result
  });
  
  return result;
}
```

**Wichtige Dateien:**
- `src/agents/pi-embedded-subscribe.handlers.tools.ts` - Tool Handler
- `src/agents/pi-tools.before-tool-call.ts` - Before Hook
- `src/agents/tool-loop-detection.ts` - Loop Detection

## Tool-Result Handling

### Result Format

Tool-Results folgen einem standardisierten Format:

```typescript
{
  content: [
    {
      type: "text",
      text: "Das Ergebnis des Tool-Aufrufs..."
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "iVBORw0KGgo..."
      }
    }
  ],
  details: {
    exitCode: 0,
    duration: 1234,
    // ... weitere Metadaten
  }
}
```

### Result Sanitization

Results werden vor der Rückgabe an das Modell bereinigt:

**1. Size Truncation:**
- Text-Results > 100KB werden gekürzt
- Konfigurierbar via `tools.resultMaxBytes`

**2. Image Sanitization:**
- Images > 5MB werden resized
- Format-Konvertierung wenn nötig

**3. Sensitive Data Redaction:**
- API Keys werden erkannt und redacted
- PII kann gefiltert werden (optional)

**Implementierung:** `src/agents/pi-embedded-runner/tool-result-truncation.ts`

## Tool-Schema Design Best Practices

### 1. Klare Beschreibungen

**Schlecht:**
```typescript
{
  name: "do_thing",
  description: "Does a thing"  // ❌ Zu vage!
}
```

**Gut:**
```typescript
{
  name: "search_files",
  description: "Search for files matching a pattern using glob syntax. Returns list of matching file paths. Use this when you need to find files by name pattern (e.g., '**/*.js' for all JavaScript files)."
}
```

### 2. Sinnvolle Parameter-Namen

**Schlecht:**
```typescript
parameters: {
  p: { type: "string" },    // ❌ Was ist "p"?
  d: { type: "boolean" }    // ❌ Was ist "d"?
}
```

**Gut:**
```typescript
parameters: {
  path: { 
    type: "string",
    description: "Absolute path to file or directory" 
  },
  recursive: { 
    type: "boolean",
    description: "Whether to search subdirectories" 
  }
}
```

### 3. Sinnvolle Defaults

```typescript
parameters: {
  timeout: {
    type: "number",
    description: "Timeout in seconds",
    default: 30  // ✅ Sinnvoller Default
  }
}
```

### 4. Validation

```typescript
parameters: {
  port: {
    type: "integer",
    minimum: 1,
    maximum: 65535,
    description: "Port number (1-65535)"
  }
}
```

### 5. Beispiele in Beschreibung

```typescript
{
  name: "glob",
  description: `
    Find files matching glob pattern.
    
    Examples:
    - "**/*.js" - All JavaScript files
    - "src/**/*.test.ts" - All test files in src
    - "*.{ts,tsx}" - All TypeScript files in current dir
  `.trim()
}
```

## Tool-Testing

### Unit Tests

Jedes Tool sollte Unit Tests haben:

```typescript
describe("read tool", () => {
  it("should read file contents", async () => {
    const result = await readTool.execute({ 
      path: "/test/file.txt" 
    });
    expect(result.content[0].text).toContain("expected content");
  });
  
  it("should list directory contents", async () => {
    const result = await readTool.execute({ 
      path: "/test/dir" 
    });
    expect(result.content[0].text).toMatch(/file1\.txt/);
  });
  
  it("should handle non-existent files", async () => {
    const result = await readTool.execute({ 
      path: "/nonexistent" 
    });
    expect(result.content[0].text).toContain("Error");
  });
});
```

### Integration Tests

Teste Tool-Calls durch den Agent:

```typescript
it("agent should use read tool correctly", async () => {
  const response = await runAgent({
    message: "Read the file /workspace/README.md",
    sessionKey: "test-session"
  });
  
  // Verify tool was called
  expect(response.toolCalls).toHaveLength(1);
  expect(response.toolCalls[0].name).toBe("read");
  
  // Verify response contains file content
  expect(response.text).toContain("README content");
});
```

## Erweiterte Features

### Tool Streaming

Für lange Tool-Ausführungen können Updates gestreamt werden:

```typescript
{
  stream: "tool",
  event: "start",
  toolName: "exec",
  params: { command: "npm test" }
}

{
  stream: "tool",
  event: "update",
  toolName: "exec",
  status: "Running tests... (25/100 passed)"
}

{
  stream: "tool",
  event: "end",
  toolName: "exec",
  result: { exitCode: 0, ... }
}
```

### Tool Approval

Bestimmte Tools können Approval-Workflow haben:

```typescript
{
  name: "dangerous_tool",
  requiresApproval: true,
  execute: async (params, context) => {
    if (!context.approved) {
      return {
        content: [{
          type: "text",
          text: "This action requires user approval. Re-run with --approve flag."
        }]
      };
    }
    // ... execute dangerous action
  }
}
```

### Tool Composition

Tools können andere Tools nutzen:

```typescript
{
  name: "refactor_file",
  execute: async (params) => {
    // 1. Lese Datei
    const content = await readTool.execute({ path: params.path });
    
    // 2. Transformiere Content
    const newContent = transformCode(content);
    
    // 3. Schreibe zurück
    return await editTool.execute({
      path: params.path,
      old_str: content,
      new_str: newContent
    });
  }
}
```

## Zusammenfassung

Das Tool-System in OpenClaw ermöglicht:

✅ **Strukturierte Interaktion:** Tools definieren klar, was sie tun und welche Parameter sie benötigen

✅ **Modell-Unabhängigkeit:** Tool-Definitionen werden pro Provider adaptiert

✅ **Sicherheit:** Multi-Layer Tool Policy + Sandbox + Loop Detection

✅ **Erweiterbarkeit:** Plugins können eigene Tools hinzufügen

✅ **Robustheit:** Error Handling, Sanitization, Validation

✅ **Observability:** Tool Events werden vollständig geloggt

✅ **Testing:** Unit + Integration Tests für alle Tools

## Nächste Schritte

- Lesen Sie [tool-execution.md](tool-execution.md) für detaillierte Execution-Flow
- Lesen Sie [model-requirements.md](model-requirements.md) für Model-Capabilities
- Siehe Code-Beispiele in [code/](code/) Verzeichnis
- Siehe Kapitel 04 für Tool-Security Details
