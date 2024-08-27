import axios from 'axios'
import crypto from 'crypto'

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

export default class PayDiSini {
  constructor(key) {
    this.api = 'https://paydisini.co.id/api/'
    this.key = key
  }

  profile = () => {
    return new Promise((resolve, reject) => {
      const form = {}
      form['key'] = this.key
      form['request'] = 'profile'
      form['signature'] = md5(this.key + 'Profile')
      axios
        .post(this.api, new URLSearchParams(Object.entries(form)))
        .then((response) => resolve(response.data))
        .catch((error) => resolve(error.response?.data || error))
    })
  }

  create = (amount, note, options) => {
    return new Promise((resolve, reject) => {
      const data = {
        key: this.key,
        request: 'new',
        unique_code: crypto.randomUUID().replace(/-/g, ''),
        service: 11,
        amount: amount,
        note: note || 'Order',
        valid_time: 60 * 5,
        type_fee: 1,
        payment_guide: true,
        ...options,
      }
      data['signature'] = md5(
        data.key +
          data.unique_code +
          data.service +
          data.amount +
          data.valid_time +
          'NewTransaction'
      )
      axios
        .post(this.api, new URLSearchParams(Object.entries(data)))
        .then((response) => resolve(response.data))
        .catch((error) => resolve(error.response?.data || error))
    })
  }

  check = (unique_code) => {
    return new Promise((resolve, reject) => {
      const form = {}
      form['key'] = this.key
      form['request'] = 'status'
      form['unique_code'] = unique_code
      form['signature'] = md5(this.key + unique_code + 'StatusTransaction')
      axios
        .post(this.api, new URLSearchParams(Object.entries(form)))
        .then((response) => resolve(response.data))
        .catch((error) => resolve(error.response?.data || error))
    })
  }

  cancel = (unique_code) => {
    return new Promise((resolve, reject) => {
      const form = {}
      form['key'] = this.key
      form['request'] = 'cancel'
      form['unique_code'] = unique_code
      form['signature'] = md5(this.key + unique_code + 'CancelTransaction')
      axios
        .post(this.api, new URLSearchParams(Object.entries(form)))
        .then((response) => resolve(response.data))
        .catch((error) => resolve(error.response?.data || error))
    })
  }
}