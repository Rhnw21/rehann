import axios from 'axios'
import FormData from 'form-data'

export default async function(buffer, filename = 'image.png') {
  const data = new FormData()
  data.append('file', buffer, filename)
  return new Promise((resolve, reject) => {
    axios.post('https://telegra.ph/upload', data, {
      headers: data.getHeaders()
    })
      .then(({ data }) => {
        resolve(data[0]?.src && 'https://telegra.ph' + data[0].src)
      })
      .catch(e => {
        reject(e?.response?.data?.msg || e?.response?.data?.message || e?.response?.statusText || e?.message || 'Internal server error!')
      })
  })
}