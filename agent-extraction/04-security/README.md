# Sicherheitsvorkehrungen in OpenClaw

## Übersicht

Sicherheit ist ein zentraler Bestandteil des OpenClaw Agent-Systems. Mehrere Schichten von Sicherheitsmaßnahmen schützen vor:
- Unbefugten Zugriffen
- Schädlichen Tool-Aufrufen
- Endlos-Schleifen
- Ressourcen-Erschöpfung
- Prompt-Injection Angriffen

## Sicherheits-Architektur (Multi-Layer)

```
┌────────────────────────────────────────────────────┐
│  LAYER 1: CHANNEL ACCESS CONTROL                   │
│  - Pairing/Allowlists                              │
│  - Authentication                                  │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  LAYER 2: TOOL POLICY                              │
│  - Global Allow/Deny Lists                         │
│  - Per-Agent Restrictions                          │
│  - Owner-Only Tools                                │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  LAYER 3: SANDBOX                                  │
│  - Docker Containerization                         │
│  - Filesystem Isolation                            │
│  - Network Restrictions                            │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  LAYER 4: LOOP DETECTION                           │
│  - Repetitive Call Detection                       │
│  - No-Progress Detection                           │
│  - Circuit Breaker                                 │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  LAYER 5: CONTENT SANITIZATION                     │
│  - Tool Result Filtering                           │
│  - Sensitive Data Redaction                        │
│  - Size Limits                                     │
└────────────────────────────────────────────────────┘
```

## Layer 1: Channel Access Control

### Pairing System

**Für WhatsApp:**
```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "pairing",  // Nutzer müssen sich erst paaren
      pairingLifetime: "30d"  // Pairing läuft nach 30 Tagen ab
    }
  }
}
```

**Pairing-Flow:**
```
1. Nutzer sendet Nachricht
2. Bot antwortet: "Send /pair <code> to connect"
3. Nutzer sendet: /pair ABC123
4. Bot validiert Code
5. Nutzer ist gepaart und kann Agent nutzen
```

### Allowlists

**Statische Allowlist:**
```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: [
        "+15551234567",
        "+15559876543"
      ]
    }
  }
}
```

**Gruppen-Allowlist:**
```json5
{
  channels: {
    whatsapp: {
      groupPolicy: "allowlist",
      groups: {
        "123456789@g.us": {
          allow: true,
          requireMention: true  // Nur wenn @mentioned
        }
      }
    }
  }
}
```

### Auth Profile System

API-Schlüssel werden pro-Agent gespeichert:

**Speicherort:** `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`

**Format:**
```json
{
  "anthropic-1": {
    "id": "anthropic-1",
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "priority": 1,
    "enabled": true,
    "failureCount": 0,
    "lastUsed": "2026-02-22T12:00:00Z"
  }
}
```

**Schutzmaßnahmen:**
- Schlüssel sind per-Agent isoliert
- Automatische Rotation bei Fehlern
- Cooldown nach Failures
- Verschlüsselung möglich (via Env Vars)

## Layer 2: Tool Policy

### Tool Policy Hierarchie

Tool-Zugriff wird auf mehreren Ebenen kontrolliert:

```
Global Tools Config
       ↓
Agent-Specific Config
       ↓
Session Type (main vs. subagent)
       ↓
Sandbox Mode (host vs. sandboxed)
       ↓
Owner-Only Check
       ↓
Runtime Policy Evaluation
```

### Global Tool Policy

**Allow/Deny auf Tool-Gruppen:**
```json5
{
  tools: {
    allow: ["@file", "@exec"],  // Gruppen erlauben
    deny: ["browser", "canvas"],  // Spezifische Tools verbieten
    elevated: {
      // Gefährliche Tools nur für Owner
      enable: true,
      senders: ["+15551234567"]
    }
  }
}
```

**Tool-Gruppen:**
```typescript
const TOOL_GROUPS = {
  "@all": ["*"],  // Alle Tools
  "@file": ["read", "write", "edit", "apply_patch"],
  "@exec": ["exec", "process"],
  "@session": ["sessions_list", "sessions_spawn", "sessions_send"],
  "@agent": ["agents_list", "gateway"],
  "@browser": ["browser"],
  "@memory": ["memory_search", "memory_get"]
};
```

### Per-Agent Tool Policy

**Agent-spezifische Restrictions:**
```json5
{
  agents: {
    list: [
      {
        id: "family-agent",
        tools: {
          allow: ["read", "sessions_list"],
          deny: ["exec", "write", "edit", "browser"]
        }
      }
    ]
  }
}
```

