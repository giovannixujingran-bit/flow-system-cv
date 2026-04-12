import { AuthShell } from "../../components/auth-shell";
import { publicPlatformApiJson } from "../../lib/api";
import { LoginForm } from "./login-form";
import { SetupForm } from "./setup-form";

type SetupStatus = {
  initialized: boolean;
  user_count: number;
  self_initialize_allowed: boolean;
};

async function readSetupStatus(): Promise<SetupStatus> {
  try {
    return await publicPlatformApiJson<SetupStatus>("/api/v1/setup/status");
  } catch {
    return {
      initialized: true,
      user_count: 0,
      self_initialize_allowed: false,
    };
  }
}

export default async function LoginPage() {
  const setup = await readSetupStatus();
  const showSetup = !setup.initialized && setup.self_initialize_allowed;
  const showManagedAccountsNotice = !setup.initialized && !setup.self_initialize_allowed;

  const title = showSetup
    ? "初始化平台"
    : showManagedAccountsNotice
      ? "受管账号登录"
      : "登录";
  const description = showSetup
    ? "这是第一次启动，请先创建第一个管理员账号。"
    : showManagedAccountsNotice
      ? "当前平台已启用受管账号模式，请使用管理员分发的账号登录。"
      : "使用管理员分发的账号登录 Flow System 控制台。";

  return (
    <AuthShell eyebrow="Flow System" title={title} description={description}>
      {showSetup ? <SetupForm className="auth-form-shell" /> : null}
      {showManagedAccountsNotice ? (
        <div className="panel auth-notice-card">
          <strong>暂时没有可登录账号</strong>
          <p className="muted">当前平台已关闭自助初始化，请联系管理员获取账号或导入账号文件。</p>
        </div>
      ) : null}
      {setup.initialized ? <LoginForm className="auth-form-shell" /> : null}
    </AuthShell>
  );
}
