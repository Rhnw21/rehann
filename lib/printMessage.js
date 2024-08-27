import chalk from 'chalk'
import URL_REGEX from 'url-regex-safe'

export default async function(m, conn) {
  const me = parseInt(conn.user.jid) + ' ~' + conn.user.name
  const chat = m.chat + ' ' + conn.getName(m.broadcast ? m.sender : m.chat)
  const sender = parseInt(m.sender) + ' ~' + conn.getName(m.sender)
  const date = new Date(m.messageTimestamp?.toNumber ? m.messageTimestamp.toNumber() * 1000 : Date.now()) + ''
  console.log(`
${'='.repeat(35)}
${chalk.bold(date)}
${chalk.red(me)}
${chalk.cyan(chat)}
${chalk.green(sender)}
${chalk.yellow(m.mtype ? m.mtype.replace(/message$/i, '').replace(/^./, v => v.toUpperCase()) : '')}`)
  if (typeof m.text === 'string' && m.text) {
    let log = m.text.replace(/\u200e+/g, '')
    const mdRegex = /(?<=(?:^|[\s\n])\S?)(?:([*_~])(.+?)\1|```((?:.||[\n\r])+?)```)(?=\S?(?:[\s\n]|$))/g
    const mdFormat = (depth = 4) => (_, type, text, monospace) => {
      let types = {
        _: 'italic',
        '*': 'bold',
        '~': 'strikethrough'
      }
      text = text || monospace
      const formatted = !types[type] || depth < 1 ? text : chalk[types[type]](text.replace(mdRegex, mdFormat(depth - 1)))
      return formatted
    }
    if (log.length < 4096)
      log = log.replace(URL_REGEX, (url, i, text) => {
        const end = url.length + i
        return i === 0 || end === text.length || (/^\s$/.test(text[end]) && /^\s$/.test(text[i - 1])) ? chalk.blueBright(url) : url
      })
    log = log.replace(mdRegex, mdFormat(4))
    if (m.mentionedJid) {
      for (let user of m.mentionedJid)
        log = log.replace('@' + user.split`@`[0], chalk.blueBright('@' + await conn?.getName(user)))
    }
    console.log(m.error != null ? chalk.red(log) : m.isCommand ? chalk.yellow(log) : log)
  }
  if (m.messageStubParameters.length) {
    console.log(m.messageStubParameters.map(jid => {
      return /net/.test(jid)
        ? chalk.gray(parseInt(jid) + ' ~' + conn.getName(jid))
        : chalk.gray(jid)
    }).join(', '))
  }
}