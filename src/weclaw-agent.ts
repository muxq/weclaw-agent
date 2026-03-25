/// <reference types="node" />

import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBot, type BotMessage } from './bot-adapter.js'

type ChatRole = 'system' | 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  content: string
}

type LongMemory = {
  summary: string
  profileNotes: string[]
  preferences: string[]
  activeTasks: string[]
  updatedAt: string | null
}

type MemoryCategory = 'profileNotes' | 'preferences' | 'activeTasks'

type SkillContext = {
  userId: string
}

type Skill = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (input: Record<string, unknown>, context: SkillContext) => Promise<string>
}

type FinalEnvelope = {
  type: 'final'
  reply: string
}

type ToolCallEnvelope = {
  type: 'tool_call'
  tool: string
  arguments?: Record<string, unknown>
}

type ModelEnvelope = FinalEnvelope | ToolCallEnvelope

type ConversationState = {
  history: ChatMessage[]
  turnsSinceCompression: number
  lastCompressedAt: string | null
}

type CompressionEnvelope = {
  summary: string
  profileNotes: string[]
  preferences: string[]
  activeTasks: string[]
}

type ProcessPermission = {
  description: string
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
}

type AgentConfig = {
  model: {
    name: string
    temperature: number
  }
  agent: {
    systemPrompt: string
    maxHistoryMessages: number
    maxToolSteps: number
  }
  permissions: {
    enabledSkills: string[]
    allowedRoots: string[]
    maxFileBytes: number
    writableExtensions: string[]
  }
  memory: {
    enabled: boolean
    directory: string
    contextDirectory: string
    categories: MemoryCategory[]
    maxItemsPerCategory: number
    compressionIntervalTurns: number
    compressionKeepRecentMessages: number
  }
  process: {
    commands: Record<string, ProcessPermission>
  }
}

const bot = await createBot()
const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDir, '..')
const runtimeEnv = process.env

const defaultConfigPath = resolve(scriptDir, 'agent-config.json')

const defaultAgentConfig: AgentConfig = {
  model: {
    name: 'glm-4-flash',
    temperature: 0.2,
  },
  agent: {
    systemPrompt: '你是一个微信聊天助手，同时也是一个会调用本地 skills 的 Agent。所有回复保持温柔、自然、简洁、直接。',
    maxHistoryMessages: 12,
    maxToolSteps: 6,
  },
  permissions: {
    enabledSkills: ['list_files', 'read_file', 'write_file', 'run_process', 'remember_note'],
    allowedRoots: ['.'],
    maxFileBytes: 64 * 1024,
    writableExtensions: ['.md', '.txt', '.json', '.ts', '.js', '.py', '.yaml', '.yml'],
  },
  memory: {
    enabled: true,
    directory: '.agent-data/memory',
    contextDirectory: '.agent-data/context',
    categories: ['profileNotes', 'preferences', 'activeTasks'],
    maxItemsPerCategory: 12,
    compressionIntervalTurns: 8,
    compressionKeepRecentMessages: 4,
  },
  process: {
    commands: {
      nodejs_build: {
        description: 'Build this agent project',
        command: 'npm',
        args: ['run', 'build'],
        cwd: '.',
        timeoutMs: 30_000,
      },
      git_status: {
        description: 'Show short git status',
        command: 'git',
        args: ['status', '--short'],
        cwd: '.',
        timeoutMs: 15_000,
      },
    },
  },
}

