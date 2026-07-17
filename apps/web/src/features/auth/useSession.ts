import {
  type ChangePasswordRequest,
  type LoginRequest,
  okResponseSchema,
  type RegisterRequest,
  revokeOtherSessionsResponseSchema,
  type SessionResponse,
  sessionResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, ApiRequestError, apiSend, setCsrfToken } from '../../lib/api';

const SESSION_KEY = ['auth', 'session'] as const;

function rememberSession(session: SessionResponse): SessionResponse {
  setCsrfToken(session.csrfToken);
  return session;
}

/** Current session, or null when unauthenticated. */
export function useSession() {
  return useQuery<SessionResponse | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        const session = await apiGet('/api/v1/auth/session', (raw) =>
          sessionResponseSchema.parse(raw),
        );
        return rememberSession(session);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterRequest) =>
      apiSend('POST', '/api/v1/auth/register', input, (raw) => sessionResponseSchema.parse(raw)),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_KEY, rememberSession(session));
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) =>
      apiSend('POST', '/api/v1/auth/login', input, (raw) => sessionResponseSchema.parse(raw)),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_KEY, rememberSession(session));
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', '/api/v1/auth/logout', undefined, (raw) => okResponseSchema.parse(raw)),
    onSuccess: () => {
      setCsrfToken(null);
      queryClient.setQueryData(SESSION_KEY, null);
      queryClient.clear();
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordRequest) =>
      apiSend('POST', '/api/v1/auth/change-password', input, (raw) =>
        sessionResponseSchema.parse(raw),
      ),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_KEY, rememberSession(session));
    },
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', '/api/v1/auth/revoke-other-sessions', undefined, (raw) =>
        revokeOtherSessionsResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}
