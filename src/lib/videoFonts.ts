import '../styles/videoFonts.css'

/** Actual internal names are shared with public/video/fonts/manifest.json. */
export const VIDEO_FONTS = {
  chinese: { css: 'Video Chinese', family: 'FZLanTingYuanS-R-GB', postScript: 'FZLANTY_JW--GB1-0', weight: 400 },
  latin: { css: 'Video Latin', family: 'STIX Two Text', postScript: 'STIXTwoText', weight: 400 },
  math: { css: 'Video Math', family: 'STIX Two Math', postScript: 'STIXTwoMath', weight: 400 },
  title: { css: 'Video Chinese', family: 'FZLanTingYuanS-R-GB', weight: 600, synthetic: true },
} as const

/** Await before measuring or capturing text; errors must not silently use fallback fonts. */
export async function loadVideoFonts(): Promise<void> {
  if (typeof document === 'undefined') return
  const queries = [
    ['400 42px "Video Chinese"', '电功率串并联'],
    ['600 36px "Video Chinese"', '电功率的计算'],
    ['400 42px "Video Latin"', 'P UI R 123'],
    ['italic 400 42px "Video Latin"', 'PUIR'],
    ['400 42px "Video Math"', '∑√Ω'],
  ]
  await Promise.all(queries.map(async ([font, text]) => {
    const loaded = await document.fonts.load(font, text)
    if (!loaded.length || loaded.some(face => face.status !== 'loaded')) throw new Error('内置视频字体加载失败：' + font)
  }))
}