function resolveConfiguredPath(inputPath: string): string {
  return isAbsolute(inputPath) ? resolve(inputPath) : resolve(workspaceRoot, inputPath)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isMemoryCategoryArray(value: unknown): value is MemoryCategory[] {
  return Array.isArray(value) && value.every((item) => item === 'profileNotes' || item === 'preferences' || item === 'activeTasks')
}

function normalizeProcessPermissions(rawCommands: unknown): Record<string, ProcessPermission> {
  if (!rawCommands || typeof rawCommands !== 'object') {
    return defaultAgentConfig.process.commands
  }

  const entries = Object.entries(rawCommands as Record<string, unknown>)
  const normalizedEntries = entries.flatMap(([commandId, value]) => {
    if (!value || typeof value !== 'object') {
      return []
    }

    const rawCommand = value as Partial<ProcessPermission>
    if (typeof rawCommand.command !== 'string' || !rawCommand.command.trim()) {
      return []
    }

    return [[
      commandId,
      {
        description: typeof rawCommand.description === 'string' && rawCommand.description.trim()
          ? rawCommand.description
          : commandId,
        command: rawCommand.command,
        args: isStringArray(rawCommand.args) ? rawCommand.args : [],
        cwd: typeof rawCommand.cwd === 'string' && rawCommand.cwd.trim() ? rawCommand.cwd : '.',
        timeoutMs: typeof rawCommand.timeoutMs === 'number' && Number.isFinite(rawCommand.timeoutMs)
          ? rawCommand.timeoutMs
          : 15_000,
      } satisfies ProcessPermission,
    ]]
  })

  return normalizedEntries.length > 0
    ? Object.fromEntries(normalizedEntries)
    : {}
}

async function loadAgentConfig(): Promise<AgentConfig> {
  const configPath = runtimeEnv.AGENT_CONFIG_PATH
    ? resolveConfiguredPath(runtimeEnv.AGENT_CONFIG_PATH)
    : defaultConfigPath

  try {
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Partial<AgentConfig>

    return {
      model: {
        name: typeof raw.model?.name === 'string' && raw.model.name.trim() ? raw.model.name : defaultAgentConfig.model.name,
        temperature: typeof raw.model?.temperature === 'number' && Number.isFinite(raw.model.temperature)
          ? raw.model.temperature
          : defaultAgentConfig.model.temperature,
      },
      agent: {
        systemPrompt: typeof raw.agent?.systemPrompt === 'string' && raw.agent.systemPrompt.trim()
          ? raw.agent.systemPrompt
          : defaultAgentConfig.agent.systemPrompt,
        maxHistoryMessages: typeof raw.agent?.maxHistoryMessages === 'number' && raw.agent.maxHistoryMessages > 0
          ? raw.agent.maxHistoryMessages
          : defaultAgentConfig.agent.maxHistoryMessages,
        maxToolSteps: typeof raw.agent?.maxToolSteps === 'number' && raw.agent.maxToolSteps > 0
          ? raw.agent.maxToolSteps
          : defaultAgentConfig.agent.maxToolSteps,
      },
      permissions: {
        enabledSkills: isStringArray(raw.permissions?.enabledSkills)
          ? raw.permissions.enabledSkills
          : defaultAgentConfig.permissions.enabledSkills,
        allowedRoots: isStringArray(raw.permissions?.allowedRoots) && raw.permissions.allowedRoots.length > 0
          ? raw.permissions.allowedRoots
          : defaultAgentConfig.permissions.allowedRoots,
        maxFileBytes: typeof raw.permissions?.maxFileBytes === 'number' && raw.permissions.maxFileBytes > 0
          ? raw.permissions.maxFileBytes
          : defaultAgentConfig.permissions.maxFileBytes,
        writableExtensions: isStringArray(raw.permissions?.writableExtensions)
          ? raw.permissions.writableExtensions
          : defaultAgentConfig.permissions.writableExtensions,
      },
      memory: {
        enabled: typeof raw.memory?.enabled === 'boolean' ? raw.memory.enabled : defaultAgentConfig.memory.enabled,
        directory: typeof raw.memory?.directory === 'string' && raw.memory.directory.trim()
          ? raw.memory.directory
          : defaultAgentConfig.memory.directory,
        contextDirectory: typeof raw.memory?.contextDirectory === 'string' && raw.memory.contextDirectory.trim()
          ? raw.memory.contextDirectory
          : defaultAgentConfig.memory.contextDirectory,
        categories: isMemoryCategoryArray(raw.memory?.categories) && raw.memory.categories.length > 0
          ? raw.memory.categories
          : defaultAgentConfig.memory.categories,
        maxItemsPerCategory: typeof raw.memory?.maxItemsPerCategory === 'number' && raw.memory.maxItemsPerCategory > 0
          ? raw.memory.maxItemsPerCategory
          : defaultAgentConfig.memory.maxItemsPerCategory,
        compressionIntervalTurns: typeof raw.memory?.compressionIntervalTurns === 'number' && raw.memory.compressionIntervalTurns > 0
          ? raw.memory.compressionIntervalTurns
          : defaultAgentConfig.memory.compressionIntervalTurns,
        compressionKeepRecentMessages: typeof raw.memory?.compressionKeepRecentMessages === 'number' && raw.memory.compressionKeepRecentMessages >= 0
          ? raw.memory.compressionKeepRecentMessages
          : defaultAgentConfig.memory.compressionKeepRecentMessages,
      },
      process: {
        commands: normalizeProcessPermissions(raw.process?.commands),
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultAgentConfig
    }

    throw error
  }
}

const agentConfig = await loadAgentConfig()
const memoryDir = resolveConfiguredPath(agentConfig.memory.directory)
const contextDir = resolveConfiguredPath(agentConfig.memory.contextDirectory)
const maxFileBytes = agentConfig.permissions.maxFileBytes
const maxHistoryMessages = agentConfig.agent.maxHistoryMessages
const maxToolSteps = agentConfig.agent.maxToolSteps
const writableExtensions = new Set(agentConfig.permissions.writableExtensions.map((extension) => extension.toLowerCase()))
const enabledSkills = new Set(agentConfig.permissions.enabledSkills)
const allowedRootPaths = agentConfig.permissions.allowedRoots.map(resolveConfiguredPath)

const apiKey = runtimeEnv.ZHIPU_API_KEY

if (!apiKey) {
  throw new Error('Missing ZHIPU_API_KEY')
}

const conversationStateByUser = new Map<string, ConversationState>()
const allowedProcesses = Object.fromEntries(
  Object.entries(agentConfig.process.commands).map(([commandId, command]) => [
    commandId,
    {
      ...command,
      cwd: resolveConfiguredPath(command.cwd),
    },
  ]),
)

function createEmptyMemory(): LongMemory {
  return {
    summary: '',
    profileNotes: [],
    preferences: [],
    activeTasks: [],
    updatedAt: null,
  }
}

function createEmptyConversationState(): ConversationState {
  return {
    history: [],
    turnsSinceCompression: 0,
    lastCompressedAt: null,
  }
}

function getUserMemoryPath(userId: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return resolve(memoryDir, `${safeUserId}.json`)
}

function getConversationStatePath(userId: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return resolve(contextDir, `${safeUserId}.json`)
}

async function ensureDataDirs(): Promise<void> {
  await mkdir(contextDir, { recursive: true })

  if (!agentConfig.memory.enabled) {
    return
  }

  await mkdir(memoryDir, { recursive: true })
}

async function loadLongMemory(userId: string): Promise<LongMemory> {
  if (!agentConfig.memory.enabled) {
    return createEmptyMemory()
  }

  const memoryPath = getUserMemoryPath(userId)

  try {
    const content = await readFile(memoryPath, 'utf8')
    const parsed = JSON.parse(content) as Partial<LongMemory>
    return {
      summary: parsed.summary ?? '',
      profileNotes: parsed.profileNotes ?? [],
      preferences: parsed.preferences ?? [],
      activeTasks: parsed.activeTasks ?? [],
      updatedAt: parsed.updatedAt ?? null,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyMemory()
    }

    throw error
  }
}

async function saveLongMemory(userId: string, memory: LongMemory): Promise<void> {
  await ensureDataDirs()
  await writeFile(getUserMemoryPath(userId), JSON.stringify(memory, null, 2), 'utf8')
}

async function loadConversationState(userId: string): Promise<ConversationState> {
  const cached = conversationStateByUser.get(userId)
  if (cached) {
    return cached
  }

  const statePath = getConversationStatePath(userId)

  try {
    const content = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(content) as Partial<ConversationState>
    const state: ConversationState = {
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((item): item is ChatMessage => (
          !!item &&
          typeof item === 'object' &&
          (item as ChatMessage).role !== undefined &&
          typeof (item as ChatMessage).content === 'string'
        ))
        : [],
      turnsSinceCompression: typeof parsed.turnsSinceCompression === 'number' ? parsed.turnsSinceCompression : 0,
      lastCompressedAt: typeof parsed.lastCompressedAt === 'string' ? parsed.lastCompressedAt : null,
    }

    conversationStateByUser.set(userId, state)
    return state
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const state = createEmptyConversationState()
      conversationStateByUser.set(userId, state)
      return state
    }

    throw error
  }
}

async function saveConversationState(userId: string, state: ConversationState): Promise<void> {
  await ensureDataDirs()
  conversationStateByUser.set(userId, state)
  await writeFile(getConversationStatePath(userId), JSON.stringify(state, null, 2), 'utf8')
}

async function appendMemoryItem(userId: string, category: MemoryCategory, content: string): Promise<string> {
  if (!agentConfig.memory.enabled) {
    throw new Error('Long-term memory is disabled by configuration.')
  }
  if (!agentConfig.memory.categories.includes(category)) {
    throw new Error(`Memory category ${category} is disabled by configuration.`)
  }

  const memory = await loadLongMemory(userId)
  const cleanedContent = content.trim()

  if (!cleanedContent) {
    throw new Error('Memory content cannot be empty.')
  }

  const currentValues = memory[category]
  const nextValues = [cleanedContent, ...currentValues.filter((item) => item !== cleanedContent)]
    .slice(0, agentConfig.memory.maxItemsPerCategory)
  memory[category] = nextValues
  memory.updatedAt = new Date().toISOString()
  await saveLongMemory(userId, memory)
  return `Saved memory in ${category}: ${cleanedContent}`
}

function formatLongMemory(memory: LongMemory): string {
  const lines: string[] = []

  if (memory.summary.trim()) {
    lines.push(`Summary: ${memory.summary}`)
  }

  if (memory.profileNotes.length > 0) {
    lines.push(`Profile notes: ${memory.profileNotes.join(' | ')}`)
  }
  if (memory.preferences.length > 0) {
    lines.push(`Preferences: ${memory.preferences.join(' | ')}`)
  }
  if (memory.activeTasks.length > 0) {
    lines.push(`Active tasks: ${memory.activeTasks.join(' | ')}`)
  }

  return lines.length > 0 ? lines.join('\n') : 'No long-term memory saved yet.'
}

function mergeUniqueItems(currentItems: string[], incomingItems: string[], limit: number): string[] {
  return [...currentItems, ...incomingItems]
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
    .slice(-limit)
}

function trimHistory(history: ChatMessage[], limit = maxHistoryMessages): ChatMessage[] {
  return history.length > limit ? history.slice(-limit) : history
}

function resolveWorkspacePath(inputPath: string): string {
  const fullPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(workspaceRoot, inputPath)
  const isAllowed = allowedRootPaths.some((allowedRootPath) => {
    const relativePath = relative(allowedRootPath, fullPath)
    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  })

  if (!isAllowed) {
    throw new Error('Path is outside the configured allowed roots.')
  }

  return fullPath
}

async function listWorkspaceFiles(input: Record<string, unknown>): Promise<string> {
  const requestedPath = typeof input.path === 'string' && input.path.trim() ? input.path : '.'
  const fullPath = resolveWorkspacePath(requestedPath)
  const entries = await readdir(fullPath, { withFileTypes: true })
  const formatted = entries
    .slice(0, 100)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))

  return formatted.length > 0 ? formatted.join('\n') : '(empty directory)'
}

