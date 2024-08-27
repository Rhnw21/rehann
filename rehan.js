import chalk from 'chalk'
import { format } from 'util'
import { fileURLToPath } from 'url'
import { unwatchFile, watchFile } from 'fs'
import { areJidsSameUser, URL_REGEX } from '@whiskeysockets/baileys'

import * as Config from './config.js'
import uploadImage from './lib/uploadImage.js'
import printMessage from './lib/printMessage.js'
import helperMessage from './lib/helperMessage.js'
import db, { loadDatabase } from './lib/database.js'

const isNumber = x => (x = typeof x === 'string' ? parseInt(x) : x) && typeof x === 'number' && !isNaN(x)
export async function handler(store, chatUpdate) {
  if (db.data == null) await loadDatabase()
  if (!chatUpdate.messages) return
  let m = chatUpdate.messages[chatUpdate.messages.length - 1]
  try {
    m = helperMessage(m, this, store)
    if (!m) return
    
    if (typeof m.text !== 'string') m.text = ''
    
    const groupMetadata = m.isGroup ? await store.fetchGroupMetadata(m.chat, this) : {}
    const participants = (m.isGroup ? groupMetadata?.participants : []) || []
    const isRAdmin = (m.isGroup && participants.find(({ id }) => areJidsSameUser(id, m.sender))?.admin?.includes('superadmin') || false)
    const isAdmin = (m.isGroup && participants.find(({ id }) => areJidsSameUser(id, m.sender))?.admin?.includes('admin') || false)
    const isBotAdmin = (m.isGroup && participants.find(({ id }) => areJidsSameUser(id, this.user.id))?.admin?.includes('admin') || false)
    const isOwner = Config.owner.map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net').find(v => areJidsSameUser(v, m.sender))

    const match = (Config.execPrefix.test(m.text) ? [[Config.execPrefix.exec(m.text), Config.execPrefix]] : [[Config.prefix.exec(m.text), Config.prefix]]).find(p => p[1])
    const usedPrefix = (match[0] || match[1] || [])[0]
    const noPrefix = m.text.replace(usedPrefix, '')
    let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
    args = args || []
    const _args = noPrefix.trim().split` `.slice(1)
    let text = _args.join` `
    command = (command || '').toLowerCase()
    
    if (!usedPrefix) return
    m.isCommand = true
    try {
      switch (command) {
        case 'ping':
          let { performance } = (await import('perf_hooks')).default
          const start = performance.now()
          const latency = performance.now() - start
          m.reply(`_Merespon dalam ${latency.toFixed(4)} detik_`)
          break
        case 'pull':
          let { execSync } = (await import('child_process')).default
          if (!isOwner) throw 'Fitur khusus Owner!'
          let stdout = await execSync('git pull')
          await m.reply(stdout?.toString?.() || stdout)
          break
        default:
          if (Config.execPrefix.exec(m.text) && isOwner) {
            let i = 15
            let _return, _text = (/^(×|=)>/.test(usedPrefix) ? 'return ' : '') + noPrefix
            try {
              let exec = new(async () => {}).constructor('print', 'm', 'conn', 'process', 'args', 'text', 'db', _text)
              _return = await exec.call(this, (...args) => {
                if (--i < 1) return
                return m.reply(format(...args))
              }, m, this, process, args, text, db)
            } catch (e) {
              _return = e
            } finally {
              await m.reply(format(_return))
            }
          }
      }
    } catch (e) {
      m.error = e
      m.reply(format(e?.message ?? e))
    }
  } catch (e) {
    console.error(e)
  } finally {
    await printMessage(m, this)
  }
}

export async function deleteMessage(message) {
  console.log('messages.delete:', message)
}

export async function participantsUpdate({ id, author, participants, action }) {
  console.log('groups.participants-update:', { id, author, participants, action })
}

const file = fileURLToPath(import.meta.url)
watchFile(file, () => {
  console.log(chalk.redBright('[UPDATE]'), chalk.cyanBright('rehan.js'), 'is changed!')
  unwatchFile(file)
  import(file + '?update=' + Date.now())
  if (process.send) {
    console.log(chalk.redBright('[WARNING] Resetting the bot...'))
    process.send('restart')
  }
})
