"use client";

import { useState } from "react";

import styles from "./floating-input.module.css";

type FloatingInputProps = {
  label: string;
  name: string;
  type?: string | undefined;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
  suppressAutofill?: boolean | undefined;
};

export function FloatingInput({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  suppressAutofill = false,
}: FloatingInputProps) {
  const [allowInput, setAllowInput] = useState(!suppressAutofill);

  return (
    <label className={styles.inputbox}>
      <input
        autoCapitalize="none"
        autoComplete={suppressAutofill ? "off" : autoComplete}
        name={name}
        placeholder=" "
        readOnly={!allowInput}
        required={required}
        spellCheck={false}
        type={type}
        onFocus={() => {
          if (!allowInput) {
            setAllowInput(true);
          }
        }}
        onPointerDown={() => {
          if (!allowInput) {
            setAllowInput(true);
          }
        }}
      />
      <span>{label}</span>
      <i aria-hidden="true" />
    </label>
  );
}
