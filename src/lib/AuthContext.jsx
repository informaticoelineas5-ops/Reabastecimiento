import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { tokenStore } from '@/api/tokenStore';
import { apiAuthLogin, apiAuthClearTokens } from '@/api/apiAuthClient';
import { base44 } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user,            setUser]            = useState(null);
  const [userProfile,     setUserProfile]     = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth,   setIsLoadingAuth]   = useState(true);

  const loadSession = useCallback(async () => {
    const token = tokenStore.get();
    if (!token) {
      setUser(null);
      setUserProfile(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      return;
    }
    try {
      const profile = await base44.auth.me();
      setUser({ id: profile.id, email: profile.email });
      setUserProfile(profile);
      setIsAuthenticated(true);
    } catch {
      apiAuthClearTokens();
      setUser(null);
      setUserProfile(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  const login = useCallback(async (email, password) => {
    const json = await apiAuthLogin(email, password);
    // Use user data from sign-in response if available (avoids extra /auth/me request)
    const userData = json?.user ?? json?.data?.user ?? json?.data;
    if (userData?.email || userData?.id) {
      const profile = {
        id:        userData.id        ?? userData.userId    ?? null,
        email:     userData.email                           ?? null,
        role:      userData.role      ?? userData.systemRole ?? 'consulta',
        full_name: userData.fullName  ?? userData.full_name ?? userData.name ?? null,
        status:    'active',
      };
      setUser({ id: profile.id, email: profile.email });
      setUserProfile(profile);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } else {
      // Sign-in response didn't include user info → fetch from /auth/me
      await loadSession();
    }
  }, [loadSession]);

  const logout = useCallback(() => {
    apiAuthClearTokens();
    setUser(null);
    setUserProfile(null);
    setIsAuthenticated(false);
  }, []);

  const refreshProfile = useCallback(() => loadSession(), [loadSession]);

  return (
    <AuthContext.Provider value={{
      user,
      userProfile,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError: (!isAuthenticated && !isLoadingAuth)
        ? { type: 'auth_required' }
        : null,
      appPublicSettings: null,
      login,
      logout,
      refreshProfile,
      navigateToLogin: () => {},
      checkAppState:   () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
