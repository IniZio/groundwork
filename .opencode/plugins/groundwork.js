/**
 * opencode-groundwork plugin
 *
 * Merges:
 * 1. Groundwork workflow skills injection (via config hook + chat.messages.transform)
 * 2. Session handoff tools (handoff_session, read_session) + /handoff command
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { tool } from '@opencode-ai/plugin'
import fsPromises from 'fs/promises'
import { readGoal, writeGoal, clearGoal, goalReminder } from '../../src/lib/goal.js'

const z = tool.schema
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─── Skills injection helpers ─────────────────────────────────────────────────

const groundworkSkillsDir = path.resolve(__dirname, '../../skills/groundwork')

function extractAndStripFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, content }
  const frontmatterStr = match[1]
  const body = match[2]
  const lines = frontmatterStr.split('\n')
  const frontmatter = {}
  const stack = [{ obj: frontmatter, indent: -1 }]

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue
    
    // Calculate indentation (2 spaces per level)
    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0
    
    // Find the colon position
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    
    const keyRaw = line.slice(indentMatch[1].length, colonIdx).trim()
    const key = keyRaw.replace(/^["']|["']$/g, '')
    const valueRaw = line.slice(colonIdx + 1).trim()
    const value = valueRaw.replace(/^["']|["']$/g, '')
    
    // Pop stack until we find the parent with smaller indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }
    
    const parent = stack[stack.length - 1].obj
    
    // If value is empty, this key starts a new nested object
    if (value === '') {
      parent[key] = {}
      stack.push({ obj: parent[key], indent })
    } else {
      parent[key] = value
    }
  }
  
  return { frontmatter, content: body }
}

const bootstrapContentCache = new Map()

function normalizedAgentName(agent) {
  return (agent || '').trim().toLowerCase()
}

function isOrchestratorAgent(agent) {
  const n = normalizedAgentName(agent)
  return n === 'orchestrator' || n === 'general-purpose' || n === 'general_purpose' || n === 'default'
}

function isCoderAgent(agent) {
  const n = normalizedAgentName(agent)
  return n === 'coder' || n === 'developer' || n === 'dev'
}

function getBootstrapForAgent(agent) {
  const cacheKey = `${normalizedAgentName(agent)}:bootstrap`
  const cached = bootstrapContentCache.get(cacheKey)
  if (cached !== undefined) return cached

  const universalPath = path.join(groundworkSkillsDir, 'use-groundwork', 'bootstrap-universal.md')
  let universalContent = ''
  let usingSkMlFallback = false

  if (fs.existsSync(universalPath)) {
    const fullContent = fs.readFileSync(universalPath, 'utf8')
    const { content } = extractAndStripFrontmatter(fullContent)
    universalContent = content
  } else {
    // Fallback: load the full SKILL.md (legacy)
    const skillPath = path.join(groundworkSkillsDir, 'use-groundwork', 'SKILL.md')
    if (!fs.existsSync(skillPath)) { bootstrapContentCache.set(cacheKey, null); return null }
    const fullContent = fs.readFileSync(skillPath, 'utf8')
    const { content } = extractAndStripFrontmatter(fullContent)
    universalContent = content
    usingSkMlFallback = true
  }

  let agentContent = ''
  if (isOrchestratorAgent(agent)) {
    const agentPath = path.join(groundworkSkillsDir, 'use-groundwork', 'bootstrap-orchestrator.md')
    if (fs.existsSync(agentPath)) {
      const fullContent = fs.readFileSync(agentPath, 'utf8')
      const { content } = extractAndStripFrontmatter(fullContent)
      agentContent = content
    }
  } else if (isCoderAgent(agent)) {
    const agentPath = path.join(groundworkSkillsDir, 'use-groundwork', 'bootstrap-coder.md')
    if (fs.existsSync(agentPath)) {
      const fullContent = fs.readFileSync(agentPath, 'utf8')
      const { content } = extractAndStripFrontmatter(fullContent)
      agentContent = content
    }
  }

  const bodyContent = usingSkMlFallback
    ? universalContent
    : [universalContent, agentContent].filter(Boolean).join('\n\n')

  const bootstrap = `<EXTREMELY_IMPORTANT>
You have groundwork workflow skills.

**IMPORTANT: The use-groundwork skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "use-groundwork" again.**

${bodyContent}
</EXTREMELY_IMPORTANT>`

  bootstrapContentCache.set(cacheKey, bootstrap)
  return bootstrap
}

function getBootstrapContent() {
  return getBootstrapForAgent('orchestrator')
}

function extractMessages(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.data)) return result.data
  if (Array.isArray(result?.data?.messages)) return result.data.messages
  if (Array.isArray(result?.messages)) return result.messages
  return []
}

// ─── Handoff helpers ──────────────────────────────────────────────────────────

const FILE_REGEX = /(?:^|[\s(])@(\.{0,2}\/[^\s,;)"'`]+|[a-zA-Z][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9._-]+){1,}(?:\.[a-zA-Z0-9]+))/g

function parseFileReferences(text) {
  const fileRefs = new Set()
  for (const match of text.matchAll(FILE_REGEX)) {
    if (match[1]) fileRefs.add(match[1])
  }
  return fileRefs
}

function isBinaryBuffer(buffer) {
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    const byte = buffer[i]
    if (byte === 0) return true
    if (byte < 0x07) return true
    if (byte > 0x0d && byte < 0x20) return true
  }
  return false
}

async function buildSyntheticFileParts(directory, refs) {
  const parts = []
  for (const ref of refs) {
    const filepath = path.resolve(directory, ref)
    try {
      const stats = await fsPromises.stat(filepath)
      if (!stats.isFile()) continue
      const buffer = await fsPromises.readFile(filepath)
      if (isBinaryBuffer(buffer)) continue
      const content = buffer.toString('utf-8')
      const lines = content.split('\n')
      const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
      parts.push({ type: 'text', synthetic: true, text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: filepath })}` })
      parts.push({ type: 'text', synthetic: true, text: `<path>${filepath}</path>\n<type>file</type>\n<content>\n${numbered}\n</content>` })
    } catch {}
  }
  return parts
}

function formatTranscript(messages, limit) {
  const lines = []
  for (const msg of messages) {
    if (msg.info.role === 'user') {
      lines.push('## User')
      for (const part of msg.parts) {
        if (part.type === 'text' && !part.ignored) lines.push(part.text)
        if (part.type === 'file') lines.push(`[Attached: ${part.filename || 'file'}]`)
      }
      lines.push('')
    }
    if (msg.info.role === 'assistant') {
      lines.push('## Assistant')
      for (const part of msg.parts) {
        if (part.type === 'text') lines.push(part.text)
        if (part.type === 'tool' && part.state?.status === 'completed') lines.push(`[Tool: ${part.tool}] ${part.state.title}`)
      }
      lines.push('')
    }
  }
  const output = lines.join('\n').trim()
  if (messages.length >= (limit ?? 100)) return output + `\n\n(Showing ${messages.length} most recent messages. Use a higher 'limit' to see more.)`
  return output + `\n\n(End of session - ${messages.length} messages)`
}

const HANDOFF_COMMAND = `GOAL: You are creating a handoff message to continue work in a new session.

When an AI assistant starts a fresh session, it spends significant time exploring the codebase before it can begin actual work. A good handoff frontloads everything the next session needs so it can start implementing immediately.

Analyze this conversation and extract what matters for continuing the work.

1. Identify all relevant files that should be loaded into the next session's context. Include files that will be edited, dependencies being touched, relevant tests, configs, and key reference docs. Target 8-15 files, up to 20 for complex work.

2. Draft the context and goal description. Describe what we're working on and provide whatever context helps continue the work. Preserve decisions, constraints, user preferences, technical patterns. Exclude conversation back-and-forth, dead ends, meta-commentary.

USER: $ARGUMENTS

---

After generating the handoff message, IMMEDIATELY call handoff_session with your prompt and files:
\`handoff_session(prompt="...", files=["src/foo.ts", "src/bar.ts", ...])\``

// ─── Plugin export ────────────────────────────────────────────────────────────

const handoffProcessedSessions = new Set()

export const GroundworkPlugin = async ({ client, directory }) => {
  return {
    config: async (config) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      if (!config.skills.paths.includes(groundworkSkillsDir)) {
        config.skills.paths.push(groundworkSkillsDir)
      }
      config.command = config.command || {}
      config.command['handoff'] = {
        description: 'Create a focused handoff prompt for a new session',
        template: HANDOFF_COMMAND,
      }

      // Hardcoded permission model based on agent role
      // pi-subagents frontmatter parser is FLAT only — nested permission blocks are ignored
      const AGENT_PERMISSIONS = {
        orchestrator: {
          task: {
            orchestrator: 'deny',
          },
          bash: {
            'git reset --hard *': 'deny',
            'sudo *': 'deny',
          },
        },
        coder: {
          question: 'deny',
          task: {
            '*': 'deny',
            advisor: 'allow',
            explore: 'allow',
          },
          'background*': 'deny',
          bash: {
            'git reset --hard *': 'deny',
            'sudo *': 'deny',
          },
        },
        advisor: {
          question: 'deny',
          task: {
            '*': 'deny',
            explore: 'allow',
          },
          'background*': 'deny',
          bash: {
            'sudo *': 'deny',
          },
        },
        designer: {
          question: 'deny',
          task: {
            '*': 'deny',
            explore: 'allow',
          },
          'background*': 'deny',
          bash: {
            'sudo *': 'deny',
          },
        },
      }

      function getAgentPermissions(agentName) {
        const n = (agentName || '').trim().toLowerCase()
        // Check for orchestrator aliases
        if (n === 'orchestrator' || n === 'general-purpose' || n === 'general_purpose' || n === 'default') {
          return AGENT_PERMISSIONS.orchestrator
        }
        return AGENT_PERMISSIONS[n]
      }

      // Register agent configs from agents/ directory with alias support
      config.agent = config.agent || {}
      const groundworkAgentsDir = path.resolve(__dirname, '../../agents-opencode')
      const ORCHESTRATOR_AGENT_ALIASES = ['general-purpose', 'general_purpose', 'default']
      const AGENT_DEFAULTS = {
        advisor: { temperature: 0.1 },
        coder: { temperature: 0.2 },
        designer: { temperature: 0.7 },
      }
      if (fs.existsSync(groundworkAgentsDir)) {
        const agentFiles = fs.readdirSync(groundworkAgentsDir).filter((f) => f.endsWith('.md'))
        // Names backed by their own dedicated agent file must NOT be clobbered by the
        // orchestrator's alias registration. Otherwise the orchestrator's model leaks
        // onto e.g. general-purpose, which intentionally omits `model` to inherit the
        // session model.
        const dedicatedNames = new Set(agentFiles.map((f) => path.basename(f, '.md')))
        const orchestratorAliases = ORCHESTRATOR_AGENT_ALIASES.filter((a) => !dedicatedNames.has(a))
        for (const file of agentFiles) {
          const agentFilePath = path.join(groundworkAgentsDir, file)
          const raw = fs.readFileSync(agentFilePath, 'utf8')
          const { frontmatter, content } = extractAndStripFrontmatter(raw)
          const name = frontmatter.name || path.basename(file, '.md')
          const names = name === 'orchestrator'
            ? [name, ...orchestratorAliases]
            : [name]
          for (const registeredName of names) {
            if (config.agent[registeredName]?.disable) continue
            config.agent[registeredName] = config.agent[registeredName] || {}
            if (frontmatter.description && !config.agent[registeredName].description) {
              config.agent[registeredName].description = frontmatter.description
            }
            if (frontmatter.model && config.agent[registeredName].model === undefined) {
              config.agent[registeredName].model = frontmatter.model
            }
            if (!config.agent[registeredName].prompt) {
              config.agent[registeredName].prompt = content.trim()
            }
            const defaults = AGENT_DEFAULTS[registeredName] || AGENT_DEFAULTS[name]
            if (defaults?.temperature !== undefined && config.agent[registeredName].temperature === undefined) {
              config.agent[registeredName].temperature = defaults.temperature
            }
            // Apply hardcoded permissions based on agent role
            const rolePermissions = getAgentPermissions(registeredName)
            if (rolePermissions) {
              config.agent[registeredName].permission = config.agent[registeredName].permission || {}
              // Deep merge: explicit config wins, then role permissions fill in
              for (const [key, value] of Object.entries(rolePermissions)) {
                if (config.agent[registeredName].permission[key] === undefined) {
                  config.agent[registeredName].permission[key] = value
                } else if (typeof config.agent[registeredName].permission[key] === 'object' && config.agent[registeredName].permission[key] !== null && typeof value === 'object' && value !== null) {
                  for (const [subKey, subValue] of Object.entries(value)) {
                    if (config.agent[registeredName].permission[key][subKey] === undefined) {
                      config.agent[registeredName].permission[key][subKey] = subValue
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    'tool.execute.before': async (input, output) => {
      // Bash sudo blocking — engine-level hard enforcement
      if (input.tool === 'bash' || input.tool === 'Bash') {
        const cmd = output.args?.command || ''
        if (/\bsudo\b/.test(cmd)) {
          throw new Error('sudo is blocked by plugin policy. Use a non-privileged approach or ask the user.')
        }
      }
      if (input.tool === 'task' || input.tool === 'Task') {
        if (output.args?.subagent_type) {
          // Don't force background for advisor — orchestrator needs synchronous APPROVE/GAPS response
          if (output.args.subagent_type === 'advisor') return
          if (output.args.background !== true) {
            output.args.background = true
          }
        }
      }
      if (input.tool === 'question' || input.tool === 'Question') {
        try {
          const gateFile = path.join(process.cwd(), '.groundwork', 'gate-approved')
          await fs.promises.access(gateFile)
          // Gate file exists — allow without warning
        } catch {
          // Gate file missing — inject warning into question content
          if (output.args?.questions && Array.isArray(output.args.questions)) {
            for (const q of output.args.questions) {
              if (q.question) {
                q.question = '⚠️ ADVISOR GATE NOT PASSED — You must invoke advisor-gate and receive APPROVE before presenting results to the user.\n\n' + q.question
              }
            }
          }
        }
      }
    },

    'tool.execute.after': async (input, output) => {
      if (input.tool !== 'task' || output.args?.subagent_type !== 'advisor') return
      try {
        const resultText = JSON.stringify(output.result || output.output || '').toLowerCase()
        const gateDir = path.join(process.cwd(), '.groundwork')
        const gateFile = path.join(gateDir, 'gate-approved')
        if (resultText.includes('approve')) {
          await fs.promises.mkdir(gateDir, { recursive: true })
          await fs.promises.writeFile(gateFile, new Date().toISOString())
        } else if (resultText.includes('gaps') || resultText.includes('correction') || resultText.includes('stop')) {
          try { await fs.promises.unlink(gateFile) } catch {}
        }
      } catch (e) { /* fail silently — gate enforcement is best-effort */ }
    },

    'experimental.chat.messages.transform': async (_input, output) => {
      const firstUser = output.messages.find(m => m.info.role === 'user')
      const agent = firstUser?.info?.agent
      const bootstrap = agent ? getBootstrapForAgent(agent) : getBootstrapContent()

      // Bootstrap (skills) injection — existing behavior preserved
      if (bootstrap && output.messages.length && firstUser && firstUser.parts.length) {
        if (!firstUser.parts.some(p => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'))) {
          const ref = firstUser.parts[0]
          firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap })
        }
      }

      // Active-goal reminder — append <ACTIVE_GOAL> to the LAST user message.
      // Best-effort: never break chat if goal read/inject fails.
      try {
        const sessionID = _input?.sessionID ?? output?.sessionID ?? output.messages.find(m => m.info?.sessionID)?.info?.sessionID
        if (sessionID) {
          const goal = readGoal(directory, sessionID)
          if (goal && goal.status === 'active') {
            const reminder = goalReminder(goal)
            const lastUser = output.messages.filter(m => m.info.role === 'user').pop()
            if (lastUser && Array.isArray(lastUser.parts) && lastUser.parts.length && !lastUser.parts.some(p => p.type === 'text' && p.text.includes('ACTIVE_GOAL'))) {
              lastUser.parts.push({ type: 'text', text: reminder, synthetic: true })
            }
          }
        }
      } catch { /* best-effort goal injection */ }
    },

    tool: {
      handoff_session: tool({
        description: 'Create a new session with the handoff prompt as an editable draft. Called after /handoff command generates the summary.',
        args: {
          prompt: z.string().describe('The generated handoff prompt'),
          files: z.array(z.string()).optional().describe('Array of file paths to load into the new session context'),
        },
        async execute(args, context) {
          const sessionReference = `Continuing work from session ${context.sessionID}. When you lack specific information you can use read_session to get it.`
          const fileRefs = args.files?.length
            ? args.files.map(f => `@${f.replace(/^@/, '')}`).join(' ')
            : ''
          const fullPrompt = fileRefs
            ? `${sessionReference}\n\n${fileRefs}\n\n${args.prompt}`
            : `${sessionReference}\n\n${args.prompt}`
          await client.tui.executeCommand({ body: { command: 'session_new' } })
          await new Promise(r => setTimeout(r, 150))
          await client.tui.appendPrompt({ body: { text: fullPrompt } })
          await client.tui.showToast({
            body: { title: 'Handoff Ready', message: 'Review and edit the draft, then send', variant: 'success', duration: 4000 }
          })
          return 'Handoff prompt created in new session. Review and edit before sending.'
        }
      }),

      read_session: tool({
        description: 'Read the conversation transcript from a previous session. Use when you need specific information from the source session not in the handoff summary.',
        args: {
          sessionID: z.string().describe('The full session ID (e.g., sess_01jxyz...)'),
          limit: z.number().optional().describe('Maximum number of messages to read (defaults to 100, max 500)'),
        },
        async execute(args) {
          const limit = Math.min(args.limit ?? 100, 500)
          try {
            const response = await client.session.messages({
              path: { id: args.sessionID },
              query: { limit }
            })
            const messages = extractMessages(response)
            if (!messages.length) return 'Session has no messages or does not exist.'
            return formatTranscript(messages, limit)
          } catch (error) {
            return `Could not read session ${args.sessionID}: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        }
      }),

      // set_goal — inlined (mirrors src/tools/set-goal.ts) because src/tools/* cannot
      // resolve @opencode-ai/plugin at runtime (it lives under .opencode/node_modules).
      set_goal: tool({
        description: 'Manage the active session goal. Set a new goal, check status, pause, resume, mark achieved, or clear. The goal is scoped to the current session and is injected into every message as a reminder.',
        args: {
          action: z.enum(['set', 'status', 'pause', 'resume', 'achieved', 'clear']).describe('Action to perform: set (create/replace goal), status (read current), pause, resume, achieved (mark done), clear (delete)'),
          objective: z.string().optional().describe('Goal objective text (required for "set" action)'),
          acceptanceCriteria: z.array(z.string()).optional().describe('List of verifiable acceptance criteria (required for "set" action)'),
        },
        async execute(args, context) {
          const { action, objective, acceptanceCriteria } = args
          const sessionID = context?.sessionID
          if (!sessionID) return 'Error: No session ID available. Cannot manage goal.'

          switch (action) {
            case 'status': {
              const goal = readGoal(directory, sessionID)
              if (!goal) return 'No active goal set.'
              const criteria = goal.acceptanceCriteria.map((c, i) => `  ${i + 1}. [ ] ${c}`).join('\n')
              return `Goal: ${goal.objective}\nStatus: ${goal.status}\nCreated: ${goal.createdAt}\nUpdated: ${goal.updatedAt}\nAcceptance Criteria:\n${criteria}`
            }
            case 'set': {
              if (!objective || !acceptanceCriteria?.length) return 'Error: "objective" and "acceptanceCriteria" are required for the "set" action.'
              const existing = readGoal(directory, sessionID)
              if (existing?.status === 'active') return `Error: An active goal already exists: "${existing.objective}". Clear it first with action "clear", or mark it "achieved".`
              const goal = { objective, acceptanceCriteria, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              writeGoal(directory, sessionID, goal)
              return `Goal set: "${objective}"\nAcceptance Criteria:\n${acceptanceCriteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n\nThis goal will be injected into every message as a reminder. It is scoped to the current session.`
            }
            case 'pause': {
              const goal = readGoal(directory, sessionID)
              if (!goal) return 'No active goal to pause.'
              if (goal.status !== 'active') return `Goal is already ${goal.status}.`
              goal.status = 'paused'
              writeGoal(directory, sessionID, goal)
              return `Goal paused: "${goal.objective}"`
            }
            case 'resume': {
              const goal = readGoal(directory, sessionID)
              if (!goal) return 'No goal to resume.'
              if (goal.status !== 'paused') return `Goal is ${goal.status}, not paused.`
              goal.status = 'active'
              writeGoal(directory, sessionID, goal)
              return `Goal resumed: "${goal.objective}"`
            }
            case 'achieved': {
              const goal = readGoal(directory, sessionID)
              if (!goal) return 'No goal to mark as achieved.'
              goal.status = 'achieved'
              writeGoal(directory, sessionID, goal)
              return `Goal marked as achieved: "${goal.objective}"\nClear it with action "clear" when ready.`
            }
            case 'clear': {
              const removed = clearGoal(directory, sessionID)
              return removed ? 'Goal cleared.' : 'No goal to clear.'
            }
            default:
              return `Unknown action: ${action}`
          }
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type === 'session.deleted') {
        handoffProcessedSessions.delete(event.properties?.info?.id)
      }
    },

    'chat.message': async (_input, output) => {
      const sessionID = output.message.sessionID ?? _input.sessionID
      if (handoffProcessedSessions.has(sessionID)) return
      const text = output.parts
        .filter(p => p.type === 'text' && !p.synthetic && typeof p.text === 'string')
        .map(p => p.text)
        .join('\n')
      if (!text.includes('Continuing work from session')) return
      handoffProcessedSessions.add(sessionID)
      const fileRefs = parseFileReferences(text)
      if (fileRefs.size === 0) return
      const fileParts = await buildSyntheticFileParts(directory, fileRefs)
      if (fileParts.length === 0) return
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          model: output.message.model,
          agent: output.message.agent,
          parts: fileParts,
        },
      })
    },
  }
}

export default GroundworkPlugin