**Use Case:** Eingeschränkter Agent für Familien-Chat

### Sub-Agent Tool Policy

**Sub-Agents haben automatisch eingeschränkte Tools:**

**Immer verboten für Sub-Agents:**
```typescript
const SUBAGENT_TOOL_DENY_ALWAYS = [
  "gateway",           // System Admin
  "agents_list",       // Agent Management
  "whatsapp_login",    // Interactive Setup
  "session_status",    // Status Monitoring
  "cron",              // Scheduling
  "memory_search",     // Memory (use parent's)
  "memory_get",
  "sessions_send"      // Direct sends (use announce)
];
```

**Zusätzlich verboten für Leaf-Agents (maxDepth erreicht):**
```typescript
const SUBAGENT_TOOL_DENY_LEAF = [
  "sessions_list",
  "sessions_history",
  "sessions_spawn"  // Kann keine weiteren Sub-Agents spawnen
];
```

**Depth-Based Restrictions:**
```
Depth 0 (Main Agent):
  ✅ Alle Tools verfügbar

Depth 1 (Orchestrator Sub-Agent):
  ✅ sessions_spawn (kann weitere Sub-Agents erstellen)
  ✅ sessions_list, sessions_history
  ❌ gateway, memory_*, sessions_send

Depth 2+ (Leaf Sub-Agent):
  ❌ sessions_spawn (kann keine weiteren Sub-Agents erstellen)
  ❌ sessions_list, sessions_history
  ❌ gateway, memory_*, sessions_send
  ✅ read, write, edit, exec (task-focused)
```

**Implementierung:** `src/agents/pi-tools.policy.ts`

### Owner-Only Tools

**Tools die nur für Owner verfügbar sind:**
```typescript
const OWNER_ONLY_TOOLS = [
  "whatsapp_login",  // Kritische Setup-Operations
  "cron",            // Scheduling
  "gateway"          // System Management
];
```

**Runtime-Check:**
```typescript
if (tool.ownerOnly && !senderIsOwner) {
  throw new Error("Tool restricted to owner senders.");
}
```

**Owner-Bestimmung:**
```json5
{
  tools: {
    elevated: {
      enable: true,
      senders: ["+15551234567"]  // Owner Telefonnummer
    }
  }
}
```

### Tool Policy Evaluation

**Evaluation-Reihenfolge:**
```typescript
function isToolAllowed(toolName: string, context: Context): boolean {
  // 1. Prüfe Sub-Agent Restrictions
  if (context.isSubAgent && SUBAGENT_DENY.includes(toolName)) {
    return false;
  }
  
  // 2. Prüfe Owner-Only
  if (isOwnerOnlyTool(toolName) && !context.senderIsOwner) {
    return false;
  }
  
  // 3. Prüfe Agent-Specific Deny List
  if (context.agentConfig.tools?.deny?.includes(toolName)) {
    return false;
  }
  
  // 4. Prüfe Agent-Specific Allow List
  if (context.agentConfig.tools?.allow) {
    return context.agentConfig.tools.allow.includes(toolName);
  }
  
  // 5. Prüfe Global Deny List
  if (globalConfig.tools?.deny?.includes(toolName)) {
    return false;
  }
  
  // 6. Prüfe Global Allow List
  if (globalConfig.tools?.allow) {
    return globalConfig.tools.allow.includes(toolName);
  }
  
  // 7. Default: Allow (wenn keine restrictive Policy)
  return true;
}
```

**Implementierung:** `src/agents/tool-policy-pipeline.ts`

## Layer 3: Sandbox

### Docker-basierte Sandbox

**Aktivierung:**
```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",  // "off" | "all" | "non-main"
        scope: "shared",  // "shared" | "agent" | "session"
        docker: {
          image: "openclaw/sandbox:latest",
          memory: "2g",
          cpus: "1.0"
        }
      }
    }
  }
}
```

### Sandbox-Modi

#### Mode: Off
- Kein Sandboxing
- Alle Tools laufen auf Host
- **Nur für vertrauenswürdige Umgebungen!**

#### Mode: All
- Alle Sessions laufen in Sandbox
- Maximale Isolation
- Overhead durch Container

#### Mode: Non-Main
- Main-Session auf Host
- Andere Sessions (Gruppen, Sub-Agents) in Sandbox
- Balance zwischen Performance & Sicherheit

### Sandbox-Scopes

#### Scope: Shared
```
Alle Sessions → Ein Container
```
- Minimaler Ressourcen-Verbrauch
- Sessions können sich gegenseitig beeinflussen
- Gut für Single-User

