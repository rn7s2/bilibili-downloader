import UA from '../assets/ua'
import { qualityMap } from '../assets/quality'
import { VideoData, Page, DownloadUrl, Subtitle, Audio, SettingData } from '../assets/type'
import { sleep } from './sleep'
import { filterTitle } from './filterTitle'
import { formatSeconed } from './formatSeconed'
const got = require('got')

let bfeId = ''

/**
 * @params videoInfo: 当前下载的视频详情 selected：所选的分p quality：所选的清晰度
 * @returns 返回下载数据 Array
 */
const getDownloadList = async (videoInfo: VideoData, selected: number[], quality: number, settings: SettingData) => {
  const downloadList: VideoData[] = []
  for (let index = 0; index < selected.length; index++) {
    const currentPage = selected[index]
    // 请求选中清晰度视频下载地址
    const currentPageData = videoInfo.page.find(item => item.page === currentPage)
    if (!currentPageData) throw new Error('获取视频下载地址错误')
    const currentCid = currentPageData.cid
    const currentBvid = currentPageData.bvid
    // 获取下载地址
    // 判断当前数据是否有下载地址列表，有则直接用，没有再去请求
    const downloadUrl: DownloadUrl = { video: '', audio: '' }
    const videoUrl = videoInfo.video.find(item => item.id === quality && item.cid === currentCid)
    const audioUrl = getHighQualityAudio(videoInfo.audio)
    if (videoUrl && audioUrl) {
      downloadUrl.video = videoUrl.url
      downloadUrl.audio = audioUrl.url
    } else {
      const { video, audio } = await getDownloadUrl(currentCid, currentBvid, quality, settings)
      downloadUrl.video = video
      downloadUrl.audio = audio
    }
    // 获取字幕地址
    const subtitle = await getSubtitle(currentCid, currentBvid, settings)
    const videoData: VideoData = {
      ...videoInfo,
      title: currentPageData.title,
      url: currentPageData.url,
      quality: quality,
      duration: currentPageData.duration,
      createdTime: +new Date(),
      cid: currentCid,
      bvid: currentBvid,
      downloadUrl,
      filePathList: handleFilePathList(selected.length === 1 ? 0 : currentPage, currentPageData.title, videoInfo.up[0].name, currentBvid, settings),
      fileDir: handleFileDir(selected.length === 1 ? 0 : currentPage, currentPageData.title, videoInfo.up[0].name, currentBvid, settings),
      subtitle
    }
    downloadList.push(videoData)
    if (index !== selected.length - 1) {
      await sleep(1000)
    }
  }
  return downloadList
}

/**
 *
 * @returns 保存cookie中的bfe_id
 */
const saveResponseCookies = (cookies: string[]) => {
  if (cookies && cookies.length) {
    const cookiesString = cookies.join(';')
    console.log('bfe: ', cookiesString)
    bfeId = cookiesString
  }
}

/**
 *
 * @returns 0: 游客，未登录 1：普通用户 2：大会员
 */
const checkLogin = async (SESSDATA: string) => {
  const { body } = await got('https://api.bilibili.com/x/web-interface/nav', {
    headers: {
      'User-Agent': `${UA}`,
      cookie: `SESSDATA=${SESSDATA}`
    },
    responseType: 'json'
  }).catch((err: any) => {
    console.log('checkLogin failed.')
    throw err
  })
  if ((body as any).data.isLogin && !(body as any).data.vipStatus) {
    return 1
  } else if ((body as any).data.isLogin && (body as any).data.vipStatus) {
    return 2
  } else {
    return 0
  }
}

// 检查url合法
const checkUrl = (url: string) => {
  const mapUrl = {
    'video/av': 'BV',
    'video/BV': 'BV',
    'play/ss': 'ss',
    'play/ep': 'ep'
  }
  let flag = false
  for (const key in mapUrl) {
    if (url.includes(key)) {
      flag = true
      return mapUrl[key as keyof typeof mapUrl]
    }
  }
  if (!flag) {
    return ''
  }
}

