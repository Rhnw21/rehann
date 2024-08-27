const {
  proto,
  getDevice,
  getContentType,
  areJidsSameUser,
  jidNormalizedUser,
  extractMessageContent,
  downloadMediaMessage
} = (await import('@whiskeysockets/baileys')).default

export function isBaileys(id = '') {
  return id?.length === 16 || id?.startsWith('3EB0') && id?.length === 12 && id?.length >= 33 || id?.includes('FOKUSID') || id?.length == 18 && id?.startsWith('3A') || getDevice(id) == 'unknown' || false
}

export default function message(m, conn, store) {
  if (!m) return m
  let M = proto.WebMessageInfo
  m = M.fromObject(m)
  Object.defineProperties(m, {
    conn: {
      value: conn,
      writable: true,
      enumerable: false
    },
    store: {
      value: store,
      writable: true,
      enumerable: false
    }
  })
  
  let protocolMessageKey, botJid = jidNormalizedUser(conn.user?.jid ?? conn.user?.id)
  if (m.message) {
    if (m.mtype == 'protocolMessage' && m.msg?.type == 0) {
      protocolMessageKey = m.msg.key
      if (!protocolMessageKey.participant) protocolMessageKey.participant = m.sender
      protocolMessageKey.fromMe = areJidsSameUser(protocolMessageKey.participant, botJid)
      if (!protocolMessageKey.fromMe && areJidsSameUser(protocolMessageKey.remoteJid, botJid)) protocolMessageKey.remoteJid = m.sender
    }
  }
  try {
    if (protocolMessageKey) conn?.ev.emit('messages.delete', { keys: [protocolMessageKey] })
  } catch (e) {
    console.error(e)
  }
  
  return m
}

