import { useEffect, useState } from 'react';
import { authState, onAuthChange, type AuthState } from './gis';

export function useAuth(): AuthState {
  const [s, setS] = useState<AuthState>(authState);
  useEffect(() => onAuthChange(setS), []);
  return s;
}
