// Loop Detection System - Vereinfachtes Beispiel
// Basierend auf: src/agents/tool-loop-detection.ts

import { createHash } from "crypto";

/**
 * Tool Call History Entry
 */
interface ToolCallHistoryEntry {
  toolName: string;
  argsHash: string;      // Hash der Parameter
  resultHash?: string;   // Hash des Results (wenn vorhanden)
  toolCallId?: string;
  timestamp: number;
}

/**
 * Loop Detection Config
 */
interface LoopDetectionConfig {
  enabled: boolean;
  historySize: number;              // Max History-Einträge
  warningThreshold: number;         // Warning nach N Wiederholungen
  criticalThreshold: number;        // Block nach N Wiederholungen
  globalCircuitBreakerThreshold: number;  // Hard Stop
  detectors: {
    genericRepeat: boolean;         // Generische Wiederholungen
    knownPollNoProgress: boolean;   // Polling ohne Fortschritt
    pingPong: boolean;              // Ping-Pong Pattern
  };
}

/**
 * Loop Detection Result
 */
type LoopDetectionResult =
  | { stuck: false }
  | {
      stuck: true;
      level: "warning" | "critical";
      detector: "generic_repeat" | "known_poll_no_progress" | "global_circuit_breaker" | "ping_pong";
      count: number;
      message: string;
      pairedToolName?: string;
      warningKey?: string;
    };

/**
 * Default Configuration
 */
const DEFAULT_CONFIG: LoopDetectionConfig = {
  enabled: false,
  historySize: 30,
  warningThreshold: 10,
  criticalThreshold: 20,
  globalCircuitBreakerThreshold: 30,
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true
  }
};

/**
 * Hash einen Tool Call für Pattern Matching
 */
function hashToolCall(toolName: string, params: unknown): string {
  const serialized = stableStringify(params);
  const hash = createHash("sha256").update(serialized).digest("hex");
  return `${toolName}:${hash}`;
}

/**
 * Stabiles Stringify (deterministisch)
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Hash Tool Outcome (Result + Error)
 */
function hashToolOutcome(
  toolName: string,
  params: unknown,
  result: unknown,
  error: unknown
): string | undefined {
  if (error !== undefined) {
    const errorStr = error instanceof Error ? error.message : String(error);
    const hash = createHash("sha256").update(errorStr).digest("hex");
    return `error:${hash}`;
  }
  
  if (result === undefined) {
    return undefined;
  }
  
  // Extract text content from tool result
  const text = extractTextFromResult(result);
  const hash = createHash("sha256").update(text).digest("hex");
  return hash;
}

/**
 * Extrahiere Text aus Tool Result
 */
function extractTextFromResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (typeof result === "object" && result !== null) {
    const obj = result as any;
    if (Array.isArray(obj.content)) {
      return obj.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
    }
  }
  return JSON.stringify(result);
}

/**
 * Prüfe ob Tool ein bekanntes Polling-Tool ist
 */
function isKnownPollToolCall(toolName: string, params: unknown): boolean {
  if (toolName === "command_status") {
    return true;
  }
  if (toolName === "process" && typeof params === "object" && params !== null) {
    const action = (params as any).action;
    return action === "poll" || action === "log";
  }
  return false;
}

/**
 * Berechne No-Progress Streak
 * (Gleicher Tool Call mit gleichen Results)
 */
function getNoProgressStreak(
  history: ToolCallHistoryEntry[],
  toolName: string,
  argsHash: string
): { count: number; latestResultHash?: string } {
  let streak = 0;
  let latestResultHash: string | undefined;
  
  // Von hinten nach vorne durchgehen
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    if (!record) continue;
    
    // Prüfe ob gleicher Tool Call
    if (record.toolName !== toolName || record.argsHash !== argsHash) {
      continue;
    }
    
    // Brauchen Result Hash
    if (!record.resultHash) {
      continue;
    }
    
    // Erster Match
    if (!latestResultHash) {
      latestResultHash = record.resultHash;
      streak = 1;
      continue;
    }
    
    // Prüfe ob Result identisch
    if (record.resultHash !== latestResultHash) {
      break;  // Streak beendet
    }
    
    streak++;
  }
  
  return { count: streak, latestResultHash };
}

