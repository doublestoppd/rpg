import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/TextField';
import { useRegister, useSession } from '../features/auth/useSession';
import { ApiRequestError } from '../lib/api';

export function RegisterPage() {
  const { data: session } = useSession();
  const registerMutation = useRegister();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    registerMutation.mutate(
      { email, password, displayName },
      {
        onSuccess: () => void navigate('/', { replace: true }),
        onError: (err) =>
          setError(err instanceof ApiRequestError ? err.message : 'Registration failed.'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-sm">
      <Card title="Create your account">
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
            label="Display name"
            autoComplete="nickname"
            required
            minLength={3}
            maxLength={24}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" disabled={registerMutation.isPending} className="w-full">
            {registerMutation.isPending ? 'Creating…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-stone-600 dark:text-stone-400">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-amber-800 hover:underline dark:text-amber-400"
          >
            Log in
          </Link>
        </p>
      </Card>
    </div>
  );
}
