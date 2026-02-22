// Agent Loop - Vereinfachtes Beispiel
// Basierend auf: src/agents/pi-embedded-runner/run.ts

/**
 * Haupteinstiegspunkt für einen Agent Run.
 * Dies ist eine vereinfachte Version zur Illustration.
 */
async function runAgentLoop(params: {
  message: string;
  sessionKey: string;
  agentId: string;
  cfg: Config;
}): Promise<AgentResult> {
  
  // =============================================
  // PHASE 1: SETUP & VALIDATION
  // =============================================
  
  console.log('[PHASE 1] Setup & Validation');
  
  // Session auflösen
  const sessionId = resolveSessionId(params.sessionKey);
  const sessionPath = `~/.openclaw/agents/${params.agentId}/sessions/${sessionId}.jsonl`;
  
  // Workspace laden
  const workspace = params.cfg.agents.defaults.workspace;
  process.chdir(workspace);
  
  // =============================================
  // PHASE 2: CONTEXT ASSEMBLY
  // =============================================
  
  console.log('[PHASE 2] Context Assembly');
  
  // Bootstrap-Dateien laden
  const bootstrapFiles = await loadBootstrapFiles(workspace);
  // Beispiel:
  // {
  //   "AGENTS.md": "# Operating Instructions\n...",
  //   "SOUL.md": "# Persona\n...",
  //   "USER.md": "# User Profile\n..."
  // }
  
  // Skills laden
  const skills = await loadSkills({
    bundled: true,
    managed: '~/.openclaw/skills',
    workspace: `${workspace}/skills`
  });
  
  // Session-Historie laden
  const history = await loadSessionHistory(sessionPath);
  // Format: Array<{ role: "user" | "assistant", content: [...] }>
  
  // System-Prompt bauen
  const systemPrompt = buildSystemPrompt({
    identity: "You are OpenClaw, an advanced AI agent...",
    runtime: {
      agent: params.agentId,
      session: params.sessionKey,
      model: params.cfg.agents.defaults.model,
      time: new Date().toISOString(),
      workspace
    },
    tools: availableTools.map(t => t.name),
    skills,
    bootstrapFiles,
    mode: "full"  // "full" | "minimal" | "none"
  });
  
  // =============================================
  // PHASE 3: QUEUEING
  // =============================================
  
  console.log('[PHASE 3] Queueing');
  
  // Warte auf Session Lane (pro Session serialisiert)
  await sessionLane.wait(params.sessionKey);
  
  // Optional: Warte auf Global Lane
  if (params.cfg.agents.defaults.globalLane) {
    await globalLane.wait();
  }
  
  // Write Lock erwerben
  const lock = await acquireSessionWriteLock(sessionPath);
  
  try {
    // =============================================
    // PHASE 4: MODEL INFERENCE LOOP
    // =============================================
    
    console.log('[PHASE 4] Model Inference Loop');
    
    // Bereite Messages vor
    const messages = [
      ...history,
      { role: "user", content: params.message }
    ];
    
    let toolCallsRemaining = true;
    const maxIterations = 50;  // Sicherheits-Limit
    let iteration = 0;
    
    while (toolCallsRemaining && iteration < maxIterations) {
      iteration++;
      
      // API Request an LLM
      const response = await callModel({
        systemPrompt,
        messages,
        tools: availableTools,
        model: params.cfg.agents.defaults.model,
        thinking: params.cfg.agents.defaults.thinking
      });
      
      // Streame Assistant Response
      for await (const delta of response.stream) {
        if (delta.type === 'text') {
          // Streame Text-Delta an User
          await streamAssistantDelta(params.sessionKey, delta.text);
        } else if (delta.type === 'tool_call') {
          // Tool Call gefunden
          await handleToolCall(delta, messages, params);
        }
      }
      
      // Prüfe ob weitere Tool Calls nötig
      toolCallsRemaining = response.toolCalls.length > 0;
      
      // Prüfe Queue für Steering (optional)
      if (params.cfg.channels[channel].queueMode === 'steer') {
        const queuedMessage = await checkQueue(params.sessionKey);
        if (queuedMessage) {
          // Injiziere neue Nachricht
          messages.push({
            role: "user",
            content: queuedMessage
          });
          toolCallsRemaining = true;  // Trigger neue Iteration
        }
      }
    }
    
    // =============================================
    // PHASE 5: PERSISTENCE
    // =============================================
    
    console.log('[PHASE 5] Persistence');
    
    // Speichere Session-Historie
    await appendToSession(sessionPath, messages);
    
    // Emittiere Lifecycle End Event
    await emitLifecycleEvent({
      stream: "lifecycle",
      phase: "end",
      sessionKey: params.sessionKey,
      usage: response.usage,
      payloads: response.finalPayloads
    });
    
    return {
      status: "ok",
      text: response.finalText,
      usage: response.usage
    };
    
  } finally {
    // Cleanup
    lock.release();
    sessionLane.release(params.sessionKey);
    if (params.cfg.agents.defaults.globalLane) {
      globalLane.release();
    }
  }
}

/**
 * Tool Call Handler - Ausführung eines einzelnen Tool Calls
 */
