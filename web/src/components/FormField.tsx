import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: LucideIcon;
  hint?: string;
};

export function FormField({
  label,
  icon: Icon,
  hint,
  type,
  id,
  ...inputProps
}: FormFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <label className="form-field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="input-wrap">
        <Icon size={18} aria-hidden="true" />
        <input
          {...inputProps}
          id={id}
          type={isPassword && showPassword ? "text" : type}
        />
        {isPassword ? (
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        ) : null}
      </span>
      {hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}
