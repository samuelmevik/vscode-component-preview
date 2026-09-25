import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import styles from './UserProfile.module.scss';

export interface AuthState {
  isLoggedIn: boolean;
  user: {
    name: string;
    email: string;
    role: 'admin' | 'member';
  } | null;
}

export interface RootState {
  auth: AuthState;
}

/* @preview: Admin User
storePath: "./store"
store:
  auth:
    isLoggedIn: true
    user:
      name: "Sarah Connor"
      email: "sarah.connor@sky.net"
      role: "admin"
*/
/* @preview: Regular Member
store:
  auth:
    isLoggedIn: true
    user:
      name: "John Doe"
      email: "john.doe@example.com"
      role: "member"
*/
/* @preview: Logged Out State
store:
  auth:
    isLoggedIn: false
    user: null
*/
export const UserProfile: React.FC = () => {
  const dispatch = useDispatch();
  const auth = useSelector((state: RootState) => state.auth);

  if (!auth || !auth.isLoggedIn || !auth.user) {
    return (
      <div className={styles.card}>
        <p style={{ textAlign: 'center', color: '#9ca3af', marginBottom: 12 }}>
          You are currently logged out.
        </p>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            onClick={() =>
              dispatch({
                type: 'auth/loginRequest',
                payload: { provider: 'google' },
              })
            }
          >
            Log In
          </button>
        </div>
      </div>
    );
  }

  const { name, email, role } = auth.user;
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('');

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.avatar}>{initials}</div>
        <div className={styles.info}>
          <span className={styles.name}>{name}</span>
          <span className={styles.email}>{email}</span>
        </div>
      </div>

      <div className={styles.statusRow}>
        <span>Access Level</span>
        <span className={`${styles.roleBadge} ${role === 'admin' ? styles.admin : ''}`}>
          {role}
        </span>
      </div>

      <p>hej</p>

      <div className={styles.actions}>
        <button
          onClick={() =>
            dispatch({
              type: 'auth/switchRole',
              payload: { newRole: role === 'admin' ? 'member' : 'admin' },
            })
          }
        >
          Toggle Role
        </button>
        <button
          className={styles.primary}
          onClick={() =>
            dispatch({
              type: 'auth/logout',
              payload: { userId: email },
            })
          }
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};
