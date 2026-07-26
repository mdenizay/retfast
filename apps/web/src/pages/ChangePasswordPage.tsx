import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { FormField } from "../components/FormField";
import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../i18n";
import { getAuthErrorMessage } from "../lib/auth-errors";

export function ChangePasswordPage() {
  const { copy } = useLocale();
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (nextPassword !== confirmation) {
      setError(copy.passwordMismatch);
      return;
    }
    if (nextPassword.length < 8) {
      setError(copy.weakPassword);
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await changePassword(currentPassword, nextPassword);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmation("");
      setMessage(copy.passwordChanged);
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Link className="back-link" to="/app"><ArrowLeft size={16} />RETFAST</Link>
      <div className="form-heading compact-heading">
        <h2>{copy.changePasswordTitle}</h2>
        <p>{copy.changePasswordDescription}</p>
      </div>
      <form onSubmit={submit} className="auth-form">
        <FormField id="current-password" label={copy.currentPassword} icon={LockKeyhole} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        <FormField id="new-password" label={copy.newPassword} icon={LockKeyhole} type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} hint={copy.passwordHint} required minLength={8} />
        <FormField id="confirm-password" label={copy.confirmPassword} icon={LockKeyhole} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} />
        {message ? <div className="form-alert success-alert" role="status">{message}</div> : null}
        {error ? <div className="form-alert error-alert" role="alert">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>{copy.updatePassword}</button>
      </form>
    </>
  );
}
