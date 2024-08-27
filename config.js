import chalk from 'chalk'
import { format } from 'util'
import { existsSync, mkdirSync } from 'fs'

export const owner = ['6283832492541']

export const database = 'mongodb+srv://bgsrhnsh:sembarang1@cluster0.o9xde6y.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
export const databaseVersion = 1

export const authFolder = 'database/sessions'
export const storeFolder = 'database/store.json'

export const prefix = new RegExp('^([' + ('‎/!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-').replace(/[|\\{}()[\]^$+*?.\-\^]/g, '\\$&') + '])')
export const execPrefix = /^×?>/

export const tmp = 'sampah'
export const paydisini = 'b50fb0c3ce72f98c3b35275c4cd81b20'

if (!existsSync(tmp)) mkdirSync(tmp)
if (!existsSync('database')) mkdirSync('database')

export const logger = {
  info(...args) {
    console.log(
      chalk.bold.bgRgb(51, 204, 51)('INFO '),
      `[${chalk.rgb(255, 255, 255)(new Date().toLocaleString())}]:\n`,
      chalk.cyan(format(...args))
    )
  },
  error(...args) {
    console.log(
      chalk.bold.bgRgb(247, 38, 33)('ERROR '),
      `[${chalk.rgb(255, 255, 255)(new Date().toLocaleString())}]:\n`,
      chalk.rgb(255, 38, 0)(format(...args))
    )
  },
  warn(...args) {
    console.log(
      chalk.bold.bgRgb(255, 153, 0)('WARNING '),
      `[${chalk.rgb(255, 255, 255)(new Date().toLocaleString())}]:\n`,
      chalk.redBright(format(...args))
    )
  },
  trace(...args) {
    console.log(
      chalk.grey('TRACE '),
      `[${chalk.rgb(255, 255, 255)(new Date().toLocaleString())}]:\n`,
      chalk.white(format(...args))
    )
  },
  debug(...args) {
    console.log(
      chalk.bold.bgRgb(66, 167, 245)('DEBUG '),
      `[${chalk.rgb(255, 255, 255)(new Date().toLocaleString())}]:\n`,
      chalk.white(format(...args))
    )
  }
}

export default {
  tmp,
  owner,
  logger,
  prefix,
  database,
  paydisini,
  execPrefix,
  authFolder,
  storeFolder,
  databaseVersion
}