async function readWorkspaceFile(input: Record<string, unknown>): Promise<string> {
  const requestedPath = typeof input.path === 'string' ? input.path : ''
  if (!requestedPath.trim()) {
    throw new Error('read_file requires a path string.')
  }

  const fullPath = resolveWorkspacePath(requestedPath)
  const fileStat = await stat(fullPath)
  if (!fileStat.isFile()) {
    throw new Error('Path is not a file.')
  }
  if (fileStat.size > maxFileBytes) {
    throw new Error(`File exceeds ${maxFileBytes} bytes.`)
  }

  return await readFile(fullPath, 'utf8')
}

async function writeWorkspaceFile(input: Record<string, unknown>): Promise<string> {
  const requestedPath = typeof input.path === 'string' ? input.path : ''
  const content = typeof input.content === 'string' ? input.content : ''

  if (!requestedPath.trim()) {
    throw new Error('write_file requires a path string.')
  }
  if (!content.trim()) {
    throw new Error('write_file requires non-empty content.')
  }

  const extension = extname(requestedPath).toLowerCase()
  if (!writableExtensions.has(extension)) {
    throw new Error(`Writing ${extension || 'extensionless'} files is not allowed.`)
  }

  const fullPath = resolveWorkspacePath(requestedPath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content, 'utf8')
  return `Wrote ${content.length} characters to ${requestedPath}`
}

