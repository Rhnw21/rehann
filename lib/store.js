import {
  existsSync,
  readFileSync,
  writeFileSync
} from 'fs'

const {
  proto,
  isJidGroup,
  getContentType,
  isJidBroadcast,
  jidNormalizedUser,
  WAMessageStubType,
  updateMessageWithReceipt,
  updateMessageWithReaction
} = (await import('@whiskeysockets/baileys')).default

import { logger } from '../config.js'

const default_avatar = 'https://telegra.ph/file/7ce3f080ee6d1e58f7e33.png'
export default function() {
  let chats = {},
      messages = {},
      contacts = {},
      groupMetadata = {},
      state = {}
  
  function loadMessage(jid, id = null) {
    let message
    if (jid && !id) {
      id = jid
      const messageFind = Object.entries(messages)
        .find(([_, msgs]) => msgs.find(m => m.key?.id == id))
      message = messageFind?.[1]?.find?.(m => m?.key?.id == id)
    } else {
      jid = jidNormalizedUser(jid)
      if (!(jid in messages)) return message
      message = messages[jid]?.find?.(m => m?.key?.id == id)
    }
    
    return message
  }
  
  function isJid(id) {
    return typeof id !== 'undefined' && !isJidBroadcast(id)
  }

  function getExpiration(jid) {
    if (!isJid(jid)) return null
    const expirationGroup = groupMetadata[jid]?.ephemeralDuration
    const expirationChat = chats[jid]?.ephemeralExpiration ?? chats[jid]?.ephemeralDuration ?? contacts[jid]?.ephemeralExpiration ?? contacts[jid]?.ephemeralDuration
    return (expirationGroup || expirationChat)
  }

  function getExpirationOfMessage(m) {
    if (!m) return
    m = proto.WebMessageInfo.fromObject(m)
    let mtype = m.message ? (getContentType(m.message) || Object.keys(m.message)[0]) : ''
    let msg = m.message ? m.message[mtype] : null
    if (/viewOnceMessage/.test(mtype)) {
      mtype = getContentType(msg.message) || Object.keys(msg.message)[0] || ''
      msg = msg.message[mtype]
    }
    
    let expiration
    if (msg && msg !== null && typeof msg === 'object' && 'contextInfo' in msg && msg.contextInfo) {
      if (msg.contextInfo !== null && typeof msg.contextInfo === 'object') {
        if (msg.contextInfo && 'expiration' in msg.contextInfo && msg.contextInfo.expiration) {
          expiration = msg.contextInfo.expiration
        }
      }
    }
    
    return expiration
  }

  function contactsUpsert(newContacts) {
    const oldContacts = new Set(Object.keys(contacts))
    logger.info('Syncroning the latest contacts...')
    for (const contact of newContacts) {
      oldContacts.delete(contact.id)
      contacts[contact.id] = Object.assign(contacts[contact.id] || {}, contact)
    }
    
    return oldContacts
  }

  function upsertMessage(id, message, type = 'append') {
    // @ts-ignore
    id = jidNormalizedUser(id) || id
    if (!(id in messages)) messages[id] = []
    
    // Clean Message
    delete message.message?.senderKeyDistributionMessage
    
    const msg = loadMessage(id, message.key?.id)
    if (msg) Object.assign(msg, message)
    else {
      if (type == 'append') messages[id].push(message)
      else messages[id].splice(0, 0, message)
    }
  }
  
  /**
   * binds to a BaileysEventEmitter.
   * It listens to all events and constructs a state that you can query accurate data from.
   * Eg. can use the store to fetch chats, contacts, messages etc.
   * @param {(await import('@whisketsockets/baileys')).BaileysEventEmitter} ev typically the event emitter from the socket connection
   */
  function bind(conn) {
    conn.ev.on('connection.update', update => {
      Object.assign(state, update)
    })
    
    conn.ev.on('messaging-history.set', ({ contacts: newContacts, isLatest }) => {
      const oldContacts = contactsUpsert(newContacts)
      if (isLatest) {
        for (const jid of oldContacts) {
          delete contacts[jid]
        }
      }
      
      logger.debug({ deletedContacts: isLatest ? oldContacts.size : 0, newContacts }, 'synced contacts')
    })
    
    conn.ev.on('contacts.upsert', contact => {
      contactsUpsert(contact)
    })
    
    conn.ev.on('contacts.update', updates => {
      for (const update of updates) {
        if (!isJid(update.id)) continue
        if (!(update.id in contacts)) Object.assign(contacts, { [update.id]: {} })
        Object.assign(contacts[update.id], update)
      }
    })
    
    conn.ev.on('chats.upsert', newChats => {
      for (const chat of newChats) {
        const id = jidNormalizedUser(chat.id)
        if (!isJid(id)) continue
        if (!(id in chats)) Object.assign(chats, { [id]: {} })
        if ('ephemeralExpiration' in chat && !isJidGroup(id)) {
          if (!(id in contacts)) contacts[id] = {}
          Object.assign(contacts[id], { ephemeralExpiration: chat.ephemeralExpiration })
        }
        if (!isJidGroup(id)) Object.assign(chats[id], { id, isPrivate: true })
      }
    })
    
    conn.ev.on('chats.update', updates => {
      for (const update of updates) {
        const id = jidNormalizedUser(update.id)
        if (!isJid(id)) continue
        if (!(id in chats)) Object.assign(chats, { [id]: {} })
        if (update.unreadCount && chats[id]?.unreadCount) update.unreadCount += chats[id].unreadCount || 0
        if ('ephemeralExpiration' in update && !isJidGroup(id)) {
          if (!(id in contacts)) contacts[id] = {}
          Object.assign(contacts[id], { ephemeralExpiration: update.ephemeralExpiration })
        }
        if (!isJidGroup(id)) Object.assign(chats[id], { id, isPrivate: true })
      }
    })
    
    conn.ev.on('chats.delete', deletions => {
      for (const id of deletions) {
        logger.debug('id in chats.delete store system: ', id)
        if (id in messages) delete messages[id]
        if (id in chats) delete chats[id]
      }
    })
    
    conn.ev.on('presence.update', ({ id, presences: update }) => {
      id = jidNormalizedUser(id) || id
      if (!isJid(id)) return
      if (!(id in chats)) Object.assign(chats, { [id]: {} })
      Object.assign(chats[id], update)
    })
    
    conn.ev.on('messages.upsert', ({ messages: newMessages, type }) => {
      switch (type) {
        case 'append':
        case 'notify':
          for (const msg of newMessages) {
            const jid = jidNormalizedUser(msg.key?.remoteJid)
            if (!jid) continue
            // untuk status wa agar datanya tidak di simpan karena gak guna
            // kalo mau simpan hapus line di bawah ini atau kasih aja komentar.
            if (jid && (isJidBroadcast(jid) || msg.broadcast)) continue
            // chipher text
            if (msg.messageStubTybe == WAMessageStubType.CIPHERTEXT) continue

            upsertMessage(jid, proto.WebMessageInfo.fromObject(msg))
            if (type == 'notify') {
              let exp = getExpirationOfMessage(msg)
              if (jid in chats && chats[jid] && !chats[jid].ephemeralExpiration) {
                if (exp) chats[jid].ephemeralExpiration = exp
              }
              if (!(jid in chats)) {
                conn.ev.emit('chats.upsert', [{
                  id: jid,
                  conversationTimestamp: msg.messageTimestamp,
                  unreadCount: 1,
                  notify: msg.pushName || msg.verifiedBizName,
                  ...(exp ? {
                    ephemeralExpiration: exp
                  } : {})
                }])
              }
            }
          }

          break
      }
    })
    
    conn.ev.on('messages.update', updates => {
      for (const { key, update } of updates) {
        const jid = jidNormalizedUser(key?.remoteJid)
        if (!isJid(jid)) continue
        if (!(jid in messages)) messages[jid] = []
        let msg = loadMessage(jid, key?.id)
        if (!msg) continue
        if (update?.messageStubType == WAMessageStubType.REVOKE) continue
        if (update?.status) {
          const listStatus = msg?.status
          if (listStatus && update.status <= listStatus) {
            logger.debug({ update, storedStatus: listStatus }, 'status stored newer then update')
            delete update.status
          }
        }
        
        Object.assign(msg, update)
        const index = messages[jid].findIndex(m => m.key?.id == key.id)
        if (index == -1) continue
        const result = Object.assign(messages[jid][index], update)
        if (!result) logger.debug({ update }, 'got update for non-existent message')
      }
    })
    
    conn.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        const id = update?.id
        if (!(id in groupMetadata)) await fetchGroupMetadata(id, conn)
        Object.assign(groupMetadata[id], update)
      }
    })
    
    conn.ev.on('group-participants.update', ({ id, participants, action }) => {
      const metadata = groupMetadata[id]
      if (metadata) {
        switch (action) {
          case 'add':
            metadata.participants.push(...participants.map(id => ({ id, admin: null })))
          break
          case 'demote':
          case 'promote':
            for (const participant of metadata.participants) {
              if (participants.includes(participant.id)) {
                participant.admin = action === 'promote' ? (participant.id === metadata.owner || metadata.id?.includes?.('-') && metadata.id.split('-')[0] + '@s.whatsapp.net') ? 'superadmin' : 'admin' : null
              }
            }
            
            break
          case 'remove':
            metadata.participants = metadata.participants.filter(p => !participants.includes(p.id))
            break
        }

        Object.assign(groupMetadata[id], metadata)
      }
    })
    
    conn.ev.on('message-receipt.update', updates => {
      for (const { key, receipt } of updates) {
        const msg = loadMessage(key?.remoteJid, key?.id)
        if (msg) updateMessageWithReceipt(msg, receipt)
      }
    })
    
    conn.ev.on('messages.reaction', updates => {
      for (const { key, reaction } of updates) {
        const msg = loadMessage(key?.remoteJid, key?.id)
        if (msg) updateMessageWithReaction(msg, reaction)
      }
    })
  }
    
  async function fetchGroupMetadata(jid, conn) {
    if (!isJidGroup(jid)) return null
    if (!(jid in groupMetadata)) groupMetadata[jid] = { id: jid }
    const isRequiredToUpdate = !groupMetadata[jid]?.metadata || Date.now() - (groupMetadata[jid]?.lastfetch || 0) > 60 * 1000
    if (isRequiredToUpdate) {
      const GroupMetadata = (conn && conn !== null && (typeof conn === 'object' && 'groupMetadata' in conn && conn.groupMetadata ? conn.groupMetadata : typeof conn === 'function' ? conn : null))
      if (!GroupMetadata) return GroupMetadata
      const metadata = typeof GroupMetadata === 'function' && await GroupMetadata(jid)
      const participants = metadata !== null && metadata.participants ? metadata.participants : []
      const user = conn && conn !== null && typeof conn === 'object' && 'user' in conn && conn.user ? conn.user : false
      const botJid = user && 'jid' in user && user?.jid ? user.jid : user ? jidNormalizedUser(user?.id) : null
      const isBotAdmin = participants.find(({ id }) => id == botJid)?.admin?.includes('admin') || false
      const link = isBotAdmin ? (conn && typeof conn === 'object' && 'groupInviteCode' in conn && conn.groupInviteCode ? 'https://chat.whatsapp.com/' + await conn.groupInviteCode(metadata.id) : null) : null
      if (metadata)
      Object.assign(groupMetadata[jid], {
        ...metadata,
        link,
        lastfetch: Date.now()
      })
    }
   
    return groupMetadata[jid]
  }
  
  function toJSON(extra = false) {
    return extra ? {
      chats,
      messages,
      contacts,
      groupMetadata
    } : { contacts }
  }
  
  function fromJSON(json) {
    if (json?.chats) Object.assign(chats, json.chats)
    if (json?.contacts) Object.assign(contacts, json.contacts)
    if (json?.groupMetadata) Object.assign(groupMetadata, json.groupMetadata)
    if (json?.messages) {
      for (const jid in json.messages) {
        messages[jid] = json.messages[jid].map(m => m && proto.WebMessageInfo.fromObject(m)).filter(m => m && m.messageStubType != WAMessageStubType.CIPHERTEXT)
      }
    }
  }
  
  return {
    chats,
    contacts,
    messages,
    groupMetadata,
    state,
    bind,
    loadMessage,
    getExpiration,
    mostRecentMessage: (jid) => messages[jid]?.slice(-1)[0],
    fetchImageUrl: async (jid, conn) => {
      jid = jidNormalizedUser(jid) || jid
      if (!(jid in contacts)) Object.assign(contacts, { [jid]: {} })
      if (contacts[jid] && !contacts[jid].imgUrl || /changed/.test(contacts[jid].imgUrl)) {
        const url = await conn?.profilePictureUrl(jid, 'image').catch(_ => default_avatar)
        Object.assign(contacts[jid], { id: jid, imgUrl: url })
      }
      return contacts[jid].imgUrl
    },
    fetchGroupMetadata,
    fetchMessageReceipts: ({ remoteJid, id }) => {
      const msg = loadMessage(remoteJid, id)
      return msg?.userReceipt
    },
    toJSON,
    fromJSON,
    writeToFile: (path, extra = false) => {
      const json = toJSON(extra)
      if (json) writeFileSync(path, JSON.stringify(json, null, 2))
    },
    readFromFile: (path) => {
      if (existsSync(path)) {
        logger.debug({ path }, 'reading from file')
        const jsonStr = readFileSync(path, 'utf-8')
        const json = JSON.parse(jsonStr)
        fromJSON(json)
      } else
        logger.error({ path }, 'path does exist')
    }
  }
}
    