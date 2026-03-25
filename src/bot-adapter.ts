import { WeixinBot, type IncomingMessage } from '@pinixai/weixin-bot'

export type BotMessage = {
  type: IncomingMessage['type']
  text: string
  userId: string
  timestamp: Date
  raw: IncomingMessage
}

export type MessageHandler = (message: BotMessage) => Promise<void> | void

export interface BotClient {
  login(): Promise<void>
  onMessage(handler: MessageHandler): void
  reply(message: BotMessage, text: string): Promise<void>
  sendTyping(userId: string): Promise<void>
  run(): Promise<void>
}

type WeixinBotOptions = ConstructorParameters<typeof WeixinBot>[0]

function toWeixinBotOptions(): WeixinBotOptions {
  const options: WeixinBotOptions = {}
  const baseUrl = process.env.WECLAW_WEIXIN_BASE_URL?.trim()
  const tokenPath = process.env.WECLAW_WEIXIN_TOKEN_PATH?.trim()

  if (baseUrl) {
    options.baseUrl = baseUrl
  }

  if (tokenPath) {
    options.tokenPath = tokenPath
  }

  return options
}

async function createOfficialWeixinBot(): Promise<BotClient> {
  const sdkBot = new WeixinBot(toWeixinBotOptions())
  const forceLogin = process.env.WECLAW_WEIXIN_FORCE_LOGIN === '1'

  return {
    async login() {
      await sdkBot.login({ force: forceLogin })
    },
    onMessage(handler) {
      sdkBot.onMessage(async (message: IncomingMessage) => {
        await handler({
          type: message.type,
          text: message.text,
          userId: message.userId,
          timestamp: message.timestamp,
          raw: message,
        })
      })
    },
    async reply(message, text) {
      await sdkBot.reply(message.raw, text)
    },
    async sendTyping(userId) {
      await sdkBot.sendTyping(userId)
    },
    async run() {
      await sdkBot.run()
    },
  }
}

export async function createBot(): Promise<BotClient> {
  return await createOfficialWeixinBot()
}