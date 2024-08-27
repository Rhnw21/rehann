import axios from 'axios'
import fs, { promises as Fs } from 'fs'
import { fileTypeStream } from 'file-type'
import PhoneNumber from 'awesome-phonenumber'
import Stream, { Readable, isReadable } from 'stream'

const {
  proto,
  toReadable,
  isJidGroup,
  makeWASocket,
  isJidBroadcast,
  areJidsSameUser,
  jidNormalizedUser,
} = await import('@whiskeysockets/baileys').then((module) => module.default)

import config from '../config.js'

export default function HelperConnection(config, { store }) {
  const sock = makeWASocket(config)
  const botUser = sock.user ?? {}
  return Object.defineProperties(sock, {
    logger: {
      value: config.logger,
    },
    reply: {
      value(jid, text, quoted, options = {}) {
        if (typeof options !== 'object') options = {}
        if (!Buffer.isBuffer(text)) this.sendPresenceUpdate('composing', jid)
        if (!options.ephemeralExpiration)
          options.ephemeralExpiration = store.getExpiration(jid)
        if (isJidBroadcast(jid)) delete options.ephemeralExpiration
        return Buffer.isBuffer(text)
          ? this.sendFile(jid, text, '', '', quoted, false, options)
          : this.sendMessage(
              jid,
              { text, mentions: this.parseMention(text), ...options },
              { quoted, ...options }
            )
      },
    },
    getFile: {
      /**
       * getFile
       * @param {Buffer|Readable|String} PATH
       * @returns {Promise<{
       *   status: boolean,
       *   mime: string,
       *   ext: string,
       *   fileType: { mime: string, ext: string },
       *   res: Response,
       *   filename?: string,
       *   data: Readable,
       *   toBuffer: () => Promise<Buffer>,
       *   clear: () => Promise<void>
       * }>}
       */
      async value(PATH) {
        return new Promise(async (resolve, reject) => {
          let res, filename, data
          if (Buffer.isBuffer(PATH) || isReadable(PATH)) data = PATH
          else if (PATH instanceof ArrayBuffer) data = await PATH.toBuffer()
          else if (/^data:.*?\/.*?base64,/i.test(PATH))
            data = Buffer.from(PATH.split(',')[1], 'base64')
          else if (/^https?:\/\//.test(PATH)) {
            try {
              res = await axios.get(PATH, { responseType: 'stream' })
              data = res?.data
            } catch (e) {
              reject(e)
            }
          } else if (fs.existsSync(PATH)) {
            filename = PATH
            data = fs.createReadStream(PATH)
          } else {
            data = Buffer.alloc(0)
          }

          if (Buffer.isBuffer(data)) {
            console.log('Converting buffer to stream...')
            data = await toReadable(data)
          }
          if (!isReadable(data)) return reject('Failed to convert buffer to stream')

          const stream = await fileTypeStream(data).catch((e) => {
            console.error('Error determining file type:', e)
            return {
              mime: 'application/octet-stream',
              ext: '.bin',
              fileType: { mime: 'application/octet-stream', ext: '.bin' },
            }
          })

          resolve({
            status: true,
            ...stream.fileType,
            res,
            filename,
            data: stream,
            async toBuffer() {
              const buffers = []
              for await (const chunk of stream) buffers.push(chunk)
              return Buffer.concat(buffers)
            },
            async clear() {
              stream.destroy()
              if (filename) await Fs.unlink(filename)
            },
          })
        })
      },
    },
    sendFile: {
      async value(jid, PATH, fileName, caption, quoted, ptt = false, options = {}) {
        if (typeof options !== 'object') options = {}
        if (!options.ephemeralExpiration)
          options.ephemeralExpiration = store.getExpiration(jid)
        if (isJidBroadcast(jid)) delete options.ephemeralExpiration

        let mime, data, toBuffer, clear, mtype = '', err
        try {
          const res = await this.getFile(PATH)
          if (!res.data && !res.status) throw res?.message ?? res

          mime = res.mime
          data = res.data
          clear = res.clear
          toBuffer = res.toBuffer

          if (options.asSticker || /webp/.test(mime || '')) mtype = 'sticker'
          else if (options.asImage || /image/.test(mime || '')) mtype = 'image'
          else if (options.asVideo || /video/.test(mime || '')) mtype = 'video'
          else if (options.asAudio || /audio/.test(mime || '')) mtype = 'audio'
          else mtype = 'document'

          fileName = fileName ?? res?.filename
        } catch (e) {
          err = e
        } finally {
          if (err) throw err

          if (/audio/.test(mtype)) this.sendPresenceUpdate('recording', jid)
          else this.sendPresenceUpdate('composing', jid)

          const message = {
            caption,
            mentions: this.parseMention(caption),
            ptt,
            [mtype]: { stream: data },
            mimetype: options.mimetype ?? mime,
            fileName,
            ...options,
          }

          try {
            return this.sendMessage(jid, message, { quoted, ...options }).then(
              console.log
            )
          } catch (e) {
            err = e
          } finally {
            if (err) {
              return this.sendMessage(
                jid,
                { ...message, [mtype]: await toBuffer() },
                { quoted, ...options }
              )
                .then(() => (err = null))
                .catch((e) => (err = e))
            }
            if (err) {
              console.error('Failed to send file to chat:', err)
              throw err?.message ?? err
            }
          }
        }
      },
    },
    getName: {
      value(jid, contact = false) {
        jid = jidNormalizedUser(jid)
        if (!jid) return ''

        contact = this.withoutContact ?? contact

        let v
        if (isJidGroup(jid)) {
          v = store.groupMetadata[jid]
          return v.name || v.subject || jid
        } else {
          v =
            jid === '0@s.whatsapp.net'
              ? { jid, name: 'WhatsApp' }
              : areJidsSameUser(jid, this.user.id)
              ? this.user
              : store.contacts[jid] ?? { jid }
        }

        const number = PhoneNumber('+' + parseInt(jid)).getNumber('international')
        const name =
          jid === jidNormalizedUser(this.user.id) && contact
            ? v.name || v.subject || v.vname || v.notify || v.verifiedName
            : jid !== jidNormalizedUser(this.user.id)
            ? v.name || v.subject || v.vname || v.notify || v.verifiedName
            : this.user.name

        return name || v.name || v.subject || v.vname || v.notify || v.verifiedName || number
      },
    },
    parseMention: {
      value(text) {
        if (!text || typeof text !== 'string') return ''

        return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map((v) => v[1] + '@s.whatsapp.net')
      },
    },
    user: {
      get() {
        Object.assign(botUser, this?.authState?.creds?.me || {})
        return {
          ...botUser,
          jid: jidNormalizedUser(botUser.id) || botUser.id,
        }
      },
      set(value) {
        Object.assign(botUser, value)
      },
      enumerable: true,
      configurable: true,
    },
  })
}