async function runAllowedProcess(input: Record<string, unknown>): Promise<string> {
  const commandId = typeof input.commandId === 'string' ? input.commandId : ''
  const selectedProcess = allowedProcesses[commandId]

  if (!selectedProcess) {
    throw new Error(`Unknown commandId: ${commandId}`)
  }

  return await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(selectedProcess.command, selectedProcess.args, {
      cwd: selectedProcess.cwd,
      shell: false,
      timeout: selectedProcess.timeoutMs,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise((stdout || 'ok').slice(0, 8_000))
        return
      }

      rejectPromise(new Error((stderr || stdout || `Process exited with code ${code}`).slice(0, 8_000)))
    })
  })
}

const allSkills: Record<string, Skill> = {
  list_files: {
    name: 'list_files',
    description: 'List files and folders inside the workspace or a subdirectory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory path. Defaults to root.' },
      },
    },
    async run(input) {
      return await listWorkspaceFiles(input)
    },
  },
  read_file: {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
      },
      required: ['path'],
    },
    async run(input) {
      return await readWorkspaceFile(input)
    },
  },
  write_file: {
    name: 'write_file',
    description: 'Write UTF-8 text content to an allowed file inside the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        content: { type: 'string', description: 'File content to write.' },
      },
      required: ['path', 'content'],
    },
    async run(input) {
      return await writeWorkspaceFile(input)
    },
  },
  run_process: {
    name: 'run_process',
    description: `Run one allowed local process by commandId. Allowed commandIds: ${Object.keys(allowedProcesses).join(', ') || '(none)'}.`,
    inputSchema: {
      type: 'object',
      properties: {
        commandId: { type: 'string', enum: Object.keys(allowedProcesses) },
      },
      required: ['commandId'],
    },
    async run(input) {
      return await runAllowedProcess(input)
    },
  },
  remember_note: {
    name: 'remember_note',
    description: 'Persist a long-term memory item for this user.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: agentConfig.memory.categories },
        content: { type: 'string' },
      },
      required: ['category', 'content'],
    },
    async run(input, context) {
      const category = input.category
      const content = input.content

      if (
        category !== 'profileNotes' &&
        category !== 'preferences' &&
        category !== 'activeTasks'
      ) {
        throw new Error('remember_note category must be profileNotes, preferences, or activeTasks.')
      }
      if (typeof content !== 'string') {
        throw new Error('remember_note content must be a string.')
      }

      return await appendMemoryItem(context.userId, category, content)
    },
  },
}

