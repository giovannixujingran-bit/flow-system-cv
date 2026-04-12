"use client";

import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { MAX_ATTACHMENT_BYTES, formatBytes, getCsrfToken, mergeFiles, uploadAttachmentFiles } from "../../../lib/file-uploads";
import { toUiErrorMessage } from "../../../lib/labels";

type SelectOption = {
  value: string;
  label: string;
};

type UserOption = {
  user_id: string;
  display_name: string;
  role: string;
};

type Option = {
  departments: SelectOption[];
  project_types: SelectOption[];
  priorities: SelectOption[];
  statuses: SelectOption[];
  owners: UserOption[];
  participants: UserOption[];
  currentUserId: string;
  defaultOwnerUserId?: string;
};

function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function normalizeDateInput(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const normalized = `${year}-${month}-${day}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function userSubtitle(role: string): string {
  if (role === "admin") {
    return "管理员";
  }
  if (role === "owner") {
    return "项目负责人";
  }
  return "参与成员";
}

export function ProjectCreateForm({ option }: { option: Option }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>(() => {
    if (option.participants.some((participant) => participant.user_id === option.currentUserId)) {
      return [option.currentUserId];
    }
    return option.participants[0] ? [option.participants[0].user_id] : [];
  });
  const [error, setError] = useState<string | null>(null);

  const totalSelectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const today = useMemo(() => new Date(), []);
  const defaultStartDate = useMemo(() => toDateInputValue(today), [today]);
  const defaultDueDate = useMemo(() => {
    const next = new Date(today);
    next.setDate(next.getDate() + 14);
    return toDateInputValue(next);
  }, [today]);

  function syncInputFiles(files: File[]): void {
    if (!fileInputRef.current || typeof DataTransfer === "undefined") {
      return;
    }
    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }
    fileInputRef.current.files = transfer.files;
  }

  function updateFiles(nextFiles: File[]): void {
    setSelectedFiles(nextFiles);
    syncInputFiles(nextFiles);
  }

  function addFiles(incomingFiles: File[]): void {
    const mergedFiles = mergeFiles(selectedFiles, incomingFiles);
    const oversizedFile = mergedFiles.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversizedFile) {
      setError(`文件 ${oversizedFile.name} 超过 10GB 限制。`);
      return;
    }

    const mergedTotalBytes = mergedFiles.reduce((sum, file) => sum + file.size, 0);
    if (mergedTotalBytes > MAX_ATTACHMENT_BYTES) {
      setError("附件总大小不能超过 10GB。");
      return;
    }

    setError(null);
    updateFiles(mergedFiles);
  }

  function onFileInputChange(files: FileList | null): void {
    addFiles(files ? Array.from(files) : []);
  }

  function onDropFiles(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function removeFile(targetFile: File): void {
    const nextFiles = selectedFiles.filter(
      (file) => !(file.name === targetFile.name && file.size === targetFile.size && file.lastModified === targetFile.lastModified),
    );
    setError(null);
    updateFiles(nextFiles);
  }

  function toggleParticipant(userId: string): void {
    setSelectedParticipantIds((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    if (selectedParticipantIds.length === 0) {
      setPending(false);
      setError("请至少选择一位参与者。");
      return;
    }

    if (totalSelectedBytes > MAX_ATTACHMENT_BYTES) {
      setPending(false);
      setError("附件总大小不能超过 10GB。");
      return;
    }

    const form = new FormData(event.currentTarget);
    const startDate = normalizeDateInput(String(form.get("start_date") ?? ""));
    const dueDate = normalizeDateInput(String(form.get("due_date") ?? ""));
    if (!startDate) {
      setPending(false);
      setError("开始时间请按 xxxx/xx/xx 填写。");
      return;
    }
    if (!dueDate) {
      setPending(false);
      setError("预计截止日期请按 xxxx/xx/xx 填写。");
      return;
    }
    if (startDate > dueDate) {
      setPending(false);
      setError("预计截止日期不能早于开始时间。");
      return;
    }

    let attachmentFileIds: string[] = [];
    try {
      attachmentFileIds = await uploadAttachmentFiles(selectedFiles, getCsrfToken());
    } catch (uploadError) {
      setPending(false);
      setError(toUiErrorMessage(uploadError instanceof Error ? uploadError.message : "Attachment upload failed"));
      return;
    }

    const response = await fetch("/api/platform/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": getCsrfToken(),
      },
      body: JSON.stringify({
        request_id: `req_project_create_${Date.now()}`,
        project_name: String(form.get("project_name") ?? "").trim(),
        description: String(form.get("description") ?? "").trim(),
        department: String(form.get("department") ?? ""),
        start_date: startDate,
        due_date: dueDate,
        participant_user_ids: selectedParticipantIds,
        owner_user_id: String(form.get("owner_user_id") ?? ""),
        project_type: String(form.get("project_type") ?? ""),
        priority: String(form.get("priority") ?? ""),
        status: String(form.get("status") ?? ""),
        attachment_file_ids: attachmentFileIds,
      }),
    });

    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Project creation failed" }));
      setError(toUiErrorMessage(payload.error ?? "Project creation failed"));
      return;
    }

    const result = await response.json();
    router.push(`/projects/${result.project_id}`);
    router.refresh();
  }

  return (
    <form className="panel form-shell" onSubmit={onSubmit}>
      <div className="form-heading">
        <p className="eyebrow">Project Setup</p>
        <h3>创建项目空间</h3>
      </div>

      <div className="form-grid form-grid-three">
        <label className="field">
          <span className="field-label">项目名称</span>
          <input defaultValue="新项目" maxLength={200} name="project_name" required />
        </label>

        <label className="field">
          <span className="field-label">部门</span>
          <select defaultValue={option.departments[0]?.value ?? ""} name="department" required>
            {option.departments.map((department) => (
              <option key={department.value} value={department.value}>
                {department.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">项目类型</span>
          <select defaultValue={option.project_types[0]?.value ?? ""} name="project_type" required>
            {option.project_types.map((projectType) => (
              <option key={projectType.value} value={projectType.value}>
                {projectType.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field-label">项目简介</span>
        <textarea
          defaultValue="请补充项目目标、范围、交付节点和关键风险。"
          maxLength={4000}
          name="description"
          required
          rows={5}
        />
      </label>

      <div className="form-grid form-grid-three">
        <label className="field">
          <span className="field-label">开始时间</span>
          <input defaultValue={defaultStartDate} name="start_date" placeholder="xxxx/xx/xx" required />
        </label>

        <label className="field">
          <span className="field-label">预计截止日期</span>
          <input defaultValue={defaultDueDate} name="due_date" placeholder="xxxx/xx/xx" required />
        </label>

        <label className="field">
          <span className="field-label">项目负责人</span>
          <select defaultValue={option.defaultOwnerUserId ?? option.owners[0]?.user_id ?? ""} name="owner_user_id" required>
            {option.owners.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.display_name} / {userSubtitle(owner.role)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-grid form-grid-two">
        <label className="field">
          <span className="field-label">项目优先级</span>
          <select defaultValue={option.priorities[1]?.value ?? option.priorities[0]?.value ?? ""} name="priority" required>
            {option.priorities.map((priority) => (
              <option key={priority.value} value={priority.value}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">状态</span>
          <select defaultValue={option.statuses[0]?.value ?? ""} name="status" required>
            {option.statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="participant-picker">
        <legend>参与者</legend>
        <div className="participant-grid">
          {option.participants.map((participant) => {
            const checked = selectedParticipantIds.includes(participant.user_id);
            return (
              <label className={checked ? "participant-card participant-card-active" : "participant-card"} key={participant.user_id}>
                <input
                  checked={checked}
                  onChange={() => toggleParticipant(participant.user_id)}
                  type="checkbox"
                />
                <span className="participant-name">{participant.display_name}</span>
                <span className="participant-role">{userSubtitle(participant.role)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="stack">
        <div className="field-label">项目附件</div>
        <input
          ref={fileInputRef}
          className="file-input-hidden"
          id="project-attachments-input"
          name="attachments"
          multiple
          onChange={(event) => onFileInputChange(event.target.files)}
          type="file"
        />
        <label
          className={`upload-dropzone${dragging ? " upload-dropzone-active" : ""}`}
          htmlFor="project-attachments-input"
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={onDropFiles}
        >
          <strong>拖拽项目文件到这里上传</strong>
          <span className="muted">也可以点击选择文件，单文件和总附件上限都是 10GB。</span>
        </label>
        {selectedFiles.length > 0 ? (
          <div className="upload-file-list">
            <div className="muted">
              已选择 {selectedFiles.length} 个文件，合计 {formatBytes(totalSelectedBytes)}
            </div>
            {selectedFiles.map((file) => (
              <div className="upload-file-row" key={`${file.name}:${file.size}:${file.lastModified}`}>
                <div className="upload-file-info">
                  <span>{file.name}</span>
                  <span className="muted">{formatBytes(file.size)}</span>
                </div>
                <button className="upload-file-remove" onClick={() => removeFile(file)} type="button">
                  删除
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="form-submit-row">
        <button className="button button-primary" disabled={pending || option.owners.length === 0 || option.participants.length === 0} type="submit">
          {pending ? "创建中..." : "创建项目"}
        </button>
      </div>

      {option.owners.length === 0 ? <div className="form-feedback form-feedback-error">当前没有可选的项目负责人，请先配置管理员或项目负责人账号。</div> : null}
      {option.participants.length === 0 ? <div className="form-feedback form-feedback-error">当前没有可选参与者，请先创建用户。</div> : null}
      {error ? <div className="form-feedback form-feedback-error">{error}</div> : null}
    </form>
  );
}
