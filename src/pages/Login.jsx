import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, BarChart3, Loader2, AlertCircle } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      const msg = err.message ?? '';
      setError(
        msg.includes('401') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('incorrect')
          ? 'Correo o contraseña incorrectos.'
          : msg || 'Error al iniciar sesión.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4 overflow-hidden">
      {/* Luces de fondo */}
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-primary/25 blur-3xl animate-[float-slow_9s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-accent/20 blur-3xl animate-[float-slow_11s_ease-in-out_infinite_reverse]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
      {/* Card */}
      <div className="relative w-full max-w-sm page-enter">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-xl shadow-primary/40 mb-4 animate-[float-slow_5s_ease-in-out_infinite] transition-transform hover:scale-110 hover:rotate-6">
            <BarChart3 size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-primary/80 bg-clip-text text-transparent">Sistema de Reabastecimiento</h1>
        </div>

        {/* Form */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl shadow-black/40 ring-1 ring-white/5 transition-shadow duration-300 hover:shadow-primary/10">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-300 text-sm">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                required
                autoFocus
                className="bg-white/10 border-white/10 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:bg-white/[0.14] h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-300 text-sm">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="bg-white/10 border-white/10 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:bg-white/[0.14] h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold mt-2 shadow-lg shadow-primary/30"
              disabled={loading}
            >
              {loading
                ? <><Loader2 size={15} className="mr-2 animate-spin" /> Entrando...</>
                : 'Iniciar sesión'
              }
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-500">
            ¿Sin acceso? Contacta al administrador del sistema.
          </p>
        </div>
      </div>
    </div>
  );
}
