import fs from 'fs-extra'

export const saveDanmukuFile = (content: any, path: any) => {
    fs.writeFile(path, content, { encoding: 'utf8' })
}