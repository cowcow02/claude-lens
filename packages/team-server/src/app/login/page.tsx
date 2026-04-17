import { LoginForm } from "../../components/login-form";
import { instanceState } from "../../lib/server-config";

export default async function LoginPage() {
  const state = await instanceState();
  return (
    <>
      <header className="masthead">
        <div className="masthead-logo">Fleet<em>lens</em></div>
        <div className="masthead-meta">
          <span className="mono">SIGN IN</span>
        </div>
      </header>
      <LoginForm allowSignup={state.allowPublicSignup} />
    </>
  );
}
