export async function prepareCircuitImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
    throw new Error('请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const ratio = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法处理图片，请更换浏览器后重试')
    // Flatten alpha onto white so thin dark circuit wires retain their contrast.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = canvas.toDataURL('image/png')
    const result = png.length < 6 * 1024 * 1024 ? png : canvas.toDataURL('image/jpeg', 0.95)
    if (result.length > 7 * 1024 * 1024) throw new Error('图片处理后仍过大，请裁去电路以外的区域')
    return result
  } finally { URL.revokeObjectURL(url) }
}
