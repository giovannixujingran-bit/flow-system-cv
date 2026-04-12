export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 * 1024;

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function getCsrfToken(): string {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith("flow_csrf="));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : "";
}

export function mergeFiles(currentFiles: File[], incomingFiles: File[]): File[] {
  const merged = new Map<string, File>();
  for (const file of [...currentFiles, ...incomingFiles]) {
    merged.set(`${file.name}:${file.size}:${file.lastModified}`, file);
  }
  return [...merged.values()];
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  return `${value} B`;
}

export async function uploadAttachmentFiles(files: File[], csrfToken: string): Promise<string[]> {
  const attachmentFileIds: string[] = [];

  for (const file of files) {
    const digest = await sha256(file);

    const initResponse = await fetch("/api/platform/v1/files/upload-init", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        request_id: `req_upload_init_${Date.now()}_${file.name}`,
        purpose: "attachment",
        original_name: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        sha256_declared: digest,
      }),
    });

    if (!initResponse.ok) {
      throw new Error("Attachment init failed");
    }

    const initPayload = await initResponse.json();
    const uploadResponse = await fetch(`/api/platform${initPayload.upload_url.replace("/api", "")}`, {
      method: "PUT",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-csrf-token": csrfToken,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error("Attachment upload failed");
    }

    const completeResponse = await fetch("/api/platform/v1/files/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        request_id: `req_upload_complete_${Date.now()}_${file.name}`,
        file_id: initPayload.file_id,
      }),
    });

    if (!completeResponse.ok) {
      throw new Error("Attachment complete failed");
    }

    attachmentFileIds.push(initPayload.file_id);
  }

  return attachmentFileIds;
}
