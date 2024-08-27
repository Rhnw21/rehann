import fs from 'fs'
import path from 'path'
import cluster from 'cluster'

function start(file) {
  if (start.isRunning) return
  start.isRunning = true
  let args = [path.join(process.cwd(), file), ...process.argv.slice(2)]
  console.info([process.argv[0], ...args].join(' '))
  cluster.setupMaster({
    exec: args[0],
    args: args.slice(1)
  })
  let p = cluster.fork()
  p.on('message', (data) => {
    console.info('[RECEIVED]', data)
    switch (data) {
      case 'restart':
        p.process.kill()
        start.isRunning = false
        start.apply(this, arguments)
        break
      case 'uptime':
        p.send(process.uptime())
        break
    }
  })
  p.on('exit', (_, code) => {
    start.isRunning = false
    console.error('Exited with code:', _, code)
    if (['SIGKILL', 'SIGABRT', 'SIGTRAP'].includes(code)) {
      p.process.kill()
      start.isRunning = false
      return start.apply(this, arguments)
    }
    if (code == null) return process.exit()
    fs.watchFile(args[0], () => {
      fs.unwatchFile(args[0])
      start(file)
    })
  })
}

start('main.js')