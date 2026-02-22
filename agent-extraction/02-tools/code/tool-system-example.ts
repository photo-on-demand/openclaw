// Tool Registration & Execution - Vereinfachtes Beispiel
// Basierend auf: src/agents/pi-tools.ts

/**
 * Tool Definition Interface
 */
interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: unknown) => Promise<ToolResult>;
  ownerOnly?: boolean;
  sandbox?: {
    mode: "host" | "sandbox";
    allowHostFallback?: boolean;
  };
}

interface ToolResult {
  content: Array<{
    type: "text" | "image";
    text?: string;
    image?: ImageContent;
  }>;
  details?: Record<string, any>;
}

/**
 * Beispiel: Read Tool
 */
const readTool: AgentTool = {
  name: "read",
  description: "Read file contents or list directory. Use this to view files before editing.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to file or directory"
      },
      view_range: {
        type: "array",
        items: { type: "integer" },
        description: "Optional [start_line, end_line] range"
      }
    },
    required: ["path"]
  },
  execute: async (params: { path: string; view_range?: [number, number] }) => {
    const { path, view_range } = params;
    
    // Prüfe ob Datei oder Verzeichnis
    const stats = await fs.stat(path);
    
    if (stats.isDirectory()) {
      // Liste Verzeichnis-Inhalt
      const entries = await fs.readdir(path, { withFileTypes: true });
      const lines = entries.map(entry => {
        const prefix = entry.isDirectory() ? "📁" : "📄";
        return `${prefix} ${entry.name}`;
      });
      
      return {
        content: [{
          type: "text",
          text: lines.join("\n")
        }],
        details: {
          isDirectory: true,
          entryCount: entries.length
        }
      };
    } else {
      // Lese Datei
      let content = await fs.readFile(path, "utf-8");
      
      // Wende view_range an wenn gegeben
      if (view_range) {
        const lines = content.split("\n");
        const [start, end] = view_range;
        const selectedLines = lines.slice(start - 1, end);
        content = selectedLines
          .map((line, idx) => `${start + idx}. ${line}`)
          .join("\n");
      } else {
        // Füge Zeilennummern hinzu
        const lines = content.split("\n");
        content = lines
          .map((line, idx) => `${idx + 1}. ${line}`)
          .join("\n");
      }
      
      return {
        content: [{
          type: "text",
          text: content
        }],
        details: {
          isDirectory: false,
          size: stats.size
        }
      };
    }
  }
};

/**
 * Beispiel: Write Tool
 */
const writeTool: AgentTool = {
  name: "write",
  description: "Create a new file with the given content. Cannot overwrite existing files - use edit for that.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path for the new file"
      },
      file_text: {
        type: "string",
        description: "Content to write to the file"
      }
    },
    required: ["path", "file_text"]
  },
  execute: async (params: { path: string; file_text: string }) => {
    const { path, file_text } = params;
    
    // Prüfe ob Datei bereits existiert
    const exists = await fs.access(path).then(() => true).catch(() => false);
    if (exists) {
      return {
        content: [{
          type: "text",
          text: `Error: File ${path} already exists. Use edit tool to modify existing files.`
        }],
        details: { error: true }
      };
    }
    
    // Schreibe Datei
    await fs.writeFile(path, file_text, "utf-8");
    
    return {
      content: [{
        type: "text",
        text: `Created file: ${path} (${file_text.length} bytes)`
      }],
      details: {
        path,
        size: file_text.length
      }
    };
  }
};

/**
 * Beispiel: Exec Tool
 */
const execTool: AgentTool = {
  name: "exec",
  description: "Execute a shell command. Use mode='sync' for quick commands, 'async' for long-running processes.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute"
      },
      description: {
        type: "string",
        description: "Human-readable description of what the command does"
      },
      mode: {
        type: "string",
        enum: ["sync", "async"],
        description: "Execution mode: sync waits for completion, async runs in background"
      },
      initial_wait: {
        type: "number",
        description: "Seconds to wait for initial output (async mode only)"
      },
      shellId: {
        type: "string",
        description: "Shell session ID for async mode"
      }
    },
    required: ["command", "description"]
  },
  execute: async (params: {
    command: string;
    description: string;
    mode?: "sync" | "async";
    initial_wait?: number;
    shellId?: string;
  }) => {
    const { command, description, mode = "sync", initial_wait = 10, shellId } = params;
    
    console.log(`[EXEC] ${description}`);
    console.log(`[EXEC] Command: ${command}`);
    
    if (mode === "sync") {
      // Synchrone Ausführung
      const { stdout, stderr, exitCode } = await execSync(command);
      
      const output = (stdout + stderr).trim();
      
      return {
        content: [{
          type: "text",
          text: output || "(no output)"
        }],
        details: {
          exitCode,
          command,
          duration: 0  // Simplified
        }
      };
      
    } else {
      // Asynchrone Ausführung
      const effectiveShellId = shellId || generateShellId();
      
      // Starte Prozess im Hintergrund
      const process = spawn(command, {
        shell: true,
        detached: false
      });
      
      // Registriere Prozess
      processRegistry.set(effectiveShellId, {
        process,
        command,
        startTime: Date.now(),
        output: ""
      });
      
      // Warte initial_wait Sekunden
      await sleep(initial_wait * 1000);
      
      // Sammle Output
      const entry = processRegistry.get(effectiveShellId);
      const output = entry?.output || "";
      
      return {
        content: [{
          type: "text",
          text: output || "(no output yet)"
        }],
        details: {
          shellId: effectiveShellId,
          status: "running",
          command
        }
      };
    }
  }
};

