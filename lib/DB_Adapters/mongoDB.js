import mongoose, {
  Schema,
  connect,
  model as _model
} from 'mongoose'

mongoose.set('strictQuery', true)
const defaultOptions = { useNewUrlParser: true, useUnifiedTopology: true }

export class mongoDB {
  constructor(url, options = defaultOptions) {
    /** @type {string} */
    this.url = url
    /** @type {mongoose.ConnectOptions} */
    this.options = options
    this.data = this._data = {}
    /** @type {mongoose.Schema} */
    this._schema = {}
    /** @type {mongoose.Model} */
    this._model = {}
    /** @type {Promise<typeof mongoose>} */
    this.db = connect(this.url, { ...this.options }).then(() => console.log('mongodbv1 connected!')).catch(console.error)
  }

  async read() {
    this.conn = await this.db
    let schema = this._schema = new Schema({
      data: {
        type: Object,
        required: true,
        default: {}
      }
    })
    try {
      this._model = _model('data', schema)
    } catch (e) {
      this._model = mongoose.models.data || _model('data')
    }
    this._data = await this._model.findOne({})
    if (!this._data) {
      this.data = {}
      await this.write(this.data)
      this._data = await this._model.findOne({})
    } else {
      this.data = this._data.data
    }
    return this.data
  }

  write(data) {
    return new Promise(async (resolve, reject) => {
      if (!data) return reject(new Error('Data is undefined'))
      if (!this._data) {
        const newModel = new this._model({ data })
        await newModel.save()
        return resolve(newModel)
      }
      this._model.findById(this._data._id).then((doc) => {
        if (!doc.data) doc.data = {}
        doc.data = data
        this.data = data
        doc.save().then(resolve).catch(reject)
      }).catch(reject)
    })
  }
}

export class mongoDBV2 {
  constructor(url, options = defaultOptions) {
    /** @type {string} */
    this.url = url
    /** @type {mongoose.ConnectOptions} */
    this.options = options
    /** @type {{ name: string, model: mongoose.Model}[]} */
    this.models = []
    /** @type {{ [Key: string]: any }} */
    this.data = {}
    /** @type {Promise<typeof mongoose>} */
    this.db = connect(this.url, { ...this.options }).catch(console.error)
  }

  async read() {
    this.conn = await this.db
    const schema = new Schema({
      data: [{
        name: String,
      }]
    })
    try {
      this.list = _model('lists', schema)
    } catch (e) {
      this.list = mongoose.models.lists || _model('lists')
    }
    this.lists = await this.list.findOne({})
    if (!this.lists?.data) {
      await this.list.create({ data: [] })
      this.lists = await this.list.findOne({})
    }
    const garbage = []
    await Promise.all(this.lists.data.map(async ({ name }) => {
      try {
        let collection = _model(name, new Schema({ data: Array }))
        const index = this.models.findIndex(v => v.name === name)
        if (index !== -1) this.models[index].model = collection
        else this.models.push({ name, model: collection })
        const collectionsData = await collection.find({})
        this.data[name] = Object.fromEntries(collectionsData.map(v => v.data))
      } catch (e) {
        console.error(e)
        garbage.push(name)
      }
    }))

    try {
      const del = await this.list.findById(this.lists._id)
      del.data = del.data.filter(v => !garbage.includes(v.name))
      await del.save()
    } catch (e) {
      console.error(e)
    }
    return this.data
  }

  write(data) {
    return new Promise(async (resolve, reject) => {
      if (!this.lists || !data) return reject(new Error('Lists or data is undefined'))
      const collections = Object.keys(data)
      const listDoc = []

      await Promise.all(collections.map(async (key) => {
        const index = this.models.findIndex(v => v.name === key)
        if (index !== -1) {
          const doc = this.models[index].model
          if (Object.keys(data[key]).length > 0) {
            await doc.deleteMany().catch(console.error)
            await doc.insertMany(Object.entries(data[key]).map(v => ({ data: v })))
          }
          listDoc.push({ name: key })
        } else {
          const schema = new Schema({ data: Array })
          try {
            let doc = _model(key, schema)
            const index = this.models.findIndex(v => v.name === key)
            if (index !== -1) this.models[index].model = doc
            else this.models.push({ name: key, model: doc })
            await doc.insertMany(Object.entries(data[key]).map(v => ({ data: v })))
            listDoc.push({ name: key })
          } catch (e) {
            console.error(e)
          }
        }
      }))

      this.list.findById(this.lists._id).then(async (doc) => {
        if (!doc) {
          await this.read()
          await this.write(data)
        } else {
          doc.data = listDoc
          await doc.save()
        }
        this.data = {}
        resolve()
      }).catch(reject)
    })
  }
}