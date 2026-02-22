# Original OpenClaw Dokumentation - Links & Referenzen

Diese Extraktion basiert auf der Original-Dokumentation von OpenClaw. Hier sind Links zu den wichtigsten Original-Dokumenten:

## Online-Dokumentation

**Hauptseite:** https://docs.openclaw.ai

### Konzepte

- **Agent Loop:** https://docs.openclaw.ai/concepts/agent-loop
- **Agent Runtime:** https://docs.openclaw.ai/concepts/agent
- **Multi-Agent:** https://docs.openclaw.ai/concepts/multi-agent
- **Agent Workspace:** https://docs.openclaw.ai/concepts/agent-workspace
- **System Prompt:** https://docs.openclaw.ai/concepts/system-prompt
- **Compaction:** https://docs.openclaw.ai/concepts/compaction
- **Streaming:** https://docs.openclaw.ai/concepts/streaming
- **Queue:** https://docs.openclaw.ai/concepts/queue

### Tools

- **Tool Übersicht:** https://docs.openclaw.ai/tools
- **Agent-to-Agent Tools:** https://docs.openclaw.ai/tools/subagents
- **Multi-Agent Sandbox & Tools:** https://docs.openclaw.ai/tools/multi-agent-sandbox-tools
- **Skills:** https://docs.openclaw.ai/tools/skills
- **Plugin Tools:** https://docs.openclaw.ai/plugins/agent-tools

### Gateway & Sicherheit

- **Gateway Konfiguration:** https://docs.openclaw.ai/gateway/configuration
- **Sandbox vs Tool Policy:** https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated
- **Sandboxing:** https://docs.openclaw.ai/gateway/sandboxing

### Channels

- **WhatsApp:** https://docs.openclaw.ai/channels/whatsapp
- **Discord:** https://docs.openclaw.ai/channels/discord
- **Telegram:** https://docs.openclaw.ai/channels/telegram
- **Signal:** https://docs.openclaw.ai/channels/signal

## Source Code Referenzen

### Agent Loop

**Hauptdateien:**
```
src/agents/pi-embedded-runner/run.ts
src/agents/pi-embedded-runner/run/attempt.ts
src/agents/pi-embedded-subscribe.ts
src/agents/pi-embedded-subscribe.handlers.ts
```

**Queueing:**
```
src/process/command-queue.ts
src/agents/pi-embedded-runner/lanes.ts
```

### Tools

**Tool System:**
```
src/agents/pi-tools.ts
src/agents/pi-tool-definition-adapter.ts
src/agents/pi-embedded-subscribe.handlers.tools.ts
```

**Built-in Tools:**
```
src/agents/bash-tools.ts
src/agents/tools/browser-tool.ts
src/agents/tools/canvas-tool.ts
src/agents/tools/memory-tools.ts
src/agents/tools/sessions-spawn-tool.ts
```

### Prompt & Context

**System Prompt:**
```
src/agents/system-prompt.ts
src/agents/system-prompt-params.ts
src/agents/system-prompt-report.ts
```

**Bootstrap Files:**
```
src/agents/bootstrap-files.ts
src/agents/bootstrap-hooks.ts
src/agents/workspace.ts
```

**Skills:**
```
src/agents/skills.ts
src/agents/skills-install.ts
```

### Security

**Tool Policy:**
```
src/agents/tool-policy.ts
src/agents/tool-policy-pipeline.ts
src/agents/pi-tools.policy.ts
src/agents/tool-policy-shared.ts
```

**Sandbox:**
```
src/agents/sandbox.ts
src/agents/sandbox-tool-policy.ts
src/agents/sandbox-paths.ts
src/agents/sandbox/runtime-status.ts
```

**Loop Detection:**
```
src/agents/tool-loop-detection.ts
src/agents/session-tool-result-guard.ts
```

**Sanitization:**
```
src/agents/sanitize-for-prompt.ts
src/agents/pi-embedded-runner/tool-result-truncation.ts
src/agents/image-sanitization.ts
```

## Konfiguration

**Haupt-Config:**
```
~/.openclaw/openclaw.json
```

**Beispiel-Configs:**
```
.env.example (im Repository Root)
docs/gateway/configuration.md
```

## CLI Commands

**Agent Commands:**
```bash
openclaw agent --help
openclaw agents list
openclaw agents add <agentId>
openclaw agents delete <agentId>
```

**Session Commands:**
```bash
openclaw sessions list
openclaw sessions history --session <key>
openclaw agent stop --session <key>
```

**Tool Commands:**
```bash
openclaw channels status
openclaw auth list
openclaw auth add --provider <provider>
```

## Repository

**GitHub:** https://github.com/openclaw/openclaw

**Wichtige Branches:**
- `main` - Stable releases
- `develop` - Development branch

**Issues:** https://github.com/openclaw/openclaw/issues

**Discussions:** https://github.com/openclaw/openclaw/discussions

## Community

**Discord:** Siehe Repository README für Einladungslink

**Twitter/X:** Siehe Repository README

## Lizenz

OpenClaw ist lizenziert unter der Lizenz im Haupt-Repository.

Siehe: https://github.com/openclaw/openclaw/blob/main/LICENSE

## Änderungshistorie

Diese Dokumentation basiert auf OpenClaw Stand: **Februar 2026**

Für neueste Updates siehe:
- CHANGELOG.md im Repository
- GitHub Releases
- Docs Website (docs.openclaw.ai)

## Hinweise zur Verwendung

Diese extrahierte Dokumentation ist eine **Momentaufnahme** des Systems. Für die aktuellste Information:

1. ✅ Konsultiere immer die offizielle Docs-Website
2. ✅ Prüfe die Source-Code Kommentare
3. ✅ Lies die Test-Dateien (*.test.ts) für Beispiele
4. ✅ Schaue in die GitHub Issues für bekannte Probleme

## Weiterführende Ressourcen

### Videos & Tutorials
- Siehe YouTube-Kanal (falls vorhanden, Link im Repository)
- Community-erstellte Tutorials

### Blog Posts
- Setup-Guides
- Best Practices
- Use Cases

### Sample Configs
- Im Repository unter `examples/` (falls vorhanden)
- Community-Configs in Discussions

---

**Wichtig:** Diese Extraktion dient Bildungszwecken. Für produktive Nutzung verwende immer die offizielle OpenClaw-Dokumentation und halte das System aktuell.
