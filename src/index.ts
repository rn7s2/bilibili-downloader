import { userQuality } from './assets/quality'
import { SettingData, VideoData } from './assets/type'
import { checkUrl, checkUrlRedirect, getDownloadList, parseHtml } from './utils/bilibili'
import { sleep } from './utils/sleep'
import downloadVideo from './utils/download'
import fs from 'fs-extra'

let settings: SettingData = {
  downloadPath: './downloads',
  SESSDATA: '',
  isMerge: true,
  isDelete: true,
  bfeId: '',
  isSubtitle: true,
  isDanmaku: true,
  isFolder: true,
  isCover: true,
  downloadingMaxSize: 1
};

export default async function download (videoUrl: string) {
  await parseVideoUrl(videoUrl)
}

async function parseVideoUrl (videoUrl: string) {
  console.log(`start to download: ${videoUrl}`)

  const videoType = checkUrl(videoUrl)
  if (!videoType) {
    console.error('请输入正确的视频地址')
    throw videoType
  }

  // 检查是否有重定向
  const { body, url } = await checkUrlRedirect(videoUrl, settings)
  // 解析html
  try {
    const videoInfo = await parseHtml(body, videoType, url.toString(), settings)
    if (videoInfo === -1) {
      throw videoInfo
    }
    await prepareDownload(videoInfo)
  } catch (error: any) {
    if (error === -1) {
      console.error('解析错误或者不支持当前视频')
    } else {
      console.error(`解析错误：${error}`)
    }
  }
}

async function prepareDownload (data: VideoData) {
  const qualities = userQuality[process.env.SESSDATA ? 1 : 0]
  data.qualityOptions.filter((item: any) => qualities.includes(item.value))

  // 默认 480P
  let quality = data.qualityOptions[0].value
  for (let i = 0; i < data.qualityOptions.length; i++) {
    if (data.qualityOptions[i].label.includes('480')) {
      quality = data.qualityOptions[i].value
    }
  }
  const videoInfo = data
  const selected: number[] = []
  // 默认全选中
  videoInfo.page.forEach(element => {
    selected.push(element.page)
  })

  await handleDownload(videoInfo, selected, quality)
}

const handleDownload = async (videoInfo: VideoData, selected: number[], quality: number) => {
  // 获取当前选中视频的下载数据
  const list = await getDownloadList(videoInfo, selected, quality, settings)

  for (let i = 0; i < list.length; i++) {
    if (fs.existsSync(list[i].filePathList[0]) && fs.existsSync(list[i].filePathList[1]) && fs.existsSync(list[i].filePathList[0].replace('.mp4', '.ass'))) {
      console.info('视频已下载，跳过')
      continue
    }

    // 引入斐波那契数列重试等待时间
    let lastWait = 3
    let wait = 5
    while (true) {
      try {
        await downloadVideo(list[i], settings)
        lastWait = 3
        wait = 5
        break
      } catch (_) {
        console.log(`重试等待: ${wait} 秒`)
        await sleep(wait * 1000)
        const tmp = lastWait + wait
        lastWait = wait
        wait = tmp
      }
    }
  }
}