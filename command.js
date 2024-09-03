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
      return value.namaProduk && value.hargaProduk && value.deskProduk
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
        case 'setstok':
          if (!text) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk@namaProduk@hargaProduk@deskProduk`
          if (!isOwner) throw 'Fitur Khusus Owner!'
          var [kodeProduk, namaProduk, hargaProduk, deskProduk] = text.split('@')
          if (!kodeProduk && !hargaProduk) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk@namaProduk@hargaProduk@deskProduk`
          kodeProduk = kodeProduk.toLowerCase()
          db.data.store[kodeProduk] = { namaProduk, hargaProduk, deskProduk, dataProduk: [], dataTerjual: 0 }
          m.reply('Berhasil menambhkan produk pada database!')
          break
        case 'addstok':
          if (!text) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk`
          if (!isOwner) throw 'Fitur Khusus Owner!'
          var [kodeProduk, ...dataProduk] = text.split(' ')
          dataProduk = dataProduk.join(' ').trim()
          var stokData = m.quoted && m.quoted.text ? m.quoted.text : dataProduk
          if (!stokData) throw 'Tidak ada data stok yang ditemukan! Pastikan mengutip pesan atau memberikan data stok setelah kode produk.'
          for (const v of stokData.split('\n')) {
            db.data.store[kodeProduk].dataProduk.push(v)
          }
          m.reply('Berhasil menambahkan stok pada database!')
          break
        case 'buy':
          let paydisini = (await import('./lib/paydisini.js')).default
          if (!listProduk.length) throw 'Tidak ada stok yang tersedia!'
          let [type, amount] = text.split(' ')
          const detail = listProduk.find(([key]) => key == type)?.[1]
          if (!detail) throw 'Produk tidak ditemukan! Pastikan kode produk yang Anda masukkan benar atau produk tersebut sudah terdaftar.'
          if (!detail.dataProduk.length) throw 'Stok habis! Produk yang Anda cari tidak tersedia saat ini. Silakan cek kembali nanti atau hubungi admin untuk informasi lebih lanjut.'
          if (amount > detail.dataProduk.length) throw `Jumlah yang diminta melebihi stok yang tersedia! Hanya tersedia ${detail.dataProduk.length} item. Silakan coba dengan jumlah yang lebih sedikit.`
          const number = parseInt(m.sender)
          let pay = (db.pay = db.pay || new paydisini(Config.paydisini))
          pay[m.sender] = pay[m.sender] || {}
          pay[m.sender][type] = pay[m.sender][type] || {}
          const buy = pay[m.sender][type][amount] = pay[m.sender][type][amount] || {}
          if (pay[m.sender]) {
            for (const product in pay[m.sender]) {
              for (const qty in pay[m.sender][product]) {
                if (pay[m.sender][product][qty].msg) {
                  throw 'Transaksi sebelumnya belum selesai! Silakan selesaikan transaksi yang sedang berlangsung untuk produk lain sebelum memulai yang baru.'
                }
              }
            }
          }
          const res = await pay.create(detail.hargaProduk * amount, `${number} order ${type}`, {
            ewalet_phone: number
          })
          if (!res.success) {
            delete db.pay
            throw res
          }
          const captionPay = `
*STATUS PEMBAYARAN*

*Nama Produk:* ${detail.namaProduk}
*Harga Produk:* Rp ${parseInt(res.data.balance).toLocaleString('id')}
*Total Fee:* Rp ${parseInt(res.data.fee).toLocaleString('id')}
*Total Harus Dibayar:* Rp ${parseInt(res.data.amount).toLocaleString('id')}
*Status Transaksi:* ${res.data.status}
*Transaksi Expired:* ${res.data.expired}

