import type { SupportedImageMimeType } from '@/lib/ai/provider';

/**
 * Fetches a static demo PNG/SVG/JPG asset or reads a File into raw base64 + MIME type
 * for multimodal Gemini Vision API calls.
 */
export async function fetchAssetAsBase64(assetPath: string): Promise<{
  imageBase64: string;
  imageMimeType: SupportedImageMimeType;
  dataUrl: string;
}> {
  const response = await fetch(assetPath);
  if (!response.ok) {
    throw new Error(`Không tải được ảnh mẫu: ${assetPath}`);
  }
  const blob = await response.blob();
  const mime = normalizeMime(blob.type || inferMimeFromPath(assetPath));
  const dataUrl = await blobToDataUrl(blob);
  const comma = dataUrl.indexOf(',');
  return {
    imageBase64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    imageMimeType: mime,
    dataUrl,
  };
}

export async function fileToBase64(file: File): Promise<{
  imageBase64: string;
  imageMimeType: SupportedImageMimeType;
  dataUrl: string;
}> {
  const mime = normalizeMime(file.type || inferMimeFromPath(file.name));
  const dataUrl = await blobToDataUrl(file);
  const comma = dataUrl.indexOf(',');
  return {
    imageBase64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    imageMimeType: mime,
    dataUrl,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Không đọc được dữ liệu ảnh.'));
      }
    };
    reader.onerror = () => reject(new Error('Lỗi đọc file ảnh.'));
    reader.readAsDataURL(blob);
  });
}

function inferMimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function normalizeMime(mime: string): SupportedImageMimeType {
  const lower = mime.toLowerCase();
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 'image/jpeg';
  if (lower === 'image/webp') return 'image/webp';
  if (lower === 'image/gif') return 'image/gif';
  return 'image/png';
}