async function handleToolCall(
  toolCall: ToolCall,
  messages: Message[],
  context: Context
): Promise<void> {
  
  const { toolName, params, toolCallId } = toolCall;
  
  console.log(`[TOOL CALL] ${toolName}`, params);
  
  // =============================================
  // LOOP DETECTION
  // =============================================
  
  const loopCheck = detectToolCallLoop(
    context.sessionState,
    toolName,
    params,
    context.cfg.tools?.loopDetection
  );
  
  if (loopCheck.stuck) {
    if (loopCheck.level === 'critical') {
      // Blocke Tool Call
      throw new Error(loopCheck.message);
    } else {
      // Sende Warning an Agent
      messages.push({
        role: "user",
        content: `[SYSTEM WARNING] ${loopCheck.message}`
      });
    }
  }
  
  // =============================================
  // TOOL POLICY CHECK
  // =============================================
  
  const allowed = isToolAllowed(toolName, {
    agentId: context.agentId,
    isSubAgent: context.isSubAgent,
    senderIsOwner: context.senderIsOwner,
    cfg: context.cfg
  });
  
  if (!allowed) {
    const result = {
      content: [{
        type: "text",
        text: `Tool ${toolName} is not allowed by policy`
      }],
      details: { error: true }
    };
    messages.push({
      role: "user",
      content: JSON.stringify(result),
      tool_call_id: toolCallId
    });
    return;
  }
  
  // =============================================
  // TOOL EXECUTION
  // =============================================
  
  // Before Hook
  await runBeforeToolCallHook(toolName, params, context);
  
  let result: ToolResult;
  try {
    // Finde Tool
    const tool = availableTools.find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }
    
    // Emittiere Tool Start Event
    await emitToolEvent({
      stream: "tool",
      event: "start",
      toolName,
      params
    });
    
    // Führe Tool aus
    result = await tool.execute(params);
    
    // Emittiere Tool End Event
    await emitToolEvent({
      stream: "tool",
      event: "end",
      toolName,
      result
    });
    
  } catch (error) {
    // Tool Fehler
    result = {
      content: [{
        type: "text",
        text: `Tool execution failed: ${error.message}`
      }],
      details: { error: true }
    };
  }
  
  // After Hook
  await runAfterToolCallHook(toolName, params, result, context);
  
  // =============================================
  // RESULT SANITIZATION
  // =============================================
  
  result = sanitizeToolResult(result, {
    maxBytes: context.cfg.tools?.resultMaxBytes ?? 102400,
    redactSensitive: true
  });
  
  // =============================================
  // RECORD FOR LOOP DETECTION
  // =============================================
  
  recordToolCallOutcome(context.sessionState, {
    toolName,
    toolParams: params,
    result,
    toolCallId,
    config: context.cfg.tools?.loopDetection
  });
  
  // =============================================
  // ADD TO MESSAGES
  // =============================================
  
  messages.push({
    role: "user",  // Tool results sind "user" role
    content: result.content,
    tool_call_id: toolCallId
  });
}

/**
 * System Prompt Builder - Vereinfacht
 */
function buildSystemPrompt(params: SystemPromptParams): string {
  const sections: string[] = [];
  
  // Identity
  sections.push(params.identity);
  sections.push('');
  
  // Runtime Section
  sections.push('## Runtime');
  sections.push(`Agent: ${params.runtime.agent}`);
  sections.push(`Session: ${params.runtime.session}`);
  sections.push(`Model: ${params.runtime.model}`);
  sections.push(`Time: ${params.runtime.time}`);
  sections.push(`Workspace: ${params.runtime.workspace}`);
  sections.push('');
  
  // Tools Section
  if (params.mode !== 'none') {
    sections.push('## Tooling');
    sections.push(`Available tools: ${params.tools.join(', ')}`);
    sections.push('');
    sections.push('Tool call loop detection: enabled');
    sections.push('- DO NOT repeatedly call identical tools with no progress');
    sections.push('- If stuck, stop retrying and report failure');
    sections.push('');
  }
  
  // Skills Section
  if (params.mode === 'full' && params.skills.length > 0) {
    sections.push('## Skills (mandatory)');
    sections.push('Before replying: scan <available_skills> entries.');
    sections.push('<available_skills>');
    for (const skill of params.skills) {
      sections.push(`  <skill>`);
      sections.push(`    <name>${skill.name}</name>`);
      sections.push(`    <description>${skill.description}</description>`);
      sections.push(`    <location>${skill.location}</location>`);
      sections.push(`  </skill>`);
    }
    sections.push('</available_skills>');
    sections.push('');
  }
  
  // Bootstrap Files
  if (params.mode !== 'none') {
    sections.push('## Workspace Files');
    for (const [filename, content] of Object.entries(params.bootstrapFiles)) {
      sections.push(`<bootstrap_file path="${filename}">`);
      sections.push(content);
      sections.push('</bootstrap_file>');
      sections.push('');
    }
  }
  
  return sections.join('\n');
}

// Export für Testing
export {
  runAgentLoop,
  handleToolCall,
  buildSystemPrompt
};
