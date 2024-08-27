import lodash from 'lodash'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import * as Config from '../config.js'
import { CloudDBAdapter, mongoDB, mongoDBV2 } from './DB_Adapters/index.js'

export const mongoRegex = /mongodb(\+srv)?:\/\//i
export const dbAdapter = /https?:\/\//.test(Config.database) ?
  new CloudDBAdapter(Config.database) : mongoRegex.test(Config.database) ?
    (Config.databaseVersion === 2 ? new mongoDBV2(Config.database) : new mongoDB(Config.database)) :
    new JSONFile(Config.database)

export const db = new Low(dbAdapter, null)
await loadDatabase()

export async function loadDatabase() {
  if (db.READ) await db.READ
  if (db.data !== null) return db.data
  db.READ = db.read().catch(console.error)
  await db.READ
  db.data = {
    ...(db.data || {})
  }

  db.chain = lodash.chain(db.data)

  return db.data
}

export default db