const skills = Object.fromEntries(
  Object.entries(allSkills).filter(([skillName]) => {
    if (!enabledSkills.has(skillName)) {
      return false
    }
    if (skillName === 'remember_note' && !agentConfig.memory.enabled) {
      return false
    }
    if (skillName === 'run_process' && Object.keys(allowedProcesses).length === 0) {
      return false
    }

    return true
  }),
) as Record<string, Skill>

function describeSkills(): string {
  if (Object.keys(skills).length === 0) {
    return 'No skills are enabled by configuration.'
  }

  return Object.values(skills)
    .map((skill) => `${skill.name}: ${skill.description}\nSchema: ${JSON.stringify(skill.inputSchema)}`)
    .join('\n\n')
}

function extractJsonBlock(text: string): string | null {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1] ?? text
  const startIndex = candidate.indexOf('{')
  const endIndex = candidate.lastIndexOf('}')

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null
  }

  return candidate.slice(startIndex, endIndex + 1)
}

function normalizeLooseJson(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/commandld/g, 'commandId')
    .replace(/commandID/g, 'commandId')
}

function parseLooseToolCall(text: string): ToolCallEnvelope | null {
  const normalizedText = normalizeLooseJson(text.trim())
  const toolCallMatch = normalizedText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(\{[\s\S]*\})$/)

  if (!toolCallMatch) {
    return null
  }

  const [, toolName, argsText] = toolCallMatch

  try {
    const parsedArgs = JSON.parse(argsText) as Record<string, unknown>
    return {
      type: 'tool_call',
      tool: toolName,
      arguments: parsedArgs,
    }
  } catch {
    return null
  }
}

