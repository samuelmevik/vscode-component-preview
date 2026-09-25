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
- 🛑 **Full Server Lifecycle Control**: Turn off or restart the background Vite server anytime via the editor title bar, status bar, command palette, or in-preview header.
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

### 3. Redux Store Support (Real Store & Ephemeral Mocking)

The preview extension supports both **real production Redux stores** (with all reducers, middlewares, sagas, thunks, and RTK Query) and **lightweight mock stores**:

#### A. Real Store with Middlewares (`storePath`)
Point `storePath` to your store module (relative to the component file or via path aliases like `@/store`):

```tsx
/* @preview: Admin User (Real Store)
storePath: "./store"
store:
  auth:
    isLoggedIn: true
    user:
      name: "Sarah Connor"
      role: "admin"
*/
/* @preview: Logged Out (Inherits Store)
store:
  auth:
    isLoggedIn: false
    user: null
*/
export const UserProfile = () => { ... };
```

- **All Reducers & Middlewares Active**: Real state mutations, `createAsyncThunk`, `redux-saga`, RTK Query, and custom middlewares run in their entirety.
- **Store Factories Supported**: If your store exports `setupStore` (or `createStore`), the harness initializes a fresh, isolated store instance for each variant tab, preloaded with the YAML `store:` data.
- **Store Singletons Supported**: If your module exports `export const store = configureStore(...)` or `export default store`, it mounts directly.
- **Named Exports**: Need a specific store or sub-slice? Use `storePath: "./authStore#setupAuth"`.
- **Inheritance & Opt-out**: Defining `storePath` in the first variant applies to all subsequent variants for that component automatically. Use `storePath: none` to explicitly fall back to a mock store.

#### B. Ephemeral Mock Store (Zero-Config)
If `storePath` is omitted, the extension automatically creates a lightweight mock store that safely serves any `useSelector` without needing a real store configured:

```tsx
/* @preview: Quick Mock
store:
  cart:
    itemCount: 4
*/
```

#### C. Live Action & Middleware Inspector
Whenever actions are dispatched (via `dispatch({ type: ... })`, thunks, or middlewares):
- Real reducers process the action and update the UI.
- The **Action Inspector** at the bottom records the dispatch in real time:
  ```
  ⚡ REDUX  auth/loginRequest  18:15:30
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

## 🛑 Managing the Preview Server

You can turn off, restart, or start the background preview server at any time using multiple convenient methods:

1. **Editor Title Bar**: Click the Stop icon `$(debug-stop)` that automatically appears in the editor title bar whenever the server is active.
2. **VS Code Status Bar**: Click the `$(server) Preview: <port>` item located at the bottom right of VS Code to turn off the server.
3. **In-Preview Header**: Click the red **Stop Server** button next to the Lock toggle in the preview header.
4. **Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)**:
   - `Component Preview: Stop Preview Server`
   - `Component Preview: Restart Preview Server`
   - `Component Preview: Start Preview Server`
5. **Auto-Stop on Close**: Enable `componentPreview.stopServerOnClose` to shut down the server automatically whenever you close the preview panel tab.

When the server is stopped while the preview panel is open, a clear status card with a **"Start Preview Server"** button will be displayed so you can resume anytime with a single click.

---

## ⚙️ Extension Settings

| Setting                              | Default | Description                                                            |
| :----------------------------------- | :------ | :--------------------------------------------------------------------- |
| `componentPreview.port`              | `4545`  | Port used by the background preview server.                            |
| `componentPreview.autoOpenOnSave`    | `false` | Automatically refresh the preview when saving files.                   |
| `componentPreview.stopServerOnClose` | `false` | Automatically stop the background preview server when panel is closed. |

---

## 🛠️ Development & Building

- **Install dependencies**: `npm install`
- **Build extension**: `npm run build`
- **Run parser tests**: `npx tsx test/testParser.ts`
- **Run Vite server tests**: `npx tsx test/testViteServer.ts`
