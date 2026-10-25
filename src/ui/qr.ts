/** SVG de QR Code (carregado sob demanda para não pesar a tela inicial no celular). */
export async function qrSvg(text: string, dark = '#111214', light = '#ffffff'): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light } });
}

/** URL pública da experiência, sem parâmetros de debug. */
export function experienceUrl(): string {
  return new URL('./', location.href).href;
}