#### Scope: Agent
```
Agent 1 → Container 1
Agent 2 → Container 2
```
- Isolation zwischen Agents
- Mehrere Sessions pro Agent teilen Container
- Gut für Multi-Agent Setups

#### Scope: Session
```
Session 1 → Container 1
Session 2 → Container 2
```
- Maximale Isolation
- Höchster Ressourcen-Verbrauch
- Gut für Hochsicherheitsumgebungen

### Sandbox-Restrictions

**Filesystem:**
- Workspace ist gemountet als `/workspace`
- Zugriff außerhalb des Workspace blockiert
- Read-only Mounts für Systemdateien

**Network:**
- Ausgehende Verbindungen möglich (für API calls)
- Eingehende Verbindungen blockiert
- Localhost-Isolation

**Resources:**
```json5
{
  docker: {
    memory: "2g",      // Memory Limit
    cpus: "1.0",       // CPU Limit
    pidsLimit: 512     // Max Processes
  }
}
```

### Tool Sandbox Configuration

**Per-Tool Sandbox Override:**
```typescript
{
  name: "browser",
  sandbox: {
    mode: "sandbox",  // Immer in Sandbox ausführen
    allowHostFallback: false
  },
  execute: async (params) => {
    // ... browser code runs in sandbox
  }
}
```

**Host-Only Tools:**
```typescript
{
  name: "whatsapp_login",
  sandbox: {
    mode: "host",  // Muss auf Host laufen (QR code scan)
    allowHostFallback: false
  }
}
```

## Layer 4: Loop Detection

### Was ist Loop Detection?

**Problem:** Agent ruft dasselbe Tool wiederholt ohne Fortschritt auf

**Beispiel:**
```
1. exec({ command: "npm test" })  → Fails
2. exec({ command: "npm test" })  → Fails
3. exec({ command: "npm test" })  → Fails
4. exec({ command: "npm test" })  → Fails
...
```

**Folgen:**
- Ressourcen-Verschwendung (API calls, compute)
- Keine Aufgaben-Completion
- Schlechte User Experience

### Loop-Detection Mechanismen

#### 1. Generic Repeat Detection

**Erkennt:** Identische Tool-Calls (gleiches Tool + gleiche Parameter)

**Thresholds:**
```typescript
{
  warningThreshold: 10,   // Warning nach 10 Wiederholungen
  criticalThreshold: 20   // Block nach 20 Wiederholungen
}
```

**Beispiel:**
```
read({ path: "file.txt" })  x 15
  → Warning: "You have called read 15 times with identical arguments..."
```

#### 2. No-Progress Detection

**Erkennt:** Identische Tool-Results (gleiche Eingabe + gleiches Ergebnis)

**Beispiel:**
```
1. process({ action: "poll", shellId: "test" })
   → Result: { status: "running", exitCode: null }
2. process({ action: "poll", shellId: "test" })
   → Result: { status: "running", exitCode: null }
3. ... (10 more identical results)
   → Warning: "You are polling with no progress..."
```

**Hashing:** Tool-Results werden gehasht für Vergleich
```typescript
hashToolOutcome(toolName, params, result, error) {
  if (error) return `error:${hash(error)}`;
  return hash({ details: result.details, text: extractText(result) });
}
```

#### 3. Ping-Pong Detection

**Erkennt:** Alternierende Tool-Calls zwischen zwei Patterns

**Beispiel:**
```
1. read({ path: "A" })
2. read({ path: "B" })
3. read({ path: "A" })
4. read({ path: "B" })
5. read({ path: "A" })
...
   → Warning: "You are alternating between repeated tool-call patterns..."
```

**Bedingung:** Beide Patterns müssen no-progress zeigen

#### 4. Global Circuit Breaker

**Ultimative Absicherung:** Stoppt Session bei extremen Loops

**Threshold:** 30 identische no-progress Calls

**Aktion:** Session wird hart beendet
```typescript
if (noProgressCount >= 30) {
  throw new Error(
    "CRITICAL: Global circuit breaker triggered. " +
    "Session execution blocked to prevent runaway loops."
  );
}
```

### Loop Detection Configuration

```json5
{
  agents: {
    list: [
      {
        id: "main",
        tools: {
          loopDetection: {
            enabled: true,
            historySize: 30,
            warningThreshold: 10,
            criticalThreshold: 20,
            globalCircuitBreakerThreshold: 30,
            detectors: {
              genericRepeat: true,
              knownPollNoProgress: true,
              pingPong: true
            }
          }
        }
      }
    ]
  }
}
```

