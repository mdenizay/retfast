import { ArrowLeft, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { FormField } from "../components/FormField";
import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../i18n";
import { getAuthErrorMessage } from "../lib/auth-errors";

export function ForgotPasswordPage() {
  const { copy } = useLocale();
  const { sendReset } = useAuth();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await sendReset(email);
      setMessage(copy.resetSent);
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Link className="back-link" to="/login"><ArrowLeft size={16} />{copy.backToSignIn}</Link>
      <div className="form-heading">
        <h2>{copy.forgotTitle}</h2>
        <p>{copy.forgotDescription}</p>
      </div>
      <form onSubmit={submit} className="auth-form">
        <FormField id="reset-email" label={copy.email} icon={Mail} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        {message ? <div className="form-alert success-alert" role="status">{message}</div> : null}
        {error ? <div className="form-alert error-alert" role="alert">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>{copy.sendResetLink}</button>
      </form>
    </>
  );
}
