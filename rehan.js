import path from 'path'
import chalk from 'chalk'
import { format } from 'util'
import { fileURLToPath } from 'url'
import fs, { unwatchFile, watchFile } from 'fs'
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
    
    var listProduk = Object.entries(db.data.store).filter(([key, value]) => {
      return value.namaProduk && value.hargaProduk && value.deskProduk && value.dataProduk
    })
    
    if (!usedPrefix) return
    m.isCommand = true
    try {
      switch (command) {
        // MAIN
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
        // STORE
        case 'addproduk':
          if (!text) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk,namaProduk,hargaProduk,deskProduk`
          if (!isOwner) throw 'Fitur Khusus Owner!'
          var [ kodeProduk, namaProduk, hargaProduk, deskProduk ] = text.split(',')
          if (!kodeProduk && !hargaProduk) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk,namaProduk,hargaProduk,deskProduk`
          kodeProduk = kodeProduk.toLowerCase()
          db.data.store[kodeProduk] = { namaProduk, hargaProduk, deskProduk, dataProduk: [] }
          m.reply('Berhasil menambhkan produk pada database!')
          break
        case 'addstok':
          if (!text) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk`
          if (!isOwner) throw 'Fitur Khusus Owner!'
          var [kodeProduk, dataProduk] = text.split(' ')
          var qStok = m.quoted.text
          for (const v of qStok.split('\n')) {
            db.data.store[kodeProduk].dataProduk.push(v)
          }
          m.reply('Berhasil menambhkan stok pada database!')
          break
        case 'order':
          let paydisini = (await import('./lib/paydisini.js')).default
          if (!listProduk.length) throw 'Tidak ada stok yang tersedia!'
          let [type, amount] = text.split(' ')
          const detail = listProduk.find(([key]) => key == type)?.[1]
          if (!detail) throw 'Produk tersebut tidak ada!'
          if (!detail.dataProduk.length) throw 'Maaf stok yang anda cari telah habis!'
          if (amount > detail.dataProduk.length) throw `Maaf stok yang tersedia hanya ${detail.dataProduk.length}`
          const number = parseInt(m.sender)
          const pay = (db.pay = db.pay || new paydisini(Config.paydisini))
          pay[m.sender] = pay[m.sender] || {}
          pay[m.sender][type] = pay[m.sender][type] || {}
          const buy = pay[m.sender][type][amount] = pay[m.sender][type][amount] || {}
          if (buy.msg) throw 'Selesaikan transaksi anda sebelumnya!'
          const res = await pay.create(detail.hargaProduk * amount, `${number} order ${type}`, {
            ewalet_phone: number
          })
          if (!res.success) {
            delete db.pay
            throw res
          }
          const captionPay = `
*STATUS PEMBAYARAN*

*ID:* ${generateNumericIdWithPrefix('BR', '12')}
*Nama Produk:* ${detail.namaProduk}
*Harga Produk:* Rp ${parseInt(res.data.balance).toLocaleString('id')}
*Total Fee:* Rp ${parseInt(res.data.fee).toLocaleString('id')}
*Total Harus Dibayar:* Rp ${parseInt(res.data.amount).toLocaleString('id')}
*Status Transaksi:* ${res.data.status}
*Transaksi Expired:* ${res.data.expired}
`.trim()
          buy.msg  = await this.sendMessage(m.chat, {
            image: { url: res.data.qrcode_url },
            caption: captionPay
          })
          buy.interval = setInterval(async () => {
            const clear = async () => {
              await this.sendMessage(m.chat, { delete: buy.msg.key })
              clearInterval(buy.interval)
              delete pay[m.sender][type][amount]
              if (!Object.keys(pay[m.sender][type]).length)
              delete pay[m.sender][type]
              if (!Object.keys(pay[m.sender]).length) delete pay[m.sender]
            }
            if (new Date() > new Date(res.data.expired)) {
              await m.reply('Waktu telah habis. Transaksi dibatalkan.')
              await clear()
              return
            }
            const check = await pay.check(res.data.unique_code)
            if (isOwner || check.data.status.toLowerCase() == 'success') {
              await clear()
              if (detail.amount && detail.amount != Infinity) detail.amount -= 1
              const ambilStok = detail.dataProduk.length - amount
              const fileContent = detail.dataProduk.slice(ambilStok).map((dataProduk) => `${dataProduk}`).join('\n')
              const filePath = await transaksiPath(fileContent)
              const fileNow = await this.sendMessage(m.chat, {
                document: { url: filePath },
                fileName: `data_${Date.now()}`,
                mimetype: 'text/plain'
              })
              
              const captionSukses = `
╭─〔 *TRANSAKSI SUKSES* 〕
│ • Nama Produk: ${detail.namaProduk}
│ • Desk Produk: ${detail.deskProduk}
│ • Harga Produk: ${detail.hargaProduk}
╰────
`.trim()
              await this.sendMessage(m.chat, { text: captionSukses }, { quoted: fileNow })
              detail.dataProduk.splice(ambilStok)
            }
          }, 10_000)
          break
        case 'stok':
          if (!listProduk.length) throw 'Tidak ada stok yang tersedia!'
          let str = ''
          for (let [key, produkInfo] of listProduk) {
            str += `Nama Produk: ${produkInfo.namaProduk}\n`
            str += `Deskripsi: ${produkInfo.deskProduk}\n`
            str += `Kode Produk: ${key}\n`
            str += `Stok Tersedia: ${produkInfo.dataProduk.length}\n`
            str += `Harga Produk: ${produkInfo.hargaProduk}\n`
            str += `${'='.repeat(20)}`
          }
          await m.reply(str.trim())
          break
        case 'delproduk':
          if (!text) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk`
          if (!isOwner) throw 'Fitur Khusus Owner!'
          let delProduk = text.toLowerCase()
          if (!delKode in db.data.store) throw `${delProduk} Tidak ada dalam database!`
          delete db.data.store[delProduk]
          m.reply(`Berhasil menghapus ${delProduk}`)
          break
        default:
          if (Config.execPrefix.exec(m.text) && isOwner) {
            let i = 15
            let _return, _text = (/^(×|=)>/.test(usedPrefix) ? 'return ' : '') + noPrefix
            try {
              let exec = new(async () => {}).constructor('print', 'm', 'conn', 'process', 'args', 'text', 'db', 'store', _text)
              _return = await exec.call(this, (...args) => {
                if (--i < 1) return
                return m.reply(format(...args))
              }, m, this, process, args, text, db, store)
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

export async function groupsUpdate(groupsUpdate) {
  console.log('GROUPS UPDATE: ', groupsUpdate)
}

export async function participantsUpdate({ id, author, participants, action }) {
  console.log('groups.participants-update:', { id, author, participants, action })
} 

function generateNumericIdWithPrefix(nameId, length) {
  let characters = '0123456789'
  let id = nameId

  for (let i = 0; i < length; i++) {
    let randomIndex = Math.floor(Math.random() * characters.length)
    id += characters[randomIndex]
  }

  return id
}

const file = fileURLToPath(import.meta.url)
watchFile(file, () => {
  console.log(chalk.redBright('[WATCHING]'), chalk.cyanBright(file), 'is changed!')
  unwatchFile(file)
  import(file + '?update=' + Date.now()).then(() => {
    console.log(chalk.greenBright('[UPDATED]'), chalk.cyanBright(file), 'updated!')
  }).catch(e => console.error(e))
  if (process.send) {
    console.log(chalk.redBright('[WARNING] Resetting the bot...'))
    process.send('restart')
  }
})

async function transaksiPath(content) {
  const filePath = path.join(Config.tmp, `transaksi_${Date.now()}.txt`)
  try {
    fs.promises.writeFile(filePath, content, 'utf-8')
    return filePath
  } catch (e) {
    throw e
  }
}