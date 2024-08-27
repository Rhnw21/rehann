import axios from 'axios'

const stringify = obj => JSON.stringify(obj, null, 2)
const parse = str => JSON.parse(str, (_, v) => {
  if (
    v !== null &&
    typeof v === 'object' &&
    'type' in v &&
    v.type === 'Buffer' &&
    'data' in v &&
    Array.isArray(v.data)) {
    return Buffer.from(v.data)
  }
  return v
})

export default class CloudDBAdapter {
  constructor(url, {
    serialize = stringify,
    deserialize = parse,
    fetchOptions = {}
  } = {}) {
    this.url = url
    this.serialize = serialize
    this.deserialize = deserialize
    this.fetchOptions = fetchOptions
  }

  async read() {
    try {
      let { status, data } = await axios.get(this.url, {
        headers: {
          'Accept': 'application/jsonq=0.9,text/plain'
        },
        ...this.fetchOptions
      })
      if (status !== 200) throw data
      return this.deserialize(data)
    } catch (e) {
      return null
    }
  }

  async write(obj) {
    try {
      let res = await axios.post(this.url, this.serialize(obj), {
        headers: {
          'Content-Type': 'application/json'
        },
        ...this.fetchOptions
      })
      if (res.status !== 200) throw res.statusText
      return res.data
    } catch (error) {
      throw error.response?.data?.message || error.message || 'Failed to write to CloudDB'
    }
  }
}
