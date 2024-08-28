process.setMaxListeners(0)
process.on('uncaughtException', console.warn)
import { serializeMessage, prototype } from './lib/helperMessage.js'

prototype()
serializeMessage()

import pino from 'pino'
import chalk from 'chalk'
import path from 'path'
import { createInterface } from 'readline'
import fs, { existsSync } from 'fs'

import {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys'

import * as Rehan from './rehan.js'

import Config from './config.js'
import Store from './lib/store.js'
import HelperConnection from './lib/simple.js'
import db, { loadDatabase } from './lib/database.js'

function patchMessageBeforeSending(message) {
  const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage)
  
  if (requiresPatch) {
    message = {
      viewOnceMessageV2: {
        message: {
          messageContextInfo: {
            deviceListMetadataVersion: 2,
            deviceListMetadata: {}
          },
          ...message
        }
      }
    }
  }
  
  return message
}

const rl = createInterface(process.stdin, process.stdout)
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

let interval
async function startSock() {
  if (db.data == null) await loadDatabase()
  const logger = pino({ level: 'silent' })
  const authState = await useMultiFileAuthState(Config.authFolder)
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

  const store = Store()
  store.readFromFile(Config.storeFolder)
  
  const connectionOptions = {
    version,
    logger,
    patchMessageBeforeSending,
    browser: Browsers.ubuntu('Chrome'),
    generateHighQualityLinkPreview: true,
    auth: {
      creds: authState.state.creds,
      keys: makeCacheableSignalKeyStore(authState.state.keys, logger.child({ stream: 'store' }))
    },
    getMessage: async (key) => {
      const msg = await store.loadMessage(key.remoteJid, key.id) || {}
      return msg?.message ?? {}
    }
  }

  const conn = HelperConnection(connectionOptions, { store })
  store.bind(conn)
  
  if (!conn?.authState?.creds?.me && !conn.authState.creds.registered) {
    console.clear()
    let number = await question(chalk.bgBlack(chalk.greenBright('Silahkan masukan Nomor WhatsApp Anda :\n> ')))
    number = number.replace(/[^0-9]/g, '') || ''
    if (number.startsWith('0')) number = number.replace('0', '62')
    const code = await conn.requestPairingCode(number)
    console.log(number)
    console.log(chalk.black(chalk.bgGreen('Pairing code kamu : ')), chalk.black(chalk.white(parse(code))))
  }
  
  conn.ev.on('connection.update', connectionUpdate.bind(conn))
  conn.ev.on('creds.update', authState.saveCreds.bind(conn))
  conn.ev.on('messages.upsert', Rehan.handler.bind(conn, store))
  conn.ev.on('messages.delete', Rehan.deleteMessage.bind(conn, store))
  // conn.ev.on('messages.update', Rehan.messagesUpdate.bind(conn))
  // conn.ev.on('presence.update', update => ())
  conn.ev.on('groups.update', update => Rehan.groupsUpdate(conn, store))
  conn.ev.on('group-participants.update', Rehan.participantsUpdate.bind(conn, store))
  
  if (interval) clearInterval(interval)
  interval = setInterval(() => store.writeToFile(Config.storeFolder), 10000)

  return conn
}

startSock()

// save database interval 30 detik
setInterval(() => {
  db.write()
  fs.readdir(Config.tmp, (err, files) => {
    if (err) throw err
    for (const file of files) {
      fs.unlink(path.join(Config.tmp, file), err => {
        if (err) throw err
      })
    }
  })
}, 30000)

async function connectionUpdate(update) {
  // @ts-ignore
  const { connection, lastDisconnect } = update
  const status = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode
  const statusMessage = lastDisconnect?.error?.output?.message || lastDisconnect?.error?.output?.payload?.message
  if (status) {
    Config.logger.warn(`\nstatus: ${status}\nmessage: ${statusMessage}\nreason: ${DisconnectReason[status]}`.trim())
    if (
      status !== DisconnectReason.loggedOut &&
      status !== DisconnectReason.connectionReplaced &&
      status !== DisconnectReason.multideviceMismatch &&
      status !== DisconnectReason.forbidden &&
      status !== DisconnectReason.badSession
    ) {
      Config.logger.info('Reloading..')
      await startSock()
    } else if (
      status == DisconnectReason.forbidden ||
      status == DisconnectReason.loggedOut ||
      status == DisconnectReason.badSession
    ) {
      Config.logger.error('Reason:', DisconnectReason[status])
      try {
        await Promise.all([Config.authFolder, Config.storeFolder]
          .filter(file => existsSync(file))
          .map(file => fs.rm(file, { recursive: true }))
        )
      } catch (e) {
        Config.logger.error(e)
      }
      
      // eslint-disable-next-line no-empty
      try { await this.ws.close() } catch { }
      this.ws.removeAllListeners()
      
      process.exit(0)
    }
  }
}

function parse(code) {
  let res = code = code?.match(/.{1,4}/g)?.join?.('-') || null
  if (!res) {
    let bagi = code.length / 2
    let a = code.slice(0, bagi)
    let b = code.slice(bagi, code.length)
    res = a + '-' + b
  }
  return res || code
}