export function serializeMessage() {
  const MediaType = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']
  return Object.defineProperties(proto.WebMessageInfo.prototype, {
    id: {
      get() {
        return this.key.id
      },
      enumerable: true
    },
    isBaileys: {
      get() {
        return isBaileys(this.id)
      },
      enumerable: true
    },
    chat: {
      get() {
        const senderKeyDistributionMessage = this.message?.senderKeyDistributionMessage?.groupId
        return jidNormalizedUser(this.key?.remoteJid || (senderKeyDistributionMessage && senderKeyDistributionMessage !== 'status@broadcast') || '')
      },
      enumerable: true
    },
    isGroup: {
      get() {
        return this.chat.endsWith('g.us')
      },
      enumerable: true
    },
    sender: {
      get() {
        return jidNormalizedUser(
          this.key.fromMe ? this.conn.user.id
          : (this.participant || this.key.participant || this.chat || '')
        )
      },
      enumerable: true
    },
    fromMe: {
      get() {
        const me = this.conn.user?.jid ?? this.conn.user.id
        return this.key?.fromMe || areJidsSameUser(me, this.sender) || false
      }
    },
    sentSource: {
      get() {
        return getDevice(this.id)
      }
    },
    mtype: {
      get() {
        if (!this.message) return ''
        return getContentType(this.message) || Object.keys(this.message)[0] || ''
      },
      enumerable: true
    },
    msg: {
      get() {
        if (!this.message) return this.message
        let msgs = this.message[this.mtype]
        if (/viewOnceMessage/.test(this.mtype)) {
          const mtype = getContentType(msgs.message) || Object.keys(msgs.message)[0] || ''
          msgs = msgs.message[mtype]
        }
        return msgs
      }
    },
    mediaMessage: {
      get() {
        if (!this.msg || typeof this.msg === 'string') return null
        const Message = extractMessageContent(this.message) || null
        if (!Message) return null
        const mtype = getContentType(Message) || Object.keys(Message)[0] || ''
        return MediaType.includes(mtype) ? proto.Message.fromObject(Message) : null
      },
      enumerable: true
    },
    mediaType: {
      get() {
        const message = this.mediaMessage
        if (!message) return message
        return getContentType(message) || Object.keys(message)[0]
      },
      enumerable: true
    },
    quoted: {
      get() {
        const self = this
        const msg = self.msg
        const contextInfo = msg && typeof msg !== 'string' && 'contextInfo' in msg && msg.contextInfo ? msg.contextInfo : undefined
        const quoted = contextInfo?.quotedMessage
        if (!msg || !contextInfo || !quoted) return null
        const type = getContentType(quoted) || Object.keys(quoted)[0] || ''
        const q = quoted[type]
        const text = typeof q === 'string' ? q
          : q && 'text' in q && q.text ? q.text
          : ''
        const botJid = self.conn.user?.jid ?? jidNormalizedUser(self.conn?.user.id)
        const toJSON = typeof q?.toJSON === 'function' ? q.toJSON() : null
        try {
          return Object.defineProperties(
            JSON.parse(JSON.stringify(typeof q === 'string' ? { text } : q)), {
              id: {
                get() {
                  return contextInfo.stanzaId
                },
                enumerable: true
              },
              chat: {
                get() {
                  return contextInfo.remoteJid || self.chat
                },
                enumerable: true
              },
              isBaileys: {
                get() {
                  return isBaileys(this.id)
                },
                enumerable: true
              },
              sender: {
                get() {
                  return jidNormalizedUser(contextInfo.participant || this.chat || '')
                },
                enumerable: true
              },
              fromMe: {
                get() {
                  return areJidsSameUser(botJid, this?.sender)
                },
                enumerable: true
              },
              sentSource: {
                get() {
                  return getDevice(this.id)
                }
              },
              text: {
                get() {
                  // for ViewOnce Message
                  const mtype = q && typeof q !== 'string' && 'message' in q && q.message && (getContentType(q.message) || Object.keys(q.message)?.[0] || '')
                  return text ||
                    (q && typeof q !== 'string' && 'caption' in q && q.caption ? q.caption
                      : q && typeof q !== 'string' && 'contentText' in q && q.contentText ? q.contentText
                      : q && typeof q !== 'string' && 'selectedDisplayText' in q && q.selectedDisplayText ? q.selectedDisplayText
                      : q && typeof q !== 'string' && 'message' in q && q.message && type in q.message && q.message[mtype] && 'caption' in q.message[mtype] && q.message[mtype].caption ? q.message[mtype].caption
                      : '')
                },
                enumerable: true
              },
              mentionedJid: {
                get() {
                  return q && typeof q !== 'string' && 'contextInfo' in q && q.contextInfo?.mentionedJid?.length ? q.contextInfo.mentionedJid : []
                },
                enumerable: true
              },
              fakeObj: {
                get() {
                  return proto.WebMessageInfo.fromObject({
                    key: {
                      fromMe: this.fromMe,
                      remoteJid: this.chat,
                      id: this.id,
                      participant: contextInfo.participant
                    },
                    message: quoted,
                    ...(self.isGroup ? { participant: this.sender } : {})
                  })
                },
              },
              msg: {
                get() {
                  return q
                }
              },
              message: {
                get() {
                  return quoted
                }
              },
              mtype: {
                get () {
                  return type || ''
                },
                enumerable: true
              },
              mediaMessage: {
                get () {
                  if (typeof q === 'string') return null
                  const Message = ((('url' in q && q.url) || ('directPath' in q && q.directPath)) ? { ...quoted } : extractMessageContent(quoted))
                  if (!Message) return null
                  const mtype = getContentType(Message) || Object.keys(Message)[0] || ''
                  return MediaType.includes(mtype) ? proto.Message.fromObject(Message) : null
                },
                enumerable: true
              },
              mediaType: {
                get () {
                  const message = this.mediaMessage
                  if (!message) return message
                  return getContentType(message) || Object.keys(message)[0]
                },
                enumerable: true
              },
              reply: {
                value(text, jid, options = {}) {
                  return self.conn?.reply(jid || this.chat, text, this.fakeObj, options)
                }
              },
              delete: {
                value() {
                  return self.conn?.sendMessage(this.chat, { delete: this.fakeObj.key })
                }
              },
              download: {
                value() {
                  return downloadMediaMessage(this.fakeObj, 'buffer', {}, {
                    // @ts-ignore
                  reuploadRequest: self.conn?.updateMediaMessage
                })
              },
              enumerable: true
              },
              copyNForward: {
                value(jid, options = {}) {
                  return self.conn?.sendMessage(jid ?? this.chat, { forward: this.fakeObj, ...options }, { ephemeralExpiration: self.store?.getExpiration(jid), ...options })
                },
                enumerable: true
              },
              react: {
                value(text) {
                  return self.conn?.sendMessage(this.chat, {
                    react: { text, key: this.fakeObj.key }
                  }, { ephemeralExpiration: self.store?.getExpiration(this.chat) })
                }
              },
              toJSON: {
                value() {
                  return toJSON
                }
              }
            }
          )
        } catch (e) {
          console.error(e)
          return null
        }
      },
      enumerable: true
    },
    _text: {
      value: null,
      writable: true
    },
    text: {
      get() {
        const msg = this.msg
        const text = typeof msg === 'string' ? msg
          : msg && 'text' in msg && msg.text ? msg.text
            : msg && 'caption' in msg && msg.caption ? msg.caption
              : msg && 'contentText' in msg && msg.contentText ? msg.contentText
                : msg && 'selectedDisplayText' in msg && msg.selectedDisplayText ? msg.selectedDisplayText
                  : msg && 'hydratedTemplate' in msg && msg.hydratedTemplate ? msg.hydratedTemplate.hydratedContentText
                    : ''
        
        return typeof this._text === 'string' ? this._text : typeof text === 'string' ? text : ''
      },
      set(str) {
        // eslint-disable-next-line no-setter-return
        return this._text = str
      },
      enumerable: true
    },
    mentionedJid: {
      get() {
        if (!this.msg || typeof this.msg === 'string' || !('contextInfo' in this.msg)) return []
        return this.msg.contextInfo?.mentionedJid?.length ? this.msg.contextInfo.mentionedJid : []
      },
      enumerable: true
    },
    reply: {
      value(text, chatId, options = {}) {
        return this.conn?.reply(chatId ? chatId : this.chat, text, this, options)
      }
    },
    delete: {
      value() {
        return this.conn?.sendMessage(this.chat, { delete: this.key })
      }
    },
    download: {
      value() {
        return downloadMediaMessage(this, 'buffer', {}, {
          // @ts-ignore
          reuploadRequest: this.conn?.updateMediaMessage
        })
      },
      enumerable: true
    },
    copyNForward: {
      value(jid, options = {}) {
        return this.conn?.sendMessage(jid ?? this.chat, { forward: this, ...options }, { ephemeralExpiration: this.store?.getExpiration(jid ?? this.chat), ...options })
      },
      enumerable: true
    },
    react: {
      value(text) {
        return this.conn?.sendMessage(this.chat, {
          react: { text, key: this.key },
        }, { ephemeralExpiration: this.store?.getExpiration(this.chat) })
      }
    }
  })
}