/**
 * Tool Registry - Sammelt alle verfügbaren Tools
 */
function createToolRegistry(config: {
  agentId: string;
  senderIsOwner: boolean;
  sandboxMode: "off" | "all" | "non-main";
  toolPolicy: ToolPolicy;
}): AgentTool[] {
  
  const tools: AgentTool[] = [];
  
  // =============================================
  // FILE SYSTEM TOOLS
  // =============================================
  
  tools.push(readTool);
  tools.push(writeTool);
  
  // Edit Tool (simplified)
  tools.push({
    name: "edit",
    description: "Replace text in an existing file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_str: { type: "string" },
        new_str: { type: "string" }
      },
      required: ["path", "old_str", "new_str"]
    },
    execute: async (params) => {
      // Implementation...
      return { content: [{ type: "text", text: "Edited" }] };
    }
  });
  
  // =============================================
  // EXECUTION TOOLS
  // =============================================
  
  tools.push(execTool);
  
  tools.push({
    name: "process",
    description: "Manage long-running processes",
    parameters: {
      type: "object",
      properties: {
        action: { 
          type: "string", 
          enum: ["poll", "log", "stop"] 
        },
        shellId: { type: "string" }
      },
      required: ["action", "shellId"]
    },
    execute: async (params) => {
      // Implementation...
      return { content: [{ type: "text", text: "Process status" }] };
    }
  });
  
  // =============================================
  // ADVANCED TOOLS (conditional)
  // =============================================
  
  if (isToolAllowed("browser", config.toolPolicy)) {
    tools.push({
      name: "browser",
      description: "Automated web browser control",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["navigate", "click", "type", "screenshot"]
          },
          url: { type: "string" },
          selector: { type: "string" }
        }
      },
      sandbox: {
        mode: "sandbox",  // Immer in Sandbox
        allowHostFallback: false
      },
      execute: async (params) => {
        // Playwright implementation...
        return { content: [{ type: "text", text: "Browser action completed" }] };
      }
    });
  }
  
  // =============================================
  // OPENCLAW-SPECIFIC TOOLS
  // =============================================
  
  if (isToolAllowed("sessions_spawn", config.toolPolicy)) {
    tools.push({
      name: "sessions_spawn",
      description: "Spawn a sub-agent for parallel task execution",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string" },
          prompt: { type: "string" },
          agent_type: {
            type: "string",
            enum: ["explore", "task", "general-purpose"]
          }
        },
        required: ["description", "prompt", "agent_type"]
      },
      execute: async (params) => {
        // Sub-agent spawning logic...
        return { content: [{ type: "text", text: "Sub-agent spawned" }] };
      }
    });
  }
  
  // =============================================
  // APPLY TOOL POLICY
  // =============================================
  
  return tools.filter(tool => {
    // Owner-Only Check
    if (tool.ownerOnly && !config.senderIsOwner) {
      return false;
    }
    
    // Policy Check
    return isToolAllowed(tool.name, config.toolPolicy);
  });
}

/**
 * Tool Policy Checker
 */
function isToolAllowed(
  toolName: string,
  policy: ToolPolicy
): boolean {
  
  // 1. Prüfe Deny List
  if (policy.deny?.includes(toolName)) {
    return false;
  }
  
  // 2. Prüfe Allow List (wenn vorhanden)
  if (policy.allow) {
    return policy.allow.includes(toolName);
  }
  
  // 3. Default: Allow
  return true;
}

/**
 * Tool für Provider adaptieren
 */
function adaptToolForProvider(
  tool: AgentTool,
  provider: "anthropic" | "openai" | "google"
): ProviderTool {
  
  if (provider === "anthropic") {
    // Anthropic Native Format
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    };
  } else if (provider === "openai") {
    // OpenAI Function Calling Format
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    };
  } else if (provider === "google") {
    // Google Function Declaration Format
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "OBJECT",
        properties: convertToGoogleSchema(tool.parameters.properties)
      }
    };
  }
  
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Tool Execution mit vollständiger Pipeline
 */
async function executeToolWithPipeline(
  toolCall: { name: string; params: unknown; id: string },
  context: ExecutionContext
): Promise<ToolResult> {
  
  const { name, params, id } = toolCall;
  
  // 1. Loop Detection
  const loopCheck = detectToolCallLoop(
    context.sessionState,
    name,
    params,
    context.config.loopDetection
  );
  
  if (loopCheck.stuck && loopCheck.level === "critical") {
    throw new Error(loopCheck.message);
  }
  
  // 2. Policy Check
  if (!isToolAllowed(name, context.toolPolicy)) {
    throw new Error(`Tool ${name} not allowed by policy`);
  }
  
  // 3. Find Tool
  const tool = context.tools.find(t => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  
  // 4. Before Hook
  await runBeforeToolCallHook(name, params, context);
  
  // 5. Execute
  let result: ToolResult;
  try {
    result = await tool.execute(params);
  } catch (error) {
    result = {
      content: [{
        type: "text",
        text: `Error: ${error.message}`
      }],
      details: { error: true }
    };
  }
  
  // 6. Sanitize Result
  result = sanitizeToolResult(result, {
    maxBytes: 102400,
    redactSensitive: true
  });
  
  // 7. After Hook
  await runAfterToolCallHook(name, params, result, context);
  
  // 8. Record Outcome
  recordToolCallOutcome(context.sessionState, {
    toolName: name,
    toolParams: params,
    result,
    toolCallId: id
  });
  
  return result;
}

// Export
export {
  readTool,
  writeTool,
  execTool,
  createToolRegistry,
  isToolAllowed,
  adaptToolForProvider,
  executeToolWithPipeline
};
