import { Capacitor } from '@capacitor/core'

export const nativeApp = Capacitor.isNativePlatform()

export async function exportTable(text: string) {
  const filename = '凸透镜成像规律实验记录.csv'
  if (nativeApp) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const file = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: '凸透镜成像规律', files: [file.uri], dialogTitle: '保存或分享规律表' })
    return
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