### Loop Detection Implementation

**History Tracking:**
```typescript
// In Session State
toolCallHistory: Array<{
  toolName: string;
  argsHash: string;      // Hash von Parameters
  resultHash?: string;   // Hash von Result (wenn verfügbar)
  toolCallId?: string;
  timestamp: number;
}>
```

**Detection vor Tool-Call:**
```typescript
// Vor Tool-Execution
const loopCheck = detectToolCallLoop(
  sessionState,
  toolName,
  params,
  loopDetectionConfig
);

if (loopCheck.stuck) {
  if (loopCheck.level === "critical") {
    // Blocke Tool-Call
    throw new Error(loopCheck.message);
  } else {
    // Sende Warning an Agent
    injectWarningMessage(loopCheck.message);
  }
}
```

**Recording nach Tool-Call:**
```typescript
// Nach Tool-Execution
recordToolCallOutcome(sessionState, {
  toolName,
  toolParams: params,
  result,
  error,
  config: loopDetectionConfig
});
```

**Implementierung:** `src/agents/tool-loop-detection.ts`

## Layer 5: Content Sanitization

### Tool Result Sanitization

**Size Limits:**
```json5
{
  tools: {
    resultMaxBytes: 102400  // 100KB max
  }
}
```

**Truncation:**
```typescript
if (resultText.length > maxBytes) {
  const truncated = resultText.slice(0, maxBytes);
  return {
    content: [{
      type: "text",
      text: `${truncated}\n\n[... truncated; ${resultText.length} total bytes]`
    }]
  };
}
```

### Image Sanitization

**Size Limits:**
```typescript
{
  maxImageBytes: 5242880,  // 5MB
  maxWidth: 4096,
  maxHeight: 4096
}
```

**Automatic Resizing:**
```typescript
if (imageSize > maxImageBytes) {
  // Resize image to fit limit
  const resized = await resizeImage(image, {
    maxBytes: maxImageBytes,
    quality: 0.8
  });
  return resized;
}
```

### Sensitive Data Redaction

**API Keys:**
```typescript
const API_KEY_PATTERNS = [
  /sk-[a-zA-Z0-9]{32,}/g,      // OpenAI
  /sk-ant-[a-zA-Z0-9-]{95}/g,  // Anthropic
  // ... weitere Patterns
];

function redactApiKeys(text: string): string {
  for (const pattern of API_KEY_PATTERNS) {
    text = text.replace(pattern, "[REDACTED_API_KEY]");
  }
  return text;
}
```

**Passwords:**
```typescript
const PASSWORD_PATTERNS = [
  /password[=:]\s*['"]([^'"]+)['"]/gi,
  /pass[=:]\s*['"]([^'"]+)['"]/gi
];

function redactPasswords(text: string): string {
  for (const pattern of PASSWORD_PATTERNS) {
    text = text.replace(pattern, (match, pass) => {
      return match.replace(pass, "[REDACTED]");
    });
  }
  return text;
}
```

### Prompt Injection Defense

**XML Escaping in Bootstrap Files:**
```typescript
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/<\/bootstrap_file>/g, "&lt;/bootstrap_file&gt;")
    .replace(/<system>/g, "&lt;system&gt;")
    .replace(/<\/system>/g, "&lt;/system&gt;")
    .replace(/]\]\]>/g, "]]&gt;");
}
```

**Structured Boundaries:**
```xml
<bootstrap_file path="AGENTS.md">
  ${sanitized_content}
</bootstrap_file>
```

**Content Validation:**
```typescript
// Validate kein unerwarteter XML
if (text.includes("</system>") || text.includes("<assistant>")) {
  throw new Error("Invalid content: contains reserved tags");
}
```

## Zusätzliche Sicherheitsmaßnahmen

### Timeout System

**Agent Timeout:**
```json5
{
  agents: {
    defaults: {
      timeoutSeconds: 600  // 10 Minuten max
    }
  }
}
```

**Tool Timeout:**
```typescript
{
  name: "exec",
  defaultTimeout: 30  // Sekunden
}
```

**Enforcement:**
```typescript
const abortController = new AbortController();
const timer = setTimeout(() => {
  abortController.abort(new TimeoutError("Agent timeout"));
}, timeoutMs);

try {
  await runAgent({ signal: abortController.signal });
} finally {
  clearTimeout(timer);
}
```

### Rate Limiting