\`Ketik ${usedPrefix}cancel untuk membatalkan transaksi.\`
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
              await m.reply('Transaksi dibatalkan! Waktu pembayaran telah habis. Silakan coba lagi atau hubungi admin jika mengalami masalah.')
              await clear()
              return
            }
            const check = await pay.check(res.data.unique_code)
            if (isOwner || check.data.status.toLowerCase() == 'success') {
              await clear()
              if (detail.amount && detail.amount != Infinity) detail.amount -= 1
              detail.dataTerjual = detail.dataTerjual + parseInt(amount)
              const ambilStok = detail.dataProduk.length - amount
              const fileContent = detail.dataProduk.slice(ambilStok).map((dataProduk) => `${dataProduk}`).join('\n')
              const filePath = await transaksiPath(fileContent)
              const fileNow = await this.sendMessage(m.chat, {
                document: { url: filePath },
                fileName: `data`,
                mimetype: 'text/plain',
                caption: `*TRANSAKSI SUKSES*\n\n*Produk:* ${detail.namaProduk}\n*Jumlah:* ${amount}\n*Desk:* ${detail.deskProduk}`
              })
              detail.dataProduk.splice(ambilStok)
            }
          }, 10_000)
          break
        case 'cancel':
          if (!db.pay || !db.pay[m.sender]) throw 'Tidak ada transaksi yang sedang berlangsung untuk dibatalkan.'
          let cancelled = false
          for (const product in db.pay[m.sender]) {
            for (const qty in db.pay[m.sender][product]) {
              if (db.pay[m.sender][product][qty].msg) {
                clearInterval(db.pay[m.sender][product][qty].interval)
                await this.sendMessage(m.chat, { delete: db.pay[m.sender][product][qty].msg.key })
                delete db.pay[m.sender][product][qty]
                cancelled = true
              }
            }
          }
          if (cancelled) {
            for (const product in db.pay[m.sender]) {
              if (Object.keys(db.pay[m.sender][product]).length === 0) {
                delete db.pay[m.sender][product]
              }
            }
            if (Object.keys(db.pay[m.sender]).length === 0) {
              delete db.pay[m.sender]
            }
            m.reply('Transaksi yang sedang berlangsung berhasil dibatalkan.')
          }
          break
        case 'delproduk':
          if (!text) throw `Uhm.. Contoh: ${usedPrefix + command} kodeProduk`
          if (!isOwner) throw 'Fitur Khusus Owner!'
          let delProduk = text.toLowerCase()
          if (!delProduk in db.data.store) throw `${delProduk} Tidak ada dalam database!`
          delete db.data.store[delProduk]
          m.reply(`Berhasil menghapus ${delProduk}`)
          break
        case 'stok':
          if (!listProduk.length) throw 'Tidak ada produk tersedia!!'
          const captionStok = `
*乂 BOT AUTO ORDER*
*×* Contoh Order: ${usedPrefix}buy gmail 1
*×* *Ketik ${usedPrefix}caraorder* jika kurang paham.
*×* Jika Anda menghadapi kendala atau memiliki pertanyaan lebih lanjut, jangan ragu untuk menghubungi Admin di: wa.me/${Config.owner}\n\n`
          await sendStok(captionStok)
          break
        case 'caraorder':
          const caraOrderText = `
*Cara Memesan Produk:*
1. *Pilih produk* yang ingin Anda beli dari daftar yang tersedia.
2. *Gunakan perintah* berikut untuk melakukan pembelian: *${usedPrefix}buy <kode> <jumlah>*.
   - *Kode*: Kode unik untuk produk yang Anda pilih.
   - *Jumlah*: Jumlah unit produk yang ingin Anda beli.
3. *Ikuti instruksi* yang diberikan untuk menyelesaikan transaksi.
4. *Hubungi Admin* jika ada pertanyaan atau kendala selama proses pembelian: ${Config.owner}
`.trim()

          await m.reply(caraOrderText)
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
      function sendStok(text) {
        let str = text || ''
        for (let [key, produkInfo] of listProduk) {
          const harga = Number(produkInfo.hargaProduk)
          str += `*乂 ${produkInfo.namaProduk.toUpperCase()}*\n`
          str += `*×* Kode: ${key}\n`
          str += `*×* Desk: ${produkInfo.deskProduk}\n`
          str += `*×* Harga: Rp ${harga.toLocaleString('id')}\n`
          str += `*×* Stok Tersedia: ${produkInfo.dataProduk.length > 0 ? `${produkInfo.dataProduk.length}` : '❌ Habis'}\n`
          str += `*×* Stok Terjual: ${produkInfo.dataTerjual}\n`
          str += `*${'='.repeat(30)}*\n\n`
        }
        m.reply(str.trim())
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
  fs.promises.writeFile(filePath, content, 'utf-8')
  return filePath
}