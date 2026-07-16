import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/TextField';
import { useLogin, useSession } from '../features/auth/useSession';
import { ApiRequestError } from '../lib/api';

export function LoginPage() {
  const { data: session } = useSession();
  const loginMutation = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    loginMutation.mutate(
      { email, password },
      {
        onSuccess: () => navigate(from, { replace: true }),
        onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Login failed.'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-sm">
      <Card title="Log in">
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" disabled={loginMutation.isPending} className="w-full">
            {loginMutation.isPending ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-stone-600 dark:text-stone-400">
          New here?{' '}
          <Link
            to="/register"
            className="font-medium text-amber-800 hover:underline dark:text-amber-400"
          >
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  );
}
