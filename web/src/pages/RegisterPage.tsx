import { LockKeyhole, Mail, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { FormField } from "../components/FormField";
import { GoogleButton } from "../components/GoogleButton";
import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../i18n";
import { getAuthErrorMessage } from "../lib/auth-errors";

export function RegisterPage() {
  const { copy } = useLocale();
  const { user, loading: authLoading, register, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!authLoading && user) {
    return <Navigate to="/app" replace />;
  }

  async function run(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    try {
      await action();
      navigate("/app", { replace: true });
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError(copy.weakPassword);
      return;
    }
    void run(() => register(name, email, password));
  }

  return (
    <>
      <div className="form-heading compact-heading">
        <h2>{copy.registerTitle}</h2>
        <p>{copy.registerDescription}</p>
      </div>
      <GoogleButton label={copy.continueWithGoogle} loading={loading} onClick={() => void run(signInWithGoogle)} />
      <div className="form-divider"><span>{copy.or}</span></div>
      <form onSubmit={submit} className="auth-form">
        <FormField id="full-name" label={copy.fullName} icon={UserRound} type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
        <FormField id="register-email" label={copy.email} icon={Mail} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <FormField id="register-password" label={copy.password} icon={LockKeyhole} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint={copy.passwordHint} required minLength={8} />
        {error ? <div className="form-alert error-alert" role="alert">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>{copy.createAccount}</button>
      </form>
      <p className="form-switch">{copy.haveAccount} <Link to="/login">{copy.signIn}</Link></p>
    </>
  );
}
