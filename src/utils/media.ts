const ffmpegPath = require('ffmpeg-static')
const ffmpeg = require('fluent-ffmpeg')

ffmpeg.setFfmpegPath(ffmpegPath)

export const mergeVideoAudio = (videoPath: string, audioPath: string, out: string) => {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .audioCodec('copy')
      .videoCodec('copy')
      .on('start', (cmd: any) => {
        console.info(`开始转码：${cmd}`)
      })
      .on('end', () => {
        resolve('end')
      })
      .on('error', (err: any) => {
        reject(err)
      })
      .save(out)
  })
}