**Per-User Rate Limits:**
```json5
{
  agents: {
    defaults: {
      rateLimits: {
        maxMessagesPerMinute: 10,
        maxMessagesPerHour: 100
      }
    }
  }
}
```

**Implementation:** Sliding window in Memory

### Audit Logging

**All Tool Calls are Logged:**
```json
{
  "timestamp": "2026-02-22T12:00:00Z",
  "sessionKey": "agent:main:whatsapp-direct:+15551234567",
  "toolName": "exec",
  "params": { "command": "ls -la" },
  "result": { "exitCode": 0, "output": "..." },
  "duration": 123
}
```

**Log Location:** `~/.openclaw/logs/tools/`

### Security Headers (for Web/API)

```typescript
{
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Content-Security-Policy": "default-src 'self'"
}
```

## Best Practices für sichere Agent-Konfiguration

### 1. Principle of Least Privilege

**Start mit Minimum Tools:**
```json5
{
  agents: {
    list: [{
      id: "restricted",
      tools: {
        allow: ["read"]  // Nur lesen, kein schreiben/ausführen
      }
    }]
  }
}
```

**Erweitern nach Bedarf**

### 2. Always Use Sandbox for Untrusted Code

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main",  // Main auf Host, Rest in Sandbox
        scope: "agent"
      }
    }
  }
}
```

### 3. Enable Loop Detection

```json5
{
  agents: {
    list: [{
      tools: {
        loopDetection: {
          enabled: true  // ✅ Immer aktivieren!
        }
      }
    }]
  }
}
```

### 4. Owner-Only für kritische Tools

```json5
{
  tools: {
    elevated: {
      enable: true,
      senders: ["+15551234567"]  // Nur du
    }
  }
}
```

### 5. Allowlists für Messaging

```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551234567"],  // Nur du
      groupPolicy: "allowlist",
      groups: {
        "123@g.us": { allow: true }  // Nur zugelassene Gruppen
      }
    }
  }
}
```

### 6. Regular Security Audits

```bash
# Prüfe Tool-Logs
cat ~/.openclaw/logs/tools/*.jsonl | jq .

# Prüfe Session-Historie
cat ~/.openclaw/agents/main/sessions/*.jsonl | jq .

# Prüfe failed Logins
grep "auth failure" ~/.openclaw/logs/gateway.log
```

## Incident Response

### Bei verdächtigem Tool-Call

1. **Stop the Session:**
```bash
openclaw agent stop --session <sessionKey>
```

2. **Review Logs:**
```bash
cat ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl | jq .
```

3. **Block Sender (if needed):**
```json5
{
  channels: {
    whatsapp: {
      blockList: ["+15559999999"]
    }
  }
}
```

4. **Rotate API Keys:**
```bash
# Remove compromised key
openclaw auth remove --provider anthropic --id compromised-key

# Add new key
openclaw auth add --provider anthropic
```

### Bei Loop Detection Trigger

1. **Review Session:**
```bash
openclaw sessions history --session <sessionKey> --last 50
```

2. **Identify Pattern:**
```typescript
// Check toolCallHistory
const stats = getToolCallStats(sessionState);
console.log(stats);
// { totalCalls: 25, uniquePatterns: 2, mostFrequent: { toolName: "read", count: 20 } }
```

3. **Adjust Thresholds (if false positive):**
```json5
{
  tools: {
    loopDetection: {
      warningThreshold: 15  // Erhöhe wenn nötig
    }
  }
}
```

## Zusammenfassung

OpenClaw implementiert umfassende Sicherheitsmaßnahmen:

✅ **Multi-Layer Defense:** 5 Schichten von Zugriffskontrolle bis Content Filtering

✅ **Tool Policy System:** Granulare Kontrolle über Tool-Zugriff

✅ **Sandbox:** Docker-basierte Isolation für untrusted code

✅ **Loop Detection:** 4 Mechanismen gegen Endlos-Schleifen

✅ **Content Sanitization:** Size Limits, Redaction, Escaping

✅ **Audit Logging:** Vollständige Nachvollziehbarkeit

✅ **Best Practices:** Principle of Least Privilege, Defense in Depth

✅ **Incident Response:** Tools und Prozesse für Security-Events

## Nächste Schritte

- Lesen Sie [tool-policies.md](tool-policies.md) für detaillierte Policy-Konfiguration
- Lesen Sie [sandbox.md](sandbox.md) für Sandbox-Setup
- Lesen Sie [loop-detection.md](loop-detection.md) für Loop-Detection Details
- Siehe Code-Beispiele in [code/](code/) Verzeichnis
