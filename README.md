# React Component Preview for VS Code (JSX / TSX)

A high-performance VS Code extension providing live in-editor previews of React components directly beside your code, complete with **SCSS & CSS Modules support**, **comment-based mock data**, and an **ephemeral Redux store with action inspection**.

---

## ✨ Features

- ⚡ **Instant In-Editor Preview**: Renders your JSX / TSX components in a live Webview pane without needing to start your entire web application.
- 💬 **Comment-Driven Mock Data**: Define mock `props` and `store` state directly above your component using clean YAML syntax.
- 🎨 **SCSS & CSS Modules Out-of-the-Box**: Native compilation and Hot Module Replacement (HMR) for `.scss` and `*.module.scss` files powered by Vite & Sass.
- 🔄 **Multi-Variant Tabs**: Switch between different scenarios (e.g. `Default`, `Admin State`, `Logged Out State`, `Error State`) with a single click.
- 🛡️ **Ephemeral Mock Redux Store**: Safely renders components relying on `useSelector` and `useDispatch` without crashes, side-effects, or singleton pollution.
- 🎯 **Action & Callback Inspector**: Bottom drawer that records and displays dispatched Redux actions and invoked callback props (`onClick`, `onChange`, etc.) with full payloads and timestamps.
- 🎯 **Console & Action Inspector**: Bottom drawer that records and displays live `console.log`, `info`, `warn`, and `error` outputs, dispatched Redux actions, and invoked callback props (`onClick`, `onChange`, etc.) with filter tabs, formatted payloads, and timestamps.
- 📺 **VS Code Output Channel Streaming**: Automatically streams all in-preview console logs directly into VS Code's `Component Preview` output channel.
- 🔒 **Component Lock / Pin**: Freeze and keep the current preview active with a single click, allowing you to browse or edit other files across your codebase without losing your component view.
- 🚨 **Visual Error Boundary**: Catches syntax or runtime exceptions gracefully with clean stack traces and a retry button.

---

## 🚀 Quick Start

1. Open any `.jsx` or `.tsx` file in VS Code.
2. Click the **Preview** play icon in the editor title bar, or press `Ctrl+Shift+P` (or `Cmd+Shift+P`) and run:
   ```
   > Component Preview: Open Component Preview
   ```
3. The preview will open beside your code and update automatically as you edit or navigate between components.

---

## 📝 Writing Preview Comments

Place a `/* @preview ... */` comment block directly above your component declaration:

### 1. Basic Props Example

```tsx
/* @preview
props:
  label: "Submit Order"
  variant: "primary"
  disabled: false
*/
export const Button: React.FC<ButtonProps> = ({ label, variant, disabled, onClick }) => {
  return (
    <button className={`btn ${variant}`} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
};
```

> **Note**: Any callback prop starting with `on*` (such as `onClick`, `onSubmit`) is **automatically mocked**. Clicking the button logs the event and arguments directly into the **Action Inspector**!

---

### 2. Multi-Variant State Tabs

To test multiple states (e.g. loading, error, success), declare multiple `@preview` blocks with scenario names:

```tsx
/* @preview: Primary Button
props:
  label: "Save Changes"
  variant: "primary"
*/
/* @preview: Danger Action
props:
  label: "Delete Item"
  variant: "danger"
*/
/* @preview: Disabled
props:
  label: "Processing..."
  disabled: true
*/
export const Button = ({ label, variant, disabled }) => { ... };
```

Tabs will automatically appear at the top of the preview window:
`[ Primary Button ]  [ Danger Action ]  [ Disabled ]`

---

### 3. Redux Store Mocking & Dispatch Inspection

For components using `react-redux` (`useSelector`, `useDispatch`):

```tsx
/* @preview: Admin User
store:
  auth:
    isLoggedIn: true
    user:
      name: "Sarah Connor"
      email: "sarah@example.com"
      role: "admin"
*/
/* @preview: Logged Out
store:
  auth:
    isLoggedIn: false
    user: null
*/
export const UserProfile = () => {
  const dispatch = useDispatch();
  const auth = useSelector((state: RootState) => state.auth);

  if (!auth.isLoggedIn) {
    return <button onClick={() => dispatch({ type: 'auth/login' })}>Log In</button>;
  }

  return <div>Welcome, {auth.user.name} ({auth.user.role})</div>;
};
```

When you click buttons that dispatch actions:
- The ephemeral Redux store intercepts the action.
- The **Action Inspector** at the bottom reveals:
  ```
  ⚡ REDUX  auth/login  18:15:30
  payload: { "provider": "google" }
  ```

---

## 🎨 SCSS & CSS Modules

SCSS files can be imported directly into your component:

```tsx
import React from 'react';
import styles from './Card.module.scss';
import './global.scss';

export const Card = ({ title }) => {
  return <div className={styles.container}>{title}</div>;
};
```

The extension compiles SCSS using `sass` in real time. Changes to `.scss` files trigger instant Hot Module Replacement without reloading the page.

---

## ⚙️ Extension Settings

| Setting                           | Default | Description                                          |
| :-------------------------------- | :------ | :--------------------------------------------------- |
| `componentPreview.port`           | `4545`  | Port used by the background preview server.          |
| `componentPreview.autoOpenOnSave` | `false` | Automatically refresh the preview when saving files. |

---

## 🛠️ Development & Building

- **Install dependencies**: `npm install`
- **Build extension**: `npm run build`
- **Run parser tests**: `npx tsx test/testParser.ts`
- **Run Vite server tests**: `npx tsx test/testViteServer.ts`
