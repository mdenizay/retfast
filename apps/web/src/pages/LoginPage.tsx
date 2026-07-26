import { LockKeyhole, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { FormField } from "../components/FormField";
import { GoogleButton } from "../components/GoogleButton";
import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../i18n";
import { getAuthErrorMessage } from "../lib/auth-errors";

export function LoginPage() {
  const { copy } = useLocale();
  const { user, loading: authLoading, signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!authLoading && user) {
    return <Navigate to="/app" replace />;
  }

  const destination =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state
      ? String(location.state.from)
      : "/app";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn(email, password);
      navigate(destination, { replace: true });
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  async function googleSignIn() {
    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
      navigate(destination, { replace: true });
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="form-heading">
        <h2>{copy.signInTitle}</h2>
        <p>{copy.signInDescription}</p>
      </div>
      <GoogleButton label={copy.continueWithGoogle} loading={loading} onClick={googleSignIn} />
      <div className="form-divider"><span>{copy.or}</span></div>
      <form onSubmit={submit} className="auth-form">
        <FormField
          id="email"
          label={copy.email}
          icon={Mail}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <FormField
          id="password"
          label={copy.password}
          icon={LockKeyhole}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <div className="form-meta form-meta-end">
          <Link to="/forgot-password">{copy.forgotPassword}</Link>
        </div>
        {error ? <div className="form-alert error-alert" role="alert">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>
          {copy.signIn}
        </button>
      </form>
      <p className="form-switch">
        {copy.noAccount} <Link to="/register">{copy.createAccount}</Link>
      </p>
    </>
  );
}