export function prototype() {
  
  Buffer.prototype.toArrayBuffer = function () {
    const ab = new ArrayBuffer(this.length)
    const view = new Uint8Array(ab)
    for (let i = 0; i < this.length; ++i) {
      view[i] = this[i]
    }
    return ab
  }
  
  ArrayBuffer.prototype.toBuffer = function() {
    const buffer = Buffer.alloc(this.byteLength)
    const view = new Uint8Array(this)
    for (let i = 0; i < this.length; ++i) {
      buffer[i] = view[i]
    }
    return buffer
  }
  
  Number.prototype.msToDate = function() {
    const days = Math.floor(this / (24 * 60 * 60 * 1000)),
      daysms = this % (24 * 60 * 60 * 1000),
      hours = Math.floor((daysms) / (60 * 60 * 1000)),
      hoursms = this % (60 * 60 * 100),
      minutes = Math.floor((hoursms) / (60 * 1000)),
      minutesms = this % (60 * 1000),
      seconds = Math.floor((minutesms) / (1000))
    
    let res = ''
    if (days > 0) res += days + ' hari'
    if (hours > 0) res += `${res ? ', ' : ''}${hours} jam`
    if (minutes > 0) res += `${res ? ', ' : ''}${minutes} menit`
    if (seconds > 0) res += `${res ? ', ' : ''}${seconds} detik`
    return res.trim()
  }
  
  /**
   * Number.prototype.format(n, x)
   *
   * @param integer n: length of decimal
   * @param integer x: length of sections
   */
  Number.prototype.format = function(n, x) {
    var re = '\\d(?=(\\d{' + (x || 3) + '})+' + (n > 0 ? '\\.' : '$') + ')'
    return this.toFixed(Math.max(0, ~~n)).replace(new RegExp(re, 'g'), '$&.')
  }
  
  String.prototype.random = Array.prototype.random = function() {
    if (Array.isArray(this) || this instanceof String) return this[Math.floor(Math.random() * this.length)]
    return Math.floor(Math.random() * this)
  }
  
  Number.prototype.toTimeString = function toTimeString () {
    // const milliseconds = this % 1000
    const seconds = Math.floor((this / 1000) % 60)
    const minutes = Math.floor((this / (60 * 1000)) % 60)
    const hours = Math.floor((this / (60 * 60 * 1000)) % 24)
    const days = Math.floor((this / (24 * 60 * 60 * 1000)))

    return (
      (days ? `${days} hari, ` : '') +
      (hours ? `${hours} jam, ` : '') +
      (minutes ? `${minutes} menit, ` : '') +
      (seconds ? `${seconds} detik` : '')
    ).trim()
  }
}