// 检查url是否有重定向
const checkUrlRedirect = async (videoUrl: string, settings: SettingData) => {
  const params = {
    videoUrl,
    config: {
      headers: {
        'User-Agent': `${UA}`,
        cookie: `SESSDATA=${settings.SESSDATA}`
      }
    }
  }
  const { body, redirectUrls } = await got(params.videoUrl, params.config).catch((err: any) => {
    console.log('checkUrlRedirect failed.')
    throw err
  })
  const url = redirectUrls[0] ? redirectUrls[0] : videoUrl
  return {
    body,
    url
  }
}

const parseHtml = (html: string, type: string, url: string, settings: SettingData) => {
  switch (type) {
    case 'BV':
      return parseBV(html, url, settings)
    case 'ss':
      return parseSS(html, settings)
    case 'ep':
      return parseEP(html, url, settings)
    default:
      return -1
  }
}

const parseBV = async (html: string, url: string, settings: SettingData) => {
  try {
    const videoInfo = html.match(/\<\/script\>\<script\>window\.\_\_INITIAL\_STATE\_\_\=([\s\S]*?)\;\(function\(\)/)
    if (!videoInfo) throw new Error('parse bv error')
    const { videoData } = JSON.parse(videoInfo[1])
    // 获取视频下载地址
    let acceptQuality = null
    try {
      let downLoadData: any = html.match(/\<script\>window\.\_\_playinfo\_\_\=([\s\S]*?)\<\/script\>\<script\>window\.\_\_INITIAL\_STATE\_\_\=/)
      if (!downLoadData) throw new Error('parse bv error')
      downLoadData = JSON.parse(downLoadData[1])
      acceptQuality = {
        accept_quality: downLoadData.data.accept_quality,
        video: downLoadData.data.dash.video,
        audio: downLoadData.data.dash.audio
      }
    } catch (error) {
      acceptQuality = await getAcceptQuality(videoData.cid, videoData.bvid, settings)
    }
    const obj: VideoData = {
      id: '',
      title: videoData.title,
      url,
      bvid: videoData.bvid,
      cid: videoData.cid,
      cover: videoData.pic,
      createdTime: -1,
      quality: -1,
      view: videoData.stat.view,
      danmaku: videoData.stat.danmaku,
      reply: videoData.stat.reply,
      duration: formatSeconed(videoData.duration),
      up: videoData.hasOwnProperty('staff') ? videoData.staff.map((item: any) => ({ name: item.name, mid: item.mid })) : [{ name: videoData.owner.name, mid: videoData.owner.mid }],
      qualityOptions: acceptQuality.accept_quality.map((item: any) => ({ label: qualityMap[item as keyof typeof qualityMap], value: item })),
      page: parseBVPageData(videoData, url),
      subtitle: [],
      video: acceptQuality.video ? acceptQuality.video.map((item: any) => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
      audio: acceptQuality.audio ? acceptQuality.audio.map((item: any) => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
      filePathList: [],
      fileDir: '',
      size: -1,
      downloadUrl: { video: '', audio: '' }
    }
    console.log('bv')
    console.log(obj)
    return obj
  } catch (error: any) {
    throw new Error(error)
  }
}

const parseEP = async (html: string, url: string, settings: SettingData) => {
  try {
    const videoInfo = html.match(/\<script\>window\.\_\_INITIAL\_STATE\_\_\=([\s\S]*?)\;\(function\(\)\{var s\;/)
    if (!videoInfo) throw new Error('parse ep error')
    const { h1Title, mediaInfo, epInfo, epList } = JSON.parse(videoInfo[1])
    // 获取视频下载地址
    let acceptQuality = null
    try {
      let downLoadData: any = html.match(/\<script\>window\.\_\_playinfo\_\_\=([\s\S]*?)\<\/script\>\<script\>window\.\_\_INITIAL\_STATE\_\_\=/)
      if (!downLoadData) throw new Error('parse ep error')
      downLoadData = JSON.parse(downLoadData[1])
      acceptQuality = {
        accept_quality: downLoadData.data.accept_quality,
        video: downLoadData.data.dash.video,
        audio: downLoadData.data.dash.audio
      }
    } catch (error) {
      acceptQuality = await getAcceptQuality(epInfo.cid, epInfo.bvid, settings)
    }
    const obj: VideoData = {
      id: '',
      title: h1Title,
      url,
      bvid: epInfo.bvid,
      cid: epInfo.cid,
      cover: `http: ${mediaInfo.cover}`,
      createdTime: -1,
      quality: -1,
      view: mediaInfo.stat.views,
      danmaku: mediaInfo.stat.danmakus,
      reply: mediaInfo.stat.reply,
      duration: formatSeconed(epInfo.duration / 1000),
      up: [{ name: mediaInfo.upInfo.name, mid: mediaInfo.upInfo.mid }],
      qualityOptions: acceptQuality.accept_quality.map((item: any) => ({ label: qualityMap[item as keyof typeof qualityMap], value: item })),
      page: parseEPPageData(epList),
      subtitle: [],
      video: acceptQuality.video ? acceptQuality.video.map((item: any) => ({ id: item.id, cid: epInfo.cid, url: item.baseUrl })) : [],
      audio: acceptQuality.audio ? acceptQuality.audio.map((item: any) => ({ id: item.id, cid: epInfo.cid, url: item.baseUrl })) : [],
      filePathList: [],
      fileDir: '',
      size: -1,
      downloadUrl: { video: '', audio: '' }
    }
    console.log('ep')
    console.log(obj)
    return obj
  } catch (error: any) {
    throw new Error(error)
  }
}

const parseSS = async (html: string, settings: SettingData) => {
  try {
    const videoInfo = html.match(/\<script\>window\.\_\_INITIAL\_STATE\_\_\=([\s\S]*?)\;\(function\(\)\{var s\;/)
    if (!videoInfo) throw new Error('parse ss error')
    const { mediaInfo } = JSON.parse(videoInfo[1])
    const params = {
      url: `https://www.bilibili.com/bangumi/play/ep${mediaInfo.newestEp.id}`,
      config: {
        headers: {
          'User-Agent': `${UA}`,
          cookie: `SESSDATA=${settings.SESSDATA}`
        }
      }
    }
    const { body } = await got(params.url, params.config).catch((err: any) => {
      console.log('parseSS failed.')
      throw err
    })
    return parseEP(body, params.url, settings)
  } catch (error: any) {
    throw new Error(error)
  }
}

// 获取视频清晰度列表
const getAcceptQuality = async (cid: string, bvid: string, settings: SettingData) => {
  const SESSDATA = settings.SESSDATA
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      cookie: `SESSDATA=${SESSDATA};bfe_id=${bfeId}`
    },
    responseType: 'json'
  }
  const { body: { data: { accept_quality, dash: { video, audio } } }, headers: { 'set-cookie': responseCookies } } = (await got(
    `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&qn=127&type=&otype=json&fourk=1&fnver=0&fnval=80&session=68191c1dc3c75042c6f35fba895d65b0`,
    config as any
  ) as any).catch((err: any) => {
    console.error('getAcceptQuality error.')
    throw err
  })
  // 保存返回的cookies
  saveResponseCookies(responseCookies)
  return {
    accept_quality,
    video,
    audio
  }
}

// 获取指定清晰度视频下载地址
const getDownloadUrl = async (cid: number, bvid: string, quality: number, settings: SettingData) => {
  const SESSDATA = settings.SESSDATA
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      // bfe_id必须要加
      cookie: `SESSDATA=${SESSDATA};bfe_id=${bfeId}`
    },
    responseType: 'json'
  }

  const { body: { data: { dash } }, headers: { 'set-cookie': responseCookies } } = (await got(
    `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&qn=${quality}&type=&otype=json&fourk=1&fnver=0&fnval=80&session=68191c1dc3c75042c6f35fba895d65b0`,
    config as any
  ) as any).catch((err: any) => {
    console.error('getDownloadUrl failed.')
    throw err
  })
  // 保存返回的cookies
  saveResponseCookies(responseCookies)
  return {
    video: dash.video.find((item: any) => item.id === quality) ? dash.video.find((item: any) => item.id === quality).baseUrl : dash.video[0].baseUrl,
    audio: getHighQualityAudio(dash.audio).baseUrl,
  }
}

// 获取视频字幕
const getSubtitle = async (cid: number, bvid: string, settings: SettingData) => {
  const SESSDATA = settings.SESSDATA
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      cookie: `SESSDATA=${SESSDATA};bfe_id=${bfeId}`
    },
    responseType: 'json'
  }
  const { body: { data: { subtitle } } } = (await got(`https://api.bilibili.com/x/player/v2?cid=${cid}&bvid=${bvid}`, config as any) as any).catch((err: any) => {
    console.error('getSubtitle error.')
    throw err
  })
  const subtitleList: Subtitle[] = subtitle.subtitles ? subtitle.subtitles.map((item: any) => ({ title: item.lan_doc, url: item.subtitle_url })) : []
  return subtitleList
}

// 处理filePathList
const handleFilePathList = (page: number, title: string, up: string, bvid: string, settings: SettingData): string[] => {
  const downloadPath = settings.downloadPath
  const name = `${!page ? '' : `[P${page}]`}${filterTitle(`${bvid}`)}`
  const isFolder = settings.isFolder
  return [
    `${downloadPath}/${isFolder ? `${name}/` : ''}${name}.mp4`,
    `${downloadPath}/${isFolder ? `${name}/` : ''}${name}.png`,
    `${downloadPath}/${isFolder ? `${name}/` : ''}${name}-video.m4s`,
    `${downloadPath}/${isFolder ? `${name}/` : ''}${name}-audio.m4s`,
    isFolder ? `${downloadPath}/${name}/` : ''
  ]
}

// 处理fileDir
const handleFileDir = (page: number, title: string, up: string, bvid: string, settings: SettingData): string => {
  const downloadPath = settings.downloadPath
  const name = `${!page ? '' : `[P${page}]`}${filterTitle(`${bvid}`)}`
  const isFolder = settings.isFolder
  return `${downloadPath}${isFolder ? `/${name}/` : ''}`
}

// 处理bv多p逻辑
const parseBVPageData = ({ bvid, title, pages }: { bvid: string, title: string, pages: any[] }, url: string): Page[] => {
  const len = pages.length
  if (len === 1) {
    return [
      {
        title,
        url,
        page: pages[0].page,
        duration: formatSeconed(pages[0].duration),
        cid: pages[0].cid,
        bvid: bvid
      }
    ]
  } else {
    return pages.map(item => ({
      title: item.part,
      page: item.page,
      duration: formatSeconed(item.duration),
      cid: item.cid,
      bvid: bvid,
      url: `${url}?p=${item.page}`
    }))
  }
}

// 处理ep多p逻辑
const parseEPPageData = (epList: any[]): Page[] => {
  return epList.map((item, index) => ({
    title: item.share_copy,
    page: index + 1,
    duration: formatSeconed(item.duration / 1000),
    cid: item.cid,
    bvid: item.bvid,
    url: item.share_url
  }))
}

// 获取码率最高的audio
const getHighQualityAudio = (audioArray: any[]) => {
  return audioArray.sort((a, b) => b.id - a.id)[0]
}

export {
  checkLogin,
  checkUrl,
  checkUrlRedirect,
  parseHtml,
  getDownloadList
}