/**
 * Detect Ping-Pong Pattern
 * (Alternierend zwischen zwei Tool Calls)
 */
function getPingPongStreak(
  history: ToolCallHistoryEntry[],
  currentSignature: string
): {
  count: number;
  pairedToolName?: string;
  pairedSignature?: string;
  noProgressEvidence: boolean;
} {
  
  if (history.length < 2) {
    return { count: 0, noProgressEvidence: false };
  }
  
  const last = history[history.length - 1];
  if (!last) {
    return { count: 0, noProgressEvidence: false };
  }
  
  // Finde das "andere" Pattern
  let otherSignature: string | undefined;
  let otherToolName: string | undefined;
  
  for (let i = history.length - 2; i >= 0; i--) {
    const call = history[i];
    if (!call) continue;
    
    if (call.argsHash !== last.argsHash) {
      otherSignature = call.argsHash;
      otherToolName = call.toolName;
      break;
    }
  }
  
  if (!otherSignature) {
    return { count: 0, noProgressEvidence: false };
  }
  
  // Zähle alternierenden Tail
  let alternatingCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const call = history[i];
    if (!call) continue;
    
    const expected = alternatingCount % 2 === 0 ? last.argsHash : otherSignature;
    if (call.argsHash !== expected) {
      break;
    }
    alternatingCount++;
  }
  
  if (alternatingCount < 2) {
    return { count: 0, noProgressEvidence: false };
  }
  
  // Prüfe ob current call das Pattern fortsetzt
  if (currentSignature !== otherSignature) {
    return { count: 0, noProgressEvidence: false };
  }
  
  // Prüfe No-Progress Evidence
  // (Beide Patterns müssen stabile Results haben)
  const tailStart = Math.max(0, history.length - alternatingCount);
  let firstHashA: string | undefined;
  let firstHashB: string | undefined;
  let noProgressEvidence = true;
  
  for (let i = tailStart; i < history.length; i++) {
    const call = history[i];
    if (!call || !call.resultHash) {
      noProgressEvidence = false;
      break;
    }
    
    if (call.argsHash === last.argsHash) {
      if (!firstHashA) {
        firstHashA = call.resultHash;
      } else if (firstHashA !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else if (call.argsHash === otherSignature) {
      if (!firstHashB) {
        firstHashB = call.resultHash;
      } else if (firstHashB !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    }
  }
  
  if (!firstHashA || !firstHashB) {
    noProgressEvidence = false;
  }
  
  return {
    count: alternatingCount + 1,
    pairedToolName: otherToolName,
    pairedSignature: otherSignature,
    noProgressEvidence
  };
}

/**
 * Main Loop Detection Function
 */
export function detectToolCallLoop(
  sessionState: { toolCallHistory?: ToolCallHistoryEntry[] },
  toolName: string,
  params: unknown,
  config?: Partial<LoopDetectionConfig>
): LoopDetectionResult {
  
  // Merge Config
  const cfg: LoopDetectionConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };
  
  if (!cfg.enabled) {
    return { stuck: false };
  }
  
  const history = sessionState.toolCallHistory ?? [];
  const currentHash = hashToolCall(toolName, params);
  
  // =============================================
  // 1. NO-PROGRESS DETECTION
  // =============================================
  
  const noProgress = getNoProgressStreak(history, toolName, currentHash);
  const noProgressStreak = noProgress.count;
  
  // GLOBAL CIRCUIT BREAKER (höchste Priorität)
  if (noProgressStreak >= cfg.globalCircuitBreakerThreshold) {
    return {
      stuck: true,
      level: "critical",
      detector: "global_circuit_breaker",
      count: noProgressStreak,
      message: `CRITICAL: ${toolName} has repeated identical no-progress outcomes ${noProgressStreak} times. Session execution blocked by global circuit breaker to prevent runaway loops.`,
      warningKey: `global:${toolName}:${currentHash}:${noProgress.latestResultHash ?? "none"}`
    };
  }
  
  // KNOWN POLL NO-PROGRESS (für Polling-Tools)
  const isKnownPoll = isKnownPollToolCall(toolName, params);
  
  if (isKnownPoll && cfg.detectors.knownPollNoProgress) {
    if (noProgressStreak >= cfg.criticalThreshold) {
      return {
        stuck: true,
        level: "critical",
        detector: "known_poll_no_progress",
        count: noProgressStreak,
        message: `CRITICAL: Called ${toolName} with identical arguments and no progress ${noProgressStreak} times. This appears to be a stuck polling loop. Session execution blocked to prevent resource waste.`,
        warningKey: `poll:${toolName}:${currentHash}:${noProgress.latestResultHash ?? "none"}`
      };
    }
    
    if (noProgressStreak >= cfg.warningThreshold) {
      return {
        stuck: true,
        level: "warning",
        detector: "known_poll_no_progress",
        count: noProgressStreak,
        message: `WARNING: You have called ${toolName} ${noProgressStreak} times with identical arguments and no progress. Stop polling and either (1) increase wait time between checks, or (2) report the task as failed if the process is stuck.`,
        warningKey: `poll:${toolName}:${currentHash}:${noProgress.latestResultHash ?? "none"}`
      };
    }
  }
  
  // =============================================
  // 2. PING-PONG DETECTION
  // =============================================
  
  const pingPong = getPingPongStreak(history, currentHash);
  
  if (cfg.detectors.pingPong && pingPong.count >= cfg.criticalThreshold && pingPong.noProgressEvidence) {
    return {
      stuck: true,
      level: "critical",
      detector: "ping_pong",
      count: pingPong.count,
      message: `CRITICAL: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls) with no progress. This appears to be a stuck ping-pong loop. Session execution blocked to prevent resource waste.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: `pingpong:${currentHash}:${pingPong.pairedSignature ?? "unknown"}`
    };
  }
  
  if (cfg.detectors.pingPong && pingPong.count >= cfg.warningThreshold) {
    return {
      stuck: true,
      level: "warning",
      detector: "ping_pong",
      count: pingPong.count,
      message: `WARNING: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls). This looks like a ping-pong loop; stop retrying and report the task as failed.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: `pingpong:${currentHash}:${pingPong.pairedSignature ?? "unknown"}`
    };
  }
  
  // =============================================
  // 3. GENERIC REPEAT DETECTION
  // =============================================
  
  const recentCount = history.filter(
    h => h.toolName === toolName && h.argsHash === currentHash
  ).length;
  
  if (!isKnownPoll && cfg.detectors.genericRepeat && recentCount >= cfg.warningThreshold) {
    return {
      stuck: true,
      level: "warning",
      detector: "generic_repeat",
      count: recentCount,
      message: `WARNING: You have called ${toolName} ${recentCount} times with identical arguments. If this is not making progress, stop retrying and report the task as failed.`,
      warningKey: `generic:${toolName}:${currentHash}`
    };
  }
  
  // Kein Loop erkannt
  return { stuck: false };
}

