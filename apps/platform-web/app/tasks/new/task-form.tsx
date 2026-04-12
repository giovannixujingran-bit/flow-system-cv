"use client";

import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { MAX_ATTACHMENT_BYTES, formatBytes, getCsrfToken, mergeFiles, uploadAttachmentFiles } from "../../../lib/file-uploads";
import { toUiErrorMessage } from "../../../lib/labels";

type ResponsibleOption = {
  agentId: string;
  userId: string;
  label: string;
};

type ProjectOption = {
  projectId: string;
  projectName: string;
  workflowId?: string;
  workflowTemplateId?: string;
  stepId?: string;
};

type Option = {
  projectId?: string;
  senderUserId: string;
  responsibles: ResponsibleOption[];
  defaultResponsibleAgentId?: string;
  projects: ProjectOption[];
};

export function TaskCreateForm({ option }: { option: Option }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const defaultProject = useMemo(
    () =>
      option.projects.find((project) => project.projectId === option.projectId)
      ?? option.projects[0] ?? {
        projectId: "proj_demo",
        projectName: "流程协作示例项目1",
        workflowId: "wf_demo",
        workflowTemplateId: "wf_tmpl_demo_v1",
        stepId: "step_excel_revise",
      },
    [option.projectId, option.projects],
  );

  const [selectedProjectName, setSelectedProjectName] = useState(defaultProject.projectName);

  const projectByName = useMemo(
    () => new Map(option.projects.map((project) => [project.projectName, project])),
    [option.projects],
  );
  const responsibleMap = useMemo(
    () => new Map(option.responsibles.map((responsible) => [responsible.agentId, responsible])),
    [option.responsibles],
  );

  const defaultResponsibleId = option.defaultResponsibleAgentId ?? option.responsibles[0]?.agentId ?? "";
  const totalSelectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);

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

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const responsibleAgentId = String(form.get("responsible_agent_id") ?? "");
    const responsible = responsibleMap.get(responsibleAgentId);
    if (!responsible) {
      setPending(false);
      setError("请先选择负责人。");
      return;
    }

    const selectedProject = projectByName.get(String(form.get("project_name") ?? "").trim());
    if (!selectedProject) {
      setPending(false);
      setError("请选择项目列表中的所属项目。");
      return;
    }

    if (totalSelectedBytes > MAX_ATTACHMENT_BYTES) {
      setPending(false);
      setError("附件总大小不能超过 10GB。");
      return;
    }

    let attachmentFileIds: string[] = [];
    const csrf = getCsrfToken();

    try {
      attachmentFileIds = await uploadAttachmentFiles(selectedFiles, csrf);
    } catch (uploadError) {
      setPending(false);
      setError(toUiErrorMessage(uploadError instanceof Error ? uploadError.message : "Attachment upload failed"));
      return;
    }

    const payload = {
      request_id: `req_delivery_${Date.now()}`,
      project_id: selectedProject.projectId,
      workflow_id: selectedProject.workflowId ?? "wf_demo",
      workflow_template_id: selectedProject.workflowTemplateId ?? "wf_tmpl_demo_v1",
      template_version: 1,
      step_id: selectedProject.stepId ?? "step_excel_revise",
      task_title: String(form.get("task_title") ?? ""),
      task_type: "excel_handoff",
      sender_user_id: option.senderUserId,
      target_user_id: responsible.userId,
      target_agent_id: responsible.agentId,
      priority: "medium",
      deadline: String(form.get("deadline") ?? ""),
      summary: String(form.get("summary") ?? ""),
      constraints: [],
      deliverables: String(form.get("deliverables") ?? "")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      attachment_file_ids: attachmentFileIds,
      plan_mode: "structured",
    };

    const response = await fetch("/api/platform/v1/task-deliveries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify(payload),
    });

    setPending(false);
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Task creation failed" }));
      setError(toUiErrorMessage(err.error ?? "Task creation failed"));
      return;
    }

    const result = await response.json();
    router.push(`/tasks/${result.task_id}`);
    router.refresh();
  }

  return (
    <form className="panel form-shell" onSubmit={onSubmit}>
      <div className="form-heading">
        <p className="eyebrow">Task Delivery</p>
        <h3>创建任务卡片</h3>
      </div>

      <div className="form-grid form-grid-two">
        <label className="field">
          <span className="field-label">负责人</span>
          <select defaultValue={defaultResponsibleId} name="responsible_agent_id" required>
            {option.responsibles.map((responsible) => (
              <option key={responsible.agentId} value={responsible.agentId}>
                {responsible.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">截止时间</span>
          <input defaultValue="2026-03-10T18:00:00+08:00" name="deadline" required />
        </label>
      </div>

      <label className="field">
        <span className="field-label">任务标题</span>
        <input defaultValue="春夏鞋履 Excel 修订" name="task_title" required />
      </label>

      <label className="field">
        <span className="field-label">任务摘要</span>
        <textarea
          defaultValue="补全第二个工作表中的面料列，并核对色卡编号。"
          name="summary"
          required
          rows={4}
        />
      </label>

      <label className="field">
        <span className="field-label">交付内容</span>
        <textarea
          defaultValue={"补全面料信息\n核对色卡编号\n输出最终版 xlsx"}
          name="deliverables"
          rows={3}
        />
      </label>

      <div className="form-grid form-grid-two">
        <label className="field">
          <span className="field-label">所属项目</span>
          <input
            autoComplete="off"
            list="project-options"
            name="project_name"
            onChange={(event) => setSelectedProjectName(event.target.value)}
            placeholder="搜索或选择所属项目"
            required
            value={selectedProjectName}
          />
          <datalist id="project-options">
            {option.projects.map((project) => (
              <option key={project.projectId} value={project.projectName} />
            ))}
          </datalist>
        </label>
      </div>

      <div className="stack">
        <div className="field-label">附件</div>
        <input
          ref={fileInputRef}
          className="file-input-hidden"
          id="attachments-input"
          name="attachments"
          multiple
          onChange={(event) => onFileInputChange(event.target.files)}
          type="file"
        />
        <label
          className={`upload-dropzone${dragging ? " upload-dropzone-active" : ""}`}
          htmlFor="attachments-input"
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={onDropFiles}
        >
          <strong>拖拽文件到这里上传</strong>
          <span className="muted">也可以点击这里选择文件，单文件和总附件上限都是 10GB。</span>
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
        <button className="button button-primary" disabled={pending || option.responsibles.length === 0 || option.projects.length === 0} type="submit">
          {pending ? "创建中..." : "创建任务"}
        </button>
      </div>

      {option.responsibles.length === 0 ? <div className="form-feedback form-feedback-error">当前没有可用负责人，请先启动并注册代理。</div> : null}
      {option.projects.length === 0 ? <div className="form-feedback form-feedback-error">当前没有可选项目，请先创建项目。</div> : null}
      {error ? <div className="form-feedback form-feedback-error">{error}</div> : null}
    </form>
  );
}
