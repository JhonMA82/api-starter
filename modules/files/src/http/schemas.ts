import { z } from "zod";

export const FileResponse = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  status: z.enum(["stored", "deleted"]),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type FileResponse = z.infer<typeof FileResponse>;

/** FileResponse plus its freshly issued HMAC-signed download URL. */
export const FileWithDownloadUrlResponse = FileResponse.extend({
  downloadUrl: z.string(),
});
export type FileWithDownloadUrlResponse = z.infer<typeof FileWithDownloadUrlResponse>;

export const UploadResponse = z.object({
  file: FileResponse,
  downloadUrl: z.string(),
  /** Validity of downloadUrl, in seconds. */
  expiresIn: z.number(),
});
export type UploadResponse = z.infer<typeof UploadResponse>;

export const DownloadUrlResponse = z.object({
  downloadUrl: z.string(),
  /** Validity of downloadUrl, in seconds. */
  expiresIn: z.number(),
});
export type DownloadUrlResponse = z.infer<typeof DownloadUrlResponse>;

export const ListResponse = z.object({
  files: z.array(FileWithDownloadUrlResponse),
});
export type ListResponse = z.infer<typeof ListResponse>;