/**
 * Zeichne Tool Call auf (für History)
 */
export function recordToolCall(
  sessionState: { toolCallHistory?: ToolCallHistoryEntry[] },
  toolName: string,
  params: unknown,
  toolCallId?: string,
  config?: Partial<LoopDetectionConfig>
): void {
  
  const cfg: LoopDetectionConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };
  
  if (!sessionState.toolCallHistory) {
    sessionState.toolCallHistory = [];
  }
  
  sessionState.toolCallHistory.push({
    toolName,
    argsHash: hashToolCall(toolName, params),
    toolCallId,
    timestamp: Date.now()
  });
  
  // Sliding Window: Behalte nur letzte N Einträge
  if (sessionState.toolCallHistory.length > cfg.historySize) {
    sessionState.toolCallHistory.shift();
  }
}

/**
 * Zeichne Tool Call Outcome auf (Result)
 */
export function recordToolCallOutcome(
  sessionState: { toolCallHistory?: ToolCallHistoryEntry[] },
  params: {
    toolName: string;
    toolParams: unknown;
    toolCallId?: string;
    result?: unknown;
    error?: unknown;
    config?: Partial<LoopDetectionConfig>;
  }
): void {
  
  const cfg: LoopDetectionConfig = {
    ...DEFAULT_CONFIG,
    ...params.config
  };
  
  const resultHash = hashToolOutcome(
    params.toolName,
    params.toolParams,
    params.result,
    params.error
  );
  
  if (!resultHash) {
    return;  // Kein Result zu recorden
  }
  
  if (!sessionState.toolCallHistory) {
    sessionState.toolCallHistory = [];
  }
  
  const argsHash = hashToolCall(params.toolName, params.toolParams);
  
  // Finde matching Entry und update
  let matched = false;
  for (let i = sessionState.toolCallHistory.length - 1; i >= 0; i--) {
    const call = sessionState.toolCallHistory[i];
    if (!call) continue;
    
    // Match by toolCallId or by toolName+argsHash
    if (params.toolCallId && call.toolCallId !== params.toolCallId) {
      continue;
    }
    if (call.toolName !== params.toolName || call.argsHash !== argsHash) {
      continue;
    }
    if (call.resultHash !== undefined) {
      continue;  // Already has result
    }
    
    // Update
    call.resultHash = resultHash;
    matched = true;
    break;
  }
  
  // Wenn nicht gefunden, füge neuen Entry hinzu
  if (!matched) {
    sessionState.toolCallHistory.push({
      toolName: params.toolName,
      argsHash,
      toolCallId: params.toolCallId,
      resultHash,
      timestamp: Date.now()
    });
  }
  
  // Sliding Window
  if (sessionState.toolCallHistory.length > cfg.historySize) {
    sessionState.toolCallHistory.splice(
      0,
      sessionState.toolCallHistory.length - cfg.historySize
    );
  }
}