function parseModelEnvelope(text: string): ModelEnvelope {
  const looseToolCall = parseLooseToolCall(text)
  if (looseToolCall) {
    return looseToolCall
  }

  const jsonBlock = extractJsonBlock(text)

  if (!jsonBlock) {
    return {
      type: 'final',
      reply: text.trim(),
    }
  }

  let parsed: Partial<ModelEnvelope>
  try {
    parsed = JSON.parse(normalizeLooseJson(jsonBlock)) as Partial<ModelEnvelope>
  } catch {
    return {
      type: 'final',
      reply: text.trim(),
    }
  }

  if (parsed.type === 'final' && typeof parsed.reply === 'string' && parsed.reply.trim()) {
    return {
      type: 'final',
      reply: parsed.reply.trim(),
    }
  }

  if (parsed.type === 'tool_call' && typeof parsed.tool === 'string') {
    return {
      type: 'tool_call',
      tool: parsed.tool,
      arguments: parsed.arguments ?? {},
    }
  }

  return {
    type: 'final',
    reply: text.trim(),
  }
}

function parseCompressionEnvelope(text: string): CompressionEnvelope {
  const jsonBlock = extractJsonBlock(text)

  if (!jsonBlock) {
    return {
      summary: text.trim(),
      profileNotes: [],
      preferences: [],
      activeTasks: [],
    }
  }

  try {
    const parsed = JSON.parse(normalizeLooseJson(jsonBlock)) as Partial<CompressionEnvelope>
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : text.trim(),
      profileNotes: isStringArray(parsed.profileNotes) ? parsed.profileNotes : [],
      preferences: isStringArray(parsed.preferences) ? parsed.preferences : [],
      activeTasks: isStringArray(parsed.activeTasks) ? parsed.activeTasks : [],
    }
  } catch {
    return {
      summary: text.trim(),
      profileNotes: [],
      preferences: [],
      activeTasks: [],
    }
  }
}

