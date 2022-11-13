const got = require('got')

export const gotBuffer = (url: any, option: any) => {
  return new Promise((resolve, reject) => {
    got(url, option)
      .buffer()
      .then((res: any) => {
        return resolve(res)
      })
      .catch((error: any) => {
        console.error(`http error: ${error.message}`)
        return reject(error.message)
      })
  })
}