/**
 * Beispiel-Usage
 */
function exampleUsage() {
  const sessionState: { toolCallHistory?: ToolCallHistoryEntry[] } = {};
  
  const config: Partial<LoopDetectionConfig> = {
    enabled: true,
    warningThreshold: 5,
    criticalThreshold: 10
  };
  
  // Simuliere Tool Calls
  for (let i = 0; i < 12; i++) {
    const toolName = "process";
    const params = { action: "poll", shellId: "test-123" };
    
    // Check vor Call
    const loopCheck = detectToolCallLoop(sessionState, toolName, params, config);
    
    if (loopCheck.stuck) {
      console.log(`[Loop Detection] ${loopCheck.level}: ${loopCheck.message}`);
      
      if (loopCheck.level === "critical") {
        throw new Error("Critical loop detected - stopping execution");
      }
    }
    
    // Record Call
    recordToolCall(sessionState, toolName, params, `call-${i}`, config);
    
    // Simuliere Result
    const result = { status: "running", exitCode: null };
    recordToolCallOutcome(sessionState, {
      toolName,
      toolParams: params,
      toolCallId: `call-${i}`,
      result,
      config
    });
  }
}

// Export
export {
  LoopDetectionConfig,
  LoopDetectionResult,
  ToolCallHistoryEntry,
  hashToolCall,
  hashToolOutcome,
  isKnownPollToolCall,
  getNoProgressStreak,
  getPingPongStreak
};
