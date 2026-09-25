import React from 'react';
import styles from './Button.module.scss';

export interface ButtonProps {
  label: string;
  variant?: 'primary' | 'danger';
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/* @preview: Primary Button
props:
  label: "Save Changes"
  variant: "primary"
  disabled: false
*/
/* @preview: Danger Button
props:
  label: "Delete Account"
  variant: "danger"
  disabled: false
*/
/* @preview: Disabled State
props:
  label: "Processing..."
  variant: "primary"
  disabled: true
*/
export const Button: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  disabled = false,
  onClick,
}) => {
  return (
    <button
      className={`${styles.button} ${styles[variant]} ${disabled ? styles.disabled : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
};

/* @preview: Primary Button
props:
  label: "Save Changes"
  variant: "primary"
  disabled: false
*/
/* @preview: Danger Button
props:
  label: "Delete Account"
  variant: "danger"
  disabled: false
  onClick: (event) => { console.log("Button clicked!"); }
*/
/* @preview: Disabled State
props:
  label: "Processing..."
  variant: "primary"
  disabled: true
*/
export const Button1: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  disabled = false,
  onClick,
}) => {
  return (
    <button
      className={`${styles.button} ${styles[variant]} ${disabled ? styles.disabled : ''}`}
      disabled={disabled}
      onClick={() => console.log("Button1 clicked!")}
    >
      {label + "1"}
    </button>
  );
};