async function callModel(messages: ChatMessage[]): Promise<string> {
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: agentConfig.model.name,
      messages,
      temperature: agentConfig.model.temperature,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`BigModel API error: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }

  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('BigModel returned empty content')
  }

  return content
}

async function compressConversationContext(
  userId: string,
  state: ConversationState,
  longMemory: LongMemory,
): Promise<LongMemory> {
  if (!agentConfig.memory.enabled || state.history.length === 0) {
    return longMemory
  }

  const compressionPrompt: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是一个上下文压缩器。请根据给定的长期记忆和最近对话，提炼后续对话真正需要保留的关键信息。',
        '只输出 JSON，不要输出其他文字。',
        '格式为 {"summary":"...","profileNotes":[...],"preferences":[...],"activeTasks":[...]}。',
        'summary 应是简短但高信息密度的摘要。',
        '只保留稳定事实、偏好、正在推进的任务和高价值背景，不要重复寒暄。',
        `Existing long-term memory:\n${formatLongMemory(longMemory)}`,
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: `Recent conversation:\n${state.history.map((message) => `${message.role}: ${message.content}`).join('\n')}`,
    },
  ]

  const compressed = parseCompressionEnvelope(await callModel(compressionPrompt))

  const nextMemory: LongMemory = {
    summary: compressed.summary || longMemory.summary,
    profileNotes: mergeUniqueItems(longMemory.profileNotes, compressed.profileNotes, agentConfig.memory.maxItemsPerCategory),
    preferences: mergeUniqueItems(longMemory.preferences, compressed.preferences, agentConfig.memory.maxItemsPerCategory),
    activeTasks: mergeUniqueItems(longMemory.activeTasks, compressed.activeTasks, agentConfig.memory.maxItemsPerCategory),
    updatedAt: new Date().toISOString(),
  }

  await saveLongMemory(userId, nextMemory)

  state.history = trimHistory(state.history, agentConfig.memory.compressionKeepRecentMessages)
  state.turnsSinceCompression = 0
  state.lastCompressedAt = new Date().toISOString()
  await saveConversationState(userId, state)

  return nextMemory
}

async function askBigModel(userId: string, userText: string): Promise<string> {
  const longMemory = await loadLongMemory(userId)
  const conversationState = await loadConversationState(userId)
  conversationState.history = trimHistory([
    ...conversationState.history,
    {
      role: 'user',
      content: userText,
    },
  ])
  await saveConversationState(userId, conversationState)

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是一个微信聊天助手，同时也是一个会调用本地 skills 的 Agent。',
        agentConfig.agent.systemPrompt,
        '你的回复必须始终优先输出 JSON，不要输出 JSON 以外的任何文字。',
        '如果不需要调用工具，输出 {"type":"final","reply":"..."}。',
        '如果需要调用工具，输出 {"type":"tool_call","tool":"技能名","arguments":{...}}。',
        '当你收到 TOOL_RESULT 消息后，结合结果继续判断是否还要调用工具。',
        agentConfig.memory.enabled
          ? '如果用户提供了稳定偏好、长期身份信息或持续任务状态，优先调用 remember_note 保存。'
          : '长记忆功能当前已禁用。',
        `Available skills:\n${describeSkills()}`,
        `Allowed roots:\n${allowedRootPaths.join('\n')}`,
        `Long-term memory:\n${agentConfig.memory.enabled ? formatLongMemory(longMemory) : 'Long-term memory disabled by configuration.'}`,
      ].join('\n\n'),
    },
    ...conversationState.history,
  ]

  for (let step = 0; step < maxToolSteps; step += 1) {
    const rawOutput = await callModel(messages)
    const envelope = parseModelEnvelope(rawOutput)

    if (envelope.type === 'final') {
      conversationState.history = trimHistory([
        ...conversationState.history,
        { role: 'assistant', content: envelope.reply },
      ])
      conversationState.turnsSinceCompression += 1
      await saveConversationState(userId, conversationState)

      if (
        agentConfig.memory.enabled &&
        conversationState.turnsSinceCompression >= agentConfig.memory.compressionIntervalTurns
      ) {
        await compressConversationContext(userId, conversationState, longMemory)
      }

      return envelope.reply
    }

    const skill = skills[envelope.tool]
    const toolArgs = envelope.arguments ?? {}

    let toolResult: string
    if (!skill) {
      toolResult = `Tool not found: ${envelope.tool}`
    } else {
      try {
        toolResult = await skill.run(toolArgs, { userId })
      } catch (error) {
        toolResult = `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    messages.push({
      role: 'assistant',
      content: rawOutput,
    })
    messages.push({
      role: 'user',
      content: `TOOL_RESULT\nTool: ${envelope.tool}\nResult:\n${toolResult.slice(0, 8_000)}`,
    })
  }

  throw new Error('Too many tool-calling steps without a final answer.')
}

await bot.login()

bot.onMessage(async (msg: BotMessage) => {
  if (msg.type !== 'text' || !msg.text.trim()) {
    await bot.reply(msg, '目前只处理文本消息。')
    return
  }

  console.log(`[${msg.timestamp.toLocaleTimeString()}] ${msg.userId}: ${msg.text}`)

  try {
    await bot.sendTyping(msg.userId)
    const answer = await askBigModel(msg.userId, msg.text)
    await bot.reply(msg, answer)
  } catch (error) {
    console.error(error)
    await bot.reply(msg, '模型调用失败，请稍后再试。')
  }
})

console.log('Bot is running. Press Ctrl+C to stop.')
await bot.run()
