import type { SupportedImageMimeType } from '@/lib/ai/provider';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB cap before client compression
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const MAX_IMAGE_SIDE = 1400;
const COMPRESS_THRESHOLD_BYTES = 900 * 1024; // 900KB

/**
 * Fetches a static demo PNG/SVG/JPG asset or reads a File into compressed base64 + MIME type
 * so payloads stay well under Vercel's 4.5MB serverless request cap.
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
  const rawType = (file.type || inferMimeFromPath(file.name)).toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(rawType)) {
    throw new Error('Chỉ hỗ trợ ảnh định dạng PNG, JPG hoặc WEBP.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Dung lượng ảnh vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.');
  }

  const rawDataUrl = await blobToDataUrl(file);
  const compressed = await compressImageDataUrlIfNeeded(rawDataUrl, file.size, normalizeMime(rawType));

  const comma = compressed.dataUrl.indexOf(',');
  return {
    imageBase64: comma >= 0 ? compressed.dataUrl.slice(comma + 1) : compressed.dataUrl,
    imageMimeType: compressed.mimeType,
    dataUrl: compressed.dataUrl,
  };
}

async function compressImageDataUrlIfNeeded(
  dataUrl: string,
  fileSize: number,
  mimeType: SupportedImageMimeType
): Promise<{ dataUrl: string; mimeType: SupportedImageMimeType }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { dataUrl, mimeType };
  }

  try {
    const img = await loadImage(dataUrl);
    const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
    if (maxDim <= MAX_IMAGE_SIDE && fileSize <= COMPRESS_THRESHOLD_BYTES) {
      return { dataUrl, mimeType };
    }

    const scale = maxDim > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / maxDim : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl, mimeType };

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const outDataUrl = canvas.toDataURL('image/jpeg', 0.84);
    if (outDataUrl.length < dataUrl.length || maxDim > MAX_IMAGE_SIDE) {
      return { dataUrl: outDataUrl, mimeType: 'image/jpeg' };
    }
    return { dataUrl, mimeType };
  } catch {
    return { dataUrl, mimeType };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể giải mã ảnh.'));
    img.src = src;
  });
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
  return 'image/png';
}

function normalizeMime(mime: string): SupportedImageMimeType {
  const lower = mime.toLowerCase();
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 'image/jpeg';
  if (lower === 'image/webp') return 'image/webp';
  return 'image/png';
}
